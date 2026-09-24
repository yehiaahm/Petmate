import "server-only";
import { db } from "@/lib/db";
import { boundingBox, haversineKm, ageInMonths } from "@/lib/utils";
import { searchTextClauses, relevanceScore } from "@/lib/search/text";
import { LIMITS, PUBLIC_LISTING_STATUSES, type Species } from "@/lib/constants";
import { logger } from "@/lib/logger";
import { getVisibilityBoosts } from "@/lib/billing/entitlements";

/**
 * Listing discovery.
 *
 * Query shape matters more than cleverness here. Every search narrows on an
 * indexed predicate first (status + intent + publishedAt, species, price,
 * location box) and only then applies the text match and in-memory ranking to a
 * bounded page. Nothing in this file scans the table.
 *
 * Ranking is explicit rather than magical: recency-decayed quality and
 * relevance, multiplied by paid placement and the seller's plan boost. A seller can read this and know what to improve,
 * which is the only kind of ranking a marketplace can defend.
 */

export interface ListingSearchParams {
  query?: string;
  intent?: "SALE" | "ADOPTION" | "BREEDING";
  species?: Species[];
  breedIds?: string[];
  sex?: "MALE" | "FEMALE";
  minPriceCents?: number;
  maxPriceCents?: number;
  minAgeMonths?: number;
  maxAgeMonths?: number;
  city?: string;
  country?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  verifiedOnly?: boolean;
  vaccinatedOnly?: boolean;
  minHealthScore?: number;
  minSellerTrust?: number;
  sort?: "relevance" | "newest" | "price_asc" | "price_desc" | "distance" | "health";
  page?: number;
  limit?: number;
  excludeSellerId?: string;
  /** Restrict to one seller, for a public profile's listing tab. */
  sellerId?: string;
  viewerId?: string;
}

export interface ListingCard {
  id: string;
  slug: string;
  title: string;
  intent: string;
  priceCents: number;
  adoptionFeeCents: number;
  studFeeCents: number;
  currency: string;
  negotiable: boolean;
  city: string | null;
  region: string | null;
  country: string | null;
  distanceKm: number | null;
  publishedAt: Date | null;
  featured: boolean;
  viewCount: number;
  favoriteCount: number;
  status: string;
  isFavorited: boolean;
  pet: {
    id: string;
    name: string;
    species: string;
    sex: string;
    birthDate: Date | null;
    ageMonths: number | null;
    healthScore: number;
    verificationLevel: string;
    breedName: string | null;
    photo: { url: string; alt: string | null } | null;
  };
  seller: {
    id: string;
    name: string;
    handle: string;
    avatarUrl: string | null;
    trustScore: number;
  };
}

export async function searchListings(params: ListingSearchParams): Promise<{
  items: ListingCard[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}> {
  const limit = Math.min(params.limit ?? LIMITS.pageSizeDefault, LIMITS.pageSizeMax);
  const page = Math.max(1, params.page ?? 1);
  const now = new Date();

  const box =
    params.lat != null && params.lng != null
      ? boundingBox(params.lat, params.lng, params.radiusKm ?? 100)
      : null;

  // Age filters convert to birth-date bounds so they are a b-tree range on an
  // indexed column rather than arithmetic on every row.
  const birthDateFilter: { gte?: Date; lte?: Date } = {};
  if (params.maxAgeMonths != null) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - params.maxAgeMonths);
    birthDateFilter.gte = d;
  }
  if (params.minAgeMonths != null) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - params.minAgeMonths);
    birthDateFilter.lte = d;
  }

  const petFilter = {
    ...(params.species?.length ? { species: { in: params.species } } : {}),
    ...(params.breedIds?.length ? { breedId: { in: params.breedIds } } : {}),
    ...(params.sex ? { sex: params.sex } : {}),
    ...(params.minHealthScore ? { healthScore: { gte: params.minHealthScore } } : {}),
    ...(params.verifiedOnly
      ? { verificationLevel: { in: ["DOCUMENTED", "CLINIC_VERIFIED"] } }
      : {}),
    ...(Object.keys(birthDateFilter).length ? { birthDate: birthDateFilter } : {}),
    deletedAt: null,
  };

  const where = {
    deletedAt: null,
    status: { in: PUBLIC_LISTING_STATUSES },
    ...(params.intent ? { intent: params.intent } : {}),
    ...(params.sellerId ? { sellerId: params.sellerId } : {}),
    ...(params.excludeSellerId ? { sellerId: { not: params.excludeSellerId } } : {}),
    ...(params.query ? { AND: searchTextClauses(params.query) } : {}),
    ...(params.city ? { city: params.city } : {}),
    ...(params.country ? { country: params.country } : {}),
    ...(params.minPriceCents != null || params.maxPriceCents != null
      ? {
          priceCents: {
            ...(params.minPriceCents != null ? { gte: params.minPriceCents } : {}),
            ...(params.maxPriceCents != null ? { lte: params.maxPriceCents } : {}),
          },
        }
      : {}),
    ...(box
      ? { lat: { gte: box.minLat, lte: box.maxLat }, lng: { gte: box.minLng, lte: box.maxLng } }
      : {}),
    ...(params.minSellerTrust ? { seller: { trustScore: { gte: params.minSellerTrust } } } : {}),
    ...(Object.keys(petFilter).length > 1 ? { pet: petFilter } : { pet: { deletedAt: null } }),
  } as const;

  // A geographic or relevance sort needs a wider candidate set than one page,
  // because both are computed after the query. Everything else pages in SQL.
  const needsPostRanking = Boolean(box) || params.sort === "relevance" || !params.sort;
  const fetchSize = needsPostRanking ? Math.min(400, limit * 8) : limit;
  const skip = needsPostRanking ? 0 : (page - 1) * limit;

  const orderBy =
    params.sort === "price_asc"
      ? [{ priceCents: "asc" as const }]
      : params.sort === "price_desc"
        ? [{ priceCents: "desc" as const }]
        : params.sort === "newest"
          ? [{ publishedAt: "desc" as const }]
          : params.sort === "health"
            ? [{ pet: { healthScore: "desc" as const } }]
            : [{ featuredUntil: "desc" as const }, { publishedAt: "desc" as const }];

  const [rows, total] = await Promise.all([
    db.listing.findMany({
      where,
      orderBy,
      skip,
      take: fetchSize,
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        intent: true,
        priceCents: true,
        adoptionFeeCents: true,
        studFeeCents: true,
        currency: true,
        negotiable: true,
        city: true,
        region: true,
        country: true,
        lat: true,
        lng: true,
        publishedAt: true,
        featuredUntil: true,
        viewCount: true,
        favoriteCount: true,
        status: true,
        pet: {
          select: {
            id: true,
            name: true,
            species: true,
            sex: true,
            birthDate: true,
            healthScore: true,
            verificationLevel: true,
            breed: { select: { name: true } },
            breedText: true,
            photos: { where: { isPrimary: true }, take: 1, select: { url: true, alt: true } },
          },
        },
        seller: {
          select: { id: true, name: true, handle: true, avatarUrl: true, trustScore: true },
        },
      },
    }),
    db.listing.count({ where }),
  ]);

  const favoriteIds = params.viewerId
    ? new Set(
        (
          await db.favorite.findMany({
            where: { userId: params.viewerId, listingId: { in: rows.map((r) => r.id) } },
            select: { listingId: true },
          })
        ).map((f) => f.listingId),
      )
    : new Set<string>();

  // Plan boosts only matter when the page is ranked in memory; a price or date
  // sort is the order the buyer asked for and a subscription does not change it.
  const boosts = needsPostRanking
    ? await getVisibilityBoosts(rows.map((r) => r.seller.id))
    : new Map<string, number>();

  let cards: (ListingCard & { _rank: number })[] = rows.map((row) => {
    const distanceKm =
      box && params.lat != null && params.lng != null && row.lat != null && row.lng != null
        ? haversineKm(params.lat, params.lng, row.lat, row.lng)
        : null;

    const featured = Boolean(row.featuredUntil && row.featuredUntil > now);

    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      intent: row.intent,
      priceCents: row.priceCents,
      adoptionFeeCents: row.adoptionFeeCents,
      studFeeCents: row.studFeeCents,
      currency: row.currency,
      negotiable: row.negotiable,
      city: row.city,
      region: row.region,
      country: row.country,
      distanceKm,
      publishedAt: row.publishedAt,
      featured,
      viewCount: row.viewCount,
      favoriteCount: row.favoriteCount,
      status: row.status,
      isFavorited: favoriteIds.has(row.id),
      pet: {
        id: row.pet.id,
        name: row.pet.name,
        species: row.pet.species,
        sex: row.pet.sex,
        birthDate: row.pet.birthDate,
        ageMonths: ageInMonths(row.pet.birthDate, now),
        healthScore: row.pet.healthScore,
        verificationLevel: row.pet.verificationLevel,
        breedName: row.pet.breed?.name ?? row.pet.breedText ?? null,
        photo: row.pet.photos[0] ?? null,
      },
      seller: row.seller,
      _rank: rankScore({
        featured,
        publishedAt: row.publishedAt,
        healthScore: row.pet.healthScore,
        verificationLevel: row.pet.verificationLevel,
        sellerTrust: row.seller.trustScore,
        favoriteCount: row.favoriteCount,
        distanceKm,
        planBoost: boosts.get(row.seller.id) ?? 1,
        relevance: params.query
          ? relevanceScore(params.query, { title: row.title, secondary: row.description })
          : 0,
        now,
      }),
    };
  });

  // Exact radius, after the coarse box.
  if (box && params.radiusKm) {
    cards = cards.filter((c) => c.distanceKm != null && c.distanceKm <= params.radiusKm!);
  }

  if (params.vaccinatedOnly) {
    const petIds = cards.map((c) => c.pet.id);
    const vaccinated = await db.healthRecord.findMany({
      where: { petId: { in: petIds }, type: "VACCINATION", deletedAt: null },
      select: { petId: true, nextDueAt: true },
    });
    const current = new Set(
      vaccinated.filter((v) => !v.nextDueAt || v.nextDueAt > now).map((v) => v.petId),
    );
    cards = cards.filter((c) => current.has(c.pet.id));
  }

  if (needsPostRanking) {
    if (params.sort === "distance") {
      cards.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    } else {
      cards.sort((a, b) => b._rank - a._rank);
    }
  }

  const effectiveTotal = needsPostRanking ? cards.length : total;
  const start = needsPostRanking ? (page - 1) * limit : 0;
  const paged = needsPostRanking ? cards.slice(start, start + limit) : cards;

  if (params.query) {
    void db.searchQueryLog
      .create({
        data: {
          entity: "LISTING",
          query: params.query.slice(0, 200),
          filters: JSON.stringify({
            intent: params.intent,
            species: params.species,
            city: params.city,
            minPriceCents: params.minPriceCents,
            maxPriceCents: params.maxPriceCents,
          }),
          resultCount: effectiveTotal,
          userId: params.viewerId ?? null,
        },
      })
      .catch((e) => logger.exception("search log failed", e));
  }

  return {
    items: paged.map(({ _rank, ...card }) => card),
    total: effectiveTotal,
    page,
    limit,
    pages: Math.max(1, Math.ceil(effectiveTotal / limit)),
  };
}

/**
 * The ranking formula, in one readable place.
 *
 * Paid placement is a multiplier rather than an override: a featured listing
 * with no photos and an untrusted seller still loses to a great organic one.
 * Selling visibility is fine; selling the ability to outrank quality is how a
 * marketplace rots. The same holds for a plan's boost, which is capped at
 * `MAX_VISIBILITY_BOOST` in the entitlements module.
 */
export function rankScore(input: {
  featured: boolean;
  /** The seller's plan multiplier; 1 for the free tier. */
  planBoost?: number;
  publishedAt: Date | null;
  healthScore: number;
  verificationLevel: string;
  sellerTrust: number;
  favoriteCount: number;
  distanceKm: number | null;
  relevance: number;
  now: Date;
}): number {
  let score = 0;

  score += Math.min(60, input.relevance);

  // Freshness, halving roughly every 10 days.
  if (input.publishedAt) {
    const ageDays = (input.now.getTime() - input.publishedAt.getTime()) / 86_400_000;
    score += 30 * Math.exp(-ageDays / 14);
  }

  score += (input.healthScore / 100) * 20;

  const verificationBonus: Record<string, number> = {
    NONE: 0,
    OWNER_CLAIMED: 4,
    DOCUMENTED: 10,
    CLINIC_VERIFIED: 18,
  };
  score += verificationBonus[input.verificationLevel] ?? 0;

  score += (Math.min(100, input.sellerTrust) / 100) * 15;
  score += Math.min(10, Math.log1p(input.favoriteCount) * 4);

  if (input.distanceKm != null) {
    score += Math.max(0, 20 - input.distanceKm / 10);
  }

  score *= input.planBoost ?? 1;
  return input.featured ? score * 1.35 : score;
}

// ---------------------------------------------------------------------------
// Facets
// ---------------------------------------------------------------------------

/** Counts for the filter sidebar, so a user never picks an empty filter. */
export async function getListingFacets(params: Pick<ListingSearchParams, "intent" | "country">) {
  const base = {
    deletedAt: null,
    status: { in: PUBLIC_LISTING_STATUSES },
    ...(params.intent ? { intent: params.intent } : {}),
    ...(params.country ? { country: params.country } : {}),
  } as const;

  const [bySpecies, byIntent, byCity, priceStats] = await Promise.all([
    db.listing.groupBy({ by: ["intent"], where: base, _count: true }),
    db.pet.groupBy({
      by: ["species"],
      where: { listings: { some: base } },
      _count: true,
      orderBy: { _count: { species: "desc" } },
    }),
    db.listing.groupBy({
      by: ["city"],
      where: { ...base, city: { not: null } },
      _count: true,
      orderBy: { _count: { city: "desc" } },
      take: 12,
    }),
    db.listing.aggregate({
      where: { ...base, intent: "SALE", priceCents: { gt: 0 } },
      _min: { priceCents: true },
      _max: { priceCents: true },
      _avg: { priceCents: true },
    }),
  ]);

  return {
    intents: bySpecies.map((r) => ({ value: r.intent, count: r._count })),
    species: byIntent.map((r) => ({ value: r.species, count: r._count })),
    cities: byCity
      .filter((r) => r.city)
      .map((r) => ({ value: r.city as string, count: r._count })),
    price: {
      min: priceStats._min.priceCents ?? 0,
      max: priceStats._max.priceCents ?? 0,
      avg: Math.round(priceStats._avg.priceCents ?? 0),
    },
  };
}

export async function getPopularBreeds(species?: Species, limit = 12) {
  return db.breed.findMany({
    where: { ...(species ? { species } : {}), pets: { some: { listings: { some: { status: "ACTIVE" } } } } },
    orderBy: [{ popularity: "desc" }, { name: "asc" }],
    take: limit,
    select: {
      id: true,
      name: true,
      slug: true,
      species: true,
      imageUrl: true,
      sizeClass: true,
      _count: { select: { pets: true } },
    },
  });
}

/** Autocomplete for the search bar. Mixes breeds, cities and live listings. */
export async function searchSuggestions(query: string, limit = 8) {
  if (query.trim().length < 2) return [];

  const [breeds, listings, clinics] = await Promise.all([
    db.breed.findMany({
      where: { name: { contains: query.trim() } },
      take: limit,
      orderBy: { popularity: "desc" },
      select: { id: true, name: true, slug: true, species: true },
    }),
    db.listing.findMany({
      where: { status: "ACTIVE", deletedAt: null, AND: searchTextClauses(query) },
      take: limit,
      orderBy: { publishedAt: "desc" },
      select: { id: true, slug: true, title: true, intent: true },
    }),
    db.clinic.findMany({
      where: { status: "ACTIVE", deletedAt: null, AND: searchTextClauses(query) },
      take: 3,
      select: { id: true, slug: true, name: true, city: true },
    }),
  ]);

  return [
    ...breeds.map((b) => ({
      type: "breed" as const,
      label: b.name,
      sublabel: b.species,
      href: `/breeds/${b.slug}`,
    })),
    ...listings.map((l) => ({
      type: "listing" as const,
      label: l.title,
      sublabel: l.intent === "SALE" ? "For sale" : l.intent === "ADOPTION" ? "For adoption" : "Breeding",
      href: `/pets/${l.slug}`,
    })),
    ...clinics.map((c) => ({
      type: "clinic" as const,
      label: c.name,
      sublabel: c.city ?? "Clinic",
      href: `/clinics/${c.slug}`,
    })),
  ].slice(0, limit);
}

// ---------------------------------------------------------------------------
// Personalisation
// ---------------------------------------------------------------------------

/**
 * Recommendations.
 *
 * Cold start is explicit: with fewer than three signals the feed is popular and
 * nearby rather than a pretend-personalised list built from one page view.
 */
export async function getRecommendedListings(
  userId: string | null,
  opts: { limit?: number; lat?: number | null; lng?: number | null; country?: string | null } = {},
): Promise<{ items: ListingCard[]; personalised: boolean; basis: string }> {
  const limit = opts.limit ?? 12;

  if (!userId) {
    const popular = await searchListings({
      sort: "relevance",
      limit,
      country: opts.country ?? undefined,
      lat: opts.lat ?? undefined,
      lng: opts.lng ?? undefined,
      radiusKm: opts.lat != null ? 150 : undefined,
      viewerId: undefined,
    });
    return { items: popular.items, personalised: false, basis: "Popular near you" };
  }

  const [viewed, favorites, ownedPets] = await Promise.all([
    db.recentlyViewed.findMany({
      where: { userId, entityType: "LISTING" },
      orderBy: { viewedAt: "desc" },
      take: 20,
      select: { entityId: true },
    }),
    db.favorite.findMany({
      where: { userId },
      take: 20,
      select: { listingId: true },
    }),
    db.pet.findMany({
      where: { ownerId: userId, deletedAt: null },
      select: { species: true, breedId: true },
    }),
  ]);

  const signalCount = viewed.length + favorites.length + ownedPets.length;

  if (signalCount < 3) {
    const popular = await searchListings({
      sort: "relevance",
      limit,
      country: opts.country ?? undefined,
      lat: opts.lat ?? undefined,
      lng: opts.lng ?? undefined,
      radiusKm: opts.lat != null ? 150 : undefined,
      viewerId: userId,
      excludeSellerId: userId,
    });
    return { items: popular.items, personalised: false, basis: "Popular right now" };
  }

  const interactedIds = [...viewed.map((v) => v.entityId), ...favorites.map((f) => f.listingId)];

  const interacted = await db.listing.findMany({
    where: { id: { in: interactedIds } },
    select: { intent: true, priceCents: true, pet: { select: { species: true, breedId: true } } },
  });

  const speciesCounts = new Map<string, number>();
  const breedIds = new Set<string>();
  let priceSum = 0;
  let priceCount = 0;

  for (const pet of ownedPets) {
    speciesCounts.set(pet.species, (speciesCounts.get(pet.species) ?? 0) + 2);
    if (pet.breedId) breedIds.add(pet.breedId);
  }
  for (const listing of interacted) {
    speciesCounts.set(listing.pet.species, (speciesCounts.get(listing.pet.species) ?? 0) + 1);
    if (listing.pet.breedId) breedIds.add(listing.pet.breedId);
    if (listing.priceCents > 0) {
      priceSum += listing.priceCents;
      priceCount++;
    }
  }

  const topSpecies = [...speciesCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([s]) => s as Species);

  const avgPrice = priceCount ? priceSum / priceCount : null;

  const results = await searchListings({
    species: topSpecies.length ? topSpecies : undefined,
    maxPriceCents: avgPrice ? Math.round(avgPrice * 2.2) : undefined,
    lat: opts.lat ?? undefined,
    lng: opts.lng ?? undefined,
    radiusKm: opts.lat != null ? 200 : undefined,
    country: opts.lat == null ? (opts.country ?? undefined) : undefined,
    limit: limit * 2,
    sort: "relevance",
    viewerId: userId,
    excludeSellerId: userId,
  });

  const seen = new Set(interactedIds);
  const fresh = results.items.filter((l) => !seen.has(l.id)).slice(0, limit);

  const basisParts: string[] = [];
  if (topSpecies.length) {
    basisParts.push(topSpecies.map((s) => s.toLowerCase().replace("_", " ")).join(" and "));
  }
  if (breedIds.size) basisParts.push("breeds you have looked at");

  return {
    items: fresh.length ? fresh : results.items.slice(0, limit),
    personalised: true,
    basis: basisParts.length ? `Based on your interest in ${basisParts.join(", ")}` : "Picked for you",
  };
}

export async function getRecentlyViewed(userId: string, limit = 8): Promise<ListingCard[]> {
  const rows = await db.recentlyViewed.findMany({
    where: { userId, entityType: "LISTING" },
    orderBy: { viewedAt: "desc" },
    take: limit,
    select: { entityId: true },
  });
  if (!rows.length) return [];

  const listings = await db.listing.findMany({
    where: { id: { in: rows.map((r) => r.entityId) }, status: { in: PUBLIC_LISTING_STATUSES }, deletedAt: null },
    select: {
      id: true,
      slug: true,
      title: true,
      intent: true,
      priceCents: true,
      adoptionFeeCents: true,
      studFeeCents: true,
      currency: true,
      negotiable: true,
      city: true,
      region: true,
      country: true,
      publishedAt: true,
      featuredUntil: true,
      viewCount: true,
      favoriteCount: true,
      status: true,
      pet: {
        select: {
          id: true,
          name: true,
          species: true,
          sex: true,
          birthDate: true,
          healthScore: true,
          verificationLevel: true,
          breed: { select: { name: true } },
          breedText: true,
          photos: { where: { isPrimary: true }, take: 1, select: { url: true, alt: true } },
        },
      },
      seller: { select: { id: true, name: true, handle: true, avatarUrl: true, trustScore: true } },
    },
  });

  const order = new Map(rows.map((r, i) => [r.entityId, i]));

  return listings
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      intent: row.intent,
      priceCents: row.priceCents,
      adoptionFeeCents: row.adoptionFeeCents,
      studFeeCents: row.studFeeCents,
      currency: row.currency,
      negotiable: row.negotiable,
      city: row.city,
      region: row.region,
      country: row.country,
      distanceKm: null,
      publishedAt: row.publishedAt,
      featured: Boolean(row.featuredUntil && row.featuredUntil > new Date()),
      viewCount: row.viewCount,
      favoriteCount: row.favoriteCount,
      status: row.status,
      isFavorited: false,
      pet: {
        id: row.pet.id,
        name: row.pet.name,
        species: row.pet.species,
        sex: row.pet.sex,
        birthDate: row.pet.birthDate,
        ageMonths: ageInMonths(row.pet.birthDate),
        healthScore: row.pet.healthScore,
        verificationLevel: row.pet.verificationLevel,
        breedName: row.pet.breed?.name ?? row.pet.breedText ?? null,
        photo: row.pet.photos[0] ?? null,
      },
      seller: row.seller,
    }));
}

/** Runs saved searches and alerts owners to new matches. */
export async function runSavedSearches(limit = 50): Promise<number> {
  const searches = await db.savedSearch.findMany({
    where: {
      alertsEnabled: true,
      entity: "LISTING",
      OR: [{ lastRunAt: null }, { lastRunAt: { lt: new Date(Date.now() - 6 * 3_600_000) } }],
    },
    take: limit,
    select: { id: true, userId: true, name: true, query: true, lastRunAt: true, lastSeenCount: true },
  });

  const { notify } = await import("./notification.service");
  let alerted = 0;

  for (const search of searches) {
    try {
      const filters = JSON.parse(search.query) as ListingSearchParams;
      const since = search.lastRunAt ?? new Date(Date.now() - 7 * 86_400_000);

      const results = await db.listing.count({
        where: {
          deletedAt: null,
          status: { in: PUBLIC_LISTING_STATUSES },
          publishedAt: { gt: since },
          ...(filters.intent ? { intent: filters.intent } : {}),
          ...(filters.country ? { country: filters.country } : {}),
          ...(filters.city ? { city: filters.city } : {}),
          ...(filters.species?.length ? { pet: { species: { in: filters.species } } } : {}),
          ...(filters.maxPriceCents ? { priceCents: { lte: filters.maxPriceCents } } : {}),
        },
      });

      await db.savedSearch.update({
        where: { id: search.id },
        data: { lastRunAt: new Date(), lastSeenCount: results },
      });

      if (results > 0) {
        await notify({
          userId: search.userId,
          category: "LISTING",
          type: "savedSearch.matches",
          title: `${results} new ${results === 1 ? "match" : "matches"} for "${search.name}"`,
          body: "New listings match a search you saved.",
          url: `/pets?savedSearch=${search.id}`,
        });
        alerted++;
      }
    } catch (e) {
      logger.exception("saved search failed", e, { savedSearchId: search.id });
    }
  }

  return alerted;
}
