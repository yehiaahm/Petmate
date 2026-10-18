import Link from "next/link";
import { Heart, Lock } from "lucide-react";
import { Logo, LogoMark } from "@/components/brand/logo";
import { SPECIES_PLURAL, SPECIES } from "@/lib/constants";
import { getI18n } from "@/lib/i18n/server";
import { CookieSettingsLink } from "@/components/analytics/cookie-settings-link";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Find a pet",
    links: [
      { href: "/pets?intent=SALE", label: "Pets for sale" },
      { href: "/pets?intent=ADOPTION", label: "Pets for adoption" },
      { href: "/breeding", label: "Breeding matches" },
      { href: "/breeds", label: "Breed guide" },
    ],
  },
  {
    title: "Care",
    links: [
      { href: "/clinics", label: "Find a vet" },
      { href: "/clinics?emergency=true", label: "Emergency clinics" },
      { href: "/store", label: "Pet store" },
      { href: "/assistant", label: "Care assistant" },
    ],
  },
  {
    title: "Sell & grow",
    links: [
      { href: "/dashboard/listings/new", label: "List a pet" },
      { href: "/sell", label: "Open a shop" },
      { href: "/for-clinics", label: "For veterinary clinics" },
      { href: "/pricing", label: "Plans & pricing" },
    ],
  },
  {
    title: "PetMate",
    links: [
      { href: "/about", label: "About us" },
      { href: "/trust", label: "Trust & safety" },
      { href: "/terms", label: "Terms of service" },
      { href: "/privacy", label: "Privacy policy" },
    ],
  },
];

export async function Footer() {
  const { t } = await getI18n();
  const year = new Date().getFullYear();

  return (
    // Always dark, in either theme: it is the logo tile at page scale, and it
    // closes the page with a clear full stop.
    <footer
      data-theme="dark"
      className="relative isolate mt-16 overflow-hidden rounded-t-[2.25rem] bg-bg text-fg"
    >
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="blob -start-24 -top-24 size-80 bg-[var(--color-lagoon-500)] opacity-25" />
        <div className="blob -end-24 bottom-0 size-80 bg-[var(--color-ocean-500)] opacity-20 [animation-delay:-9s]" />
        <LogoMark onDark className="absolute -bottom-16 -end-16 w-[30rem] opacity-[0.05]" />
      </div>

      <div className="container-page pb-28 pt-14 md:pb-12 lg:pt-16">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_2.6fr]">
          <div>
            <Logo size="lg" />
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-fg-muted">
              {t("Every pet gets a verified identity and a health record that follows them for life — so buying, adopting, breeding and caring for an animal is something you can actually check.")}
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-brand-soft-fg">
                <Lock className="size-3.5" aria-hidden /> {t("Escrow on every sale")}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-accent-soft-fg">
                <Heart className="size-3.5" aria-hidden /> {t("Free to join")}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {COLUMNS.map((column) => (
              <div key={column.title}>
                <h2 className="text-sm font-bold text-fg">{t(column.title)}</h2>
                <ul className="mt-3.5 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="inline-block text-sm text-fg-muted transition-[color,transform] duration-200 hover:translate-x-0.5 hover:text-brand rtl:hover:-translate-x-0.5"
                      >
                        {t(link.label)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Species links: real internal linking for search engines, and a
            genuinely useful shortcut for people. */}
        <nav aria-label={t("Browse by species")} className="mt-12 border-t border-[var(--border)] pt-6">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-fg-subtle">
            {t("Browse by species")}
          </p>
          <ul className="flex flex-wrap gap-2">
            {SPECIES.map((species) => (
              <li key={species}>
                <Link
                  href={`/pets?species=${species}`}
                  className="inline-block rounded-full border border-[var(--border)] px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-[var(--brand)] hover:text-brand"
                >
                  {t(SPECIES_PLURAL[species])}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-8 flex flex-col gap-3 border-t border-[var(--border)] pt-6 text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>{t("© {year} PetMate. Built for people who take animals seriously.", { year })}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {t("Never send money off PetMate.")}{" "}
              <Link href="/trust" className="text-fg-muted underline underline-offset-2 hover:text-brand">
                {t("Here is why")}
              </Link>
            </span>
            <CookieSettingsLink label={t("Cookie settings")} />
          </p>
        </div>
      </div>
    </footer>
  );
}
