"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, FileUp, LayoutTemplate, Library, PenTool, Upload } from "lucide-react";
import { emptyDesign, scaleDesign, type Design } from "@/shared/design";
import type { ProductConfig } from "@/shared/pricing";
import { api, errorMessage, upload } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDraftStore } from "@/lib/draft";
import { useAction, useApi, useAuthedImage } from "@/lib/hooks";
import { cx, formatDate } from "@/lib/format";
import type { Product } from "@/lib/types";
import { Configurator, PricePanel, ResetLink, defaultConfig, useQuote } from "@/components/configurator";
import { DesignSvg } from "@/components/designer/render";
import { Alert, Button, CardGridSkeleton, EmptyState, ErrorState, LinkButton, PageLoader, Skeleton, Spinner } from "@/components/ui";

type Tab = "design" | "upload" | "saved";

export default function ProductPage() {
  const { division, product: slug } = useParams<{ division: string; product: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { data: product, error, loading, reload } = useApi<Product>(`/catalog/products/${slug}`);
  const draft = useDraftStore((s) => s.drafts[slug]);
  const setDraft = useDraftStore((s) => s.setDraft);
  const [config, setConfig] = useState<ProductConfig | null>(null);
  const [tab, setTab] = useState<Tab>("design");

  useEffect(() => {
    if (!product || config) return;
    // Resume a draft if the customer was configuring this product before.
    setConfig(draft?.config && draft.productId === product.id ? draft.config : defaultConfig(product));
  }, [product, draft, config]);

  useEffect(() => {
    if (loading || !product || !config) return;
    try {
      const saved = window.sessionStorage.getItem("dh_keep_scroll");
      if (saved !== null) {
        window.sessionStorage.removeItem("dh_keep_scroll");
        const y = parseInt(saved, 10);
        if (Number.isFinite(y)) window.scrollTo({ top: y, behavior: "instant" });
      }
    } catch {
      /* ignore */
    }
  }, [loading, product, config]);

  const { errors } = useQuote(product, config);

  if (loading) return <PageLoader />;
  if (error || !product)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        {error?.toLowerCase().includes("not found") ? (
          <EmptyState title="Product not found" body="It may have been renamed or retired." action={<LinkButton href="/products">See all products</LinkButton>} />
        ) : (
          <ErrorState message={error || "Not found"} onRetry={reload} />
        )}
      </div>
    );
  if (!config) return <PageLoader />;

  const startDesign = (design: Design) => {
    setDraft(slug, { productId: product.id, config, design, csv: draft?.csv ?? null, designId: null, designName: null });
    router.push(`/design/${slug}`);
  };

  const hasDraftDesign = Boolean(draft?.design && draft.productId === product.id);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <nav className="mb-4 text-sm text-steel" aria-label="Breadcrumb">
        <Link href="/products" className="hover:underline">
          Products
        </Link>{" "}
        /{" "}
        <Link href={`/products/${division}`} className="hover:underline">
          {product.division_name}
        </Link>{" "}
        / <span className="text-ink">{product.name}</span>
      </nav>
      <div className="mb-8 space-y-3">
        <h1 className="font-display text-6xl sm:text-7xl">{product.name}</h1>
        <p className="max-w-2xl text-lg text-steel">{product.description}</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-8">
          <section className="border-[1.5px] border-ink bg-paper p-5">
            <div className="mb-2 flex justify-end">
              <ResetLink onClick={() => setConfig(defaultConfig(product))} />
            </div>
            <Configurator product={product} config={config} onChange={setConfig} />
          </section>

          <section className="border-[1.5px] border-ink bg-paper" aria-labelledby="artwork-title">
            <div className="flex items-center gap-3 border-b-[1.5px] border-ink p-5">
              <span className="grid h-7 min-w-9 place-items-center bg-ink px-1.5 font-display text-xl text-signal">04</span>
              <h2 id="artwork-title" className="font-display text-3xl">
                Artwork
              </h2>
            </div>
            <div role="tablist" className="grid grid-cols-3 border-b-[1.5px] border-ink">
              {([
                ["design", "Design online", PenTool],
                ["upload", "Upload artwork", Upload],
                ["saved", "Saved designs", Library],
              ] as const).map(([k, label, Icon]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={cx("flex items-center justify-center gap-2 px-2 py-3 text-sm font-bold [&:not(:last-child)]:border-r-[1.5px] [&:not(:last-child)]:border-ink", tab === k ? "bg-signal" : "bg-white hover:bg-paper")}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
            <div className="p-5">
              {errors.length > 0 && (
                <Alert tone="warning" className="mb-4">
                  Fix the configuration first: {errors[0]}
                </Alert>
              )}
              {tab === "design" && (
                <div className="space-y-4">
                  {hasDraftDesign && (
                    <Alert tone="info" title="You have a design in progress" action={<Button size="sm" variant="primary" onClick={() => {
                      const d = draft!.design!;
                      const resized = Math.abs(d.widthMm - config.widthMm) > 0.01 || Math.abs(d.heightMm - config.heightMm) > 0.01;
                      useDraftStore.getState().patchDraft(slug, { config, design: resized ? scaleDesign(d, config.widthMm, config.heightMm, product.print_spec.safeMm) : d });
                      router.push(`/design/${slug}`);
                    }}>Continue</Button>}>
                      Pick it up where you left off, or start a new one below.
                    </Alert>
                  )}
                  <p className="text-sm text-steel">Start from a template (it re-fits to your size automatically) or a blank canvas. You can only place artwork inside the printable zone.</p>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {product.templates.map((t) => {
                      const scaled = scaleDesign(t.design, config.widthMm, config.heightMm, product.print_spec.safeMm);
                      return (
                        <button key={t.id} onClick={() => errors.length === 0 && startDesign(scaled)} className="group border-[1.5px] border-ink bg-white text-left transition-shadow hover:shadow-[4px_4px_0_0_var(--color-ink)]">
                          <div className="grid aspect-[4/3] place-items-center bg-concrete p-3">
                            <DesignSvg design={scaled} spec={product.print_spec} className="max-h-full max-w-full drop-shadow-[2px_2px_0_rgba(20,20,20,0.3)]" title={`${t.name} template`} />
                          </div>
                          <div className="flex items-center justify-between gap-2 border-t-[1.5px] border-ink px-3 py-2">
                            <span>
                              <span className="block text-sm font-bold">{t.name}</span>
                              <span className="block text-[12px] text-steel">{t.description}</span>
                            </span>
                            <LayoutTemplate className="size-4 shrink-0 text-steel group-hover:text-ink" aria-hidden />
                          </div>
                        </button>
                      );
                    })}
                    <button onClick={() => errors.length === 0 && startDesign(emptyDesign(config.widthMm, config.heightMm))} className="grid min-h-40 place-items-center border-[1.5px] border-dashed border-ink bg-white p-4 text-center hover:bg-paper">
                      <span>
                        <PenTool className="mx-auto mb-2 size-6" aria-hidden />
                        <span className="block font-bold">Blank canvas</span>
                        <span className="block text-[12px] text-steel">Start from scratch</span>
                      </span>
                    </button>
                  </div>
                </div>
              )}
              {tab === "upload" && <UploadArtwork product={product} config={config} blocked={errors.length > 0} />}
              {tab === "saved" && <SavedDesigns product={product} onUse={(d) => {
                setDraft(slug, { productId: product.id, config: { ...d.config, quantity: config.quantity }, design: d.design, csv: null, designId: d.id, designName: d.name });
                router.push(`/design/${slug}`);
              }} signedIn={Boolean(user)} />}
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <PricePanel product={product} config={config} onQuantity={(q) => setConfig({ ...config, quantity: q })}>
            <Button variant="primary" size="lg" className="w-full" onClick={() => document.getElementById("artwork-title")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              Add artwork <ArrowRight className="size-5" aria-hidden />
            </Button>
          </PricePanel>
          <ul className="mt-3 space-y-1.5 text-[13px] text-steel">
            <li>· {product.print_spec.dpi} dpi production files with {product.print_spec.bleedMm} mm bleed</li>
            <li>· Free proof — nothing prints until you approve</li>
            {product.supports_csv && <li>· Variable data: one unique artwork per CSV row</li>}
          </ul>
        </aside>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ upload path

interface UploadedArtwork {
  id: string;
  originalName: string;
  width: number;
  height: number;
  meta: { pdf?: boolean; widthMm?: number; heightMm?: number };
}

function UploadArtwork({ product, config, blocked }: { product: Product; config: ProductConfig; blocked: boolean }) {
  const { user } = useAuth();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [art, setArt] = useState<UploadedArtwork | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const order = useAction();
  const preview = useAuthedImage(art ? `/assets/${art.id}/file` : null);

  const aspectWarning = useMemo(() => {
    if (!art) return null;
    const artAr = art.width / art.height;
    const jobAr = config.widthMm / config.heightMm;
    return Math.abs(artAr - jobAr) / jobAr > 0.03 ? `Your file's proportions (${artAr.toFixed(2)}:1) don't match ${Math.round(config.widthMm)} × ${Math.round(config.heightMm)} mm (${jobAr.toFixed(2)}:1). It will be centred with blank margins — check the proof carefully.` : null;
  }, [art, config.widthMm, config.heightMm]);

  if (!user) {
    return (
      <EmptyState
        icon={<FileUp className="size-8" aria-hidden />}
        title="Sign in to upload"
        body="Uploaded artwork is stored privately against your account."
        action={<LinkButton href={`/login?next=${encodeURIComponent(`/products/${product.division_slug}/${product.slug}`)}`} variant="primary">Sign in</LinkButton>}
      />
    );
  }

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setUploadError(null);
    if (f.size > 4 * 1024 * 1024) {
      setUploadError("That file is over 4 MB. Export it smaller (or as PDF) and try again.");
      return;
    }
    setUploading(true);
    try {
      setArt(await upload("artwork", f));
    } catch (e) {
      setUploadError(errorMessage(e));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  const placeOrder = () =>
    order.run(async () => {
      const o = await api<{ id: string }>("/orders", { body: { productId: product.id, config, artworkAssetId: art!.id } });
      router.push(`/checkout/${o.id}`);
    });

  return (
    <div className="space-y-4">
      <p className="text-sm text-steel">
        Upload a finished, print-ready file: <b>PDF, SVG, AI (PDF-compatible), PNG or JPG</b>, max 4 MB. Supply it at {Math.round(config.widthMm)} × {Math.round(config.heightMm)} mm.
        {product.supports_csv && " Numbering or names per item need the online designer."}
      </p>
      <label
        className={cx("flex cursor-pointer flex-col items-center gap-2 border-[1.5px] border-dashed border-ink bg-white px-4 py-8 text-center hover:bg-paper", uploading && "pointer-events-none opacity-60")}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFile(e.dataTransfer.files[0]);
        }}
      >
        {uploading ? <Spinner label="Uploading and checking your file…" /> : <FileUp className="size-7" aria-hidden />}
        <span className="font-bold">{art ? "Replace file" : "Choose a file or drop it here"}</span>
        <input ref={input} type="file" className="sr-only" accept=".pdf,.svg,.ai,.png,.jpg,.jpeg,application/pdf,image/svg+xml,image/png,image/jpeg" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {uploadError && <Alert tone="error">{uploadError}</Alert>}
      {art && (
        <div className="grid gap-4 border-[1.5px] border-ink bg-white p-3 sm:grid-cols-[200px_1fr]">
          <div className="grid aspect-square place-items-center bg-concrete p-2">
            {preview.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt="Uploaded artwork preview" className="max-h-full max-w-full object-contain" />
            ) : (
              <Spinner label="" />
            )}
          </div>
          <div className="space-y-3 text-sm">
            <p className="font-bold">{art.originalName}</p>
            <p className="text-steel">
              {art.meta.pdf ? `PDF page ${art.meta.widthMm} × ${art.meta.heightMm} mm — kept as vector for print` : `${art.width} × ${art.height} px`}
            </p>
            {aspectWarning && (
              <p className="flex gap-2 text-[13px] text-ink">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {aspectWarning}
              </p>
            )}
            {order.error && <Alert tone="error">{order.error}</Alert>}
            <Button variant="primary" onClick={placeOrder} busy={order.busy} disabled={blocked}>
              Continue to checkout <ArrowRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------- saved designs

interface SavedDesignRow {
  id: string;
  name: string;
  product_id: string;
  has_thumbnail: boolean;
  updated_at: string;
}

function SavedThumb({ id }: { id: string }) {
  const { url } = useAuthedImage(`/designs/${id}/thumbnail`);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : <Skeleton className="h-full w-full" />;
}

function SavedDesigns({ product, onUse, signedIn }: { product: Product; onUse: (d: { id: string; name: string; config: ProductConfig; design: Design }) => void; signedIn: boolean }) {
  const { data, error, loading, reload } = useApi<SavedDesignRow[]>(signedIn ? "/designs" : null);
  const open = useAction();
  if (!signedIn)
    return <EmptyState title="Sign in to see saved designs" body="Approved artwork is stored against your account for fast repeat orders." action={<LinkButton href={`/login?next=${encodeURIComponent(`/products/${product.division_slug}/${product.slug}`)}`} variant="primary">Sign in</LinkButton>} />;
  if (loading) return <CardGridSkeleton count={3} cols="sm:grid-cols-2 xl:grid-cols-3" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const mine = (data || []).filter((d) => d.product_id === product.id);
  if (!mine.length) return <EmptyState title="No saved designs yet" body={`Designs you save or approve for ${product.name.toLowerCase()} appear here.`} />;
  return (
    <div className="space-y-3">
      {open.error && <Alert tone="error">{open.error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {mine.map((d) => (
          <button
            key={d.id}
            disabled={open.busy}
            onClick={() =>
              open.run(async () => {
                const full = await api<{ id: string; name: string; config: ProductConfig; design: Design | null }>(`/designs/${d.id}`);
                if (!full.design) throw new Error("This saved item is an uploaded file — reorder it from your order history instead.");
                onUse({ id: full.id, name: full.name, config: full.config, design: full.design });
              })
            }
            className="border-[1.5px] border-ink bg-white text-left hover:shadow-[4px_4px_0_0_var(--color-ink)]"
          >
            <div className="grid aspect-[4/3] place-items-center bg-concrete p-3">{d.has_thumbnail ? <SavedThumb id={d.id} /> : <Library className="size-8 text-steel" />}</div>
            <div className="border-t-[1.5px] border-ink px-3 py-2">
              <p className="truncate text-sm font-bold">{d.name}</p>
              <p className="text-[12px] text-steel">Updated {formatDate(d.updated_at)}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
