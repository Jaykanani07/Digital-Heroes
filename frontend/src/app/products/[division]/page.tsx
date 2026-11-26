"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, FileSpreadsheet } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { API_URL } from "@/lib/api";
import type { Division } from "@/lib/types";
import { DivisionIcon } from "@/components/site";
import { EmptyState, ErrorState, LinkButton, PageLoader } from "@/components/ui";

export default function DivisionPage() {
  const { division } = useParams<{ division: string }>();
  const { data: d, error, loading, reload } = useApi<Division>(`/catalog/divisions/${division}`);
  const { data: gallery } = useApi<{ id: string; title: string }[]>(`/gallery?division=${division}`);

  if (loading) return <PageLoader />;
  if (error || !d)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        {error?.includes("not found") ? <EmptyState title="No such bay" body="That division doesn't exist." action={<LinkButton href="/products">All products</LinkButton>} /> : <ErrorState message={error || "Not found"} onRetry={reload} />}
      </div>
    );

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <nav className="mb-4 text-sm text-steel" aria-label="Breadcrumb">
        <Link href="/products" className="hover:underline">
          Products
        </Link>{" "}
        / <span className="text-ink">{d.name}</span>
      </nav>
      <div className="mb-10 flex flex-col gap-6 border-b-[1.5px] border-ink pb-8 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <span className="grid size-14 place-items-center border-[1.5px] border-ink bg-signal">
            <DivisionIcon slug={d.slug} className="size-7" />
          </span>
          <h1 className="font-display text-6xl sm:text-7xl">{d.name}</h1>
          <p className="max-w-2xl text-lg text-steel">{d.description}</p>
        </div>
        <p className="label-caps text-steel">{d.tagline}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {d.products.map((p) => (
          <Link key={p.id} href={`/products/${d.slug}/${p.slug}`} className="group flex flex-col gap-5 border-[1.5px] border-ink bg-paper p-6 transition-[transform,box-shadow] hover:-translate-y-1 hover:shadow-[6px_6px_0_0_var(--color-ink)]">
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-display text-5xl">{p.name}</h2>
              {p.fromPrice !== null && (
                <span className="shrink-0 bg-ink px-2.5 py-1 text-right text-signal">
                  <span className="label-caps block text-paper/60">from</span>
                  <span className="font-display text-3xl">₹{p.fromPrice.toFixed(2)}</span>
                </span>
              )}
            </div>
            <p className="text-steel">{p.summary}</p>
            <dl className="grid grid-cols-3 gap-2 text-[13px]">
              <div className="border-[1.5px] border-ink/20 p-2">
                <dt className="label-caps text-steel">Sizes</dt>
                <dd className="font-bold">{p.sizes.length} presets</dd>
              </div>
              <div className="border-[1.5px] border-ink/20 p-2">
                <dt className="label-caps text-steel">Materials</dt>
                <dd className="font-bold">{p.materials.length}</dd>
              </div>
              <div className="border-[1.5px] border-ink/20 p-2">
                <dt className="label-caps text-steel">Min qty</dt>
                <dd className="font-bold">{p.quantity_limits.min}</dd>
              </div>
            </dl>
            <div className="flex items-center justify-between">
              {p.supports_csv ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-bold">
                  <FileSpreadsheet className="size-4" aria-hidden /> Variable data from CSV
                </span>
              ) : (
                <span />
              )}
              <span className="inline-flex items-center gap-1 font-bold">
                Configure <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" aria-hidden />
              </span>
            </div>
          </Link>
        ))}
      </div>

      {gallery && gallery.length > 0 && (
        <section className="mt-14" aria-labelledby="g-title">
          <h2 id="g-title" className="mb-4 font-display text-5xl">
            Recent {d.name.toLowerCase()} work
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {gallery.map((g) => (
              <figure key={g.id} className="border-[1.5px] border-ink bg-paper">
                <div className="grid aspect-[4/3] place-items-center bg-concrete-dark p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${API_URL}/api/gallery/${g.id}/image`} alt={g.title} loading="lazy" className="max-h-full max-w-full object-contain" />
                </div>
                <figcaption className="border-t-[1.5px] border-ink px-3 py-2 text-sm font-bold">{g.title}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
