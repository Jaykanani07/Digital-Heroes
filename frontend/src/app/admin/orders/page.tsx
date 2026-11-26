"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Search, X } from "lucide-react";
import { useApi, useDebounced } from "@/lib/hooks";
import { cx, formatDate, formatMoney, mm } from "@/lib/format";
import { PIPELINE, STATUS_LABEL, type Division } from "@/lib/types";
import { Badge, Button, EmptyState, ErrorState, Field, Input, PageHeader, PageLoader, Select, Table, Td, Th } from "@/components/ui";

interface Row {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  quantity: number;
  total_pence: number;
  currency: string;
  files_ready: boolean;
  archived: boolean;
  created_at: string;
  paid_at: string | null;
  csv_row_count: number | null;
  config: { widthMm: number; heightMm: number };
  customer_name: string;
  customer_email: string;
  customer_company: string | null;
  product_name: string;
  division_name: string;
  proof_version: number | null;
}

export default function AdminOrdersPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Jobs />
    </Suspense>
  );
}

const KEYS = ["status", "q", "division", "from", "to", "archived", "payment", "page"] as const;

function Jobs() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const get = (k: string) => search.get(k) || "";
  const [q, setQ] = useState(get("q"));
  const dq = useDebounced(q, 300);
  const { data: divisions } = useApi<Division[]>("/catalog/divisions");

  // Filters live in the URL so a filtered view can be bookmarked or shared.
  const setParam = (patch: Record<string, string>) => {
    const p = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (!("page" in patch)) p.delete("page");
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  useEffect(() => {
    if (dq !== get("q")) setParam({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const qs = new URLSearchParams();
  for (const k of KEYS) if (get(k)) qs.set(k, get(k));
  const { data, error, loading, reload } = useApi<{ rows: Row[]; total: number; page: number; pageSize: number; counts: Record<string, number> }>(`/admin/orders?${qs.toString()}`);
  const page = Number(get("page") || 1);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = KEYS.some((k) => k !== "page" && get(k));

  return (
    <div>
      <PageHeader eyebrow="Job database" title="Every job, one queue.">
        Filter by status, customer, date and product family. Files unlock automatically when a proof is approved.
      </PageHeader>

      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Pipeline stage">
        <button role="tab" aria-selected={!get("status")} onClick={() => setParam({ status: "" })} className={cx("h-9 border-[1.5px] border-ink px-3 text-sm font-bold", !get("status") ? "bg-ink text-signal" : "bg-paper")}>
          All
        </button>
        {PIPELINE.map((s) => (
          <button key={s} role="tab" aria-selected={get("status") === s} onClick={() => setParam({ status: s })} className={cx("h-9 border-[1.5px] border-ink px-3 text-sm font-bold", get("status") === s ? "bg-ink text-signal" : "bg-paper hover:bg-white")}>
            {STATUS_LABEL[s]} <span className="ml-1 opacity-60">{data?.counts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-3 border-[1.5px] border-ink bg-paper p-3 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]">
        <Field label="Search">
          {(id) => (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-steel" aria-hidden />
              <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order no., customer, e-mail, company" className="pl-8" />
            </div>
          )}
        </Field>
        <Field label="Product family">
          {(id) => (
            <Select id={id} value={get("division")} onChange={(e) => setParam({ division: e.target.value })}>
              <option value="">All families</option>
              {divisions?.map((d) => (
                <option key={d.slug} value={d.slug}>{d.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="From">{(id) => <Input id={id} type="date" value={get("from")} onChange={(e) => setParam({ from: e.target.value })} />}</Field>
        <Field label="To">{(id) => <Input id={id} type="date" value={get("to")} onChange={(e) => setParam({ to: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Payment">
            {(id) => (
              <Select id={id} value={get("payment") || "all"} onChange={(e) => setParam({ payment: e.target.value === "all" ? "" : e.target.value })}>
                <option value="all">All</option>
                <option value="paid">Paid</option>
                <option value="unpaid">Unpaid</option>
              </Select>
            )}
          </Field>
          <Field label="Archive">
            {(id) => (
              <Select id={id} value={get("archived") || "false"} onChange={(e) => setParam({ archived: e.target.value === "false" ? "" : e.target.value })}>
                <option value="false">Live</option>
                <option value="true">Archived</option>
                <option value="all">Both</option>
              </Select>
            )}
          </Field>
        </div>
      </div>
      {filtered && (
        <button onClick={() => { setQ(""); router.replace(pathname); }} className="mb-3 inline-flex items-center gap-1 text-sm font-bold underline">
          <X className="size-4" aria-hidden /> Clear filters
        </button>
      )}

      {loading && !data && <PageLoader />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.rows.length === 0 && <EmptyState title="No jobs match" body="Try a different stage, family or date range." />}
      {data && data.rows.length > 0 && (
        <>
          <Table className={cx(loading && "opacity-60")}>
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Customer</Th>
                <Th>Product</Th>
                <Th>Stage</Th>
                <Th>Production files</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-white" onClick={() => router.push(`/admin/orders/${r.id}`)}>
                  <Td>
                    <Link href={`/admin/orders/${r.id}`} className="font-bold hover:underline" onClick={(e) => e.stopPropagation()}>
                      {r.order_number}
                    </Link>
                    <p className="text-[12px] text-steel">{formatDate(r.created_at)}</p>
                  </Td>
                  <Td>
                    <p className="font-bold">{r.customer_name}</p>
                    <p className="text-[12px] text-steel">{r.customer_company || r.customer_email}</p>
                  </Td>
                  <Td>
                    <p className="font-bold">{r.product_name}</p>
                    <p className="flex items-center gap-1 text-[12px] text-steel">
                      {r.division_name} · {mm(r.config.widthMm)}×{mm(r.config.heightMm)} · {r.quantity}
                      {r.csv_row_count ? <FileSpreadsheet className="size-3.5" aria-label="CSV variable data" /> : null}
                    </p>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Badge status={r.payment_status === "paid" ? r.status : "unpaid"}>{r.payment_status === "paid" ? undefined : "Unpaid quote"}</Badge>
                      {r.proof_version && <span className="text-[12px] text-steel">v{r.proof_version}</span>}
                      {r.archived && <Badge status="superseded">Archived</Badge>}
                    </div>
                  </Td>
                  <Td>{r.files_ready ? <Badge status="approved">Ready for production</Badge> : <Badge status="superseded">Locked</Badge>}</Td>
                  <Td className="text-right font-bold">{formatMoney(r.total_pence, r.currency)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-steel">{data.total} job{data.total === 1 ? "" : "s"}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })} aria-label="Previous page">
                <ChevronLeft className="size-4" />
              </Button>
              <span>
                Page {page} of {pages}
              </span>
              <Button size="sm" disabled={page >= pages} onClick={() => setParam({ page: String(page + 1) })} aria-label="Next page">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
