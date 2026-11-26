"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { cx } from "@/lib/format";
import type { OrderListRow } from "@/lib/types";
import { OrdersTable } from "@/components/orders";
import { EmptyState, ErrorState, LinkButton, PageHeader, PageLoader } from "@/components/ui";

const FILTERS = [
  { k: "all", label: "All" },
  { k: "active", label: "In progress" },
  { k: "proof", label: "Proof to approve" },
  { k: "completed", label: "Completed" },
  { k: "quotes", label: "Unpaid quotes" },
] as const;

export default function OrdersPage() {
  const { data, error, loading, reload } = useApi<OrderListRow[]>("/orders");
  const [f, setF] = useState<(typeof FILTERS)[number]["k"]>("all");
  const rows = useMemo(() => {
    const all = data || [];
    if (f === "active") return all.filter((o) => o.payment_status === "paid" && o.status !== "completed");
    if (f === "proof") return all.filter((o) => o.status === "proof");
    if (f === "completed") return all.filter((o) => o.status === "completed");
    if (f === "quotes") return all.filter((o) => o.payment_status === "unpaid");
    return all;
  }, [data, f]);

  return (
    <div>
      <PageHeader eyebrow="Order history" title="Your orders">
        Every order with its status, proofs and invoice. Reorder any paid job in one click — approved artwork goes straight to production.
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((x) => (
          <button key={x.k} onClick={() => setF(x.k)} className={cx("h-8 border-[1.5px] border-ink px-3 text-[13px] font-bold", f === x.k ? "bg-ink text-signal" : "bg-paper hover:bg-white")}>
            {x.label}
          </button>
        ))}
      </div>
      {loading && <PageLoader />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (rows.length ? <OrdersTable rows={rows} /> : <EmptyState title={data.length ? "Nothing in this view" : "No orders yet"} action={!data.length && <LinkButton href="/products" variant="primary">Start a job</LinkButton>} />)}
    </div>
  );
}
