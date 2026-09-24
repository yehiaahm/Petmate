import { NextResponse } from "next/server";
import { paymentProvider } from "@/lib/payments/provider";
import { confirmPayment, failPayment } from "@/lib/payments/service";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db";

/**
 * Stripe webhook.
 *
 * Deliberately NOT wrapped in `route()`: it has no session, no CSRF token and no
 * cookie. Its authentication is the signature on the raw body, which is
 * verified before anything else happens. An unverified webhook is an attacker
 * telling us a payment succeeded, so failure here is a hard 400.
 *
 * Stripe retries on any non-2xx, so a transient failure is retried for us. That
 * means the handler must be idempotent, which it is: `confirmPayment` uses a
 * conditional status transition.
 */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  // The raw body is required byte-for-byte; parsing it first breaks the HMAC.
  const rawBody = await request.text();

  let event;
  try {
    event = await paymentProvider().parseWebhook(rawBody, signature);
  } catch (error) {
    logger.exception("rejected an unverified stripe webhook", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    // Replay protection: the same event id is only processed once.
    const seen = await db.idempotencyKey.findUnique({
      where: { scope_key: { scope: "stripe_webhook", key: event.id } },
      select: { id: true, status: true },
    });
    if (seen?.status === "COMPLETED") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    if (!seen) {
      await db.idempotencyKey
        .create({
          data: { scope: "stripe_webhook", key: event.id, requestHash: event.type },
        })
        .catch(() => undefined);
    }

    switch (event.status) {
      case "SUCCEEDED":
        if (event.intentRef) {
          await confirmPayment({ providerRef: event.intentRef });
        }
        break;

      case "FAILED":
        if (event.intentRef) {
          await failPayment({
            providerRef: event.intentRef,
            code: event.failureCode,
            message: event.failureMessage,
          });
        }
        break;

      default:
        logger.debug("ignoring stripe event", { type: event.type });
    }

    await db.idempotencyKey.updateMany({
      where: { scope: "stripe_webhook", key: event.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    logger.exception("stripe webhook processing failed", error, { eventId: event.id });
    await db.idempotencyKey
      .updateMany({
        where: { scope: "stripe_webhook", key: event.id },
        data: { status: "FAILED" },
      })
      .catch(() => undefined);

    // Non-2xx so Stripe retries rather than silently dropping a real payment.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
