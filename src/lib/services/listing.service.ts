import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { conflict, notFound, unprocessable } from "@/lib/errors";
import { assertOwnsListing, assertOwnsPet } from "@/lib/auth/rbac";
import type { AuthContext } from "@/lib/auth/session";
import { addDays, uniqueSlug } from "@/lib/utils";
import { buildSearchText } from "@/lib/search/text";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { assertCanCreateListing } from "@/lib/billing/entitlements";
import { scoreListingRisk } from "./risk.service";
import { notify } from "./notification.service";
import {
  safeText,
  safeParagraph,
  optionalText,
  cuidSchema,
  centsSchema,
  currencySchema,
} from "@/lib/validation/common";
import { LISTING_INTENT, LIMITS } from "@/lib/constants";

/**
 * Listings.
 *
 * A listing points at a pet rather than duplicating it, so the photos, health
 * record and lineage a buyer sees are the same ones the owner maintains. That
 * removes the classifieds failure mode where the listing is a fiction written
 * once and never updated.
 */

/**
 * The listing shape, without cross-field rules.
 *
 * Kept separate from `createListingSchema` because Zod refuses `.partial()` on
 * a schema that carries refinements — and the update schema is genuinely
 * partial, since an edit touches one or two fields at a time.
 */
const listingFields = z.object({
  petId: cuidSchema,
  intent: z.enum(LISTING_INTENT),
  title: safeText(LIMITS.titleMax, 10),
  description: safeParagraph(LIMITS.descriptionMax, 40),
  priceCents: centsSchema.default(0),
  adoptionFeeCents: centsSchema.default(0),
  studFeeCents: centsSchema.default(0),
  currency: currencySchema.default("USD"),
  negotiable: z.boolean().default(false),
  country: optionalText(60),
  region: optionalText(80),
  city: optionalText(80),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  questions: z.array(safeText(200, 5)).max(8).optional(),
  publish: z.boolean().default(false),
});

export const createListingSchema = listingFields
  .refine((v) => v.intent !== "SALE" || v.priceCents > 0, {
    message: "A sale listing needs a price.",
    path: ["priceCents"],
  })
  .refine((v) => v.intent !== "SALE" || v.priceCents >= 100, {
    message: "The minimum price is 1.00.",
    path: ["priceCents"],
  });

export type CreateListingInput = z.infer<typeof createListingSchema>;

export async function createListing(auth: AuthContext, input: CreateListingInput) {
  await enforceRateLimit("listingCreate", auth.user.id);
  await assertCanCreateListing(auth.user.id);

  const pet = await assertOwnsPet(input.petId, auth);

  const full = await db.pet.findUniqueOrThrow({
    where: { id: pet.id },
    select: {
      id: true,
      name: true,
      species: true,
      sex: true,
      breedText: true,
      city: true,
      region: true,
      country: true,
      lat: true,
      lng: true,
      status: true,
      birthDate: true,
      breed: { select: { name: true } },
      _count: { select: { photos: true } },
    },
  });

  if (full.status === "DECEASED" || full.status === "REHOMED") {
    throw conflict("This pet's profile is closed and cannot be listed.");
  }

  // A listing with no photo converts badly and reads as a scam. Requiring one
  // is a quality floor, not an arbitrary obstacle.
  if (full._count.photos === 0) {
    throw unprocessable("Add at least one photo before publishing.", [
      { field: "photos", message: "At least one photo is required." },
    ]);
  }

  const existing = await db.listing.findFirst({
    where: {
      petId: input.petId,
      status: { in: ["DRAFT", "ACTIVE", "PENDING_REVIEW", "RESERVED"] },
      deletedAt: null,
    },
    select: { id: true, status: true },
  });
  if (existing) {
    throw conflict("This pet already has an open listing. Edit or close that one first.");
  }

  const settings = await getSettings();
  const price = input.intent === "SALE" ? input.priceCents : 0;

  // Risk is assessed before anything becomes public, not after a report.
  const risk = await scoreListingRisk({
    sellerId: auth.user.id,
    priceCents: price,
    species: full.species,
    description: input.description,
    title: input.title,
  });

  const needsReview =
    settings.reviewAllListings ||
    price >= settings.manualReviewPriceCents ||
    risk.score >= 60 ||
    auth.user.trustScore < 10;

  const status = !input.publish ? "DRAFT" : needsReview ? "PENDING_REVIEW" : "ACTIVE";

  const listing = await db.$transaction(async (tx) => {
    const created = await tx.listing.create({
      data: {
        petId: input.petId,
        sellerId: auth.user.id,
        intent: input.intent,
        title: input.title,
        slug: uniqueSlug(`${input.title}`),
        description: input.description,
        priceCents: price,
        adoptionFeeCents: input.intent === "ADOPTION" ? input.adoptionFeeCents : 0,
        studFeeCents: input.intent === "BREEDING" ? input.studFeeCents : 0,
        currency: input.currency,
        negotiable: input.negotiable,
        status,
        country: input.country ?? full.country,
        region: input.region ?? full.region,
        city: input.city ?? full.city,
        lat: input.lat ?? full.lat,
        lng: input.lng ?? full.lng,
        searchText: buildSearchText(
          input.title,
          input.description,
          full.name,
          full.species,
          full.breed?.name,
          full.breedText,
          input.city ?? full.city,
          input.region ?? full.region,
          input.country ?? full.country,
        ),
        moderationStatus: needsReview ? "PENDING" : "APPROVED",
        publishedAt: status === "ACTIVE" ? new Date() : null,
        expiresAt: status === "ACTIVE" ? addDays(new Date(), settings.listingDurationDays) : null,
        ...(input.questions?.length
          ? {
              questions: {
                create: input.questions.map((prompt, position) => ({ prompt, position })),
              },
            }
          : {}),
      },
      select: { id: true, slug: true, status: true, title: true },
    });

    await tx.pet.update({
      where: { id: input.petId },
      data: {
        availability:
          input.intent === "SALE"
            ? "FOR_SALE"
            : input.intent === "ADOPTION"
              ? "FOR_ADOPTION"
              : "FOR_BREEDING",
        status: status === "ACTIVE" ? "LISTED" : undefined,
      },
    });

    await audit(
      {
        action: status === "ACTIVE" ? "listing.published" : "listing.created",
        actorId: auth.user.id,
        entityType: "LISTING",
        entityId: created.id,
        summary: `${input.intent}: ${created.title}`,
        metadata: { riskScore: risk.score, riskReasons: risk.reasons },
      },
      tx,
    );

    return created;
  });

  if (risk.score >= 40) {
    await db.riskEvent.create({
      data: {
        userId: auth.user.id,
        type: risk.primaryType,
        score: risk.score,
        entityType: "LISTING",
        entityId: listing.id,
        details: JSON.stringify(risk.reasons),
      },
    });
  }

  if (needsReview && input.publish) {
    await notify({
      userId: auth.user.id,
      category: "LISTING",
      type: "listing.pending_review",
      title: "Your listing is being reviewed",
      body: "We check listings before they go live. This usually takes a few hours.",
      url: `/dashboard/listings/${listing.id}`,
      entityType: "LISTING",
      entityId: listing.id,
    });
  }

  return listing;
}

export const updateListingSchema = listingFields
  .omit({ petId: true, publish: true })
  .partial();

export async function updateListing(
  auth: AuthContext,
  listingId: string,
  input: z.infer<typeof updateListingSchema>,
) {
  const listing = await assertOwnsListing(listingId, auth);

  if (listing.status === "COMPLETED" || listing.status === "REMOVED") {
    throw conflict("This listing is closed and can no longer be edited.");
  }

  const current = await db.listing.findUniqueOrThrow({
    where: { id: listingId },
    select: {
      title: true,
      description: true,
      intent: true,
      priceCents: true,
      city: true,
      region: true,
      country: true,
      status: true,
      pet: { select: { name: true, species: true, breedText: true, breed: { select: { name: true } } } },
    },
  });

  const settings = await getSettings();
  const nextPrice = input.priceCents ?? current.priceCents;

  // A large upward price change on a live listing is a classic bait-and-switch,
  // so it goes back through review.
  const priceJumped =
    current.status === "ACTIVE" &&
    input.priceCents !== undefined &&
    input.priceCents > current.priceCents * 3 &&
    input.priceCents > 50_000;

  const title = input.title ?? current.title;
  const description = input.description ?? current.description;

  const updated = await db.listing.update({
    where: { id: listingId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priceCents !== undefined && current.intent === "SALE"
        ? { priceCents: input.priceCents }
        : {}),
      ...(input.adoptionFeeCents !== undefined && current.intent === "ADOPTION"
        ? { adoptionFeeCents: input.adoptionFeeCents }
        : {}),
      ...(input.studFeeCents !== undefined && current.intent === "BREEDING"
        ? { studFeeCents: input.studFeeCents }
        : {}),
      ...(input.negotiable !== undefined ? { negotiable: input.negotiable } : {}),
      ...(input.city !== undefined ? { city: input.city ?? null } : {}),
      ...(input.region !== undefined ? { region: input.region ?? null } : {}),
      ...(input.country !== undefined ? { country: input.country ?? null } : {}),
      ...(input.lat !== undefined ? { lat: input.lat } : {}),
      ...(input.lng !== undefined ? { lng: input.lng } : {}),
      ...(priceJumped || nextPrice >= settings.manualReviewPriceCents
        ? { status: "PENDING_REVIEW", moderationStatus: "PENDING" }
        : {}),
      searchText: buildSearchText(
        title,
        description,
        current.pet.name,
        current.pet.species,
        current.pet.breed?.name,
        current.pet.breedText,
        input.city ?? current.city,
        input.region ?? current.region,
        input.country ?? current.country,
      ),
    },
    select: { id: true, slug: true, status: true },
  });

  await audit({
    action: "listing.updated",
    actorId: auth.user.id,
    entityType: "LISTING",
    entityId: listingId,
    metadata: { fields: Object.keys(input), priceJumped },
  });

  return updated;
}

export async function publishListing(auth: AuthContext, listingId: string) {
  const listing = await assertOwnsListing(listingId, auth);
  if (listing.status === "ACTIVE") return { status: "ACTIVE" as const };
  if (!["DRAFT", "PAUSED", "EXPIRED"].includes(listing.status)) {
    throw conflict("This listing cannot be published from its current state.");
  }

  await assertCanCreateListing(auth.user.id);

  const full = await db.listing.findUniqueOrThrow({
    where: { id: listingId },
    select: {
      priceCents: true,
      intent: true,
      petId: true,
      pet: { select: { _count: { select: { photos: true } } } },
    },
  });

  if (full.pet._count.photos === 0) {
    throw unprocessable("Add at least one photo before publishing.", [
      { field: "photos", message: "At least one photo is required." },
    ]);
  }

  const settings = await getSettings();
  const needsReview =
    settings.reviewAllListings ||
    full.priceCents >= settings.manualReviewPriceCents ||
    auth.user.trustScore < 10;

  const status = needsReview ? "PENDING_REVIEW" : "ACTIVE";

  await db.$transaction([
    db.listing.update({
      where: { id: listingId },
      data: {
        status,
        publishedAt: status === "ACTIVE" ? new Date() : null,
        expiresAt: status === "ACTIVE" ? addDays(new Date(), settings.listingDurationDays) : null,
        moderationStatus: needsReview ? "PENDING" : "APPROVED",
      },
    }),
    db.pet.update({
      where: { id: full.petId },
      data: { status: status === "ACTIVE" ? "LISTED" : "ACTIVE" },
    }),
  ]);

  await audit({
    action: "listing.published",
    actorId: auth.user.id,
    entityType: "LISTING",
    entityId: listingId,
  });

  return { status };
}

export async function pauseListing(auth: AuthContext, listingId: string) {
  const listing = await assertOwnsListing(listingId, auth);
  if (!["ACTIVE", "PENDING_REVIEW"].includes(listing.status)) {
    throw conflict("Only a live listing can be paused.");
  }

  await db.$transaction([
    db.listing.update({ where: { id: listingId }, data: { status: "PAUSED" } }),
    db.pet.update({ where: { id: listing.petId }, data: { status: "ACTIVE" } }),
  ]);

  await audit({
    action: "listing.paused",
    actorId: auth.user.id,
    entityType: "LISTING",
    entityId: listingId,
  });
}

export async function closeListing(
  auth: AuthContext,
  listingId: string,
  outcome: "COMPLETED" | "REMOVED",
) {
  const listing = await assertOwnsListing(listingId, auth);

  const openOrder = await db.petOrder.findFirst({
    where: { listingId, status: { in: ["IN_ESCROW", "HANDOVER_PENDING", "PENDING_PAYMENT"] } },
    select: { id: true },
  });
  if (openOrder) throw conflict("There is an open purchase on this listing. Resolve it first.");

  await db.$transaction([
    db.listing.update({
      where: { id: listingId },
      data: {
        status: outcome,
        completedAt: outcome === "COMPLETED" ? new Date() : null,
        deletedAt: outcome === "REMOVED" ? new Date() : null,
      },
    }),
    db.pet.update({
      where: { id: listing.petId },
      data: { status: "ACTIVE", availability: "NOT_AVAILABLE" },
    }),
  ]);

  await audit({
    action: outcome === "COMPLETED" ? "listing.completed" : "listing.removed",
    actorId: auth.user.id,
    entityType: "LISTING",
    entityId: listingId,
  });
}

// ---------------------------------------------------------------------------
// Favourites & saved searches
// ---------------------------------------------------------------------------

export async function toggleFavorite(auth: AuthContext, listingId: string) {
  const listing = await db.listing.findFirst({
    where: { id: listingId, deletedAt: null },
    select: { id: true, sellerId: true, title: true },
  });
  if (!listing) throw notFound("That listing");

  const existing = await db.favorite.findUnique({
    where: { userId_listingId: { userId: auth.user.id, listingId } },
    select: { id: true },
  });

  if (existing) {
    await db.$transaction([
      db.favorite.delete({ where: { id: existing.id } }),
      db.listing.update({ where: { id: listingId }, data: { favoriteCount: { decrement: 1 } } }),
    ]);
    return { favorited: false };
  }

  await db.$transaction([
    db.favorite.create({ data: { userId: auth.user.id, listingId } }),
    db.listing.update({ where: { id: listingId }, data: { favoriteCount: { increment: 1 } } }),
  ]);

  // Telling a seller their listing was saved is a real signal of demand and
  // brings them back. Not sent for their own listing.
  if (listing.sellerId !== auth.user.id) {
    await notify({
      userId: listing.sellerId,
      category: "LISTING",
      type: "listing.saved",
      title: "Someone saved your listing",
      body: listing.title,
      url: `/dashboard/listings/${listingId}`,
      entityType: "LISTING",
      entityId: listingId,
    });
  }

  return { favorited: true };
}

/**
 * Records a view, deduplicated per viewer per hour so a refresh does not
 * inflate the count, and updates "recently viewed" for personalisation.
 */
export async function recordListingView(params: {
  listingId: string;
  userId?: string;
  anonId?: string;
  source?: string;
}): Promise<void> {
  const identity = params.userId
    ? { userId: params.userId }
    : params.anonId
      ? { anonId: params.anonId }
      : null;
  if (!identity) return;

  const since = new Date(Date.now() - 3_600_000);
  const recent = await db.listingView.findFirst({
    where: { listingId: params.listingId, ...identity, createdAt: { gte: since } },
    select: { id: true },
  });

  if (!recent) {
    await db.$transaction([
      db.listingView.create({
        data: { listingId: params.listingId, ...identity, source: params.source ?? null },
      }),
      db.listing.update({
        where: { id: params.listingId },
        data: { viewCount: { increment: 1 } },
      }),
    ]);
  }

  if (params.userId) {
    await db.recentlyViewed.upsert({
      where: {
        userId_entityType_entityId: {
          userId: params.userId,
          entityType: "LISTING",
          entityId: params.listingId,
        },
      },
      create: { userId: params.userId, entityType: "LISTING", entityId: params.listingId },
      update: { viewedAt: new Date() },
    });
  }
}

/** Expires listings past their window. Run hourly by `listing.expire`. */
export async function expireStaleListings(): Promise<number> {
  const expiring = await db.listing.findMany({
    where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
    take: 200,
    select: { id: true, sellerId: true, title: true, petId: true },
  });

  for (const listing of expiring) {
    await db.$transaction([
      db.listing.update({ where: { id: listing.id }, data: { status: "EXPIRED" } }),
      db.pet.update({ where: { id: listing.petId }, data: { status: "ACTIVE" } }),
    ]);

    await notify({
      userId: listing.sellerId,
      category: "LISTING",
      type: "listing.expired",
      title: "Your listing expired",
      body: `"${listing.title}" is no longer visible. Renew it in one click.`,
      url: `/dashboard/listings/${listing.id}`,
      entityType: "LISTING",
      entityId: listing.id,
    });
  }

  return expiring.length;
}
