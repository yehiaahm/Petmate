import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PawPrint } from "lucide-react";
import { getAuth } from "@/lib/auth/session";
import { searchListings, getListingFacets } from "@/lib/services/search.service";
import { ListingCard, ListingGrid, ListingCardSkeleton } from "@/components/listings/listing-card";
import { FilterPanel } from "@/components/listings/filter-panel";
import { SortSelect } from "@/components/listings/sort-select";
import { SaveSearchButton } from "@/components/listings/save-search-button";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { AdSlot } from "@/components/ads/ad-slot";
import {
  SPECIES,
  SPECIES_PLURAL,
  LISTING_INTENT_LABEL,
  type Species,
  type ListingIntent,
} from "@/lib/constants";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readParams(raw: Record<string, string | string[] | undefined>) {
  const one = (key: string) => {
    const value = raw[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const list = (key: string) => (one(key) ?? "").split(",").filter(Boolean);
  const num = (key: string) => {
    const value = Number(one(key));
    return Number.isFinite(value) ? value : undefined;
  };

  return {
    q: one("q"),
    intent: one("intent") as ListingIntent | undefined,
    species: list("species") as Species[],
    sex: one("sex") as "MALE" | "FEMALE" | undefined,
    minPrice: num("minPrice"),
    maxPrice: num("maxPrice"),
    minAge: num("minAge"),
    maxAge: num("maxAge"),
    city: one("city"),
    country: one("country"),
    lat: num("lat"),
    lng: num("lng"),
    radius: num("radius"),
    verified: one("verified") === "true",
    vaccinated: one("vaccinated") === "true",
    minHealth: num("minHealth"),
    sort: one("sort") as "relevance" | "newest" | "price_asc" | "price_desc" | "distance" | "health" | undefined,
    page: num("page") ?? 1,
  };
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const params = readParams(await searchParams);

  // A filtered view gets its own title and description so the search result
  // describes what the page actually shows.
  const parts: string[] = [];
  if (params.species.length === 1) parts.push(SPECIES_PLURAL[params.species[0]!]);
  else parts.push("Pets");
  if (params.intent) parts.push(LISTING_INTENT_LABEL[params.intent].toLowerCase());
  if (params.city) parts.push(`in ${params.city}`);
  if (params.q) parts.push(`matching "${params.q}"`);

  const title = parts.join(" ");

  return {
    title,
    description: `Browse ${title.toLowerCase()} on PetMate. Every listing shows the pet's health record, who verified it, and the seller's trust score — with escrow protection on every purchase.`,
    alternates: {
      // Filtered permutations are infinite; canonicalise to the base page so
      // search engines index one strong URL instead of thousands of thin ones.
      canonical: params.species.length === 1 ? `/pets?species=${params.species[0]}` : "/pets",
    },
    robots: {
      index: !params.q && !params.lat,
      follow: true,
    },
  };
}

export default async function PetsPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const params = readParams(raw);
  const auth = await getAuth();

  const [results, facets] = await Promise.all([
    searchListings({
      query: params.q,
      intent: params.intent,
      species: params.species.length ? params.species : undefined,
      sex: params.sex,
      minPriceCents: params.minPrice != null ? params.minPrice * 100 : undefined,
      maxPriceCents: params.maxPrice != null ? params.maxPrice * 100 : undefined,
      minAgeMonths: params.minAge,
      maxAgeMonths: params.maxAge,
      city: params.city,
      country: params.country,
      lat: params.lat,
      lng: params.lng,
      radiusKm: params.radius ?? (params.lat != null ? 50 : undefined),
      verifiedOnly: params.verified,
      vaccinatedOnly: params.vaccinated,
      minHealthScore: params.minHealth,
      sort: params.sort,
      page: params.page,
      limit: 24,
      viewerId: auth?.user.id,
    }),
    getListingFacets({ intent: params.intent, country: params.country }),
  ]);

  const heading = params.intent
    ? LISTING_INTENT_LABEL[params.intent]
    : params.species.length === 1
      ? SPECIES_PLURAL[params.species[0]!]
      : "All pets";

  return (
    <div className="container-page py-8 lg:py-12">
      <PageHeader
        eyebrow="Marketplace"
        title={heading}
        description={
          params.q ? (
            <>
              Showing results for <span className="font-medium text-fg">{params.q}</span>
            </>
          ) : (
            "Every listing shows the animal's health record and who recorded it, so you can tell a documented pet from a claimed one."
          )
        }
        action={<SaveSearchButton />}
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-[17rem_1fr]">
        <div className="lg:sticky lg:top-24 lg:h-fit">
          <FilterPanel facets={facets} resultCount={results.total} />
        </div>

        <div className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-muted tabular">
              {results.total === 0
                ? "No matches"
                : `${results.total.toLocaleString()} ${results.total === 1 ? "pet" : "pets"}`}
              {results.pages > 1 && (
                <span className="text-fg-subtle">
                  {" "}
                  · page {results.page} of {results.pages}
                </span>
              )}
            </p>
            <SortSelect hasLocation={params.lat != null} />
          </div>

          <AdSlot slot="SEARCH_INLINE" className="mb-6" />

          <Suspense fallback={<LoadingGrid />}>
            {results.items.length > 0 ? (
              <>
                <ListingGrid>
                  {results.items.map((listing, index) => (
                    <ListingCard key={listing.id} listing={listing} priority={index < 4} />
                  ))}
                </ListingGrid>

                <Pagination
                  page={results.page}
                  pages={results.pages}
                  className="mt-10"
                />
              </>
            ) : (
              <EmptyState
                icon={<PawPrint className="size-6" aria-hidden />}
                title="No pets match those filters"
                description="Try widening the distance, removing a filter, or saving this search so we can tell you the moment something matches."
                action={
                  <div className="flex flex-wrap justify-center gap-3">
                    <ButtonLink href="/pets" variant="outline">
                      Clear filters
                    </ButtonLink>
                    <SaveSearchButton />
                  </div>
                }
              />
            )}
          </Suspense>

          {/* Real internal links, useful to a person and to a crawler. */}
          <nav aria-label="Related searches" className="mt-14 border-t border-[var(--border)] pt-6">
            <h2 className="text-sm font-semibold text-fg">Browse by species</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {SPECIES.map((species) => (
                <li key={species}>
                  <Link
                    href={`/pets?species=${species}${params.intent ? `&intent=${params.intent}` : ""}`}
                    className="inline-block rounded-full border border-[var(--border)] px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-[var(--border-strong)] hover:text-fg"
                  >
                    {SPECIES_PLURAL[species]}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </div>
  );
}

function LoadingGrid() {
  return (
    <ListingGrid>
      {Array.from({ length: 8 }).map((_, i) => (
        <ListingCardSkeleton key={i} />
      ))}
    </ListingGrid>
  );
}
