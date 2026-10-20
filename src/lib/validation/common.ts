import { z } from "zod";
import {
  SPECIES,
  SEX,
  LIMITS,
  CURRENCIES,
  TEMPERAMENT_TAGS,
} from "@/lib/constants";
import { PLATFORM_CURRENCY } from "@/lib/currency";

/**
 * Shared validators.
 *
 * Everything that crosses the network boundary is parsed here first. Zod is not
 * decoration: a value that has not been through a schema is untrusted input,
 * and no service accepts one.
 */

/**
 * Rejects C0 control characters other than tab/newline. Written as an explicit
 * codepoint check rather than a regex range so no control byte ever has to
 * appear literally in this source file.
 */
function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13) continue;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Trims, collapses whitespace, and rejects control characters. */
export const safeText = (max: number, min = 1) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(min, min === 1 ? "This field is required." : `Use at least ${min} characters.`)
        .max(max, `Keep this under ${max} characters.`)
        .refine((s) => !hasControlCharacters(s), {
          message: "That contains characters we cannot accept.",
        }),
    );

/** Multi-line text: keeps newlines, normalises the rest. */
export const safeParagraph = (max: number, min = 1) =>
  z
    .string()
    .transform((s) => s.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim())
    .pipe(
      z
        .string()
        .min(min, min === 1 ? "This field is required." : `Use at least ${min} characters.`)
        .max(max, `Keep this under ${max} characters.`)
        .refine((s) => !hasControlCharacters(s), {
          message: "That contains characters we cannot accept.",
        }),
    );

export const optionalText = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max, `Keep this under ${max} characters.`))
    .optional()
    .or(z.literal("").transform(() => undefined));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, "Enter a valid email address.")
  .max(320, "That email address is too long.")
  .email("Enter a valid email address.");

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(200, "Keep your password under 200 characters.");

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Handles need at least 3 characters.")
  .max(30, "Handles are at most 30 characters.")
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Use letters, numbers and hyphens only.");

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s().-]{7,20}$/, "Enter a valid phone number.")
  .transform((s) => s.replace(/[^\d+]/g, ""));

export const cuidSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, "Invalid identifier.");

export const slugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Invalid address.");

/** Money always arrives as a whole number of cents and is bounded. */
export const centsSchema = z
  .number()
  .int("Enter a whole amount.")
  .min(0, "Amount cannot be negative.")
  .max(LIMITS.maxPriceCents, "That amount is too large.");

export const currencySchema = z.enum(CURRENCIES);

/**
 * The currency on anything that carries a price. Only the platform currency is
 * accepted, and it is the default, so a form never has to send it. A listing
 * priced in another currency would land in a ledger account nobody's balance
 * reads — see `lib/currency.ts`.
 */
export const priceCurrencySchema = z
  .literal(PLATFORM_CURRENCY, { error: `Prices on PetMate are in ${PLATFORM_CURRENCY}.` })
  .default(PLATFORM_CURRENCY);

export const speciesSchema = z.enum(SPECIES);
export const sexSchema = z.enum(SEX);

export const temperamentSchema = z
  .array(z.enum(TEMPERAMENT_TAGS))
  .max(6, "Choose up to 6 traits.")
  .optional();

export const coordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const locationSchema = z.object({
  country: optionalText(60),
  region: optionalText(80),
  city: optionalText(80),
  postalCode: optionalText(20),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

/** Dates arrive as ISO strings. Rejects anything unparseable or absurd. */
export const pastDateSchema = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
  .transform((s) => new Date(s))
  .refine((d) => !Number.isNaN(d.getTime()), "Enter a valid date.")
  .refine((d) => d <= new Date(), "That date is in the future.")
  .refine((d) => d > new Date("1980-01-01"), "That date is too far in the past.");

export const futureDateSchema = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s))
  .refine((d) => !Number.isNaN(d.getTime()), "Enter a valid date.")
  .refine((d) => d > new Date(), "That time has already passed.")
  .refine((d) => d < new Date(Date.now() + 365 * 86_400_000), "That is more than a year away.");

/**
 * A URL the server may be asked to store or display. Blocks anything that is
 * not http(s), and blocks private hosts so a stored URL cannot be used to
 * probe the internal network (SSRF) if anything ever fetches it.
 */
export const externalUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url("Enter a valid link.")
  .refine((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host.endsWith(".localhost") ||
      host.endsWith(".internal") ||
      host.endsWith(".local") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === "[::1]" ||
      host.startsWith("[fc") ||
      host.startsWith("[fd")
    ) {
      return false;
    }
    return true;
  }, "That link is not allowed.");

/**
 * An internal redirect target. Only same-origin paths, which closes the open
 * redirect that "?next=https://evil.example" would otherwise give.
 */
export const redirectPathSchema = z
  .string()
  .max(512)
  .refine((v) => v.startsWith("/") && !v.startsWith("//") && !v.includes("\\"), {
    message: "Invalid redirect.",
  })
  .optional();

export function safeRedirect(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value) return fallback;
  const parsed = redirectPathSchema.safeParse(value);
  return parsed.success && parsed.data ? parsed.data : fallback;
}

export const sortSchema = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.enum(values).default(fallback as never);

export const booleanParam = z
  .union([z.boolean(), z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
  .transform((v) => v === true || v === "true" || v === "1");

/** Comma-separated query param -> array, e.g. ?species=DOG,CAT */
export const csvParam = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(",")))
    .transform((arr) => arr.map((s) => s.trim()).filter(Boolean).slice(0, 20))
    .pipe(z.array(z.enum(values)));

/** Comma-separated list of opaque ids. */
export const csvIds = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(",")))
  .transform((arr) => arr.map((s) => s.trim()).filter(Boolean).slice(0, 20))
  .pipe(z.array(cuidSchema));
