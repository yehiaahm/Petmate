import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { randomBytes, randomUUID } from "node:crypto";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** Unambiguous alphabet: no 0/O or 1/I/L, so a human can read it aloud. */
const READABLE = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function readableCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += READABLE[bytes[i]! % READABLE.length];
  }
  return out;
}

/** e.g. PM-8F3K-2QD9 — printed on collar tags, so it must be transcribable. */
export function generatePassportNumber(): string {
  return `PM-${readableCode(4)}-${readableCode(4)}`;
}

export function generateOrderNumber(prefix = "PM"): string {
  const d = new Date();
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${prefix}-${ym}-${readableCode(6)}`;
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function uuid(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

/**
 * Arabic letters, romanised for URLs. Slugs stay ASCII so a link survives
 * being pasted into WhatsApp, an SMS or an email client that mangles
 * percent-encoding; without this an Arabic title had no slug at all and every
 * Arabic listing's URL read "item-x7k2p9". Egyptian usage: ج is "g".
 */
const ARABIC_LATIN: Record<string, string> = {
  "\u0627": "a", "\u0623": "a", "\u0625": "e", "\u0622": "a", "\u0671": "a",
  "\u0628": "b", "\u062a": "t", "\u062b": "th", "\u062c": "g", "\u062d": "h",
  "\u062e": "kh", "\u062f": "d", "\u0630": "z", "\u0631": "r", "\u0632": "z",
  "\u0633": "s", "\u0634": "sh", "\u0635": "s", "\u0636": "d", "\u0637": "t",
  "\u0638": "z", "\u0639": "a", "\u063a": "gh", "\u0641": "f", "\u0642": "q",
  "\u0643": "k", "\u0644": "l", "\u0645": "m", "\u0646": "n", "\u0647": "h",
  "\u0648": "w", "\u064a": "y", "\u0649": "a", "\u0629": "a", "\u0624": "o",
  "\u0626": "e", "\u0621": "",
};

const ARABIC_LETTER = /[\u0621-\u064a\u0671]/;
const LONG_VOWEL_LETTERS = new Set(["\u0627", "\u0648", "\u064a"]);

export function transliterateArabic(input: string): string {
  const chars = [...input
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))];

  return chars
    .map((ch, i) => {
      if (!ARABIC_LETTER.test(ch)) return ch;
      // و and ي are consonants at the start of a word or after another vowel
      // letter ("ولد" -> wld, "ايوه" -> aywh) and long vowels elsewhere
      // ("جرو" -> gru, "شيرازي" -> shirazi), which reads far more naturally.
      if (ch === "\u0648" || ch === "\u064a") {
        const prev = chars[i - 1];
        const consonant = !prev || !ARABIC_LETTER.test(prev) || LONG_VOWEL_LETTERS.has(prev);
        if (ch === "\u0648") return consonant ? "w" : "u";
        return consonant ? "y" : "i";
      }
      return ARABIC_LATIN[ch] ?? "";
    })
    .join("");
}

export function slugify(input: string, maxLength = 60): string {
  const base = transliterateArabic(input)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return base || "item";
}

/** Slug plus entropy, so two listings named "Bella" never collide. */
export function uniqueSlug(input: string, maxLength = 60): string {
  return `${slugify(input, maxLength - 7)}-${readableCode(6).toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export function ageInMonths(birthDate: Date | null | undefined, now = new Date()): number | null {
  if (!birthDate) return null;
  const months =
    (now.getFullYear() - birthDate.getFullYear()) * 12 + (now.getMonth() - birthDate.getMonth());
  return Math.max(0, now.getDate() < birthDate.getDate() ? months - 1 : months);
}

export function formatAge(birthDate: Date | null | undefined): string {
  const months = ageInMonths(birthDate);
  if (months === null) return "Age unknown";
  if (months < 1) return "Under 1 month";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (rem === 0) return `${years} year${years === 1 ? "" : "s"}`;
  return `${years}y ${rem}m`;
}

export function formatDate(d: Date | string | null | undefined, style: "short" | "long" = "short") {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: style === "long" ? "long" : "short",
    day: "numeric",
  });
}

export function formatDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function relativeTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;

  const units: [number, string][] = [
    [60_000, "just now"],
    [3_600_000, "m"],
    [86_400_000, "h"],
    [604_800_000, "d"],
    [2_592_000_000, "w"],
    [31_536_000_000, "mo"],
  ];

  if (abs < 60_000) return "just now";
  for (let i = 1; i < units.length; i++) {
    const [limit, suffix] = units[i]!;
    if (abs < limit) {
      const prev = units[i - 1]![0];
      const n = Math.floor(abs / prev);
      return future ? `in ${n}${suffix}` : `${n}${suffix} ago`;
    }
  }
  const y = Math.floor(abs / 31_536_000_000);
  return future ? `in ${y}y` : `${y}y ago`;
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

export function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + months);
  return out;
}

export function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

/** Great-circle distance in km. Accurate enough for "within 50km of me". */
export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Latitude/longitude window for a radius. Used to narrow the SQL scan before
 * the exact haversine filter runs in memory, so a radius search never table-scans.
 */
export function boundingBox(lat: number, lng: number, radiusKm: number) {
  const latDelta = radiusKm / 111;
  const cos = Math.cos((lat * Math.PI) / 180);
  const lngDelta = radiusKm / (111 * Math.max(0.01, Math.abs(cos)));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

export function formatDistance(km: number): string {
  // Coordinates are city-level, not doorstep-level. Reporting "0 m away"
  // implies a precision we do not have and reads as a bug.
  if (km < 1) return "Less than 1 km away";
  if (km < 10) return `${km.toFixed(1)} km away`;
  return `${Math.round(km)} km away`;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : (plural ?? `${singular}s`);
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[\s_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function compactNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

/** Comma-delimited column <-> array. The schema has no scalar lists. */
export function splitTags(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function joinTags(tags: string[]): string {
  return [...new Set(tags.map((t) => t.trim()).filter(Boolean))].join(",");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
