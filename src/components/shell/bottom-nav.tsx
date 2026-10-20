"use client";

import Link from "next/link";
import {
  House,
  Search,
  MessageSquare,
  PawPrint,
  User,
  BedDouble,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";
import { useAppPathname } from "@/components/i18n/use-app-pathname";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/i18n-provider";

/**
 * Mobile bottom bar.
 *
 * Phones get thumb-reachable navigation rather than a shrunken desktop header.
 * Five destinations, because a sixth makes every target too narrow to hit. It
 * floats as a frosted pill above the content, and a single highlight slides
 * between tabs so the change of place is felt, not just seen.
 */
type Item = { href: string; label: string; icon: LucideIcon; exact?: boolean };

const SIGNED_IN: Item[] = [
  { href: "/", label: "Home", icon: House, exact: true },
  { href: "/pets", label: "Find", icon: Search },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/dashboard/pets", label: "My pets", icon: PawPrint },
  { href: "/dashboard", label: "Account", icon: User },
];

const SIGNED_OUT: Item[] = [
  { href: "/", label: "Home", icon: House, exact: true },
  { href: "/pets", label: "Find", icon: Search },
  { href: "/boarding", label: "Hotels", icon: BedDouble },
  { href: "/store", label: "Store", icon: ShoppingBag },
  { href: "/login", label: "Sign in", icon: User },
];

export function BottomNav({ signedIn, unread = 0 }: { signedIn: boolean; unread?: number }) {
  const { t, dir } = useI18n();
  const pathname = useAppPathname();
  const items = signedIn ? SIGNED_IN : SIGNED_OUT;

  // The most specific match wins, so /dashboard/pets lights "My pets", not
  // "Account" as well.
  const activeIndex = items.reduce<number>((best, item, index) => {
    const match = item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!match) return best;
    if (best === -1 || item.href.length > items[best]!.href.length) return index;
    return best;
  }, -1);

  return (
    <nav
      aria-label={t("Primary")}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] md:hidden"
    >
      <div className="glass pointer-events-auto relative mx-auto max-w-md rounded-[1.75rem] p-1.5 shadow-[var(--shadow-pop)]">
        {/* The sliding highlight. One element moving is calmer than five
            fading in and out. */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-1.5 start-1.5 w-[calc((100%-0.75rem)/5)] rounded-[1.375rem] bg-brand-soft transition-[transform,opacity] duration-500 ease-[var(--ease-spring)]",
            activeIndex === -1 && "opacity-0",
          )}
          // Tabs run right to left in Arabic, so the highlight travels leftwards.
          style={{ transform: `translateX(${Math.max(activeIndex, 0) * (dir === "rtl" ? -100 : 100)}%)` }}
        />

        <ul className="relative grid grid-cols-5">
          {items.map((item, index) => {
            const active = index === activeIndex;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-1 rounded-[1.375rem] text-[10.5px] font-semibold transition-colors duration-300 active:scale-95",
                    active ? "text-brand-soft-fg" : "text-fg-subtle hover:text-fg-muted",
                  )}
                >
                  <span className="relative">
                    <item.icon
                      className={cn(
                        "size-[22px] transition-transform duration-500 ease-[var(--ease-spring)]",
                        active && "-translate-y-0.5 scale-110",
                      )}
                      strokeWidth={active ? 2.4 : 2}
                      aria-hidden
                    />
                    {item.href === "/messages" && unread > 0 && (
                      <span className="animate-pop absolute -end-2 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold leading-4 text-accent-fg ring-2 ring-[var(--bg-elevated)]">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                  </span>
                  {t(item.label)}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
