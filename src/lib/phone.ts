import { toWesternDigits } from "@/lib/digits";

/**
 * Phone numbers, stored as E.164 (+201012345678).
 *
 * Egyptian numbers are typed every way imaginable: 01012345678,
 * 00201012345678, +20 101 234 5678, or with Arabic-Indic digits. All of them
 * are the same person, and treating them as different lets one number verify
 * several accounts.
 *
 * Client-safe.
 */

/** Egyptian mobile ranges: Vodafone 010, Etisalat 011, Orange 012, WE 015. */
const EGYPT_MOBILE = /^1[0125]\d{8}$/;

export function normalizePhone(raw: string, defaultCountry: "EG" = "EG"): string | null {
  let s = toWesternDigits(raw).replace(/[\s().\-‎‏]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;

  if (s.startsWith("+")) {
    const digits = s.slice(1);
    if (!/^\d{8,15}$/.test(digits)) return null;
    if (digits.startsWith("20")) {
      const national = digits.slice(2).replace(/^0/, "");
      return EGYPT_MOBILE.test(national) ? `+20${national}` : null;
    }
    return `+${digits}`;
  }

  if (!/^\d+$/.test(s)) return null;
  if (defaultCountry === "EG") {
    if (s.startsWith("20") && EGYPT_MOBILE.test(s.slice(2))) return `+${s}`;
    const national = s.replace(/^0/, "");
    return EGYPT_MOBILE.test(national) ? `+20${national}` : null;
  }
  return null;
}

/** "+20 101 234 5678", for showing a number back to its owner. */
export function formatPhone(e164: string): string {
  const m = /^\+20(1\d)(\d{4})(\d{4})$/.exec(e164);
  if (m) return `+20 ${m[1]}${m[2]!.slice(0, 1)} ${m[2]!.slice(1)} ${m[3]}`;
  return e164;
}

/** The last digits only, for places that confirm which number without revealing it. */
export function maskPhone(e164: string): string {
  return `•••• ${e164.slice(-4)}`;
}
