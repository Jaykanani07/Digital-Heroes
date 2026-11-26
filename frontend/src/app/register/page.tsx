"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Alert, Button, Field, Input, PageLoader } from "@/components/ui";
import { AuthShell, safeNext } from "@/components/auth-shell";
import { GoogleSignInButton } from "@/components/google-button";

export default function RegisterPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const { register, googleLogin, user, loading } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [form, setForm] = useState({ fullName: "", email: "", company: "", phone: "", password: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace(safeNext(next, "/account"));
  }, [loading, user, next, router]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (fields[k]) setFields((x) => ({ ...x, [k]: "" }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const f: Record<string, string> = {};
    if (form.fullName.trim().length < 2) f.fullName = "Enter your name";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) f.email = "Enter a valid e-mail address";
    if (form.password.length < 8) f.password = "Use at least 8 characters";
    else if (!/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) f.password = "Include at least one letter and one number";
    setFields(f);
    if (Object.keys(f).length) return;
    setBusy(true);
    setError(null);
    try {
      await register({ fullName: form.fullName.trim(), email: form.email.trim(), password: form.password, company: form.company.trim() || undefined, phone: form.phone.trim() || undefined });
      router.replace(safeNext(next, "/account"));
    } catch (err) {
      if (err instanceof ApiError && err.details?.fields) setFields(err.details.fields);
      setError(err instanceof ApiError ? err.message : "Couldn't create your account. Try again.");
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create account" sub="Save designs, approve proofs and reorder past jobs in one click.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Full name" error={fields.fullName}>
          {(id, d) => <Input id={id} aria-describedby={d} autoComplete="name" value={form.fullName} invalid={!!fields.fullName} onChange={set("fullName")} placeholder="Alex Morgan" />}
        </Field>
        <Field label="E-mail" error={fields.email}>
          {(id, d) => <Input id={id} aria-describedby={d} type="email" autoComplete="email" value={form.email} invalid={!!fields.email} onChange={set("email")} placeholder="you@company.com" />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company (optional)">{(id) => <Input id={id} autoComplete="organization" value={form.company} onChange={set("company")} />}</Field>
          <Field label="Phone (optional)">{(id) => <Input id={id} type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} />}</Field>
        </div>
        <Field label="Password" error={fields.password} hint="At least 8 characters with a letter and a number.">
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" value={form.password} invalid={!!fields.password} onChange={set("password")} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" busy={busy}>
          Create account
        </Button>
        <GoogleSignInButton
          disabled={busy}
          onCredential={async (cred) => {
            setBusy(true);
            setError(null);
            try {
              const u = await googleLogin(cred);
              router.replace(safeNext(next, u.role === "admin" ? "/admin" : "/account"));
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Couldn't sign in with Google. Try again.");
              setBusy(false);
            }
          }}
        />
        <p className="text-center text-sm text-steel">
          Already have an account?{" "}
          <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-bold text-ink underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
