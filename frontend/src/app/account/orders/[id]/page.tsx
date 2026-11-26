"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { CheckCircle2, Download, FileText, FileUp, MessageSquareWarning, PenTool, Repeat } from "lucide-react";
import { api, errorMessage, openFile, upload } from "@/lib/api";
import { useAction, useApi, useAuthedImage } from "@/lib/hooks";
import { cx, describeConfig, formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { STATUS_LABEL, type OrderDetail, type ProofSummary } from "@/lib/types";
import { useInvoice, useReorder } from "@/components/orders";
import { Alert, Badge, Button, EmptyState, ErrorState, LinkButton, Modal, PageLoader, Panel, Pipeline, Skeleton, Spinner, Textarea, useToast } from "@/components/ui";

const NEXT_STEP: Record<string, string> = {
  quote: "Pay for this quote to start production.",
  order: "Payment received. We're preparing your proof.",
  artwork: "We're waiting for revised artwork. Edit your design or upload a new file below.",
  proof: "Your proof is ready. Check it carefully and approve it — nothing prints until you do.",
  production: "Approved and in production. Print files are locked to the version you approved.",
  completed: "Completed. Reorder it any time in one click.",
};

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const { data: o, error, loading, reload } = useApi<OrderDetail>(`/orders/${id}`);
  const { reorder, busyId } = useReorder();
  const invoice = useInvoice();

  if (loading) return <PageLoader />;
  if (error?.toLowerCase().includes("not found") || (!error && !o)) {
    return (
      <EmptyState
        title="Order not found"
        body="This order doesn't exist or belongs to a different account."
        action={<LinkButton href="/account/orders" variant="primary">View your orders</LinkButton>}
      />
    );
  }
  if (error || !o) return <ErrorState message={error || "Order not found."} onRetry={reload} />;

  const latest = o.proofs[0];
  const paid = o.payment_status === "paid";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Link href="/account/orders" className="text-sm font-bold text-steel hover:text-ink">
            ← All orders
          </Link>
          <h1 className="font-display text-6xl">{o.order_number}</h1>
          <p className="text-steel">
            {o.product.name} · {describeConfig(o.config, o.product.materials)} · {o.quantity.toLocaleString("en-GB")} units
            {o.csv_row_count ? " (CSV)" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {paid ? (
            <>
              <Button onClick={() => invoice(o)}>
                <Download className="size-4" aria-hidden /> Invoice
              </Button>
              <Button variant="primary" onClick={() => reorder(o.id)} busy={busyId === o.id}>
                <Repeat className="size-4" aria-hidden /> Reorder
              </Button>
            </>
          ) : (
            <LinkButton href={`/checkout/${o.id}`} variant="primary">
              Pay {formatMoney(o.total_pence, o.currency)}
            </LinkButton>
          )}
        </div>
      </div>

      <div className="space-y-3 border-[1.5px] border-ink bg-paper p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge status={paid ? o.status : "unpaid"}>{paid ? STATUS_LABEL[o.status] : "Awaiting payment"}</Badge>
          {o.reorderOfOrder && (
            <span className="text-sm">
              Reorder of{" "}
              <Link href={`/account/orders/${o.reorderOfOrder.id}`} className="font-bold underline">
                {o.reorderOfOrder.order_number}
              </Link>
            </span>
          )}
        </div>
        <Pipeline status={o.status} />
        <p className="text-sm">{NEXT_STEP[o.status]}</p>
      </div>

      {o.status === "proof" && latest?.status === "pending" && <ProofReview order={o} proof={latest} onDone={reload} />}
      {o.status === "artwork" && paid && <ReviseArtwork order={o} onDone={reload} />}
      {latest && !(o.status === "proof" && latest.status === "pending") && <ProofCard order={o} proof={latest} title={`Latest proof · v${latest.version}`} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Proof versions" pad={false}>
          {o.proofs.length === 0 ? (
            <p className="p-4 text-sm text-steel">{paid ? "Your first proof is being prepared." : "Proofs are issued after payment."}</p>
          ) : (
            <ul className="divide-y divide-ink/15">
              {o.proofs.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span>
                    <span className="font-bold">v{p.version}</span> <span className="text-steel">· {formatDateTime(p.created_at)}</span>
                    {p.customer_note && <span className="mt-1 block text-[13px] text-steel">“{p.customer_note}”</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge status={p.status} />
                    <button className="text-[13px] font-bold underline" onClick={() => openFile(`/orders/${o.id}/proofs/${p.id}/pdf`)}>
                      PDF
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Approval log" pad={false}>
          {o.approvals.length === 0 ? (
            <p className="p-4 text-sm text-steel">Every proof issued, approved or changed is recorded here.</p>
          ) : (
            <ul className="divide-y divide-ink/15">
              {o.approvals.map((a, i) => (
                <li key={i} className="px-4 py-2.5 text-sm">
                  <p>
                    <span className="font-bold capitalize">{a.action.replace("_", " ")}</span> · v{a.version}
                    {a.actor_email && <span className="text-steel"> by {a.actor_email}</span>}
                  </p>
                  <p className="text-[12px] text-steel">
                    {formatDateTime(a.created_at)}
                    {a.note && a.action !== "issued" ? ` — ${a.note}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Timeline" pad={false}>
          <ol className="divide-y divide-ink/15">
            {o.history.map((h, i) => (
              <li key={i} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                <span>
                  <span className="font-bold">{STATUS_LABEL[h.to_status]}</span>
                  {h.note && <span className="block text-[12px] text-steel">{h.note}</span>}
                </span>
                <span className="shrink-0 text-[12px] text-steel">{formatDateTime(h.created_at)}</span>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title="Payment">
          <dl className="space-y-1.5 text-sm">
            <Row k="Units" v={`${o.quantity.toLocaleString("en-GB")}`} />
            {o.discount_pence > 0 && <Row k={`Volume discount ${o.discount_pct}%`} v={`−${formatMoney(o.discount_pence, o.currency)}`} />}
            <Row k="Subtotal (net)" v={formatMoney(o.subtotal_pence, o.currency)} />
            <Row k={`GST ${Math.round(o.vat_rate * 100)}%`} v={formatMoney(o.vat_pence, o.currency)} />
            <Row k="Total" v={formatMoney(o.total_pence, o.currency)} strong />
            <Row k="Paid" v={o.paid_at ? formatDate(o.paid_at) : "Not yet"} />
            {o.invoice_number && <Row k="Invoice" v={o.invoice_number} />}
          </dl>
        </Panel>
      </div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={cx("flex justify-between", strong && "border-t-[1.5px] border-ink pt-1.5 font-bold")}>
      <dt className={strong ? "" : "text-steel"}>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function ProofImage({ order, proof }: { order: OrderDetail; proof: ProofSummary }) {
  const { url, error } = useAuthedImage(proof.has_preview ? `/orders/${order.id}/proofs/${proof.id}/preview` : null);
  if (!proof.has_preview) return <p className="p-6 text-sm text-steel">This proof is a PDF — open it below.</p>;
  if (error) return <p className="p-6 text-sm text-danger">Preview couldn&apos;t load. Open the PDF instead.</p>;
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={`Proof version ${proof.version}`} className="mx-auto max-h-[60vh] w-auto border-[1.5px] border-ink bg-white" /> : <Skeleton className="h-72 w-full" />;
}

function ProofCard({ order, proof, title, children }: { order: OrderDetail; proof: ProofSummary; title: string; children?: React.ReactNode }) {
  const shrunk = proof.fit_report?.filter((f) => f.shrunk) ?? [];
  return (
    <Panel title={title} actions={<Badge status={proof.status} />}>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-2">
          <div className="grid place-items-center bg-concrete p-4">
            <ProofImage order={order} proof={proof} />
          </div>
          <p className="text-[12px] text-steel">
            <span className="font-bold text-trim">Magenta</span> = trim edge · <span className="font-bold text-safe">dashed blue</span> = printable zone · pale margin = bleed (trimmed off).
            {order.csv_row_count ? " Showing CSV row 1; the PDF includes the first rows." : ""}
          </p>
        </div>
        <div className="space-y-4">
          <Button className="w-full" onClick={() => openFile(`/orders/${order.id}/proofs/${proof.id}/pdf`)}>
            <FileText className="size-4" aria-hidden /> Open proof PDF
          </Button>
          {shrunk.length > 0 && (
            <div className="border-[1.5px] border-ink bg-white p-3 text-[13px]">
              <p className="mb-1 font-bold">Auto-fitted text</p>
              <ul className="space-y-0.5 text-steel">
                {shrunk.map((f) => (
                  <li key={f.elementId}>
                    “{f.name}” set at {f.fontSize} pt{f.tracking ? `, tracking ${f.tracking}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {children}
        </div>
      </div>
    </Panel>
  );
}

function ProofReview({ order, proof, onDone }: { order: OrderDetail; proof: ProofSummary; onDone: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [changes, setChanges] = useState(false);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const act = useAction();

  const approve = () =>
    act.run(async () => {
      await api(`/orders/${order.id}/proofs/${proof.id}/approve`, { body: {} });
      setConfirm(false);
      toast(`Proof v${proof.version} approved — sent to production`);
      onDone();
    });

  const requestChanges = () => {
    if (note.trim().length < 3) {
      setNoteError("Tell us what to change");
      return;
    }
    act.run(async () => {
      await api(`/orders/${order.id}/proofs/${proof.id}/request-changes`, { body: { note: note.trim() } });
      setChanges(false);
      toast("Change request sent");
      onDone();
    });
  };

  return (
    <ProofCard order={order} proof={proof} title={`Proof v${proof.version} — awaiting your approval`}>
      <div className="space-y-2 border-[1.5px] border-ink bg-signal/30 p-3">
        <p className="text-sm font-bold">Check spelling, numbers, colours and positions.</p>
        <p className="text-[13px]">Approving locks this exact version for print.</p>
        <Button variant="primary" className="w-full" onClick={() => setConfirm(true)}>
          <CheckCircle2 className="size-4" aria-hidden /> Approve v{proof.version}
        </Button>
        <Button className="w-full" onClick={() => setChanges(true)}>
          <MessageSquareWarning className="size-4" aria-hidden /> Request changes
        </Button>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Approve proof v${proof.version}?`}>
        <div className="space-y-4 text-sm">
          <p>Your job goes into production exactly as shown in proof v{proof.version}. This can&apos;t be undone once printing starts.</p>
          {act.error && <Alert tone="error">{act.error}</Alert>}
          <div className="flex gap-2">
            <Button variant="primary" onClick={approve} busy={act.busy}>
              Approve and print
            </Button>
            <Button onClick={() => setConfirm(false)}>Keep reviewing</Button>
          </div>
        </div>
      </Modal>
      <Modal open={changes} onClose={() => setChanges(false)} title="Request changes">
        <div className="space-y-4">
          <Textarea
            aria-label="What should change?"
            value={note}
            invalid={!!noteError}
            onChange={(e) => {
              setNote(e.target.value);
              setNoteError(null);
            }}
            placeholder="Make the event name larger and change the year to 2027."
            maxLength={2000}
          />
          {noteError && <p className="text-[13px] font-medium text-danger">{noteError}</p>}
          {act.error && <Alert tone="error">{act.error}</Alert>}
          <p className="text-[13px] text-steel">The order moves back to Artwork. You can then edit your design yourself, or our studio will issue the next version.</p>
          <Button variant="primary" onClick={requestChanges} busy={act.busy}>
            Send change request
          </Button>
        </div>
      </Modal>
    </ProofCard>
  );
}

function ReviseArtwork({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isUpload = Boolean(order.artwork_asset_id) && !order.design_snapshot?.elements.some((e) => e.type !== "image" || !e.isArtwork);
  const last = order.proofs.find((p) => p.customer_note);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const a = await upload("artwork", f);
      const r = await api<{ version: number }>(`/orders/${order.id}/artwork`, { method: "PUT", body: { artworkAssetId: a.id } });
      toast(`Proof v${r.version} is ready to review`);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <Panel title="Revise your artwork">
      <div className="space-y-4">
        {last?.customer_note && (
          <p className="border-l-4 border-signal bg-white px-3 py-2 text-sm">
            Your change request on v{last.version}: “{last.customer_note}”
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {!isUpload && (
            <LinkButton href={`/design/${order.product.slug}?order=${order.id}`} variant="primary" className="w-full">
              <PenTool className="size-4" aria-hidden /> Edit design in the browser
            </LinkButton>
          )}
          <label className={cx("inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 border-[1.5px] border-ink bg-paper text-sm font-bold hover:bg-white", busy && "pointer-events-none opacity-60")}>
            {busy ? <Spinner label="Uploading…" /> : <><FileUp className="size-4" aria-hidden /> Upload a new file</>}
            <input ref={input} type="file" className="sr-only" accept=".pdf,.svg,.ai,.png,.jpg,.jpeg" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </div>
        {order.csv_row_count ? <p className="text-[13px] text-steel">Variable-data jobs keep their CSV; uploaded files replace the whole design for every row.</p> : null}
        {error && <Alert tone="error">{error}</Alert>}
        <p className="text-[13px] text-steel">Or wait — our studio can also issue the next proof based on your note.</p>
      </div>
    </Panel>
  );
}
