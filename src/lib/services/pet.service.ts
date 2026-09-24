import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict, notFound, unprocessable } from "@/lib/errors";
import { assertOwnsPet } from "@/lib/auth/rbac";
import type { AuthContext } from "@/lib/auth/session";
import { generatePassportNumber, joinTags, splitTags, ageInMonths } from "@/lib/utils";
import { enforceRateLimit } from "@/lib/rate-limit";
import { awardTrustSignal } from "./trust.service";
import { recomputeHealthScore } from "./health.service";
import {
  safeText,
  safeParagraph,
  optionalText,
  speciesSchema,
  sexSchema,
  temperamentSchema,
  cuidSchema,
  pastDateSchema,
} from "@/lib/validation/common";
import { LIMITS, PET_AVAILABILITY, VISIBILITY, type Species } from "@/lib/constants";

/**
 * Pet profiles.
 *
 * A pet here is not a listing. It is a durable record that keeps working when
 * the animal is not for sale: health history, documents, lineage, reminders.
 * That is deliberate — it is what makes an owner come back to PetMate between
 * transactions, and it is what makes a listing believable when they do sell.
 */

export const createPetSchema = z.object({
  name: safeText(LIMITS.nameMax),
  species: speciesSchema,
  breedId: cuidSchema.optional(),
  breedText: optionalText(80),
  sex: sexSchema,
  birthDate: pastDateSchema.optional(),
  birthDateIsEstimate: z.boolean().default(false),
  weightKg: z.number().positive().max(2000).optional(),
  color: optionalText(60),
  description: safeParagraph(LIMITS.descriptionMax, 0).optional(),
  microchipId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{6,30}$/, "A microchip number is 6-30 letters, digits or hyphens.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  isNeutered: z.boolean().default(false),
  temperament: temperamentSchema,
  country: optionalText(60),
  region: optionalText(80),
  city: optionalText(80),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  visibility: z.enum(VISIBILITY).default("PUBLIC"),
  damId: cuidSchema.optional(),
  sireId: cuidSchema.optional(),
});

export type CreatePetInput = z.infer<typeof createPetSchema>;

export const updatePetSchema = createPetSchema.partial().extend({
  availability: z.enum(PET_AVAILABILITY).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED", "DECEASED"]).optional(),
});

export async function createPet(auth: AuthContext, input: CreatePetInput) {
  await enforceRateLimit("petCreate", auth.user.id);

  if (input.breedId) {
    const breed = await db.breed.findUnique({
      where: { id: input.breedId },
      select: { id: true, species: true },
    });
    if (!breed) throw badRequest("That breed is not in our catalogue.");
    if (breed.species !== input.species) {
      throw unprocessable("That breed does not belong to the species you chose.", [
        { field: "breedId", message: "Breed and species do not match." },
      ]);
    }
  }

  if (input.microchipId) {
    const existing = await db.pet.findUnique({
      where: { microchipId: input.microchipId },
      select: { id: true },
    });
    // A microchip identifies one animal. A duplicate is either a typo or
    // someone claiming a pet that is already registered.
    if (existing) {
      throw conflict(
        "That microchip number is already registered. If this is your pet, contact support to transfer it.",
      );
    }
  }

  // Parents must exist, match the species, and have the right sex.
  await assertParentage(input.damId, input.sireId, input.species);

  const pet = await db.$transaction(async (tx) => {
    const created = await tx.pet.create({
      data: {
        ownerId: auth.user.id,
        name: input.name,
        species: input.species,
        breedId: input.breedId ?? null,
        breedText: input.breedText ?? null,
        sex: input.sex,
        birthDate: input.birthDate ?? null,
        birthDateIsEstimate: input.birthDateIsEstimate,
        weightKg: input.weightKg ?? null,
        color: input.color ?? null,
        description: input.description ?? null,
        microchipId: input.microchipId ?? null,
        passportNo: generatePassportNumber(),
        isNeutered: input.isNeutered,
        temperament: input.temperament ? joinTags(input.temperament) : null,
        visibility: input.visibility,
        damId: input.damId ?? null,
        sireId: input.sireId ?? null,
        country: input.country ?? auth.user.country,
        region: input.region ?? null,
        city: input.city ?? auth.user.city,
        lat: input.lat ?? auth.user.lat,
        lng: input.lng ?? auth.user.lng,
        verificationLevel: input.microchipId ? "OWNER_CLAIMED" : "NONE",
      },
      select: { id: true, name: true, passportNo: true, species: true },
    });

    await audit(
      {
        action: "pet.created",
        actorId: auth.user.id,
        entityType: "PET",
        entityId: created.id,
        summary: `${created.name} (${created.species})`,
      },
      tx,
    );

    return created;
  });

  const petCount = await db.pet.count({ where: { ownerId: auth.user.id, deletedAt: null } });
  if (petCount === 1) await awardTrustSignal(auth.user.id, "FIRST_PET_ADDED");

  return pet;
}

async function assertParentage(
  damId: string | undefined,
  sireId: string | undefined,
  species: Species,
) {
  if (damId) {
    const dam = await db.pet.findUnique({
      where: { id: damId },
      select: { sex: true, species: true },
    });
    if (!dam) throw badRequest("We could not find that mother.");
    if (dam.species !== species) throw badRequest("The mother must be the same species.");
    if (dam.sex !== "FEMALE") throw badRequest("The mother must be female.");
  }
  if (sireId) {
    const sire = await db.pet.findUnique({
      where: { id: sireId },
      select: { sex: true, species: true },
    });
    if (!sire) throw badRequest("We could not find that father.");
    if (sire.species !== species) throw badRequest("The father must be the same species.");
    if (sire.sex !== "MALE") throw badRequest("The father must be male.");
  }
  if (damId && sireId && damId === sireId) {
    throw badRequest("A pet cannot be both parents.");
  }
}

export async function updatePet(
  auth: AuthContext,
  petId: string,
  input: z.infer<typeof updatePetSchema>,
) {
  await assertOwnsPet(petId, auth);

  const current = await db.pet.findUniqueOrThrow({
    where: { id: petId },
    select: { species: true, microchipId: true, status: true },
  });

  if (input.microchipId && input.microchipId !== current.microchipId) {
    const taken = await db.pet.findUnique({
      where: { microchipId: input.microchipId },
      select: { id: true },
    });
    if (taken) throw conflict("That microchip number is already registered to another pet.");
  }

  if (input.damId || input.sireId) {
    if (input.damId === petId || input.sireId === petId) {
      throw badRequest("A pet cannot be its own parent.");
    }
    await assertParentage(input.damId, input.sireId, (input.species ?? current.species) as Species);
  }

  // A listed pet cannot be quietly archived out from under an active listing.
  if (input.status && input.status !== "ACTIVE") {
    const active = await db.listing.count({
      where: { petId, status: { in: ["ACTIVE", "RESERVED", "PENDING_REVIEW"] }, deletedAt: null },
    });
    if (active > 0) {
      throw conflict("Close the active listing for this pet before changing its status.");
    }
  }

  const updated = await db.pet.update({
    where: { id: petId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.species !== undefined ? { species: input.species } : {}),
      ...(input.breedId !== undefined ? { breedId: input.breedId || null } : {}),
      ...(input.breedText !== undefined ? { breedText: input.breedText ?? null } : {}),
      ...(input.sex !== undefined ? { sex: input.sex } : {}),
      ...(input.birthDate !== undefined ? { birthDate: input.birthDate } : {}),
      ...(input.birthDateIsEstimate !== undefined
        ? { birthDateIsEstimate: input.birthDateIsEstimate }
        : {}),
      ...(input.weightKg !== undefined ? { weightKg: input.weightKg } : {}),
      ...(input.color !== undefined ? { color: input.color ?? null } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.microchipId !== undefined ? { microchipId: input.microchipId || null } : {}),
      ...(input.isNeutered !== undefined ? { isNeutered: input.isNeutered } : {}),
      ...(input.temperament !== undefined
        ? { temperament: input.temperament ? joinTags(input.temperament) : null }
        : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...(input.availability !== undefined ? { availability: input.availability } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.damId !== undefined ? { damId: input.damId || null } : {}),
      ...(input.sireId !== undefined ? { sireId: input.sireId || null } : {}),
      ...(input.country !== undefined ? { country: input.country ?? null } : {}),
      ...(input.region !== undefined ? { region: input.region ?? null } : {}),
      ...(input.city !== undefined ? { city: input.city ?? null } : {}),
      ...(input.lat !== undefined ? { lat: input.lat } : {}),
      ...(input.lng !== undefined ? { lng: input.lng } : {}),
    },
    select: { id: true, name: true },
  });

  await audit({
    action: "pet.updated",
    actorId: auth.user.id,
    entityType: "PET",
    entityId: petId,
    metadata: { fields: Object.keys(input) },
  });

  return updated;
}

export async function deletePet(auth: AuthContext, petId: string) {
  await assertOwnsPet(petId, auth);

  const blocking = await db.listing.count({
    where: { petId, status: { in: ["ACTIVE", "RESERVED", "PENDING_REVIEW"] }, deletedAt: null },
  });
  if (blocking > 0) throw conflict("Close this pet's active listing before removing the profile.");

  const upcoming = await db.appointment.count({
    where: { petId, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] }, startAt: { gt: new Date() } },
  });
  if (upcoming > 0) throw conflict("Cancel this pet's upcoming appointments first.");

  // Soft delete: the health record and lineage links stay intact for the
  // animal's descendants and for any historical transaction.
  await db.pet.update({
    where: { id: petId },
    data: { deletedAt: new Date(), status: "ARCHIVED", visibility: "PRIVATE" },
  });

  await audit({ action: "pet.deleted", actorId: auth.user.id, entityType: "PET", entityId: petId });
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export async function addPetPhoto(
  auth: AuthContext,
  petId: string,
  photo: { url: string; fileId?: string; width?: number; height?: number; alt?: string },
) {
  await assertOwnsPet(petId, auth);

  const count = await db.petPhoto.count({ where: { petId } });
  if (count >= LIMITS.photosPerPet) {
    throw conflict(`You can add up to ${LIMITS.photosPerPet} photos per pet.`);
  }

  return db.petPhoto.create({
    data: {
      petId,
      url: photo.url,
      fileId: photo.fileId ?? null,
      width: photo.width ?? null,
      height: photo.height ?? null,
      alt: photo.alt ?? null,
      position: count,
      isPrimary: count === 0,
    },
    select: { id: true, url: true, isPrimary: true, position: true },
  });
}

export async function setPrimaryPhoto(auth: AuthContext, petId: string, photoId: string) {
  await assertOwnsPet(petId, auth);

  await db.$transaction([
    db.petPhoto.updateMany({ where: { petId }, data: { isPrimary: false } }),
    // Scoped by petId so a photo id from another pet matches nothing.
    db.petPhoto.updateMany({ where: { id: photoId, petId }, data: { isPrimary: true } }),
  ]);
}

export async function deletePetPhoto(auth: AuthContext, petId: string, photoId: string) {
  await assertOwnsPet(petId, auth);

  const photo = await db.petPhoto.findFirst({
    where: { id: photoId, petId },
    select: { id: true, isPrimary: true },
  });
  if (!photo) throw notFound("That photo");

  await db.petPhoto.delete({ where: { id: photo.id } });

  // Never leave a pet with photos but no primary.
  if (photo.isPrimary) {
    const next = await db.petPhoto.findFirst({
      where: { petId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    if (next) await db.petPhoto.update({ where: { id: next.id }, data: { isPrimary: true } });
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const petCardSelect = {
  id: true,
  name: true,
  species: true,
  sex: true,
  birthDate: true,
  status: true,
  availability: true,
  verificationLevel: true,
  healthScore: true,
  passportNo: true,
  city: true,
  country: true,
  breed: { select: { id: true, name: true, slug: true } },
  breedText: true,
  photos: {
    where: { isPrimary: true },
    take: 1,
    select: { url: true, alt: true, width: true, height: true },
  },
} as const;

export async function listPetsForOwner(ownerId: string) {
  return db.pet.findMany({
    where: { ownerId, deletedAt: null },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      ...petCardSelect,
      _count: { select: { healthRecords: true, listings: true } },
      reminders: {
        where: { status: "PENDING", dueAt: { lte: new Date(Date.now() + 30 * 86_400_000) } },
        orderBy: { dueAt: "asc" },
        take: 1,
        select: { id: true, title: true, dueAt: true },
      },
    },
  });
}

export async function getPetDetail(petId: string, viewer: AuthContext | null) {
  const pet = await db.pet.findFirst({
    where: { id: petId, deletedAt: null },
    select: {
      id: true,
      ownerId: true,
      name: true,
      species: true,
      sex: true,
      birthDate: true,
      birthDateIsEstimate: true,
      weightKg: true,
      color: true,
      description: true,
      temperament: true,
      isNeutered: true,
      status: true,
      availability: true,
      visibility: true,
      verificationLevel: true,
      verifiedAt: true,
      healthScore: true,
      passportNo: true,
      microchipId: true,
      city: true,
      region: true,
      country: true,
      createdAt: true,
      breed: { select: { id: true, name: true, slug: true, sizeClass: true, temperament: true } },
      breedText: true,
      photos: { orderBy: { position: "asc" }, select: { id: true, url: true, alt: true, isPrimary: true, width: true, height: true } },
      dam: { select: { id: true, name: true, passportNo: true } },
      sire: { select: { id: true, name: true, passportNo: true } },
      owner: {
        select: {
          id: true,
          name: true,
          handle: true,
          avatarUrl: true,
          trustScore: true,
          city: true,
          country: true,
          createdAt: true,
        },
      },
      _count: { select: { damOffspring: true, sireOffspring: true } },
    },
  });

  if (!pet) throw notFound("That pet");

  const isOwner = viewer?.user.id === pet.ownerId;

  if (pet.visibility === "PRIVATE" && !isOwner) throw notFound("That pet");

  return {
    ...pet,
    // The microchip number is a claim credential: showing it publicly would let
    // anyone assert ownership of the animal elsewhere.
    microchipId: isOwner ? pet.microchipId : pet.microchipId ? "•••• registered" : null,
    temperamentTags: splitTags(pet.temperament),
    ageMonths: ageInMonths(pet.birthDate),
    isOwner,
    offspringCount: pet._count.damOffspring + pet._count.sireOffspring,
  };
}

/** Lineage tree, bounded in depth so a cycle in bad data cannot hang a page. */
export async function getLineage(petId: string, depth = 3) {
  interface Node {
    id: string;
    name: string;
    passportNo: string;
    sex: string;
    verificationLevel: string;
    dam: Node | null;
    sire: Node | null;
  }

  const seen = new Set<string>();

  async function walk(id: string, remaining: number): Promise<Node | null> {
    if (remaining <= 0 || seen.has(id)) return null;
    seen.add(id);

    const pet = await db.pet.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, passportNo: true, sex: true, verificationLevel: true, damId: true, sireId: true },
    });
    if (!pet) return null;

    const [dam, sire] = await Promise.all([
      pet.damId ? walk(pet.damId, remaining - 1) : null,
      pet.sireId ? walk(pet.sireId, remaining - 1) : null,
    ]);

    return {
      id: pet.id,
      name: pet.name,
      passportNo: pet.passportNo,
      sex: pet.sex,
      verificationLevel: pet.verificationLevel,
      dam,
      sire,
    };
  }

  return walk(petId, depth);
}

export async function transferPet(
  auth: AuthContext,
  params: { petId: string; toUserId: string; reason: "GIFT" | "RESCUE" | "SALE" | "ADOPTION"; note?: string },
) {
  await assertOwnsPet(params.petId, auth);

  if (params.toUserId === auth.user.id) throw badRequest("You already own this pet.");

  const recipient = await db.user.findFirst({
    where: { id: params.toUserId, deletedAt: null, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (!recipient) throw badRequest("We could not find that member.");

  const pending = await db.petTransfer.findFirst({
    where: { petId: params.petId, status: "PENDING" },
    select: { id: true },
  });
  if (pending) throw conflict("There is already a pending transfer for this pet.");

  const transfer = await db.petTransfer.create({
    data: {
      petId: params.petId,
      fromUserId: auth.user.id,
      toUserId: params.toUserId,
      reason: params.reason,
      note: params.note ?? null,
    },
    select: { id: true },
  });

  const { notify } = await import("./notification.service");
  const pet = await db.pet.findUniqueOrThrow({ where: { id: params.petId }, select: { name: true } });

  await notify({
    userId: params.toUserId,
    category: "SYSTEM",
    type: "pet.transfer_offered",
    title: `${auth.user.name} wants to transfer ${pet.name} to you`,
    body: "Accepting gives you the pet's full passport and health record.",
    url: "/dashboard/pets/transfers",
    entityType: "PET_TRANSFER",
    entityId: transfer.id,
  });

  return transfer;
}

export async function respondToTransfer(
  auth: AuthContext,
  transferId: string,
  accept: boolean,
) {
  const transfer = await db.petTransfer.findFirst({
    where: { id: transferId, toUserId: auth.user.id, status: "PENDING" },
    select: { id: true, petId: true, fromUserId: true },
  });
  if (!transfer) throw notFound("That transfer");

  await db.$transaction(async (tx) => {
    const claimed = await tx.petTransfer.updateMany({
      where: { id: transfer.id, status: "PENDING" },
      data: { status: accept ? "ACCEPTED" : "DECLINED", respondedAt: new Date() },
    });
    if (claimed.count === 0) throw conflict("That transfer has already been handled.");

    if (accept) {
      await tx.pet.update({
        where: { id: transfer.petId },
        data: { ownerId: auth.user.id, availability: "NOT_AVAILABLE", status: "ACTIVE" },
      });
    }

    await audit(
      {
        action: "pet.transferred",
        actorId: auth.user.id,
        entityType: "PET",
        entityId: transfer.petId,
        summary: accept ? "Transfer accepted" : "Transfer declined",
      },
      tx,
    );
  });

  if (accept) await recomputeHealthScore(transfer.petId);
}
