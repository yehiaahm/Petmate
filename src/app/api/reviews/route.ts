import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import {
  createReview,
  reviewSchema,
  listReviews,
  respondToReview,
  markHelpful,
  getPendingReviews,
} from "@/lib/services/review.service";
import { cuidSchema, safeParagraph } from "@/lib/validation/common";

export const GET = route({
  query: z.object({
    targetType: z.enum(["SELLER", "SHOP", "CLINIC", "VET", "PRODUCT", "BREEDER"]).optional(),
    targetId: cuidSchema.optional(),
    pending: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).max(200).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }),
  async handler({ query }) {
    if (query.pending) {
      const auth = await requireActive();
      const pending = await getPendingReviews(auth);
      return { pending };
    }

    if (!query.targetType || !query.targetId) return { items: [], total: 0 };

    return listReviews(query.targetType, query.targetId, {
      page: query.page,
      limit: query.limit,
    });
  },
});

export const POST = route({
  auth: true,
  rateLimit: "review",
  body: z.discriminatedUnion("action", [
    z.object({ action: z.literal("create"), review: reviewSchema }),
    z.object({
      action: z.literal("respond"),
      reviewId: cuidSchema,
      response: safeParagraph(1500, 5),
    }),
    z.object({ action: z.literal("helpful"), reviewId: cuidSchema }),
  ]),
  async handler({ body }) {
    const auth = await requireActive();

    switch (body.action) {
      case "create": {
        const review = await createReview(auth, body.review);
        return { review };
      }
      case "respond":
        await respondToReview(auth, body.reviewId, body.response);
        return { ok: true };
      case "helpful":
        return markHelpful(auth, body.reviewId);
    }
  },
});
