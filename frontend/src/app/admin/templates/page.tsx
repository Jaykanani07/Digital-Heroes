"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { Design, PrintSpec } from "@/shared/design";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { DesignSvg } from "@/components/designer/render";
import { Badge, Button, EmptyState, ErrorState, Field, LinkButton, PageHeader, PageLoader, Select, useToast } from "@/components/ui";

interface Row {
  id: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  name: string;
  description: string;
  design: Design;
  is_active: boolean;
}

export default function TemplatesPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Templates />
    </Suspense>
  );
}

function Templates() {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const productId = useSearchParams().get("product") || "";
  const products = useApi<{ id: string; name: string; slug: string; division_name: string; print_spec: PrintSpec }[]>("/admin/products");
  const { data, error, loading, reload } = useApi<Row[]>(`/admin/templates${productId ? `?productId=${productId}` : ""}`);
  const selected = products.data?.find((p) => p.id === productId);
  const specFor = (pid: string) => products.data?.find((p) => p.id === pid)?.print_spec || { bleedMm: 0, safeMm: 0, dpi: 300 };

  const toggle = async (t: Row) => {
    try {
      await api(`/admin/templates/${t.id}`, { method: "PATCH", body: { isActive: !t.is_active } });
      reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const remove = async (t: Row) => {
    if (!window.confirm(`Delete template “${t.name}”?`)) return;
    try {
      await api(`/admin/templates/${t.id}`, { method: "DELETE" });
      toast("Template deleted");
      reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Template groups" title="Templates" actions={selected && <LinkButton href={`/design/${selected.slug}?template=new`} variant="primary"><Plus className="size-4" aria-hidden /> New {selected.name} template</LinkButton>}>
        Templates are authored once and re-fit to any size a customer chooses. Bind text boxes to CSV columns for variable data.
      </PageHeader>
      <Field label="Product" className="mb-6 max-w-sm">
        {(id) => (
          <Select id={id} value={productId} onChange={(e) => router.replace(e.target.value ? `${pathname}?product=${e.target.value}` : pathname)}>
            <option value="">All products</option>
            {products.data?.map((p) => <option key={p.id} value={p.id}>{p.division_name} — {p.name}</option>)}
          </Select>
        )}
      </Field>
      {!selected && <p className="mb-4 text-sm text-steel">Pick a product to add a new template.</p>}
      {loading && <PageLoader />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.length === 0 && <EmptyState title="No templates" body="Create one so customers have a head start." />}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data?.map((t) => (
          <article key={t.id} className="flex flex-col border-[1.5px] border-ink bg-paper">
            <div className="grid aspect-[4/3] place-items-center bg-concrete p-3">
              <DesignSvg design={t.design} spec={specFor(t.product_id)} className="max-h-full max-w-full drop-shadow-[2px_2px_0_rgba(20,20,20,0.3)]" />
            </div>
            <div className="flex flex-1 flex-col gap-2 border-t-[1.5px] border-ink p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-bold">{t.name}</h2>
                  <p className="text-[12px] text-steel">{t.product_name}</p>
                </div>
                <Badge status={t.is_active ? "active" : "inactive"}>{t.is_active ? "Live" : "Hidden"}</Badge>
              </div>
              <div className="mt-auto flex flex-wrap gap-1.5">
                <LinkButton size="sm" href={`/design/${t.product_slug}?template=${t.id}`}><Pencil className="size-4" aria-hidden /> Edit</LinkButton>
                <Button size="sm" onClick={() => toggle(t)}>{t.is_active ? "Hide" : "Publish"}</Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => remove(t)}><Trash2 className="size-4" /></Button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
