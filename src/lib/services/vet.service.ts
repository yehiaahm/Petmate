import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { assertClinicAccess, assertOwnsPet } from "@/lib/auth/rbac";
import type { AuthContext } from "@/lib/auth/session";
import { addMinutes, boundingBox, haversineKm, readableCode, startOfDayUTC, uniqueSlug } from "@/lib/utils";
import { applyBps } from "@/lib/money";
import { resolveCommissionBps } from "@/lib/settings";
import { buildSearchText, searchTextClauses } from "@/lib/search/text";
import { notify } from "./notification.service";
import { postSystemMessage, getOrCreateConversation } from "./chat.service";
import {
  safeText,
  safeParagraph,
  optionalText,
  cuidSchema,
  centsSchema,
  emailSchema,
  phoneSchema,
  externalUrlSchema,
} from "@/lib/validation/common";
import { SERVICE_CATEGORY, LIMITS, type Species } from "@/lib/constants";

/**
 * Veterinary.
 *
 * The scarce resource is a slot in a specific vet's diary, so that is what the
 * schema protects: `@@unique([vetId, startAt])` means the database, not the
 * application, is what makes a double booking impossible. Two people clicking
 * the last 09:00 slot at the same instant produce one appointment and one clear
 * "that slot just went" — not two bookings and an angry phone call.
 */

// ---------------------------------------------------------------------------
// Clinic management
// ---------------------------------------------------------------------------

export const clinicSchema = z.object({
  name: safeText(120, 2),
  description: safeParagraph(3000, 0).optional(),
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
  licenseNumber: optionalText(60),
  emergencyServices: z.boolean().default(false),
  homeVisits: z.boolean().default(false),
  acceptsWalkIns: z.boolean().default(false),
  bookingLeadHours: z.number().int().min(0).max(168).default(2),
  cancellationHours: z.number().int().min(0).max(168).default(24),
});

export async function createClinic(auth: AuthContext, input: z.infer<typeof clinicSchema>) {
  const existing = await db.clinic.count({
    where: { ownerUserId: auth.user.id, deletedAt: null },
  });
  if (existing >= 5) throw conflict("You have reached the limit of clinics per account.");

  const clinic = await db.$transaction(async (tx) => {
    const created = await tx.clinic.create({
      data: {
        ownerUserId: auth.user.id,
        name: input.name,
        slug: uniqueSlug(input.name),
        description: input.description ?? null,
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
        licenseNumber: input.licenseNumber ?? null,
        emergencyServices: input.emergencyServices,
        homeVisits: input.homeVisits,
        acceptsWalkIns: input.acceptsWalkIns,
        bookingLeadHours: input.bookingLeadHours,
        cancellationHours: input.cancellationHours,
        // A clinic is not listed until a human has checked the licence. This is
        // the one place where "pending" is the right default.
        status: "PENDING",
        searchText: buildSearchText(input.name, input.description, input.city, input.region, input.country),
        members: { create: { userId: auth.user.id, role: "OWNER" } },
      },
      select: { id: true, slug: true, name: true },
    });

    await tx.userRole.upsert({
      where: { userId_role: { userId: auth.user.id, role: "CLINIC_ADMIN" } },
      create: { userId: auth.user.id, role: "CLINIC_ADMIN" },
      update: {},
    });

    // Sensible default hours so a new clinic is bookable the moment it is
    // approved, rather than presenting an empty calendar.
    await tx.clinicHours.createMany({
      data: [1, 2, 3, 4, 5].map((weekday) => ({
        clinicId: created.id,
        weekday,
        startMinute: 9 * 60,
        endMinute: 17 * 60,
        slotMinutes: 30,
      })),
    });

    await tx.verification.create({
      data: {
        subjectType: "CLINIC",
        subjectId: created.id,
        userId: auth.user.id,
        type: "CLINIC_LICENSE",
        status: "PENDING",
      },
    });

    await audit(
      {
        action: "verification.submitted",
        actorId: auth.user.id,
        entityType: "CLINIC",
        entityId: created.id,
        summary: `Clinic created: ${created.name}`,
      },
      tx,
    );

    return created;
  });

  return clinic;
}

export const serviceSchema = z.object({
  name: safeText(120, 2),
  description: safeParagraph(1000, 0).optional(),
  category: z.enum(SERVICE_CATEGORY),
  species: z.array(z.string()).max(8).optional(),
  durationMinutes: z.number().int().min(5).max(480),
  priceCents: centsSchema,
  vetId: cuidSchema.optional(),
  isActive: z.boolean().default(true),
});

export async function createService(
  auth: AuthContext,
  clinicId: string,
  input: z.infer<typeof serviceSchema>,
) {
  await assertClinicAccess(clinicId, auth, "ADMIN");

  if (input.vetId) {
    const vet = await db.vet.findFirst({
      where: { id: input.vetId, clinicId },
      select: { id: true },
    });
    if (!vet) throw badRequest("That vet does not work at this clinic.");
  }

  const count = await db.service.count({ where: { clinicId } });

  return db.service.create({
    data: {
      clinicId,
      vetId: input.vetId ?? null,
      name: input.name,
      description: input.description ?? null,
      category: input.category,
      species: input.species?.length ? input.species.join(",") : null,
      durationMinutes: input.durationMinutes,
      priceCents: input.priceCents,
      isActive: input.isActive,
      position: count,
    },
    select: { id: true, name: true, priceCents: true },
  });
}

export async function addVet(
  auth: AuthContext,
  clinicId: string,
  input: { userId: string; licenseNumber?: string; specialties?: string[]; bio?: string; yearsExperience?: number },
) {
  await assertClinicAccess(clinicId, auth, "ADMIN");

  const user = await db.user.findFirst({
    where: { id: input.userId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!user) throw badRequest("We could not find that member.");

  const existing = await db.vet.findUnique({ where: { userId: input.userId }, select: { id: true, clinicId: true } });
  if (existing && existing.clinicId && existing.clinicId !== clinicId) {
    throw conflict("That vet is already attached to another clinic.");
  }

  return db.$transaction(async (tx) => {
    const vet = await tx.vet.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        clinicId,
        licenseNumber: input.licenseNumber ?? null,
        specialties: input.specialties?.join(",") ?? null,
        bio: input.bio ?? null,
        yearsExperience: input.yearsExperience ?? null,
      },
      update: { clinicId },
      select: { id: true },
    });

    await tx.clinicMember.upsert({
      where: { clinicId_userId: { clinicId, userId: input.userId } },
      create: { clinicId, userId: input.userId, role: "VET" },
      update: { role: "VET" },
    });

    await tx.userRole.upsert({
      where: { userId_role: { userId: input.userId, role: "VET" } },
      create: { userId: input.userId, role: "VET" },
      update: {},
    });

    // A vet with no hours of their own inherits the clinic's.
    const clinicHours = await tx.clinicHours.findMany({
      where: { clinicId, vetId: null },
      select: { weekday: true, startMinute: true, endMinute: true, slotMinutes: true },
    });
    if (clinicHours.length) {
      await tx.clinicHours.createMany({
        data: clinicHours.map((h) => ({ ...h, clinicId, vetId: vet.id })),
      });
    }

    return vet;
  });
}

export const hoursSchema = z.object({
  vetId: cuidSchema.optional(),
  entries: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startMinute: z.number().int().min(0).max(1439),
        endMinute: z.number().int().min(1).max(1440),
        slotMinutes: z.number().int().min(5).max(240).default(30),
      }),
    )
    .max(21),
});

export async function setHours(
  auth: AuthContext,
  clinicId: string,
  input: z.infer<typeof hoursSchema>,
) {
  await assertClinicAccess(clinicId, auth, "ADMIN");

  for (const entry of input.entries) {
    if (entry.endMinute <= entry.startMinute) {
      throw badRequest("Closing time must be after opening time.");
    }
  }

  await db.$transaction(async (tx) => {
    await tx.clinicHours.deleteMany({ where: { clinicId, vetId: input.vetId ?? null } });
    if (input.entries.length) {
      await tx.clinicHours.createMany({
        data: input.entries.map((e) => ({ ...e, clinicId, vetId: input.vetId ?? null })),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export interface Slot {
  startAt: Date;
  endAt: Date;
  vetId: string;
  vetName: string;
}

/**
 * Computes bookable slots for a service on a given day.
 *
 * Generated from the vet's recurring hours, minus one-off exceptions, minus
 * appointments that already overlap. Slots are never stored: a stored slot
 * table drifts from reality the moment hours change, and has to be backfilled
 * forever into the future.
 */
export async function getAvailability(params: {
  clinicId: string;
  serviceId: string;
  from: Date;
  days?: number;
  vetId?: string;
}): Promise<Slot[]> {
  const days = Math.min(params.days ?? 14, 60);

  const [service, clinic] = await Promise.all([
    db.service.findFirst({
      where: { id: params.serviceId, clinicId: params.clinicId, isActive: true },
      select: { id: true, durationMinutes: true, vetId: true },
    }),
    db.clinic.findFirst({
      where: { id: params.clinicId, deletedAt: null, status: "ACTIVE" },
      select: { id: true, bookingLeadHours: true },
    }),
  ]);

  if (!service || !clinic) return [];

  const vets = await db.vet.findMany({
    where: {
      clinicId: params.clinicId,
      acceptingNew: true,
      ...(params.vetId ? { id: params.vetId } : {}),
      ...(service.vetId ? { id: service.vetId } : {}),
    },
    select: { id: true, user: { select: { name: true } } },
  });
  if (!vets.length) return [];

  const vetIds = vets.map((v) => v.id);
  const windowStart = startOfDayUTC(params.from);
  const windowEnd = new Date(windowStart.getTime() + days * 86_400_000);

  const [hours, exceptions, booked] = await Promise.all([
    db.clinicHours.findMany({
      where: { clinicId: params.clinicId, OR: [{ vetId: { in: vetIds } }, { vetId: null }] },
      select: { vetId: true, weekday: true, startMinute: true, endMinute: true, slotMinutes: true },
    }),
    db.availabilityException.findMany({
      where: {
        clinicId: params.clinicId,
        date: { gte: windowStart, lt: windowEnd },
      },
      select: { vetId: true, date: true, isClosed: true, startMinute: true, endMinute: true },
    }),
    db.appointment.findMany({
      where: {
        vetId: { in: vetIds },
        startAt: { gte: windowStart, lt: windowEnd },
        status: { in: ["PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN"] },
      },
      select: { vetId: true, startAt: true, endAt: true },
    }),
  ]);

  const earliest = new Date(Date.now() + clinic.bookingLeadHours * 3_600_000);
  const slots: Slot[] = [];

  for (const vet of vets) {
    // A vet's own hours override the clinic-wide default.
    const ownHours = hours.filter((h) => h.vetId === vet.id);
    const effectiveHours = ownHours.length ? ownHours : hours.filter((h) => h.vetId === null);
    const vetBooked = booked.filter((b) => b.vetId === vet.id);

    for (let day = 0; day < days; day++) {
      const date = new Date(windowStart.getTime() + day * 86_400_000);
      const weekday = date.getUTCDay();

      const exception = exceptions.find(
        (e) =>
          e.date.getTime() === date.getTime() && (e.vetId === vet.id || e.vetId === null),
      );
      if (exception?.isClosed) continue;

      for (const block of effectiveHours.filter((h) => h.weekday === weekday)) {
        const startMinute = exception?.startMinute ?? block.startMinute;
        const endMinute = exception?.endMinute ?? block.endMinute;

        for (
          let minute = startMinute;
          minute + service.durationMinutes <= endMinute;
          minute += block.slotMinutes
        ) {
          const startAt = new Date(date.getTime() + minute * 60_000);
          const endAt = addMinutes(startAt, service.durationMinutes);

          if (startAt < earliest) continue;

          const overlaps = vetBooked.some((b) => startAt < b.endAt && endAt > b.startAt);
          if (overlaps) continue;

          slots.push({ startAt, endAt, vetId: vet.id, vetName: vet.user.name });
        }
      }
    }
  }

  slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return slots.slice(0, 500);
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export const bookingSchema = z.object({
  clinicId: cuidSchema,
  serviceId: cuidSchema,
  petId: cuidSchema,
  vetId: cuidSchema,
  startAt: z
    .string()
    .datetime({ offset: true })
    .transform((s) => new Date(s)),
  reasonForVisit: safeParagraph(1000, 0).optional(),
});

/**
 * Creates a PENDING_PAYMENT appointment holding the slot.
 *
 * The price comes from the service row, never from the request. The slot is
 * claimed by the unique index; a losing race gets a clean conflict rather than
 * a second appointment.
 */
export async function bookAppointment(auth: AuthContext, input: z.infer<typeof bookingSchema>) {
  await assertOwnsPet(input.petId, auth);

  const [clinic, service, vet] = await Promise.all([
    db.clinic.findFirst({
      where: { id: input.clinicId, deletedAt: null, status: "ACTIVE" },
      select: { id: true, name: true, bookingLeadHours: true, commissionBps: true, ownerUserId: true },
    }),
    db.service.findFirst({
      where: { id: input.serviceId, clinicId: input.clinicId, isActive: true },
      select: { id: true, name: true, priceCents: true, currency: true, durationMinutes: true, species: true },
    }),
    db.vet.findFirst({
      where: { id: input.vetId, clinicId: input.clinicId, acceptingNew: true },
      select: { id: true, userId: true },
    }),
  ]);

  if (!clinic) throw notFound("That clinic");
  if (!service) throw notFound("That service");
  if (!vet) throw notFound("That vet");

  const pet = await db.pet.findUniqueOrThrow({
    where: { id: input.petId },
    select: { species: true, name: true },
  });

  if (service.species) {
    const allowed = service.species.split(",").map((s) => s.trim());
    if (allowed.length && !allowed.includes(pet.species)) {
      throw badRequest(`This service is not offered for ${pet.species.toLowerCase()}s.`);
    }
  }

  const earliest = new Date(Date.now() + clinic.bookingLeadHours * 3_600_000);
  if (input.startAt < earliest) {
    throw badRequest(`This clinic needs at least ${clinic.bookingLeadHours} hours notice.`);
  }

  // The requested time must be a slot the clinic actually offers, not just any
  // timestamp. Without this a crafted request books 03:00 on a Sunday.
  const available = await getAvailability({
    clinicId: input.clinicId,
    serviceId: input.serviceId,
    from: input.startAt,
    days: 1,
    vetId: input.vetId,
  });
  const matching = available.find((s) => s.startAt.getTime() === input.startAt.getTime());
  if (!matching) throw conflict("That time is no longer available. Pick another slot.");

  const commissionBps = await resolveCommissionBps("APPOINTMENT", clinic.commissionBps);
  const commissionCents = applyBps(service.priceCents, commissionBps);

  try {
    const appointment = await db.appointment.create({
      data: {
        reference: `APT-${readableCode(8)}`,
        clinicId: input.clinicId,
        vetId: input.vetId,
        serviceId: input.serviceId,
        petId: input.petId,
        userId: auth.user.id,
        startAt: input.startAt,
        endAt: addMinutes(input.startAt, service.durationMinutes),
        status: "PENDING_PAYMENT",
        priceCents: service.priceCents,
        currency: service.currency,
        commissionCents,
        reasonForVisit: input.reasonForVisit ?? null,
      },
      select: { id: true, reference: true, priceCents: true, currency: true, startAt: true },
    });

    await audit({
      action: "appointment.booked",
      actorId: auth.user.id,
      entityType: "APPOINTMENT",
      entityId: appointment.id,
      summary: `${service.name} at ${clinic.name}`,
    });

    return { ...appointment, clinicName: clinic.name, serviceName: service.name, petName: pet.name };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      throw conflict("Someone just booked that slot. Please choose another time.");
    }
    throw e;
  }
}

export async function cancelAppointment(
  auth: AuthContext,
  appointmentId: string,
  reason?: string,
) {
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      userId: true,
      clinicId: true,
      status: true,
      startAt: true,
      priceCents: true,
      currency: true,
      paymentIntentId: true,
      reference: true,
      clinic: { select: { cancellationHours: true, name: true, ownerUserId: true } },
      pet: { select: { name: true } },
    },
  });
  if (!appointment) throw notFound("That appointment");

  const isCustomer = appointment.userId === auth.user.id;
  let isClinicStaff = false;
  if (!isCustomer) {
    await assertClinicAccess(appointment.clinicId, auth, "STAFF");
    isClinicStaff = true;
  }

  if (!["PENDING_PAYMENT", "CONFIRMED"].includes(appointment.status)) {
    throw conflict("This appointment can no longer be cancelled.");
  }

  const hoursUntil = (appointment.startAt.getTime() - Date.now()) / 3_600_000;
  const withinPolicy = hoursUntil >= appointment.clinic.cancellationHours;

  await db.appointment.update({
    where: { id: appointmentId },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledById: auth.user.id,
      cancellationReason: reason?.slice(0, 300) ?? null,
    },
  });

  // Refund policy is explicit and applied by the server: inside the window, or
  // cancelled by the clinic, the customer gets their money back.
  let refunded = false;
  if (appointment.paymentIntentId && (withinPolicy || isClinicStaff)) {
    const { refundPayment } = await import("@/lib/payments/service");
    await refundPayment({
      intentId: appointment.paymentIntentId,
      amountCents: appointment.priceCents,
      reason: "CANCELLED_ORDER",
      approvedById: auth.user.id,
      note: `Appointment ${appointment.reference} cancelled`,
    });
    refunded = true;
  }

  await audit({
    action: "appointment.cancelled",
    actorId: auth.user.id,
    entityType: "APPOINTMENT",
    entityId: appointmentId,
    summary: `${reason ?? "No reason given"} (refunded: ${refunded})`,
  });

  const notifyUserId = isCustomer ? appointment.clinic.ownerUserId : appointment.userId;
  await notify({
    userId: notifyUserId,
    category: "APPOINTMENT",
    type: "appointment.cancelled",
    title: "Appointment cancelled",
    body: isCustomer
      ? `A booking for ${appointment.pet.name} was cancelled.`
      : `${appointment.clinic.name} cancelled your appointment${refunded ? " and a refund is on its way" : ""}.`,
    url: isCustomer ? "/clinic/appointments" : "/dashboard/appointments",
    entityType: "APPOINTMENT",
    entityId: appointmentId,
  });

  return { refunded, withinPolicy };
}

export async function completeAppointment(
  auth: AuthContext,
  appointmentId: string,
  input: { outcome?: string; clinicNotes?: string },
) {
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, clinicId: true, status: true, userId: true, petId: true },
  });
  if (!appointment) throw notFound("That appointment");

  await assertClinicAccess(appointment.clinicId, auth, "VET");

  if (!["CONFIRMED", "CHECKED_IN"].includes(appointment.status)) {
    throw conflict("Only a confirmed appointment can be completed.");
  }

  await db.appointment.update({
    where: { id: appointmentId },
    data: {
      status: "COMPLETED",
      outcome: input.outcome?.slice(0, 1000) ?? null,
      clinicNotes: input.clinicNotes?.slice(0, 2000) ?? null,
    },
  });

  const { enqueueJob } = await import("@/lib/jobs/queue");
  await enqueueJob({
    type: "clinic.releaseHold",
    payload: { appointmentId },
    uniqueKey: `clinic.releaseHold:${appointmentId}`,
  });

  const { awardTrustSignal } = await import("./trust.service");
  await awardTrustSignal(appointment.userId, "APPOINTMENT_COMPLETED", { reference: appointmentId });

  await audit({
    action: "appointment.completed",
    actorId: auth.user.id,
    entityType: "APPOINTMENT",
    entityId: appointmentId,
  });

  await notify({
    userId: appointment.userId,
    category: "APPOINTMENT",
    type: "appointment.completed",
    title: "Visit complete",
    body: "Any records your vet added are now in your pet's health timeline.",
    url: `/dashboard/pets/${appointment.petId}/health`,
    entityType: "APPOINTMENT",
    entityId: appointmentId,
  });
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface ClinicSearchParams {
  query?: string;
  city?: string;
  country?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  category?: string;
  species?: Species;
  emergency?: boolean;
  homeVisits?: boolean;
  maxPriceCents?: number;
  sort?: "relevance" | "rating" | "distance" | "price";
  page?: number;
  limit?: number;
}

export async function searchClinics(params: ClinicSearchParams) {
  const limit = Math.min(params.limit ?? 20, LIMITS.pageSizeMax);
  const page = Math.max(1, params.page ?? 1);

  const box =
    params.lat != null && params.lng != null
      ? boundingBox(params.lat, params.lng, params.radiusKm ?? 50)
      : null;

  const where = {
    deletedAt: null,
    status: "ACTIVE",
    ...(params.query ? { AND: searchTextClauses(params.query) } : {}),
    ...(params.city ? { city: params.city } : {}),
    ...(params.country ? { country: params.country } : {}),
    ...(params.emergency ? { emergencyServices: true } : {}),
    ...(params.homeVisits ? { homeVisits: true } : {}),
    ...(params.category || params.maxPriceCents
      ? {
          services: {
            some: {
              isActive: true,
              ...(params.category ? { category: params.category } : {}),
              ...(params.maxPriceCents ? { priceCents: { lte: params.maxPriceCents } } : {}),
            },
          },
        }
      : {}),
    ...(box
      ? { lat: { gte: box.minLat, lte: box.maxLat }, lng: { gte: box.minLng, lte: box.maxLng } }
      : {}),
  } as const;

  const [rows, total] = await Promise.all([
    db.clinic.findMany({
      where,
      orderBy:
        params.sort === "rating"
          ? [{ ratingAvgBps: "desc" }, { ratingCount: "desc" }]
          : params.sort === "price"
            ? [{ bookingCount: "desc" }]
            : [{ verifiedAt: "desc" }, { ratingAvgBps: "desc" }],
      skip: box ? 0 : (page - 1) * limit,
      take: box ? 300 : limit,
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        city: true,
        region: true,
        country: true,
        lat: true,
        lng: true,
        logoUrl: true,
        bannerUrl: true,
        ratingAvgBps: true,
        ratingCount: true,
        bookingCount: true,
        verifiedAt: true,
        emergencyServices: true,
        homeVisits: true,
        services: {
          where: { isActive: true },
          orderBy: { priceCents: "asc" },
          take: 3,
          select: { id: true, name: true, category: true, priceCents: true, currency: true, durationMinutes: true },
        },
        _count: { select: { vets: true } },
      },
    }),
    db.clinic.count({ where }),
  ]);

  // The bounding box is a coarse pre-filter; the exact radius is applied here.
  if (box && params.lat != null && params.lng != null) {
    const withDistance = rows
      .map((c) => ({
        ...c,
        distanceKm:
          c.lat != null && c.lng != null
            ? haversineKm(params.lat!, params.lng!, c.lat, c.lng)
            : null,
      }))
      .filter((c) => c.distanceKm != null && c.distanceKm <= (params.radiusKm ?? 50));

    if (params.sort === "distance" || !params.sort) {
      withDistance.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    }

    const start = (page - 1) * limit;
    return {
      items: withDistance.slice(start, start + limit),
      total: withDistance.length,
      page,
      limit,
    };
  }

  return { items: rows.map((c) => ({ ...c, distanceKm: null })), total, page, limit };
}

export async function getClinicBySlug(slug: string) {
  const clinic = await db.clinic.findFirst({
    where: { slug, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
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
      logoUrl: true,
      bannerUrl: true,
      status: true,
      verifiedAt: true,
      emergencyServices: true,
      homeVisits: true,
      acceptsWalkIns: true,
      cancellationHours: true,
      bookingLeadHours: true,
      ratingAvgBps: true,
      ratingCount: true,
      bookingCount: true,
      createdAt: true,
      services: {
        where: { isActive: true },
        orderBy: [{ position: "asc" }, { priceCents: "asc" }],
        select: {
          id: true,
          name: true,
          description: true,
          category: true,
          durationMinutes: true,
          priceCents: true,
          currency: true,
          species: true,
        },
      },
      vets: {
        select: {
          id: true,
          bio: true,
          specialties: true,
          yearsExperience: true,
          ratingAvgBps: true,
          ratingCount: true,
          acceptingNew: true,
          licenseVerifiedAt: true,
          user: { select: { id: true, name: true, avatarUrl: true } },
        },
      },
      hours: {
        where: { vetId: null },
        orderBy: { weekday: "asc" },
        select: { weekday: true, startMinute: true, endMinute: true },
      },
    },
  });

  if (!clinic || clinic.status !== "ACTIVE") throw notFound("That clinic");
  return clinic;
}

export async function listClinicAppointments(
  auth: AuthContext,
  clinicId: string,
  opts: { from?: Date; to?: Date; status?: string } = {},
) {
  await assertClinicAccess(clinicId, auth, "STAFF");

  return db.appointment.findMany({
    where: {
      clinicId,
      ...(opts.from ? { startAt: { gte: opts.from } } : {}),
      ...(opts.to ? { startAt: { lte: opts.to } } : {}),
      ...(opts.status ? { status: opts.status } : {}),
    },
    orderBy: { startAt: "asc" },
    take: 200,
    select: {
      id: true,
      reference: true,
      startAt: true,
      endAt: true,
      status: true,
      priceCents: true,
      currency: true,
      reasonForVisit: true,
      service: { select: { name: true, category: true } },
      vet: { select: { id: true, user: { select: { name: true } } } },
      pet: {
        select: {
          id: true,
          name: true,
          species: true,
          breed: { select: { name: true } },
          photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
        },
      },
      user: { select: { id: true, name: true, phone: true, avatarUrl: true } },
    },
  });
}

export async function listMyAppointments(auth: AuthContext, opts: { upcoming?: boolean } = {}) {
  return db.appointment.findMany({
    where: {
      userId: auth.user.id,
      ...(opts.upcoming
        ? { startAt: { gte: new Date() }, status: { in: ["PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN"] } }
        : {}),
    },
    orderBy: { startAt: opts.upcoming ? "asc" : "desc" },
    take: 60,
    select: {
      id: true,
      reference: true,
      startAt: true,
      endAt: true,
      status: true,
      priceCents: true,
      currency: true,
      paymentIntentId: true,
      service: { select: { name: true, category: true } },
      clinic: { select: { id: true, name: true, slug: true, addressLine: true, city: true, phone: true } },
      vet: { select: { user: { select: { name: true } } } },
      pet: {
        select: {
          id: true,
          name: true,
          photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
        },
      },
    },
  });
}

/** Opens a thread between an owner and a clinic about a booking. */
export async function messageClinic(auth: AuthContext, clinicId: string, body: string) {
  const clinic = await db.clinic.findFirst({
    where: { id: clinicId, deletedAt: null, status: "ACTIVE" },
    select: { id: true, name: true, ownerUserId: true },
  });
  if (!clinic) throw notFound("That clinic");

  const conversation = await getOrCreateConversation({
    type: "APPOINTMENT",
    participantIds: [auth.user.id, clinic.ownerUserId],
    contextType: "CLINIC",
    contextId: clinicId,
    subject: clinic.name,
    createdById: auth.user.id,
  });

  const { sendMessage } = await import("./chat.service");
  await sendMessage(auth, { conversationId: conversation.id, body });

  return conversation;
}

export { postSystemMessage };
