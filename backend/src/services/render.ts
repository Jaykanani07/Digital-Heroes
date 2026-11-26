import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";
import sharp from "sharp";
import {
  PDFDocument,
  type PDFPage,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  translate,
  rotateDegrees,
  scale,
  rectangle,
  clip,
  endPath,
} from "pdf-lib";
import {
  FONTS,
  LINE_HEIGHT,
  PT_TO_MM,
  fitText,
  printArea,
  trackingWidthMm,
  type Design,
  type DesignElement,
  type FontKey,
  type ImageElement,
  type MeasureFn,
  type PrintSpec,
  type TextElement,
} from "../shared/design.js";

/**
 * Server-side render engine (§07). One layout pass feeds three outputs:
 *   - SVG  (proof previews, thumbnails, gallery)
 *   - PNG  (sharp rasterises the SVG at the product DPI)
 *   - PDF  (pdf-lib, vector, with TrimBox/BleedBox and bleed)
 * Text is converted to vector outlines with fontkit, so output never depends
 * on fonts installed on the server and the PNG and PDF are identical.
 */

const FONT_DIR = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));
const MM_TO_PT = 72 / 25.4;

type FKFont = fontkit.Font;
const fontCache = new Map<FontKey, FKFont>();

function loadFont(key: FontKey): FKFont {
  let f = fontCache.get(key);
  if (!f) {
    const def = FONTS[key];
    if (!def) throw new Error(`Unknown font ${key}`);
    f = fontkit.create(fs.readFileSync(path.join(FONT_DIR, def.file))) as FKFont;
    fontCache.set(key, f);
  }
  return f;
}

const NO_LIGATURES = { liga: false, clig: false, dlig: false } as unknown as string[];

/** Exact text width in mm using the real font metrics. */
export const measureMm: MeasureFn = (font, text, sizePt, tracking) => {
  if (!text) return 0;
  const f = loadFont(font);
  const run = f.layout(text, NO_LIGATURES);
  const sizeMm = sizePt * PT_TO_MM;
  return (run.advanceWidth * sizeMm) / f.unitsPerEm + trackingWidthMm(text, sizePt, tracking);
};

/** Vector outlines of a text element in its local box coordinates (mm, y down). */
function textPath(el: TextElement, row?: Record<string, string> | null): { d: string; overflow: boolean } {
  const fit = fitText(el, measureMm, row);
  const f = loadFont(el.font);
  const sizeMm = fit.fontSize * PT_TO_MM;
  const s = sizeMm / f.unitsPerEm;
  const lineH = sizeMm * LINE_HEIGHT;
  const blockH = fit.lines.length * lineH;
  const top = (el.h - blockH) / 2;
  const glyphH = (f.ascent - f.descent) * s;
  const trackMm = (fit.tracking / 1000) * sizeMm;
  let d = "";
  fit.lines.forEach((line, i) => {
    if (!line) return;
    const lineW = measureMm(el.font, line, fit.fontSize, fit.tracking);
    let x = el.align === "center" ? (el.w - lineW) / 2 : el.align === "right" ? el.w - lineW : 0;
    const baseline = top + i * lineH + (lineH - glyphH) / 2 + f.ascent * s;
    const run = f.layout(line, NO_LIGATURES);
    run.glyphs.forEach((g, gi) => {
      const pos = run.positions[gi];
      const p = g.path.scale(s, -s).translate(x + pos.xOffset * s, baseline - pos.yOffset * s);
      d += p.toSVG();
      x += pos.xAdvance * s + trackMm;
    });
  });
  return { d, overflow: fit.overflow };
}

// --------------------------------------------------------------- images

export interface RasterImage {
  png: Buffer;
  width: number;
  height: number;
  /** Original vector PDF (uploaded PDF/AI artwork) — embedded as vector in print PDFs. */
  pdf?: Buffer | null;
}
export type ImageMap = Map<string, RasterImage>;

/** Where an image sits inside its box for contain / cover. */
function imagePlacement(el: ImageElement, img: RasterImage) {
  const ar = img.width / img.height;
  const boxAr = el.w / el.h;
  const containWide = ar > boxAr;
  const useWidth = el.fit === "contain" ? containWide : !containWide;
  const w = useWidth ? el.w : el.h * ar;
  const h = useWidth ? el.w / ar : el.h;
  return { x: (el.w - w) / 2, y: (el.h - h) / 2, w, h };
}

// ------------------------------------------------------------------ SVG

const HEX = /^#[0-9a-fA-F]{6}$/;
const color = (c: string | null | undefined, fallback = "none") => (c && HEX.test(c) ? c : fallback);
const n = (v: number) => Math.round(v * 1000) / 1000;

export interface SvgOptions {
  images: ImageMap;
  row?: Record<string, string> | null;
  /** Draw trim line, safe area and dim the bleed (proof previews only). */
  guides?: boolean;
  /** Include the bleed margin (print output, proofs). */
  bleed?: boolean;
  /** For PDF artwork that can't be rasterised: show a labelled placeholder. */
  placeholderLabel?: string;
}

function elementSvg(el: DesignElement, opts: SvgOptions): string {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const t = `translate(${n(cx)} ${n(cy)}) rotate(${n(el.rotation)}) translate(${n(-el.w / 2)} ${n(-el.h / 2)})`;
  let inner = "";
  if (el.type === "text") {
    inner = `<path d="${textPath(el, opts.row).d}" fill="${color(el.color, "#000000")}"/>`;
  } else if (el.type === "rect") {
    const sw = el.stroke ? el.strokeWidth : 0;
    inner = `<rect x="${n(sw / 2)}" y="${n(sw / 2)}" width="${n(Math.max(0, el.w - sw))}" height="${n(Math.max(0, el.h - sw))}" rx="${n(el.radius || 0)}" fill="${color(el.fill)}" stroke="${color(el.stroke)}" stroke-width="${n(sw)}"/>`;
  } else if (el.type === "ellipse") {
    const sw = el.stroke ? el.strokeWidth : 0;
    inner = `<ellipse cx="${n(el.w / 2)}" cy="${n(el.h / 2)}" rx="${n(Math.max(0, el.w / 2 - sw / 2))}" ry="${n(Math.max(0, el.h / 2 - sw / 2))}" fill="${color(el.fill)}" stroke="${color(el.stroke)}" stroke-width="${n(sw)}"/>`;
  } else if (el.type === "image") {
    const img = opts.images.get(el.assetId);
    if (img) {
      const p = imagePlacement(el, img);
      inner = `<svg x="0" y="0" width="${n(el.w)}" height="${n(el.h)}" viewBox="0 0 ${n(el.w)} ${n(el.h)}" overflow="hidden"><image x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="none" href="data:image/png;base64,${img.png.toString("base64")}"/></svg>`;
    } else {
      inner = `<rect width="${n(el.w)}" height="${n(el.h)}" fill="#EEEEEE" stroke="#999999" stroke-width="0.3" stroke-dasharray="1 1"/>`;
    }
  }
  return `<g transform="${t}">${inner}</g>`;
}

export function designToSvg(design: Design, spec: PrintSpec, opts: SvgOptions): string {
  const b = opts.bleed === false ? 0 : spec.bleedMm;
  const W = design.widthMm + 2 * b;
  const H = design.heightMm + 2 * b;
  let body = `<rect width="${n(W)}" height="${n(H)}" fill="${color(design.background, "#FFFFFF")}"/>`;
  body += `<g transform="translate(${n(b)} ${n(b)})">${design.elements.map((el) => elementSvg(el, opts)).join("")}</g>`;
  if (opts.placeholderLabel) {
    body += `<text x="${n(W / 2)}" y="${n(H / 2)}" font-family="sans-serif" font-size="${n(Math.min(W, H) / 12)}" text-anchor="middle" fill="#555555">${opts.placeholderLabel}</text>`;
  }
  if (opts.guides) {
    const area = printArea(design, spec);
    const lw = Math.max(0.2, Math.min(W, H) / 400);
    // dim the bleed that will be trimmed off
    body += `<path fill-rule="evenodd" fill="#FFFFFF" fill-opacity="0.55" d="M0 0H${n(W)}V${n(H)}H0Z M${n(b)} ${n(b)}V${n(b + design.heightMm)}H${n(b + design.widthMm)}V${n(b)}Z"/>`;
    body += `<rect x="${n(b)}" y="${n(b)}" width="${n(design.widthMm)}" height="${n(design.heightMm)}" fill="none" stroke="#E4007C" stroke-width="${n(lw)}" rx="${n(spec.cornerRadiusMm || 0)}"/>`;
    body += `<rect x="${n(b + area.x)}" y="${n(b + area.y)}" width="${n(area.w)}" height="${n(area.h)}" fill="none" stroke="#00A0E3" stroke-width="${n(lw)}" stroke-dasharray="${n(lw * 4)} ${n(lw * 3)}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(W)}mm" height="${n(H)}mm" viewBox="0 0 ${n(W)} ${n(H)}">${body}</svg>`;
}

/** Rasterises a design. `dpi` defaults to the product's production DPI. */
export async function designToPng(design: Design, spec: PrintSpec, opts: SvgOptions & { dpi?: number; maxPx?: number }): Promise<Buffer> {
  const svg = designToSvg(design, spec, opts);
  const b = opts.bleed === false ? 0 : spec.bleedMm;
  const longestIn = Math.max(design.widthMm + 2 * b, design.heightMm + 2 * b) / 25.4;
  let dpi = opts.dpi ?? spec.dpi;
  if (opts.maxPx) dpi = Math.min(dpi, opts.maxPx / longestIn);
  return sharp(Buffer.from(svg), { density: Math.max(10, dpi), limitInputPixels: false })
    .flatten({ background: "#FFFFFF" })
    .png({ compressionLevel: 9 })
    .withMetadata({ density: Math.round(dpi) })
    .toBuffer();
}

// ------------------------------------------------------------------ PDF

function hexToRgb(hex: string) {
  const h = HEX.test(hex) ? hex : "#000000";
  return rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
}

function roundedRectPath(w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${rr} 0H${w - rr}A${rr} ${rr} 0 0 1 ${w} ${rr}V${h - rr}A${rr} ${rr} 0 0 1 ${w - rr} ${h}H${rr}A${rr} ${rr} 0 0 1 0 ${h - rr}V${rr}A${rr} ${rr} 0 0 1 ${rr} 0Z`;
}

async function drawDesignPage(
  pdf: PDFDocument,
  design: Design,
  spec: PrintSpec,
  images: Map<string, EmbeddedImage>,
  row: Record<string, string> | null,
): Promise<PDFPage> {
  const b = spec.bleedMm;
  const Wmm = design.widthMm + 2 * b;
  const Hmm = design.heightMm + 2 * b;
  const page = pdf.addPage([Wmm * MM_TO_PT, Hmm * MM_TO_PT]);
  page.setBleedBox(0, 0, Wmm * MM_TO_PT, Hmm * MM_TO_PT);
  page.setTrimBox(b * MM_TO_PT, b * MM_TO_PT, design.widthMm * MM_TO_PT, design.heightMm * MM_TO_PT);
  page.drawRectangle({ x: 0, y: 0, width: Wmm * MM_TO_PT, height: Hmm * MM_TO_PT, color: hexToRgb(design.background || "#FFFFFF") });


  for (const el of design.elements) {
    const cx = (b + el.x + el.w / 2) * MM_TO_PT;
    const cy = (Hmm - (b + el.y + el.h / 2)) * MM_TO_PT;
    // Local space: origin at the element's top-left corner, mm units, y up.
    page.pushOperators(
      pushGraphicsState(),
      translate(cx, cy),
      rotateDegrees(-el.rotation),
      translate((-el.w / 2) * MM_TO_PT, (el.h / 2) * MM_TO_PT),
      scale(MM_TO_PT, MM_TO_PT),
    );
    if (el.type === "text") {
      const { d } = textPath(el, row);
      if (d) page.drawSvgPath(d, { x: 0, y: 0, color: hexToRgb(el.color) });
    } else if (el.type === "rect" || el.type === "ellipse") {
      const sw = el.stroke ? el.strokeWidth : 0;
      const fill = el.fill && HEX.test(el.fill) ? hexToRgb(el.fill) : undefined;
      const stroke = el.stroke && HEX.test(el.stroke) ? hexToRgb(el.stroke) : undefined;
      if (el.type === "ellipse") {
        page.drawEllipse({
          x: el.w / 2,
          y: -el.h / 2,
          xScale: Math.max(0, el.w / 2 - sw / 2),
          yScale: Math.max(0, el.h / 2 - sw / 2),
          color: fill,
          borderColor: stroke,
          borderWidth: stroke ? sw : 0,
        });
      } else {
        // inset by half the stroke so the border stays inside the box (matches the SVG)
        page.pushOperators(pushGraphicsState(), translate(sw / 2, -sw / 2));
        page.drawSvgPath(roundedRectPath(Math.max(0, el.w - sw), Math.max(0, el.h - sw), el.radius || 0), {
          x: 0,
          y: 0,
          color: fill,
          borderColor: stroke,
          borderWidth: stroke ? sw : 0,
        });
        page.pushOperators(popGraphicsState());
      }
    } else if (el.type === "image") {
      const entry = images.get(el.assetId);
      if (entry) {
        const p = imagePlacement(el, entry.raster);
        page.pushOperators(rectangle(0, -el.h, el.w, el.h), clip(), endPath());
        if (entry.pdfPage) page.drawPage(entry.pdfPage, { x: p.x, y: -(p.y + p.h), width: p.w, height: p.h });
        else if (entry.img) page.drawImage(entry.img, { x: p.x, y: -(p.y + p.h), width: p.w, height: p.h });
      }
    }
    page.pushOperators(popGraphicsState());
  }
  return page;
}

export interface PdfOptions {
  images: ImageMap;
  rows?: Record<string, string>[] | null;
  title?: string;
}

interface EmbeddedImage {
  raster: RasterImage;
  img?: Awaited<ReturnType<PDFDocument["embedPng"]>>;
  pdfPage?: Awaited<ReturnType<PDFDocument["embedPdf"]>>[number];
}

/** Print-ready vector PDF. One page per CSV row when rows are given. */
export async function designToPdf(design: Design, spec: PrintSpec, opts: PdfOptions): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(opts.title || "Digital Heroes print file");
  pdf.setCreator("Digital Heroes print engine");
  pdf.setProducer("Digital Heroes");
  const embedded = new Map<string, EmbeddedImage>();
  const used = new Set(design.elements.filter((e) => e.type === "image").map((e) => (e as ImageElement).assetId));
  for (const [id, raster] of opts.images) {
    if (!used.has(id)) continue;
    if (raster.pdf) {
      const [pdfPage] = await pdf.embedPdf(raster.pdf, [0]);
      embedded.set(id, { raster, pdfPage });
    } else {
      embedded.set(id, { raster, img: await pdf.embedPng(raster.png) });
    }
  }
  const rows = opts.rows && opts.rows.length ? opts.rows : [null];
  for (const row of rows) await drawDesignPage(pdf, design, spec, embedded, row);
  return Buffer.from(await pdf.save());
}

/** Reads the first page size (mm) of a PDF — validates uploaded PDF/AI artwork. */
export async function inspectPdf(bytes: Buffer): Promise<{ widthMm: number; heightMm: number; pages: number }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  const page = doc.getPage(0);
  const box = page.getTrimBox?.() ?? page.getMediaBox();
  return { widthMm: box.width / MM_TO_PT, heightMm: box.height / MM_TO_PT, pages: doc.getPageCount() };
}
