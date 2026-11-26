"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import type { ProductConfig } from "@/shared/pricing";
import { useApi } from "@/lib/hooks";
import type { Division, Product } from "@/lib/types";
import { useDraftStore } from "@/lib/draft";
import { Configurator, PricePanel, defaultConfig, useQuote } from "@/components/configurator";
import { Button, ErrorState, Field, PageHeader, PageLoader, Select } from "@/components/ui";

export default function CalculatorPage() {
  const router = useRouter();
  const { data: divisions, error, reload } = useApi<Division[]>("/catalog/divisions");
  const [slug, setSlug] = useState<string>("");
  const { data: product, loading } = useApi<Product>(slug ? `/catalog/products/${slug}` : null);
  const [config, setConfig] = useState<ProductConfig | null>(null);
  const [continuing, setContinuing] = useState(false);
  const setDraft = useDraftStore((s) => s.setDraft);

  useEffect(() => {
    if (!slug && divisions?.[0]?.products[0]) setSlug(divisions[0].products[0].slug);
  }, [divisions, slug]);
  useEffect(() => {
    if (product && product.slug === slug) setConfig(defaultConfig(product));
  }, [product, slug]);

  const ready = product && config && product.slug === slug;
  const { errors } = useQuote(ready ? product : null, ready ? config : null);
  const flat = useMemo(() => divisions?.flatMap((d) => d.products) ?? [], [divisions]);

  const continueToProduct = () => {
    if (!product || !config || continuing) return;
    setContinuing(true);
    try {
      window.sessionStorage.setItem("dh_keep_scroll", String(window.scrollY));
    } catch {
      /* ignore */
    }
    setDraft(product.slug, { productId: product.id, config });
    router.push(`/products/${product.division_slug}/${product.slug}?from=calculator`, { scroll: false });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <PageHeader eyebrow="Instant price calculator" title="Price any job, live.">
        Change anything and the price updates immediately — per-unit pricing, automatic volume discounts and GST included.
      </PageHeader>
      {error && <ErrorState message={error} onRetry={reload} />}
      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6 border-[1.5px] border-ink bg-paper p-5">
          <Field label="Product" className="max-w-md">
            {(id) => (
              <Select id={id} value={slug} onChange={(e) => setSlug(e.target.value)}>
                {divisions?.map((d) => (
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
          {loading || !ready ? <PageLoader label="Loading options…" /> : <Configurator key={product.slug} product={product} config={config} onChange={setConfig} />}
        </div>
        <div className="lg:sticky lg:top-24 lg:self-start">
          {ready ? (
            <PricePanel product={product} config={config} onQuantity={(q) => setConfig({ ...config, quantity: q })}>
              <Button variant="primary" size="lg" className="w-full" onClick={continueToProduct} disabled={errors.length > 0 || continuing}>
                {continuing ? (
                  <>
                    <Loader2 className="size-5 animate-spin" aria-hidden /> Loading…
                  </>
                ) : (
                  <>
                    Continue with this job <ArrowRight className="size-5" aria-hidden />
                  </>
                )}
              </Button>
            </PricePanel>
          ) : (
            flat.length > 0 && <PageLoader />
          )}
        </div>
      </div>
    </div>
  );
}
