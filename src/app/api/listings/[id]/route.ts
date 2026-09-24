import { z } from "zod";
import { route, idParam } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import {
  closeListing,
  pauseListing,
  publishListing,
  toggleFavorite,
  updateListing,
  updateListingSchema,
} from "@/lib/services/listing.service";
import { createPetOrder } from "@/lib/services/petorder.service";
import { purchaseFeaturedPlacement } from "@/lib/services/subscription.service";
import { startListingConversation } from "@/lib/services/chat.service";
import { createPayment } from "@/lib/payments/service";
import { clientEnv } from "@/lib/env";
import { safeParagraph } from "@/lib/validation/common";
import { LIMITS } from "@/lib/constants";

export const PATCH = route({
  auth: true,
  params: idParam,
  body: updateListingSchema,
  async handler({ params, body }) {
    const auth = await requireActive();
    const listing = await updateListing(auth, params.id, body);
    return { listing };
  },
});

/**
 * Listing actions.
 *
 * One endpoint with an explicit action, so authorization and rate limiting are
 * applied identically to every state transition a listing can undergo.
 */
export const POST = route({
  auth: true,
  params: idParam,
  body: z.discriminatedUnion("action", [
    z.object({ action: z.literal("publish") }),
    z.object({ action: z.literal("pause") }),
    z.object({ action: z.literal("complete") }),
    z.object({ action: z.literal("remove") }),
    z.object({ action: z.literal("favorite") }),
    z.object({ action: z.literal("contact"), message: safeParagraph(LIMITS.messageMax, 10) }),
    z.object({ action: z.literal("buy"), idempotencyKey: z.string().min(8).max(64) }),
    z.object({
      action: z.literal("feature"),
      days: z.union([z.literal(7), z.literal(30)]),
      idempotencyKey: z.string().min(8).max(64),
    }),
  ]),
  async handler({ params, body }) {
    const auth = await requireActive();

    switch (body.action) {
      case "publish":
        return publishListing(auth, params.id);

      case "pause":
        await pauseListing(auth, params.id);
        return { ok: true };

      case "complete":
        await closeListing(auth, params.id, "COMPLETED");
        return { ok: true };

      case "remove":
        await closeListing(auth, params.id, "REMOVED");
        return { ok: true };

      case "favorite":
        return toggleFavorite(auth, params.id);

      case "contact": {
        const conversation = await startListingConversation(auth, params.id, body.message);
        return { conversationId: conversation.id };
      }

      case "buy": {
        const order = await createPetOrder(auth, params.id);
        // The amount is the order's, computed from the listing row on the
        // server. Nothing about it came from the request.
        const payment = await createPayment({
          userId: auth.user.id,
          purpose: "PET_PURCHASE",
          referenceType: "PET_ORDER",
          referenceId: order.id,
          amountCents: order.amountCents,
          currency: order.currency,
          description: `Purchase ${order.orderNumber}`,
          idempotencyKey: `petorder:${order.id}:${body.idempotencyKey}`,
          returnUrl: `${clientEnv.NEXT_PUBLIC_APP_URL}/dashboard/purchases/${order.id}`,
          customerEmail: auth.user.email,
        });
        return { order, payment };
      }

      case "feature": {
        const result = await purchaseFeaturedPlacement(auth, {
          listingId: params.id,
          durationDays: body.days,
          idempotencyKey: `featured:${params.id}:${body.idempotencyKey}`,
        });
        return result;
      }
    }
  },
});
