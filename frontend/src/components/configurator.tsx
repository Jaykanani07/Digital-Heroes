"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, RotateCcw, Tag } from "lucide-react";
import {
  calculateQuote,
  orient,
  validateConfig,
  formatMoney,
  formatUnit,
  type Orientation,
  type ProductConfig,
  type Quote,
} from "@/shared/pricing";
import type { Product } from "@/lib/types";
import { cx, mm } from "@/lib/format";
import { Alert, Field, Input } from "./ui";

export function defaultQuantity(p: Pick<Product, "quantity_limits">) {
  const q = p.quantity_limits;
  return q.min >= 10 ? Math.min(q.max, Math.max(q.min, 100)) : q.min;
}

export function defaultConfig(p: Product): ProductConfig {
  const orientation = p.orientations[0] || "portrait";
  const preset = p.sizes[0];
  const size = preset ? orient(preset.w, preset.h, orientation) : { w: p.size_limits.minW, h: p.size_limits.minH };
  return { widthMm: size.w, heightMm: size.h, material: p.materials[0]?.key || "", orientation, quantity: defaultQuantity(p), sizeLabel: preset?.label ?? null };
}

/** Finds which preset (if any) the config matches. */
function presetIndex(p: Product, c: ProductConfig) {
  return p.sizes.findIndex((s) => {
    const o = orient(s.w, s.h, c.orientation);
    return Math.abs(o.w - c.widthMm) < 0.01 && Math.abs(o.h - c.heightMm) < 0.01;
  });
}

interface Props {
  product: Product;
  config: ProductConfig;
  onChange: (c: ProductConfig) => void;
  /** CSV row count locks the quantity (one item per row). */
  lockedQuantity?: number | null;
  compact?: boolean;
}

/** Steps 01–03: size, material, quantity. Fully parameter-driven from the product row. */
export function Configurator({ product: p, config, onChange, lockedQuantity, compact }: Props) {
  const [custom, setCustom] = useState(() => presetIndex(p, config) < 0);
  const [qtyText, setQtyText] = useState(String(config.quantity));
  const [wText, setWText] = useState(mm(config.widthMm));
  const [hText, setHText] = useState(mm(config.heightMm));

  useEffect(() => setQtyText(String(lockedQuantity ?? config.quantity)), [config.quantity, lockedQuantity]);
  useEffect(() => {
    setWText(mm(config.widthMm));
    setHText(mm(config.heightMm));
  }, [config.widthMm, config.heightMm]);

  const set = (patch: Partial<ProductConfig>) => onChange({ ...config, ...patch });
  const isSquare = Math.abs(config.widthMm - config.heightMm) < 0.01;

  const choosePreset = (i: number) => {
    const s = p.sizes[i];
    const o = orient(s.w, s.h, config.orientation);
    setCustom(false);
    set({ widthMm: o.w, heightMm: o.h, sizeLabel: s.label });
  };

  const chooseOrientation = (o: Orientation) => {
    const long = Math.max(config.widthMm, config.heightMm);
    const short = Math.min(config.widthMm, config.heightMm);
    set({ orientation: o, widthMm: o === "landscape" ? long : short, heightMm: o === "landscape" ? short : long });
  };

  const commitCustom = (wRaw: string, hRaw: string) => {
    const w = parseFloat(wRaw);
    const h = parseFloat(hRaw);
    if (w > 0 && h > 0) set({ widthMm: Math.round(w * 10) / 10, heightMm: Math.round(h * 10) / 10, sizeLabel: null, orientation: w >= h ? (p.orientations.includes("landscape") ? "landscape" : config.orientation) : p.orientations.includes("portrait") ? "portrait" : config.orientation });
  };

  const commitQty = (raw: string) => {
    const q = parseInt(raw, 10);
    if (Number.isFinite(q) && q > 0) set({ quantity: q });
  };

  const sel = presetIndex(p, config);
  const L = p.size_limits;
  const stepCls = compact ? "space-y-3" : "space-y-3 border-b-[1.5px] border-ink/15 pb-6";

  return (
    <div className="space-y-6">
      <div className={stepCls}>
        <StepTitle n="01" title="Size" />
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Size">
          {p.sizes.map((s, i) => {
            const o = orient(s.w, s.h, config.orientation);
            return (
              <Choice key={s.label} selected={!custom && sel === i} onClick={() => choosePreset(i)}>
                <span className="font-bold">{s.label}</span>
                <span className="block text-[12px] text-steel">
                  {mm(o.w)} × {mm(o.h)} mm
                </span>
              </Choice>
            );
          })}
          {L.allowCustom && (
            <Choice selected={custom || sel < 0} onClick={() => setCustom(true)}>
              <span className="font-bold">Custom size</span>
              <span className="block text-[12px] text-steel">
                {Math.min(L.minW, L.minH)}–{Math.max(L.maxW, L.maxH)} mm
              </span>
            </Choice>
          )}
        </div>
        {L.allowCustom && (custom || sel < 0) && (
          <div className="grid max-w-sm grid-cols-2 gap-3">
            <Field label="Width (mm)">
              {(id) => (
                <Input id={id} inputMode="decimal" value={wText} onChange={(e) => setWText(e.target.value)} onBlur={() => commitCustom(wText, hText)} onKeyDown={(e) => e.key === "Enter" && commitCustom(wText, hText)} />
              )}
            </Field>
            <Field label="Height (mm)">
              {(id) => (
                <Input id={id} inputMode="decimal" value={hText} onChange={(e) => setHText(e.target.value)} onBlur={() => commitCustom(wText, hText)} onKeyDown={(e) => e.key === "Enter" && commitCustom(wText, hText)} />
              )}
            </Field>
          </div>
        )}
        {p.orientations.length > 1 && !isSquare && (
          <div className="flex gap-2" role="radiogroup" aria-label="Orientation">
            {p.orientations.map((o) => (
              <Choice key={o} selected={config.orientation === o} onClick={() => chooseOrientation(o)} small>
                <span className="flex items-center gap-2 font-bold capitalize">
                  <span className={cx("inline-block border-[1.5px] border-ink bg-white", o === "portrait" ? "h-4 w-3" : "h-3 w-4")} aria-hidden />
                  {o}
                </span>
              </Choice>
            ))}
          </div>
        )}
      </div>

      <div className={stepCls}>
        <StepTitle n="02" title="Material" />
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Material">
          {p.materials.map((m) => (
            <Choice key={m.key} selected={config.material === m.key} onClick={() => set({ material: m.key })} block>
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-bold">{m.label}</span>
                {m.multiplier !== 1 && <span className="text-[12px] font-bold text-steel">{m.multiplier > 1 ? `+${Math.round((m.multiplier - 1) * 100)}%` : `−${Math.round((1 - m.multiplier) * 100)}%`}</span>}
              </span>
              {m.description && <span className="block text-[12px] text-steel">{m.description}</span>}
            </Choice>
          ))}
        </div>
      </div>

      <div className={compact ? "space-y-3" : "space-y-3"}>
        <StepTitle n="03" title="Quantity" />
        {lockedQuantity ? (
          <Alert tone="info">
            Quantity is set by your CSV: <b>{lockedQuantity}</b> rows → {lockedQuantity} unique items.
          </Alert>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={`Units (${p.quantity_limits.min}–${p.quantity_limits.max.toLocaleString("en-GB")})`} className="w-40">
                {(id) => (
                  <Input
                    id={id}
                    inputMode="numeric"
                    value={qtyText}
                    onChange={(e) => {
                      setQtyText(e.target.value.replace(/[^0-9]/g, ""));
                      commitQty(e.target.value.replace(/[^0-9]/g, ""));
                    }}
                  />
                )}
              </Field>
              <div className="flex flex-wrap gap-1.5 pb-0.5">
                {quickQuantities(p).map((q) => (
                  <button key={q} type="button" onClick={() => set({ quantity: q })} className={cx("h-8 border-[1.5px] px-2.5 text-[13px] font-bold", config.quantity === q ? "border-ink bg-ink text-signal" : "border-ink/30 bg-white hover:border-ink")}>
                    {q.toLocaleString("en-GB")}
                  </button>
                ))}
              </div>
            </div>
            {p.supports_csv && <p className="text-[13px] text-steel">Numbering or personalising each item? Upload a CSV in the designer and the quantity follows your rows.</p>}
          </>
        )}
      </div>
    </div>
  );
}

function quickQuantities(p: Product) {
  const q = p.quantity_limits;
  const base = [q.min, ...p.tiers.map((t) => t.minQty)];
  if (q.min < 10) base.push(10, 25);
  return [...new Set(base)].filter((x) => x >= q.min && x <= q.max).sort((a, b) => a - b).slice(0, 6);
}

function StepTitle({ n, title }: { n: string; title: string }) {
  return (
    <h3 className="flex items-center gap-3">
      <span className="grid h-7 min-w-9 place-items-center bg-ink px-1.5 font-display text-xl text-signal">{n}</span>
      <span className="font-display text-3xl">{title}</span>
    </h3>
  );
}

function Choice({ selected, onClick, children, small, block }: { selected: boolean; onClick: () => void; children: React.ReactNode; small?: boolean; block?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cx(
        "border-[1.5px] text-left text-sm transition-[background-color,box-shadow] duration-150",
        small ? "px-3 py-2" : "px-3 py-2.5",
        block && "w-full",
        selected ? "border-ink bg-signal shadow-[3px_3px_0_0_var(--color-ink)]" : "border-ink/30 bg-white hover:border-ink",
      )}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------ price panel

export function useQuote(p: Product | null, c: ProductConfig | null) {
  return useMemo(() => {
    if (!p || !c) return { quote: null as Quote | null, errors: [] as string[] };
    return { quote: calculateQuote(p, p.tiers, c, p.vatRate), errors: validateConfig(p, c) };
  }, [p, c]);
}

/** Live instant price: updates on every option change, VAT-inclusive at a glance. */
export function PricePanel({ product: p, config, onQuantity, children }: { product: Product; config: ProductConfig; onQuantity?: (q: number) => void; children?: React.ReactNode }) {
  const { quote: q, errors } = useQuote(p, config);
  if (!q) return null;
  const cur = p.currency;
  const material = p.materials.find((m) => m.key === config.material);
  return (
    <div className="border-[1.5px] border-ink bg-ink text-paper">
      <div className="flex items-center justify-between border-b border-paper/15 px-4 py-2.5">
        <span className="label-caps text-signal">Instant price</span>
        <span className="text-[12px] text-paper/60">inc. GST {Math.round(p.vatRate * 100)}%</span>
      </div>
      <div className="space-y-4 p-4">
        <div>
          <p className="font-display text-6xl text-signal" aria-live="polite">
            <motion.span key={q.totalPence} className="inline-block" initial={{ y: 6, opacity: 0.4 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.15 }}>
              {formatMoney(q.totalPence, cur)}
            </motion.span>
          </p>
          <p className="mt-1 text-sm text-paper/80">
            {formatUnit(q.unitIncVat, cur)} each · {q.quantity.toLocaleString("en-GB")} units
          </p>
          <p className="text-[12px] text-paper/55">
            {mm(config.widthMm)} × {mm(config.heightMm)} mm · {material?.label}
          </p>
        </div>

        {errors.length > 0 && (
          <div className="border-[1.5px] border-signal bg-signal/10 p-2.5 text-[13px] text-signal" role="alert">
            {errors[0]}
          </div>
        )}

        <dl className="space-y-1 border-t border-paper/15 pt-3 text-[13px]">
          <Row k={`${q.quantity.toLocaleString("en-GB")} × ${formatUnit(q.unitNet, cur)} (net)`} v={formatMoney(q.grossPence, cur)} />
          {q.discountPence > 0 && <Row k={`Volume discount ${q.discountPct}%`} v={`−${formatMoney(q.discountPence, cur)}`} accent />}
          {q.setupPence > 0 && <Row k="Setup" v={formatMoney(q.setupPence, cur)} />}
          <Row k="Subtotal (net)" v={formatMoney(q.subtotalPence, cur)} />
          <Row k={`GST ${Math.round(q.vatRate * 100)}%`} v={formatMoney(q.vatPence, cur)} />
        </dl>

        {p.tiers.length > 0 && (
          <div className="space-y-2 border-t border-paper/15 pt-3">
            <p className="label-caps flex items-center gap-1.5 text-paper/70">
              <Tag className="size-3.5" aria-hidden /> Volume discounts
            </p>
            <ul className="grid grid-cols-2 gap-1 text-[12px] sm:grid-cols-4">
              {p.tiers.map((t) => (
                <li key={t.minQty} className={cx("border px-2 py-1", q.discountPct === t.discountPct ? "border-signal bg-signal font-bold text-ink" : "border-paper/25 text-paper/70")}>
                  {t.minQty.toLocaleString("en-GB")}+ · {t.discountPct}%
                </li>
              ))}
            </ul>
            {q.nextTier && onQuantity && q.nextTier.minQty <= p.quantity_limits.max && (
              <button type="button" onClick={() => onQuantity(q.nextTier!.minQty)} className="flex w-full items-center justify-between gap-2 border border-dashed border-signal/60 px-2.5 py-2 text-left text-[13px] text-signal hover:bg-signal/10">
                <span>
                  Order {q.nextTier.minQty.toLocaleString("en-GB")} to save {q.nextTier.discountPct}%
                </span>
                <ArrowRight className="size-4" aria-hidden />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className={cx("flex justify-between gap-3", accent ? "font-bold text-signal" : "text-paper/80")}>
      <dt>{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}

export function ResetLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-[13px] font-bold text-steel hover:text-ink">
      <RotateCcw className="size-3.5" aria-hidden /> Reset options
    </button>
  );
}
