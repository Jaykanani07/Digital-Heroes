"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth, type User } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { Alert, Badge, Button, Field, Input, PageHeader, Panel, useToast } from "@/components/ui";

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [p, setP] = useState({ fullName: "", company: "", phone: "" });
  const [pErr, setPErr] = useState<Record<string, string>>({});
  const [pBusy, setPBusy] = useState(false);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwErr, setPwErr] = useState<Record<string, string>>({});
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    if (user) setP({ fullName: user.full_name, company: user.company || "", phone: user.phone || "" });
  }, [user]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (p.fullName.trim().length < 2) return setPErr({ fullName: "Enter your name" });
    setPErr({});
    setPBusy(true);
    try {
      const u = await api<User>("/auth/me", { method: "PATCH", body: { fullName: p.fullName.trim(), company: p.company.trim() || null, phone: p.phone.trim() || null } });
      setUser(u);
      toast("Profile saved");
    } catch (err) {
      setPErr({ fullName: err instanceof ApiError ? err.message : "Couldn't save" });
    } finally {
      setPBusy(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const f: Record<string, string> = {};
    if (!pw.currentPassword) f.currentPassword = "Enter your current password";
    if (pw.newPassword.length < 8) f.newPassword = "Use at least 8 characters";
    else if (!/[A-Za-z]/.test(pw.newPassword) || !/[0-9]/.test(pw.newPassword)) f.newPassword = "Include a letter and a number";
    if (pw.confirm !== pw.newPassword) f.confirm = "Passwords don't match";
    setPwErr(f);
    setPwError(null);
    if (Object.keys(f).length) return;
    setPwBusy(true);
    try {
      await api("/auth/change-password", { body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } });
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      toast("Password changed");
    } catch (err) {
      if (err instanceof ApiError && err.details?.fields) setPwErr(err.details.fields);
      else setPwError(err instanceof ApiError ? err.message : "Couldn't change password");
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Account and profile" title="Profile" />
      <Panel title="Account status">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="label-caps text-steel">E-mail</dt>
            <dd className="font-bold">{user?.email}</dd>
          </div>
          <div>
            <dt className="label-caps text-steel">Account type</dt>
            <dd className="mt-1"><Badge status={user?.role || "customer"}>{user?.role === "admin" ? "Administrator" : "Customer"}</Badge></dd>
          </div>
          <div>
            <dt className="label-caps text-steel">Member since</dt>
            <dd className="font-bold">{formatDate(user?.created_at)}</dd>
          </div>
        </dl>
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Details">
          <form onSubmit={saveProfile} className="space-y-4" noValidate>
            <Field label="Full name" error={pErr.fullName}>{(id, d) => <Input id={id} aria-describedby={d} value={p.fullName} invalid={!!pErr.fullName} onChange={(e) => setP({ ...p, fullName: e.target.value })} />}</Field>
            <Field label="Company">{(id) => <Input id={id} value={p.company} onChange={(e) => setP({ ...p, company: e.target.value })} />}</Field>
            <Field label="Phone">{(id) => <Input id={id} type="tel" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} />}</Field>
            <Button type="submit" variant="primary" busy={pBusy}>Save details</Button>
          </form>
        </Panel>
        <Panel title="Change password">
          <form onSubmit={savePassword} className="space-y-4" noValidate>
            {pwError && <Alert tone="error">{pwError}</Alert>}
            <Field label="Current password" error={pwErr.currentPassword}>{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="current-password" value={pw.currentPassword} invalid={!!pwErr.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}</Field>
            <Field label="New password" error={pwErr.newPassword} hint="At least 8 characters with a letter and a number.">{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" value={pw.newPassword} invalid={!!pwErr.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}</Field>
            <Field label="Confirm new password" error={pwErr.confirm}>{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" value={pw.confirm} invalid={!!pwErr.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />}</Field>
            <Button type="submit" busy={pwBusy}>Change password</Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}
