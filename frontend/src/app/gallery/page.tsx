"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cx } from "@/lib/format";
import type { Division } from "@/lib/types";
import { CardGridSkeleton, EmptyState, ErrorState, LinkButton, Modal, PageHeader, PageLoader } from "@/components/ui";

interface Item {
  id: string;
  title: string;
  description: string;
  division_slug: string;
  division_name: string;
}

export default function GalleryPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Gallery />
    </Suspense>
  );
}

function Gallery() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const division = search.get("division") || "";
  const { data: divisions } = useApi<Division[]>("/catalog/divisions");
  const { data: items, error, loading, reload } = useApi<Item[]>(`/gallery${division ? `?division=${division}` : ""}`);
  const [open, setOpen] = useState<Item | null>(null);

  const setDivision = (slug: string) => router.replace(slug ? `${pathname}?division=${slug}` : pathname, { scroll: false });

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <PageHeader eyebrow="Gallery" title="Real work, by product family.">
        Every piece below was produced by the same print engine that renders your proofs.
      </PageHeader>
      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Product family">
        {[{ slug: "", name: "All work" }, ...(divisions || [])].map((d) => (
          <button key={d.slug} role="tab" aria-selected={division === d.slug} onClick={() => setDivision(d.slug)} className={cx("h-9 border-[1.5px] border-ink px-3 text-sm font-bold", division === d.slug ? "bg-ink text-signal" : "bg-paper hover:bg-white")}>
            {d.name}
          </button>
        ))}
      </div>
      {loading && <CardGridSkeleton count={6} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {items && items.length === 0 && <EmptyState title="Nothing here yet" body="New work for this family is on its way." action={<LinkButton href="/gallery">See all work</LinkButton>} />}
      {items && items.length > 0 && (
        <div className="columns-1 gap-3 sm:columns-2 lg:columns-3">
          {items.map((g) => (
            <button key={g.id} onClick={() => setOpen(g)} className="group mb-3 block w-full break-inside-avoid border-[1.5px] border-ink bg-paper text-left transition-shadow hover:shadow-[5px_5px_0_0_var(--color-ink)]">
              <div className="grid place-items-center bg-concrete-dark p-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${API_URL}/api/gallery/${g.id}/image`} alt={g.title} loading="lazy" className="max-h-80 max-w-full object-contain shadow-[3px_3px_0_0_rgb(20_20_20/0.25)]" />
              </div>
              <div className="border-t-[1.5px] border-ink px-3 py-2.5">
                <p className="font-bold">{g.title}</p>
                <p className="label-caps text-steel">{g.division_name}</p>
              </div>
            </button>
          ))}
        </div>
      )}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open?.title || ""} wide>
        {open && (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${API_URL}/api/gallery/${open.id}/image`} alt={open.title} className="mx-auto max-h-[65vh] border-[1.5px] border-ink" />
            <p className="text-sm text-steel">{open.description}</p>
            <LinkButton href={`/products/${open.division_slug}`} variant="primary">
              Make something like this
            </LinkButton>
          </div>
        )}
      </Modal>
    </div>
  );
}
