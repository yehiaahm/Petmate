import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { dependencyFailed } from "@/lib/errors";
import { generateToken } from "@/lib/utils";

/**
 * Payment provider abstraction.
 *
 * Two implementations, and neither of them fakes a payment:
 *
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
  status?: "SUCCEEDED" | "FAILED" | "PROCESSING";
  failureCode?: string;
  failureMessage?: string;
  amountCents?: number;
  currency?: string;
}

export interface PaymentProvider {
  readonly name: "stripe" | "ledger";
  createIntent(params: {
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    description: string;
    metadata: Record<string, string>;
    customerEmail?: string;
    returnUrl: string;
  }): Promise<ProviderIntent>;
  retrieveIntent(ref: string): Promise<{ status: ProviderIntent["status"]; amountCents: number }>;
  refund(params: {
    intentRef: string;
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

export function paymentProvider(): PaymentProvider {
  return env().PAYMENT_PROVIDER === "stripe" ? stripeProvider : ledgerProvider;
}

export const isSandboxPayments = () => env().PAYMENT_PROVIDER !== "stripe";
