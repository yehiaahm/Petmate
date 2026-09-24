"use client";

import Link from "next/link";
import { useAppPathname } from "@/components/i18n/use-app-pathname";
import {
  User,
  BadgeCheck,
  Bell,
  Lock,
  CreditCard,
  LifeBuoy,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/i18n-provider";

const ITEMS = [
  { href: "/settings", label: "Profile", icon: User, exact: true },
  { href: "/settings/verification", label: "Verification", icon: BadgeCheck },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/security", label: "Security", icon: Lock },
  { href: "/settings/billing", label: "Plan & billing", icon: CreditCard },
  { href: "/settings/support", label: "Support", icon: LifeBuoy },
  { href: "/settings/account", label: "Close account", icon: Trash2 },
];

export function SettingsNav() {
  const pathname = useAppPathname();
  const { t } = useI18n();

  return (
    <nav aria-label={t("Settings")} className="lg:sticky lg:top-24">
      <h2 className="mb-3 px-1 font-display text-xl font-semibold text-fg lg:text-2xl">{t("Settings")}</h2>
      {/* Horizontal and scrollable on phones, a rail on desktop. */}
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {ITEMS.map((item) => {
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
                {t(item.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
