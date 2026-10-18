import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  BadgeCheck,
  Bird,
  Cat,
  Dna,
  Dog,
  FileHeart,
  Heart,
  HeartHandshake,
  Lock,
  PawPrint,
  Rabbit,
  Rat,
  ShoppingBag,
  Sparkles,
  Stethoscope,
  Turtle,
  type LucideIcon,
} from "lucide-react";
import { db } from "@/lib/db";
import { getAuth } from "@/lib/auth/session";
import { searchListings, getPopularBreeds, getRecommendedListings } from "@/lib/services/search.service";
import { ButtonLink } from "@/components/ui/button";
import { ListingCard, ListingRail } from "@/components/listings/listing-card";
import { HeroSearch } from "@/components/home/hero-search";
import { HeroVisual } from "@/components/home/hero-visual";
import { CountUp } from "@/components/home/count-up";
import { LogoMark } from "@/components/brand/logo";
import { SPECIES_PLURAL, type Species } from "@/lib/constants";

export const metadata: Metadata = {
  title: {
    absolute: "PetMate — Verified pets, verified people, one lifelong record",
  },
  description:
    "Find, buy, adopt and breed pets from people you can actually check. Every pet gets a health record that follows them for life, plus vet booking and a pet store in one place.",
  alternates: { canonical: "/" },
};

// The home page is mostly public data; revalidating on a timer keeps it fast
// without serving a stale marketplace.
export const revalidate = 120;

export default async function HomePage() {
  const auth = await getAuth();

  const [featured, adoptable, breeds, stats, recommended] = await Promise.all([
    searchListings({ intent: "SALE", limit: 8, sort: "relevance", viewerId: auth?.user.id }),
    searchListings({ intent: "ADOPTION", limit: 8, sort: "newest", viewerId: auth?.user.id }),
    getPopularBreeds(undefined, 14),
    getPlatformStats(),
    auth
      ? getRecommendedListings(auth.user.id, {
          lat: auth.user.lat,
          lng: auth.user.lng,
          country: auth.user.country,
        })
      : null,
  ]);

  return (
    <>
      <Hero stats={stats} firstName={auth ? auth.user.name.split(" ")[0]! : null} />

      <SpeciesStrip />

      {recommended && recommended.items.length > 0 && (
        <Section
          eyebrow={recommended.personalised ? "Picked for you" : "Popular right now"}
          title="Fresh faces near you"
          description={recommended.basis}
          href="/pets"
          linkLabel="Browse all"
        >
          <ListingRail>
            {recommended.items.slice(0, 8).map((listing, index) => (
              <ListingCard key={listing.id} listing={listing} priority={index < 2} />
            ))}
          </ListingRail>
        </Section>
      )}

      {featured.items.length > 0 && (
        <Section
          eyebrow="For sale"
          title="Pets with a record you can read"
          description="Every card shows how well documented the pet's health is — and whether a vet put it there."
          href="/pets?intent=SALE"
          linkLabel="See all"
        >
          <ListingRail>
            {featured.items.map((listing, index) => (
              <ListingCard key={listing.id} listing={listing} priority={!recommended && index < 2} />
            ))}
          </ListingRail>
        </Section>
      )}

      <WhyPetMate />

      {adoptable.items.length > 0 && (
        <Section
          eyebrow="Adoption"
          title="Waiting for the right home"
          description="Apply once — your household profile is reused for every rescue."
          href="/pets?intent=ADOPTION"
          linkLabel="See all"
        >
          <ListingRail>
            {adoptable.items.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </ListingRail>
        </Section>
      )}

      <Ecosystem />

      {breeds.length > 0 && <BreedMarquee breeds={breeds} />}

      <ClosingCta signedIn={Boolean(auth)} />
    </>
  );
}

// ---------------------------------------------------------------------------

async function getPlatformStats() {
  const [pets, listings, clinics, members] = await Promise.all([
    db.pet.count({ where: { deletedAt: null } }),
    db.listing.count({ where: { status: "ACTIVE", deletedAt: null } }),
    db.clinic.count({ where: { status: "ACTIVE", deletedAt: null } }),
    db.user.count({ where: { deletedAt: null } }),
  ]);
  return { pets, listings, clinics, members };
}

/** Each part of the product has its own colour, used on its tile and icon. */
const QUICK_ACTIONS: { href: string; label: string; icon: LucideIcon; tint: string }[] = [
  { href: "/pets?intent=SALE", label: "Buy", icon: PawPrint, tint: "var(--color-lagoon-500)" },
  { href: "/pets?intent=ADOPTION", label: "Adopt", icon: Heart, tint: "var(--color-rose)" },
  { href: "/breeding", label: "Breeding", icon: Dna, tint: "var(--color-grape)" },
  { href: "/clinics", label: "Vets", icon: Stethoscope, tint: "var(--color-sky)" },
  { href: "/store", label: "Store", icon: ShoppingBag, tint: "var(--color-sun)" },
];

function Hero({
  stats,
  firstName,
}: {
  stats: { pets: number; listings: number; clinics: number; members: number };
  firstName: string | null;
}) {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Colour, not a stock photo: the listings below are the photography. */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="blob -left-24 -top-24 size-[22rem] bg-[var(--color-lagoon-400)]" />
        <div className="blob -right-20 top-10 size-[20rem] bg-[var(--color-ocean-400)] [animation-delay:-6s]" />
        <div className="blob bottom-[-8rem] left-1/3 size-[18rem] bg-[var(--color-coral-300)] opacity-30 [animation-delay:-12s]" />
        <div className="dot-grid absolute inset-0" />
      </div>

      <div className="container-page pb-8 pt-4 sm:pt-10 lg:pb-20 lg:pt-16">
        <div className="grid items-center gap-3 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12">
          <div className="order-1 w-[min(13rem,58vw)] justify-self-center sm:w-[19rem] lg:order-2 lg:w-full lg:max-w-[30rem]">
            <HeroVisual />
          </div>

          <div className="order-2 text-center lg:order-1 lg:text-left">
            <p
              className="enter inline-flex items-center gap-2 rounded-full border border-[var(--glass-border)] bg-[var(--glass)] py-1 pl-1 pr-3 text-xs font-semibold text-fg shadow-[var(--shadow-subtle)] backdrop-blur"
              style={{ "--d": "80ms" } as React.CSSProperties}
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-brand text-brand-fg">
                {firstName ? (
                  <PawPrint className="size-3.5" aria-hidden />
                ) : (
                  <BadgeCheck className="size-3.5" aria-hidden />
                )}
              </span>
              {firstName ? `Welcome back, ${firstName}` : "Every pet gets a passport"}
            </p>

            <h1
              className="enter mt-3 font-display text-[2.15rem] font-bold leading-[1.06] tracking-tight text-fg sm:mt-4 sm:text-5xl lg:text-[3.75rem]"
              style={{ "--d": "160ms" } as React.CSSProperties}
            >
              Find your pet&rsquo;s <span className="text-gradient">perfect mate</span>{" "}
              from people you{" "}
              <span className="relative inline-block whitespace-nowrap">
                can trust
                <svg
                  viewBox="0 0 200 12"
                  className="absolute -bottom-1.5 left-0 h-2.5 w-full text-[var(--color-coral-400)]"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <path
                    d="M2 9 C 50 2, 150 2, 198 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                    pathLength={1}
                    className="[stroke-dasharray:1_2] [stroke-dashoffset:1.02] [animation:pm-draw_900ms_var(--ease-out-soft)_900ms_forwards]"
                  />
                </svg>
              </span>
            </h1>

            <p
              className="enter mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-fg-muted sm:mt-4 sm:text-lg lg:mx-0"
              style={{ "--d": "240ms" } as React.CSSProperties}
            >
              Verified health records, payments held safely until you meet the pet, and real vets —
              all in one place.
            </p>

            <div
              className="enter mx-auto mt-5 max-w-xl sm:mt-6 lg:mx-0"
              style={{ "--d": "320ms" } as React.CSSProperties}
            >
              <HeroSearch />
            </div>

            <nav
              aria-label="What are you here for?"
              className="mx-auto mt-5 grid max-w-xl grid-cols-5 gap-2 sm:mt-6 sm:gap-3 lg:mx-0"
            >
              {QUICK_ACTIONS.map((action, index) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="enter group flex flex-col items-center gap-1.5 rounded-2xl py-1 text-xs font-semibold text-fg-muted transition-colors hover:text-fg sm:text-[13px]"
                  style={{ "--d": `${400 + index * 70}ms` } as React.CSSProperties}
                >
                  <span
                    className="flex size-13 items-center justify-center rounded-[1.1rem] text-white shadow-[var(--shadow-card)] transition-transform duration-300 ease-[var(--ease-spring)] group-hover:-translate-y-1 group-hover:rotate-[-6deg] group-active:scale-90 sm:size-14"
                    style={{
                      background: `linear-gradient(140deg, color-mix(in srgb, ${action.tint} 82%, #fff), color-mix(in srgb, ${action.tint} 78%, #000))`,
                      boxShadow: `0 10px 22px -10px ${action.tint}`,
                    }}
                  >
                    <action.icon className="size-6" strokeWidth={2.2} aria-hidden />
                  </span>
                  {action.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>

        <dl className="enter mx-auto mt-10 grid max-w-4xl grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 lg:mt-16" style={{ "--d": "700ms" } as React.CSSProperties}>
          {[
            { label: "Pet profiles", value: stats.pets, icon: PawPrint, tint: "var(--color-lagoon-500)" },
            { label: "Live listings", value: stats.listings, icon: Sparkles, tint: "var(--color-sun)" },
            { label: "Verified clinics", value: stats.clinics, icon: Stethoscope, tint: "var(--color-sky)" },
            { label: "Members", value: stats.members, icon: Heart, tint: "var(--color-rose)" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="glass flex items-center gap-3 rounded-2xl px-3.5 py-3 shadow-[var(--shadow-subtle)]"
            >
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-xl"
                style={{ color: stat.tint, background: `color-mix(in srgb, ${stat.tint} 15%, transparent)` }}
              >
                <stat.icon className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 text-left">
                <dd className="font-display text-xl font-bold leading-none text-fg sm:text-2xl">
                  <CountUp value={stat.value} />
                </dd>
                <dt className="mt-1 truncate text-xs text-fg-muted">{stat.label}</dt>
              </div>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

const SPECIES_TILES: { species: Species; icon: LucideIcon; tint: string }[] = [
  { species: "DOG", icon: Dog, tint: "var(--color-sun)" },
  { species: "CAT", icon: Cat, tint: "var(--color-grape)" },
  { species: "BIRD", icon: Bird, tint: "var(--color-sky)" },
  { species: "RABBIT", icon: Rabbit, tint: "var(--color-rose)" },
  { species: "SMALL_MAMMAL", icon: Rat, tint: "var(--color-mint)" },
  { species: "REPTILE", icon: Turtle, tint: "var(--color-lime)" },
  { species: "OTHER", icon: PawPrint, tint: "var(--color-lagoon-500)" },
];

function SpeciesStrip() {
  return (
    <section className="container-page py-8 lg:py-12">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Browse by pet</p>
          <h2 className="mt-1.5 text-2xl tracking-tight sm:text-3xl">Who are you looking for?</h2>
        </div>
      </div>

      <ul className="rail auto-cols-[7.25rem] sm:mx-0 sm:grid-flow-row sm:grid-cols-4 sm:overflow-visible sm:px-0 lg:grid-cols-7">
        {SPECIES_TILES.map(({ species, icon: Icon, tint }) => (
          <li key={species} className="reveal">
            <Link
              href={`/pets?species=${species}`}
              className="group relative flex h-full flex-col items-center gap-3 overflow-hidden rounded-[1.5rem] border border-[var(--border)] bg-bg-elevated px-3 pb-4 pt-5 text-center shadow-[var(--shadow-subtle)] transition-[transform,box-shadow,border-color] duration-300 ease-[var(--ease-out-soft)] hover:-translate-y-1 hover:shadow-[var(--shadow-lift)] active:scale-[0.97]"
              style={{ borderColor: `color-mix(in srgb, ${tint} 22%, var(--border))` }}
            >
              <span
                className="pointer-events-none absolute inset-x-0 top-0 h-2/3 opacity-60 transition-opacity duration-300 group-hover:opacity-100"
                style={{ background: `radial-gradient(80% 90% at 50% 0%, color-mix(in srgb, ${tint} 22%, transparent), transparent)` }}
                aria-hidden
              />
              <span
                className="relative flex size-14 items-center justify-center rounded-2xl transition-transform duration-500 ease-[var(--ease-spring)] group-hover:scale-110 group-hover:rotate-[-8deg]"
                style={{ color: tint, background: `color-mix(in srgb, ${tint} 16%, var(--bg-elevated))` }}
              >
                <Icon className="size-7" strokeWidth={2} aria-hidden />
              </span>
              <span className="relative text-sm font-semibold text-fg">{SPECIES_PLURAL[species]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WhyPetMate() {
  return (
    <section className="container-page py-12 lg:py-20">
      <div className="reveal mx-auto max-w-2xl text-center">
        <p className="eyebrow">Why PetMate</p>
        <h2 className="mt-2 text-3xl tracking-tight sm:text-4xl">
          Safe by design, <span className="text-gradient">not by luck</span>
        </h2>
        <p className="mt-3 text-base text-fg-muted sm:text-lg">
          The three things a photo and a phone number can never give you.
        </p>
      </div>

      <div className="reveal-children mt-10 grid gap-4 md:grid-cols-3">
        {[
          {
            icon: Lock,
            tint: "var(--color-lagoon-500)",
            title: "Your money waits for you",
            body: "Payment is held until you have met the pet and both sides confirm. Something wrong? Open a dispute — the money does not move.",
          },
          {
            icon: FileHeart,
            tint: "var(--color-rose)",
            title: "Health records with a signature",
            body: "A vaccine entered by a clinic is marked vet-verified. One typed by a seller is marked as their claim. You always know which.",
          },
          {
            icon: BadgeCheck,
            tint: "var(--color-sun)",
            title: "Trust you can open up",
            body: "Every trust score breaks down into what earned it: ID checks, completed sales and reviews from real buyers.",
          },
        ].map((item, index) => (
          <div
            key={item.title}
            className="group relative overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border)] bg-bg-elevated p-6 shadow-[var(--shadow-card)] transition-transform duration-300 hover:-translate-y-1"
          >
            <span
              className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full opacity-25 blur-2xl transition-opacity duration-500 group-hover:opacity-50"
              style={{ background: item.tint }}
              aria-hidden
            />
            <div className="relative flex items-center justify-between">
              <span
                className="flex size-12 items-center justify-center rounded-2xl text-white shadow-[var(--shadow-card)]"
                style={{
                  background: `linear-gradient(140deg, color-mix(in srgb, ${item.tint} 85%, #fff), color-mix(in srgb, ${item.tint} 75%, #000))`,
                }}
              >
                <item.icon className="size-6" aria-hidden />
              </span>
              <span className="font-display text-5xl font-bold text-[color-mix(in_srgb,var(--fg)_7%,transparent)]">
                0{index + 1}
              </span>
            </div>
            <h3 className="relative mt-5 text-xl">{item.title}</h3>
            <p className="relative mt-2 text-[15px] leading-relaxed text-fg-muted">{item.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Ecosystem() {
  const pillars: {
    icon: LucideIcon;
    tint: string;
    title: string;
    body: string;
    href: string;
    cta: string;
  }[] = [
    {
      icon: HeartHandshake,
      tint: "var(--color-coral-500)",
      title: "Buy, adopt, rehome",
      body: "Every listing is tied to a real pet profile, never retyped from scratch.",
      href: "/pets",
      cta: "Browse pets",
    },
    {
      icon: Dna,
      tint: "var(--color-grape)",
      title: "Responsible breeding",
      body: "Matches checked for age, health, relatedness and distance — factor by factor.",
      href: "/breeding",
      cta: "Find a match",
    },
    {
      icon: Stethoscope,
      tint: "var(--color-sky)",
      title: "Your vet, bookable",
      body: "Real availability. Visit results land straight in your pet's timeline.",
      href: "/clinics",
      cta: "Find a clinic",
    },
    {
      icon: ShoppingBag,
      tint: "var(--color-sun)",
      title: "Everything they need",
      body: "Food, meds and toys, reviewed only by people who bought them.",
      href: "/store",
      cta: "Open the store",
    },
  ];

  return (
    <section className="container-page py-12 lg:py-16">
      <div className="reveal max-w-2xl">
        <p className="eyebrow">One app, the whole journey</p>
        <h2 className="mt-2 text-3xl tracking-tight sm:text-4xl">
          From the first search to the last vet visit
        </h2>
      </div>

      <div className="reveal-children mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {pillars.map((pillar) => (
          <Link
            key={pillar.title}
            href={pillar.href}
            className="group relative flex min-h-56 flex-col overflow-hidden rounded-[var(--radius-panel)] p-6 text-white shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-500 ease-[var(--ease-out-soft)] hover:-translate-y-1.5 hover:shadow-[var(--shadow-pop)] active:scale-[0.98]"
            style={{
              background: `linear-gradient(150deg, color-mix(in srgb, ${pillar.tint} 62%, #000) 0%, color-mix(in srgb, ${pillar.tint} 48%, #0a141a) 100%)`,
            }}
          >
            <pillar.icon
              className="pointer-events-none absolute -bottom-6 -right-6 size-36 rotate-[-12deg] opacity-15 transition-transform duration-700 ease-[var(--ease-spring)] group-hover:rotate-0 group-hover:scale-110"
              strokeWidth={1.5}
              aria-hidden
            />
            <span className="flex size-12 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
              <pillar.icon className="size-6" aria-hidden />
            </span>
            <h3 className="mt-5 text-xl text-white">{pillar.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-white/85">{pillar.body}</p>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold">
              {pillar.cta}
              <ArrowRight
                className="size-4 transition-transform duration-300 group-hover:translate-x-1"
                aria-hidden
              />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Section({
  eyebrow,
  title,
  description,
  href,
  linkLabel,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="container-page py-8 lg:py-12">
      <div className="reveal mb-5 flex items-end justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="mt-1.5 text-2xl tracking-tight sm:text-3xl">{title}</h2>
          <p className="mt-1.5 hidden text-[15px] leading-relaxed text-fg-muted sm:block">
            {description}
          </p>
        </div>
        <Link
          href={href}
          className="group inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-soft px-3.5 py-2 text-sm font-semibold text-brand-soft-fg transition-colors hover:bg-[color-mix(in_srgb,var(--brand)_18%,var(--brand-soft))]"
        >
          {linkLabel}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      </div>
      {children}
    </section>
  );
}

function BreedMarquee({
  breeds,
}: {
  breeds: { id: string; name: string; slug: string; species: string; sizeClass: string | null; _count: { pets: number } }[];
}) {
  const tints = [
    "var(--color-lagoon-500)",
    "var(--color-sun)",
    "var(--color-grape)",
    "var(--color-sky)",
    "var(--color-rose)",
    "var(--color-mint)",
  ];
  const loop = Array.from({ length: Math.ceil(14 / breeds.length) }, () => breeds).flat();

  return (
    <section className="py-10 lg:py-14">
      <div className="container-page mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Breed guide</p>
          <h2 className="mt-1.5 text-2xl tracking-tight sm:text-3xl">Explore by breed</h2>
        </div>
        <Link href="/breeds" className="shrink-0 text-sm font-semibold text-brand hover:underline">
          All breeds
        </Link>
      </div>

      <div className="marquee" style={{ "--marquee-speed": `${Math.max(30, loop.length * 4)}s` } as React.CSSProperties}>
        <ul className="marquee-track py-2">
          {/* The set is repeated until it is wider than any screen, then
              rendered twice so the loop is seamless. Only the first pass is
              exposed to assistive tech and the tab order. */}
          {[0, 1].map((copy) =>
            loop.map((breed, index) => {
              const hidden = copy === 1 || index >= breeds.length;
              const tint = tints[index % tints.length]!;
              return (
                <li key={`${copy}-${index}`} className="pr-3" aria-hidden={hidden || undefined}>
                  <Link
                    href={`/breeds/${breed.slug}`}
                    tabIndex={hidden ? -1 : undefined}
                    className="flex items-center gap-2.5 whitespace-nowrap rounded-full border border-[var(--border)] bg-bg-elevated py-2 pl-2 pr-4 text-sm font-semibold text-fg shadow-[var(--shadow-subtle)] transition-[transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-[var(--brand)]"
                  >
                    <span
                      className="flex size-7 items-center justify-center rounded-full"
                      style={{ color: tint, background: `color-mix(in srgb, ${tint} 16%, transparent)` }}
                    >
                      {breed.species === "CAT" ? (
                        <Cat className="size-4" aria-hidden />
                      ) : breed.species === "DOG" ? (
                        <Dog className="size-4" aria-hidden />
                      ) : (
                        <PawPrint className="size-4" aria-hidden />
                      )}
                    </span>
                    {breed.name}
                    <span className="tabular rounded-full bg-bg-sunken px-2 py-0.5 text-xs text-fg-muted">
                      {breed._count.pets}
                    </span>
                  </Link>
                </li>
              );
            }),
          )}
        </ul>
      </div>
    </section>
  );
}

function ClosingCta({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="container-page pb-16 pt-8">
      <div className="reveal passport-edge relative isolate overflow-hidden rounded-[var(--radius-panel)] bg-[linear-gradient(135deg,var(--color-lagoon-700),var(--color-slate-900)_55%,var(--color-ocean-600))] px-6 py-14 text-center sm:px-12 sm:py-16">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
          <div className="blob -left-10 -top-16 size-64 bg-[var(--color-lagoon-400)] opacity-40" />
          <div className="blob -bottom-20 -right-10 size-72 bg-[var(--color-ocean-400)] opacity-40 [animation-delay:-8s]" />
          <LogoMark
            onDark
            className="absolute -right-10 top-1/2 w-[26rem] -translate-y-1/2 opacity-[0.08]"
          />
          {[
            "left-[8%] top-[18%] rotate-[-18deg]",
            "left-[16%] bottom-[14%] rotate-[12deg] [animation-delay:-3s]",
            "right-[12%] top-[12%] rotate-[22deg] [animation-delay:-5s]",
          ].map((position) => (
            <PawPrint
              key={position}
              className={`animate-float-slow absolute size-8 text-white/15 ${position}`}
            />
          ))}
        </div>

        <div className="relative mx-auto max-w-2xl">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-white/10 text-white backdrop-blur">
            <Sparkles className="animate-wiggle size-7" aria-hidden />
          </span>
          <h2 className="mt-5 text-3xl tracking-tight text-white sm:text-4xl">
            Start with one pet profile
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-white/80">
            Add your pet, log a vaccine, set a reminder. It&rsquo;s free, it stays yours, and every
            listing, booking and match builds on it.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <ButtonLink
              href={signedIn ? "/dashboard/pets/new" : "/register"}
              size="lg"
              variant="secondary"
              className="border-transparent bg-white text-[var(--color-lagoon-800)] shadow-[0_14px_30px_-12px_rgb(0_0_0/0.5)] hover:bg-white/90"
            >
              {signedIn ? "Add a pet" : "Create a free account"}
              <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
            <ButtonLink
              href="/pets"
              size="lg"
              variant="ghost"
              className="border border-white/30 text-white hover:bg-white/10 hover:text-white"
            >
              Just browsing
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
