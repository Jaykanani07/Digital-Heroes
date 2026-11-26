"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { formatDate, formatMoney } from "@/lib/format";
import { PIPELINE, STATUS_LABEL } from "@/lib/types";
import { Badge, ErrorState, LinkButton, PageHeader, PageLoader, Panel, Stat, Table, Td, Th } from "@/components/ui";

interface Overview {
  open_jobs: number;
  in_production: number;
  awaiting_approval: number;
  artwork: number;
  paid_today: number;
  revenue_month_pence: number;
}

export default function AdminHome() {
  const { data: o, error, loading, reload } = useApi<Overview>("/admin/overview");
  const { data: jobs } = useApi<{ rows: any[]; counts: Record<string, number> }>("/admin/orders?payment=paid");
  if (loading) return <PageLoader />;
  if (error || !o) return <ErrorState message={error || "Couldn't load."} onRetry={reload} />;
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Production console" title="Today on the floor." actions={<LinkButton href="/admin/orders" variant="primary">Open job database</LinkButton>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open jobs" value={o.open_jobs} hint={`${o.paid_today} paid today`} />
        <Stat label="Ready / in production" value={o.in_production} hint="Files unlocked" />
        <Stat label="Waiting on customer" value={o.awaiting_approval} hint={`${o.artwork} need artwork`} />
        <Stat label="Revenue this month" value={formatMoney(o.revenue_month_pence)} hint="Paid, inc. GST" />
      </div>

      <Panel title="Pipeline">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {PIPELINE.map((s, i) => (
            <Link key={s} href={`/admin/orders?status=${s}`} className="group border-[1.5px] border-ink bg-white p-3 hover:bg-signal">
              <p className="label-caps text-steel group-hover:text-ink">
                {String(i + 1).padStart(2, "0")} · {STATUS_LABEL[s]}
              </p>
              <p className="font-display text-5xl">{jobs?.counts[s] ?? 0}</p>
            </Link>
          ))}
        </div>
      </Panel>

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 className="font-display text-4xl">Latest paid jobs</h2>
          <Link href="/admin/orders" className="inline-flex items-center gap-1 text-sm font-bold underline">
            All jobs <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Job</Th>
              <Th>Customer</Th>
              <Th>Product</Th>
              <Th>Status</Th>
              <Th>Files</Th>
            </tr>
          </thead>
          <tbody>
            {(jobs?.rows || []).slice(0, 8).map((r) => (
              <tr key={r.id} className="hover:bg-white">
                <Td>
                  <Link className="font-bold hover:underline" href={`/admin/orders/${r.id}`}>{r.order_number}</Link>
                  <p className="text-[12px] text-steel">{formatDate(r.paid_at)}</p>
                </Td>
                <Td>{r.customer_name}</Td>
                <Td>{r.product_name} × {r.quantity}</Td>
                <Td><Badge status={r.status} /></Td>
                <Td>{r.files_ready ? <Badge status="approved">Ready</Badge> : <Badge status="superseded">Locked</Badge>}</Td>
              </tr>
            ))}
            {jobs && jobs.rows.length === 0 && (
              <tr>
                <Td colSpan={5} className="text-steel">No paid jobs yet.</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
