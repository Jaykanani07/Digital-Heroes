"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { calculateQuote, formatMoney, type Orientation } from "@/shared/pricing";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Alert, Button, Checkbox, ErrorState, Field, Input, LinkButton, PageHeader, PageLoader, Panel, Select, Textarea, useToast } from "@/components/ui";

interface Form {
  divisionId: string;
  slug: string;
  name: string;
  summary: string;
  description: string;
  isActive: boolean;
  supportsCsv: boolean;
  sortOrder: number;
  sizes: { label: string; w: number; h: number }[];
  sizeLimits: { allowCustom: boolean; minW: number; maxW: number; minH: number; maxH: number };
  materials: { key: string; label: string; multiplier: number; description?: string }[];
  orientations: Orientation[];
  quantityLimits: { min: number; max: number; step: number };
  pricing: { baseUnit: number; perCm2: number; minUnit: number; setupFee: number };
  printSpec: { bleedMm: number; safeMm: number; dpi: number; cornerRadiusMm: number };
}

const blank = (divisionId = ""): Form => ({
  divisionId,
  slug: "",
  name: "",
  summary: "",
  description: "",
  isActive: true,
  supportsCsv: false,
  sortOrder: 0,
  sizes: [{ label: "100 × 100 mm", w: 100, h: 100 }],
  sizeLimits: { allowCustom: true, minW: 20, maxW: 300, minH: 20, maxH: 300 },
  materials: [{ key: "standard", label: "Standard", multiplier: 1 }],
  orientations: ["portrait", "landscape"],
  quantityLimits: { min: 1, max: 10000, step: 1 },
  pricing: { baseUnit: 0.5, perCm2: 0.005, minUnit: 0.5, setupFee: 0 },
  printSpec: { bleedMm: 3, safeMm: 3, dpi: 300, cornerRadiusMm: 0 },
});

const num = (v: string) => (v === "" ? 0 : Number(v));

export default function ProductEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const toast = useToast();
  const products = useApi<any[]>("/admin/products");
  const divisions = useApi<{ id: string; name: string }[]>("/admin/divisions");
  const [f, setF] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (f) return;
    if (isNew && divisions.data) setF(blank(divisions.data[0]?.id));
    const p = products.data?.find((x) => x.id === id);
    if (!isNew && p) {
      setF({
        divisionId: p.division_id, slug: p.slug, name: p.name, summary: p.summary, description: p.description, isActive: p.is_active,
        supportsCsv: p.supports_csv, sortOrder: p.sort_order, sizes: p.sizes, sizeLimits: p.size_limits, materials: p.materials,
        orientations: p.orientations, quantityLimits: p.quantity_limits, pricing: { setupFee: 0, ...p.pricing }, printSpec: { cornerRadiusMm: 0, ...p.print_spec },
      });
    }
  }, [isNew, id, products.data, divisions.data, f]);

  const example = useMemo(() => {
    if (!f || !f.sizes[0] || !f.materials[0]) return null;
    try {
      const q = calculateQuote(
        { pricing: f.pricing, materials: f.materials, sizes: f.sizes, size_limits: f.sizeLimits, quantity_limits: f.quantityLimits, orientations: f.orientations },
        [],
        { widthMm: f.sizes[0].w, heightMm: f.sizes[0].h, material: f.materials[0].key, orientation: "portrait", quantity: Math.max(f.quantityLimits.min, 1) },
        0.2,
      );
      return `${f.sizes[0].label}, ${f.materials[0].label}, ${q.quantity} unit(s): ${formatMoney(q.totalPence)} inc. GST (before volume discounts)`;
    } catch {
      return null;
    }
  }, [f]);

  if (products.loading || divisions.loading) return <PageLoader />;
  if (products.error) return <ErrorState message={products.error} onRetry={products.reload} />;
  if (!f) return <ErrorState message="Product not found." />;

  const set = (patch: Partial<Form>) => setF({ ...f, ...patch });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isNew) {
        const p = await api<{ id: string }>("/admin/products", { body: f });
        toast("Product created");
        router.replace(`/admin/products/${p.id}`);
      } else {
        await api(`/admin/products/${id}`, { method: "PUT", body: f });
        toast("Product saved");
        products.reload();
      }
    } catch (err) {
      setError(err instanceof ApiError && err.details?.fields ? `${Object.keys(err.details.fields)[0]}: ${err.message}` : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${f.name}? Products with orders can only be hidden.`)) return;
    try {
      await api(`/admin/products/${id}`, { method: "DELETE" });
      toast("Product deleted");
      router.push("/admin/products");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form onSubmit={save} className="space-y-6" noValidate>
      <Link href="/admin/products" className="text-sm font-bold text-steel hover:text-ink">← Products</Link>
      <PageHeader
        eyebrow={isNew ? "New product" : "Edit product"}
        title={f.name || "Untitled product"}
        actions={
          <>
            {!isNew && <LinkButton href={`/admin/templates?product=${id}`}>Templates</LinkButton>}
            {!isNew && <Button variant="danger" onClick={remove}><Trash2 className="size-4" aria-hidden /> Delete</Button>}
            <Button type="submit" variant="primary" busy={busy}>Save product</Button>
          </>
        }
      />
      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Basics">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">{(i) => <Input id={i} value={f.name} onChange={(e) => set({ name: e.target.value, slug: isNew ? e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : f.slug })} />}</Field>
            <Field label="URL slug">{(i) => <Input id={i} value={f.slug} onChange={(e) => set({ slug: e.target.value })} />}</Field>
            <Field label="Division">
              {(i) => (
                <Select id={i} value={f.divisionId} onChange={(e) => set({ divisionId: e.target.value })}>
                  {divisions.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Sort order">{(i) => <Input id={i} type="number" value={f.sortOrder} onChange={(e) => set({ sortOrder: num(e.target.value) })} />}</Field>
            <Field label="Summary" className="sm:col-span-2">{(i) => <Input id={i} value={f.summary} onChange={(e) => set({ summary: e.target.value })} />}</Field>
            <Field label="Description" className="sm:col-span-2">{(i) => <Textarea id={i} value={f.description} onChange={(e) => set({ description: e.target.value })} />}</Field>
            <div className="flex flex-wrap gap-5 sm:col-span-2">
              <Checkbox label="Live on the site" checked={f.isActive} onChange={(v) => set({ isActive: v })} />
              <Checkbox label="Supports CSV variable data" checked={f.supportsCsv} onChange={(v) => set({ supportsCsv: v })} />
            </div>
          </div>
        </Panel>

        <Panel title="Pricing (net of GST)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Base per unit (₹)">{(i) => <Input id={i} type="number" step="0.01" value={f.pricing.baseUnit} onChange={(e) => set({ pricing: { ...f.pricing, baseUnit: num(e.target.value) } })} />}</Field>
            <Field label="Per cm² (₹)">{(i) => <Input id={i} type="number" step="0.0001" value={f.pricing.perCm2} onChange={(e) => set({ pricing: { ...f.pricing, perCm2: num(e.target.value) } })} />}</Field>
            <Field label="Minimum per unit (₹)">{(i) => <Input id={i} type="number" step="0.01" value={f.pricing.minUnit} onChange={(e) => set({ pricing: { ...f.pricing, minUnit: num(e.target.value) } })} />}</Field>
            <Field label="Setup fee per order (₹)">{(i) => <Input id={i} type="number" step="0.01" value={f.pricing.setupFee} onChange={(e) => set({ pricing: { ...f.pricing, setupFee: num(e.target.value) } })} />}</Field>
          </div>
          <p className="mt-3 text-[13px] text-steel">Unit = max(minimum, base + area × rate) × material multiplier. {example}</p>
        </Panel>

        <Panel title="Sizes (mm)">
          <div className="space-y-2">
            {f.sizes.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_80px_36px] items-end gap-2">
                <Field label={i === 0 ? "Label" : ""}>{(id2) => <Input id={id2} aria-label="Size label" value={s.label} onChange={(e) => set({ sizes: f.sizes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />}</Field>
                <Field label={i === 0 ? "Width" : ""}>{(id2) => <Input id={id2} aria-label="Width" type="number" value={s.w} onChange={(e) => set({ sizes: f.sizes.map((x, j) => (j === i ? { ...x, w: num(e.target.value) } : x)) })} />}</Field>
                <Field label={i === 0 ? "Height" : ""}>{(id2) => <Input id={id2} aria-label="Height" type="number" value={s.h} onChange={(e) => set({ sizes: f.sizes.map((x, j) => (j === i ? { ...x, h: num(e.target.value) } : x)) })} />}</Field>
                <Button aria-label="Remove size" variant="ghost" onClick={() => set({ sizes: f.sizes.filter((_, j) => j !== i) })}><X className="size-4" /></Button>
              </div>
            ))}
            <Button size="sm" onClick={() => set({ sizes: [...f.sizes, { label: "New size", w: 100, h: 100 }] })}><Plus className="size-4" aria-hidden /> Add size</Button>
          </div>
          <div className="mt-4 space-y-3 border-t-[1.5px] border-ink/15 pt-4">
            <Checkbox label="Allow custom sizes" checked={f.sizeLimits.allowCustom} onChange={(v) => set({ sizeLimits: { ...f.sizeLimits, allowCustom: v } })} />
            <div className="grid grid-cols-4 gap-2">
              {(["minW", "maxW", "minH", "maxH"] as const).map((k) => (
                <Field key={k} label={k}>{(i) => <Input id={i} type="number" value={f.sizeLimits[k]} onChange={(e) => set({ sizeLimits: { ...f.sizeLimits, [k]: num(e.target.value) } })} />}</Field>
              ))}
            </div>
            <div className="flex gap-5">
              {(["portrait", "landscape"] as const).map((o) => (
                <Checkbox key={o} label={o === "portrait" ? "Portrait" : "Landscape"} checked={f.orientations.includes(o)} onChange={(v) => set({ orientations: v ? [...new Set([...f.orientations, o])] : f.orientations.filter((x) => x !== o) })} />
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="Materials">
          <div className="space-y-2">
            {f.materials.map((m, i) => (
              <div key={i} className="grid grid-cols-[110px_1fr_80px_36px] items-end gap-2">
                <Field label={i === 0 ? "Key" : ""}>{(id2) => <Input id={id2} aria-label="Material key" value={m.key} onChange={(e) => set({ materials: f.materials.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />}</Field>
                <Field label={i === 0 ? "Label" : ""}>{(id2) => <Input id={id2} aria-label="Material label" value={m.label} onChange={(e) => set({ materials: f.materials.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />}</Field>
                <Field label={i === 0 ? "× Price" : ""}>{(id2) => <Input id={id2} aria-label="Price multiplier" type="number" step="0.05" value={m.multiplier} onChange={(e) => set({ materials: f.materials.map((x, j) => (j === i ? { ...x, multiplier: num(e.target.value) } : x)) })} />}</Field>
                <Button aria-label="Remove material" variant="ghost" onClick={() => set({ materials: f.materials.filter((_, j) => j !== i) })}><X className="size-4" /></Button>
              </div>
            ))}
            <Button size="sm" onClick={() => set({ materials: [...f.materials, { key: `material-${f.materials.length + 1}`, label: "New material", multiplier: 1 }] })}><Plus className="size-4" aria-hidden /> Add material</Button>
          </div>
        </Panel>

        <Panel title="Quantity">
          <div className="grid grid-cols-3 gap-2">
            {(["min", "max", "step"] as const).map((k) => (
              <Field key={k} label={k}>{(i) => <Input id={i} type="number" value={f.quantityLimits[k]} onChange={(e) => set({ quantityLimits: { ...f.quantityLimits, [k]: num(e.target.value) } })} />}</Field>
            ))}
          </div>
        </Panel>

        <Panel title="Print specification">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Bleed (mm)">{(i) => <Input id={i} type="number" step="0.5" value={f.printSpec.bleedMm} onChange={(e) => set({ printSpec: { ...f.printSpec, bleedMm: num(e.target.value) } })} />}</Field>
            <Field label="Safe margin (mm)">{(i) => <Input id={i} type="number" step="0.5" value={f.printSpec.safeMm} onChange={(e) => set({ printSpec: { ...f.printSpec, safeMm: num(e.target.value) } })} />}</Field>
            <Field label="DPI">{(i) => <Input id={i} type="number" value={f.printSpec.dpi} onChange={(e) => set({ printSpec: { ...f.printSpec, dpi: num(e.target.value) } })} />}</Field>
            <Field label="Corner radius">{(i) => <Input id={i} type="number" step="0.5" value={f.printSpec.cornerRadiusMm} onChange={(e) => set({ printSpec: { ...f.printSpec, cornerRadiusMm: num(e.target.value) } })} />}</Field>
          </div>
        </Panel>
      </div>

      {!isNew && <TierEditor productId={id} />}
      <TierEditor productId={null} />
    </form>
  );
}

/** Volume-discount tiers. productId null edits the global defaults. */
function TierEditor({ productId }: { productId: string | null }) {
  const toast = useToast();
  const { data, error, reload } = useApi<{ minQty: number; discountPct: number }[]>(`/admin/tiers${productId ? `?productId=${productId}` : ""}`);
  const [tiers, setTiers] = useState<{ minQty: number; discountPct: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (data) setTiers(data);
  }, [data]);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api("/admin/tiers", { method: "PUT", body: { productId, tiers } });
      toast(productId ? "Product discounts saved" : "Default discounts saved");
      reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title={productId ? "Volume discounts — this product" : "Volume discounts — defaults for all products"}>
      {error && <ErrorState message={error} onRetry={reload} />}
      <p className="mb-3 text-[13px] text-steel">
        {productId ? "Leave empty to use the default tiers. If set, they replace the defaults for this product." : "Applied automatically to every product without its own tiers."}
      </p>
      <div className="space-y-2">
        {tiers.map((t, i) => (
          <div key={i} className="grid max-w-md grid-cols-[1fr_1fr_36px] items-end gap-2">
            <Field label={i === 0 ? "From quantity" : ""}>{(id) => <Input id={id} aria-label="From quantity" type="number" value={t.minQty} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, minQty: num(e.target.value) } : x)))} />}</Field>
            <Field label={i === 0 ? "Discount %" : ""}>{(id) => <Input id={id} aria-label="Discount percent" type="number" step="0.5" value={t.discountPct} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, discountPct: num(e.target.value) } : x)))} />}</Field>
            <Button aria-label="Remove tier" variant="ghost" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}><X className="size-4" /></Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setTiers([...tiers, { minQty: (tiers.at(-1)?.minQty || 50) * 2, discountPct: (tiers.at(-1)?.discountPct || 0) + 5 }])}><Plus className="size-4" aria-hidden /> Add tier</Button>
          <Button size="sm" variant="primary" onClick={save} busy={busy}>Save tiers</Button>
        </div>
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Panel>
  );
}
