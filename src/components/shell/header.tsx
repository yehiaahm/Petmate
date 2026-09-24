import Link from "next/link";
import { Suspense } from "react";
import { Bell, MessageSquare, ShoppingCart } from "lucide-react";
import { getAuth } from "@/lib/auth/session";
import { totalUnread } from "@/lib/services/chat.service";
import { unreadNotificationCount } from "@/lib/services/notification.service";
import { cartCount } from "@/lib/services/commerce.service";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { SearchBar } from "./search-bar";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "./theme-toggle";
import { MobileNav } from "./mobile-nav";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { getI18n } from "@/lib/i18n/server";

/**
 * Site header.
 *
 * A server component, so the signed-in state is correct on first paint with no
 * flash of the wrong nav. The interactive pieces (search, menus) are the only
 * client components.
 */
export async function Header() {
  const [auth, { t }] = await Promise.all([getAuth(), getI18n()]);

  const [unreadMessages, unreadNotifications, cartItems] = auth
    ? await Promise.all([
        totalUnread(auth.user.id),
        unreadNotificationCount(auth.user.id),
        cartCount(auth.user.id),
      ])
    : [0, 0, 0];

  const primaryLinks = [
    { href: "/pets", label: t("Find a pet") },
    { href: "/pets?intent=ADOPTION", label: t("Adopt") },
    { href: "/breeding", label: t("Breeding") },
    { href: "/clinics", label: t("Vets") },
    { href: "/store", label: t("Store") },
    { href: "/community", label: t("Community") },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-bg/85 backdrop-blur-md">
      <div className="container-wide">
        <div className="flex h-16 items-center gap-3 lg:gap-6">
          <Link href="/" className="shrink-0" aria-label={t("PetMate home")}>
            <Logo size="md" className="hidden sm:inline-flex" />
            <Logo size="md" showWordmark={false} className="sm:hidden" />
          </Link>

          <nav aria-label={t("Main")} className="hidden items-center gap-1 lg:flex">
            {primaryLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-[var(--radius-field)] px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <SearchBar className="hidden min-w-0 flex-1 md:block lg:max-w-md" />

          <div className="ms-auto flex items-center gap-1">
            <Suspense>
              <LocaleSwitcher signedIn={Boolean(auth)} className="hidden sm:inline-flex" />
            </Suspense>
            <ThemeToggle className="hidden sm:inline-flex" />

            {auth ? (
              <>
                <IconLink
                  href="/store/cart"
                  label={t("Basket")}
                  count={cartItems}
                  icon={<ShoppingCart className="size-[18px]" aria-hidden />}
                />
                <IconLink
                  href="/messages"
                  label={t("Messages")}
                  count={unreadMessages}
                  icon={<MessageSquare className="size-[18px]" aria-hidden />}
                />
                <IconLink
                  href="/notifications"
                  label={t("Notifications")}
                  count={unreadNotifications}
                  icon={<Bell className="size-[18px]" aria-hidden />}
                />
                <div className="ms-1 hidden sm:block">
                  <UserMenu user={auth.user} />
                </div>
              </>
            ) : (
              <div className="hidden items-center gap-2 sm:flex">
                <ButtonLink href="/login" variant="ghost" size="sm">
                  {t("Sign in")}
                </ButtonLink>
                <ButtonLink href="/register" size="sm">
                  {t("Join free")}
                </ButtonLink>
              </div>
            )}

            <Suspense>
              <MobileNav user={auth?.user ?? null} links={primaryLinks} />
            </Suspense>
          </div>
        </div>

        {/* Search drops to its own row on small screens rather than being hidden. */}
        <div className="pb-3 md:hidden">
          <SearchBar />
        </div>
      </div>
    </header>
  );
}

async function IconLink({
  href,
  label,
  count,
  icon,
}: {
  href: string;
  label: string;
  count: number;
  icon: React.ReactNode;
}) {
  const { t } = await getI18n();
  return (
    <Link
      href={href}
      className="relative inline-flex size-9 items-center justify-center rounded-[var(--radius-field)] text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg"
      aria-label={count > 0 ? t("{label}, {count} unread", { label, count }) : label}
    >
      {icon}
      {count > 0 && (
        <span className="absolute end-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-accent-fg">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
