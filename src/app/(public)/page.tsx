import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  BadgeCheck,
  HeartHandshake,
  Lock,
  Sparkles,
  Stethoscope,
  Dna,
  FileHeart,
  ShoppingBag,
} from "lucide-react";
import { db } from "@/lib/db";
import { getAuth } from "@/lib/auth/session";
import { searchListings, getPopularBreeds, getRecommendedListings } from "@/lib/services/search.service";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { ListingCard, ListingGrid } from "@/components/listings/listing-card";
import { HeroSearch } from "@/components/home/hero-search";
import { SPECIES_PLURAL, type Species } from "@/lib/constants";
import { compactNumber } from "@/lib/utils";
import { AdSlot } from "@/components/ads/ad-slot";

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
    searchListings({ intent: "SALE", limit: 4, sort: "relevance", viewerId: auth?.user.id }),
    searchListings({ intent: "ADOPTION", limit: 4, sort: "newest", viewerId: auth?.user.id }),
    getPopularBreeds(undefined, 8),
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
      <Hero stats={stats} />

      {recommended && recommended.items.length > 0 && (
        <Section
          eyebrow={recommended.personalised ? "For you" : "Popular right now"}
          title={`Welcome back, ${auth!.user.name.split(" ")[0]}`}
          description={recommended.basis}
          href="/pets"
          linkLabel="Browse everything"
        >
          <ListingGrid>
            {recommended.items.slice(0, 4).map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </ListingGrid>
        </Section>
      )}

      <TrustStrip />

      <div className="container-page pt-10">
        <AdSlot slot="HOME_HERO" />
      </div>

      {featured.items.length > 0 && (
        <Section
          eyebrow="For sale"
          title="Pets with a record you can read"
          description="Every listing shows how well documented the animal's health is, and whether a clinic — not just the seller — put it there."
          href="/pets?intent=SALE"
          linkLabel="See all for sale"
        >
          <ListingGrid>
            {featured.items.map((listing, index) => (
              <ListingCard key={listing.id} listing={listing} priority={index < 2} />
            ))}
          </ListingGrid>
        </Section>
      )}

      <Ecosystem />

      {adoptable.items.length > 0 && (
        <Section
          eyebrow="Adoption"
          title="Waiting for the right home"
          description="Rescues ask real questions and get real answers. Apply once and your household profile is reused every time."
          href="/pets?intent=ADOPTION"
          linkLabel="See all adoptions"
        >
          <ListingGrid>
            {adoptable.items.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </ListingGrid>
        </Section>
      )}

      {breeds.length > 0 && <BreedStrip breeds={breeds} />}

      <SpeciesGrid />

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

function Hero({ stats }: { stats: { pets: number; listings: number; clinics: number; members: number } }) {
  return (
    <section className="relative overflow-hidden border-b border-[var(--border)]">
      {/* A warm wash rather than a stock photo: the listings below are the
          photography, and a hero image would compete with them. */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(120% 90% at 15% 0%, color-mix(in srgb, var(--brand) 14%, transparent) 0%, transparent 55%), radial-gradient(90% 70% at 90% 10%, color-mix(in srgb, var(--accent) 12%, transparent) 0%, transparent 50%)",
        }}
        aria-hidden
      />

      <div className="container-page py-16 lg:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <Badge tone="brand" icon={<BadgeCheck className="size-3.5" aria-hidden />}>
            Every pet gets a passport
          </Badge>

          <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.08] tracking-tight text-fg sm:text-5xl lg:text-[3.5rem]">
            Know exactly who you are
            <span className="relative mx-2 inline-block">
              <span className="relative z-10 text-brand">buying from</span>
              <span
                className="absolute inset-x-0 bottom-1 -z-0 h-3 rounded-full bg-accent-soft"
                aria-hidden
              />
            </span>
            before you meet the animal
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-fg-muted">
            Anyone can post a photo and a price. PetMate shows you the pet&rsquo;s vaccination
            history, who recorded it, the seller&rsquo;s transaction record, and holds your money
            in escrow until you have met the animal in person.
          </p>

          <div className="mx-auto mt-8 max-w-xl">
            <HeroSearch />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-fg-subtle">
            <span>Try:</span>
            {[
              "calm small dog near me",
              "kitten for adoption",
              "vaccinated labrador under 20000",
            ].map((example) => (
              <Link
                key={example}
                href={`/pets?q=${encodeURIComponent(example)}`}
                className="rounded-full border border-[var(--border)] px-3 py-1 transition-colors hover:border-[var(--border-strong)] hover:text-fg-muted"
              >
                {example}
              </Link>
            ))}
          </div>
        </div>

        <dl className="mx-auto mt-14 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--border)] sm:grid-cols-4">
          {[
            { label: "Pet profiles", value: stats.pets },
            { label: "Live listings", value: stats.listings },
            { label: "Verified clinics", value: stats.clinics },
            { label: "Members", value: stats.members },
          ].map((stat) => (
            <div key={stat.label} className="bg-bg-elevated px-4 py-5 text-center">
              <dd className="font-display text-2xl font-semibold tabular text-fg">
                {compactNumber(stat.value)}
              </dd>
              <dt className="mt-0.5 text-xs text-fg-muted">{stat.label}</dt>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function TrustStrip() {
  const items = [
    {
      icon: Lock,
      title: "Your money is held, not sent",
      body: "Payment sits in escrow until you have met the pet and both of you confirm the handover. If something is wrong, you open a dispute and the money does not move.",
    },
    {
      icon: FileHeart,
      title: "Health records with a signature",
      body: "A vaccination entered by a clinic is marked as clinic-verified. One typed in by the seller is marked as their claim. You can always tell which you are looking at.",
    },
    {
      icon: BadgeCheck,
      title: "Trust you can interrogate",
      body: "Every score breaks down into the things that earned it: ID checks, completed sales, reviews from real transactions. No mystery number.",
    },
  ];

  return (
    <section className="border-b border-[var(--border)] bg-bg-sunken">
      <div className="container-page py-14 lg:py-16">
        <div className="grid gap-8 md:grid-cols-3">
          {items.map((item) => (
            <div key={item.title}>
              <div className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-soft-fg">
                <item.icon className="size-5" aria-hidden />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-fg">{item.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Ecosystem() {
  const pillars = [
    {
      icon: HeartHandshake,
      title: "Buy, adopt, rehome",
      body: "A marketplace where the listing is tied to a real pet profile, not retyped from scratch each time.",
      href: "/pets",
      cta: "Browse pets",
    },
    {
      icon: Dna,
      title: "Breeding, done responsibly",
      body: "A compatibility engine that checks age, health records, relatedness and distance — and shows its working, factor by factor.",
      href: "/breeding",
      cta: "Find a match",
    },
    {
      icon: Stethoscope,
      title: "Your vet, bookable",
      body: "Real availability from a real calendar. Results from the visit land straight in your pet's timeline.",
      href: "/clinics",
      cta: "Find a clinic",
    },
    {
      icon: ShoppingBag,
      title: "Everything they need",
      body: "Food, medication, beds and toys from shops that are reviewed only by people who actually bought something.",
      href: "/store",
      cta: "Open the store",
    },
  ];

  return (
    <section className="container-page py-16 lg:py-20">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">
          The whole lifecycle
        </p>
        <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          One account, from the first search to the last vet visit
        </h2>
        <p className="mt-3 text-lg text-fg-muted">
          Most people stitch this together from a Facebook group, a WhatsApp thread, a paper
          vaccination card and a phone call to the clinic. PetMate is the same journey with the
          gaps closed.
        </p>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {pillars.map((pillar) => (
          <Link
            key={pillar.title}
            href={pillar.href}
            className="surface surface-lift group flex flex-col p-6"
          >
            <div className="flex size-11 items-center justify-center rounded-xl bg-bg-sunken text-brand transition-colors group-hover:bg-brand-soft">
              <pillar.icon className="size-5" aria-hidden />
            </div>
            <h3 className="mt-4 font-display text-lg font-semibold text-fg">{pillar.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-fg-muted">{pillar.body}</p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
              {pillar.cta}
              <ArrowRight className="rtl:-scale-x-100 size-4 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" aria-hidden />
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
    <section className="container-page py-12 lg:py-16">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">{eyebrow}</p>
          <h2 className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            {title}
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">{description}</p>
        </div>
        <ButtonLink href={href} variant="outline" size="sm" className="shrink-0">
          {linkLabel}
          <ArrowRight className="rtl:-scale-x-100 size-4" aria-hidden />
        </ButtonLink>
      </div>
      {children}
    </section>
  );
}

function BreedStrip({
  breeds,
}: {
  breeds: { id: string; name: string; slug: string; species: string; sizeClass: string | null; _count: { pets: number } }[];
}) {
  return (
    <section className="border-y border-[var(--border)] bg-bg-sunken">
      <div className="container-page py-12">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-fg">Explore by breed</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Honest guides: what the breed is actually like to live with, and what to screen for.
            </p>
          </div>
          <Link
            href="/breeds"
            className="shrink-0 text-sm font-semibold text-brand hover:underline"
          >
            All breeds
          </Link>
        </div>

        <ul className="mt-6 flex gap-2.5 overflow-x-auto pb-2 hide-scrollbar">
          {breeds.map((breed) => (
            <li key={breed.id} className="shrink-0">
              <Link
                href={`/breeds/${breed.slug}`}
                className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-bg-elevated px-4 py-2 text-sm font-medium text-fg transition-colors hover:border-[var(--border-strong)] hover:bg-bg"
              >
                {breed.name}
                <span className="tabular text-xs text-fg-subtle">{breed._count.pets}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SpeciesGrid() {
  const featured: Species[] = ["DOG", "CAT", "BIRD", "RABBIT", "SMALL_MAMMAL", "REPTILE"];

  return (
    <section className="container-page py-16">
      <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
        Whatever you keep
      </h2>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {featured.map((species) => (
          <Link
            key={species}
            href={`/pets?species=${species}`}
            className="surface surface-lift flex items-center justify-center px-4 py-6 text-center text-sm font-semibold text-fg"
          >
            {SPECIES_PLURAL[species]}
          </Link>
        ))}
      </div>
    </section>
  );
}

function ClosingCta({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="container-page pb-20">
      <div className="passport-edge relative overflow-hidden rounded-[var(--radius-panel)] bg-[var(--color-pine-700)] px-6 py-14 text-center sm:px-12">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(70% 120% at 50% 0%, color-mix(in srgb, #ffffff 12%, transparent) 0%, transparent 60%)",
          }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-2xl">
          <Sparkles className="mx-auto size-7 text-[color-mix(in_srgb,#ffffff_75%,transparent)]" aria-hidden />
          <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Start with one pet profile
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-[color-mix(in_srgb,#ffffff_82%,transparent)]">
            Add your animal, record a vaccination, set a reminder. It costs nothing, it stays
            yours, and it is what every listing, booking and match is built on later.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <ButtonLink
              href={signedIn ? "/dashboard/pets/new" : "/register"}
              size="lg"
              className="bg-white text-[var(--color-pine-700)] hover:bg-[color-mix(in_srgb,#ffffff_90%,transparent)]"
            >
              {signedIn ? "Add a pet" : "Create a free account"}
            </ButtonLink>
            <ButtonLink
              href="/pets"
              size="lg"
              variant="outline"
              className="border-[color-mix(in_srgb,#ffffff_35%,transparent)] text-white hover:bg-[color-mix(in_srgb,#ffffff_12%,transparent)]"
            >
              Just browsing
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
