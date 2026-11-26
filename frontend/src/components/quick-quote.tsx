"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { calculateQuote, formatMoney, formatUnit, orient, validateConfig } from "@/shared/pricing";
import { useApi } from "@/lib/hooks";
import type { Division, Product } from "@/lib/types";
import { defaultQuantity } from "./configurator";
import { Button, Field, Input, Select, Skeleton } from "./ui";

/** A compact live price check: product, size and quantity → instant VAT-inclusive total. */
export function QuickQuote({ divisions }: { divisions: Division[] }) {
  const router = useRouter();
  const all = useMemo(() => divisions.flatMap((d) => d.products.map((p) => ({ ...p, division: d.name }))), [divisions]);
  const [slug, setSlug] = useState(() => all.find((p) => p.slug === "race-bibs")?.slug || all[0]?.slug || "");
  const { data: product } = useApi<Product>(slug ? `/catalog/products/${slug}` : null);
  const [sizeIdx, setSizeIdx] = useState(0);
  const [qty, setQty] = useState("100");

  useEffect(() => {
    if (product && product.slug === slug) {
      setSizeIdx(0);
      setQty(String(defaultQuantity(product)));
    }
  }, [product, slug]);

  const result = useMemo(() => {
    if (!product || product.slug !== slug) return null;
    const preset = product.sizes[sizeIdx] || product.sizes[0];
    const orientation = product.orientations[0];
    const s = preset ? orient(preset.w, preset.h, orientation) : { w: product.size_limits.minW, h: product.size_limits.minH };
    const config = { widthMm: s.w, heightMm: s.h, material: product.materials[0].key, orientation, quantity: parseInt(qty, 10) || 0 };
    return { quote: calculateQuote(product, product.tiers, config, product.vatRate), errors: validateConfig(product, config) };
  }, [product, slug, sizeIdx, qty]);

  return (
    <div className="border-[1.5px] border-ink bg-white shadow-[8px_8px_0_0_var(--color-ink)]">
      <div className="grid gap-3 p-4 sm:grid-cols-3">
        <Field label="Product">
          {(id) => (
            <Select id={id} value={slug} onChange={(e) => setSlug(e.target.value)}>
              {divisions.map((d) => (
                <optgroup key={d.id} label={d.name}>
                  {d.products.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Size">
          {(id) => (
            <Select id={id} value={sizeIdx} onChange={(e) => setSizeIdx(Number(e.target.value))} disabled={!product}>
              {product?.sizes.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Quantity">
          {(id) => <Input id={id} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))} />}
        </Field>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-t-[1.5px] border-ink bg-ink p-4 text-paper">
        {!result ? (
          <div className="space-y-2" role="status" aria-label="Calculating price">
            <Skeleton className="h-10 w-36 bg-paper/20" />
            <Skeleton className="h-3.5 w-44 bg-paper/15" />
          </div>
        ) : result.errors.length ? (
          <p className="text-sm font-bold text-signal" role="alert">
            {result.errors[0]}
          </p>
        ) : (
          <div aria-live="polite">
            <p className="font-display text-5xl text-signal">{formatMoney(result.quote.totalPence, product!.currency)}</p>
            <p className="text-[13px] text-paper/70">
              {formatUnit(result.quote.unitIncVat)} each inc. GST
              {result.quote.discountPct > 0 && <b className="text-signal"> · {result.quote.discountPct}% volume discount</b>}
            </p>
          </div>
        )}
        <Button variant="primary" onClick={() => router.push(`/products/${product?.division_slug}/${slug}`)} disabled={!product}>
          Configure <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
