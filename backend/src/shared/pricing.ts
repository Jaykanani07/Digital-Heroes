/**
 * Shared pricing engine — the SAME code runs in the browser (instant price
 * calculator) and on the server (authoritative price when an order is
 * created). Copied verbatim to frontend/src/shared/pricing.ts via
 * `npm run sync:shared`. No Node or browser APIs here.
 *
 * Model (all product prices are net of VAT, GBP):
 *   area           = width × height  (cm²)
 *   unit price     = max(minUnit, baseUnit + area × perCm2) × material multiplier
 *   volume discount= highest tier whose min quantity ≤ quantity (auto-applied)
 *   subtotal       = unit × qty − discount + setup fee
 *   VAT            = subtotal × VAT rate      → total is VAT-inclusive
 * Money is calculated in integer pence to avoid floating-point drift.
 */

export interface ProductPricing {
  baseUnit: number;
  perCm2: number;
  minUnit: number;
  setupFee?: number;
}

export interface MaterialOption {
  key: string;
  label: string;
  multiplier: number;
  description?: string;
}

export interface SizePreset {
  label: string;
  w: number;
  h: number;
}

export interface SizeLimits {
  allowCustom: boolean;
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
}

export interface QuantityLimits {
  min: number;
  max: number;
  step: number;
}

export interface DiscountTier {
  minQty: number;
  discountPct: number;
}

export type Orientation = "portrait" | "landscape";

export interface ProductConfig {
  /** Finished width/height in mm, already oriented. */
  widthMm: number;
  heightMm: number;
  material: string;
  orientation: Orientation;
  quantity: number;
  sizeLabel?: string | null;
}

export interface PricingProduct {
  pricing: ProductPricing;
  materials: MaterialOption[];
  sizes: SizePreset[];
  size_limits: SizeLimits;
  quantity_limits: QuantityLimits;
  orientations: Orientation[];
}

export interface Quote {
  quantity: number;
  areaCm2: number;
  unitNet: number; // before discount
  unitNetDiscounted: number;
  discountPct: number;
  grossPence: number;
  discountPence: number;
  setupPence: number;
  subtotalPence: number;
  vatRate: number;
  vatPence: number;
  totalPence: number;
  unitIncVat: number; // effective unit price, VAT inclusive, after discount
  nextTier: DiscountTier | null;
}

export function pickTier(tiers: DiscountTier[], quantity: number): DiscountTier | null {
  let best: DiscountTier | null = null;
  for (const t of tiers) if (quantity >= t.minQty && (!best || t.minQty > best.minQty)) best = t;
  return best;
}

export function calculateQuote(product: PricingProduct, tiers: DiscountTier[], config: ProductConfig, vatRate: number): Quote {
  const material = product.materials.find((m) => m.key === config.material);
  const multiplier = material ? material.multiplier : 1;
  const areaCm2 = (config.widthMm * config.heightMm) / 100;
  const p = product.pricing;
  const unitNet = round4(Math.max(p.minUnit, p.baseUnit + areaCm2 * p.perCm2) * multiplier);

  const qty = Math.max(0, Math.floor(config.quantity));
  const tier = pickTier(tiers, qty);
  const discountPct = tier ? tier.discountPct : 0;

  const grossPence = Math.round(unitNet * qty * 100);
  const discountPence = Math.round((grossPence * discountPct) / 100);
  const setupPence = Math.round((p.setupFee || 0) * 100);
  const subtotalPence = grossPence - discountPence + setupPence;
  const vatPence = Math.round(subtotalPence * vatRate);
  const totalPence = subtotalPence + vatPence;

  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  const nextTier = sorted.find((t) => t.minQty > qty && t.discountPct > discountPct) || null;

  return {
    quantity: qty,
    areaCm2: round4(areaCm2),
    unitNet,
    unitNetDiscounted: round4(unitNet * (1 - discountPct / 100)),
    discountPct,
    grossPence,
    discountPence,
    setupPence,
    subtotalPence,
    vatRate,
    vatPence,
    totalPence,
    unitIncVat: qty > 0 ? round4(totalPence / 100 / qty) : 0,
    nextTier,
  };
}

/** Returns a list of human-readable problems with a configuration (empty = valid). */
export function validateConfig(product: PricingProduct, config: ProductConfig): string[] {
  const errors: string[] = [];
  const q = product.quantity_limits;
  if (!Number.isInteger(config.quantity)) errors.push("Quantity must be a whole number.");
  else if (config.quantity < q.min) errors.push(`Minimum quantity is ${q.min}.`);
  else if (config.quantity > q.max) errors.push(`Maximum quantity is ${q.max}.`);
  else if (q.step > 1 && config.quantity % q.step !== 0) errors.push(`Quantity must be a multiple of ${q.step}.`);

  if (!product.materials.some((m) => m.key === config.material)) errors.push("Choose a material.");
  if (!product.orientations.includes(config.orientation)) errors.push("That orientation isn't available.");

  const w = config.widthMm;
  const h = config.heightMm;
  if (!(w > 0 && h > 0)) {
    errors.push("Enter a size.");
    return errors;
  }
  const isPreset = product.sizes.some(
    (s) => (approx(s.w, w) && approx(s.h, h)) || (approx(s.w, h) && approx(s.h, w)),
  );
  if (!isPreset) {
    const L = product.size_limits;
    if (!L.allowCustom) errors.push("Choose one of the available sizes.");
    else {
      // limits are orientation-agnostic: compare the short and long sides
      const shortSide = Math.min(w, h);
      const longSide = Math.max(w, h);
      const minS = Math.min(L.minW, L.minH);
      const maxL = Math.max(L.maxW, L.maxH);
      const maxS = Math.min(L.maxW, L.maxH);
      if (shortSide < minS) errors.push(`Smallest side is ${minS} mm.`);
      if (longSide > maxL) errors.push(`Largest side is ${maxL} mm.`);
      if (shortSide > maxS) errors.push(`Shortest side can be at most ${maxS} mm.`);
    }
  }
  return errors;
}

/** Applies orientation to a preset (presets are stored portrait / as authored). */
export function orient(w: number, h: number, orientation: Orientation): { w: number; h: number } {
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  return orientation === "landscape" ? { w: long, h: short } : { w: short, h: long };
}

export function formatMoney(pence: number, currency = "INR"): string {
  const locale = currency === "INR" ? "en-IN" : "en-GB";
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(pence / 100);
}

/** Unit prices can be fractions of a rupee/penny — show 3 dp under 1 unit. */
export function formatUnit(amount: number, currency = "INR"): string {
  const locale = currency === "INR" ? "en-IN" : "en-GB";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: amount < 1 ? 3 : 2,
    maximumFractionDigits: amount < 1 ? 3 : 2,
  }).format(amount);
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

function approx(a: number, b: number) {
  return Math.abs(a - b) < 0.01;
}
