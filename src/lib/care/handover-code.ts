import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Handover codes for pickup and drop-off.
 *
 * An animal changes hands twice on a transported stay, and both times the
 * question is the same: is this the right person? The owner holds a six-digit
 * code; the driver types it in; the leg completes only if it matches. That is
 * proof of handover, not a checkbox a driver can tick from the van.
 *
 * The code is derived — an HMAC of the leg and the moment it was issued — so
 * nothing in the database can be read back as a code, and the owner's booking
 * page can still show it to them for as long as the leg is live. Re-issuing
 * (a new `issuedAt`) invalidates the old one.
 */

const DIGITS = 6;

export function handoverCode(transportId: string, issuedAt: Date): string {
  const mac = createHmac("sha256", env().AUTH_SECRET)
    .update(`care-handover:${transportId}:${issuedAt.getTime()}`)
    .digest();
  const value = mac.readUInt32BE(0) % 10 ** DIGITS;
  return value.toString().padStart(DIGITS, "0");
}

export function verifyHandoverCode(transportId: string, issuedAt: Date, provided: string): boolean {
  const expected = Buffer.from(handoverCode(transportId, issuedAt));
  const given = Buffer.from(provided.replace(/\s+/g, ""));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Wrong codes allowed before the leg locks and support has to step in. */
export const MAX_HANDOVER_ATTEMPTS = 5;
