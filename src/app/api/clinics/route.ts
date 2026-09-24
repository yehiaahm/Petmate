import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import {
  searchClinics,
  createClinic,
  clinicSchema,
  createService,
  serviceSchema,
  setHours,
  hoursSchema,
  addVet,
  messageClinic,
} from "@/lib/services/vet.service";
import { SERVICE_CATEGORY, SPECIES, LIMITS } from "@/lib/constants";
import { booleanParam, cuidSchema, safeParagraph, optionalText } from "@/lib/validation/common";

export const GET = route({
  rateLimit: "search",
  query: z.object({
    q: z.string().max(200).optional(),
    city: z.string().max(80).optional(),
    country: z.string().max(60).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radius: z.coerce.number().min(1).max(500).optional(),
    category: z.enum(SERVICE_CATEGORY).optional(),
    species: z.enum(SPECIES).optional(),
    emergency: booleanParam.optional(),
    homeVisits: booleanParam.optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    sort: z.enum(["relevance", "rating", "distance", "price"]).optional(),
    page: z.coerce.number().int().min(1).max(200).default(1),
    limit: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(20),
  }),
  async handler({ query }) {
    return searchClinics({
      query: query.q,
      city: query.city,
      country: query.country,
      lat: query.lat,
      lng: query.lng,
      radiusKm: query.radius,
      category: query.category,
      species: query.species,
      emergency: query.emergency,
      homeVisits: query.homeVisits,
      maxPriceCents: query.maxPrice != null ? query.maxPrice * 100 : undefined,
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
    z.object({ action: z.literal("create"), clinic: clinicSchema }),
    z.object({ action: z.literal("add-service"), clinicId: cuidSchema, service: serviceSchema }),
    z.object({ action: z.literal("set-hours"), clinicId: cuidSchema, hours: hoursSchema }),
    z.object({
      action: z.literal("add-vet"),
      clinicId: cuidSchema,
      userId: cuidSchema,
      licenseNumber: optionalText(60),
      specialties: z.array(z.string().max(60)).max(8).optional(),
      bio: safeParagraph(1000, 0).optional(),
      yearsExperience: z.number().int().min(0).max(70).optional(),
    }),
    z.object({
      action: z.literal("message"),
      clinicId: cuidSchema,
      body: safeParagraph(LIMITS.messageMax, 10),
    }),
  ]),
  async handler({ body }) {
    const auth = await requireActive();

    switch (body.action) {
      case "create": {
        const clinic = await createClinic(auth, body.clinic);
        return { clinic };
      }
      case "add-service": {
        const service = await createService(auth, body.clinicId, body.service);
        return { service };
      }
      case "set-hours":
        await setHours(auth, body.clinicId, body.hours);
        return { ok: true };
      case "add-vet": {
        const vet = await addVet(auth, body.clinicId, {
          userId: body.userId,
          licenseNumber: body.licenseNumber,
          specialties: body.specialties,
          bio: body.bio,
          yearsExperience: body.yearsExperience,
        });
        return { vet };
      }
      case "message": {
        const conversation = await messageClinic(auth, body.clinicId, body.body);
        return { conversationId: conversation.id };
      }
    }
  },
});
