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
import { NavLinks, MobileSearchRow } from "./nav-links";

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
    <header className="glass sticky top-0 z-40 border-x-0 border-t-0 border-b border-[var(--border)]">
      <div className="container-wide">
        <div className="flex h-16 items-center gap-3 lg:gap-6">
          <Link href="/" className="shrink-0 rounded-xl" aria-label="PetMate home">
            <Logo size="md" />
          </Link>

          <NavLinks links={primaryLinks} />

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

        {/* Search drops to its own row on small screens rather than being
            hidden — except on the home page, whose hero is a search box. */}
        <MobileSearchRow>
          <SearchBar />
        </MobileSearchRow>
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
      className="relative inline-flex size-10 items-center justify-center rounded-full text-fg-muted transition-[color,background-color,transform] duration-200 hover:bg-bg-sunken hover:text-brand active:scale-90"
      aria-label={count > 0 ? `${label}, ${count} unread` : label}
    >
      {icon}
      {count > 0 && (
        <span className="animate-pop absolute right-0.5 top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-[18px] text-accent-fg ring-2 ring-[var(--bg)]">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
