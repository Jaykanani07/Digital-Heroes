"use client";

import Link from "next/link";
import { ArrowRight, FileCheck2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import { formatDate, formatMoney } from "@/lib/format";
import type { OrderListRow } from "@/lib/types";
import { OrdersTable } from "@/components/orders";
import { Badge, EmptyState, ErrorState, LinkButton, PageHeader, PageLoader, Panel, Stat } from "@/components/ui";

interface Dashboard {
  counts: { orders: number; active: number; awaiting_approval: number; quotes: number; spent_pence: number; designs: number };
  recent: OrderListRow[];
  activeProofs: { id: string; version: number; status: string; created_at: string; order_id: string; order_number: string; product_name: string }[];
}

export default function AccountDashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi<Dashboard>("/dashboard");
  if (loading) return <PageLoader />;
  if (error || !data) return <ErrorState message={error || "Couldn't load your dashboard."} onRetry={reload} />;
  const c = data.counts;
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Your account" title={`Hi, ${user?.full_name.split(" ")[0]}.`} actions={<LinkButton href="/products" variant="primary">Start a new job</LinkButton>}>
        {user?.company ? `${user.company} · ` : ""}Member since {formatDate(user?.created_at)}
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Orders placed" value={c.orders} hint={`${formatMoney(c.spent_pence)} spent`} />
        <Stat label="In progress" value={c.active} hint="Paid, not yet completed" />
        <Stat label="Proofs to approve" value={c.awaiting_approval} hint={c.awaiting_approval ? "Action needed" : "All clear"} />
        <Stat label="Saved designs" value={c.designs} hint={<Link href="/account/designs" className="underline">Manage</Link>} />
      </div>

      <Panel title="Active proofs" pad={false}>
        {data.activeProofs.length === 0 ? (
          <p className="p-4 text-sm text-steel">No proofs waiting on you. New proofs appear here as soon as they&apos;re ready.</p>
        ) : (
          <ul className="divide-y divide-ink/15">
            {data.activeProofs.map((p) => (
              <li key={p.id}>
                <Link href={`/account/orders/${p.order_id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-white">
                  <span className="flex items-center gap-3">
                    <FileCheck2 className="size-5 shrink-0" aria-hidden />
                    <span>
                      <span className="block font-bold">
                        {p.order_number} · proof v{p.version}
                      </span>
                      <span className="block text-[12px] text-steel">
                        {p.product_name} · issued {formatDate(p.created_at)}
                      </span>
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge status={p.status} />
                    <ArrowRight className="size-4" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 className="font-display text-4xl">Recent orders</h2>
          <Link href="/account/orders" className="text-sm font-bold underline">
            All orders
          </Link>
        </div>
        {data.recent.length === 0 ? (
          <EmptyState title="No orders yet" body="Configure a product, design it and approve your proof — it all lands here." action={<LinkButton href="/products" variant="primary">Browse products</LinkButton>} />
        ) : (
          <OrdersTable rows={data.recent} />
        )}
      </section>
    </div>
  );
}
