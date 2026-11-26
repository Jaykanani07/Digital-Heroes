"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Library, Package, UserCog } from "lucide-react";
import { RequireAuth } from "@/components/guards";
import { useAuth } from "@/lib/auth";
import { cx } from "@/lib/format";

const NAV = [
  { href: "/account", label: "Dashboard", Icon: LayoutDashboard, exact: true },
  { href: "/account/orders", label: "Orders", Icon: Package },
  { href: "/account/designs", label: "Saved designs", Icon: Library },
  { href: "/account/profile", label: "Profile", Icon: UserCog },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AccountFrame>{children}</AccountFrame>
    </RequireAuth>
  );
}

function AccountFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-8 lg:grid-cols-[220px_1fr]">
      <aside className="min-w-0">
        <div className="mb-3 hidden border-[1.5px] border-ink bg-ink p-3 text-paper lg:block">
          <p className="label-caps text-signal">Signed in</p>
          <p className="truncate font-bold">{user?.full_name}</p>
          <p className="truncate text-[12px] text-paper/60">{user?.email}</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Account">
          {NAV.map(({ href, label, Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={cx("flex shrink-0 items-center gap-2 border-[1.5px] px-3 py-2 text-sm font-bold", active ? "border-ink bg-signal" : "border-transparent hover:border-ink/30")}>
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
