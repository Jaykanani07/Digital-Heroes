"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bike, Calculator, Hash, LogOut, Menu, Stamp, Sticker, Trophy, User, Wrench, X, Zap } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cx } from "@/lib/format";
import { buttonClass } from "./ui";

export const DIVISION_ICON: Record<string, typeof Sticker> = {
  "labels-stickers": Sticker,
  "race-event-numbers": Hash,
  "mtb-boards": Bike,
  stamps: Stamp,
  trophies: Trophy,
  "laser-cut": Zap,
};

export function DivisionIcon({ slug, className }: { slug: string; className?: string }) {
  const Icon = DIVISION_ICON[slug] || Wrench;
  return <Icon className={className} aria-hidden strokeWidth={1.75} />;
}

export function Logo({ light }: { light?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="Digital Heroes home">
      <span className="grid size-9 place-items-center border-[1.5px] border-ink bg-signal font-display text-2xl leading-none text-ink transition-transform group-hover:-rotate-6">
        DH
      </span>
      <span className={cx("hidden font-display text-[26px] leading-none sm:block", light ? "text-paper" : "text-ink")}>Digital Heroes</span>
    </Link>
  );
}

const NAV = [
  { href: "/products", label: "Products" },
  { href: "/calculator", label: "Price calculator" },
  { href: "/gallery", label: "Gallery" },
];

export function SiteHeader() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const signOut = () => {
    logout();
    router.push("/");
  };

  return (
    <header className="sticky top-0 z-40 border-b-[1.5px] border-ink bg-concrete/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx("px-3 py-2 text-sm font-bold hover:bg-ink/5", pathname.startsWith(n.href) && "bg-ink text-signal hover:bg-ink")}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          {user ? (
            <>
              {user.role === "admin" && (
                <Link href="/admin" className={buttonClass("dark", "sm")}>
                  <Wrench className="size-4" aria-hidden /> Production
                </Link>
              )}
              <Link href="/account" className={buttonClass("secondary", "sm")}>
                <User className="size-4" aria-hidden /> {user.full_name.split(" ")[0]}
              </Link>
              <button onClick={signOut} className={buttonClass("ghost", "sm")} aria-label="Sign out">
                <LogOut className="size-4" />
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className={buttonClass("ghost", "sm")}>
                Sign in
              </Link>
              <Link href="/register" className={buttonClass("primary", "sm")}>
                Create account
              </Link>
            </>
          )}
        </div>
        <button className="grid size-10 place-items-center border-[1.5px] border-ink bg-paper md:hidden" onClick={() => setOpen((o) => !o)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t-[1.5px] border-ink bg-paper md:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col px-4 py-2" aria-label="Mobile">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="border-b border-ink/10 py-3 font-bold">
                {n.label}
              </Link>
            ))}
            {user ? (
              <>
                {user.role === "admin" && (
                  <Link href="/admin" className="border-b border-ink/10 py-3 font-bold">
                    Production console
                  </Link>
                )}
                <Link href="/account" className="border-b border-ink/10 py-3 font-bold">
                  Your account
                </Link>
                <button onClick={signOut} className="py-3 text-left font-bold">
                  Sign out
                </button>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2 py-3">
                <Link href="/login" className={buttonClass("secondary", "md")}>
                  Sign in
                </Link>
                <Link href="/register" className={buttonClass("primary", "md")}>
                  Create account
                </Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t-[1.5px] border-ink bg-ink text-paper">
      <div className="hazard h-2" aria-hidden />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:grid-cols-4">
        <div className="space-y-3 md:col-span-2">
          <Logo light />
          <p className="max-w-sm text-sm text-paper/70">
            Six print divisions under one roof. Configure, design, proof and order online — we run the job from quote to dispatch.
          </p>
        </div>
        <div className="space-y-2 text-sm">
          <p className="label-caps text-signal">Print</p>
          <Link className="block text-paper/80 hover:text-signal" href="/products">All products</Link>
          <Link className="block text-paper/80 hover:text-signal" href="/calculator">Instant price calculator</Link>
          <Link className="block text-paper/80 hover:text-signal" href="/gallery">Work gallery</Link>
        </div>
        <div className="space-y-2 text-sm">
          <p className="label-caps text-signal">Account</p>
          <Link className="block text-paper/80 hover:text-signal" href="/account">Dashboard</Link>
          <Link className="block text-paper/80 hover:text-signal" href="/account/orders">Orders and reorders</Link>
          <Link className="block text-paper/80 hover:text-signal" href="/account/designs">Saved designs</Link>
        </div>
      </div>
      <div className="border-t border-paper/15">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 text-xs text-paper/50 sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} Digital Heroes · digitalheroes.co.in</span>
          <span>Prices shown include GST · Card payments by Stripe</span>
        </div>
      </div>
    </footer>
  );
}

export function CalcIcon(props: { className?: string }) {
  return <Calculator {...props} aria-hidden />;
}
