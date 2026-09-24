"use client";

import Link from "next/link";
import { useAppPathname } from "@/components/i18n/use-app-pathname";
import {
  LayoutDashboard,
  ShieldAlert,
  Users,
  Landmark,
  LifeBuoy,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function AdminNav({
  can,
}: {
  can: { moderation: boolean; users: boolean; finance: boolean; settings: boolean };
}) {
  const pathname = useAppPathname();

  const items = [
    { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true, show: true },
    { href: "/admin/moderation", label: "Moderation", icon: ShieldAlert, show: can.moderation },
    { href: "/admin/support", label: "Support", icon: LifeBuoy, show: can.moderation },
    { href: "/admin/users", label: "Members", icon: Users, show: can.users },
    { href: "/admin/finance", label: "Finance", icon: Landmark, show: can.finance },
    { href: "/admin/settings", label: "Settings", icon: SlidersHorizontal, show: can.settings },
  ].filter((i) => i.show);

  return (
    <nav aria-label="Console" className="lg:sticky lg:top-24">
      <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.12em] text-brand">
        Staff console
      </p>
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="shrink-0 lg:shrink">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 whitespace-nowrap rounded-[var(--radius-field)] px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-soft text-brand-soft-fg"
                    : "text-fg-muted hover:bg-bg-sunken hover:text-fg",
                )}
              >
                <item.icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
