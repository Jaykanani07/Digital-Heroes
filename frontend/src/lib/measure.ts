"use client";

import { FONTS, PT_TO_MM, trackingWidthMm, type FontKey, type MeasureFn } from "@/shared/design";

/**
 * Browser-side text metrics for the designer's live fit preview. The
 * server re-checks every design with the real font files, so this only has
 * to be close — the proof is always rendered by the server.
 */
const SCALE = 20; // measure at 20 px per mm for sub-pixel precision
let ctx: CanvasRenderingContext2D | null = null;

function context() {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  return ctx!;
}

export function cssFont(font: FontKey, sizeMm: number) {
  const f = FONTS[font];
  return `${f.weight} ${sizeMm}px "${f.family}"`;
}

export const measureMm: MeasureFn = (font, text, sizePt, tracking) => {
  if (!text) return 0;
  const c = context();
  const sizeMm = sizePt * PT_TO_MM;
  c.font = cssFont(font, sizeMm * SCALE);
  return c.measureText(text).width / SCALE + trackingWidthMm(text, sizePt, tracking);
};

const metricCache = new Map<string, { ascent: number; descent: number }>();

/** Ascent/descent as fractions of the font size (em), like the font's hhea table. */
export function fontMetrics(font: FontKey): { ascent: number; descent: number } {
  const hit = metricCache.get(font);
  if (hit) return hit;
  const c = context();
  c.font = cssFont(font, 100);
  const m = c.measureText("Hg");
  const r = { ascent: (m.fontBoundingBoxAscent || 80) / 100, descent: (m.fontBoundingBoxDescent || 20) / 100 };
  if (fontsReady) metricCache.set(font, r);
  return r;
}

let fontsReady = false;
let loading: Promise<void> | null = null;

/** Loads every designer font from Google Fonts before measuring. */
export function loadDesignerFonts(): Promise<void> {
  if (loading) return loading;
  const families = new Map<string, Set<number>>();
  for (const f of Object.values(FONTS)) {
    if (!families.has(f.family)) families.set(f.family, new Set());
    families.get(f.family)!.add(f.weight);
  }
  const query = [...families]
    .map(([fam, w]) => `family=${encodeURIComponent(fam).replace(/%20/g, "+")}:wght@${[...w].sort().join(";")}`)
    .join("&");
  const href = `https://fonts.googleapis.com/css2?${query}&display=block`;
  if (!document.querySelector(`link[data-designer-fonts]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.designerFonts = "1";
    document.head.appendChild(link);
  }
  loading = (async () => {
    await new Promise((r) => setTimeout(r, 50));
    await Promise.all(
      Object.values(FONTS).map((f) => document.fonts.load(`${f.weight} 40px "${f.family}"`).catch(() => undefined)),
    );
    await document.fonts.ready;
    fontsReady = true;
    metricCache.clear();
  })();
  return loading;
}
