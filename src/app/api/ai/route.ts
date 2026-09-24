import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import {
  reviewListingDraft,
} from "@/lib/ai/features";
import { aiAvailable } from "@/lib/ai/client";
import { cuidSchema, safeText, safeParagraph } from "@/lib/validation/common";
import { LIMITS } from "@/lib/constants";

export const GET = route({
  async handler() {
    // The UI reads this to decide whether to offer AI at all, rather than
    // showing a feature that silently falls back.
    return { available: aiAvailable() };
  },
});

export const POST = route({
  auth: true,
  rateLimit: "aiListingHelp",
  body: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("review-listing"),
      title: safeText(LIMITS.titleMax, 1),
      description: safeParagraph(LIMITS.descriptionMax, 1),
      petId: cuidSchema,
      intent: z.enum(["SALE", "ADOPTION", "BREEDING"]),
      priceCents: z.number().int().min(0).max(LIMITS.maxPriceCents).default(0),
    }),
  ]),
  async handler({ body }) {
    const auth = await requireActive();

    // The pet has to be the caller's: the coach reads its photos and records.
    const pet = await db.pet.findFirst({
      where: { id: body.petId, ownerId: auth.user.id, deletedAt: null },
      select: {
        species: true,
        breed: { select: { name: true } },
        breedText: true,
        _count: { select: { photos: true, healthRecords: true } },
      },
    });
    if (!pet) throw notFound("That pet");

    const result = await reviewListingDraft({
      title: body.title,
      description: body.description,
      species: pet.species,
      breedName: pet.breed?.name ?? pet.breedText ?? null,
      intent: body.intent,
      priceCents: body.priceCents,
      photoCount: pet._count.photos,
      hasHealthRecords: pet._count.healthRecords > 0,
    });

    return { feedback: result.data, source: result.source, note: result.note };
  },
});
