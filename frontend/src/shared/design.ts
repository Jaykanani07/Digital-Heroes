/**
 * Shared design model — used by BOTH the backend renderer and the frontend
 * designer. This file is copied verbatim to frontend/src/shared/design.ts
 * (run `npm run sync:shared` in /backend after editing). It must stay free of
 * Node or browser APIs.
 *
 * Units: every position and size is in millimetres, relative to the TRIM
 * (finished) size. Font sizes are in points. Tracking is in 1/1000 em.
 */

export const PT_TO_MM = 25.4 / 72;
export const LINE_HEIGHT = 1.15;

/** Fonts the designer offers. Each key maps to one TTF face on the server. */
export const FONTS = {
  "schibsted-400": { label: "Schibsted Grotesk", family: "Schibsted Grotesk", weight: 400, file: "SchibstedGrotesk_400Regular.ttf" },
  "schibsted-700": { label: "Schibsted Grotesk Bold", family: "Schibsted Grotesk", weight: 700, file: "SchibstedGrotesk_700Bold.ttf" },
  "darker-900": { label: "Darker Grotesque Black", family: "Darker Grotesque", weight: 900, file: "DarkerGrotesque_900Black.ttf" },
  "inter-400": { label: "Inter", family: "Inter", weight: 400, file: "Inter_400Regular.ttf" },
  "inter-700": { label: "Inter Bold", family: "Inter", weight: 700, file: "Inter_700Bold.ttf" },
  "oswald-600": { label: "Oswald", family: "Oswald", weight: 600, file: "Oswald_600SemiBold.ttf" },
  "bebas-400": { label: "Bebas Neue", family: "Bebas Neue", weight: 400, file: "BebasNeue_400Regular.ttf" },
  "robotoslab-700": { label: "Roboto Slab Bold", family: "Roboto Slab", weight: 700, file: "RobotoSlab_700Bold.ttf" },
  "archivo-400": { label: "Archivo Black", family: "Archivo Black", weight: 400, file: "ArchivoBlack_400Regular.ttf" },
  "pacifico-400": { label: "Pacifico (script)", family: "Pacifico", weight: 400, file: "Pacifico_400Regular.ttf" },
} as const;

export type FontKey = keyof typeof FONTS;
export const FONT_KEYS = Object.keys(FONTS) as FontKey[];

interface BaseElement {
  id: string;
  /** Top-left corner of the un-rotated box, mm from trim top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Clockwise rotation in degrees around the box centre. */
  rotation: number;
  name?: string;
  locked?: boolean;
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  font: FontKey;
  /** Desired (maximum) font size in pt. */
  fontSize: number;
  /** Smallest size shrink-to-fit may use, in pt. */
  minFontSize: number;
  /** Desired tracking (1/1000 em). */
  tracking: number;
  /** Tightest tracking shrink-to-fit may use (1/1000 em). */
  minTracking: number;
  /** "shrink": reduce size, then tracking, until the text fits its box. */
  fit: "shrink" | "none";
  color: string;
  align: "left" | "center" | "right";
  /** Variable-data merge: CSV column whose value replaces `text` per row. */
  bindColumn?: string | null;
}

export interface ImageElement extends BaseElement {
  type: "image";
  assetId: string;
  fit: "contain" | "cover";
  /** Uploaded finished artwork may fill the whole trim area. */
  isArtwork?: boolean;
}

export interface ShapeElement extends BaseElement {
  type: "rect" | "ellipse";
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  radius?: number;
}

export type DesignElement = TextElement | ImageElement | ShapeElement;

export interface Design {
  version: 1;
  widthMm: number;
  heightMm: number;
  background: string;
  elements: DesignElement[];
}

export interface PrintSpec {
  bleedMm: number;
  safeMm: number;
  dpi: number;
  cornerRadiusMm?: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The printable zone: trim size inset by the product's safe margin. */
export function printArea(design: Pick<Design, "widthMm" | "heightMm">, spec: PrintSpec): Rect {
  const s = Math.max(0, spec.safeMm);
  return { x: s, y: s, w: design.widthMm - 2 * s, h: design.heightMm - 2 * s };
}

/** Axis-aligned bounding box of an element after rotation. */
export function elementBounds(el: Pick<BaseElement, "x" | "y" | "w" | "h" | "rotation">): Rect {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const r = (el.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  const bw = el.w * cos + el.h * sin;
  const bh = el.w * sin + el.h * cos;
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

const EPS = 0.05; // mm tolerance for floating point

export function isInside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.x + inner.w <= outer.x + outer.w + EPS &&
    inner.y + inner.h <= outer.y + outer.h + EPS
  );
}

/** The area an element is allowed to occupy. Finished artwork may fill the trim. */
export function allowedArea(el: DesignElement, design: Design, spec: PrintSpec): Rect {
  if (el.type === "image" && el.isArtwork) return { x: 0, y: 0, w: design.widthMm, h: design.heightMm };
  return printArea(design, spec);
}

/** Moves an element (without resizing) so it sits inside the allowed area if possible. */
export function clampPosition<T extends DesignElement>(el: T, area: Rect): T {
  const b = elementBounds(el);
  let dx = 0;
  let dy = 0;
  if (b.w <= area.w + EPS) {
    if (b.x < area.x) dx = area.x - b.x;
    else if (b.x + b.w > area.x + area.w) dx = area.x + area.w - (b.x + b.w);
  }
  if (b.h <= area.h + EPS) {
    if (b.y < area.y) dy = area.y - b.y;
    else if (b.y + b.h > area.y + area.h) dy = area.y + area.h - (b.y + b.h);
  }
  return { ...el, x: el.x + dx, y: el.y + dy };
}

// ------------------------------------------------------------ text fitting

/** Measures the advance width of `text` in mm at `sizePt` with `tracking`. */
export type MeasureFn = (font: FontKey, text: string, sizePt: number, tracking: number) => number;

export interface FitResult {
  fontSize: number;
  tracking: number;
  overflow: boolean;
  lines: string[];
}

export function resolveText(el: TextElement, row?: Record<string, string> | null): string {
  if (row && el.bindColumn && row[el.bindColumn] !== undefined) return String(row[el.bindColumn]);
  return el.text;
}

/** Tracking adds space between characters: (n-1) gaps of tracking/1000 em. */
export function trackingWidthMm(text: string, sizePt: number, tracking: number): number {
  const n = Array.from(text).length;
  return n > 1 ? ((n - 1) * tracking * sizePt * PT_TO_MM) / 1000 : 0;
}

/**
 * Per-placeholder fitting rules (§04 / §07): try the desired size, then
 * shrink-to-fit down to the minimum size, then tighten horizontal tracking
 * down to the minimum tracking. If it still does not fit, report overflow —
 * the designer blocks it and the server rejects it.
 */
export function fitText(el: TextElement, measure: MeasureFn, row?: Record<string, string> | null): FitResult {
  const lines = resolveText(el, row).split("\n");
  const fits = (size: number, tracking: number) => {
    const lineH = size * PT_TO_MM * LINE_HEIGHT;
    if (lines.length * lineH > el.h + EPS) return false;
    for (const line of lines) {
      if (measure(el.font, line, size, tracking) > el.w + EPS) return false;
    }
    return true;
  };

  const max = el.fontSize;
  if (fits(max, el.tracking)) return { fontSize: max, tracking: el.tracking, overflow: false, lines };
  if (el.fit === "none") return { fontSize: max, tracking: el.tracking, overflow: true, lines };

  const min = Math.min(el.minFontSize, max);
  for (let s = max - 0.25; s >= min - 1e-9; s -= 0.25) {
    if (fits(s, el.tracking)) return { fontSize: round2(s), tracking: el.tracking, overflow: false, lines };
  }
  const minT = Math.min(el.minTracking, el.tracking);
  for (let t = el.tracking - 5; t >= minT - 1e-9; t -= 5) {
    if (fits(min, t)) return { fontSize: min, tracking: t, overflow: false, lines };
  }
  return { fontSize: min, tracking: minT, overflow: true, lines };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ------------------------------------------------------------- validation

export interface DesignIssue {
  elementId: string | null;
  message: string;
}

/**
 * Checks that nothing unprintable can be produced: every element inside its
 * allowed area and every text fitting its box (for every CSV row if given).
 */
export function validateDesign(
  design: Design,
  spec: PrintSpec,
  measure: MeasureFn,
  rows?: Record<string, string>[] | null,
): DesignIssue[] {
  const issues: DesignIssue[] = [];
  if (!(design.widthMm > 0 && design.heightMm > 0)) issues.push({ elementId: null, message: "Design has no size." });
  if (design.elements.length > 60) issues.push({ elementId: null, message: "Too many elements (max 60)." });
  for (const el of design.elements) {
    if (!(el.w > 0 && el.h > 0)) {
      issues.push({ elementId: el.id, message: "Element has no size." });
      continue;
    }
    if (!isInside(elementBounds(el), allowedArea(el, design, spec))) {
      issues.push({ elementId: el.id, message: `"${label(el)}" goes outside the printable area.` });
    }
    if (el.type === "text") {
      if (!(el.font in FONTS)) issues.push({ elementId: el.id, message: `Unknown font on "${label(el)}".` });
      else if (rows && rows.length && el.bindColumn) {
        const bad = rows.findIndex((r) => fitText(el, measure, r).overflow);
        if (bad >= 0) issues.push({ elementId: el.id, message: `CSV row ${bad + 1} is too long for "${label(el)}" even at the minimum size.` });
      } else if (fitText(el, measure).overflow) {
        issues.push({ elementId: el.id, message: `"${label(el)}" doesn't fit its box even at the minimum size.` });
      }
    }
  }
  return issues;
}

function label(el: DesignElement) {
  if (el.name) return el.name;
  if (el.type === "text") return el.text.slice(0, 24) || "Text";
  return el.type === "image" ? "Image" : "Shape";
}

// ---------------------------------------------------------- scaling / ids

/**
 * Re-fits a design to a new trim size (dynamic sizing / templates authored at
 * a base size). Positions scale per axis, font sizes by the smaller ratio.
 */
export function scaleDesign(design: Design, widthMm: number, heightMm: number, safeMm = 0): Design {
  // Scale the printable zone onto the new printable zone so safe margins stay
  // exactly the same size (positions inside the zone scale proportionally).
  const s = Math.max(0, Math.min(safeMm, design.widthMm / 4, design.heightMm / 4, widthMm / 4, heightMm / 4));
  const sx = (widthMm - 2 * s) / (design.widthMm - 2 * s);
  const sy = (heightMm - 2 * s) / (design.heightMm - 2 * s);
  const sf = Math.min(sx, sy);
  const tx = (x: number) => s + (x - s) * sx;
  const ty = (y: number) => s + (y - s) * sy;
  return {
    ...design,
    widthMm,
    heightMm,
    elements: design.elements.map((el) => {
      if (el.type === "image" && el.isArtwork) {
        return { ...el, x: 0, y: 0, w: widthMm, h: heightMm };
      }
      const base = { ...el, x: tx(el.x), y: ty(el.y), w: el.w * sx, h: el.h * sy };
      if (el.type === "text") {
        return { ...base, fontSize: round2(el.fontSize * sf), minFontSize: round2(Math.max(4, el.minFontSize * sf)) } as TextElement;
      }
      if (el.type === "image" && !el.isArtwork) {
        // keep logos undistorted: shrink the box to the smaller ratio around its centre
        const w = el.w * sf;
        const h = el.h * sf;
        return { ...base, x: base.x + (base.w - w) / 2, y: base.y + (base.h - h) / 2, w, h } as ImageElement;
      }
      if (el.type === "rect" || el.type === "ellipse") {
        return { ...base, strokeWidth: el.strokeWidth * sf, radius: el.radius ? el.radius * sf : el.radius } as ShapeElement;
      }
      return base as DesignElement;
    }),
  };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyDesign(widthMm: number, heightMm: number): Design {
  return { version: 1, widthMm, heightMm, background: "#FFFFFF", elements: [] };
}

/** Column names a design binds to (for CSV merge). */
export function boundColumns(design: Design): string[] {
  const cols = new Set<string>();
  for (const el of design.elements) if (el.type === "text" && el.bindColumn) cols.add(el.bindColumn);
  return [...cols];
}

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
