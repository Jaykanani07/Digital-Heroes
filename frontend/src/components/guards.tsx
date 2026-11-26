"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { EmptyState, LinkButton, PageLoader } from "./ui";

/** Sends signed-out visitors to /login and back here afterwards. */
export function RequireAuth({ role, children }: { role?: "admin"; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      const next = typeof window !== "undefined" ? window.location.pathname + window.location.search : pathname;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [loading, user, router, pathname]);

  if (loading || !user) return <PageLoader label="Checking your session…" />;
  if (role === "admin" && user.role !== "admin") {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <EmptyState title="Staff only" body="This area is for the Digital Heroes production team." action={<LinkButton href="/account">Go to your account</LinkButton>} />
      </div>
    );
  }
  return <>{children}</>;
}
