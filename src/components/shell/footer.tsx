import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { SPECIES_PLURAL, SPECIES } from "@/lib/constants";

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

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-24 border-t border-[var(--border)] bg-bg-sunken">
      <div className="container-page py-12 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_2.6fr]">
          <div>
            <Logo size="md" />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-fg-muted">
              PetMate gives every pet a verified identity and a health record that follows them for
              life — so buying, adopting, breeding and caring for an animal is something you can
              actually check.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {COLUMNS.map((column) => (
              <div key={column.title}>
                <h2 className="font-display text-sm font-semibold text-fg">{column.title}</h2>
                <ul className="mt-3 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-sm text-fg-muted transition-colors hover:text-fg hover:underline"
                      >
                        {link.label}
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
        <nav aria-label="Browse by species" className="mt-10 border-t border-[var(--border)] pt-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            Browse by species
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {SPECIES.map((species) => (
              <li key={species}>
                <Link
                  href={`/pets?species=${species}`}
                  className="text-sm text-fg-muted transition-colors hover:text-fg hover:underline"
                >
                  {SPECIES_PLURAL[species]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-8 flex flex-col gap-3 border-t border-[var(--border)] pt-6 text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} PetMate. Built for people who take animals seriously.</p>
          <p>
            Never send money off PetMate.{" "}
            <Link href="/trust" className="underline underline-offset-2 hover:text-fg-muted">
              Here is why
            </Link>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}
