import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { assertCareProviderAccess, hasRole } from "@/lib/auth/rbac";
import type { AuthContext } from "@/lib/auth/session";
import { boundingBox, haversineKm, isValidTimeZone, joinTags, splitTags, uniqueSlug } from "@/lib/utils";
import { buildSearchText, searchTextClauses } from "@/lib/search/text";
import { assertOwnsFile } from "./upload.service";
import { getOrCreateConversation } from "./chat.service";
import {
  CANCELLATION_POLICY,
  CARE_MEMBER_ROLE,
  LIMITS,
  TRAINING_FORMAT,
  TRAINING_LEVEL,
  type Species,
} from "@/lib/constants";
import {
  centsSchema,
  cuidSchema,
  currencySchema,
  emailSchema,
  externalUrlSchema,
  optionalText,
  phoneSchema,
  safeParagraph,
  safeText,
  speciesSchema,
} from "@/lib/validation/common";

/**
 * Pet care providers: pet hotels and training schools.
 *
 * Two kinds of operator use the same model. An independent business registers,
 * is verified by a person before it can take bookings, and pays a commission.
 * PetMate's own operation is created by an admin, is live immediately, and its
 * takings are platform revenue. Everything downstream — availability, booking,
 * pickup, payment — is identical, which is the point: there is one booking
 * engine to get right, not two.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const providerFields = z.object({
  name: safeText(120, 2),
  tagline: safeText(140, 0).optional(),
  description: safeParagraph(4000, 0).optional(),
  email: emailSchema,
  phone: phoneSchema.optional(),
  website: externalUrlSchema.optional(),
  addressLine: safeText(200, 3),
  city: safeText(80),
  region: optionalText(80),
  country: safeText(60, 2),
  postalCode: optionalText(20),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  timezone: z
    .string()
    .refine(isValidTimeZone, "Choose a valid time zone, for example Africa/Cairo.")
    .default("UTC"),
  licenseNumber: optionalText(60),
  offersBoarding: z.boolean(),
  offersTraining: z.boolean(),
  checkInMinute: z.number().int().min(0).max(1439).default(540),
  checkOutMinute: z.number().int().min(0).max(1439).default(1080),
  offersTransport: z.boolean().default(false),
  transportRadiusKm: z.number().int().min(1).max(200).default(15),
  transportBaseCents: centsSchema.default(0),
  transportPerKmCents: z.number().int().min(0).max(100_000).default(0),
  trainerCount: z.number().int().min(1).max(50).default(1),
  amenities: z.array(safeText(40)).max(20).optional(),
  requiresVaccination: z.boolean().default(true),
  cancellationPolicy: z.enum(CANCELLATION_POLICY).default("MODERATE"),
  bookingLeadHours: z.number().int().min(0).max(168).default(12),
  currency: currencySchema.default("USD"),
  /** Honoured only for admins: marks the provider as PetMate's own. */
  official: z.boolean().optional(),
});

export const providerSchema = providerFields.superRefine((v, ctx) => {
  if (!v.offersBoarding && !v.offersTraining) {
    ctx.addIssue({ code: "custom", path: ["offersBoarding"], message: "Choose boarding, training or both." });
  }
  // Transport is priced by distance from the provider, so it needs a pin.
  if (v.offersTransport && (v.lat == null || v.lng == null)) {
    ctx.addIssue({
      code: "custom",
      path: ["lat"],
      message: "Pin your location on the form before offering pickup and drop-off.",
    });
  }
  if (v.offersBoarding && v.checkOutMinute <= 0) {
    ctx.addIssue({ code: "custom", path: ["checkOutMinute"], message: "Set a check-out time." });
  }
});

export type ProviderInput = z.infer<typeof providerSchema>;

export const unitSchema = z.object({
  id: cuidSchema.optional(),
  name: safeText(80, 2),
  description: safeParagraph(1000, 0).optional(),
  species: z.array(speciesSchema).max(8).optional(),
  maxWeightKg: z.number().min(0.1).max(150).optional(),
  nightlyCents: centsSchema.refine((n) => n > 0, "Set a nightly price."),
  capacity: z.number().int().min(1).max(200),
  amenities: z.array(safeText(40)).max(12).optional(),
  photoFileId: cuidSchema.optional(),
  isActive: z.boolean().default(true),
});

export const programSchema = z.object({
  id: cuidSchema.optional(),
  name: safeText(100, 2),
  description: safeParagraph(2000, 0).optional(),
  level: z.enum(TRAINING_LEVEL),
  format: z.enum(TRAINING_FORMAT),
  species: z.array(speciesSchema).min(1).max(8).default(["DOG"]),
  sessionsCount: z.number().int().min(1).max(30),
  sessionMinutes: z.number().int().min(15).max(240),
  sessionIntervalDays: z.number().int().min(1).max(14).default(7),
  priceCents: centsSchema.refine((n) => n > 0, "Set a price for the programme."),
  minAgeMonths: z.number().int().min(0).max(240).optional(),
  outcomes: z.array(safeText(80)).max(10).optional(),
  isActive: z.boolean().default(true),
});

export const providerHoursSchema = z.object({
  entries: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startMinute: z.number().int().min(0).max(1439),
        endMinute: z.number().int().min(1).max(1440),
        slotMinutes: z.number().int().min(15).max(240).default(60),
      }),
    )
    .max(21),
});

export const memberSchema = z.object({
  /** An email address or @handle of an existing PetMate account. */
  identifier: safeText(200, 2),
  role: z.enum(CARE_MEMBER_ROLE).exclude(["OWNER"]),
});

// ---------------------------------------------------------------------------
// Provider management
// ---------------------------------------------------------------------------

function providerData(input: ProviderInput) {
  return {
    name: input.name,
    tagline: input.tagline || null,
    description: input.description || null,
    email: input.email,
    phone: input.phone ?? null,
    website: input.website ?? null,
    addressLine: input.addressLine,
    city: input.city,
    region: input.region ?? null,
    country: input.country,
    postalCode: input.postalCode ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    timezone: input.timezone,
    licenseNumber: input.licenseNumber ?? null,
    offersBoarding: input.offersBoarding,
    offersTraining: input.offersTraining,
    checkInMinute: input.checkInMinute,
    checkOutMinute: input.checkOutMinute,
    offersTransport: input.offersTransport,
    transportRadiusKm: input.transportRadiusKm,
    transportBaseCents: input.transportBaseCents,
    transportPerKmCents: input.transportPerKmCents,
    trainerCount: input.trainerCount,
    amenities: input.amenities?.length ? joinTags(input.amenities) : null,
    requiresVaccination: input.requiresVaccination,
    cancellationPolicy: input.cancellationPolicy,
    bookingLeadHours: input.bookingLeadHours,
    currency: input.currency,
    searchText: buildSearchText(
      input.name,
      input.tagline,
      input.description,
      input.city,
      input.region,
      input.country,
      input.offersBoarding ? "pet hotel boarding kennel cattery" : null,
      input.offersTraining ? "dog training obedience trainer" : null,
    ),
  };
}

export async function createProvider(auth: AuthContext, input: ProviderInput) {
  const official = Boolean(input.official) && hasRole(auth.user, "ADMIN", "SUPER_ADMIN");

  const existing = await db.careProvider.count({
    where: { ownerUserId: auth.user.id, deletedAt: null },
  });
  if (existing >= 5 && !official) {
    throw conflict("You have reached the limit of pet care businesses per account.");
  }

  return db.$transaction(async (tx) => {
    const created = await tx.careProvider.create({
      data: {
        ...providerData(input),
        ownerUserId: auth.user.id,
        slug: uniqueSlug(input.name),
        isOfficial: official,
        // An independent business is not bookable until a person has checked
        // it. PetMate's own operation has nobody to be checked by.
        status: official ? "ACTIVE" : "PENDING",
        verifiedAt: official ? new Date() : null,
        // Official earnings are platform revenue in full; see settlement.
        commissionBps: official ? 10_000 : null,
        members: { create: { userId: auth.user.id, role: "OWNER" } },
      },
      select: { id: true, slug: true, name: true, status: true },
    });

    await tx.userRole.upsert({
      where: { userId_role: { userId: auth.user.id, role: "CARE_PROVIDER" } },
      create: { userId: auth.user.id, role: "CARE_PROVIDER" },
      update: {},
    });

    // Training needs a diary to book into. Monday to Saturday, 9 to 5, in
    // hour slots, so a new school is bookable the moment it is approved.
    if (input.offersTraining) {
      await tx.careProviderHours.createMany({
        data: [1, 2, 3, 4, 5, 6].map((weekday) => ({
          providerId: created.id,
          weekday,
          startMinute: 9 * 60,
          endMinute: 17 * 60,
          slotMinutes: 60,
        })),
      });
    }

    if (!official) {
      await tx.verification.create({
        data: {
          subjectType: "CARE_PROVIDER",
          subjectId: created.id,
          userId: auth.user.id,
          type: "CARE_LICENSE",
          status: "PENDING",
        },
      });
    }

    await audit(
      {
        action: "care.provider_created",
        actorId: auth.user.id,
        entityType: "CARE_PROVIDER",
        entityId: created.id,
        summary: `${official ? "Official provider" : "Provider"} created: ${created.name}`,
      },
      tx,
    );

    return created;
  });
}

export async function updateProvider(auth: AuthContext, providerId: string, input: ProviderInput) {
  const provider = await assertCareProviderAccess(providerId, auth, "MANAGER");

  // `official` is fixed at creation. Letting an edit flip it would let a
  // business opt out of commission, or an admin silently absorb one.
  const data = providerData(input);
  await db.careProvider.update({ where: { id: provider.id }, data });

  await audit({
    action: "care.provider_updated",
    actorId: auth.user.id,
    entityType: "CARE_PROVIDER",
    entityId: provider.id,
  });
}

export async function upsertUnit(auth: AuthContext, providerId: string, input: z.infer<typeof unitSchema>) {
  await assertCareProviderAccess(providerId, auth, "MANAGER");

  const photoUrl = input.photoFileId ? (await assertOwnsFile(input.photoFileId, auth.user.id)).url : undefined;

  const data = {
    name: input.name,
    description: input.description || null,
    species: input.species?.length ? input.species.join(",") : null,
    maxWeightKg: input.maxWeightKg ?? null,
    nightlyCents: input.nightlyCents,
    capacity: input.capacity,
    amenities: input.amenities?.length ? joinTags(input.amenities) : null,
    isActive: input.isActive,
    ...(photoUrl ? { photoUrl } : {}),
  };

  if (input.id) {
    const unit = await db.boardingUnit.findFirst({
      where: { id: input.id, providerId },
      select: { id: true, capacity: true },
    });
    if (!unit) throw notFound("That room type");

    // Shrinking below what is already sold would strand confirmed guests.
    if (input.capacity < unit.capacity) {
      const busiest = await db.boardingNight.groupBy({
        by: ["night"],
        where: { unitId: unit.id, night: { gte: new Date(Date.now() - 86_400_000) } },
        _count: { _all: true },
        orderBy: { _count: { night: "desc" } },
        take: 1,
      });
      const peak = busiest[0]?._count._all ?? 0;
      if (peak > input.capacity) {
        throw conflict(`${peak} of these rooms are already booked on one night. Capacity cannot go below that.`);
      }
    }

    return db.boardingUnit.update({ where: { id: unit.id }, data, select: { id: true } });
  }

  const count = await db.boardingUnit.count({ where: { providerId } });
  if (count >= 30) throw conflict("A provider can list up to 30 room types.");
  return db.boardingUnit.create({ data: { ...data, providerId, position: count }, select: { id: true } });
}

export async function upsertProgram(
  auth: AuthContext,
  providerId: string,
  input: z.infer<typeof programSchema>,
) {
  await assertCareProviderAccess(providerId, auth, "MANAGER");

  const data = {
    name: input.name,
    description: input.description || null,
    level: input.level,
    format: input.format,
    species: input.species.join(","),
    sessionsCount: input.sessionsCount,
    sessionMinutes: input.sessionMinutes,
    sessionIntervalDays: input.sessionIntervalDays,
    priceCents: input.priceCents,
    minAgeMonths: input.minAgeMonths ?? null,
    outcomes: input.outcomes?.length ? joinTags(input.outcomes) : null,
    isActive: input.isActive,
  };

  if (input.id) {
    const program = await db.trainingProgram.findFirst({
      where: { id: input.id, providerId },
      select: { id: true },
    });
    if (!program) throw notFound("That programme");
    // Booked customers keep the price and schedule frozen on their booking,
    // so editing a programme only changes what new customers are offered.
    return db.trainingProgram.update({ where: { id: program.id }, data, select: { id: true } });
  }

  const count = await db.trainingProgram.count({ where: { providerId } });
  if (count >= 30) throw conflict("A provider can list up to 30 programmes.");
  return db.trainingProgram.create({ data: { ...data, providerId, position: count }, select: { id: true } });
}

export async function setProviderHours(
  auth: AuthContext,
  providerId: string,
  input: z.infer<typeof providerHoursSchema>,
) {
  await assertCareProviderAccess(providerId, auth, "MANAGER");

  for (const entry of input.entries) {
    if (entry.endMinute <= entry.startMinute) throw badRequest("Closing time must be after opening time.");
  }

  await db.$transaction(async (tx) => {
    await tx.careProviderHours.deleteMany({ where: { providerId } });
    if (input.entries.length) {
      await tx.careProviderHours.createMany({
        data: input.entries.map((e) => ({ ...e, providerId })),
      });
    }
  });
}

export async function addProviderMember(
  auth: AuthContext,
  providerId: string,
  input: z.infer<typeof memberSchema>,
) {
  const provider = await assertCareProviderAccess(providerId, auth, "OWNER");

  const identifier = input.identifier.trim();
  const user = await db.user.findFirst({
    where: {
      deletedAt: null,
      ...(identifier.includes("@") && !identifier.startsWith("@")
        ? { emailNormalized: identifier.toLowerCase() }
        : { handle: identifier.replace(/^@/, "").toLowerCase() }),
    },
    select: { id: true, name: true },
  });
  if (!user) throw badRequest("We could not find a PetMate account with that email or handle.");
  if (user.id === provider.ownerUserId) throw conflict("That account already owns this business.");

  await db.$transaction(async (tx) => {
    await tx.careProviderMember.upsert({
      where: { providerId_userId: { providerId, userId: user.id } },
      create: { providerId, userId: user.id, role: input.role },
      update: { role: input.role },
    });
    await tx.userRole.upsert({
      where: { userId_role: { userId: user.id, role: "CARE_PROVIDER" } },
      create: { userId: user.id, role: "CARE_PROVIDER" },
      update: {},
    });
    await audit(
      {
        action: "care.member_changed",
        actorId: auth.user.id,
        entityType: "CARE_PROVIDER",
        entityId: providerId,
        summary: `${user.name} added as ${input.role}`,
      },
      tx,
    );
  });

  return { userId: user.id, name: user.name };
}

export async function removeProviderMember(auth: AuthContext, providerId: string, userId: string) {
  const provider = await assertCareProviderAccess(providerId, auth, "OWNER");
  if (userId === provider.ownerUserId) throw conflict("The owner cannot be removed.");

  const { count } = await db.careProviderMember.deleteMany({ where: { providerId, userId } });
  if (!count) throw notFound("That team member");

  await audit({
    action: "care.member_changed",
    actorId: auth.user.id,
    entityType: "CARE_PROVIDER",
    entityId: providerId,
    summary: `member ${userId} removed`,
  });
}

/** Opens (or reuses) a thread between an owner and a provider. */
export async function messageProvider(auth: AuthContext, providerId: string, body: string) {
  const provider = await db.careProvider.findFirst({
    where: { id: providerId, deletedAt: null, status: "ACTIVE" },
    select: { id: true, name: true, ownerUserId: true },
  });
  if (!provider) throw notFound("That provider");
  if (provider.ownerUserId === auth.user.id) throw badRequest("This is your own business.");

  const conversation = await getOrCreateConversation({
    type: "CARE",
    participantIds: [auth.user.id, provider.ownerUserId],
    contextType: "CARE_PROVIDER",
    contextId: provider.id,
    subject: provider.name,
    createdById: auth.user.id,
  });

  const { sendMessage } = await import("./chat.service");
  await sendMessage(auth, { conversationId: conversation.id, body });
  return conversation;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface CareSearchParams {
  kind: "BOARDING" | "TRAINING";
  query?: string;
  city?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  species?: Species;
  transport?: boolean;
  inHome?: boolean;
  sort?: "recommended" | "rating" | "price" | "distance";
  page?: number;
  limit?: number;
}

/**
 * Search.
 *
 * Bounded to a few hundred candidates, then priced, filtered by species and
 * distance, and sorted in memory. "From" prices come from the provider's own
 * active rooms or programmes, so the number on the card is a real price.
 */
export async function searchProviders(params: CareSearchParams) {
  const limit = Math.min(params.limit ?? 20, LIMITS.pageSizeMax);
  const page = Math.max(1, params.page ?? 1);
  const hasPoint = params.lat != null && params.lng != null;
  const radiusKm = params.radiusKm ?? 50;
  const box = hasPoint ? boundingBox(params.lat!, params.lng!, radiusKm) : null;
  const boarding = params.kind === "BOARDING";

  const rows = await db.careProvider.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      ...(boarding ? { offersBoarding: true } : { offersTraining: true }),
      ...(params.query ? { AND: searchTextClauses(params.query) } : {}),
      ...(params.city ? { city: params.city } : {}),
      ...(params.transport ? { offersTransport: true } : {}),
      ...(box
        ? { lat: { gte: box.minLat, lte: box.maxLat }, lng: { gte: box.minLng, lte: box.maxLng } }
        : {}),
    },
    orderBy: [{ isOfficial: "desc" }, { ratingAvgBps: "desc" }, { bookingCount: "desc" }],
    take: 300,
    select: {
      id: true,
      name: true,
      slug: true,
      tagline: true,
      city: true,
      country: true,
      lat: true,
      lng: true,
      logoUrl: true,
      bannerUrl: true,
      ratingAvgBps: true,
      ratingCount: true,
      bookingCount: true,
      verifiedAt: true,
      isOfficial: true,
      offersTransport: true,
      transportRadiusKm: true,
      amenities: true,
      currency: true,
      cancellationPolicy: true,
      units: {
        where: { isActive: true },
        orderBy: { nightlyCents: "asc" },
        select: { id: true, name: true, nightlyCents: true, species: true },
      },
      programs: {
        where: { isActive: true },
        orderBy: { priceCents: "asc" },
        select: { id: true, name: true, priceCents: true, species: true, format: true, level: true, sessionsCount: true },
      },
    },
  });

  const forSpecies = (species: string | null) =>
    !params.species || !species || splitTags(species).includes(params.species);

  const items = rows
    .map((p) => {
      const units = p.units.filter((u) => forSpecies(u.species));
      const programs = p.programs.filter(
        (g) => forSpecies(g.species) && (!params.inHome || g.format === "IN_HOME"),
      );
      const fromCents = boarding ? units[0]?.nightlyCents : programs[0]?.priceCents;
      const distanceKm =
        hasPoint && p.lat != null && p.lng != null ? haversineKm(params.lat!, params.lng!, p.lat, p.lng) : null;
      return { ...p, units, programs, fromCents: fromCents ?? null, distanceKm };
    })
    // Nothing bookable for this animal is not a result, it is a dead end.
    .filter((p) => (boarding ? p.units.length > 0 : p.programs.length > 0))
    .filter((p) => !hasPoint || (p.distanceKm != null && p.distanceKm <= radiusKm));

  if (params.sort === "price") items.sort((a, b) => (a.fromCents ?? 0) - (b.fromCents ?? 0));
  else if (params.sort === "rating") items.sort((a, b) => b.ratingAvgBps - a.ratingAvgBps || b.ratingCount - a.ratingCount);
  else if (params.sort === "distance" && hasPoint) items.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));

  const start = (page - 1) * limit;
  return { items: items.slice(start, start + limit), total: items.length, page, limit };
}

export async function getProviderBySlug(slug: string) {
  const provider = await db.careProvider.findFirst({
    where: { slug, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      tagline: true,
      description: true,
      email: true,
      phone: true,
      website: true,
      addressLine: true,
      city: true,
      region: true,
      country: true,
      postalCode: true,
      lat: true,
      lng: true,
      timezone: true,
      logoUrl: true,
      bannerUrl: true,
      status: true,
      verifiedAt: true,
      isOfficial: true,
      offersBoarding: true,
      offersTraining: true,
      checkInMinute: true,
      checkOutMinute: true,
      offersTransport: true,
      transportRadiusKm: true,
      transportBaseCents: true,
      transportPerKmCents: true,
      amenities: true,
      requiresVaccination: true,
      cancellationPolicy: true,
      bookingLeadHours: true,
      currency: true,
      ratingAvgBps: true,
      ratingCount: true,
      bookingCount: true,
      createdAt: true,
      ownerUserId: true,
      units: {
        where: { isActive: true },
        orderBy: [{ position: "asc" }, { nightlyCents: "asc" }],
        select: {
          id: true,
          name: true,
          description: true,
          species: true,
          maxWeightKg: true,
          nightlyCents: true,
          capacity: true,
          amenities: true,
          photoUrl: true,
        },
      },
      programs: {
        where: { isActive: true },
        orderBy: [{ position: "asc" }, { priceCents: "asc" }],
        select: {
          id: true,
          name: true,
          description: true,
          level: true,
          format: true,
          species: true,
          sessionsCount: true,
          sessionMinutes: true,
          sessionIntervalDays: true,
          priceCents: true,
          minAgeMonths: true,
          outcomes: true,
        },
      },
      hours: {
        orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
        select: { weekday: true, startMinute: true, endMinute: true },
      },
    },
  });

  if (!provider || provider.status !== "ACTIVE") throw notFound("That provider");
  return provider;
}

/** Every business the caller owns or works at, for the console switcher. */
export async function listMyProviders(auth: AuthContext) {
  return db.careProvider.findMany({
    where: {
      deletedAt: null,
      OR: [{ ownerUserId: auth.user.id }, { members: { some: { userId: auth.user.id } } }],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      city: true,
      isOfficial: true,
      offersBoarding: true,
      offersTraining: true,
      ownerUserId: true,
      _count: { select: { bookings: true } },
    },
  });
}

/** Admin view of PetMate's own operations. */
export async function listOfficialProviders() {
  return db.careProvider.findMany({
    where: { deletedAt: null, isOfficial: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true, city: true, status: true, offersBoarding: true, offersTraining: true },
  });
}

export async function getProviderConsole(auth: AuthContext, providerId: string) {
  const access = await assertCareProviderAccess(providerId, auth, "STAFF");

  const provider = await db.careProvider.findUniqueOrThrow({
    where: { id: providerId },
    select: {
      id: true,
      name: true,
      slug: true,
      tagline: true,
      description: true,
      email: true,
      phone: true,
      website: true,
      addressLine: true,
      city: true,
      region: true,
      country: true,
      postalCode: true,
      lat: true,
      lng: true,
      timezone: true,
      licenseNumber: true,
      status: true,
      isOfficial: true,
      offersBoarding: true,
      offersTraining: true,
      checkInMinute: true,
      checkOutMinute: true,
      offersTransport: true,
      transportRadiusKm: true,
      transportBaseCents: true,
      transportPerKmCents: true,
      trainerCount: true,
      amenities: true,
      requiresVaccination: true,
      cancellationPolicy: true,
      bookingLeadHours: true,
      currency: true,
      commissionBps: true,
      ratingAvgBps: true,
      ratingCount: true,
      bookingCount: true,
      ownerUserId: true,
      units: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          species: true,
          maxWeightKg: true,
          nightlyCents: true,
          capacity: true,
          amenities: true,
          photoUrl: true,
          isActive: true,
        },
      },
      programs: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          level: true,
          format: true,
          species: true,
          sessionsCount: true,
          sessionMinutes: true,
          sessionIntervalDays: true,
          priceCents: true,
          minAgeMonths: true,
          outcomes: true,
          isActive: true,
        },
      },
      hours: {
        orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
        select: { weekday: true, startMinute: true, endMinute: true, slotMinutes: true },
      },
      members: {
        orderBy: { joinedAt: "asc" },
        select: { role: true, user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      },
    },
  });

  return { provider, role: access.role };
}
