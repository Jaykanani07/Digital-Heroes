"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Boxes, Gauge, Image as ImageIcon, LayoutTemplate, Mail, Package, Users } from "lucide-react";
import { RequireAuth } from "@/components/guards";
import { cx } from "@/lib/format";

const NAV = [
  { href: "/admin", label: "Overview", Icon: Gauge, exact: true },
  { href: "/admin/orders", label: "Jobs", Icon: Package },
  { href: "/admin/reports", label: "Reports", Icon: BarChart3 },
  { href: "/admin/products", label: "Products", Icon: Boxes },
  { href: "/admin/templates", label: "Templates", Icon: LayoutTemplate },
  { href: "/admin/gallery", label: "Gallery", Icon: ImageIcon },
  { href: "/admin/users", label: "Users", Icon: Users },
  { href: "/admin/emails", label: "E-mail log", Icon: Mail },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <RequireAuth role="admin">
      <div className="border-b-[1.5px] border-ink bg-ink text-paper">
        <div className="mx-auto flex max-w-[1500px] items-center gap-4 overflow-x-auto px-4">
          <span className="label-caps shrink-0 py-3 text-signal">Production console</span>
          <nav className="flex gap-1" aria-label="Admin">
            {NAV.map(({ href, label, Icon, exact }) => {
              const active = exact ? pathname === href : pathname.startsWith(href);
              return (
                <Link key={href} href={href} className={cx("flex shrink-0 items-center gap-1.5 px-3 py-3 text-sm font-bold", active ? "bg-signal text-ink" : "text-paper/80 hover:text-signal")}>
                  <Icon className="size-4" aria-hidden />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      <div className="mx-auto max-w-[1500px] px-4 py-8">{children}</div>
    </RequireAuth>
  );
}
