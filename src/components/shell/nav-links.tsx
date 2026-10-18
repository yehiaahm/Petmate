"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { cn } from "@/lib/utils";

/**
 * Desktop primary navigation.
 *
 * A client island only so it can mark where you are: the current section gets
 * a filled pill, which is the cheapest "you are here" signal there is.
 */
export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  return (
    <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex xl:gap-1">
      {/* useSearchParams needs a Suspense boundary; the fallback is the same
          links without the active state. */}
      <Suspense fallback={<Links links={links} active={null} />}>
        <ActiveLinks links={links} />
      </Suspense>
    </nav>
  );
}

function ActiveLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = `${pathname}${params.toString() ? `?${params.toString()}` : ""}`;

  // The most specific match wins, so "/pets?intent=ADOPTION" lights up Adopt
  // rather than both Adopt and "Find a pet".
  const active =
    links
      .filter((link) => {
        const [path, query] = link.href.split("?");
        if (query) return current.startsWith(link.href);
        return pathname === path || pathname.startsWith(`${path}/`);
      })
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;

  return <Links links={links} active={active} />;
}

function Links({
  links,
  active,
}: {
  links: { href: string; label: string }[];
  active: string | null;
}) {
  return (
    <>
      {links.map((link) => {
        const isActive = link.href === active;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              // Tighter between lg and xl, where seven sections and the search
              // box share one row; a label never breaks onto two lines.
              "relative whitespace-nowrap rounded-full px-2.5 py-2 text-sm font-semibold transition-colors duration-200 xl:px-3.5",
              isActive
                ? "bg-brand-soft text-brand-soft-fg"
                : "text-fg-muted hover:bg-bg-sunken hover:text-fg",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}

/** The phone-width search row, left out on the home page where the hero is one. */
export function MobileSearchRow({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return <div className="pb-3 md:hidden">{children}</div>;
}
