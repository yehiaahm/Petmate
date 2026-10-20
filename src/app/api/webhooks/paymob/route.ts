import { NextResponse } from "next/server";
import { paymobProvider } from "@/lib/payments/provider";
import { handleProviderWebhook } from "@/lib/payments/webhooks";
import { env } from "@/lib/env";

/**
 * Paymob Transaction Processed callback.
 *
 * Like the Stripe webhook this is outside `route()`: no session, no CSRF
 * token. It is authenticated by the `hmac` query parameter, an HMAC-SHA512 of
 * the transaction's fields keyed with the merchant's HMAC secret, which
 * `paymobProvider.parseWebhook` checks before any field is believed.
 */
export async function POST(request: Request): Promise<NextResponse> {
  // A deployment on another gateway has no business accepting Paymob events.
  if (env().PAYMENT_PROVIDER !== "paymob") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const hmac = new URL(request.url).searchParams.get("hmac");
  const rawBody = await request.text();
  return handleProviderWebhook(paymobProvider, rawBody, hmac);
}
