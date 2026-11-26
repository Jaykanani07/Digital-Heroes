"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, Repeat } from "lucide-react";
import { api, downloadFile, errorMessage } from "@/lib/api";
import { formatDate, formatMoney, mm } from "@/lib/format";
import type { OrderListRow } from "@/lib/types";
import { Badge, Button, Pipeline, Table, Td, Th, useToast } from "./ui";

/** One-click reorder: creates a new quote from approved artwork and opens checkout. */
export function useReorder() {
  const router = useRouter();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const reorder = async (orderId: string) => {
    setBusyId(orderId);
    try {
      const o = await api<{ id: string }>(`/orders/${orderId}/reorder`, { body: {} });
      router.push(`/checkout/${o.id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusyId(null);
    }
  };
  return { reorder, busyId };
}

export function useInvoice() {
  const toast = useToast();
  return (o: { id: string; invoice_number: string | null; order_number: string }) =>
    downloadFile(`/orders/${o.id}/invoice`, `${o.invoice_number}_${o.order_number}.pdf`).catch((e) => toast(errorMessage(e), "error"));
}

export function OrdersTable({ rows }: { rows: OrderListRow[] }) {
  const { reorder, busyId } = useReorder();
  const invoice = useInvoice();
  return (
    <Table>
      <thead>
        <tr>
          <Th>Order</Th>
          <Th>Product</Th>
          <Th>Status</Th>
          <Th className="text-right">Total</Th>
          <Th className="text-right">Actions</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.id} className="hover:bg-white">
            <Td>
              <Link href={o.payment_status === "paid" ? `/account/orders/${o.id}` : `/checkout/${o.id}`} className="font-bold underline-offset-2 hover:underline">
                {o.order_number}
              </Link>
              <p className="text-[12px] text-steel">{formatDate(o.created_at)}</p>
            </Td>
            <Td>
              <p className="font-bold">{o.product_name}</p>
              <p className="text-[12px] text-steel">
                {mm(o.config.widthMm)} × {mm(o.config.heightMm)} mm · {o.quantity.toLocaleString("en-GB")} units
              </p>
            </Td>
            <Td>
              <div className="w-44 space-y-1.5">
                <div className="flex flex-wrap gap-1">
                  <Badge status={o.payment_status === "paid" ? o.status : "unpaid"}>{o.payment_status === "paid" ? undefined : "Awaiting payment"}</Badge>
                  {o.status === "proof" && <Badge status="pending">Approve v{o.latest_proof?.version}</Badge>}
                </div>
                {o.payment_status === "paid" && <Pipeline status={o.status} compact />}
              </div>
            </Td>
            <Td className="text-right font-bold">{formatMoney(o.total_pence, o.currency)}</Td>
            <Td className="text-right">
              <div className="flex justify-end gap-1.5">
                {o.payment_status === "paid" ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => invoice(o)} aria-label={`Invoice for ${o.order_number}`} title="Download invoice">
                      <Download className="size-4" />
                    </Button>
                    <Button size="sm" onClick={() => reorder(o.id)} busy={busyId === o.id}>
                      <Repeat className="size-4" aria-hidden /> Reorder
                    </Button>
                  </>
                ) : (
                  <Link href={`/checkout/${o.id}`} className="inline-flex h-8 items-center border-[1.5px] border-ink bg-signal px-3 text-[13px] font-bold">
                    Pay
                  </Link>
                )}
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
