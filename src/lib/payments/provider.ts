import "server-only";
import Stripe from "stripe";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { dependencyFailed } from "@/lib/errors";
import { generateToken } from "@/lib/utils";

/**
 * Payment provider abstraction.
 *
 * Three implementations, and none of them fakes a payment:
 *
 *   * `paymob`  — Paymob's hosted Unified Checkout for Egypt: cards, mobile
 *     wallets, kiosk and instalments, whichever integrations are configured.
 *     Signed callbacks confirm the payment; the redirect back is only UX.
 *   * `stripe`  — real Stripe PaymentIntents, real webhooks, real signatures.
 *   * `ledger`  — the internal provider used when no gateway is configured. It
 *     does not pretend a card was charged. It creates an authorisation that a
 *     human must explicitly confirm on a clearly-labelled sandbox screen, and
 *     it records the movement in the double-entry ledger. It is how the product
 *     runs end to end in development without inventing a successful charge.
 *
 * `assertProductionSafety()` refuses to boot production on `ledger` with a
 * public APP_URL, so the sandbox cannot be shipped by accident.
 */

export interface ProviderIntent {
  /** The provider's own identifier. */
  ref: string;
  /** Passed to the client to complete payment. Never logged. */
  clientSecret: string | null;
  status: "REQUIRES_PAYMENT" | "PROCESSING" | "SUCCEEDED" | "FAILED";
  /** Where the browser should go to complete the payment. */
  redirectUrl: string | null;
}

export interface ProviderRefund {
  ref: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
}

export interface WebhookEvent {
  id: string;
  type: string;
  intentRef?: string;
  /**
   * The provider's id for the captured charge, where it differs from the
   * intent's. Paymob refunds a transaction, not an order, so this is kept.
   */
  chargeRef?: string;
  status?: "SUCCEEDED" | "FAILED" | "PROCESSING";
  failureCode?: string;
  failureMessage?: string;
  amountCents?: number;
  currency?: string;
}

export interface PaymentCustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
}

export interface PaymentProvider {
  readonly name: "stripe" | "ledger" | "paymob";
  createIntent(params: {
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    /** Our own reference for the attempt, echoed back by providers that support it. */
    reference: string;
    description: string;
    metadata: Record<string, string>;
    customerEmail?: string;
    customer?: PaymentCustomer;
    returnUrl: string;
  }): Promise<ProviderIntent>;
  /**
   * Where to send the payer to finish an intent that already exists, when the
   * provider hosts the payment page. Null when the client completes it in
   * place (Stripe Elements).
   */
  resumeUrl(intent: { providerRef: string | null; clientSecret: string | null }, returnUrl: string): string | null;
  retrieveIntent(ref: string): Promise<{ status: ProviderIntent["status"]; amountCents: number }>;
  refund(params: {
    intentRef: string;
    /** The captured charge, for providers that refund by transaction. */
    chargeRef?: string | null;
    amountCents: number;
    idempotencyKey: string;
    reason: string;
  }): Promise<ProviderRefund>;
  /** Verifies the signature and parses the payload. Throws if untrusted. */
  parseWebhook(rawBody: string, signature: string | null): Promise<WebhookEvent>;
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

let stripeClient: Stripe | null = null;

function stripe(): Stripe {
  if (!stripeClient) {
    const key = env().STRIPE_SECRET_KEY;
    if (!key) throw dependencyFailed("Card payments are not available right now.", "missing STRIPE_SECRET_KEY");
    stripeClient = new Stripe(key, { typescript: true });
  }
  return stripeClient;
}

function mapStripeStatus(status: Stripe.PaymentIntent.Status): ProviderIntent["status"] {
  switch (status) {
    case "succeeded":
      return "SUCCEEDED";
    case "processing":
      return "PROCESSING";
    case "canceled":
      return "FAILED";
    default:
      return "REQUIRES_PAYMENT";
  }
}

const stripeProvider: PaymentProvider = {
  name: "stripe",

  async createIntent(params) {
    try {
      const intent = await stripe().paymentIntents.create(
        {
          amount: params.amountCents,
          currency: params.currency.toLowerCase(),
          description: params.description.slice(0, 300),
          metadata: params.metadata,
          receipt_email: params.customerEmail,
          automatic_payment_methods: { enabled: true },
        },
        { idempotencyKey: params.idempotencyKey },
      );

      return {
        ref: intent.id,
        clientSecret: intent.client_secret,
        status: mapStripeStatus(intent.status),
        redirectUrl: null,
      };
    } catch (e) {
      logger.exception("stripe createIntent failed", e);
      throw dependencyFailed("We could not start that payment. Please try again.");
    }
  },

  resumeUrl() {
    return null;
  },

  async retrieveIntent(ref) {
    const intent = await stripe().paymentIntents.retrieve(ref);
    return { status: mapStripeStatus(intent.status), amountCents: intent.amount };
  },

  async refund(params) {
    try {
      const refund = await stripe().refunds.create(
        {
          payment_intent: params.intentRef,
          amount: params.amountCents,
          reason: params.reason === "FRAUDULENT" ? "fraudulent" : "requested_by_customer",
        },
        { idempotencyKey: params.idempotencyKey },
      );
      return {
        ref: refund.id,
        status: refund.status === "succeeded" ? "SUCCEEDED" : refund.status === "failed" ? "FAILED" : "PENDING",
      };
    } catch (e) {
      logger.exception("stripe refund failed", e);
      throw dependencyFailed("We could not process that refund. Please try again.");
    }
  },

  async parseWebhook(rawBody, signature) {
    const secret = env().STRIPE_WEBHOOK_SECRET;
    if (!secret) throw dependencyFailed("Webhooks are not configured.", "missing STRIPE_WEBHOOK_SECRET");
    if (!signature) throw dependencyFailed("Unsigned webhook rejected.", "missing stripe-signature");

    // constructEvent throws on a bad signature. An unverified webhook is an
    // attacker telling us a payment succeeded, so this must never be skipped.
    const event = stripe().webhooks.constructEvent(rawBody, signature, secret);

    const base: WebhookEvent = { id: event.id, type: event.type };

    if (event.type.startsWith("payment_intent.")) {
      const intent = event.data.object as Stripe.PaymentIntent;
      return {
        ...base,
        intentRef: intent.id,
        status:
          event.type === "payment_intent.succeeded"
            ? "SUCCEEDED"
            : event.type === "payment_intent.payment_failed"
              ? "FAILED"
              : "PROCESSING",
        failureCode: intent.last_payment_error?.code,
        failureMessage: intent.last_payment_error?.message,
        amountCents: intent.amount,
        currency: intent.currency.toUpperCase(),
      };
    }

    return base;
  },
};

// ---------------------------------------------------------------------------
// Internal ledger provider
// ---------------------------------------------------------------------------

/**
 * The sandbox provider. `createIntent` returns an authorisation that is
 * genuinely pending — the payment only succeeds when someone confirms it on
 * /checkout/sandbox, which states plainly that no real money moves. The rest of
 * the system treats it exactly like Stripe, so the escrow, commission, payout
 * and refund paths are the real ones and not a separate "demo mode".
 */
const ledgerProvider: PaymentProvider = {
  name: "ledger",

  async createIntent(params) {
    const ref = `pm_sandbox_${generateToken(12)}`;
    return {
      ref,
      clientSecret: null,
      status: "REQUIRES_PAYMENT",
      redirectUrl: `/checkout/sandbox?ref=${encodeURIComponent(ref)}&return=${encodeURIComponent(params.returnUrl)}`,
    };
  },

  resumeUrl(intent, returnUrl) {
    if (!intent.providerRef) return null;
    return `/checkout/sandbox?ref=${encodeURIComponent(intent.providerRef)}&return=${encodeURIComponent(returnUrl)}`;
  },

  async retrieveIntent() {
    // The database row is the source of truth for the sandbox provider; the
    // payment service reads it directly and never calls this.
    throw dependencyFailed("Not supported by the sandbox provider.");
  },

  async refund(_params) {
    // The amount and the ledger postings are the payment service's business.
    // A sandbox gateway only has to hand back a reference.
    return { ref: `pm_sandbox_re_${generateToken(10)}`, status: "SUCCEEDED" };
  },

  async parseWebhook() {
    throw dependencyFailed("The sandbox provider does not receive webhooks.");
  },
};

// ---------------------------------------------------------------------------
// Paymob
// ---------------------------------------------------------------------------

/**
 * The fields of a Transaction Processed callback that Paymob signs, in the
 * order it concatenates them. This is Paymob's documented order, not an
 * alphabetical one; a single field out of place and every genuine callback
 * fails verification.
 */
export const PAYMOB_HMAC_FIELDS = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
] as const;

/** The string Paymob signs: each field's value as received, no separators. */
export function paymobHmacMessage(obj: Record<string, unknown>): string {
  return PAYMOB_HMAC_FIELDS.map((path) => {
    const value = path.split(".").reduce<unknown>(
      (node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined),
      obj,
    );
    // String() as Paymob's own reference implementation does: booleans become
    // "true"/"false" and numbers keep their plain form.
    return String(value);
  }).join("");
}

export function verifyPaymobHmac(obj: Record<string, unknown>, received: string | null, secret: string): boolean {
  if (!received) return false;
  const expected = createHmac("sha512", secret).update(paymobHmacMessage(obj)).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received.trim().toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function paymobConfig() {
  const e = env();
  if (!e.PAYMOB_SECRET_KEY || !e.PAYMOB_PUBLIC_KEY || !e.PAYMOB_INTEGRATION_IDS.length) {
    throw dependencyFailed("Card payments are not available right now.", "Paymob is not configured");
  }
  return {
    base: e.PAYMOB_BASE_URL.replace(/\/+$/, ""),
    secretKey: e.PAYMOB_SECRET_KEY,
    publicKey: e.PAYMOB_PUBLIC_KEY,
    integrationIds: e.PAYMOB_INTEGRATION_IDS,
    appUrl: e.APP_URL.replace(/\/+$/, ""),
  };
}

async function paymobRequest<T>(path: string, body: unknown, failure: string): Promise<T> {
  const config = paymobConfig();
  let response: Response;
  try {
    response = await fetch(`${config.base}${path}`, {
      method: "POST",
      headers: {
        // The literal word "Token", not "Bearer".
        Authorization: `Token ${config.secretKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    logger.exception("paymob request failed", e, { path });
    throw dependencyFailed(failure, `paymob ${path} unreachable`);
  }

  const text = await response.text();
  if (!response.ok) {
    // The response body explains what Paymob rejected; it never contains our
    // secret key, so it is safe to log (truncated) for the operator.
    logger.error("paymob request rejected", { path, status: response.status, body: text.slice(0, 500) });
    throw dependencyFailed(failure, `paymob ${path} returned ${response.status}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw dependencyFailed(failure, `paymob ${path} returned non-JSON`);
  }
}

/** Paymob requires both names; a single-word name is used for both. */
function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "PetMate";
  const last = parts.length > 1 ? parts.slice(1).join(" ") : first;
  return { first: first.slice(0, 50), last: last.slice(0, 50) };
}

interface PaymobIntention {
  id: string | number;
  client_secret: string;
  intention_order_id?: number | string;
}

interface PaymobTransaction {
  id: number | string;
  success: boolean;
  pending: boolean;
  amount_cents: number;
  currency?: string;
  is_refunded?: boolean;
  is_voided?: boolean;
  data?: { message?: string; txn_response_code?: string };
  order?: { id: number | string; merchant_order_id?: string | null };
}

export const paymobProvider: PaymentProvider = {
  name: "paymob",

  async createIntent(params) {
    const config = paymobConfig();
    const customer = params.customer;
    const name = splitName(customer ? `${customer.firstName} ${customer.lastName}` : "PetMate Customer");

    const intention = await paymobRequest<PaymobIntention>(
      "/v1/intention/",
      {
        amount: params.amountCents,
        currency: params.currency,
        payment_methods: config.integrationIds,
        // One line for the whole amount: Paymob rejects an intention whose
        // item amounts do not add up to the total, and the breakdown already
        // lives on our own invoice.
        items: [{ name: params.description.slice(0, 50), amount: params.amountCents, quantity: 1 }],
        billing_data: {
          first_name: name.first,
          last_name: name.last,
          email: customer?.email ?? params.customerEmail ?? "customer@petmate.app",
          // Required by Paymob; "NA" is its documented placeholder.
          phone_number: customer?.phone || "NA",
          apartment: "NA",
          floor: "NA",
          street: "NA",
          building: "NA",
          city: "NA",
          state: "NA",
          country: params.currency === "EGP" ? "EGY" : "NA",
        },
        special_reference: params.reference,
        extras: { reference: params.reference, purpose: params.metadata.purpose ?? "" },
        notification_url: `${config.appUrl}/api/webhooks/paymob`,
        redirection_url: params.returnUrl,
      },
      "We could not start that payment. Please try again.",
    );

    if (!intention.client_secret || intention.intention_order_id == null) {
      throw dependencyFailed("We could not start that payment. Please try again.", "paymob intention incomplete");
    }

    return {
      // The callback identifies the payment by its Paymob order, so that is
      // the reference stored on the intent.
      ref: String(intention.intention_order_id),
      clientSecret: intention.client_secret,
      status: "REQUIRES_PAYMENT",
      redirectUrl: paymobCheckoutUrl(intention.client_secret),
    };
  },

  resumeUrl(intent) {
    return intent.clientSecret ? paymobCheckoutUrl(intent.clientSecret) : null;
  },

  async retrieveIntent() {
    // Payment state arrives by signed callback; nothing polls Paymob.
    throw dependencyFailed("That payment could not be completed.", "paymob retrieveIntent is not used");
  },

  async refund(params) {
    if (!params.chargeRef) {
      throw dependencyFailed(
        "We could not process that refund. Please try again.",
        `paymob refund for ${params.intentRef} has no transaction id`,
      );
    }
    const transaction = await paymobRequest<PaymobTransaction>(
      "/api/acceptance/void_refund/refund",
      { transaction_id: Number(params.chargeRef), amount_cents: params.amountCents },
      "We could not process that refund. Please try again.",
    );
    return {
      ref: String(transaction.id),
      status: transaction.success ? "SUCCEEDED" : transaction.pending ? "PENDING" : "FAILED",
    };
  },

  async parseWebhook(rawBody, signature) {
    const secret = env().PAYMOB_HMAC_SECRET;
    if (!secret) throw dependencyFailed("Webhooks are not configured.", "missing PAYMOB_HMAC_SECRET");

    let payload: { type?: string; obj?: PaymobTransaction & Record<string, unknown> };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw dependencyFailed("Unsigned webhook rejected.", "paymob callback is not JSON");
    }
    const obj = payload.obj;
    if (!obj || payload.type !== "TRANSACTION") {
      throw dependencyFailed("Unsigned webhook rejected.", `unsupported paymob callback ${payload.type}`);
    }
    // The signature arrives as the `hmac` query parameter. Nothing in the body
    // is trusted until it matches.
    if (!verifyPaymobHmac(obj, signature, secret)) {
      throw dependencyFailed("Unsigned webhook rejected.", "paymob hmac mismatch");
    }

    // A refund or void is reported as a transaction too. Those are initiated
    // by us and recorded when we make them; they must never read as a new
    // successful payment.
    const reversal = obj.is_refunded === true || obj.is_voided === true || obj.has_parent_transaction === true;

    return {
      id: `paymob:${obj.id}`,
      type: reversal ? "transaction.reversal" : "transaction.processed",
      intentRef: obj.order?.id != null ? String(obj.order.id) : undefined,
      chargeRef: String(obj.id),
      status: reversal ? undefined : obj.pending ? "PROCESSING" : obj.success ? "SUCCEEDED" : "FAILED",
      failureCode: obj.success ? undefined : obj.data?.txn_response_code,
      failureMessage: obj.success ? undefined : obj.data?.message,
      amountCents: obj.amount_cents,
      currency: obj.currency,
    };
  },
};

export function paymobCheckoutUrl(clientSecret: string): string {
  const config = paymobConfig();
  return `${config.base}/unifiedcheckout/?publicKey=${encodeURIComponent(config.publicKey)}&clientSecret=${encodeURIComponent(clientSecret)}`;
}

export function paymentProvider(): PaymentProvider {
  switch (env().PAYMENT_PROVIDER) {
    case "stripe":
      return stripeProvider;
    case "paymob":
      return paymobProvider;
    default:
      return ledgerProvider;
  }
}

export const isSandboxPayments = () => env().PAYMENT_PROVIDER === "ledger";
