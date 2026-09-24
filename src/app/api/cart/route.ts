import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  createOrder,
  checkoutSchema,
} from "@/lib/services/commerce.service";
import { createPayment } from "@/lib/payments/service";
import { clientEnv } from "@/lib/env";
import { cuidSchema } from "@/lib/validation/common";

export const GET = route({
  auth: true,
  async handler({ auth }) {
    return getCart(auth!.user.id);
  },
});

export const POST = route({
  auth: true,
  body: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("add"),
      variantId: cuidSchema,
      quantity: z.number().int().min(1).max(99).default(1),
    }),
    z.object({
      action: z.literal("update"),
      itemId: cuidSchema,
      quantity: z.number().int().min(0).max(99),
    }),
    z.object({ action: z.literal("remove"), itemId: cuidSchema }),
    z.object({
      action: z.literal("checkout"),
      shipping: checkoutSchema,
      idempotencyKey: z.string().min(8).max(64),
    }),
  ]),
  async handler({ body }) {
    const auth = await requireActive();

    switch (body.action) {
      case "add":
        await addToCart(auth, { variantId: body.variantId, quantity: body.quantity });
        return getCart(auth.user.id);

      case "update":
        await updateCartItem(auth, body.itemId, body.quantity);
        return getCart(auth.user.id);

      case "remove":
        await removeCartItem(auth, body.itemId);
        return getCart(auth.user.id);

      case "checkout": {
        // The order is priced from the database, then charged for that amount.
        // The request body carries an address and nothing else that costs money.
        const order = await createOrder(auth, body.shipping);

        // Cash on delivery: the order is already with the shops and nothing is
        // charged now, so there is no payment step to send the buyer to.
        if (order.paymentMethod === "COD") {
          return { order, payment: null, redirectUrl: `/dashboard/orders/${order.id}` };
        }

        const payment = await createPayment({
          userId: auth.user.id,
          purpose: "PRODUCT_ORDER",
          referenceType: "ORDER",
          referenceId: order.id,
          amountCents: order.totalCents,
          currency: order.currency,
          description: `Order ${order.orderNumber}`,
          idempotencyKey: `order:${order.id}:${body.idempotencyKey}`,
          returnUrl: `${clientEnv.NEXT_PUBLIC_APP_URL}/dashboard/orders/${order.id}`,
          customerEmail: auth.user.email,
        });

        return { order, payment };
      }
    }
  },
});
