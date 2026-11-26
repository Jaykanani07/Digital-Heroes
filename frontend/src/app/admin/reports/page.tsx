"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { downloadFile, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { formatMoney } from "@/lib/format";
import { PIPELINE, STATUS_LABEL } from "@/lib/types";
import { Button, ErrorState, Field, Input, PageHeader, PageLoader, Panel, Stat, Table, Td, Th, useToast } from "@/components/ui";

interface Report {
  from: string;
  to: string;
  totals: { orders: number; revenue_pence: number; net_pence: number; vat_pence: number; units: number; avg_order_pence: number };
  byDivision: { division: string; slug: string; orders: number; units: number; revenue_pence: number; completed: number }[];
  byProduct: { product: string; division: string; orders: number; units: number; revenue_pence: number }[];
  daily: { day: string; revenue_pence: number; orders: number }[];
  pipeline: { status: string; n: number }[];
  proofStats: { approved: number; changes: number; issued: number };
  customers: { customers: number; new_customers: number };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function Reports() {
  const toast = useToast();
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const { data: r, error, loading, reload } = useApi<Report>(`/admin/reports?from=${from}&to=${to}`);
  const maxDay = Math.max(1, ...(r?.daily.map((d) => d.revenue_pence) || [1]));
  const maxDiv = Math.max(1, ...(r?.byDivision.map((d) => d.revenue_pence) || [1]));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports and analytics"
        title="Numbers."
        actions={
          <Button variant="primary" onClick={() => downloadFile(`/admin/reports/xero.csv?from=${from}&to=${to}`).catch((e) => toast(errorMessage(e), "error"))}>
            <Download className="size-4" aria-hidden /> Export for Xero (CSV)
          </Button>
        }
      >
        Paid orders in the selected period. The Xero export uses the sales-invoice import format.
      </PageHeader>
      <div className="flex flex-wrap items-end gap-3 border-[1.5px] border-ink bg-paper p-3">
        <Field label="From">{(id) => <Input id={id} type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />}</Field>
        <Field label="To">{(id) => <Input id={id} type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />}</Field>
        <div className="flex gap-1.5">
          {[7, 30, 90, 365].map((n) => (
            <Button key={n} size="sm" onClick={() => { setFrom(iso(new Date(Date.now() - (n - 1) * 86400000))); setTo(iso(new Date())); }}>
              {n === 365 ? "12 months" : `${n} days`}
            </Button>
          ))}
        </div>
      </div>
      {loading && !r && <PageLoader />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Revenue (inc. GST)" value={formatMoney(r.totals.revenue_pence)} hint={`${formatMoney(r.totals.net_pence)} net · ${formatMoney(r.totals.vat_pence)} GST`} />
            <Stat label="Paid orders" value={r.totals.orders} hint={`Avg ${formatMoney(r.totals.avg_order_pence)}`} />
            <Stat label="Units produced" value={r.totals.units.toLocaleString("en-GB")} />
            <Stat label="Proof approvals" value={r.proofStats.approved} hint={`${r.proofStats.changes} change requests · ${r.proofStats.issued} issued`} />
          </div>

          {r.daily.length <= 120 && (
            <Panel title="Daily revenue">
              <div className="flex h-44 items-end gap-[2px]" role="img" aria-label="Daily revenue bar chart">
                {r.daily.map((d) => (
                  <div key={d.day} className="group relative flex-1" style={{ height: "100%" }}>
                    <div className="absolute bottom-0 w-full bg-ink group-hover:bg-signal-dark" style={{ height: `${Math.max(d.revenue_pence ? 3 : 1, (d.revenue_pence / maxDay) * 100)}%`, background: d.revenue_pence ? undefined : "rgb(20 20 20 / 0.12)" }} />
                    <span className="pointer-events-none absolute -top-9 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap border border-ink bg-paper px-1.5 py-0.5 text-[11px] group-hover:block">
                      {d.day.slice(5)} · {formatMoney(d.revenue_pence)} · {d.orders}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-steel">
                <span>{r.from}</span>
                <span>{r.to}</span>
              </div>
            </Panel>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Throughput by product family">
              <ul className="space-y-3">
                {r.byDivision.map((d) => (
                  <li key={d.slug} className="text-sm">
                    <div className="mb-1 flex justify-between gap-2">
                      <span className="font-bold">{d.division}</span>
                      <span>{formatMoney(d.revenue_pence)} · {d.orders} orders · {Number(d.units).toLocaleString("en-GB")} units</span>
                    </div>
                    <div className="h-3 border border-ink bg-white">
                      <div className="h-full bg-signal" style={{ width: `${(d.revenue_pence / maxDiv) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Live pipeline (paid jobs)">
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {PIPELINE.filter((s) => s !== "quote").map((s) => (
                  <li key={s} className="border-[1.5px] border-ink bg-white p-2">
                    <p className="label-caps text-steel">{STATUS_LABEL[s]}</p>
                    <p className="font-display text-4xl">{r.pipeline.find((p) => p.status === s)?.n ?? 0}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-steel">{r.customers.customers} customers · {r.customers.new_customers} joined in this period</p>
            </Panel>
          </div>

          <Table>
            <thead>
              <tr>
                <Th>Top products</Th>
                <Th>Family</Th>
                <Th className="text-right">Orders</Th>
                <Th className="text-right">Units</Th>
                <Th className="text-right">Revenue</Th>
              </tr>
            </thead>
            <tbody>
              {r.byProduct.length === 0 && (
                <tr><Td colSpan={5} className="text-steel">No paid orders in this period.</Td></tr>
              )}
              {r.byProduct.map((p) => (
                <tr key={p.product}>
                  <Td className="font-bold">{p.product}</Td>
                  <Td>{p.division}</Td>
                  <Td className="text-right">{p.orders}</Td>
                  <Td className="text-right">{Number(p.units).toLocaleString("en-GB")}</Td>
                  <Td className="text-right">{formatMoney(p.revenue_pence)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}
