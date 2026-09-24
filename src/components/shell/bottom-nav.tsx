"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, MessageSquare, PawPrint, User } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Mobile bottom bar.
 *
 * Phones get thumb-reachable navigation rather than a shrunken desktop header.
 * Five destinations, because a sixth makes every target too narrow to hit, and
 * `pb-[env(safe-area-inset-bottom)]` keeps it clear of the home indicator.
 */
const ITEMS = [
  { href: "/", label: "Home", icon: Home, exact: true },
  { href: "/pets", label: "Find", icon: Search },
  { href: "/messages", label: "Messages", icon: MessageSquare, authOnly: true },
  { href: "/dashboard/pets", label: "My pets", icon: PawPrint, authOnly: true },
  { href: "/dashboard", label: "Account", icon: User, authOnly: true },
];

export function BottomNav({ signedIn, unread = 0 }: { signedIn: boolean; unread?: number }) {
  const pathname = usePathname();

  const items = signedIn
    ? ITEMS
    : [
        ITEMS[0]!,
        ITEMS[1]!,
        { href: "/clinics", label: "Vets", icon: PawPrint },
        { href: "/store", label: "Store", icon: Search },
        { href: "/login", label: "Sign in", icon: User },
      ];

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                  active ? "text-brand" : "text-fg-subtle hover:text-fg-muted",
                )}
              >
                <span className="relative">
                  <item.icon className="size-5" aria-hidden />
                  {item.href === "/messages" && unread > 0 && (
                    <span className="absolute -right-1.5 -top-1 flex min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold leading-[14px] text-accent-fg">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </span>
                {item.label}
                {active && (
                  <span
                    className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-brand"
                    aria-hidden
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
