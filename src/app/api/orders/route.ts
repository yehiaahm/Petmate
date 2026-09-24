import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import { notFound, conflict } from "@/lib/errors";
import {
  getPetOrder,
  listPurchases,
  listSales,
  confirmHandover,
  cancelPetOrder,
  openPurchaseConversation,
} from "@/lib/services/petorder.service";
import { cancelOrder } from "@/lib/services/commerce.service";
import { cuidSchema, safeParagraph, safeText } from "@/lib/validation/common";

/**
 * Pet orders and store orders.
 *
 * Every action here re-reads the order and checks the caller is one of its two
 * parties inside the service, so nothing is trusted from the request beyond the
 * id itself. A stranger's order id and a nonexistent one both come back 404.
 */

export const GET = route({
  auth: true,
  query: z.object({
    mode: z.enum(["purchases", "sales", "one"]).default("purchases"),
    id: cuidSchema.optional(),
  }),
  async handler({ query }) {
    const auth = await requireActive();

    if (query.mode === "one") {
      if (!query.id) throw notFound("That order");
      return { order: await getPetOrder(auth, query.id) };
    }

    if (query.mode === "sales") return { orders: await listSales(auth) };
    return { orders: await listPurchases(auth) };
  },
});

export const POST = route({
  auth: true,
  verifiedEmail: true,
  rateLimit: "checkout",
  body: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("confirm-handover"),
      petOrderId: cuidSchema,
      note: safeParagraph(500, 0).optional(),
    }),
    z.object({
      action: z.literal("cancel"),
      petOrderId: cuidSchema,
      reason: safeText(300, 5),
    }),
    z.object({ action: z.literal("open-conversation"), petOrderId: cuidSchema }),
    z.object({
      action: z.literal("cancel-order"),
      orderId: cuidSchema,
      reason: safeText(300, 5),
    }),
  ]),
  async handler({ body }) {
    const auth = await requireActive();

    switch (body.action) {
      case "confirm-handover": {
        const result = await confirmHandover(auth, body.petOrderId, body.note);
        return {
          ...result,
          message: result.bothConfirmed
            ? "Both sides confirmed. The payment has been released and the pet record has moved."
            : "Confirmed. The money moves when the other side confirms too.",
        };
      }

      case "cancel":
        await cancelPetOrder(auth, body.petOrderId, body.reason);
        return { ok: true };

      case "open-conversation": {
        const conversation = await openPurchaseConversation(auth, body.petOrderId);
        return { conversationId: conversation.id };
      }

      case "cancel-order": {
        const cancelled = await cancelOrder({
          orderId: body.orderId,
          reason: body.reason,
          actorId: auth.user.id,
          requireBuyerId: auth.user.id,
        });
        // False covers "not yours", "does not exist" and "too late to cancel".
        // They are deliberately indistinguishable from out here.
        if (!cancelled) {
          throw conflict("That order can no longer be cancelled.");
        }
        return { ok: true };
      }
    }
  },
});
