import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Scale, Clock, Sparkles, Globe2, Wind, HeartPulse } from "lucide-react";
import { db } from "@/lib/db";
import { getAuth } from "@/lib/auth/session";
import { searchListings } from "@/lib/services/search.service";
import { ListingCard, ListingGrid } from "@/components/listings/listing-card";
import { Card, Badge, Breadcrumbs, Alert, EmptyState } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { SPECIES_LABEL, type Species } from "@/lib/constants";
import { clientEnv } from "@/lib/env";
import { PawPrint } from "lucide-react";

export const revalidate = 3600;

async function loadBreed(slug: string) {
  return db.breed.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      species: true,
      sizeClass: true,
      avgWeightKgMin: true,
      avgWeightKgMax: true,
      lifespanMinY: true,
      lifespanMaxY: true,
      temperament: true,
      description: true,
      careLevel: true,
      hypoallergenic: true,
      originCountry: true,
    },
  });
}

export async function generateStaticParams() {
  const breeds = await db.breed.findMany({ select: { slug: true }, take: 200 });
  return breeds.map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const breed = await loadBreed(slug);
  if (!breed) return { title: "Breed not found", robots: { index: false, follow: false } };

  return {
    title: `${breed.name} — size, lifespan and care`,
    description:
      breed.description?.slice(0, 160) ??
      `What owning a ${breed.name} actually involves: typical size, lifespan, temperament and care level.`,
    alternates: { canonical: `/breeds/${breed.slug}` },
  };
}

const CARE_COPY: Record<string, string> = {
  LOW: "Manageable for a first-time owner with a normal working week.",
  MODERATE: "Needs real daily commitment. Plan for exercise, grooming and training time.",
  HIGH: "A serious undertaking. Under-exercised or under-stimulated, this breed develops problems.",
};

export default async function BreedPage({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug }, auth] = await Promise.all([params, getAuth()]);

  const breed = await loadBreed(slug);
  if (!breed) notFound();

  const [listings, registered, related] = await Promise.all([
    searchListings({ breedIds: [breed.id], limit: 8, viewerId: auth?.user.id }),
    db.pet.count({ where: { breedId: breed.id, deletedAt: null } }),
    db.breed.findMany({
      where: {
        species: breed.species,
        id: { not: breed.id },
        ...(breed.sizeClass ? { sizeClass: breed.sizeClass } : {}),
      },
      orderBy: { popularity: "desc" },
      take: 6,
      select: { id: true, name: true, slug: true },
    }),
  ]);

  const temperament = (breed.temperament ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const facts = [
    breed.sizeClass && {
      icon: Scale,
      label: "Size",
      value:
        breed.avgWeightKgMin && breed.avgWeightKgMax
          ? `${breed.sizeClass.toLowerCase()} · ${breed.avgWeightKgMin}–${breed.avgWeightKgMax} kg`
          : breed.sizeClass.toLowerCase(),
    },
    breed.lifespanMinY &&
      breed.lifespanMaxY && {
        icon: Clock,
        label: "Typical lifespan",
        value: `${breed.lifespanMinY}–${breed.lifespanMaxY} years`,
      },
    breed.careLevel && {
      icon: HeartPulse,
      label: "Care level",
      value: breed.careLevel.toLowerCase(),
    },
    breed.originCountry && { icon: Globe2, label: "Origin", value: breed.originCountry },
    breed.hypoallergenic && {
      icon: Wind,
      label: "Allergens",
      value: "Lower-shedding coat",
    },
  ].filter(Boolean) as { icon: typeof Scale; label: string; value: string }[];

  return (
    <div className="container-page max-w-5xl py-8 lg:py-12">
      <Breadcrumbs
        items={[
          { label: "Breeds", href: "/breeds" },
          { label: SPECIES_LABEL[breed.species as Species], href: `/breeds?species=${breed.species}` },
          { label: breed.name },
        ]}
      />

      <header className="mt-4">
        <Badge tone="brand">{SPECIES_LABEL[breed.species as Species]}</Badge>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
          {breed.name}
        </h1>
        {breed.description && (
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-fg-muted">
            {breed.description}
          </p>
        )}
      </header>

      {facts.length > 0 && (
        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3 lg:grid-cols-5">
          {facts.map((fact) => (
            <div key={fact.label} className="bg-bg-elevated p-4">
              <dt className="flex items-center gap-1.5 text-xs text-fg-subtle">
                <fact.icon className="size-3.5" aria-hidden />
                {fact.label}
              </dt>
              <dd className="mt-1.5 text-sm font-semibold capitalize text-fg">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {temperament.length > 0 && (
        <section className="mt-8">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-fg">
            <Sparkles className="size-4.5 text-brand" aria-hidden />
            Temperament
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {temperament.map((trait) => (
              <Badge key={trait} tone="accent">
                {trait}
              </Badge>
            ))}
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fg-muted">
            These are breed tendencies, not guarantees. Individual temperament comes from
            socialisation and the specific animal far more than from the breed label, which is why
            PetMate&rsquo;s breeding matcher weighs the individual pet&rsquo;s recorded temperament
            alongside the breed.
          </p>
        </section>
      )}

      {breed.careLevel && (
        <Alert
          tone={breed.careLevel === "HIGH" ? "warning" : "info"}
          className="mt-6"
          title={`What a ${breed.name} asks of you`}
        >
          <p className="mt-1 leading-relaxed">{CARE_COPY[breed.careLevel]}</p>
        </Alert>
      )}

      <section className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
              {breed.name}s on PetMate
            </h2>
            <p className="mt-1 text-sm text-fg-muted tabular">
              {listings.total} listed now · {registered} registered in total
            </p>
          </div>
          {listings.total > 0 && (
            <ButtonLink href={`/pets?breed=${breed.slug}`} variant="outline" size="sm">
              Search all
            </ButtonLink>
          )}
        </div>

        <div className="mt-5">
          {listings.items.length === 0 ? (
            <EmptyState
              icon={<PawPrint className="size-5" aria-hidden />}
              title={`No ${breed.name}s listed right now`}
              description="Save a search and we will tell you the moment one appears, rather than making you check back."
              action={
                <ButtonLink href={`/pets?species=${breed.species}`}>
                  Browse {SPECIES_LABEL[breed.species as Species].toLowerCase()}
                </ButtonLink>
              }
            />
          ) : (
            <ListingGrid>
              {listings.items.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </ListingGrid>
          )}
        </div>
      </section>

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-xl font-semibold tracking-tight text-fg">
            Similar in size
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {related.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/breeds/${r.slug}`}
                  className="inline-flex rounded-full border border-[var(--border)] px-3.5 py-1.5 text-sm text-fg-muted hover:border-[var(--border-strong)] hover:text-fg"
                >
                  {r.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Card className="mt-12 p-6">
        <h2 className="font-display text-lg font-semibold text-fg">
          Before you commit to a {breed.name}
        </h2>
        <ul className="mt-3 space-y-2 text-[15px] leading-relaxed text-fg-muted">
          <li>
            Ask for clinic-verified health records, not the seller&rsquo;s word. On PetMate the
            badge tells you which is which.
          </li>
          <li>
            For a puppy or kitten, ask to see the mother. A seller who cannot show you is telling
            you something.
          </li>
          <li>
            Check the lineage if one is claimed — a PetMate pedigree links to each ancestor&rsquo;s
            own passport, so it can be followed.
          </li>
          <li>
            Budget for the full {breed.lifespanMaxY ?? 12}-year span, not the purchase price.
            Veterinary care is the larger number.
          </li>
        </ul>
      </Card>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: `${breed.name}: size, lifespan, temperament and care`,
            description: breed.description ?? undefined,
            url: `${clientEnv.NEXT_PUBLIC_APP_URL}/breeds/${breed.slug}`,
            about: { "@type": "Thing", name: breed.name },
          }),
        }}
      />
    </div>
  );
}
