import Link from "next/link";
import type { Metadata } from "next";
import { Search, Home } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Page not found"),
  robots: { index: false, follow: true },
};
}

/**
 * 404.
 *
 * A dead end is where people leave, so this one offers the three things they
 * were most likely looking for rather than only apologising.
 */
export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="container-page py-6">
        <Link href="/" aria-label={t("PetMate home")}>
          <Logo size="sm" />
        </Link>
      </header>

      <main id="main" className="container-page flex flex-1 items-center justify-center py-16">
        <div className="max-w-md text-center">
          <p className="font-display text-6xl font-semibold text-brand">404</p>

          <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight text-fg">
            {t("We could not find that page")}
          </h1>

          <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">
            {t("It may have been removed, or the link might be wrong. If you were looking at a listing, it may have found a home.")}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <ButtonLink href="/pets">
              <Search className="size-4" aria-hidden />
              {t("Browse pets")}
            </ButtonLink>
            <ButtonLink href="/" variant="outline">
              <Home className="size-4" aria-hidden />
              {t("Go home")}
            </ButtonLink>
          </div>

          <nav aria-label={t("Popular pages")} className="mt-10 border-t border-[var(--border)] pt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
              {t("Popular")}
            </p>
            <ul className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
              {[
                { href: "/pets?intent=ADOPTION", label: "Pets for adoption" },
                { href: "/clinics", label: "Find a vet" },
                { href: "/store", label: "Pet store" },
                { href: "/breeds", label: "Breed guide" },
              ].map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-fg-muted hover:text-fg hover:underline">
                    {t(link.label)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </main>
    </div>
  );
}
