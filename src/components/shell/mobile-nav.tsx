"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, LogOut, Shield, Stethoscope, Store, ChevronRight } from "lucide-react";
import { Avatar, Badge } from "@/components/ui/primitives";
import { Button, ButtonLink } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { Logo } from "@/components/brand/logo";
import { api } from "@/lib/api-client";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Mobile navigation sheet.
 *
 * Holds the links that do not fit in the bottom bar. Locks body scroll while
 * open, closes on route change, and traps Escape — the three things a sheet
 * gets wrong most often.
 */
export function MobileNav({
  user,
  links,
}: {
  user: SessionUser | null;
  links: { href: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // The drawer closes when the route changes. Storing the route it was opened
  // on and comparing during render does that in one pass; an effect that calls
  // setOpen(false) renders the open drawer first and then closes it.
  const [openedAt, setOpenedAt] = useState(pathname);
  if (open && openedAt !== pathname) {
    setOpen(false);
    setOpenedAt(pathname);
  }

  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onEscape);

    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  async function signOut() {
    await api.post("/api/auth", { action: "logout" }).catch(() => undefined);
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  const secondary = [
    { href: "/breeds", label: "Breed guide" },
    { href: "/pricing", label: "Plans & pricing" },
    { href: "/trust", label: "How we keep you safe" },
    { href: "/about", label: "About PetMate" },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpenedAt(pathname);
          setOpen(true);
        }}
        className="inline-flex size-10 items-center justify-center rounded-full text-fg-muted transition-[color,background-color,transform] duration-200 hover:bg-bg-sunken hover:text-fg active:scale-90 lg:hidden"
        aria-label="Open menu"
        aria-expanded={open}
      >
        <Menu className="size-5" aria-hidden />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div
            className="animate-fade absolute inset-0 bg-[var(--overlay)] backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="animate-slide-in-right absolute inset-y-0 right-0 flex w-[min(21rem,88vw)] flex-col overflow-hidden rounded-l-[1.75rem] bg-bg-elevated shadow-[var(--shadow-pop)]"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
              <Logo size="sm" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex size-10 items-center justify-center rounded-full text-fg-muted transition-transform hover:rotate-90 hover:bg-bg-sunken hover:text-fg"
                aria-label="Close menu"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {user && (
                <Link
                  href="/dashboard"
                  className="flex items-center gap-3 border-b border-[var(--border)] p-4 transition-colors hover:bg-bg-sunken"
                >
                  <Avatar src={user.avatarUrl} name={user.name} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-fg">{user.name}</p>
                    <Badge tone="brand" size="sm" className="mt-1">
                      Trust {user.trustScore}
                    </Badge>
                  </div>
                </Link>
              )}

              <nav className="p-2" aria-label="Mobile">
                {links.map((link, index) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    style={{ "--d": `${80 + index * 45}ms` } as React.CSSProperties}
                    className="enter group flex items-center justify-between rounded-2xl px-3.5 py-3.5 text-[15px] font-semibold text-fg transition-colors hover:bg-brand-soft hover:text-brand-soft-fg"
                  >
                    {link.label}
                    <ChevronRight
                      className="size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-brand-soft-fg"
                      aria-hidden
                    />
                  </Link>
                ))}
              </nav>

              <div className="border-t border-[var(--border)] p-2">
                {secondary.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="block rounded-2xl px-3.5 py-2.5 text-sm text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>

              {user && (
                <div className="border-t border-[var(--border)] p-2">
                  {user.roles.includes("CLINIC_ADMIN") || user.roles.includes("VET") ? (
                    <Link
                      href="/clinic"
                      className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm text-fg-muted hover:bg-bg-sunken hover:text-fg"
                    >
                      <Stethoscope className="size-4" aria-hidden /> Clinic console
                    </Link>
                  ) : null}
                  {user.roles.includes("SELLER") && (
                    <Link
                      href="/sell"
                      className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm text-fg-muted hover:bg-bg-sunken hover:text-fg"
                    >
                      <Store className="size-4" aria-hidden /> Seller console
                    </Link>
                  )}
                  {(user.roles.includes("ADMIN") ||
                    user.roles.includes("SUPER_ADMIN") ||
                    user.roles.includes("MODERATOR")) && (
                    <Link
                      href="/admin"
                      className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm text-fg-muted hover:bg-bg-sunken hover:text-fg"
                    >
                      <Shield className="size-4" aria-hidden /> Admin
                    </Link>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3 border-t border-[var(--border)] p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-fg-muted">Appearance</span>
                <ThemeToggle />
              </div>

              {user ? (
                <Button variant="outline" fullWidth onClick={() => void signOut()}>
                  <LogOut className="size-4" aria-hidden />
                  Sign out
                </Button>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <ButtonLink href="/login" variant="outline">
                    Sign in
                  </ButtonLink>
                  <ButtonLink href="/register">Join free</ButtonLink>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
