import { createRequire } from "node:module";
import path from "node:path";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";

// pdf.js polyfills these from its own (older) nested copy of @napi-rs/canvas,
// whose objects our canvas doesn't accept. Provide ours before pdf.js loads.
const g = globalThis as Record<string, unknown>;
g.DOMMatrix ??= DOMMatrix;
g.ImageData ??= ImageData;
g.Path2D ??= Path2D;

/**
 * Rasterises page 1 of a PDF (uploaded PDF / PDF-compatible AI artwork) to
 * PNG so it can be shown in proofs and used for the PNG print output. The
 * print PDF keeps the original vector artwork.
 */
const require = createRequire(import.meta.url);
const pdfjsDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
const STANDARD_FONTS = path.join(pdfjsDir, "standard_fonts") + path.sep;

let pdfjsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;
const loadPdfjs = () => (pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs"));

/**
 * pdf.js creates scratch canvases (for images, patterns, masks). Make it use
 * the same @napi-rs/canvas build as the page canvas — mixing two native
 * builds crashes the process when one is drawn onto the other.
 */
class SameCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(cc: { canvas: { width: number; height: number } }, width: number, height: number) {
    cc.canvas.width = Math.max(1, Math.ceil(width));
    cc.canvas.height = Math.max(1, Math.ceil(height));
  }
  destroy(cc: { canvas: { width: number; height: number } | null; context: unknown }) {
    if (cc.canvas) {
      cc.canvas.width = 0;
      cc.canvas.height = 0;
    }
    cc.canvas = null;
    cc.context = null;
  }
}

export async function rasterizePdf(bytes: Buffer, maxPx = 3000): Promise<{ png: Buffer; width: number; height: number }> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    standardFontDataUrl: STANDARD_FONTS,
    isEvalSupported: false,
    useSystemFonts: false,
    CanvasFactory: SameCanvasFactory,
  } as Parameters<typeof pdfjs.getDocument>[0]).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(300 / 72, maxPx / Math.max(base.width, base.height));
    const vp = page.getViewport({ scale });
    const width = Math.max(1, Math.round(vp.width));
    const height = Math.max(1, Math.round(vp.height));
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    // pdf.js accepts any CanvasRenderingContext2D-compatible object
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: vp }).promise;
    return { png: canvas.toBuffer("image/png"), width, height };
  } finally {
    await doc.destroy();
  }
}
