import { z } from "zod";
import { CURRENCIES } from "@/lib/constants";

/**
 * Environment contract.
 *
 * Parsed once, at module load, so a misconfigured deployment fails at boot
 * rather than at the first request that happens to need the missing value.
 *
 * Anything in `serverSchema` is server-only and must never be imported into a
 * client component. The `NEXT_PUBLIC_` values are the only ones that may reach
 * the browser bundle.
 */

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : v === "true" || v === "1"));

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  PETMATE_DATABASE_URL: z.string().min(1, "PETMATE_DATABASE_URL is required"),

  /**
   * Signs CSRF tokens and any other keyed HMAC. Must be at least 32 chars.
   * Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   */
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters")
    .default("dev-only-insecure-secret-change-me-0123456789abcdef"),

  APP_URL: z.string().url().default("http://localhost:3000"),

  /**
   * Unpooled connection string for migrations. Only needed when
   * PETMATE_DATABASE_URL goes through a pooler; Prisma reads it directly from
   * the generated Postgres schema, so it is declared here only so a missing
   * value is reported alongside the rest of the configuration.
   */
  PETMATE_DIRECT_URL: z.string().optional(),

  // ---- Courier ------------------------------------------------------------
  // Each shop connects its own Bosta account; only the API endpoint is global.
  // Staging: https://stg-app.bosta.co/api/v2
  BOSTA_BASE_URL: z.string().url().default("https://app.bosta.co/api/v2"),

  // ---- Social sign-in ------------------------------------------------------
  // Each provider appears on the sign-in page only when both of its values are
  // set. Redirect URI to register with the provider:
  //   {NEXT_PUBLIC_APP_URL}/api/auth/oauth/google/callback (and /facebook/)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),

  // ---- Payments -----------------------------------------------------------
  // With no Stripe key the platform runs on the internal double-entry ledger
  // provider, which is a real implementation (see lib/payments/ledger.ts), not
  // a stub that pretends a charge happened.
  PAYMENT_PROVIDER: z.enum(["ledger", "stripe", "paymob"]).default("ledger"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Paymob (Egypt): cards, mobile wallets, kiosk and instalments through one
  // hosted checkout. All four values come from the Paymob dashboard,
  // Settings → API Keys and Settings → Payment Integrations.
  PAYMOB_SECRET_KEY: z.string().optional(),
  PAYMOB_PUBLIC_KEY: z.string().optional(),
  PAYMOB_HMAC_SECRET: z.string().optional(),
  /** Comma-separated integration IDs, one per payment method offered at checkout. */
  PAYMOB_INTEGRATION_IDS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number),
    )
    .refine((ids) => ids.every((n) => Number.isInteger(n) && n > 0), "PAYMOB_INTEGRATION_IDS must be comma-separated integers"),
  PAYMOB_BASE_URL: z.string().url().default("https://accept.paymob.com"),

  // ---- Email --------------------------------------------------------------
  // "outbox" writes to the EmailMessage table and renders at /dev/mailbox.
  EMAIL_PROVIDER: z.enum(["outbox", "resend", "smtp"]).default("outbox"),
  EMAIL_FROM: z.string().default("PetMate <no-reply@petmate.app>"),
  RESEND_API_KEY: z.string().optional(),

  // ---- WhatsApp and SMS ----------------------------------------------------
  // "log" writes to the OutboundMessage table and the log without sending,
  // for development. WhatsApp goes through Meta's WhatsApp Cloud API with
  // approved templates; SMS through Twilio.
  WHATSAPP_PROVIDER: z.enum(["log", "meta"]).default("log"),
  META_WHATSAPP_TOKEN: z.string().optional(),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  /** An approved "authentication" template whose body takes the code. */
  META_WHATSAPP_OTP_TEMPLATE: z.string().default("petmate_verification_code"),
  /** An approved "utility" template with two body parameters: the message and the link. */
  META_WHATSAPP_UPDATE_TEMPLATE: z.string().default("petmate_update"),
  SMS_PROVIDER: z.enum(["log", "twilio"]).default("log"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  /** A sender number, alphanumeric sender ID or Messaging Service SID (MG…). */
  TWILIO_FROM: z.string().optional(),

  // ---- AI -----------------------------------------------------------------
  // Absent key => every AI surface falls back to its deterministic path and
  // says so in the UI. Nothing is ever presented as AI output when it is not.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5"),
  AI_ENABLED: bool(true),

  // ---- Storage ------------------------------------------------------------
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_URL: z.string().optional(),

  // ---- Operational --------------------------------------------------------
  RATE_LIMIT_ENABLED: bool(true),
  SEED_DEMO_DATA: bool(false),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  WORKER_ENABLED: bool(true),
  /** Shared secret for the /api/cron/tick endpoint when no worker process runs. */
  CRON_SECRET: z.string().optional(),
});

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_NAME: z.string().default("PetMate"),
  /**
   * The time zone every date and time is shown in. Without one, a server in
   * UTC renders a 10:00 Cairo appointment as 07:00 and the browser then
   * renders the same component differently. IANA name.
   */
  NEXT_PUBLIC_APP_TIMEZONE: z
    .string()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "NEXT_PUBLIC_APP_TIMEZONE must be an IANA time zone such as Africa/Cairo")
    .default("Africa/Cairo"),
  /**
   * The one currency this deployment trades in. Every price, balance and
   * ledger account uses it. It is configuration rather than an admin
   * setting on purpose: the ledger keeps balances per currency, so switching
   * it on a live platform would strand every existing balance in the old one.
   */
  NEXT_PUBLIC_CURRENCY: z.enum(CURRENCIES).default("EGP"),
});

type ServerEnv = z.infer<typeof serverSchema>;
type ClientEnv = z.infer<typeof clientSchema>;

function parseServer(): ServerEnv {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid server environment configuration:\n${issues}`);
  }
  return parsed.data;
}

const parsedClient = clientSchema.safeParse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_APP_TIMEZONE: process.env.NEXT_PUBLIC_APP_TIMEZONE,
  NEXT_PUBLIC_CURRENCY: process.env.NEXT_PUBLIC_CURRENCY,
});

export const clientEnv: ClientEnv = parsedClient.success
  ? parsedClient.data
  : {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_APP_NAME: "PetMate",
      NEXT_PUBLIC_APP_TIMEZONE: "Africa/Cairo",
      NEXT_PUBLIC_CURRENCY: "EGP",
    };

let cachedServerEnv: ServerEnv | null = null;

/**
 * Server-only environment. Calling this from the browser is a programming
 * error and throws rather than silently returning defaults.
 */
export function env(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("env() is server-only and must not be called in the browser");
  }
  if (!cachedServerEnv) cachedServerEnv = parseServer();
  return cachedServerEnv;
}

/**
 * Tests only: forget the parsed environment so the next `env()` re-reads
 * `process.env`. Lets a test switch the payment provider without a new
 * process. Refuses to run anywhere else.
 */
export function resetEnvForTests(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("resetEnvForTests is only for tests");
  cachedServerEnv = null;
}

export const isProduction = () => process.env.NODE_ENV === "production";
export const isTest = () => process.env.NODE_ENV === "test";
export const isDevelopment = () => process.env.NODE_ENV === "development";

/**
 * The production readiness rules, evaluated against the current configuration
 * whatever environment it is running in.
 *
 * Kept separate from `assertProductionSafety` so the admin console can show an
 * operator what *would* block a deployment while they are still on a laptop,
 * rather than discovering it when production refuses to boot. One rule set,
 * two call sites — a second copy of these checks would drift.
 */
export function productionReadiness(): string[] {
  const e = env();
  const problems: string[] = [];

  if (e.AUTH_SECRET.startsWith("dev-only-insecure")) {
    problems.push("AUTH_SECRET is still the development default");
  }
  if (e.PETMATE_DATABASE_URL.startsWith("file:")) {
    problems.push("Production must not run on a SQLite file database");
  }
  if (!e.APP_URL.startsWith("https://")) {
    problems.push("APP_URL must be https in production");
  }
  if (e.PAYMENT_PROVIDER === "stripe" && !e.STRIPE_SECRET_KEY) {
    problems.push("PAYMENT_PROVIDER=stripe requires STRIPE_SECRET_KEY");
  }
  if (e.PAYMENT_PROVIDER === "stripe" && !e.STRIPE_WEBHOOK_SECRET) {
    problems.push("PAYMENT_PROVIDER=stripe requires STRIPE_WEBHOOK_SECRET");
  }
  if (e.PAYMENT_PROVIDER === "ledger") {
    problems.push("PAYMENT_PROVIDER=ledger is the sandbox and takes no real money; configure paymob or stripe");
  }
  if (e.PAYMENT_PROVIDER === "paymob") {
    if (!e.PAYMOB_SECRET_KEY) problems.push("PAYMENT_PROVIDER=paymob requires PAYMOB_SECRET_KEY");
    if (!e.PAYMOB_PUBLIC_KEY) problems.push("PAYMENT_PROVIDER=paymob requires PAYMOB_PUBLIC_KEY");
    // Without it no callback can be verified, and an unverified callback is
    // anyone on the internet announcing that an order was paid.
    if (!e.PAYMOB_HMAC_SECRET) problems.push("PAYMENT_PROVIDER=paymob requires PAYMOB_HMAC_SECRET");
    if (!e.PAYMOB_INTEGRATION_IDS.length) problems.push("PAYMENT_PROVIDER=paymob requires PAYMOB_INTEGRATION_IDS");
    if (e.PAYMOB_SECRET_KEY?.includes("_test_")) problems.push("PAYMOB_SECRET_KEY is a test key");
  }
  if (e.EMAIL_PROVIDER === "outbox") {
    problems.push("EMAIL_PROVIDER=outbox does not deliver mail; configure resend or smtp");
  }
  if (e.WHATSAPP_PROVIDER === "meta" && (!e.META_WHATSAPP_TOKEN || !e.META_WHATSAPP_PHONE_NUMBER_ID)) {
    problems.push("WHATSAPP_PROVIDER=meta requires META_WHATSAPP_TOKEN and META_WHATSAPP_PHONE_NUMBER_ID");
  }
  if (e.SMS_PROVIDER === "twilio" && (!e.TWILIO_ACCOUNT_SID || !e.TWILIO_AUTH_TOKEN || !e.TWILIO_FROM)) {
    problems.push("SMS_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM");
  }
  if (e.WHATSAPP_PROVIDER === "log" && e.SMS_PROVIDER === "log") {
    problems.push("WHATSAPP_PROVIDER and SMS_PROVIDER are both log: phone verification codes would never arrive");
  }
  if (e.SEED_DEMO_DATA) {
    problems.push("SEED_DEMO_DATA must be false in production");
  }
  return problems;
}

/**
 * Production refuses to boot on insecure defaults. This is the difference
 * between "configurable" and "accidentally shipped with the dev secret".
 */
export function assertProductionSafety(): string[] {
  if (!isProduction()) return [];
  return productionReadiness();
}
