"use client";

import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi, useDebounced } from "@/lib/hooks";
import { formatDate, formatMoney } from "@/lib/format";
import { Alert, Badge, Button, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, Table, Td, Th, useToast } from "@/components/ui";

interface Row {
  id: string;
  email: string;
  full_name: string;
  company: string | null;
  role: "customer" | "admin";
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  orders: number;
  spent_pence: number;
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const dq = useDebounced(q, 300);
  const params = new URLSearchParams();
  if (dq) params.set("q", dq);
  if (role) params.set("role", role);
  const { data, error, loading, reload } = useApi<Row[]>(`/admin/users?${params.toString()}`);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", password: "", role: "customer", company: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = async (u: Row, body: object, msg: string) => {
    try {
      await api(`/admin/users/${u.id}`, { method: "PATCH", body });
      toast(msg);
      reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/admin/users", { body: { ...form, company: form.company || null } });
      setCreating(false);
      setForm({ fullName: "", email: "", password: "", role: "customer", company: "" });
      toast("User created");
      reload();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Users and roles" title="Users" actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New user</Button>}>
        Customers see only their own orders, proofs and invoices. Administrators run the production console. Deactivated users are signed out immediately.
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-steel" aria-hidden />
          <Input aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, e-mail or company" className="pl-8" />
        </div>
        <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} className="w-44">
          <option value="">All roles</option>
          <option value="customer">Customers</option>
          <option value="admin">Administrators</option>
        </Select>
      </div>
      {loading && !data && <PageLoader />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <Table>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Role</Th>
              <Th>Orders</Th>
              <Th>Joined / last sign-in</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id} className="hover:bg-white">
                <Td>
                  <p className="font-bold">{u.full_name}</p>
                  <p className="text-[12px] text-steel">{u.email}{u.company ? ` · ${u.company}` : ""}</p>
                </Td>
                <Td><Badge status={u.role}>{u.role === "admin" ? "Admin" : "Customer"}</Badge></Td>
                <Td>{u.orders} · {formatMoney(u.spent_pence)}</Td>
                <Td className="text-[13px]">{formatDate(u.created_at)} / {formatDate(u.last_login_at)}</Td>
                <Td><Badge status={u.is_active ? "active" : "inactive"}>{u.is_active ? "Active" : "Deactivated"}</Badge></Td>
                <Td className="text-right">
                  {u.id === me?.id ? (
                    <span className="text-[12px] text-steel">You</span>
                  ) : (
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" onClick={() => update(u, { role: u.role === "admin" ? "customer" : "admin" }, u.role === "admin" ? "Admin access removed" : "Made administrator")}>
                        {u.role === "admin" ? "Make customer" : "Make admin"}
                      </Button>
                      <Button size="sm" variant={u.is_active ? "danger" : "secondary"} onClick={() => update(u, { isActive: !u.is_active }, u.is_active ? "User deactivated" : "User reactivated")}>
                        {u.is_active ? "Deactivate" : "Reactivate"}
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New user">
        <form onSubmit={create} className="space-y-3">
          <Field label="Full name">{(id) => <Input id={id} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />}</Field>
          <Field label="E-mail">{(id) => <Input id={id} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
          <Field label="Company (optional)">{(id) => <Input id={id} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />}</Field>
          <Field label="Temporary password" hint="At least 8 characters. Share it securely.">{(id) => <Input id={id} type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}</Field>
          <Field label="Role">
            {(id) => (
              <Select id={id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="customer">Customer</option>
                <option value="admin">Administrator</option>
              </Select>
            )}
          </Field>
          {err && <Alert tone="error">{err}</Alert>}
          <Button type="submit" variant="primary" busy={busy}>Create user</Button>
        </form>
      </Modal>
    </div>
  );
}
