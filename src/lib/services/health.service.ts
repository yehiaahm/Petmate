import "server-only";
import { z } from "zod";
import { db, type DbClient } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { assertOwnsPet, assertPetHealthAccess, isStaff } from "@/lib/auth/rbac";
import type { AuthContext } from "@/lib/auth/session";
import { addMonths, ageInMonths, clamp } from "@/lib/utils";
import { HEALTH_RECORD_TYPE, LIMITS, type Species } from "@/lib/constants";
import { safeText, safeParagraph, optionalText, cuidSchema, pastDateSchema } from "@/lib/validation/common";
import { awardTrustSignal } from "./trust.service";
import { notify } from "./notification.service";
import { emailTemplates } from "@/lib/email";
import { clientEnv } from "@/lib/env";

/**
 * The health record.
 *
 * This is the part of PetMate that a Facebook group cannot copy. A vaccination
 * entered by a clinic through its own account is marked CLINIC and is
 * authoritative; one typed in by an owner is marked OWNER and is shown as
 * unverified everywhere it appears. That distinction is the entire value: a
 * buyer can tell the difference between "the seller says it is vaccinated" and
 * "a licensed clinic recorded the vaccination".
 */

/**
 * The record fields, without cross-field rules.
 *
 * Zod refuses `.omit()` and `.partial()` on a refined schema, and the API
 * route needs to omit `petId` (it comes from the URL). So the base object and
 * the refinements live separately.
 */
const healthRecordFields = z.object({
  petId: cuidSchema,
  type: z.enum(HEALTH_RECORD_TYPE),
  title: safeText(LIMITS.titleMax),
  description: safeParagraph(2000, 0).optional(),
  occurredAt: pastDateSchema,
  nextDueAt: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .transform((s) => new Date(s))
    .refine((d) => !Number.isNaN(d.getTime()), "Enter a valid date.")
    .optional(),
  vaccineId: cuidSchema.optional(),
  batchNumber: optionalText(60),
  medication: optionalText(120),
  dosage: optionalText(60),
  resultValue: z.number().finite().optional(),
  resultUnit: optionalText(20),
  clinicId: cuidSchema.optional(),
  documentId: cuidSchema.optional(),
});

/** The fields an API route accepts when the pet comes from the URL. */
export const healthRecordFieldsWithoutPet = healthRecordFields.omit({ petId: true });

const withHealthRules = <T extends z.ZodType<{ type: string; resultValue?: number; medication?: string }>>(
  schema: T,
) =>
  schema
    .refine((v) => v.type !== "WEIGHT" || typeof v.resultValue === "number", {
      message: "A weight record needs a value.",
      path: ["resultValue"],
    })
    .refine((v) => v.type !== "MEDICATION" || Boolean(v.medication), {
      message: "A medication record needs the medication name.",
      path: ["medication"],
    });

export const healthRecordSchema = withHealthRules(healthRecordFields);

/** Same rules, but without `petId` — used by POST /api/pets/:id/health. */
export const healthRecordBodySchema = withHealthRules(healthRecordFieldsWithoutPet);

export type HealthRecordInput = z.infer<typeof healthRecordSchema>;

export async function addHealthRecord(auth: AuthContext, input: HealthRecordInput) {
  // Who is writing determines how much the record is worth.
  const { source, clinicId } = await resolveRecordSource(auth, input);

  const record = await db.$transaction(async (tx) => {
    const created = await tx.healthRecord.create({
      data: {
        petId: input.petId,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        occurredAt: input.occurredAt,
        nextDueAt: input.nextDueAt ?? null,
        vaccineId: input.vaccineId ?? null,
        batchNumber: input.batchNumber ?? null,
        medication: input.medication ?? null,
        dosage: input.dosage ?? null,
        resultValue: input.resultValue ?? null,
        resultUnit: input.resultUnit ?? null,
        clinicId,
        documentId: input.documentId ?? null,
        createdById: auth.user.id,
        source,
        verifiedAt: source === "CLINIC" ? new Date() : null,
        verifiedByClinicId: source === "CLINIC" ? clinicId : null,
      },
      select: { id: true, type: true, title: true, nextDueAt: true, petId: true },
    });

    // A vaccination with a booster interval schedules its own follow-up, which
    // is how the health record turns into a reason to come back.
    let dueAt = input.nextDueAt ?? null;
    if (!dueAt && input.type === "VACCINATION" && input.vaccineId) {
      const vaccine = await tx.vaccineCatalog.findUnique({
        where: { id: input.vaccineId },
        select: { boosterMonths: true },
      });
      if (vaccine?.boosterMonths) dueAt = addMonths(input.occurredAt, vaccine.boosterMonths);
    }

    if (dueAt && dueAt > new Date()) {
      await tx.healthRecord.update({ where: { id: created.id }, data: { nextDueAt: dueAt } });
      await tx.healthReminder.create({
        data: {
          petId: input.petId,
          healthRecordId: created.id,
          title: `${created.title} due`,
          dueAt,
        },
      });
    }

    // A weight entry keeps the pet's own weight current.
    if (input.type === "WEIGHT" && typeof input.resultValue === "number") {
      await tx.pet.update({
        where: { id: input.petId },
        data: { weightKg: input.resultValue },
      });
    }

    await audit(
      {
        action: "health.record_created",
        actorId: auth.user.id,
        entityType: "HEALTH_RECORD",
        entityId: created.id,
        summary: `${created.type}: ${created.title} (${source})`,
        metadata: { petId: input.petId },
      },
      tx,
    );

    return created;
  });

  await recomputeHealthScore(input.petId);

  if (source === "CLINIC") {
    const pet = await db.pet.findUnique({
      where: { id: input.petId },
      select: { ownerId: true, name: true },
    });
    if (pet && pet.ownerId !== auth.user.id) {
      await notify({
        userId: pet.ownerId,
        category: "HEALTH",
        type: "health.record_added",
        title: `New record added for ${pet.name}`,
        body: `${record.title} was recorded by your clinic.`,
        url: `/dashboard/pets/${input.petId}/health`,
        entityType: "PET",
        entityId: input.petId,
      });
      await awardTrustSignal(pet.ownerId, "PET_DOCUMENTED", { reference: record.id });
    }
  }

  return record;
}

/**
 * Decides whether a record is authoritative.
 *
 * Owner-written records are always OWNER, even when the owner claims a clinic
 * id. Only an account with membership of that clinic can write a CLINIC record,
 * and that is checked against the database, never against the request.
 */
async function resolveRecordSource(
  auth: AuthContext,
  input: HealthRecordInput,
): Promise<{ source: "OWNER" | "CLINIC"; clinicId: string | null }> {
  const pet = await db.pet.findFirst({
    where: { id: input.petId, deletedAt: null },
    select: { id: true, ownerId: true },
  });
  if (!pet) throw notFound("That pet");

  if (input.clinicId) {
    const membership = await db.clinic.findFirst({
      where: {
        id: input.clinicId,
        deletedAt: null,
        OR: [{ ownerUserId: auth.user.id }, { members: { some: { userId: auth.user.id } } }],
      },
      select: { id: true },
    });

    if (membership) {
      // Clinic staff may only write for an animal they have actually treated.
      const treated = await db.appointment.findFirst({
        where: { petId: input.petId, clinicId: input.clinicId },
        select: { id: true },
      });
      if (!treated && pet.ownerId !== auth.user.id) {
        throw forbidden("You can only add records for pets your clinic has treated.");
      }
      return { source: "CLINIC", clinicId: input.clinicId };
    }

    // Claimed a clinic they do not belong to: record it, but as OWNER.
    if (pet.ownerId !== auth.user.id) throw notFound("That pet");
    return { source: "OWNER", clinicId: null };
  }

  if (pet.ownerId !== auth.user.id && !isStaff(auth.user)) throw notFound("That pet");
  return { source: "OWNER", clinicId: null };
}

export async function updateHealthRecord(
  auth: AuthContext,
  recordId: string,
  input: Partial<Pick<HealthRecordInput, "title" | "description" | "occurredAt" | "nextDueAt">>,
) {
  const record = await db.healthRecord.findFirst({
    where: { id: recordId, deletedAt: null },
    select: { id: true, petId: true, createdById: true, source: true },
  });
  if (!record) throw notFound("That record");

  // A clinic-authored record is a medical document. The owner can see it but
  // cannot edit it, or the verification badge would mean nothing.
  if (record.source === "CLINIC" && record.createdById !== auth.user.id && !isStaff(auth.user)) {
    throw forbidden("Clinic records can only be corrected by the clinic that wrote them.");
  }
  if (record.source === "OWNER") {
    await assertOwnsPet(record.petId, auth);
  }

  const updated = await db.healthRecord.update({
    where: { id: recordId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
      ...(input.nextDueAt !== undefined ? { nextDueAt: input.nextDueAt ?? null } : {}),
    },
    select: { id: true, petId: true },
  });

  await audit({
    action: "health.record_updated",
    actorId: auth.user.id,
    entityType: "HEALTH_RECORD",
    entityId: recordId,
  });

  await recomputeHealthScore(updated.petId);
  return updated;
}

export async function deleteHealthRecord(auth: AuthContext, recordId: string) {
  const record = await db.healthRecord.findFirst({
    where: { id: recordId, deletedAt: null },
    select: { id: true, petId: true, source: true, createdById: true },
  });
  if (!record) throw notFound("That record");

  if (record.source === "CLINIC" && record.createdById !== auth.user.id && !isStaff(auth.user)) {
    throw forbidden("Clinic records can only be removed by the clinic that wrote them.");
  }
  if (record.source === "OWNER") await assertOwnsPet(record.petId, auth);

  await db.healthRecord.update({ where: { id: recordId }, data: { deletedAt: new Date() } });
  await recomputeHealthScore(record.petId);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getHealthTimeline(petId: string, auth: AuthContext) {
  await assertPetHealthAccess(petId, auth);

  const [records, reminders, pet] = await Promise.all([
    db.healthRecord.findMany({
      where: { petId, deletedAt: null },
      orderBy: { occurredAt: "desc" },
      select: {
        id: true,
        type: true,
        title: true,
        description: true,
        occurredAt: true,
        nextDueAt: true,
        source: true,
        verifiedAt: true,
        medication: true,
        dosage: true,
        batchNumber: true,
        resultValue: true,
        resultUnit: true,
        vaccine: { select: { name: true, code: true, coreVaccine: true } },
        clinic: { select: { id: true, name: true, slug: true } },
      },
    }),
    db.healthReminder.findMany({
      where: { petId, status: { in: ["PENDING", "SENT"] } },
      orderBy: { dueAt: "asc" },
      select: { id: true, title: true, dueAt: true, status: true },
    }),
    db.pet.findUniqueOrThrow({
      where: { id: petId },
      select: { id: true, name: true, species: true, birthDate: true, weightKg: true, healthScore: true },
    }),
  ]);

  return { pet, records, reminders, summary: summarise(records, pet.species as Species) };
}

interface HealthSummary {
  vaccinationsUpToDate: boolean;
  lastCheckup: Date | null;
  overdueCount: number;
  clinicVerifiedCount: number;
  ownerReportedCount: number;
  coreVaccinesMissing: string[];
}

function summarise(
  records: {
    type: string;
    occurredAt: Date;
    nextDueAt: Date | null;
    source: string;
    vaccine: { name: string; code: string; coreVaccine: boolean } | null;
  }[],
  _species: Species,
): HealthSummary {
  const now = new Date();
  const overdue = records.filter((r) => r.nextDueAt && r.nextDueAt < now);
  const checkups = records.filter((r) => r.type === "CHECKUP");

  return {
    vaccinationsUpToDate:
      records.some((r) => r.type === "VACCINATION") &&
      !records.some((r) => r.type === "VACCINATION" && r.nextDueAt && r.nextDueAt < now),
    lastCheckup: checkups[0]?.occurredAt ?? null,
    overdueCount: overdue.length,
    clinicVerifiedCount: records.filter((r) => r.source === "CLINIC").length,
    ownerReportedCount: records.filter((r) => r.source === "OWNER").length,
    coreVaccinesMissing: [],
  };
}

/**
 * Health score, 0-100.
 *
 * Deterministic and explainable. It is not a diagnosis and the UI never calls
 * it one — it measures how well documented an animal is, which is exactly what
 * a buyer needs and exactly what an owner can improve.
 */
export async function recomputeHealthScore(petId: string, client: DbClient = db): Promise<number> {
  const [pet, records] = await Promise.all([
    client.pet.findUnique({
      where: { id: petId },
      select: { birthDate: true, isNeutered: true, species: true },
    }),
    client.healthRecord.findMany({
      where: { petId, deletedAt: null },
      select: { type: true, occurredAt: true, nextDueAt: true, source: true },
    }),
  ]);
  if (!pet) return 0;

  const now = new Date();
  let score = 0;

  const vaccinations = records.filter((r) => r.type === "VACCINATION");
  const checkups = records.filter((r) => r.type === "CHECKUP");

  // Documented at all (30)
  if (records.length > 0) score += 10;
  if (records.length >= 3) score += 10;
  if (records.length >= 6) score += 10;

  // Vaccination status (30)
  if (vaccinations.length > 0) score += 15;
  const overdueVaccines = vaccinations.filter((v) => v.nextDueAt && v.nextDueAt < now);
  if (vaccinations.length > 0 && overdueVaccines.length === 0) score += 15;

  // Recent professional attention (20)
  const recentCheckup = checkups.find(
    (c) => now.getTime() - c.occurredAt.getTime() < 365 * 86_400_000,
  );
  if (recentCheckup) score += 20;
  else if (checkups.length > 0) score += 8;

  // Clinic-verified rather than self-reported (20)
  const clinicRecords = records.filter((r) => r.source === "CLINIC").length;
  if (clinicRecords > 0) score += 10;
  if (clinicRecords >= 3) score += 10;

  // Overdue items are a real signal of neglect, so they cost.
  const overdueAll = records.filter((r) => r.nextDueAt && r.nextDueAt < now).length;
  score -= Math.min(20, overdueAll * 5);

  // A puppy with no records yet is not neglected; do not punish a new animal.
  const months = ageInMonths(pet.birthDate, now);
  if (months !== null && months < 3 && records.length === 0) score = Math.max(score, 40);

  const final = clamp(Math.round(score), 0, 100);

  await client.pet.update({
    where: { id: petId },
    data: { healthScore: final, healthComputedAt: now },
  });

  return final;
}

export function healthScoreLabel(score: number): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (score >= 75) return { label: "Well documented", tone: "success" };
  if (score >= 45) return { label: "Partly documented", tone: "warning" };
  if (score > 0) return { label: "Little documentation", tone: "danger" };
  return { label: "No records yet", tone: "neutral" };
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export async function createReminder(
  auth: AuthContext,
  input: { petId: string; title: string; dueAt: Date },
) {
  await assertOwnsPet(input.petId, auth);
  if (input.dueAt <= new Date()) throw badRequest("Pick a date in the future.");

  return db.healthReminder.create({
    data: { petId: input.petId, title: input.title, dueAt: input.dueAt },
    select: { id: true, title: true, dueAt: true },
  });
}

export async function completeReminder(auth: AuthContext, reminderId: string) {
  const reminder = await db.healthReminder.findUnique({
    where: { id: reminderId },
    select: { id: true, petId: true },
  });
  if (!reminder) throw notFound("That reminder");
  await assertOwnsPet(reminder.petId, auth);

  return db.healthReminder.update({
    where: { id: reminderId },
    data: { status: "DONE", completedAt: new Date() },
    select: { id: true },
  });
}

export async function dismissReminder(auth: AuthContext, reminderId: string) {
  const reminder = await db.healthReminder.findUnique({
    where: { id: reminderId },
    select: { id: true, petId: true },
  });
  if (!reminder) throw notFound("That reminder");
  await assertOwnsPet(reminder.petId, auth);

  return db.healthReminder.update({
    where: { id: reminderId },
    data: { status: "DISMISSED" },
    select: { id: true },
  });
}

/** Sends due reminders. Run hourly by the `health.reminders` job. */
export async function sendDueHealthReminders(): Promise<number> {
  const due = await db.healthReminder.findMany({
    where: { status: "PENDING", dueAt: { lte: new Date(Date.now() + 3 * 86_400_000) } },
    take: 200,
    select: {
      id: true,
      title: true,
      dueAt: true,
      petId: true,
      pet: { select: { name: true, ownerId: true, species: true } },
    },
  });

  let sent = 0;

  for (const reminder of due) {
    const claimed = await db.healthReminder.updateMany({
      where: { id: reminder.id, status: "PENDING" },
      data: { status: "SENT", notifiedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    await notify({
      userId: reminder.pet.ownerId,
      category: "HEALTH",
      type: "health.reminder",
      title: `${reminder.pet.name}: ${reminder.title}`,
      body: `Due ${reminder.dueAt.toLocaleDateString("en-US", { dateStyle: "long" })}.`,
      url: `/dashboard/pets/${reminder.petId}/health`,
      entityType: "PET",
      entityId: reminder.petId,
      email: () =>
        emailTemplates.healthReminder({
          petName: reminder.pet.name,
          title: reminder.title,
          dueDate: reminder.dueAt.toLocaleDateString("en-US", { dateStyle: "long" }),
          url: `${clientEnv.NEXT_PUBLIC_APP_URL}/clinics?species=${reminder.pet.species}`,
        }),
    });
    sent++;
  }

  return sent;
}

export async function listVaccines(species: Species) {
  return db.vaccineCatalog.findMany({
    where: { species },
    orderBy: [{ coreVaccine: "desc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, description: true, coreVaccine: true, boosterMonths: true },
  });
}

/**
 * The public health summary shown on a listing. Deliberately coarse: a buyer
 * needs to know an animal is vaccinated and documented, not to read its
 * complete medical file before they have spoken to anyone.
 */
export async function getPublicHealthSummary(petId: string) {
  const records = await db.healthRecord.findMany({
    where: { petId, deletedAt: null },
    select: { type: true, occurredAt: true, nextDueAt: true, source: true },
  });

  const now = new Date();
  const vaccinations = records.filter((r) => r.type === "VACCINATION");

  return {
    recordCount: records.length,
    clinicVerifiedCount: records.filter((r) => r.source === "CLINIC").length,
    vaccinated: vaccinations.length > 0,
    vaccinationsCurrent:
      vaccinations.length > 0 && !vaccinations.some((v) => v.nextDueAt && v.nextDueAt < now),
    lastCheckupAt: records.filter((r) => r.type === "CHECKUP")[0]?.occurredAt ?? null,
    hasSurgery: records.some((r) => r.type === "SURGERY"),
  };
}
