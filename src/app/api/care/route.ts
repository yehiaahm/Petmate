import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import {
  addProviderMember,
  createProvider,
  memberSchema,
  messageProvider,
  programSchema,
  providerHoursSchema,
  providerSchema,
  removeProviderMember,
  searchProviders,
  setProviderHours,
  unitSchema,
  updateProvider,
  upsertProgram,
  upsertUnit,
} from "@/lib/services/care-provider.service";
import { getBoardingAvailability, getTrainingSlots } from "@/lib/services/care-booking.service";
import { LIMITS, SPECIES } from "@/lib/constants";
import { booleanParam, cuidSchema, safeParagraph } from "@/lib/validation/common";

/**
 * Pet care providers: search, availability, and the provider's own setup.
 * Bookings live at /api/care/bookings.
 */

export const GET = route({
  rateLimit: "search",
  query: z.object({
    mode: z.enum(["search", "boarding-availability", "training-slots"]).default("search"),
    kind: z.enum(["BOARDING", "TRAINING"]).default("BOARDING"),
    q: z.string().max(200).optional(),
    city: z.string().max(80).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radius: z.coerce.number().min(1).max(500).optional(),
    species: z.enum(SPECIES).optional(),
    transport: booleanParam.optional(),
    inHome: booleanParam.optional(),
    sort: z.enum(["recommended", "rating", "price", "distance"]).optional(),
    page: z.coerce.number().int().min(1).max(200).default(1),
    limit: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(20),
    providerId: cuidSchema.optional(),
    programId: cuidSchema.optional(),
    checkIn: z.string().max(10).optional(),
    checkOut: z.string().max(10).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    days: z.coerce.number().int().min(1).max(42).default(21),
  }),
  // Search and availability are public: people compare before signing up.
  async handler({ query }) {
    if (query.mode === "boarding-availability") {
      if (!query.providerId || !query.checkIn || !query.checkOut) return { nights: 0, units: [] };
      return getBoardingAvailability({
        providerId: query.providerId,
        checkIn: query.checkIn,
        checkOut: query.checkOut,
      });
    }

    if (query.mode === "training-slots") {
      if (!query.providerId || !query.programId) return { slots: [] };
      const slots = await getTrainingSlots({
        providerId: query.providerId,
        programId: query.programId,
        from: query.from ? new Date(query.from) : undefined,
        days: query.days,
      });
      return { slots };
    }

    return searchProviders({
      kind: query.kind,
      query: query.q,
      city: query.city,
      lat: query.lat,
      lng: query.lng,
      radiusKm: query.radius,
      species: query.species,
      transport: query.transport,
      inHome: query.inHome,
      sort: query.sort,
      page: query.page,
      limit: query.limit,
    });
  },
});

export const POST = route({
  auth: true,
  verifiedEmail: true,
  body: z.discriminatedUnion("action", [
    z.object({ action: z.literal("create"), provider: providerSchema }),
    z.object({ action: z.literal("update"), providerId: cuidSchema, provider: providerSchema }),
    z.object({ action: z.literal("save-unit"), providerId: cuidSchema, unit: unitSchema }),
    z.object({ action: z.literal("save-program"), providerId: cuidSchema, program: programSchema }),
    z.object({ action: z.literal("set-hours"), providerId: cuidSchema, hours: providerHoursSchema }),
    z.object({ action: z.literal("add-member"), providerId: cuidSchema, member: memberSchema }),
    z.object({ action: z.literal("remove-member"), providerId: cuidSchema, userId: cuidSchema }),
    z.object({
      action: z.literal("message"),
      providerId: cuidSchema,
      body: safeParagraph(LIMITS.messageMax, 10),
    }),
  ]),
  async handler({ body }) {
    const auth = await requireActive();

    switch (body.action) {
      case "create":
        return { provider: await createProvider(auth, body.provider) };
      case "update":
        await updateProvider(auth, body.providerId, body.provider);
        return { ok: true };
      case "save-unit":
        return { unit: await upsertUnit(auth, body.providerId, body.unit) };
      case "save-program":
        return { program: await upsertProgram(auth, body.providerId, body.program) };
      case "set-hours":
        await setProviderHours(auth, body.providerId, body.hours);
        return { ok: true };
      case "add-member":
        return { member: await addProviderMember(auth, body.providerId, body.member) };
      case "remove-member":
        await removeProviderMember(auth, body.providerId, body.userId);
        return { ok: true };
      case "message": {
        const conversation = await messageProvider(auth, body.providerId, body.body);
        return { conversationId: conversation.id };
      }
    }
  },
});
