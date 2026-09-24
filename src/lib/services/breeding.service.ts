import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { assertOwnsPet } from "@/lib/auth/rbac";
import type { AuthContext } from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertCanSendBreedingRequest, getEntitlements } from "@/lib/billing/entitlements";
import { stringifyJson } from "@/lib/json";
import { boundingBox, joinTags, splitTags } from "@/lib/utils";
import { notify } from "./notification.service";
import { emailTemplates } from "@/lib/email";
import { clientEnv } from "@/lib/env";
import { getOrCreateConversation, postSystemMessage } from "./chat.service";
import {
  scoreCompatibility,
  type BreedingCandidate,
  type CompatibilityResult,
} from "@/lib/breeding/compatibility";
import {
  safeParagraph,
  optionalText,
  cuidSchema,
  centsSchema,
  temperamentSchema,
  priceCurrencySchema,
} from "@/lib/validation/common";
import { BREEDING_FEE_TYPE, LIMITS } from "@/lib/constants";
import { PLATFORM_CURRENCY } from "@/lib/currency";
import { formatMoney } from "@/lib/money";
import { applyOutcomeToFee, feeParties, isPaidArrangement, breedingCommission } from "./breeding-fee.service";

/**
 * The breeding network.
 *
 * The flow is: profile -> discover -> request -> negotiate terms -> both agree
 * -> schedule -> record the outcome and the litter. Each step is a real state
 * transition, because "message the owner and figure it out" is exactly the part
 * that goes wrong on every other platform.
 */

export const breedingProfileSchema = z.object({
  petId: cuidSchema,
  goals: z.enum(["PEDIGREE", "COMPANION", "WORKING", "SHOW"]).optional(),
  studFeeCents: centsSchema.default(0),
  currency: priceCurrencySchema,
  feeType: z.enum(BREEDING_FEE_TYPE).default("FEE"),
  willingToTravelKm: z.number().int().min(0).max(5000).default(50),
  minPartnerAgeMonths: z.number().int().min(0).max(360).optional(),
  maxPartnerAgeMonths: z.number().int().min(0).max(360).optional(),
  requiresHealthTests: z.boolean().default(true),
  requiresVaccination: z.boolean().default(true),
  requiresPedigree: z.boolean().default(false),
  allowsMixedBreed: z.boolean().default(false),
  preferredBreedIds: z.array(cuidSchema).max(10).optional(),
  temperamentTags: temperamentSchema,
  notes: safeParagraph(1500, 0).optional(),
});

export async function upsertBreedingProfile(
  auth: AuthContext,
  input: z.infer<typeof breedingProfileSchema>,
) {
  await assertOwnsPet(input.petId, auth);

  const pet = await db.pet.findUniqueOrThrow({
    where: { id: input.petId },
    select: { id: true, isNeutered: true, sex: true, species: true, name: true },
  });

  // Refusing to list a neutered animal for breeding is the honest behaviour,
  // and it stops a whole category of wasted conversations.
  if (pet.isNeutered) {
    throw badRequest(`${pet.name} is neutered and cannot be listed for breeding.`);
  }
  if (pet.sex === "UNKNOWN") {
    throw badRequest(`Set ${pet.name}'s sex before creating a breeding profile.`);
  }
  if (
    input.minPartnerAgeMonths != null &&
    input.maxPartnerAgeMonths != null &&
    input.minPartnerAgeMonths > input.maxPartnerAgeMonths
  ) {
    throw badRequest("The minimum partner age cannot be above the maximum.");
  }

  const data = {
    ownerId: auth.user.id,
    goals: input.goals ?? null,
    studFeeCents: input.feeType === "FEE" ? input.studFeeCents : 0,
    currency: input.currency,
    feeType: input.feeType,
    willingToTravelKm: input.willingToTravelKm,
    minPartnerAgeMonths: input.minPartnerAgeMonths ?? null,
    maxPartnerAgeMonths: input.maxPartnerAgeMonths ?? null,
    requiresHealthTests: input.requiresHealthTests,
    requiresVaccination: input.requiresVaccination,
    requiresPedigree: input.requiresPedigree,
    allowsMixedBreed: input.allowsMixedBreed,
    temperamentTags: input.temperamentTags ? joinTags(input.temperamentTags) : null,
    notes: input.notes ?? null,
    status: "ACTIVE",
  };

  const profile = await db.$transaction(async (tx) => {
    const saved = await tx.breedingProfile.upsert({
      where: { petId: input.petId },
      create: { petId: input.petId, ...data },
      update: data,
      select: { id: true },
    });

    await tx.breedingProfilePreferredBreed.deleteMany({ where: { profileId: saved.id } });
    if (input.preferredBreedIds?.length) {
      await tx.breedingProfilePreferredBreed.createMany({
        data: input.preferredBreedIds.map((breedId) => ({ profileId: saved.id, breedId })),
      });
    }

    await tx.pet.update({
      where: { id: input.petId },
      data: { availability: "FOR_BREEDING" },
    });

    return saved;
  });

  // Cached matches are stale the moment preferences change.
  await db.breedingMatch.deleteMany({
    where: { OR: [{ petAId: input.petId }, { petBId: input.petId }] },
  });

  return profile;
}

export async function pauseBreedingProfile(auth: AuthContext, petId: string) {
  await assertOwnsPet(petId, auth);
  await db.breedingProfile.update({
    where: { petId },
    data: { status: "PAUSED" },
  });
  await db.pet.update({ where: { id: petId }, data: { availability: "NOT_AVAILABLE" } });
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const CANDIDATE_SELECT = {
  id: true,
  ownerId: true,
  species: true,
  sex: true,
  breedId: true,
  birthDate: true,
  weightKg: true,
  isNeutered: true,
  temperament: true,
  healthScore: true,
  verificationLevel: true,
  lat: true,
  lng: true,
  city: true,
  country: true,
  damId: true,
  sireId: true,
  name: true,
  breed: { select: { name: true } },
  photos: { where: { isPrimary: true }, take: 1, select: { url: true, alt: true } },
  owner: { select: { id: true, name: true, handle: true, avatarUrl: true, trustScore: true } },
  _count: { select: { documents: true } },
  breedingProfile: {
    select: {
      willingToTravelKm: true,
      minPartnerAgeMonths: true,
      maxPartnerAgeMonths: true,
      requiresHealthTests: true,
      requiresVaccination: true,
      requiresPedigree: true,
      allowsMixedBreed: true,
      temperamentTags: true,
      studFeeCents: true,
      currency: true,
      feeType: true,
      status: true,
      notes: true,
    },
  },
} as const;

type CandidateRow = NonNullable<Awaited<ReturnType<typeof loadCandidate>>>;

async function loadCandidate(petId: string) {
  return db.pet.findFirst({
    where: { id: petId, deletedAt: null },
    select: CANDIDATE_SELECT,
  });
}

async function toCandidate(row: CandidateRow): Promise<BreedingCandidate> {
  const [ancestors, vaccinationsCurrent] = await Promise.all([
    collectAncestors(row.id),
    hasCurrentVaccinations(row.id),
  ]);

  return {
    petId: row.id,
    ownerId: row.ownerId,
    species: row.species,
    sex: row.sex,
    breedId: row.breedId,
    breedName: row.breed?.name ?? null,
    birthDate: row.birthDate,
    weightKg: row.weightKg,
    isNeutered: row.isNeutered,
    temperament: row.temperament,
    healthScore: row.healthScore,
    verificationLevel: row.verificationLevel,
    lat: row.lat,
    lng: row.lng,
    city: row.city,
    country: row.country,
    damId: row.damId,
    sireId: row.sireId,
    ancestors,
    vaccinationsCurrent,
    documentCount: row._count.documents,
    profile: row.breedingProfile
      ? {
          willingToTravelKm: row.breedingProfile.willingToTravelKm,
          minPartnerAgeMonths: row.breedingProfile.minPartnerAgeMonths,
          maxPartnerAgeMonths: row.breedingProfile.maxPartnerAgeMonths,
          requiresHealthTests: row.breedingProfile.requiresHealthTests,
          requiresVaccination: row.breedingProfile.requiresVaccination,
          requiresPedigree: row.breedingProfile.requiresPedigree,
          allowsMixedBreed: row.breedingProfile.allowsMixedBreed,
          preferredBreedIds: [],
          temperamentTags: row.breedingProfile.temperamentTags,
        }
      : null,
  };
}

/** Walks up to three generations. Bounded so bad data cannot loop forever. */
async function collectAncestors(petId: string, depth = 3): Promise<string[]> {
  const found = new Set<string>();
  let frontier = [petId];

  for (let level = 0; level < depth && frontier.length; level++) {
    const rows = await db.pet.findMany({
      where: { id: { in: frontier } },
      select: { damId: true, sireId: true },
    });

    const next: string[] = [];
    for (const row of rows) {
      for (const parent of [row.damId, row.sireId]) {
        if (parent && !found.has(parent)) {
          found.add(parent);
          next.push(parent);
        }
      }
    }
    frontier = next;
  }

  return [...found];
}

async function hasCurrentVaccinations(petId: string): Promise<boolean> {
  const vaccinations = await db.healthRecord.findMany({
    where: { petId, type: "VACCINATION", deletedAt: null },
    select: { nextDueAt: true },
  });
  if (!vaccinations.length) return false;
  const now = new Date();
  return !vaccinations.some((v) => v.nextDueAt && v.nextDueAt < now);
}

export interface MatchResult {
  pet: {
    id: string;
    name: string;
    breedName: string | null;
    photo: string | null;
    city: string | null;
    country: string | null;
    healthScore: number;
    verificationLevel: string;
    birthDate: Date | null;
    sex: string;
  };
  owner: { id: string; name: string; handle: string; avatarUrl: string | null; trustScore: number };
  fee: { cents: number; currency: string; type: string };
  compatibility: CompatibilityResult;
}

/**
 * Finds matches for one pet.
 *
 * Narrows in SQL on the cheap indexed predicates (species, opposite sex, not
 * neutered, has an active profile, inside a bounding box) and only then runs
 * the scorer in memory on a bounded candidate set. Scoring every pet on the
 * platform in JavaScript would not survive contact with real data.
 */
export async function findMatches(
  auth: AuthContext,
  petId: string,
  options: { limit?: number; maxDistanceKm?: number; minScore?: number } = {},
): Promise<MatchResult[]> {
  await assertOwnsPet(petId, auth);

  const subjectRow = await loadCandidate(petId);
  if (!subjectRow) throw notFound("That pet");
  if (!subjectRow.breedingProfile) {
    throw badRequest("Create a breeding profile for this pet first.");
  }

  const subject = await toCandidate(subjectRow);
  const entitlements = await getEntitlements(auth.user.id);

  const oppositeSex = subject.sex === "MALE" ? "FEMALE" : "MALE";
  const radius = options.maxDistanceKm ?? subjectRow.breedingProfile.willingToTravelKm * 2;

  const box =
    subject.lat != null && subject.lng != null ? boundingBox(subject.lat, subject.lng, radius) : null;

  const candidateRows = await db.pet.findMany({
    where: {
      deletedAt: null,
      id: { not: petId },
      ownerId: { not: auth.user.id },
      species: subject.species,
      sex: oppositeSex,
      isNeutered: false,
      visibility: "PUBLIC",
      status: { in: ["ACTIVE", "LISTED"] },
      breedingProfile: { is: { status: "ACTIVE" } },
      owner: { status: "ACTIVE", deletedAt: null },
      ...(box
        ? {
            lat: { gte: box.minLat, lte: box.maxLat },
            lng: { gte: box.minLng, lte: box.maxLng },
          }
        : {}),
    },
    select: CANDIDATE_SELECT,
    // Advanced matching widens the pool; the free tier still gets real results.
    take: entitlements.advancedMatching ? 200 : 60,
    orderBy: [{ healthScore: "desc" }, { createdAt: "desc" }],
  });

  const blocked = await db.block.findMany({
    where: {
      OR: [
        { blockerId: auth.user.id, blockedId: { in: candidateRows.map((c) => c.ownerId) } },
        { blockedId: auth.user.id, blockerId: { in: candidateRows.map((c) => c.ownerId) } },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });
  const blockedUserIds = new Set(blocked.flatMap((b) => [b.blockerId, b.blockedId]));

  const results: MatchResult[] = [];

  for (const row of candidateRows) {
    if (blockedUserIds.has(row.ownerId)) continue;

    const candidate = await toCandidate(row);
    const compatibility = scoreCompatibility(subject, candidate);

    if (!compatibility.eligible) continue;
    if (compatibility.score < (options.minScore ?? 30)) continue;

    results.push({
      pet: {
        id: row.id,
        name: row.name,
        breedName: row.breed?.name ?? null,
        photo: row.photos[0]?.url ?? null,
        city: row.city,
        country: row.country,
        healthScore: row.healthScore,
        verificationLevel: row.verificationLevel,
        birthDate: row.birthDate,
        sex: row.sex,
      },
      owner: row.owner,
      fee: {
        cents: row.breedingProfile?.studFeeCents ?? 0,
        currency: row.breedingProfile?.currency ?? PLATFORM_CURRENCY,
        type: row.breedingProfile?.feeType ?? "FEE",
      },
      compatibility,
    });
  }

  results.sort((a, b) => b.compatibility.score - a.compatibility.score);
  const limited = results.slice(0, options.limit ?? 24);

  // Cache the scores so the list page and the detail page agree, and so the
  // recompute job has something to refresh.
  await Promise.allSettled(
    limited.map((m) =>
      db.breedingMatch.upsert({
        where: { petAId_petBId: { petAId: petId, petBId: m.pet.id } },
        create: {
          petAId: petId,
          petBId: m.pet.id,
          score: m.compatibility.score,
          breakdown: stringifyJson(m.compatibility.factors),
        },
        update: {
          score: m.compatibility.score,
          breakdown: stringifyJson(m.compatibility.factors),
          computedAt: new Date(),
        },
      }),
    ),
  );

  return limited;
}

/** Scores one specific pairing, for the "why this match" panel. */
export async function explainMatch(auth: AuthContext, petAId: string, petBId: string) {
  await assertOwnsPet(petAId, auth);

  const [rowA, rowB] = await Promise.all([loadCandidate(petAId), loadCandidate(petBId)]);
  if (!rowA || !rowB) throw notFound("That pet");

  const [a, b] = await Promise.all([toCandidate(rowA), toCandidate(rowB)]);
  return scoreCompatibility(a, b);
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const breedingRequestSchema = z.object({
  fromPetId: cuidSchema,
  toPetId: cuidSchema,
  message: safeParagraph(LIMITS.messageMax, 20),
});

export async function sendBreedingRequest(
  auth: AuthContext,
  input: z.infer<typeof breedingRequestSchema>,
) {
  await enforceRateLimit("breedingRequest", auth.user.id);
  await assertCanSendBreedingRequest(auth.user.id);
  await assertOwnsPet(input.fromPetId, auth);

  const [fromRow, toRow] = await Promise.all([
    loadCandidate(input.fromPetId),
    loadCandidate(input.toPetId),
  ]);
  if (!fromRow || !toRow) throw notFound("That pet");
  if (toRow.ownerId === auth.user.id) throw badRequest("You cannot send a request to your own pet.");
  if (!toRow.breedingProfile || toRow.breedingProfile.status !== "ACTIVE") {
    throw badRequest("That pet is not currently available for breeding.");
  }

  const blocked = await db.block.findFirst({
    where: {
      OR: [
        { blockerId: toRow.ownerId, blockedId: auth.user.id },
        { blockerId: auth.user.id, blockedId: toRow.ownerId },
      ],
    },
    select: { id: true },
  });
  if (blocked) throw notFound("That pet");

  const existing = await db.breedingRequest.findFirst({
    where: {
      initiatorPetId: input.fromPetId,
      receiverPetId: input.toPetId,
      status: { in: ["PENDING", "ACCEPTED", "TERMS_PROPOSED", "AGREED", "SCHEDULED"] },
    },
    select: { id: true },
  });
  if (existing) throw conflict("You already have an open request for this pairing.");

  const [from, to] = await Promise.all([toCandidate(fromRow), toCandidate(toRow)]);
  const compatibility = scoreCompatibility(from, to);

  if (!compatibility.eligible) {
    throw badRequest(`These pets are not a valid pairing: ${compatibility.blockers[0]}`);
  }

  const conversation = await getOrCreateConversation({
    type: "BREEDING",
    participantIds: [auth.user.id, toRow.ownerId],
    contextType: "BREEDING_REQUEST",
    subject: `${fromRow.name} × ${toRow.name}`,
    createdById: auth.user.id,
  });

  const request = await db.$transaction(async (tx) => {
    const created = await tx.breedingRequest.create({
      data: {
        initiatorPetId: input.fromPetId,
        receiverPetId: input.toPetId,
        initiatorUserId: auth.user.id,
        receiverUserId: toRow.ownerId,
        message: input.message,
        compatibilityScore: compatibility.score,
        compatibilityBreakdown: stringifyJson(compatibility.factors),
        feeCents: toRow.breedingProfile?.studFeeCents ?? 0,
        currency: toRow.breedingProfile?.currency ?? PLATFORM_CURRENCY,
        feeType: toRow.breedingProfile?.feeType ?? "FEE",
        conversationId: conversation.id,
      },
      select: { id: true },
    });

    await tx.breedingRequest.update({
      where: { id: created.id },
      data: { compatibilityScore: compatibility.score },
    });

    await audit(
      {
        action: "breeding.requested",
        actorId: auth.user.id,
        entityType: "BREEDING_REQUEST",
        entityId: created.id,
        summary: `${fromRow.name} → ${toRow.name} (score ${compatibility.score})`,
      },
      tx,
    );

    return created;
  });

  await db.conversation.update({
    where: { id: conversation.id },
    data: { contextId: request.id },
  });

  await postSystemMessage({
    conversationId: conversation.id,
    systemType: "breeding.requested",
    body: `${auth.user.name} sent a breeding request: ${fromRow.name} × ${toRow.name}. Compatibility ${compatibility.score}/100.`,
    data: { requestId: request.id, score: compatibility.score },
  });

  await notify({
    userId: toRow.ownerId,
    category: "BREEDING",
    type: "breeding.request",
    title: `Breeding request for ${toRow.name}`,
    body: `${auth.user.name} would like to match ${fromRow.name}. Compatibility ${compatibility.score}/100.`,
    url: `/dashboard/breeding/requests/${request.id}`,
    entityType: "BREEDING_REQUEST",
    entityId: request.id,
    email: () =>
      emailTemplates.breedingRequest({
        fromName: auth.user.name,
        fromPet: fromRow.name,
        toPet: toRow.name,
        score: compatibility.score,
        url: `${clientEnv.NEXT_PUBLIC_APP_URL}/dashboard/breeding/requests/${request.id}`,
      }),
  });

  return { id: request.id, conversationId: conversation.id, score: compatibility.score };
}

export async function respondToBreedingRequest(
  auth: AuthContext,
  requestId: string,
  action: "ACCEPT" | "DECLINE",
  note?: string,
) {
  const request = await db.breedingRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      receiverUserId: true,
      initiatorUserId: true,
      conversationId: true,
      initiatorPet: { select: { name: true } },
      receiverPet: { select: { name: true } },
    },
  });
  if (!request) throw notFound("That request");
  if (request.receiverUserId !== auth.user.id) throw notFound("That request");
  if (request.status !== "PENDING") throw conflict("This request has already been answered.");

  const nextStatus = action === "ACCEPT" ? "ACCEPTED" : "DECLINED";

  const claimed = await db.breedingRequest.updateMany({
    where: { id: requestId, status: "PENDING" },
    data: { status: nextStatus, respondedAt: new Date() },
  });
  if (claimed.count === 0) throw conflict("This request has already been answered.");

  await audit({
    action: "breeding.responded",
    actorId: auth.user.id,
    entityType: "BREEDING_REQUEST",
    entityId: requestId,
    summary: nextStatus,
  });

  if (request.conversationId) {
    await postSystemMessage({
      conversationId: request.conversationId,
      systemType: `breeding.${nextStatus.toLowerCase()}`,
      body:
        action === "ACCEPT"
          ? `${auth.user.name} accepted the breeding request. Next: agree the terms.`
          : `${auth.user.name} declined the breeding request.${note ? ` "${note}"` : ""}`,
      data: { requestId },
    });
  }

  await notify({
    userId: request.initiatorUserId,
    category: "BREEDING",
    type: `breeding.${nextStatus.toLowerCase()}`,
    title:
      action === "ACCEPT"
        ? `${request.receiverPet.name}'s owner accepted`
        : `Request for ${request.receiverPet.name} was declined`,
    body:
      action === "ACCEPT"
        ? "Agree the terms to move forward."
        : note || "They are not taking this pairing forward.",
    url: `/dashboard/breeding/requests/${requestId}`,
    entityType: "BREEDING_REQUEST",
    entityId: requestId,
  });

  return { status: nextStatus };
}

export const breedingTermsSchema = z.object({
  feeCents: centsSchema,
  currency: priceCurrencySchema,
  feeType: z.enum(BREEDING_FEE_TYPE),
  termsText: safeParagraph(3000, 20),
  scheduledAt: z
    .string()
    .datetime({ offset: true })
    .transform((s) => new Date(s))
    .refine((d) => d > new Date(), "Pick a date in the future.")
    .optional(),
  locationNote: optionalText(200),
});

/** Either party may propose terms; both must then agree before scheduling. */
export async function proposeTerms(
  auth: AuthContext,
  requestId: string,
  input: z.infer<typeof breedingTermsSchema>,
) {
  const request = await requireParty(auth, requestId);

  if (!["ACCEPTED", "TERMS_PROPOSED"].includes(request.status)) {
    throw conflict("Terms can only be proposed once the request has been accepted.");
  }

  const otherUserId =
    request.initiatorUserId === auth.user.id ? request.receiverUserId : request.initiatorUserId;

  await db.breedingRequest.update({
    where: { id: requestId },
    data: {
      status: "TERMS_PROPOSED",
      feeCents: input.feeCents,
      currency: input.currency,
      feeType: input.feeType,
      termsText: input.termsText,
      termsProposedById: auth.user.id,
      scheduledAt: input.scheduledAt ?? null,
      locationNote: input.locationNote ?? null,
      // A new proposal resets both agreements: nobody is bound by terms they
      // agreed to before the other side changed them.
      initiatorAgreedAt: null,
      receiverAgreedAt: null,
      // Nothing can have been paid before agreement, so this never discards money.
      feeStatus: "NONE",
      feePayerUserId: null,
      feePayeeUserId: null,
      feeCommissionCents: 0,
      feePayoutCents: 0,
    },
  });

  if (request.conversationId) {
    await postSystemMessage({
      conversationId: request.conversationId,
      systemType: "breeding.terms_proposed",
      body: `${auth.user.name} proposed terms for this breeding.`,
      data: { requestId },
    });
  }

  await notify({
    userId: otherUserId,
    category: "BREEDING",
    type: "breeding.terms_proposed",
    title: "Breeding terms proposed",
    body: "Review and agree to move forward.",
    url: `/dashboard/breeding/requests/${requestId}`,
    entityType: "BREEDING_REQUEST",
    entityId: requestId,
  });
}

export async function agreeToTerms(auth: AuthContext, requestId: string) {
  const request = await requireParty(auth, requestId);

  if (request.status !== "TERMS_PROPOSED" && request.status !== "AGREED") {
    throw conflict("There are no terms to agree to yet.");
  }
  if (!request.termsText) throw conflict("There are no terms to agree to yet.");

  const isInitiator = request.initiatorUserId === auth.user.id;

  const updated = await db.breedingRequest.update({
    where: { id: requestId },
    data: isInitiator ? { initiatorAgreedAt: new Date() } : { receiverAgreedAt: new Date() },
    select: { initiatorAgreedAt: true, receiverAgreedAt: true, conversationId: true },
  });

  const bothAgreed = Boolean(updated.initiatorAgreedAt && updated.receiverAgreedAt);
  let parties: ReturnType<typeof feeParties> | null = null;

  if (bothAgreed) {
    // A paid arrangement becomes a fee owed through PetMate the moment both
    // owners are bound by it. Guarded on NONE so agreeing again never reopens
    // a fee that has already been paid.
    parties = isPaidArrangement(request) ? feeParties(request) : null;
    await db.breedingRequest.update({
      where: { id: requestId },
      data: { status: request.scheduledAt ? "SCHEDULED" : "AGREED" },
    });
    if (parties) {
      await db.breedingRequest.updateMany({
        where: { id: requestId, feeStatus: "NONE" },
        data: { feeStatus: "DUE", feePayerUserId: parties.payerUserId, feePayeeUserId: parties.payeeUserId },
      });
    }

    await audit({
      action: "breeding.agreed",
      actorId: auth.user.id,
      entityType: "BREEDING_REQUEST",
      entityId: requestId,
    });

    if (updated.conversationId) {
      await postSystemMessage({
        conversationId: updated.conversationId,
        systemType: "breeding.agreed",
        body: "Both owners have agreed the terms.",
        data: { requestId },
      });
    }

    const otherUserId = isInitiator ? request.receiverUserId : request.initiatorUserId;
    await notify({
      userId: otherUserId,
      category: "BREEDING",
      type: "breeding.agreed",
      title: "Breeding terms agreed",
      body: "Both of you have agreed. You can now arrange the date.",
      url: `/dashboard/breeding/requests/${requestId}`,
      entityType: "BREEDING_REQUEST",
      entityId: requestId,
    });

    if (parties) {
      await notify({
        userId: parties.payerUserId,
        category: "BREEDING",
        type: "breeding.fee_due",
        title: "Pay the stud fee to confirm",
        body: `${formatMoney(request.feeCents, request.currency)} is held by PetMate until the breeding is recorded, and refunded if it is cancelled.`,
        url: `/dashboard/breeding/requests/${requestId}`,
        entityType: "BREEDING_REQUEST",
        entityId: requestId,
      });
    }
  }

  return { bothAgreed, feeDue: Boolean(parties && bothAgreed) };
}

export async function recordBreedingOutcome(
  auth: AuthContext,
  requestId: string,
  input: {
    outcome: "SUCCESSFUL" | "UNSUCCESSFUL" | "CANCELLED";
    expectedAt?: Date;
    notes?: string;
  },
) {
  const request = await requireParty(auth, requestId);

  if (!["AGREED", "SCHEDULED"].includes(request.status)) {
    throw conflict("Only an agreed breeding can be completed.");
  }

  // A paid arrangement settles through PetMate: the fee has to be in escrow
  // before the breeding is recorded as done.
  if (input.outcome !== "CANCELLED" && request.feeStatus === "DUE") {
    throw conflict("The agreed stud fee has to be paid through PetMate before the breeding is recorded.");
  }
  // Once the fee is held, only the stud's owner can call the breeding off,
  // which refunds it. Otherwise the payer could take the fee back afterwards.
  if (input.outcome === "CANCELLED" && request.feeStatus === "HELD" && request.feePayerUserId === auth.user.id) {
    throw conflict(
      "The stud fee is held for this breeding. Ask the other owner to cancel, which refunds you in full, or report a problem.",
    );
  }
  if (request.feeStatus === "FROZEN") {
    throw conflict("This breeding is under review by our team.");
  }

  await db.$transaction(async (tx) => {
    const moved = await tx.breedingRequest.updateMany({
      where: { id: requestId, status: { in: ["AGREED", "SCHEDULED"] } },
      data: {
        status: input.outcome === "CANCELLED" ? "CANCELLED" : "COMPLETED",
        outcome: input.outcome,
        completedAt: new Date(),
      },
    });
    if (moved.count === 0) throw conflict("This breeding has already been recorded.");

    if (input.outcome === "SUCCESSFUL") {
      const dam =
        request.initiatorPetSex === "FEMALE" ? request.initiatorPetId : request.receiverPetId;
      const sire =
        request.initiatorPetSex === "FEMALE" ? request.receiverPetId : request.initiatorPetId;

      await tx.litter.create({
        data: {
          damPetId: dam,
          sirePetId: sire,
          breedingRequestId: requestId,
          expectedAt: input.expectedAt ?? null,
          notes: input.notes ?? null,
        },
      });

      for (const petId of [request.initiatorPetId, request.receiverPetId]) {
        await tx.breedingProfile.updateMany({
          where: { petId },
          data: { timesBred: { increment: 1 }, successfulBreedings: { increment: 1 } },
        });
      }
    } else if (input.outcome === "UNSUCCESSFUL") {
      // A cancelled breeding never happened, so it does not count as one.
      for (const petId of [request.initiatorPetId, request.receiverPetId]) {
        await tx.breedingProfile.updateMany({
          where: { petId },
          data: { timesBred: { increment: 1 } },
        });
      }
    }

    await audit(
      {
        action: "breeding.completed",
        actorId: auth.user.id,
        entityType: "BREEDING_REQUEST",
        entityId: requestId,
        summary: input.outcome,
      },
      tx,
    );
  });

  await applyOutcomeToFee(auth, requestId, input.outcome);

  const otherUserId =
    request.initiatorUserId === auth.user.id ? request.receiverUserId : request.initiatorUserId;

  await notify({
    userId: otherUserId,
    category: "BREEDING",
    type: "breeding.completed",
    title:
      input.outcome === "SUCCESSFUL"
        ? "Breeding recorded as successful"
        : input.outcome === "UNSUCCESSFUL"
          ? "Breeding recorded as unsuccessful"
          : "Breeding cancelled",
    body: input.notes ?? "",
    url: `/dashboard/breeding/requests/${requestId}`,
    entityType: "BREEDING_REQUEST",
    entityId: requestId,
  });
}

async function requireParty(auth: AuthContext, requestId: string) {
  const request = await db.breedingRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      initiatorUserId: true,
      receiverUserId: true,
      initiatorPetId: true,
      receiverPetId: true,
      conversationId: true,
      termsText: true,
      scheduledAt: true,
      feeType: true,
      feeCents: true,
      currency: true,
      feeStatus: true,
      feePayerUserId: true,
      initiatorPet: { select: { sex: true } },
    },
  });
  if (!request) throw notFound("That request");

  if (request.initiatorUserId !== auth.user.id && request.receiverUserId !== auth.user.id) {
    throw notFound("That request");
  }

  return { ...request, initiatorPetSex: request.initiatorPet.sex };
}

export async function listBreedingRequests(
  auth: AuthContext,
  direction: "incoming" | "outgoing" | "all" = "all",
) {
  const where =
    direction === "incoming"
      ? { receiverUserId: auth.user.id }
      : direction === "outgoing"
        ? { initiatorUserId: auth.user.id }
        : { OR: [{ receiverUserId: auth.user.id }, { initiatorUserId: auth.user.id }] };

  const requests = await db.breedingRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true,
      status: true,
      message: true,
      compatibilityScore: true,
      feeCents: true,
      currency: true,
      feeType: true,
      scheduledAt: true,
      createdAt: true,
      initiatorUserId: true,
      receiverUserId: true,
      initiatorAgreedAt: true,
      receiverAgreedAt: true,
      conversationId: true,
      initiatorPet: {
        select: {
          id: true,
          name: true,
          sex: true,
          breed: { select: { name: true } },
          photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
        },
      },
      receiverPet: {
        select: {
          id: true,
          name: true,
          sex: true,
          breed: { select: { name: true } },
          photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
        },
      },
      initiatorUser: { select: { id: true, name: true, handle: true, avatarUrl: true } },
      receiverUser: { select: { id: true, name: true, handle: true, avatarUrl: true } },
    },
  });

  return requests.map((r) => ({
    ...r,
    isIncoming: r.receiverUserId === auth.user.id,
    myPet: r.receiverUserId === auth.user.id ? r.receiverPet : r.initiatorPet,
    theirPet: r.receiverUserId === auth.user.id ? r.initiatorPet : r.receiverPet,
    counterparty: r.receiverUserId === auth.user.id ? r.initiatorUser : r.receiverUser,
    iAgreed:
      r.initiatorUserId === auth.user.id ? Boolean(r.initiatorAgreedAt) : Boolean(r.receiverAgreedAt),
    theyAgreed:
      r.initiatorUserId === auth.user.id ? Boolean(r.receiverAgreedAt) : Boolean(r.initiatorAgreedAt),
  }));
}

/** One request, as either owner sees it, with everything the request page acts on. */
export async function getBreedingRequest(auth: AuthContext, requestId: string) {
  const request = await db.breedingRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      message: true,
      compatibilityScore: true,
      feeCents: true,
      currency: true,
      feeType: true,
      termsText: true,
      termsProposedById: true,
      scheduledAt: true,
      locationNote: true,
      outcome: true,
      completedAt: true,
      createdAt: true,
      initiatorUserId: true,
      receiverUserId: true,
      initiatorAgreedAt: true,
      receiverAgreedAt: true,
      conversationId: true,
      feeStatus: true,
      feePayerUserId: true,
      feePayeeUserId: true,
      feePaymentIntentId: true,
      feeCommissionCents: true,
      feePayoutCents: true,
      feePaidAt: true,
      feeReleaseAt: true,
      feeReleasedAt: true,
      feeRefundedAt: true,
      initiatorPet: {
        select: {
          id: true,
          name: true,
          sex: true,
          breed: { select: { name: true } },
          photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
        },
      },
      receiverPet: {
        select: {
          id: true,
          name: true,
          sex: true,
          breed: { select: { name: true } },
          photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
        },
      },
      initiatorUser: { select: { id: true, name: true, handle: true, avatarUrl: true } },
      receiverUser: { select: { id: true, name: true, handle: true, avatarUrl: true } },
    },
  });
  if (!request) throw notFound("That request");
  if (request.initiatorUserId !== auth.user.id && request.receiverUserId !== auth.user.id) {
    throw notFound("That request");
  }

  const isInitiator = request.initiatorUserId === auth.user.id;

  // Before payment the split is an estimate on the stud owner's current plan;
  // from payment on it is the amount fixed on the request.
  let commissionCents = request.feeCommissionCents;
  let payoutCents = request.feePayoutCents;
  if (request.feeStatus === "DUE" && request.feePayeeUserId) {
    ({ commissionCents, payoutCents } = await breedingCommission(request.feePayeeUserId, request.feeCents));
  }

  return {
    ...request,
    isIncoming: !isInitiator,
    myPet: isInitiator ? request.initiatorPet : request.receiverPet,
    theirPet: isInitiator ? request.receiverPet : request.initiatorPet,
    counterparty: isInitiator ? request.receiverUser : request.initiatorUser,
    iAgreed: Boolean(isInitiator ? request.initiatorAgreedAt : request.receiverAgreedAt),
    theyAgreed: Boolean(isInitiator ? request.receiverAgreedAt : request.initiatorAgreedAt),
    iPayFee: request.feePayerUserId === auth.user.id,
    iReceiveFee: request.feePayeeUserId === auth.user.id,
    commissionCents,
    payoutCents,
  };
}

/** Refreshes cached match scores. Run by `breeding.refreshMatches`. */
export async function refreshStaleMatches(limit = 100): Promise<number> {
  const stale = await db.breedingMatch.findMany({
    where: { computedAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
    take: limit,
    select: { id: true, petAId: true, petBId: true },
  });

  let refreshed = 0;
  for (const match of stale) {
    const [rowA, rowB] = await Promise.all([loadCandidate(match.petAId), loadCandidate(match.petBId)]);
    if (!rowA || !rowB) {
      await db.breedingMatch.delete({ where: { id: match.id } });
      continue;
    }
    const [a, b] = await Promise.all([toCandidate(rowA), toCandidate(rowB)]);
    const result = scoreCompatibility(a, b);

    await db.breedingMatch.update({
      where: { id: match.id },
      data: {
        score: result.score,
        breakdown: stringifyJson(result.factors),
        computedAt: new Date(),
      },
    });
    refreshed++;
  }

  return refreshed;
}

export function describeFee(cents: number, currency: string, type: string): string {
  if (type === "FREE" || cents === 0) return "No fee";
  if (type === "PICK_OF_LITTER") return "Pick of the litter";
  if (type === "SPLIT") return "Split the litter";
  return `${currency} ${(cents / 100).toFixed(0)} stud fee`;
}

export { splitTags };
