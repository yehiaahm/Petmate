import "server-only";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { PaymentProvider, WebhookEvent } from "./provider";
import { confirmPayment, failPayment } from "./service";

/**
 * Provider callbacks, for every gateway.
 *
 * The provider's `parseWebhook` authenticates the payload before anything is
 * read from it. After that the same rules apply to each gateway: an event is
 * processed once (by its id), the amount and currency it reports must match
 * what we asked to charge, and the status change goes through the same
 * conditional transitions the rest of the payment code uses.
 *
 * Gateways retry on anything but 2xx, so a failure while processing returns
 * 500 (and is retried) while an event we have deliberately declined to act on
 * returns 200 (and is not).
 */
export async function handleProviderWebhook(
  provider: PaymentProvider,
  rawBody: string,
  signature: string | null,
): Promise<NextResponse> {
  const scope = `${provider.name}_webhook`;

  let event: WebhookEvent;
  try {
    event = await provider.parseWebhook(rawBody, signature);
  } catch (error) {
    logger.exception(`rejected an unverified ${provider.name} webhook`, error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    // Replay protection: the same event id is only processed once.
    const seen = await db.idempotencyKey.findUnique({
      where: { scope_key: { scope, key: event.id } },
      select: { id: true, status: true },
    });
    if (seen?.status === "COMPLETED") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    if (!seen) {
      await db.idempotencyKey
        .create({ data: { scope, key: event.id, requestHash: event.type } })
        .catch(() => undefined);
    }

    if (event.intentRef && event.status) {
      const intent = await db.paymentIntent.findUnique({
        where: { providerRef: event.intentRef },
        select: { id: true, amountCents: true, currency: true, provider: true },
      });

      if (!intent || intent.provider !== provider.name) {
        logger.warn(`${provider.name} webhook for an unknown intent`, { intentRef: event.intentRef, eventId: event.id });
      } else if (
        event.status === "SUCCEEDED" &&
        ((event.amountCents != null && event.amountCents !== intent.amountCents) ||
          (event.currency != null && event.currency.toUpperCase() !== intent.currency))
      ) {
        // A signed callback for a different amount than we charged is not a
        // payment for this intent. It is flagged for a person, never settled.
        logger.error(`${provider.name} webhook amount mismatch`, {
          intentId: intent.id,
          expected: `${intent.amountCents} ${intent.currency}`,
          received: `${event.amountCents} ${event.currency}`,
        });
        await db.paymentIntent.update({
          where: { id: intent.id },
          data: { failureCode: "AMOUNT_MISMATCH", failureMessage: "Provider reported a different amount" },
        });
      } else {
        switch (event.status) {
          case "SUCCEEDED":
            await confirmPayment({ providerRef: event.intentRef, chargeRef: event.chargeRef });
            break;
          case "FAILED":
            await failPayment({ providerRef: event.intentRef, code: event.failureCode, message: event.failureMessage });
            break;
          case "PROCESSING":
            // Kiosk and some wallet payments are pending until the customer
            // completes them offline.
            await db.paymentIntent.updateMany({
              where: { id: intent.id, status: "REQUIRES_PAYMENT" },
              data: { status: "PROCESSING" },
            });
            break;
        }
      }
    } else {
      logger.debug(`ignoring ${provider.name} event`, { type: event.type });
    }

    await db.idempotencyKey.updateMany({
      where: { scope, key: event.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    logger.exception(`${provider.name} webhook processing failed`, error, { eventId: event.id });
    await db.idempotencyKey
      .updateMany({ where: { scope, key: event.id }, data: { status: "FAILED" } })
      .catch(() => undefined);

    // Non-2xx so the gateway retries rather than silently dropping a payment.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
