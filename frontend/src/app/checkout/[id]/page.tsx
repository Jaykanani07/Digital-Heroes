"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, CreditCard, Lock, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { describeConfig, formatMoney, formatUnit } from "@/lib/format";
import type { OrderDetail } from "@/lib/types";
import { RequireAuth } from "@/components/guards";
import { DesignSvg } from "@/components/designer/render";
import { Alert, Button, ErrorState, LinkButton, PageLoader, Panel, Spinner } from "@/components/ui";

export default function CheckoutPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<PageLoader />}>
        <Checkout />
      </Suspense>
    </RequireAuth>
  );
}

function Checkout() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const sessionId = search.get("session_id");
  const cancelled = search.get("cancelled");
  const { data: order, error, loading, reload, setData } = useApi<OrderDetail>(`/orders/${id}`);
  const [busy, setBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const confirmed = useRef(false);

  // Returning from Stripe: verify the session server-side (works with or without webhooks).
  useEffect(() => {
    if (!sessionId || !order || order.payment_status === "paid" || confirmed.current) return;
    confirmed.current = true;
    setConfirming(true);
    let tries = 0;
    const check = async () => {
      try {
        const r = await api<{ paid: boolean }>(`/orders/${id}/confirm`, { body: { sessionId } });
        if (r.paid) {
          setData(await api<OrderDetail>(`/orders/${id}`));
          setConfirming(false);
          return;
        }
      } catch (e) {
        setPayError(errorMessage(e));
        setConfirming(false);
        return;
      }
      if (++tries < 10) setTimeout(check, 1500);
      else {
        setConfirming(false);
        setPayError("We're still waiting for the payment confirmation. Refresh in a minute — you won't be charged twice.");
      }
    };
    check();
  }, [sessionId, order, id, setData]);

  if (loading) return <PageLoader />;
  if (error || !order) return <div className="mx-auto max-w-3xl px-4 py-16"><ErrorState message={error || "Order not found"} onRetry={reload} /></div>;

  const pay = async () => {
    setBusy(true);
    setPayError(null);
    try {
      const r = await api<{ mode: "stripe" | "test"; url: string | null }>(`/orders/${order.id}/checkout`, { body: {} });
      if (r.mode === "stripe" && r.url) {
        window.location.href = r.url;
        return;
      }
      await api(`/orders/${order.id}/test-pay`, { body: {} });
      setData(await api<OrderDetail>(`/orders/${order.id}`));
      setBusy(false);
    } catch (e) {
      setPayError(errorMessage(e));
      setBusy(false);
    }
  };

  const removeQuote = async () => {
    if (!window.confirm("Remove this quote? Your saved designs aren't affected.")) return;
    try {
      await api(`/orders/${order.id}`, { method: "DELETE" });
      router.push("/account/orders");
    } catch (e) {
      setPayError(errorMessage(e));
    }
  };

  const paid = order.payment_status === "paid";
  const testMode = order.paymentsMode === "test";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <p className="label-caps text-steel">Checkout · {order.order_number}</p>
      <h1 className="mb-6 font-display text-6xl">{paid ? "Order confirmed." : "Review and pay."}</h1>

      {paid && (
        <Alert tone="success" title="Payment received — thank you" className="mb-6">
          {order.status === "production"
            ? "This reorder uses artwork you already approved, so it's gone straight to production."
            : order.status === "proof"
              ? "Your first proof is ready. Check it and approve it to send the job to production."
              : "We're preparing your proof and will e-mail you when it's ready."}
          <div className="mt-3 flex flex-wrap gap-2">
            <LinkButton href={`/account/orders/${order.id}`} variant="primary" size="sm">
              {order.status === "proof" ? "Review your proof" : "Track this order"}
            </LinkButton>
            <LinkButton href="/products" size="sm">
              Start another job
            </LinkButton>
          </div>
        </Alert>
      )}
      {cancelled && !paid && <Alert tone="warning" className="mb-6">Payment was cancelled. Nothing was charged — you can try again below.</Alert>}
      {confirming && <Spinner label="Confirming your payment with Stripe…" className="mb-6" />}

      <div className="grid gap-6 md:grid-cols-[1fr_360px]">
        <Panel title="Your job">
          <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
            <div className="grid aspect-square place-items-center bg-concrete p-3">
              {order.design_snapshot ? <DesignSvg design={order.design_snapshot} spec={order.product.print_spec} className="max-h-full max-w-full drop-shadow-[2px_2px_0_rgba(20,20,20,0.3)]" /> : null}
            </div>
            <div className="space-y-2 text-sm">
              <p className="font-display text-4xl">{order.product.name}</p>
              <p>{describeConfig(order.config, order.product.materials)}</p>
              <p>
                {order.quantity.toLocaleString("en-GB")} units{order.csv_row_count ? ` — one per CSV row` : ""}
              </p>
              {order.reorderOfOrder && <p className="font-bold">Reorder of {order.reorderOfOrder.order_number} (approved artwork)</p>}
              {!paid && <p className="text-steel">Nothing prints until you approve a proof after payment.</p>}
            </div>
          </div>
        </Panel>

        <div className="space-y-3">
          <div className="border-[1.5px] border-ink bg-ink p-4 text-paper">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-paper/70">{order.quantity} × {formatUnit(order.unit_price_net, order.currency)} (net)</dt><dd>{formatMoney(order.gross_pence, order.currency)}</dd></div>
              {order.discount_pence > 0 && <div className="flex justify-between font-bold text-signal"><dt>Volume discount {order.discount_pct}%</dt><dd>−{formatMoney(order.discount_pence, order.currency)}</dd></div>}
              {order.setup_pence > 0 && <div className="flex justify-between"><dt className="text-paper/70">Setup</dt><dd>{formatMoney(order.setup_pence, order.currency)}</dd></div>}
              <div className="flex justify-between"><dt className="text-paper/70">Subtotal (net)</dt><dd>{formatMoney(order.subtotal_pence, order.currency)}</dd></div>
              <div className="flex justify-between"><dt className="text-paper/70">GST {Math.round(order.vat_rate * 100)}%</dt><dd>{formatMoney(order.vat_pence, order.currency)}</dd></div>
            </dl>
            <div className="mt-3 flex items-end justify-between border-t border-paper/20 pt-3">
              <span className="label-caps text-paper/70">Total inc. GST</span>
              <span className="font-display text-5xl text-signal">{formatMoney(order.total_pence, order.currency)}</span>
            </div>
          </div>
          {payError && <Alert tone="error">{payError}</Alert>}
          {!paid ? (
            <>
              <Button variant="primary" size="lg" className="w-full" onClick={pay} busy={busy}>
                <CreditCard className="size-5" aria-hidden /> {testMode ? "Pay now (test mode)" : `Pay ${formatMoney(order.total_pence, order.currency)}`}
              </Button>
              <p className="flex items-center gap-1.5 text-[12px] text-steel">
                <Lock className="size-3.5" aria-hidden />
                {testMode ? "Test payment mode: no card is charged. Configure Stripe keys to take real payments." : "Secure card payment by Stripe. Card details never touch our servers."}
              </p>
              <button onClick={removeQuote} className="inline-flex items-center gap-1 text-[13px] font-bold text-steel hover:text-danger">
                <Trash2 className="size-3.5" aria-hidden /> Remove this quote
              </button>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm font-bold text-ok">
              <CheckCircle2 className="size-5" aria-hidden /> Paid {order.invoice_number && `· ${order.invoice_number}`}
            </p>
          )}
          <p className="text-[12px] text-steel">
            Questions? Every order is tracked in <Link href="/account/orders" className="underline">your account</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
