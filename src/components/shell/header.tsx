import Link from "next/link";
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

/**
 * Site header.
 *
 * A server component, so the signed-in state is correct on first paint with no
 * flash of the wrong nav. The interactive pieces (search, menus) are the only
 * client components.
 */
export async function Header() {
  const auth = await getAuth();

  const [unreadMessages, unreadNotifications, cartItems] = auth
    ? await Promise.all([
        totalUnread(auth.user.id),
        unreadNotificationCount(auth.user.id),
        cartCount(auth.user.id),
      ])
    : [0, 0, 0];

  const primaryLinks = [
    { href: "/pets", label: "Find a pet" },
    { href: "/pets?intent=ADOPTION", label: "Adopt" },
    { href: "/breeding", label: "Breeding" },
    { href: "/clinics", label: "Vets" },
    { href: "/store", label: "Store" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-bg/85 backdrop-blur-md">
      <div className="container-wide">
        <div className="flex h-16 items-center gap-3 lg:gap-6">
          <Link href="/" className="shrink-0" aria-label="PetMate home">
            <Logo size="md" className="hidden sm:inline-flex" />
            <Logo size="md" showWordmark={false} className="sm:hidden" />
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
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

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle className="hidden sm:inline-flex" />

            {auth ? (
              <>
                <IconLink
                  href="/store/cart"
                  label="Basket"
                  count={cartItems}
                  icon={<ShoppingCart className="size-[18px]" aria-hidden />}
                />
                <IconLink
                  href="/messages"
                  label="Messages"
                  count={unreadMessages}
                  icon={<MessageSquare className="size-[18px]" aria-hidden />}
                />
                <IconLink
                  href="/notifications"
                  label="Notifications"
                  count={unreadNotifications}
                  icon={<Bell className="size-[18px]" aria-hidden />}
                />
                <div className="ml-1 hidden sm:block">
                  <UserMenu user={auth.user} />
                </div>
              </>
            ) : (
              <div className="hidden items-center gap-2 sm:flex">
                <ButtonLink href="/login" variant="ghost" size="sm">
                  Sign in
                </ButtonLink>
                <ButtonLink href="/register" size="sm">
                  Join free
                </ButtonLink>
              </div>
            )}

            <MobileNav user={auth?.user ?? null} links={primaryLinks} />
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

function IconLink({
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
  return (
    <Link
      href={href}
      className="relative inline-flex size-9 items-center justify-center rounded-[var(--radius-field)] text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg"
      aria-label={count > 0 ? `${label}, ${count} unread` : label}
    >
      {icon}
      {count > 0 && (
        <span className="absolute right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-accent-fg">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
