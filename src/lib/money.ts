import { CURRENCY_SYMBOL, type Currency } from "./constants";
import { intlLocale, type Locale } from "./i18n/config";

/**
 * Money is always an integer in the currency minor unit (cents).
 *
 * Floats never touch a price. The only place a decimal exists is the string the
 * user reads, produced here at the very edge.
 */

const FREE_LABEL: Record<Locale, string> = { en: "Free", ar: "مجاناً" };

export function formatMoney(
  cents: number,
  currency: string = "USD",
  opts: { compact?: boolean; showFree?: boolean; locale?: Locale } = {},
): string {
  const locale = opts.locale ?? "en";
  if (opts.showFree && cents === 0) return FREE_LABEL[locale];

  const cur = (currency as Currency) in CURRENCY_SYMBOL ? (currency as Currency) : "USD";

  // Arabic is written by Intl, which knows where the currency sign goes in a
  // right-to-left sentence and what it is called ("ج.م." for EGP). English
  // keeps the hand-rolled format below, which the rest of the product and its
  // tests were written against.
  if (locale !== "en") {
    const whole = cents % 100 === 0;
    return new Intl.NumberFormat(intlLocale(locale), {
      style: "currency",
      currency: cur,
      ...(opts.compact && Math.abs(cents) >= 100_000
        ? { notation: "compact" as const, maximumFractionDigits: 1 }
        : { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }),
    }).format(cents / 100);
  }

  const symbol = CURRENCY_SYMBOL[cur];
  const value = cents / 100;

  if (opts.compact && Math.abs(cents) >= 100_000) {
    const units = [
      { v: 1_000_000_000, s: "B" },
      { v: 1_000_000, s: "M" },
      { v: 1_000, s: "K" },
    ];
    for (const u of units) {
      if (Math.abs(value) >= u.v) {
        const n = value / u.v;
        return `${symbol}${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)}${u.s}`;
      }
    }
  }

  const fixed = value % 1 === 0 ? value.toFixed(0) : value.toFixed(2);
  const [whole = "0", frac] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${symbol}${grouped}${frac ? `.${frac}` : ""}`;
}

/** Parses a user-typed amount into cents. Returns null for anything invalid. */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (!cleaned || (cleaned.match(/\./g) ?? []).length > 1) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Commission in basis points, rounded half-up, clamped to the amount.
 * 250 bps of 1999 cents = 50 cents (49.975 rounds to 50).
 */
export function applyBps(amountCents: number, bps: number): number {
  if (amountCents <= 0 || bps <= 0) return 0;
  return Math.min(amountCents, Math.round((amountCents * bps) / 10_000));
}

export function bpsToPercent(bps: number): string {
  const pct = bps / 100;
  return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(2)}%`;
}

/**
 * Splits `total` into `parts` whole cents that sum exactly to `total`.
 * Used when a discount or refund spans several order lines: without this the
 * rounding remainder silently disappears or duplicates.
 */
export function distributeCents(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);

  const raw = weights.map((w) => (total * w) / sum);
  const floored = raw.map(Math.floor);
  let remainder = total - floored.reduce((a, b) => a + b, 0);

  // Hand the leftover cents to the largest fractional parts first.
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  const out = [...floored];
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    remainder--;
  }
  return out;
}

export function ratingFromBps(bps: number): number {
  return Math.round(bps) / 100;
}

export function formatRating(bps: number): string {
  return (Math.round(bps) / 100).toFixed(1);
}

/** Incremental average update, kept in bps so no precision is lost over time. */
export function nextRatingAvgBps(
  currentAvgBps: number,
  currentCount: number,
  newRating: number,
): number {
  const totalBps = currentAvgBps * currentCount + newRating * 100;
  return Math.round(totalBps / (currentCount + 1));
}
