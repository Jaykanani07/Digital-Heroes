"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { Archive, ArchiveRestore, ArrowRight, Download, FileArchive, FileText, FileUp, Lock, RefreshCw, Sparkles } from "lucide-react";
import { api, downloadFile, errorMessage, openFile } from "@/lib/api";
import { useApi, useAuthedImage } from "@/lib/hooks";
import { cx, describeConfig, formatBytes, formatDateTime, formatMoney } from "@/lib/format";
import { PIPELINE, STATUS_LABEL, type OrderDetail, type OrderStatus, type ProofSummary } from "@/lib/types";
import { Alert, Badge, Button, ErrorState, Field, Input, Modal, PageLoader, Panel, Pipeline, Select, Skeleton, Spinner, useToast } from "@/components/ui";

interface AdminOrder extends OrderDetail {
  customer: { id: string; email: string; full_name: string; company: string | null; phone: string | null };
  files: { id: string; kind: string; filename: string; size_bytes: number; rows: number | null; created_at: string }[];
  notifications: { to_email: string; subject: string; status: string; created_at: string }[];
  sourceAssets: { id: string; kind: string; original_name: string; mime: string; size_bytes: number }[];
}

const FILE_LABEL: Record<string, string> = {
  print_pdf: "Print PDF (vector, bleed, trim box)",
  print_png: "Print PNG (production DPI)",
  csv_pdf: "All CSV rows — multi-page PDF",
  csv_zip: "One PDF per CSV row (zip)",
};

export default function AdminOrderPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { data: o, error, loading, reload } = useApi<AdminOrder>(`/admin/orders/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState<OrderStatus | null>(null);
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  if (loading && !o) return <PageLoader />;
  if (error || !o) return <ErrorState message={error || "Job not found."} onRetry={reload} />;

  const run = async (key: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
      toast(okMsg);
      reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const idx = PIPELINE.indexOf(o.status);
  const next = PIPELINE[idx + 1] as OrderStatus | undefined;
  const paid = o.payment_status === "paid";
  const canProof = paid && ["order", "artwork", "proof"].includes(o.status);

  const uploadRevision = async (f: File | undefined) => {
    if (!f) return;
    const form = new FormData();
    form.append("file", f);
    await run(
      "upload",
      async () => {
        const a = await api<{ id: string }>(`/admin/orders/${o.id}/uploads`, { form });
        await api(`/admin/orders/${o.id}/proofs`, { body: { artworkAssetId: a.id } });
      },
      "Revised artwork uploaded and new proof issued",
    );
    if (uploadRef.current) uploadRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <Link href="/admin/orders" className="text-sm font-bold text-steel hover:text-ink">
            ← Job database
          </Link>
          <h1 className="font-display text-6xl">{o.order_number}</h1>
          <p className="text-steel">
            {o.product.division_name} · <b className="text-ink">{o.product.name}</b> · {describeConfig(o.config, o.product.materials)} · {o.config.orientation} · {o.quantity.toLocaleString("en-GB")} units
            {o.csv_row_count ? ` · ${o.csv_row_count} CSV rows` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {paid && <Button onClick={() => downloadFile(`/admin/orders/${o.id}/invoice`).catch((e) => toast(errorMessage(e), "error"))}><FileText className="size-4" aria-hidden /> Invoice</Button>}
          {o.status === "completed" && (
            <Button onClick={() => run("archive", () => api(`/admin/orders/${o.id}/archive`, { body: { archived: !o.archived } }), o.archived ? "Restored from archive" : "Archived")} busy={busy === "archive"}>
              {o.archived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />} {o.archived ? "Unarchive" : "Archive"}
            </Button>
          )}
        </div>
      </div>

      {actionError && <Alert tone="error">{actionError}</Alert>}

      {/* pipeline control */}
      <Panel title="Pipeline" actions={o.files_ready ? <Badge status="approved">Ready for production</Badge> : <Badge status="superseded"><Lock className="mr-1 size-3" aria-hidden />Files locked</Badge>}>
        <div className="space-y-4">
          <Pipeline status={o.status} />
          {!paid ? (
            <Alert tone="warning">Unpaid quote — it enters the pipeline when the customer pays.</Alert>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {next && (
                <Button variant="primary" onClick={() => { setMoveTo(next); setNote(""); }}>
                  Move to {STATUS_LABEL[next]} <ArrowRight className="size-4" aria-hidden />
                </Button>
              )}
              <Select aria-label="Move to stage" className="h-10 w-auto" value="" onChange={(e) => { if (e.target.value) { setMoveTo(e.target.value as OrderStatus); setNote(""); } }}>
                <option value="">Move to any stage…</option>
                {PIPELINE.filter((s) => s !== o.status && s !== "quote").map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </Select>
              {canProof && (
                <Button onClick={() => run("proof", () => api(`/admin/orders/${o.id}/proofs`, { body: {} }), "New proof issued")} busy={busy === "proof"}>
                  <Sparkles className="size-4" aria-hidden /> Generate proof
                </Button>
              )}
              {canProof && (
                <Button onClick={() => uploadRef.current?.click()} busy={busy === "upload"}>
                  <FileUp className="size-4" aria-hidden /> Upload revised artwork
                </Button>
              )}
              <input ref={uploadRef} type="file" className="sr-only" accept=".pdf,.svg,.ai,.png,.jpg,.jpeg" onChange={(e) => uploadRevision(e.target.files?.[0])} />
            </div>
          )}
          <p className="text-[13px] text-steel">Production and Completed need an approved proof. Moving a job e-mails the customer.</p>
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {/* production files */}
          <Panel
            title="Production files"
            actions={o.files_ready && o.files.length > 0 ? (
              <Button size="sm" variant="primary" onClick={() => run("zip", () => downloadFile(`/admin/orders/${o.id}/files-zip`), "Download started")} busy={busy === "zip"}>
                <FileArchive className="size-4" aria-hidden /> Download all
              </Button>
            ) : undefined}
            pad={false}
          >
            {!o.files_ready ? (
              <p className="flex items-center gap-2 p-4 text-sm text-steel">
                <Lock className="size-4" aria-hidden /> Print-ready files unlock once the customer approves a proof.
              </p>
            ) : (
              <ul className="divide-y divide-ink/15">
                {o.files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[13px] font-bold">{f.filename}</span>
                      <span className="block text-[12px] text-steel">
                        {FILE_LABEL[f.kind] || f.kind} · {formatBytes(f.size_bytes)}
                        {f.rows ? ` · ${f.rows} rows` : ""} · {formatDateTime(f.created_at)}
                      </span>
                    </span>
                    <Button size="sm" onClick={() => downloadFile(`/admin/orders/${o.id}/files/${f.id}`, f.filename).catch((e) => toast(errorMessage(e), "error"))}>
                      <Download className="size-4" aria-hidden /> Download
                    </Button>
                  </li>
                ))}
                <li className="px-4 py-3">
                  <Button size="sm" variant="ghost" onClick={() => run("regen", () => api(`/admin/orders/${o.id}/regenerate-files`, { body: {} }), "Files regenerated")} busy={busy === "regen"}>
                    <RefreshCw className="size-4" aria-hidden /> Regenerate from approved proof
                  </Button>
                </li>
              </ul>
            )}
          </Panel>

          {/* proofs */}
          <Panel title={`Proofs (${o.proofs.length})`} pad={false}>
            {o.proofs.length === 0 ? (
              <p className="p-4 text-sm text-steel">{paid ? "No proof yet — use Generate proof." : "Proofs are issued after payment."}</p>
            ) : (
              <ul className="divide-y divide-ink/15">
                {o.proofs.map((p, i) => (
                  <ProofRow key={p.id} order={o} proof={p} expanded={i === 0} />
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Customer">
            <p className="font-bold">{o.customer.full_name}</p>
            {o.customer.company && <p className="text-sm">{o.customer.company}</p>}
            <p className="text-sm"><a className="underline" href={`mailto:${o.customer.email}`}>{o.customer.email}</a></p>
            {o.customer.phone && <p className="text-sm">{o.customer.phone}</p>}
            {o.customer_note && <p className="mt-2 border-l-4 border-signal bg-white px-2 py-1 text-sm">“{o.customer_note}”</p>}
          </Panel>
          <Panel title="Money">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-steel">Subtotal (net)</dt><dd>{formatMoney(o.subtotal_pence, o.currency)}</dd></div>
              {o.discount_pence > 0 && <div className="flex justify-between"><dt className="text-steel">Discount {o.discount_pct}%</dt><dd>−{formatMoney(o.discount_pence, o.currency)}</dd></div>}
              <div className="flex justify-between"><dt className="text-steel">GST</dt><dd>{formatMoney(o.vat_pence, o.currency)}</dd></div>
              <div className="flex justify-between border-t-[1.5px] border-ink pt-1 font-bold"><dt>Total</dt><dd>{formatMoney(o.total_pence, o.currency)}</dd></div>
              <div className="flex justify-between"><dt className="text-steel">Payment</dt><dd><Badge status={o.payment_status} /></dd></div>
              {o.invoice_number && <div className="flex justify-between"><dt className="text-steel">Invoice</dt><dd>{o.invoice_number}</dd></div>}
            </dl>
          </Panel>
          {o.sourceAssets.length > 0 && (
            <Panel title="Customer source files" pad={false}>
              <ul className="divide-y divide-ink/15">
                {o.sourceAssets.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span className="min-w-0 truncate">{a.original_name} <span className="text-steel">({a.kind})</span></span>
                    <Button size="sm" variant="ghost" onClick={() => downloadFile(`/admin/assets/${a.id}/original`, a.original_name).catch((e) => toast(errorMessage(e), "error"))} aria-label={`Download ${a.original_name}`}>
                      <Download className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {o.reorderOfOrder && (
            <Panel title="Reorder">
              <p className="text-sm">
                Repeat of <Link className="font-bold underline" href={`/admin/orders/${o.reorderOfOrder.id}`}>{o.reorderOfOrder.order_number}</Link> — approved artwork reused.
              </p>
            </Panel>
          )}
          <Panel title="Approval log" pad={false}>
            <ul className="divide-y divide-ink/15 text-sm">
              {o.approvals.length === 0 && <li className="px-4 py-3 text-steel">No proof activity yet.</li>}
              {o.approvals.map((a, i) => (
                <li key={i} className="px-4 py-2.5">
                  <p><b className="capitalize">{a.action.replace("_", " ")}</b> v{a.version} {a.actor_email && <span className="text-steel">· {a.actor_email}</span>}</p>
                  <p className="text-[12px] text-steel">{formatDateTime(a.created_at)}{a.ip ? ` · ${a.ip}` : ""}</p>
                  {a.note && a.action !== "issued" && <p className="text-[12px]">{a.note}</p>}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Status history" pad={false}>
            <ul className="divide-y divide-ink/15 text-sm">
              {o.history.map((h, i) => (
                <li key={i} className="px-4 py-2.5">
                  <p><b>{STATUS_LABEL[h.to_status]}</b> {h.actor_email && <span className="text-steel">· {h.actor_email}</span>}</p>
                  <p className="text-[12px] text-steel">{formatDateTime(h.created_at)}{h.note ? ` — ${h.note}` : ""}</p>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="E-mails sent" pad={false}>
            <ul className="divide-y divide-ink/15 text-sm">
              {o.notifications.length === 0 && <li className="px-4 py-3 text-steel">None yet.</li>}
              {o.notifications.map((n, i) => (
                <li key={i} className="px-4 py-2.5">
                  <p className="font-bold">{n.subject}</p>
                  <p className="text-[12px] text-steel">{n.to_email} · {n.status} · {formatDateTime(n.created_at)}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <Modal open={Boolean(moveTo)} onClose={() => setMoveTo(null)} title={`Move ${o.order_number} to ${moveTo ? STATUS_LABEL[moveTo] : ""}?`}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const to = moveTo!;
            await run("move", () => api(`/admin/orders/${o.id}/status`, { body: { to, note: note.trim() || null } }), `Moved to ${STATUS_LABEL[to]}`);
            setMoveTo(null);
          }}
        >
          <Field label="Note for the customer (optional)" hint="Included in the status e-mail and the timeline.">
            {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder={moveTo === "completed" ? "Dispatched with DPD, tracking 1234" : ""} maxLength={500} />}
          </Field>
          {actionError && <Alert tone="error">{actionError}</Alert>}
          <Button type="submit" variant="primary" busy={busy === "move"}>
            Move job
          </Button>
        </form>
      </Modal>
    </div>
  );
}

function ProofRow({ order, proof, expanded }: { order: AdminOrder; proof: ProofSummary; expanded: boolean }) {
  const [open, setOpen] = useState(expanded);
  const { url } = useAuthedImage(open && proof.has_preview ? `/admin/orders/${order.id}/proofs/${proof.id}/preview` : null);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="text-left" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
          <span className="font-bold">v{proof.version}</span> <span className="text-sm text-steel">· {proof.source.replace("_", " ")} · {formatDateTime(proof.created_at)}</span>
        </button>
        <span className="flex items-center gap-2">
          <Badge status={proof.status} />
          <Button size="sm" variant="ghost" onClick={() => openFile(`/admin/orders/${order.id}/proofs/${proof.id}/pdf`)}>
            PDF
          </Button>
        </span>
      </div>
      {proof.customer_note && <p className="mt-2 border-l-4 border-danger bg-white px-2 py-1 text-sm">Customer: “{proof.customer_note}”</p>}
      {open && proof.has_preview && (
        <div className={cx("mt-3 grid place-items-center bg-concrete p-3")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url ? <img src={url} alt={`Proof v${proof.version}`} className="max-h-[50vh] border-[1.5px] border-ink" /> : <Skeleton className="h-72 w-full" />}
        </div>
      )}
    </li>
  );
}
