"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppPathname } from "@/components/i18n/use-app-pathname";
import { Menu, X, LogOut, Shield, Stethoscope, Store, ChevronRight, CalendarHeart, BedDouble } from "lucide-react";
import { features } from "@/lib/features";
import { Avatar, Badge } from "@/components/ui/primitives";
import { Button, ButtonLink } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { Logo } from "@/components/brand/logo";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { useI18n } from "@/components/i18n/i18n-provider";
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
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const pathname = useAppPathname();
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
    { href: "/breeds", label: t("Breed guide") },
    { href: "/pricing", label: t("Plans & pricing") },
    { href: "/trust", label: t("How we keep you safe") },
    { href: "/about", label: t("About PetMate") },
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
        aria-label={t("Open menu")}
        aria-expanded={open}
      >
        <Menu className="size-5" aria-hidden />
      </button>

      {/* Portalled to <body>: the header's frosted glass (backdrop-filter)
          would otherwise become the containing block for this fixed sheet
          and clip it to the header's height. Context, and so the language,
          still flows through a portal. */}
      {open && createPortal(
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div
            className="animate-fade absolute inset-0 bg-[var(--overlay)] backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("Menu")}
            className="animate-slide-in-end absolute inset-y-0 end-0 flex w-[min(21rem,88vw)] flex-col overflow-hidden rounded-s-[1.75rem] bg-bg-elevated shadow-[var(--shadow-pop)]"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
              <Logo size="sm" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex size-10 items-center justify-center rounded-full text-fg-muted transition-transform hover:rotate-90 hover:bg-bg-sunken hover:text-fg"
                aria-label={t("Close menu")}
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
                      {t("Trust {score}", { score: user.trustScore })}
                    </Badge>
                  </div>
                </Link>
              )}

              <nav className="p-2" aria-label={t("Mobile")}>
                {links.map((link, index) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    style={{ "--d": `${80 + index * 45}ms` } as React.CSSProperties}
                    className="enter group flex items-center justify-between rounded-2xl px-3.5 py-3.5 text-[15px] font-semibold text-fg transition-colors hover:bg-brand-soft hover:text-brand-soft-fg"
                  >
                    {link.label}
                    <ChevronRight
                      className="size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-brand-soft-fg rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
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
                    {t(link.label)}
                  </Link>
                ))}
              </div>

              {user && (
                <div className="border-t border-[var(--border)] p-2">
                  <Link
                    href="/dashboard/bookings"
                    className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm text-fg-muted hover:bg-bg-sunken hover:text-fg"
                  >
                    <CalendarHeart className="size-4" aria-hidden /> {t("Hotel & training bookings")}
                  </Link>
                  {user.roles.includes("CARE_PROVIDER") && (
                    <Link
                      href="/provider"
                      className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm text-fg-muted hover:bg-bg-sunken hover:text-fg"
                    >
                      <BedDouble className="size-4" aria-hidden /> {t("Provider console")}
                    </Link>
                  )}
                  {features.clinics && (user.roles.includes("CLINIC_ADMIN") || user.roles.includes("VET")) ? (
                    <Link
                      href="/clinic"
                      className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm text-fg-muted hover:bg-bg-sunken hover:text-fg"
                    >
                      <Stethoscope className="size-4" aria-hidden /> {t("Clinic console")}
                    </Link>
                  ) : null}
                  {user.roles.includes("SELLER") && (
                    <Link
                      href="/sell"
                      className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm text-fg-muted hover:bg-bg-sunken hover:text-fg"
                    >
                      <Store className="size-4" aria-hidden /> {t("Seller console")}
                    </Link>
                  )}
                  {(user.roles.includes("ADMIN") ||
                    user.roles.includes("SUPER_ADMIN") ||
                    user.roles.includes("MODERATOR")) && (
                    <Link
                      href="/admin"
                      className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm text-fg-muted hover:bg-bg-sunken hover:text-fg"
                    >
                      <Shield className="size-4" aria-hidden /> {t("Admin")}
                    </Link>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3 border-t border-[var(--border)] p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-fg-muted">{t("Language")}</span>
                <LocaleSwitcher signedIn={Boolean(user)} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-fg-muted">{t("Appearance")}</span>
                <ThemeToggle />
              </div>

              {user ? (
                <Button variant="outline" fullWidth onClick={() => void signOut()}>
                  <LogOut className="rtl:-scale-x-100 size-4" aria-hidden />
                  {t("Sign out")}
                </Button>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <ButtonLink href="/login" variant="outline">
                    {t("Sign in")}
                  </ButtonLink>
                  <ButtonLink href="/register">{t("Join free")}</ButtonLink>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
