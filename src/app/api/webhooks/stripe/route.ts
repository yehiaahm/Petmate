import type { NextResponse } from "next/server";
import { paymentProvider } from "@/lib/payments/provider";
import { handleProviderWebhook } from "@/lib/payments/webhooks";

/**
 * Stripe webhook.
 *
 * Deliberately NOT wrapped in `route()`: it has no session, no CSRF token and no
 * cookie. Its authentication is the signature on the raw body, which is
 * verified before anything else happens. An unverified webhook is an attacker
 * telling us a payment succeeded, so failure here is a hard 400.
 */
export async function POST(request: Request): Promise<NextResponse> {
  // The raw body is required byte-for-byte; parsing it first breaks the HMAC.
  const rawBody = await request.text();
  return handleProviderWebhook(paymentProvider(), rawBody, request.headers.get("stripe-signature"));
}
