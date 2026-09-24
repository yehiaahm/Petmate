"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LogOut,
  Settings,
  LayoutDashboard,
  PawPrint,
  Heart,
  ShoppingBag,
  Stethoscope,
  Store,
  Shield,
  CreditCard,
  ChevronDown,
} from "lucide-react";
import { Avatar, Badge } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

export function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    try {
      await api.post("/api/auth", { action: "logout" });
      router.push("/");
      router.refresh();
    } catch {
      toast.error("We could not sign you out", "Please try again.");
      setSigningOut(false);
    }
  }

  const isStaff =
    user.roles.includes("ADMIN") ||
    user.roles.includes("SUPER_ADMIN") ||
    user.roles.includes("MODERATOR");
  const isClinic = user.roles.includes("CLINIC_ADMIN") || user.roles.includes("VET");
  const isSeller = user.roles.includes("SELLER");

  const groups: { label?: string; items: { href: string; label: string; icon: typeof PawPrint }[] }[] = [
    {
      items: [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/dashboard/pets", label: "My pets", icon: PawPrint },
        { href: "/dashboard/listings", label: "My listings", icon: Heart },
        { href: "/dashboard/orders", label: "Orders & purchases", icon: ShoppingBag },
      ],
    },
    ...(isClinic
      ? [{ label: "Clinic", items: [{ href: "/clinic", label: "Clinic console", icon: Stethoscope }] }]
      : []),
    ...(isSeller
      ? [{ label: "Shop", items: [{ href: "/sell", label: "Seller console", icon: Store }] }]
      : []),
    ...(isStaff
      ? [{ label: "Staff", items: [{ href: "/admin", label: "Admin", icon: Shield }] }]
      : []),
    {
      items: [
        { href: "/settings/billing", label: "Plan & billing", icon: CreditCard },
        { href: "/settings", label: "Settings", icon: Settings },
      ],
    },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1.5 rounded-full p-0.5 pe-1.5 transition-colors hover:bg-bg-sunken"
      >
        <Avatar src={user.avatarUrl} name={user.name} size="sm" />
        <ChevronDown
          className={cn("size-3.5 text-fg-subtle transition-transform", open && "rotate-180")}
          aria-hidden
        />
        <span className="sr-only">Open account menu</span>
      </button>

      {open && (
        <div
          role="menu"
          className="animate-fade absolute end-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-bg-elevated shadow-[var(--shadow-pop)]"
        >
          <div className="border-b border-[var(--border)] p-4">
            <p className="truncate text-sm font-semibold text-fg">{user.name}</p>
            <p className="mt-0.5 truncate text-xs text-fg-muted">{user.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone="brand" size="sm">
                Trust {user.trustScore}
              </Badge>
              {!user.emailVerified && (
                <Badge tone="warning" size="sm">
                  Email unconfirmed
                </Badge>
              )}
            </div>
          </div>

          {groups.map((group, groupIndex) => (
            <div
              key={groupIndex}
              className={groupIndex > 0 ? "border-t border-[var(--border)] py-1.5" : "py-1.5"}
            >
              {group.label && (
                <p className="px-4 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                  {group.label}
                </p>
              )}
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-4 py-2 text-sm text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg"
                >
                  <item.icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              ))}
            </div>
          ))}

          <div className="border-t border-[var(--border)] py-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => void signOut()}
              disabled={signingOut}
              className="flex w-full items-center gap-3 px-4 py-2 text-sm text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg disabled:opacity-50"
            >
              <LogOut className="rtl:-scale-x-100 size-4 shrink-0" aria-hidden />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
