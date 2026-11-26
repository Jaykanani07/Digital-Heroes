"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { formatDateTime } from "@/lib/format";
import { Badge, ErrorState, Modal, PageHeader, PageLoader, Table, Td, Th } from "@/components/ui";

interface Row {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  status: "sent" | "logged" | "failed";
  error: string | null;
  order_number: string | null;
  created_at: string;
}

export default function EmailLog() {
  const { data, error, loading, reload } = useApi<Row[]>("/admin/notifications");
  const [open, setOpen] = useState<Row | null>(null);
  return (
    <div>
      <PageHeader eyebrow="Notifications" title="E-mail log">
        Order confirmations, proof notices, status updates and completion alerts. “Logged” means SMTP isn&apos;t configured, so the message was recorded instead of sent.
      </PageHeader>
      {loading && <PageLoader />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>To</Th>
              <Th>Subject</Th>
              <Th>Order</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr><Td colSpan={5} className="text-steel">No e-mails yet.</Td></tr>
            )}
            {data.map((n) => (
              <tr key={n.id} className="cursor-pointer hover:bg-white" onClick={() => setOpen(n)}>
                <Td className="whitespace-nowrap text-[13px]">{formatDateTime(n.created_at)}</Td>
                <Td>{n.to_email}</Td>
                <Td className="font-bold">{n.subject}</Td>
                <Td>{n.order_number || "—"}</Td>
                <Td><Badge status={n.status === "sent" ? "approved" : n.status === "failed" ? "changes_requested" : "superseded"}>{n.status}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open?.subject || ""}>
        {open && (
          <div className="space-y-2 text-sm">
            <p className="text-steel">To {open.to_email} · {formatDateTime(open.created_at)}</p>
            {open.error && <p className="text-danger">{open.error}</p>}
            <pre className="whitespace-pre-wrap border-[1.5px] border-ink bg-white p-3 font-sans">{open.body}</pre>
          </div>
        )}
      </Modal>
    </div>
  );
}
