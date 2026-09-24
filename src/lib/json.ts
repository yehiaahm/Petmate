/**
 * JSON columns.
 *
 * The schema stores structured payloads as `String` so the same models run on
 * SQLite and Postgres. Every read goes through here: a malformed or hostile
 * value yields the fallback instead of throwing inside a page render.
 */

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function parseJsonArray<T>(raw: string | null | undefined): T[] {
  const v = parseJson<unknown>(raw, []);
  return Array.isArray(v) ? (v as T[]) : [];
}

export function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  const v = parseJson<unknown>(raw, {});
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * Deep-strips keys that must never leave the server, at any nesting level.
 * Used on metadata blobs before they are handed to a client component.
 */
const REDACTED_KEYS = new Set([
  "password",
  "passwordhash",
  "tokenhash",
  "otphash",
  "clientsecret",
  "secret",
  "apikey",
  "authorization",
  "cookie",
  "sessiontoken",
  "cardnumber",
  "cvv",
]);

export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redact) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k.toLowerCase()) ? "[redacted]" : redact(v);
    }
    return out as unknown as T;
  }
  return value;
}
