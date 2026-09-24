import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import {
  upsertBreedingProfile,
  breedingProfileSchema,
  pauseBreedingProfile,
  findMatches,
  explainMatch,
  sendBreedingRequest,
  breedingRequestSchema,
  respondToBreedingRequest,
  proposeTerms,
  breedingTermsSchema,
  agreeToTerms,
  recordBreedingOutcome,
  listBreedingRequests,
  getBreedingRequest,
} from "@/lib/services/breeding.service";
import {
  startBreedingFeePayment,
  confirmBreedingFeeRelease,
  reportBreedingFeeProblem,
} from "@/lib/services/breeding-fee.service";
import { cuidSchema, optionalText, safeParagraph } from "@/lib/validation/common";

export const GET = route({
  auth: true,
  query: z.object({
    mode: z.enum(["requests", "request", "matches", "explain"]).default("requests"),
    requestId: cuidSchema.optional(),
    direction: z.enum(["incoming", "outgoing", "all"]).default("all"),
    petId: cuidSchema.optional(),
    otherPetId: cuidSchema.optional(),
    maxDistanceKm: z.coerce.number().int().min(1).max(5000).optional(),
    minScore: z.coerce.number().int().min(0).max(100).optional(),
  }),
  async handler({ query }) {
    const auth = await requireActive();

    if (query.mode === "matches") {
      if (!query.petId) return { matches: [] };
      const matches = await findMatches(auth, query.petId, {
        maxDistanceKm: query.maxDistanceKm,
        minScore: query.minScore,
      });
      return { matches, engine: "rules-v1" };
    }

    if (query.mode === "explain") {
      if (!query.petId || !query.otherPetId) return { compatibility: null };
      const compatibility = await explainMatch(auth, query.petId, query.otherPetId);
      return { compatibility };
    }

    if (query.mode === "request") {
      if (!query.requestId) return { request: null };
      return { request: await getBreedingRequest(auth, query.requestId) };
    }

    const requests = await listBreedingRequests(auth, query.direction);
    return { requests };
  },
});

export const POST = route({
  auth: true,
  verifiedEmail: true,
  body: z.discriminatedUnion("action", [
    z.object({ action: z.literal("save-profile"), profile: breedingProfileSchema }),
    z.object({ action: z.literal("pause-profile"), petId: cuidSchema }),
    z.object({ action: z.literal("request"), request: breedingRequestSchema }),
    z.object({
      action: z.literal("respond"),
      requestId: cuidSchema,
      accept: z.boolean(),
      note: optionalText(500),
    }),
    z.object({
      action: z.literal("propose-terms"),
      requestId: cuidSchema,
      terms: breedingTermsSchema,
    }),
    z.object({ action: z.literal("agree"), requestId: cuidSchema }),
    z.object({
      action: z.literal("outcome"),
      requestId: cuidSchema,
      outcome: z.enum(["SUCCESSFUL", "UNSUCCESSFUL", "CANCELLED"]),
      expectedAt: z.string().datetime({ offset: true }).optional(),
      notes: safeParagraph(1000, 0).optional(),
    }),
    z.object({ action: z.literal("pay-fee"), requestId: cuidSchema }),
    z.object({ action: z.literal("release-fee"), requestId: cuidSchema }),
    z.object({
      action: z.literal("report-fee"),
      requestId: cuidSchema,
      details: safeParagraph(2000, 20),
    }),
  ]),
  async handler({ body }) {
    const auth = await requireActive();

    switch (body.action) {
      case "save-profile": {
        const profile = await upsertBreedingProfile(auth, body.profile);
        return { profile };
      }
      case "pause-profile":
        await pauseBreedingProfile(auth, body.petId);
        return { ok: true };
      case "request":
        return sendBreedingRequest(auth, body.request);
      case "respond":
        return respondToBreedingRequest(
          auth,
          body.requestId,
          body.accept ? "ACCEPT" : "DECLINE",
          body.note,
        );
      case "propose-terms":
        await proposeTerms(auth, body.requestId, body.terms);
        return { ok: true };
      case "agree":
        return agreeToTerms(auth, body.requestId);
      case "outcome":
        await recordBreedingOutcome(auth, body.requestId, {
          outcome: body.outcome,
          expectedAt: body.expectedAt ? new Date(body.expectedAt) : undefined,
          notes: body.notes,
        });
        return { ok: true };
      case "pay-fee":
        return { payment: await startBreedingFeePayment(auth, body.requestId) };
      case "release-fee":
        return confirmBreedingFeeRelease(auth, body.requestId);
      case "report-fee":
        return reportBreedingFeeProblem(auth, body.requestId, body.details);
    }
  },
});
