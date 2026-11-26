"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Alert, Button, Field, Input, PageLoader } from "@/components/ui";
import { AuthShell, safeNext } from "@/components/auth-shell";
import { GoogleSignInButton } from "@/components/google-button";

export default function LoginPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { login, googleLogin, user, loading } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace(safeNext(next, user.role === "admin" ? "/admin" : "/account"));
  }, [loading, user, next, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const f: Record<string, string> = {};
    if (!email.trim()) f.email = "Enter your e-mail";
    if (!password) f.password = "Enter your password";
    setFields(f);
    if (Object.keys(f).length) return;
    setBusy(true);
    setError(null);
    try {
      const u = await login(email.trim(), password);
      router.replace(safeNext(next, u.role === "admin" ? "/admin" : "/account"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign in. Try again.");
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in" sub="Track orders, approve proofs and reorder in one click.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="E-mail" error={fields.email}>
          {(id, d) => <Input id={id} aria-describedby={d} type="email" autoComplete="email" value={email} invalid={!!fields.email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />}
        </Field>
        <Field label="Password" error={fields.password}>
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="current-password" value={password} invalid={!!fields.password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" busy={busy}>
          Sign in
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
          New here?{" "}
          <Link href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-bold text-ink underline">
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
