"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye, Save } from "lucide-react";
import { emptyDesign, type Design, type DesignIssue } from "@/shared/design";
import { calculateQuote, formatMoney, validateConfig, type ProductConfig } from "@/shared/pricing";
import { api, apiBlob, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDraftStore } from "@/lib/draft";
import { useApi } from "@/lib/hooks";
import { describeConfig } from "@/lib/format";
import type { CsvInfo, OrderDetail, Product, Template } from "@/lib/types";
import { Designer } from "@/components/designer/Designer";
import { Alert, Button, EmptyState, ErrorState, Field, Input, LinkButton, Modal, PageLoader, Spinner, useToast } from "@/components/ui";

export default function DesignPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <DesignPageInner />
    </Suspense>
  );
}

function DesignPageInner() {
  const { product: slug } = useParams<{ product: string }>();
  const search = useSearchParams();
  const orderId = search.get("order");
  const templateId = search.get("template");
  const { data: product, error, loading, reload } = useApi<Product>(`/catalog/products/${slug}`);

  if (loading) return <PageLoader label="Opening the designer…" />;
  if (error || !product)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorState message={error || "Product not found."} onRetry={reload} />
      </div>
    );
  if (orderId) return <ResubmitMode product={product} orderId={orderId} />;
  if (templateId) return <TemplateMode product={product} templateId={templateId} />;
  return <DraftMode product={product} />;
}

function Shell({ product, title, children, back }: { product: Product; title: string; children: React.ReactNode; back: { href: string; label: string } }) {
  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={back.href} className="mb-1 inline-flex items-center gap-1 text-sm font-bold text-steel hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> {back.label}
          </Link>
          <h1 className="font-display text-5xl">{title}</h1>
          <p className="text-sm text-steel">{product.name}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

/** Server-rendered proof preview — exactly what the print engine produces. */
function useProofPreview(productId: string) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const show = async (design: Design, csvAssetId: string | null, rowIndex: number) => {
    setOpen(true);
    setBusy(true);
    setError(null);
    try {
      const { blob } = await apiBlob("/preview", { body: { productId, design, csvAssetId, rowIndex } });
      setUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const modal = (
    <Modal open={open} onClose={() => setOpen(false)} title="Proof preview (rendered by the print engine)" wide>
      {busy ? (
        <Spinner label="Rendering at print resolution…" />
      ) : error ? (
        <Alert tone="error">{error}</Alert>
      ) : url ? (
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Proof preview" className="mx-auto max-h-[65vh] border-[1.5px] border-ink" />
          <p className="text-[13px] text-steel">Magenta line = trim (finished edge). Dashed blue = printable zone. The pale outer margin is bleed and will be trimmed off.</p>
        </div>
      ) : null}
    </Modal>
  );
  return { show, modal };
}

// ================================================================ draft

function DraftMode({ product }: { product: Product }) {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const draft = useDraftStore((s) => s.drafts[product.slug]);
  const patchDraft = useDraftStore((s) => s.patchDraft);
  const clearDraft = useDraftStore((s) => s.clearDraft);
  const [hydrated, setHydrated] = useState(false);
  const [initial, setInitial] = useState<Design | null>(null);
  const [csv, setCsv] = useState<CsvInfo | null>(null);
  const latest = useRef<Design | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<null | "save" | "order">(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useProofPreview(product.id);

  // Wait for the persisted draft to load from storage.
  useEffect(() => {
    const unsub = useDraftStore.persist.onFinishHydration(() => setHydrated(true));
    if (useDraftStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);
  useEffect(() => {
    if (!hydrated || initial) return;
    if (draft && draft.productId === product.id) {
      setInitial(draft.design ?? emptyDesign(draft.config.widthMm, draft.config.heightMm));
      setCsv(draft.csv);
      setName(draft.designName || `${product.name} design`);
    }
  }, [hydrated, draft, product, initial]);

  const onChange = useCallback(
    (d: Design) => {
      latest.current = d;
      patchDraft(product.slug, { design: d });
    },
    [patchDraft, product.slug],
  );
  const onCsv = (c: CsvInfo | null) => {
    setCsv(c);
    patchDraft(product.slug, { csv: c });
  };

  const config: ProductConfig | null = useMemo(() => (draft ? { ...draft.config, quantity: csv ? csv.rowCount : draft.config.quantity } : null), [draft, csv]);
  const priced = useMemo(() => (config ? { q: calculateQuote(product, product.tiers, config, product.vatRate), errors: validateConfig(product, config) } : null), [config, product]);

  if (!hydrated) return <PageLoader />;
  if (!draft || draft.productId !== product.id || !initial || !config) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <EmptyState title="Choose your options first" body="Pick a size, material and quantity, then open the designer." action={<LinkButton href={`/products/${product.division_slug}/${product.slug}`} variant="primary">Configure {product.name.toLowerCase()}</LinkButton>} />
      </div>
    );
  }

  const nextUrl = `/design/${product.slug}`;
  const requireLogin = () => {
    if (user) return false;
    router.push(`/login?next=${encodeURIComponent(nextUrl)}`);
    return true;
  };

  const save = async () => {
    if (requireLogin() || !latest.current) return;
    setBusy("save");
    setError(null);
    try {
      const body = { productId: product.id, name: name.trim() || `${product.name} design`, config, design: latest.current, csvAssetId: csv?.assetId ?? null };
      const saved = draft.designId ? await api(`/designs/${draft.designId}`, { method: "PUT", body }) : await api("/designs", { body });
      patchDraft(product.slug, { designId: saved.id, designName: saved.name });
      setSaveOpen(false);
      toast("Design saved to your account");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const order = async (issues: DesignIssue[]) => {
    if (issues.length) {
      setError(`Fix this first: ${issues[0].message}`);
      return;
    }
    if (priced?.errors.length) {
      setError(priced.errors[0]);
      return;
    }
    if (requireLogin() || !latest.current) return;
    setBusy("order");
    setError(null);
    try {
      const o = await api<{ id: string }>("/orders", {
        body: { productId: product.id, config, design: latest.current, csvAssetId: csv?.assetId ?? null, designId: draft.designId },
      });
      clearDraft(product.slug);
      router.push(`/checkout/${o.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <Shell product={product} title={draft.designName || "Design your artwork"} back={{ href: `/products/${product.division_slug}/${product.slug}`, label: "Change options" }}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-[1.5px] border-ink bg-ink px-4 py-3 text-paper">
        <p className="text-sm">
          <span className="font-bold text-signal">{describeConfig(config, product.materials)}</span> · {config.quantity.toLocaleString("en-GB")} units{csv && " (from CSV)"}
        </p>
        {priced && (
          <p className="text-sm">
            {priced.errors.length ? <span className="font-bold text-signal">{priced.errors[0]}</span> : <><span className="font-display text-3xl text-signal">{formatMoney(priced.q.totalPence, product.currency)}</span> <span className="text-paper/70">inc. GST</span></>}
          </p>
        )}
      </div>
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      <Designer
        product={product}
        initial={initial}
        onChange={onChange}
        csv={csv}
        onCsvChange={onCsv}
        actions={(design, issues, row) => (
          <>
            <Button size="sm" aria-label="Proof preview" onClick={() => (requireLogin() ? undefined : preview.show(design, csv?.assetId ?? null, csv && row ? csv.rows.indexOf(row) : 0))}>
              <Eye className="size-4" aria-hidden /> <span className="hidden sm:inline">Proof preview</span>
            </Button>
            <Button size="sm" aria-label="Save design" onClick={() => (requireLogin() ? undefined : setSaveOpen(true))}>
              <Save className="size-4" aria-hidden /> <span className="hidden sm:inline">Save</span>
            </Button>
            <Button size="sm" variant="primary" onClick={() => order(issues)} busy={busy === "order"}>
              Continue to checkout <ArrowRight className="size-4" aria-hidden />
            </Button>
          </>
        )}
      />
      {preview.modal}
      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title={draft.designId ? "Update saved design" : "Save design"}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />}</Field>
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" variant="primary" busy={busy === "save"}>
            Save to my designs
          </Button>
        </form>
      </Modal>
    </Shell>
  );
}

// ============================================================ resubmit

function ResubmitMode({ product, orderId }: { product: Product; orderId: string }) {
  const router = useRouter();
  const toast = useToast();
  const { data: order, error, loading, reload } = useApi<OrderDetail>(`/orders/${orderId}`);
  const [csv, setCsv] = useState<CsvInfo | null>(null);
  const [csvLoaded, setCsvLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const preview = useProofPreview(product.id);

  useEffect(() => {
    if (!order) return;
    if (!order.csv_asset_id) {
      setCsvLoaded(true);
      return;
    }
    api(`/assets/${order.csv_asset_id}/csv`)
      .then((r) => setCsv({ assetId: r.id, name: r.originalName, columns: r.columns, rowCount: r.rowCount, rows: r.rows }))
      .catch(() => undefined)
      .finally(() => setCsvLoaded(true));
  }, [order]);

  if (loading || (order && !csvLoaded)) return <PageLoader />;
  if (error || !order) return <div className="mx-auto max-w-3xl px-4 py-16"><ErrorState message={error || "Order not found"} onRetry={reload} /></div>;
  if (order.status !== "artwork" || !order.design_snapshot) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <EmptyState title="Artwork is locked" body="Artwork can be edited while the order is waiting for artwork (after you request changes on a proof)." action={<LinkButton href={`/account/orders/${order.id}`}>Back to order</LinkButton>} />
      </div>
    );
  }

  const submit = async (design: Design, issues: DesignIssue[]) => {
    if (issues.length) {
      setErr(`Fix this first: ${issues[0].message}`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ version: number }>(`/orders/${order.id}/artwork`, { method: "PUT", body: { design } });
      toast(`Proof v${r.version} is ready to review`);
      router.push(`/account/orders/${order.id}`);
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Shell product={product} title={`Revise artwork · ${order.order_number}`} back={{ href: `/account/orders/${order.id}`, label: "Back to order" }}>
      <Alert tone="info" className="mb-4">
        Size and quantity are fixed for this paid order ({describeConfig(order.config, product.materials)}, {order.quantity} units). Submitting creates a new proof version for you to approve.
      </Alert>
      {err && <Alert tone="error" className="mb-4">{err}</Alert>}
      <Designer
        product={product}
        initial={order.design_snapshot}
        csv={csv}
        actions={(design, issues, row) => (
          <>
            <Button size="sm" aria-label="Proof preview" onClick={() => preview.show(design, csv?.assetId ?? null, csv && row ? csv.rows.indexOf(row) : 0)}>
              <Eye className="size-4" aria-hidden /> <span className="hidden sm:inline">Proof preview</span>
            </Button>
            <Button size="sm" variant="primary" onClick={() => submit(design, issues)} busy={busy}>
              Submit for new proof <ArrowRight className="size-4" aria-hidden />
            </Button>
          </>
        )}
      />
      {preview.modal}
    </Shell>
  );
}

// ============================================================ template

function TemplateMode({ product, templateId }: { product: Product; templateId: string }) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const isNew = templateId === "new";
  const { data: list, loading } = useApi<(Template & { is_active: boolean; sort_order: number })[]>(user?.role === "admin" ? `/admin/templates?productId=${product.id}` : null);
  const existing = list?.find((t) => t.id === templateId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setDescription(existing.description);
    }
  }, [existing]);

  const initial = useMemo(() => {
    if (isNew) {
      const s = product.sizes[0];
      const land = product.orientations[0] === "landscape";
      const w = s ? (land ? Math.max(s.w, s.h) : Math.min(s.w, s.h)) : product.size_limits.minW;
      const hh = s ? (land ? Math.min(s.w, s.h) : Math.max(s.w, s.h)) : product.size_limits.minH;
      return emptyDesign(w, hh);
    }
    return existing?.design ?? null;
  }, [isNew, existing, product]);

  if (authLoading || loading) return <PageLoader />;
  if (user?.role !== "admin") return <div className="mx-auto max-w-2xl px-4 py-16"><EmptyState title="Staff only" body="Templates are managed by the production team." /></div>;
  if (!initial) return <div className="mx-auto max-w-2xl px-4 py-16"><EmptyState title="Template not found" action={<LinkButton href="/admin/templates">All templates</LinkButton>} /></div>;

  const save = async (design: Design, issues: DesignIssue[]) => {
    if (!name.trim()) {
      setErr("Give the template a name.");
      return;
    }
    if (issues.length) {
      setErr(`Fix this first: ${issues[0].message}`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body = { productId: product.id, name: name.trim(), description: description.trim(), design, isActive: existing?.is_active ?? true, sortOrder: existing?.sort_order ?? 0 };
      if (isNew) await api("/admin/templates", { body });
      else await api(`/admin/templates/${templateId}`, { method: "PUT", body });
      toast("Template saved");
      router.push(`/admin/templates?product=${product.id}`);
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Shell product={product} title={isNew ? "New template" : `Edit template`} back={{ href: "/admin/templates", label: "All templates" }}>
      <div className="mb-4 grid gap-3 border-[1.5px] border-ink bg-paper p-4 sm:grid-cols-2">
        <Field label="Template name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Classic bib" />}</Field>
        <Field label="Short description">{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Event band, big number, sponsor strip" />}</Field>
        <p className="text-[13px] text-steel sm:col-span-2">
          Authored at {Math.round(initial.widthMm)} × {Math.round(initial.heightMm)} mm — templates re-fit to any size the customer picks. For variable data, type a column name (e.g. <code>number</code>) on text boxes.
        </p>
      </div>
      {err && <Alert tone="error" className="mb-4">{err}</Alert>}
      <Designer
        product={product}
        initial={initial}
        allowFreeBinding
        allowImages={false}
        actions={(design, issues) => (
          <Button size="sm" variant="primary" onClick={() => save(design, issues)} busy={busy}>
            <Save className="size-4" aria-hidden /> Save template
          </Button>
        )}
      />
    </Shell>
  );
}
