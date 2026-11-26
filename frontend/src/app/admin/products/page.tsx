"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { formatUnit } from "@/lib/format";
import { Alert, Badge, Button, ErrorState, Field, Input, LinkButton, Modal, PageHeader, PageLoader, Panel, Table, Td, Th, Checkbox, useToast } from "@/components/ui";

interface ProductRow {
  id: string;
  slug: string;
  name: string;
  division_name: string;
  is_active: boolean;
  supports_csv: boolean;
  pricing: { baseUnit: number; perCm2: number; minUnit: number };
  template_count: number;
  order_count: number;
  materials: unknown[];
  sizes: unknown[];
}
interface DivisionRow {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  sort_order: number;
  is_active: boolean;
  product_count: number;
}

export default function AdminProducts() {
  const { data, error, loading, reload } = useApi<ProductRow[]>("/admin/products");
  const divisions = useApi<DivisionRow[]>("/admin/divisions");
  const [editDiv, setEditDiv] = useState<Partial<DivisionRow> | null>(null);
  const toast = useToast();

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Catalogue" title="Products and divisions" actions={<LinkButton href="/admin/products/new" variant="primary"><Plus className="size-4" aria-hidden /> New product</LinkButton>}>
        One parameter-driven product covers every size, material and quantity — no per-size SKUs. New divisions and products go live without code changes.
      </PageHeader>
      {loading && <PageLoader />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <Table>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>Division</Th>
              <Th>Pricing rule</Th>
              <Th>Options</Th>
              <Th>Status</Th>
              <Th className="text-right">Orders</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id} className="hover:bg-white">
                <Td>
                  <Link href={`/admin/products/${p.id}`} className="font-bold hover:underline">{p.name}</Link>
                  <p className="font-mono text-[12px] text-steel">{p.slug}</p>
                </Td>
                <Td>{p.division_name}</Td>
                <Td className="text-[13px]">
                  max({formatUnit(p.pricing.minUnit)}, {formatUnit(p.pricing.baseUnit)} + {p.pricing.perCm2}/cm²)
                </Td>
                <Td className="text-[13px]">
                  {p.sizes.length} sizes · {p.materials.length} materials · {p.template_count} templates{p.supports_csv && " · CSV"}
                </Td>
                <Td><Badge status={p.is_active ? "active" : "inactive"}>{p.is_active ? "Live" : "Hidden"}</Badge></Td>
                <Td className="text-right">{p.order_count}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Panel title="Divisions" actions={<Button size="sm" variant="primary" onClick={() => setEditDiv({ slug: "", name: "", tagline: "", description: "", sort_order: (divisions.data?.length || 0) + 1, is_active: true })}><Plus className="size-4" aria-hidden /> Add division</Button>} pad={false}>
        {divisions.error && <ErrorState message={divisions.error} onRetry={divisions.reload} />}
        <ul className="divide-y divide-ink/15">
          {divisions.data?.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span>
                <span className="font-bold">{d.name}</span> <span className="text-sm text-steel">· {d.product_count} products · /{d.slug}</span>
              </span>
              <span className="flex items-center gap-2">
                {!d.is_active && <Badge status="inactive">Hidden</Badge>}
                <Button size="sm" onClick={() => setEditDiv(d)}>Edit</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${d.name}`}
                  onClick={async () => {
                    if (!window.confirm(`Delete the ${d.name} division?`)) return;
                    try {
                      await api(`/admin/divisions/${d.id}`, { method: "DELETE" });
                      toast("Division deleted");
                      divisions.reload();
                    } catch (e) {
                      toast(errorMessage(e), "error");
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      <DivisionModal value={editDiv} onClose={() => setEditDiv(null)} onSaved={() => { setEditDiv(null); divisions.reload(); reload(); }} />
    </div>
  );
}

function DivisionModal({ value, onClose, onSaved }: { value: Partial<DivisionRow> | null; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Partial<DivisionRow>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setD(value || {});
    setError(null);
  }, [value]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { slug: d.slug, name: d.name, tagline: d.tagline || "", description: d.description || "", sortOrder: Number(d.sort_order) || 0, isActive: d.is_active ?? true };
      if (d.id) await api(`/admin/divisions/${d.id}`, { method: "PUT", body });
      else await api("/admin/divisions", { body });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={Boolean(value)} onClose={onClose} title={d.id ? `Edit ${d.name}` : "New division"}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">{(id) => <Input id={id} value={d.name || ""} onChange={(e) => setD({ ...d, name: e.target.value, slug: d.id ? d.slug : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") })} />}</Field>
          <Field label="URL slug">{(id) => <Input id={id} value={d.slug || ""} onChange={(e) => setD({ ...d, slug: e.target.value })} />}</Field>
        </div>
        <Field label="Tagline">{(id) => <Input id={id} value={d.tagline || ""} onChange={(e) => setD({ ...d, tagline: e.target.value })} />}</Field>
        <Field label="Description">{(id) => <Input id={id} value={d.description || ""} onChange={(e) => setD({ ...d, description: e.target.value })} />}</Field>
        <div className="flex items-end gap-4">
          <Field label="Sort order" className="w-28">{(id) => <Input id={id} type="number" value={d.sort_order ?? 0} onChange={(e) => setD({ ...d, sort_order: Number(e.target.value) })} />}</Field>
          <Checkbox label="Visible on the site" checked={d.is_active ?? true} onChange={(v) => setD({ ...d, is_active: v })} />
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="primary" busy={busy}>Save division</Button>
      </form>
    </Modal>
  );
}
