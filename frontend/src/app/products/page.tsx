"use client";

import Link from "next/link";
import { ArrowRight, FileSpreadsheet } from "lucide-react";
import { useApi } from "@/lib/hooks";
import type { Division } from "@/lib/types";
import { DivisionIcon } from "@/components/site";
import { ErrorState, PageHeader, PageLoader } from "@/components/ui";

export default function ProductsPage() {
  const { data, error, loading, reload } = useApi<Division[]>("/catalog/divisions");
  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <PageHeader eyebrow="Catalogue" title="Six bays. Every product configurable.">
        Choose a product, set its size, material and quantity, and see the price instantly.
      </PageHeader>
      {loading && <PageLoader />}
      {error && <ErrorState message={error} onRetry={reload} />}
      <div className="space-y-10">
        {data?.map((d, i) => (
          <section key={d.id} aria-labelledby={`div-${d.slug}`} className="grid gap-4 border-t-[1.5px] border-ink pt-6 lg:grid-cols-[280px_1fr]">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center border-[1.5px] border-ink bg-signal">
                  <DivisionIcon slug={d.slug} className="size-5" />
                </span>
                <span className="label-caps text-steel">Bay {String(i + 1).padStart(2, "0")}</span>
              </div>
              <h2 id={`div-${d.slug}`} className="font-display text-5xl">
                <Link href={`/products/${d.slug}`} className="hover:underline">
                  {d.name}
                </Link>
              </h2>
              <p className="text-sm text-steel">{d.description}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {d.products.map((p) => (
                <Link key={p.id} href={`/products/${d.slug}/${p.slug}`} className="group flex flex-col justify-between gap-4 border-[1.5px] border-ink bg-paper p-4 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_var(--color-ink)]">
                  <div className="space-y-1.5">
                    <h3 className="font-display text-4xl">{p.name}</h3>
                    <p className="text-sm text-steel">{p.summary}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      {p.fromPrice !== null && <span className="bg-ink px-2 py-0.5 font-bold text-signal">from ₹{p.fromPrice.toFixed(2)} each</span>}
                      {p.supports_csv && (
                        <span className="inline-flex items-center gap-1 border border-ink px-2 py-0.5 text-[12px] font-bold">
                          <FileSpreadsheet className="size-3.5" aria-hidden /> CSV merge
                        </span>
                      )}
                    </span>
                    <span className="inline-flex items-center gap-1 font-bold">
                      Configure <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
