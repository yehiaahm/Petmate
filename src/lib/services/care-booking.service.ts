import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { assertCareProviderAccess, assertOwnsPet } from "@/lib/auth/rbac";
import type { AuthContext } from "@/lib/auth/session";
import { applyBps, formatMoney } from "@/lib/money";
import { resolveCommissionBps } from "@/lib/settings";
import {
  addMinutes,
  ageInMonths,
  haversineKm,
  localDayStart,
  readableCode,
  splitTags,
  zonedMinuteToInstant,
} from "@/lib/utils";
import {
  MAX_STAY_NIGHTS,
  buildQuote,
  formatCalendarDate,
  parseCalendarDate,
  refundForCancellation,
  roundDistanceKm,
  stayNights,
  transportLegCents,
  type CareQuote,
} from "@/lib/care/pricing";
import { MAX_HANDOVER_ATTEMPTS, handoverCode, verifyHandoverCode } from "@/lib/care/handover-code";
import { accounts, postTransaction } from "@/lib/payments/ledger-core";
import { enqueueJob } from "@/lib/jobs/queue";
import { notify } from "./notification.service";
import { assertOwnsFile } from "./upload.service";
import {
  CARE_ACTIVE_STATUSES,
  CARE_UPDATE_TYPE,
  SPECIES_PLURAL,
  type CancellationPolicy,
  type Species,
  type TransportDirection,
} from "@/lib/constants";
import { cuidSchema, phoneSchema, safeParagraph, safeText } from "@/lib/validation/common";

/**
 * Pet care bookings: hotel stays and training programmes, with optional
 * pickup and drop-off by the provider's own team.
 *
 * The scarce resources are a room on a night and a trainer at an hour, and the
 * schema guards both with unique indexes rather than application checks:
 *   * BoardingNight(unitId, night, slot) — a hotel with three suites has three
 *     rows to give out per night, and a fourth booking cannot be written.
 *   * TrainingSession(providerId, startAt, seat) — two bookings cannot take the
 *     same trainer for the same hour.
 *
 * Prices are computed here, from the provider's rows, at booking time and
 * frozen onto the booking. Nothing about an amount comes from the request.
 */

const DAY_MS = 86_400_000;
/** An unpaid booking holds its room or trainer for this long, then lets go. */
const UNPAID_HOLD_MINUTES = 30;

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-20.");

const bookingCommon = {
  providerId: cuidSchema,
  petId: cuidSchema,
  address: safeText(300, 5).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  contactPhone: phoneSchema.optional(),
  careInstructions: safeParagraph(2000, 0).optional(),
  emergencyContact: safeText(160, 0).optional(),
};

export const careBookingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("BOARDING"),
    ...bookingCommon,
    unitId: cuidSchema,
    checkIn: dateString,
    checkOut: dateString,
    pickup: z.boolean().default(false),
    dropoff: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("TRAINING"),
    ...bookingCommon,
    programId: cuidSchema,
    startAt: z
      .string()
      .datetime({ offset: true })
      .transform((s) => new Date(s)),
    /** Pickup before and drop-off after every session at the centre. */
    roundTrip: z.boolean().default(false),
  }),
]);

export type CareBookingInput = z.infer<typeof careBookingSchema>;

export const careUpdateSchema = z.object({
  bookingId: cuidSchema,
  type: z.enum(CARE_UPDATE_TYPE),
  body: safeParagraph(2000, 2),
  photoFileId: cuidSchema.optional(),
});

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/** Rooms left per room type for every night of a stay. */
export async function getBoardingAvailability(params: {
  providerId: string;
  checkIn: string;
  checkOut: string;
}) {
  const checkIn = parseCalendarDate(params.checkIn);
  const checkOut = parseCalendarDate(params.checkOut);
  if (!checkIn || !checkOut || checkOut <= checkIn) return { nights: 0, units: [] };

  const nights = stayNights(checkIn, checkOut);
  if (nights.length > MAX_STAY_NIGHTS) return { nights: nights.length, units: [] };

  const units = await db.boardingUnit.findMany({
    where: { providerId: params.providerId, isActive: true, provider: { status: "ACTIVE", deletedAt: null } },
    select: { id: true, capacity: true, nightlyCents: true },
  });
  if (!units.length) return { nights: nights.length, units: [] };

  const used = await db.boardingNight.groupBy({
    by: ["unitId", "night"],
    where: { unitId: { in: units.map((u) => u.id) }, night: { in: nights } },
    _count: { _all: true },
  });

  return {
    nights: nights.length,
    units: units.map((unit) => {
      const peak = Math.max(0, ...used.filter((u) => u.unitId === unit.id).map((u) => u._count._all));
      return {
        unitId: unit.id,
        available: Math.max(0, unit.capacity - peak),
        serviceCents: unit.nightlyCents * nights.length,
      };
    }),
  };
}

export interface TrainingSlot {
  startAt: Date;
  /** Every session of the programme, if this start is chosen. */
  sessions: { startAt: Date; endAt: Date }[];
}

/**
 * First-session times from which the *whole* programme fits: every session at
 * the same local time, `sessionIntervalDays` apart, inside opening hours, with
 * a trainer free. Offering a start whose fourth week is already full would
 * just move the disappointment three weeks later.
 */
export async function getTrainingSlots(params: {
  providerId: string;
  programId: string;
  from?: Date;
  days?: number;
}): Promise<TrainingSlot[]> {
  const days = Math.min(params.days ?? 21, 42);

  const [provider, program] = await Promise.all([
    db.careProvider.findFirst({
      where: { id: params.providerId, status: "ACTIVE", deletedAt: null, offersTraining: true },
      select: { id: true, timezone: true, trainerCount: true, bookingLeadHours: true },
    }),
    db.trainingProgram.findFirst({
      where: { id: params.programId, providerId: params.providerId, isActive: true },
      select: { sessionsCount: true, sessionMinutes: true, sessionIntervalDays: true },
    }),
  ]);
  if (!provider || !program) return [];

  const hours = await db.careProviderHours.findMany({
    where: { providerId: provider.id },
    select: { weekday: true, startMinute: true, endMinute: true, slotMinutes: true },
  });
  if (!hours.length) return [];

  const tz = provider.timezone;
  const windowStart = localDayStart(params.from ?? new Date(), tz);
  const spanDays = (program.sessionsCount - 1) * program.sessionIntervalDays;

  const existing = await db.trainingSession.findMany({
    where: {
      providerId: provider.id,
      startAt: {
        gte: new Date(windowStart.getTime() - DAY_MS),
        lt: new Date(windowStart.getTime() + (days + spanDays + 1) * DAY_MS),
      },
    },
    select: { startAt: true, endAt: true },
  });

  const earliest = new Date(Date.now() + provider.bookingLeadHours * 3_600_000);
  const fitsHours = (weekday: number, minute: number) =>
    hours.some(
      (h) => h.weekday === weekday && minute >= h.startMinute && minute + program.sessionMinutes <= h.endMinute,
    );

  const slots: TrainingSlot[] = [];

  for (let day = 0; day < days && slots.length < 300; day++) {
    const date = new Date(windowStart.getTime() + day * DAY_MS);

    for (const block of hours.filter((h) => h.weekday === date.getUTCDay())) {
      for (
        let minute = block.startMinute;
        minute + program.sessionMinutes <= block.endMinute;
        minute += block.slotMinutes
      ) {
        const first = zonedMinuteToInstant(date, minute, tz);
        if (first < earliest) continue;

        const sessions: TrainingSlot["sessions"] = [];
        for (let k = 0; k < program.sessionsCount; k++) {
          const sessionDay = new Date(date.getTime() + k * program.sessionIntervalDays * DAY_MS);
          if (!fitsHours(sessionDay.getUTCDay(), minute)) break;

          const startAt = zonedMinuteToInstant(sessionDay, minute, tz);
          const endAt = addMinutes(startAt, program.sessionMinutes);
          const busy = existing.filter((s) => startAt < s.endAt && endAt > s.startAt).length;
          if (busy >= provider.trainerCount) break;

          sessions.push({ startAt, endAt });
        }

        if (sessions.length === program.sessionsCount) slots.push({ startAt: first, sessions });
      }
    }
  }

  slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return slots;
}

// ---------------------------------------------------------------------------
// Planning — everything a booking needs, computed and checked, nothing written
// ---------------------------------------------------------------------------

interface PlannedLeg {
  direction: TransportDirection;
  scheduledAt: Date;
  label: string;
  amountCents: number;
}

interface BookingPlan {
  kind: "BOARDING" | "TRAINING";
  provider: {
    id: string;
    name: string;
    ownerUserId: string;
    isOfficial: boolean;
    currency: string;
    timezone: string;
    cancellationPolicy: CancellationPolicy;
  };
  pet: { id: string; name: string };
  unitId: string | null;
  programId: string | null;
  serviceLabel: string;
  startAt: Date;
  endAt: Date;
  nightDates: Date[];
  sessions: { startAt: Date; endAt: Date }[];
  legs: PlannedLeg[];
  distanceKm: number | null;
  quote: CareQuote;
  commissionCents: number;
}

async function planBooking(auth: AuthContext, input: CareBookingInput): Promise<BookingPlan> {
  await assertOwnsPet(input.petId, auth);

  const provider = await db.careProvider.findFirst({
    where: { id: input.providerId, deletedAt: null, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      ownerUserId: true,
      isOfficial: true,
      currency: true,
      timezone: true,
      lat: true,
      lng: true,
      offersBoarding: true,
      offersTraining: true,
      checkInMinute: true,
      checkOutMinute: true,
      offersTransport: true,
      transportRadiusKm: true,
      transportBaseCents: true,
      transportPerKmCents: true,
      requiresVaccination: true,
      cancellationPolicy: true,
      bookingLeadHours: true,
      commissionBps: true,
      members: { where: { userId: auth.user.id }, select: { role: true } },
    },
  });
  if (!provider) throw notFound("That provider");

  // A business booking itself would be a way to move money through the
  // platform with nothing behind it.
  if (provider.ownerUserId === auth.user.id || provider.members.length > 0) {
    throw badRequest("You cannot book your own business.");
  }

  const pet = await db.pet.findUniqueOrThrow({
    where: { id: input.petId },
    select: {
      id: true,
      name: true,
      species: true,
      weightKg: true,
      birthDate: true,
      status: true,
      healthRecords: {
        where: { type: "VACCINATION", deletedAt: null },
        select: { occurredAt: true, nextDueAt: true },
      },
    },
  });
  if (pet.status === "DECEASED" || pet.status === "REHOMED") throw badRequest("That pet can no longer be booked.");

  const species = pet.species as Species;
  const assertSpecies = (csv: string | null, what: string) => {
    const allowed = splitTags(csv);
    if (allowed.length && !allowed.includes(species)) {
      throw badRequest(`${what} is not offered for ${SPECIES_PLURAL[species]?.toLowerCase() ?? "this animal"}.`);
    }
  };

  const tz = provider.timezone;
  const earliest = new Date(Date.now() + provider.bookingLeadHours * 3_600_000);
  const policy = provider.cancellationPolicy as CancellationPolicy;

  let plan: Omit<BookingPlan, "legs" | "distanceKm" | "quote" | "commissionCents">;
  let serviceCents: number;
  let wantsTransport = false;
  let inHome = false;

  if (input.kind === "BOARDING") {
    if (!provider.offersBoarding) throw badRequest("This provider does not offer boarding.");

    const unit = await db.boardingUnit.findFirst({
      where: { id: input.unitId, providerId: provider.id, isActive: true },
      select: { id: true, name: true, species: true, maxWeightKg: true, nightlyCents: true },
    });
    if (!unit) throw notFound("That room type");
    assertSpecies(unit.species, unit.name);

    if (unit.maxWeightKg != null) {
      if (pet.weightKg == null) {
        throw badRequest(`${unit.name} has a weight limit. Add ${pet.name}'s weight to their profile first.`);
      }
      if (pet.weightKg > unit.maxWeightKg) {
        throw badRequest(`${unit.name} takes pets up to ${unit.maxWeightKg} kg.`);
      }
    }

    const checkIn = parseCalendarDate(input.checkIn);
    const checkOut = parseCalendarDate(input.checkOut);
    if (!checkIn || !checkOut) throw badRequest("Choose valid check-in and check-out dates.");
    if (checkOut <= checkIn) throw badRequest("Check-out must be after check-in.");

    const nightDates = stayNights(checkIn, checkOut);
    if (nightDates.length > MAX_STAY_NIGHTS) throw badRequest(`Stays are limited to ${MAX_STAY_NIGHTS} nights.`);

    const startAt = zonedMinuteToInstant(checkIn, provider.checkInMinute, tz);
    const endAt = zonedMinuteToInstant(checkOut, provider.checkOutMinute, tz);
    if (startAt < earliest) {
      throw badRequest(`${provider.name} needs at least ${provider.bookingLeadHours} hours notice.`);
    }

    plan = {
      kind: "BOARDING",
      provider: { ...provider, cancellationPolicy: policy },
      pet: { id: pet.id, name: pet.name },
      unitId: unit.id,
      programId: null,
      serviceLabel: `${unit.name} · ${nightDates.length} ${nightDates.length === 1 ? "night" : "nights"}`,
      startAt,
      endAt,
      nightDates,
      sessions: [],
    };
    wantsTransport = input.pickup || input.dropoff;
    serviceCents = unit.nightlyCents * nightDates.length;
  } else {
    if (!provider.offersTraining) throw badRequest("This provider does not offer training.");

    const program = await db.trainingProgram.findFirst({
      where: { id: input.programId, providerId: provider.id, isActive: true },
      select: {
        id: true,
        name: true,
        species: true,
        format: true,
        sessionsCount: true,
        minAgeMonths: true,
        priceCents: true,
      },
    });
    if (!program) throw notFound("That programme");
    assertSpecies(program.species, program.name);

    if (program.minAgeMonths != null && program.minAgeMonths > 0) {
      const age = ageInMonths(pet.birthDate);
      if (age == null) throw badRequest(`Add ${pet.name}'s date of birth to their profile first.`);
      if (age < program.minAgeMonths) {
        throw badRequest(`${program.name} is for dogs from ${program.minAgeMonths} months old.`);
      }
    }

    // The requested start must be one the diary actually offers for the whole
    // programme — not any timestamp a crafted request sends.
    const slots = await getTrainingSlots({
      providerId: provider.id,
      programId: program.id,
      from: input.startAt,
      days: 1,
    });
    const slot = slots.find((s) => s.startAt.getTime() === input.startAt.getTime());
    if (!slot) throw conflict("That start time is no longer available. Pick another.");

    inHome = program.format === "IN_HOME";
    plan = {
      kind: "TRAINING",
      provider: { ...provider, cancellationPolicy: policy },
      pet: { id: pet.id, name: pet.name },
      unitId: null,
      programId: program.id,
      serviceLabel: `${program.name} · ${program.sessionsCount} ${program.sessionsCount === 1 ? "session" : "sessions"}`,
      startAt: slot.sessions[0]!.startAt,
      endAt: slot.sessions[slot.sessions.length - 1]!.endAt,
      nightDates: [],
      sessions: slot.sessions,
    };
    wantsTransport = !inHome && input.roundTrip;
    serviceCents = program.priceCents;
  }

  // Vaccination must cover the whole stay. In-home training is exempt: the dog
  // never meets another animal in someone else's care.
  if (provider.requiresVaccination && !inHome) {
    const covered = pet.healthRecords.some((r) => !r.nextDueAt || r.nextDueAt >= plan.endAt);
    if (!covered) {
      throw badRequest(
        `${provider.name} needs an up-to-date vaccination on ${pet.name}'s health record for the whole booking. Add it from the pet's health page.`,
      );
    }
  }

  // One animal, one place at a time.
  const overlapping = await db.careBooking.findFirst({
    where: {
      petId: pet.id,
      status: { in: CARE_ACTIVE_STATUSES },
      startAt: { lt: plan.endAt },
      endAt: { gt: plan.startAt },
      ...(input.kind === "TRAINING" ? { kind: "BOARDING" } : {}),
    },
    select: { reference: true },
  });
  if (overlapping) throw conflict(`${pet.name} already has a booking at that time (${overlapping.reference}).`);

  // Where the team goes: the home for pickup, drop-off or in-home training.
  let distanceKm: number | null = null;
  if (wantsTransport || inHome) {
    if (wantsTransport && !provider.offersTransport) throw badRequest("This provider does not offer pickup and drop-off.");
    if (provider.lat == null || provider.lng == null) {
      throw badRequest("This provider has not set its location, so it cannot come to you.");
    }
    if (!input.address || input.lat == null || input.lng == null) {
      throw badRequest("Add your address and pin your location so the team can find you.");
    }
    distanceKm = roundDistanceKm(haversineKm(provider.lat, provider.lng, input.lat, input.lng));
    if (distanceKm > provider.transportRadiusKm) {
      throw badRequest(
        `You are ${distanceKm} km away. ${provider.name} covers up to ${provider.transportRadiusKm} km.`,
      );
    }
  }

  const legs: PlannedLeg[] = [];
  if (wantsTransport && distanceKm != null) {
    const legCents = transportLegCents({
      baseCents: provider.transportBaseCents,
      perKmCents: provider.transportPerKmCents,
      distanceKm,
    });
    if (input.kind === "BOARDING") {
      if (input.pickup) legs.push({ direction: "PICKUP", scheduledAt: plan.startAt, label: "Pickup from your home", amountCents: legCents });
      if (input.dropoff) legs.push({ direction: "DROPOFF", scheduledAt: plan.endAt, label: "Drop-off at your home", amountCents: legCents });
    } else {
      plan.sessions.forEach((s, i) => {
        legs.push({
          direction: "PICKUP",
          scheduledAt: addMinutes(s.startAt, -30),
          label: `Pickup before session ${i + 1}`,
          amountCents: legCents,
        });
        legs.push({ direction: "DROPOFF", scheduledAt: s.endAt, label: `Drop-off after session ${i + 1}`, amountCents: legCents });
      });
    }
  }
  const transportTotal = legs.reduce((sum, l) => sum + l.amountCents, 0);
  const quote = buildQuote({
    serviceLabel: plan.serviceLabel,
    serviceCents,
    legs:
      input.kind === "TRAINING" && legs.length
        ? [{ label: `Pickup and drop-off × ${plan.sessions.length} sessions`, amountCents: transportTotal }]
        : legs.map((l) => ({ label: l.label, amountCents: l.amountCents })),
  });

  // PetMate's own operation keeps the whole amount as platform revenue; an
  // independent business pays the platform rate or its negotiated one.
  const commissionCents = provider.isOfficial
    ? quote.totalCents
    : applyBps(quote.totalCents, await resolveCommissionBps("CARE", provider.commissionBps));

  return { ...plan, legs, distanceKm, quote, commissionCents };
}

/** What the booking would cost, with every check a real booking runs. */
export async function quoteCareBooking(auth: AuthContext, input: CareBookingInput) {
  const plan = await planBooking(auth, input);
  return {
    currency: plan.provider.currency,
    startAt: plan.startAt,
    endAt: plan.endAt,
    nights: plan.nightDates.length,
    sessions: plan.sessions,
    distanceKm: plan.distanceKm,
    cancellationPolicy: plan.provider.cancellationPolicy,
    ...plan.quote,
  };
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export async function bookCare(auth: AuthContext, input: CareBookingInput) {
  const plan = await planBooking(auth, input);

  try {
    const booking = await db.$transaction(async (tx) => {
      const created = await tx.careBooking.create({
        data: {
          reference: `CARE-${readableCode(8)}`,
          providerId: plan.provider.id,
          userId: auth.user.id,
          petId: plan.pet.id,
          kind: plan.kind,
          status: "PENDING_PAYMENT",
          unitId: plan.unitId,
          programId: plan.programId,
          startAt: plan.startAt,
          endAt: plan.endAt,
          nights: plan.nightDates.length,
          sessions: plan.sessions.length,
          serviceCents: plan.quote.serviceCents,
          transportCents: plan.quote.transportCents,
          totalCents: plan.quote.totalCents,
          commissionCents: plan.commissionCents,
          currency: plan.provider.currency,
          cancellationPolicy: plan.provider.cancellationPolicy,
          serviceAddress: plan.distanceKm != null ? (input.address ?? null) : null,
          serviceLat: plan.distanceKm != null ? (input.lat ?? null) : null,
          serviceLng: plan.distanceKm != null ? (input.lng ?? null) : null,
          serviceDistanceKm: plan.distanceKm,
          contactPhone: input.contactPhone ?? null,
          careInstructions: input.careInstructions || null,
          emergencyContact: input.emergencyContact || null,
        },
        select: { id: true, reference: true, totalCents: true, currency: true },
      });

      if (plan.kind === "BOARDING" && plan.unitId) {
        await claimRoomNights(tx, plan.unitId, created.id, plan.nightDates);
      }
      if (plan.kind === "TRAINING") {
        await claimTrainerSeats(tx, plan.provider.id, created.id, plan.sessions);
      }

      if (plan.legs.length) {
        await tx.careTransport.createMany({
          data: plan.legs.map((leg) => ({
            bookingId: created.id,
            direction: leg.direction,
            scheduledAt: leg.scheduledAt,
            address: input.address!,
            lat: input.lat!,
            lng: input.lng!,
          })),
        });
      }

      await tx.careEvent.create({
        data: {
          bookingId: created.id,
          type: "STATUS",
          title: "Booking created",
          body: "Waiting for payment. The room or trainer is held for 30 minutes.",
          actorId: auth.user.id,
        },
      });

      await enqueueJob(
        {
          type: "care.expireUnpaid",
          payload: { bookingId: created.id },
          runAt: new Date(Date.now() + UNPAID_HOLD_MINUTES * 60_000),
          uniqueKey: `care.expireUnpaid:${created.id}`,
        },
        tx,
      );

      await audit(
        {
          action: "care.booked",
          actorId: auth.user.id,
          entityType: "CARE_BOOKING",
          entityId: created.id,
          summary: `${plan.serviceLabel} at ${plan.provider.name}`,
        },
        tx,
      );

      return created;
    });

    return { ...booking, providerName: plan.provider.name, serviceLabel: plan.serviceLabel, petName: plan.pet.name };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      throw conflict("Someone booked that a moment ago. Please choose again.");
    }
    throw e;
  }
}

/** Takes the lowest free room of the type for every night, or fails the whole stay. */
async function claimRoomNights(tx: Tx, unitId: string, bookingId: string, nights: Date[]) {
  const unit = await tx.boardingUnit.findUniqueOrThrow({ where: { id: unitId }, select: { capacity: true } });
  const taken = await tx.boardingNight.findMany({
    where: { unitId, night: { in: nights } },
    select: { night: true, slot: true },
  });

  const rows = nights.map((night) => {
    const used = new Set(taken.filter((t) => t.night.getTime() === night.getTime()).map((t) => t.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    if (slot >= unit.capacity) {
      throw conflict(`That room type is fully booked on ${formatCalendarDate(night)}. Try other dates or another room.`);
    }
    return { unitId, bookingId, night, slot };
  });

  // The unique index is the real guard; the check above only picks a slot.
  await tx.boardingNight.createMany({ data: rows });
}

async function claimTrainerSeats(
  tx: Tx,
  providerId: string,
  bookingId: string,
  sessions: { startAt: Date; endAt: Date }[],
) {
  const provider = await tx.careProvider.findUniqueOrThrow({
    where: { id: providerId },
    select: { trainerCount: true },
  });

  const rows = [];
  for (const [index, session] of sessions.entries()) {
    const overlapping = await tx.trainingSession.findMany({
      where: { providerId, startAt: { lt: session.endAt }, endAt: { gt: session.startAt } },
      select: { seat: true },
    });
    const used = new Set(overlapping.map((o) => o.seat));
    let seat = 0;
    while (used.has(seat)) seat++;
    if (seat >= provider.trainerCount) throw conflict("A session in that programme has just been taken. Pick another start.");
    rows.push({ bookingId, providerId, sequence: index + 1, startAt: session.startAt, endAt: session.endAt, seat });
  }

  await tx.trainingSession.createMany({ data: rows });
}

/**
 * Gives back everything a booking holds that has not happened yet. Nights
 * from yesterday (UTC) on are released — a day of slack either side of any
 * provider time zone, and a past night cannot be resold anyway.
 */
async function releaseCapacity(tx: Tx, bookingId: string) {
  const now = new Date();
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY_MS);
  await tx.boardingNight.deleteMany({ where: { bookingId, night: { gte: cutoff } } });
  await tx.trainingSession.deleteMany({ where: { bookingId, status: "SCHEDULED" } });
  await tx.careTransport.updateMany({
    where: { bookingId, status: { in: ["SCHEDULED", "EN_ROUTE"] } },
    data: { status: "CANCELLED", otpIssuedAt: null },
  });
}

export async function expireUnpaidCareBooking(bookingId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const claimed = await tx.careBooking.updateMany({
      where: { id: bookingId, status: "PENDING_PAYMENT" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "Payment not completed in time" },
    });
    if (claimed.count === 0) return false;

    // Nights for an unpaid booking are deleted outright, past or not.
    await tx.boardingNight.deleteMany({ where: { bookingId } });
    await releaseCapacity(tx, bookingId);
    await tx.careEvent.create({
      data: { bookingId, type: "STATUS", title: "Booking released", body: "Payment was not completed in time." },
    });
    return true;
  });
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export function refundIfCancelledNow(booking: {
  status: string;
  paidAt: Date | null;
  totalCents: number;
  startAt: Date;
  cancellationPolicy: string;
}): number {
  if (booking.status !== "CONFIRMED" || !booking.paidAt) return 0;
  return refundForCancellation({
    policy: booking.cancellationPolicy as CancellationPolicy,
    hoursUntilStart: (booking.startAt.getTime() - Date.now()) / 3_600_000,
    paidCents: booking.totalCents,
    cancelledByProvider: false,
  });
}

export async function cancelCareBooking(auth: AuthContext, bookingId: string, reason?: string) {
  const booking = await db.careBooking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      reference: true,
      userId: true,
      providerId: true,
      status: true,
      startAt: true,
      paidAt: true,
      totalCents: true,
      commissionCents: true,
      currency: true,
      cancellationPolicy: true,
      paymentIntentId: true,
      provider: { select: { name: true, ownerUserId: true } },
      pet: { select: { name: true } },
    },
  });
  if (!booking) throw notFound("That booking");

  const isCustomer = booking.userId === auth.user.id;
  if (!isCustomer) await assertCareProviderAccess(booking.providerId, auth, "MANAGER");

  // A driver who has already set off is a cost the provider has incurred;
  // from here, changing plans is a conversation with the team.
  if (isCustomer) {
    const driving = await db.careTransport.count({ where: { bookingId: booking.id, status: "EN_ROUTE" } });
    if (driving) throw conflict("The driver is already on the way. Message the team to change plans.");
  }

  if (!["PENDING_PAYMENT", "CONFIRMED"].includes(booking.status)) {
    throw conflict(
      booking.status === "IN_CARE"
        ? `${booking.pet.name} is already in care. Contact the team to end the stay early.`
        : "This booking can no longer be cancelled.",
    );
  }

  const paid = booking.paidAt ? booking.totalCents : 0;
  const refundCents = refundForCancellation({
    policy: booking.cancellationPolicy as CancellationPolicy,
    hoursUntilStart: (booking.startAt.getTime() - Date.now()) / 3_600_000,
    paidCents: paid,
    cancelledByProvider: !isCustomer,
  });

  // The provider's share of the refund comes back out of their pending
  // balance in proportion to what they earned; the rest of their pending
  // balance is the cancellation fee they keep, and it is released now.
  const earnings = booking.totalCents - booking.commissionCents;
  const providerRefundShare = paid > 0 ? Math.round((refundCents * earnings) / booking.totalCents) : 0;

  await db.$transaction(async (tx) => {
    const claimed = await tx.careBooking.updateMany({
      where: { id: booking.id, status: { in: ["PENDING_PAYMENT", "CONFIRMED"] } },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: auth.user.id,
        cancellationReason: reason?.slice(0, 300) ?? null,
        ...(paid > 0 ? { earningsReleasedAt: new Date() } : {}),
      },
    });
    if (claimed.count === 0) throw conflict("This booking has just changed. Refresh and try again.");

    await tx.boardingNight.deleteMany({ where: { bookingId: booking.id } });
    await releaseCapacity(tx, booking.id);

    if (paid > 0 && earnings > 0) {
      const entries = [
        { account: accounts.providerPending(booking.providerId, booking.currency), amountCents: -earnings },
        {
          account: accounts.providerAvailable(booking.providerId, booking.currency),
          amountCents: earnings - providerRefundShare,
        },
        { account: accounts.platformRevenue(booking.currency), amountCents: providerRefundShare },
      ].filter((e) => e.amountCents !== 0);

      if (entries.length >= 2) {
        await postTransaction(
          {
            kind: "ADJUSTMENT",
            description: `Cancellation of ${booking.reference}`,
            currency: booking.currency,
            paymentIntentId: booking.paymentIntentId ?? undefined,
            referenceType: "CARE_BOOKING",
            referenceId: booking.id,
            createdById: auth.user.id,
            entries,
          },
          tx,
        );
      }
    }

    await tx.careEvent.create({
      data: {
        bookingId: booking.id,
        type: "STATUS",
        title: isCustomer ? "Cancelled by you" : `Cancelled by ${booking.provider.name}`,
        body:
          paid > 0
            ? refundCents > 0
              ? `${formatMoney(refundCents, booking.currency)} is being refunded.`
              : "Cancelled inside the no-refund window of the cancellation policy."
            : null,
        actorId: auth.user.id,
      },
    });

    await audit(
      {
        action: "care.cancelled",
        actorId: auth.user.id,
        entityType: "CARE_BOOKING",
        entityId: booking.id,
        summary: `${reason ?? "No reason given"} (refund ${refundCents})`,
      },
      tx,
    );
  });

  if (refundCents > 0 && booking.paymentIntentId) {
    try {
      const { refundPayment } = await import("@/lib/payments/service");
      await refundPayment({
        intentId: booking.paymentIntentId,
        amountCents: refundCents,
        reason: "CANCELLED_ORDER",
        approvedById: auth.user.id,
        note: `Booking ${booking.reference} cancelled`,
        idempotencyKey: `care-cancel:${booking.id}`,
      });
      await db.careBooking.update({ where: { id: booking.id }, data: { refundedCents: refundCents } });
    } catch (e) {
      // The booking is cancelled and the money sits in platform revenue; an
      // operator can issue the refund by hand from the admin console.
      logger.exception("care refund failed after cancellation", e, { bookingId: booking.id, refundCents });
    }
  }

  await notify({
    userId: isCustomer ? booking.provider.ownerUserId : booking.userId,
    category: "CARE",
    type: "care.cancelled",
    title: isCustomer ? `Booking ${booking.reference} cancelled` : `${booking.provider.name} cancelled your booking`,
    body: isCustomer
      ? `The booking for ${booking.pet.name} was cancelled by the owner.`
      : refundCents > 0
        ? `A full refund of ${formatMoney(refundCents, booking.currency)} is on its way.`
        : `The booking for ${booking.pet.name} was cancelled.`,
    url: isCustomer ? `/provider/${booking.providerId}` : `/dashboard/bookings/${booking.id}`,
    entityType: "CARE_BOOKING",
    entityId: booking.id,
  });

  return { refundCents };
}

// ---------------------------------------------------------------------------
// Running the booking — the provider's team
// ---------------------------------------------------------------------------

async function loadForTeam(auth: AuthContext, bookingId: string, minRole: "STAFF" | "MANAGER" = "STAFF") {
  const booking = await db.careBooking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      reference: true,
      kind: true,
      status: true,
      providerId: true,
      userId: true,
      startAt: true,
      endAt: true,
      pet: { select: { name: true } },
      provider: { select: { name: true } },
    },
  });
  if (!booking) throw notFound("That booking");
  await assertCareProviderAccess(booking.providerId, auth, minRole);
  return booking;
}

/** Owner dropped the pet off at the desk themselves. */
export async function checkInBooking(auth: AuthContext, bookingId: string) {
  const booking = await loadForTeam(auth, bookingId);
  if (booking.kind !== "BOARDING") throw badRequest("Training starts when the first session is recorded.");
  if (booking.status !== "CONFIRMED") throw conflict("Only a confirmed stay can be checked in.");
  if (Date.now() < booking.startAt.getTime() - 12 * 3_600_000) {
    throw conflict("Check-in opens on the day of arrival.");
  }

  const pendingPickup = await db.careTransport.findFirst({
    where: { bookingId, direction: "PICKUP", status: { in: ["SCHEDULED", "EN_ROUTE"] } },
    select: { id: true },
  });
  if (pendingPickup) throw conflict("This stay has a pickup. Complete it with the owner's handover code.");

  await db.$transaction(async (tx) => {
    const claimed = await tx.careBooking.updateMany({
      where: { id: bookingId, status: "CONFIRMED" },
      data: { status: "IN_CARE", checkedInAt: new Date() },
    });
    if (claimed.count === 0) throw conflict("This booking has just changed.");
    await tx.careEvent.create({
      data: { bookingId, type: "STATUS", title: "Checked in", body: `${booking.pet.name} has arrived.`, actorId: auth.user.id },
    });
    await audit({ action: "care.checked_in", actorId: auth.user.id, entityType: "CARE_BOOKING", entityId: bookingId }, tx);
  });

  await notify({
    userId: booking.userId,
    category: "CARE",
    type: "care.checked_in",
    title: `${booking.pet.name} is checked in`,
    body: `${booking.provider.name} will post updates here during the stay.`,
    url: `/dashboard/bookings/${bookingId}`,
    entityType: "CARE_BOOKING",
    entityId: bookingId,
  });
}

/** The driver sets off. The owner's handover code goes live. */
export async function startTransport(auth: AuthContext, transportId: string, driverName?: string) {
  const leg = await db.careTransport.findUnique({
    where: { id: transportId },
    select: { id: true, bookingId: true, direction: true, status: true, scheduledAt: true },
  });
  if (!leg) throw notFound("That trip");
  const booking = await loadForTeam(auth, leg.bookingId);

  if (leg.status !== "SCHEDULED") throw conflict("This trip has already started or finished.");
  const allowed = leg.direction === "PICKUP" ? ["CONFIRMED", "IN_CARE"] : ["IN_CARE"];
  if (!allowed.includes(booking.status)) {
    throw conflict(leg.direction === "PICKUP" ? "This booking is not confirmed." : "The pet is not in your care yet.");
  }
  if (Date.now() < leg.scheduledAt.getTime() - 6 * 3_600_000) {
    throw conflict("This trip is not due yet.");
  }

  const issuedAt = new Date();
  await db.$transaction(async (tx) => {
    const claimed = await tx.careTransport.updateMany({
      where: { id: leg.id, status: "SCHEDULED" },
      data: {
        status: "EN_ROUTE",
        startedAt: issuedAt,
        otpIssuedAt: issuedAt,
        otpAttempts: 0,
        driverName: driverName?.slice(0, 80) || auth.user.name,
      },
    });
    if (claimed.count === 0) throw conflict("This trip has just changed.");
    await tx.careEvent.create({
      data: {
        bookingId: leg.bookingId,
        type: "TRANSPORT",
        title: leg.direction === "PICKUP" ? "Driver on the way to collect" : "On the way home",
        body: driverName ? `Driver: ${driverName}` : null,
        actorId: auth.user.id,
      },
    });
  });

  // The code itself is never written into a notification: it lives on the
  // owner's booking page, derived on demand, so no stored row reveals it.
  await notify({
    userId: booking.userId,
    category: "CARE",
    type: "care.transport_started",
    title: leg.direction === "PICKUP" ? `Driver on the way for ${booking.pet.name}` : `${booking.pet.name} is on the way home`,
    body: "Open the booking to see your handover code. Only give it to the driver in person.",
    url: `/dashboard/bookings/${booking.id}`,
    entityType: "CARE_BOOKING",
    entityId: booking.id,
  });
}

/** The driver types the owner's code. Proof the animal reached the right hands. */
export async function completeTransport(auth: AuthContext, transportId: string, code: string) {
  const leg = await db.careTransport.findUnique({
    where: { id: transportId },
    select: { id: true, bookingId: true, direction: true, status: true, otpIssuedAt: true, otpAttempts: true },
  });
  if (!leg) throw notFound("That trip");
  const booking = await loadForTeam(auth, leg.bookingId);

  if (leg.status !== "EN_ROUTE" || !leg.otpIssuedAt) throw conflict("Start the trip before completing it.");
  if (leg.otpAttempts >= MAX_HANDOVER_ATTEMPTS) {
    throw forbidden("Too many incorrect codes. Contact PetMate support to complete this handover.");
  }

  if (!verifyHandoverCode(leg.id, leg.otpIssuedAt, code)) {
    await db.careTransport.update({ where: { id: leg.id }, data: { otpAttempts: { increment: 1 } } });
    throw badRequest("That code is not correct. Ask the owner to read it from their booking page.");
  }

  await db.$transaction(async (tx) => {
    const claimed = await tx.careTransport.updateMany({
      where: { id: leg.id, status: "EN_ROUTE" },
      data: { status: "COMPLETED", completedAt: new Date(), completedById: auth.user.id, otpIssuedAt: null },
    });
    if (claimed.count === 0) throw conflict("This trip has already been completed.");

    if (leg.direction === "PICKUP") {
      await tx.careBooking.updateMany({
        where: { id: leg.bookingId, status: "CONFIRMED" },
        data: { status: "IN_CARE", checkedInAt: new Date() },
      });
    }

    await tx.careEvent.create({
      data: {
        bookingId: leg.bookingId,
        type: "TRANSPORT",
        title: leg.direction === "PICKUP" ? `${booking.pet.name} collected` : `${booking.pet.name} delivered home`,
        body: "Handover confirmed with the owner's code.",
        actorId: auth.user.id,
      },
    });

    await audit(
      {
        action: "care.transport_completed",
        actorId: auth.user.id,
        entityType: "CARE_BOOKING",
        entityId: leg.bookingId,
        summary: leg.direction,
      },
      tx,
    );
  });

  await notify({
    userId: booking.userId,
    category: "CARE",
    type: "care.transport_completed",
    title: leg.direction === "PICKUP" ? `${booking.pet.name} has been collected` : `${booking.pet.name} is home`,
    url: `/dashboard/bookings/${booking.id}`,
    entityType: "CARE_BOOKING",
    entityId: booking.id,
  });

  if (leg.direction === "DROPOFF") await finishIfDone(leg.bookingId, auth.user.id);
}

/** A trainer records how a session went. */
export async function recordTrainingSession(
  auth: AuthContext,
  sessionId: string,
  input: { outcome: "COMPLETED" | "MISSED"; notes?: string },
) {
  const session = await db.trainingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, bookingId: true, sequence: true, status: true, startAt: true },
  });
  if (!session) throw notFound("That session");
  const booking = await loadForTeam(auth, session.bookingId);

  if (session.status !== "SCHEDULED") throw conflict("This session has already been recorded.");
  if (!["CONFIRMED", "IN_CARE"].includes(booking.status)) throw conflict("This booking is not active.");
  if (session.startAt.getTime() > Date.now() + 3_600_000) throw conflict("This session has not happened yet.");

  await db.$transaction(async (tx) => {
    const claimed = await tx.trainingSession.updateMany({
      where: { id: session.id, status: "SCHEDULED" },
      data: { status: input.outcome, trainerNotes: input.notes?.slice(0, 2000) ?? null, completedAt: new Date() },
    });
    if (claimed.count === 0) throw conflict("This session has just been recorded.");

    await tx.careBooking.updateMany({
      where: { id: booking.id, status: "CONFIRMED" },
      data: { status: "IN_CARE", checkedInAt: new Date() },
    });

    await tx.careEvent.create({
      data: {
        bookingId: booking.id,
        type: "TRAINING",
        title:
          input.outcome === "COMPLETED"
            ? `Session ${session.sequence} completed`
            : `Session ${session.sequence} missed`,
        body: input.notes?.slice(0, 2000) ?? null,
        actorId: auth.user.id,
      },
    });
  });

  await notify({
    userId: booking.userId,
    category: "CARE",
    type: "care.session_recorded",
    title: `Training session ${session.sequence} ${input.outcome === "COMPLETED" ? "done" : "marked as missed"}`,
    body: input.notes?.slice(0, 160),
    url: `/dashboard/bookings/${booking.id}`,
    entityType: "CARE_BOOKING",
    entityId: booking.id,
  });

  await finishIfDone(booking.id, auth.user.id);
}

/** Check-out at the desk, or closing a programme by hand. */
export async function completeCareBooking(auth: AuthContext, bookingId: string) {
  const booking = await loadForTeam(auth, bookingId);
  if (booking.status !== "IN_CARE") throw conflict("Only a booking that is in progress can be completed.");

  const [openDropoff, openSessions] = await Promise.all([
    db.careTransport.count({ where: { bookingId, direction: "DROPOFF", status: { in: ["SCHEDULED", "EN_ROUTE"] } } }),
    db.trainingSession.count({ where: { bookingId, status: "SCHEDULED" } }),
  ]);
  if (openDropoff) throw conflict("This booking has a drop-off. Complete it with the owner's handover code.");
  if (openSessions) throw conflict("Record every session before closing the programme.");

  await finishBooking(bookingId, auth.user.id);
}

async function finishIfDone(bookingId: string, actorId: string) {
  const booking = await db.careBooking.findUnique({
    where: { id: bookingId },
    select: { kind: true, status: true },
  });
  if (booking?.status !== "IN_CARE") return;

  const [openLegs, openSessions] = await Promise.all([
    db.careTransport.count({ where: { bookingId, status: { in: ["SCHEDULED", "EN_ROUTE"] } } }),
    db.trainingSession.count({ where: { bookingId, status: "SCHEDULED" } }),
  ]);
  if (openLegs || openSessions) return;

  // A stay without a drop-off ends at the desk, not on the last session.
  if (booking.kind === "BOARDING") {
    const hadDropoff = await db.careTransport.count({ where: { bookingId, direction: "DROPOFF", status: "COMPLETED" } });
    if (!hadDropoff) return;
  }

  await finishBooking(bookingId, actorId);
}

async function finishBooking(bookingId: string, actorId: string) {
  const booking = await db.$transaction(async (tx) => {
    const claimed = await tx.careBooking.updateMany({
      where: { id: bookingId, status: "IN_CARE" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    if (claimed.count === 0) return null;

    await tx.careEvent.create({
      data: { bookingId, type: "STATUS", title: "Completed", body: "Thank you for choosing us.", actorId },
    });

    await enqueueJob(
      { type: "care.releaseHold", payload: { bookingId }, uniqueKey: `care.releaseHold:${bookingId}` },
      tx,
    );

    await audit({ action: "care.completed", actorId, entityType: "CARE_BOOKING", entityId: bookingId }, tx);

    return tx.careBooking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { userId: true, reference: true, pet: { select: { name: true } }, provider: { select: { name: true } } },
    });
  });
  if (!booking) return;

  const { awardTrustSignal } = await import("./trust.service");
  await awardTrustSignal(booking.userId, "CARE_BOOKING_COMPLETED", { reference: bookingId });

  await notify({
    userId: booking.userId,
    category: "CARE",
    type: "care.completed",
    title: `${booking.pet.name}'s booking is complete`,
    body: `How was ${booking.provider.name}? Your review helps other owners choose.`,
    url: `/dashboard/bookings/${bookingId}`,
    entityType: "CARE_BOOKING",
    entityId: bookingId,
  });
}

/** The pet never arrived. The provider keeps the payment, as the policy says. */
export async function markCareNoShow(auth: AuthContext, bookingId: string) {
  const booking = await loadForTeam(auth, bookingId, "MANAGER");
  if (booking.status !== "CONFIRMED") throw conflict("Only a confirmed booking can be marked as a no-show.");
  if (Date.now() < booking.startAt.getTime() + 2 * 3_600_000) {
    throw conflict("Wait until at least two hours after the start time.");
  }

  await db.$transaction(async (tx) => {
    const claimed = await tx.careBooking.updateMany({
      where: { id: bookingId, status: "CONFIRMED" },
      data: { status: "NO_SHOW" },
    });
    if (claimed.count === 0) throw conflict("This booking has just changed.");
    await releaseCapacity(tx, bookingId);
    await tx.careEvent.create({
      data: { bookingId, type: "STATUS", title: "Marked as a no-show", actorId: auth.user.id },
    });
    await enqueueJob(
      { type: "care.releaseHold", payload: { bookingId }, uniqueKey: `care.releaseHold:${bookingId}` },
      tx,
    );
    await audit({ action: "care.no_show", actorId: auth.user.id, entityType: "CARE_BOOKING", entityId: bookingId }, tx);
  });

  await notify({
    userId: booking.userId,
    category: "CARE",
    type: "care.no_show",
    title: `Booking ${booking.reference} marked as a no-show`,
    body: "If this is wrong, reply from the booking page or contact support.",
    url: `/dashboard/bookings/${bookingId}`,
    entityType: "CARE_BOOKING",
    entityId: bookingId,
  });
}

/** The daily report: what the pet ate, where they walked, a photo. */
export async function postCareUpdate(auth: AuthContext, input: z.infer<typeof careUpdateSchema>) {
  const booking = await loadForTeam(auth, input.bookingId);
  if (!["CONFIRMED", "IN_CARE", "COMPLETED"].includes(booking.status)) {
    throw conflict("Updates can only be posted to an active booking.");
  }

  const photo = input.photoFileId ? await assertOwnsFile(input.photoFileId, auth.user.id) : null;
  if (photo && photo.purpose !== "CARE_PHOTO") throw badRequest("Upload the photo as a care update photo.");

  const event = await db.careEvent.create({
    data: {
      bookingId: booking.id,
      type: input.type,
      title: input.type === "UPDATE" ? "Update from the team" : input.type,
      body: input.body,
      photoUrl: photo?.url ?? null,
      actorId: auth.user.id,
    },
    select: { id: true },
  });

  await notify({
    userId: booking.userId,
    category: "CARE",
    type: "care.update",
    title: `New update on ${booking.pet.name}`,
    body: input.body.slice(0, 160),
    url: `/dashboard/bookings/${booking.id}`,
    imageUrl: photo?.url,
    entityType: "CARE_BOOKING",
    entityId: booking.id,
  });

  return event;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const bookingListSelect = {
  id: true,
  reference: true,
  kind: true,
  status: true,
  startAt: true,
  endAt: true,
  nights: true,
  sessions: true,
  totalCents: true,
  currency: true,
  provider: { select: { id: true, name: true, slug: true, city: true, timezone: true, isOfficial: true } },
  unit: { select: { name: true } },
  program: { select: { name: true } },
  pet: {
    select: { id: true, name: true, species: true, photos: { where: { isPrimary: true }, take: 1, select: { url: true } } },
  },
  _count: { select: { transports: true } },
} as const;

export async function listMyCareBookings(auth: AuthContext) {
  return db.careBooking.findMany({
    where: { userId: auth.user.id },
    orderBy: { startAt: "desc" },
    take: 100,
    select: bookingListSelect,
  });
}

export async function listProviderBookings(
  auth: AuthContext,
  providerId: string,
  opts: { scope?: "active" | "past" } = {},
) {
  await assertCareProviderAccess(providerId, auth, "STAFF");
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);

  return db.careBooking.findMany({
    where: {
      providerId,
      ...(opts.scope === "past"
        ? { status: { in: ["COMPLETED", "CANCELLED", "NO_SHOW"] } }
        : { OR: [{ status: { in: ["CONFIRMED", "IN_CARE"] } }, { status: "PENDING_PAYMENT", createdAt: { gte: weekAgo } }] }),
    },
    orderBy: { startAt: opts.scope === "past" ? "desc" : "asc" },
    take: 200,
    select: {
      ...bookingListSelect,
      user: { select: { id: true, name: true, phone: true } },
      contactPhone: true,
      transports: {
        where: { status: { in: ["SCHEDULED", "EN_ROUTE"] } },
        orderBy: { scheduledAt: "asc" },
        take: 1,
        select: { id: true, direction: true, status: true, scheduledAt: true },
      },
    },
  });
}

const bookingDetailSelect = {
  id: true,
  reference: true,
  kind: true,
  status: true,
  startAt: true,
  endAt: true,
  nights: true,
  sessions: true,
  serviceCents: true,
  transportCents: true,
  totalCents: true,
  commissionCents: true,
  refundedCents: true,
  currency: true,
  cancellationPolicy: true,
  paidAt: true,
  paymentIntentId: true,
  serviceAddress: true,
  serviceDistanceKm: true,
  contactPhone: true,
  careInstructions: true,
  emergencyContact: true,
  checkedInAt: true,
  completedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  createdAt: true,
  userId: true,
  providerId: true,
  provider: {
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
      email: true,
      addressLine: true,
      city: true,
      timezone: true,
      isOfficial: true,
      checkInMinute: true,
      checkOutMinute: true,
    },
  },
  unit: { select: { id: true, name: true } },
  program: { select: { id: true, name: true, format: true, sessionMinutes: true } },
  pet: {
    select: {
      id: true,
      name: true,
      species: true,
      weightKg: true,
      breed: { select: { name: true } },
      photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
    },
  },
  user: { select: { id: true, name: true, phone: true, avatarUrl: true } },
  trainingSessions: {
    orderBy: { sequence: "asc" },
    select: { id: true, sequence: true, startAt: true, endAt: true, status: true, trainerNotes: true },
  },
  transports: {
    orderBy: { scheduledAt: "asc" },
    select: {
      id: true,
      direction: true,
      status: true,
      scheduledAt: true,
      address: true,
      driverName: true,
      otpIssuedAt: true,
      otpAttempts: true,
      completedAt: true,
    },
  },
  events: {
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, type: true, title: true, body: true, photoUrl: true, createdAt: true },
  },
} as const;

/** The owner's view. Live legs carry the handover code the driver will ask for. */
export async function getCareBookingForCustomer(auth: AuthContext, bookingId: string) {
  const booking = await db.careBooking.findFirst({
    where: { id: bookingId, userId: auth.user.id },
    select: bookingDetailSelect,
  });
  if (!booking) throw notFound("That booking");

  // One review per provider per author, as for every other review target.
  const reviewed = await db.review.findFirst({
    where: { authorId: auth.user.id, targetType: "CARE_PROVIDER", targetId: booking.providerId },
    select: { id: true },
  });

  return {
    ...booking,
    commissionCents: undefined,
    transports: booking.transports.map(({ otpIssuedAt, ...leg }) => ({
      ...leg,
      handoverCode: leg.status === "EN_ROUTE" && otpIssuedAt ? handoverCode(leg.id, otpIssuedAt) : null,
    })),
    refundIfCancelledNow: refundIfCancelledNow(booking),
    canCancel:
      ["PENDING_PAYMENT", "CONFIRMED"].includes(booking.status) &&
      !booking.transports.some((t) => t.status === "EN_ROUTE"),
    canReview: booking.status === "COMPLETED" && !reviewed,
  };
}

/** The team's view. Never includes a handover code: that is the owner's to give. */
export async function getCareBookingForProvider(auth: AuthContext, bookingId: string) {
  const booking = await db.careBooking.findUnique({ where: { id: bookingId }, select: bookingDetailSelect });
  if (!booking) throw notFound("That booking");
  const access = await assertCareProviderAccess(booking.providerId, auth, "STAFF");

  return {
    ...booking,
    transports: booking.transports.map(({ otpIssuedAt: _issued, ...leg }) => leg),
    role: access.role,
  };
}
