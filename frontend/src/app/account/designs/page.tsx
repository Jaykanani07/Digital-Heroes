"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Library, Pencil, ShoppingCart, Trash2 } from "lucide-react";
import type { Design } from "@/shared/design";
import type { ProductConfig } from "@/shared/pricing";
import { api, errorMessage } from "@/lib/api";
import { useDraftStore } from "@/lib/draft";
import { useApi, useAuthedImage } from "@/lib/hooks";
import { describeConfig, formatDate } from "@/lib/format";
import { Button, EmptyState, ErrorState, Field, Input, LinkButton, Modal, PageHeader, PageLoader, Skeleton, useToast } from "@/components/ui";

interface Row {
  id: string;
  name: string;
  config: ProductConfig;
  product_id: string;
  product_name: string;
  product_slug: string;
  division_name: string;
  artwork_asset_id: string | null;
  has_thumbnail: boolean;
  times_ordered: number;
  updated_at: string;
}

function Thumb({ id, has }: { id: string; has: boolean }) {
  const { url } = useAuthedImage(has ? `/designs/${id}/thumbnail` : null);
  if (!has) return <Library className="size-10 text-steel" aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className="max-h-full max-w-full object-contain drop-shadow-[2px_2px_0_rgba(20,20,20,0.3)]" /> : <Skeleton className="h-full w-full" />;
}

export default function DesignsPage() {
  const router = useRouter();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useApi<Row[]>("/designs");
  const setDraft = useDraftStore((s) => s.setDraft);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Row | null>(null);
  const [newName, setNewName] = useState("");

  const open = async (d: Row, then: "edit" | "order") => {
    setBusy(d.id + then);
    try {
      const full = await api<{ design: Design | null; config: ProductConfig; csv_asset_id: string | null; artwork_asset_id: string | null }>(`/designs/${d.id}`);
      if (then === "order" && !full.design && full.artwork_asset_id) {
        // Uploaded artwork: straight to a new quote.
        const o = await api<{ id: string }>("/orders", { body: { productId: d.product_id, config: full.config, artworkAssetId: full.artwork_asset_id, designId: d.id } });
        router.push(`/checkout/${o.id}`);
        return;
      }
      if (!full.design) throw new Error("This saved item has no editable design.");
      let csv = null;
      if (full.csv_asset_id) {
        try {
          const c = await api(`/assets/${full.csv_asset_id}/csv`);
          csv = { assetId: c.id, name: c.originalName, columns: c.columns, rowCount: c.rowCount, rows: c.rows };
        } catch {
          /* CSV no longer available — continue without it */
        }
      }
      setDraft(d.product_slug, { productId: d.product_id, config: full.config, design: full.design, csv, designId: d.id, designName: d.name });
      router.push(`/design/${d.product_slug}`);
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(null);
    }
  };

  const remove = async (d: Row) => {
    if (!window.confirm(`Delete “${d.name}”? Past orders keep their artwork.`)) return;
    try {
      await api(`/designs/${d.id}`, { method: "DELETE" });
      setData((rows) => rows?.filter((r) => r.id !== d.id) ?? null);
      toast("Design deleted");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const rename = async () => {
    if (!renaming || !newName.trim()) return;
    try {
      await api(`/designs/${renaming.id}`, { method: "PATCH", body: { name: newName.trim() } });
      setData((rows) => rows?.map((r) => (r.id === renaming.id ? { ...r, name: newName.trim() } : r)) ?? null);
      setRenaming(null);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Saved designs" title="Your artwork library">
        Approved artwork is saved here automatically. Open one to tweak it, or order it again without redesigning.
      </PageHeader>
      {loading && <PageLoader />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.length === 0 && <EmptyState title="No saved designs yet" body="Save a design from the designer, or approve a proof — it lands here." action={<LinkButton href="/products" variant="primary">Start designing</LinkButton>} />}
      {data && data.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((d) => (
            <article key={d.id} className="flex flex-col border-[1.5px] border-ink bg-paper">
              <div className="grid aspect-[4/3] place-items-center bg-concrete p-4">
                <Thumb id={d.id} has={d.has_thumbnail} />
              </div>
              <div className="flex flex-1 flex-col gap-3 border-t-[1.5px] border-ink p-3">
                <div>
                  <h2 className="font-bold">{d.name}</h2>
                  <p className="text-[12px] text-steel">
                    {d.product_name} · {describeConfig(d.config)}
                  </p>
                  <p className="text-[12px] text-steel">
                    Updated {formatDate(d.updated_at)}
                    {d.times_ordered > 0 && ` · ordered ${d.times_ordered}×`}
                  </p>
                </div>
                <div className="mt-auto flex flex-wrap gap-1.5">
                  <Button size="sm" variant="primary" onClick={() => open(d, "order")} busy={busy === d.id + "order"}>
                    <ShoppingCart className="size-4" aria-hidden /> Order again
                  </Button>
                  {!d.artwork_asset_id && (
                    <Button size="sm" onClick={() => open(d, "edit")} busy={busy === d.id + "edit"}>
                      Edit
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" aria-label="Rename" title="Rename" onClick={() => { setRenaming(d); setNewName(d.name); }}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Delete" title="Delete" onClick={() => remove(d)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      <Modal open={Boolean(renaming)} onClose={() => setRenaming(null)} title="Rename design">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); rename(); }}>
          <Field label="Name">{(id) => <Input id={id} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} autoFocus />}</Field>
          <Button type="submit" variant="primary">Save name</Button>
        </form>
      </Modal>
    </div>
  );
}
