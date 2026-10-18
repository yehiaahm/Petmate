import type { CancellationPolicy } from "@/lib/constants";

/**
 * Pet care arithmetic.
 *
 * Pure functions, no database and no clock of their own, so the rules that
 * decide what a customer pays and what they get back are tested directly
 * rather than through a booking. Everything is integer minor units.
 */

const DAY_MS = 86_400_000;

/** "2026-10-20" → midnight UTC of that calendar date, or null if not a date. */
export function parseCalendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Rejects 2026-02-31, which Date would silently roll into March.
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The nights of a stay: every calendar date from check-in up to, but not
 * including, check-out. A stay checking in on the 20th and out on the 23rd is
 * the nights of the 20th, 21st and 22nd.
 */
export function stayNights(checkIn: Date, checkOut: Date): Date[] {
  const nights: Date[] = [];
  for (let t = checkIn.getTime(); t < checkOut.getTime(); t += DAY_MS) {
    nights.push(new Date(t));
  }
  return nights;
}

export const MAX_STAY_NIGHTS = 60;

/** Straight-line distance, rounded up to the next 100 m so a quote never undercharges. */
export function roundDistanceKm(km: number): number {
  return Math.ceil(Math.max(0, km) * 10) / 10;
}

/** One pickup or drop-off leg. */
export function transportLegCents(params: {
  baseCents: number;
  perKmCents: number;
  distanceKm: number;
}): number {
  return params.baseCents + Math.round(params.perKmCents * roundDistanceKm(params.distanceKm));
}

/**
 * Share of the paid amount returned on a customer cancellation, in basis
 * points, by the policy agreed at booking and the time left before the start.
 * A provider cancelling always refunds in full; that is decided by the caller.
 */
export function refundShareBps(policy: CancellationPolicy, hoursUntilStart: number): number {
  switch (policy) {
    case "FLEXIBLE":
      return hoursUntilStart >= 24 ? 10_000 : 0;
    case "MODERATE":
      if (hoursUntilStart >= 72) return 10_000;
      return hoursUntilStart >= 24 ? 5_000 : 0;
    case "STRICT":
      return hoursUntilStart >= 168 ? 5_000 : 0;
  }
}

export function refundForCancellation(params: {
  policy: CancellationPolicy;
  hoursUntilStart: number;
  paidCents: number;
  cancelledByProvider: boolean;
}): number {
  if (params.paidCents <= 0) return 0;
  if (params.cancelledByProvider) return params.paidCents;
  const bps = refundShareBps(params.policy, params.hoursUntilStart);
  return Math.floor((params.paidCents * bps) / 10_000);
}

export interface CareQuote {
  serviceCents: number;
  transportCents: number;
  totalCents: number;
  /** One line per thing being charged, for the summary the customer sees. */
  lines: { label: string; amountCents: number }[];
}

export function buildQuote(params: {
  serviceLabel: string;
  serviceCents: number;
  legs: { label: string; amountCents: number }[];
}): CareQuote {
  const transportCents = params.legs.reduce((sum, leg) => sum + leg.amountCents, 0);
  return {
    serviceCents: params.serviceCents,
    transportCents,
    totalCents: params.serviceCents + transportCents,
    lines: [{ label: params.serviceLabel, amountCents: params.serviceCents }, ...params.legs],
  };
}
