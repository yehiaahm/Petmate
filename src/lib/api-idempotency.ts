/**
 * Client-side idempotency keys.
 *
 * Every money-moving request carries one so a double click, a flaky connection
 * or a retry cannot create two charges. The server enforces uniqueness; this
 * just produces the value.
 *
 * `crypto.randomUUID` is unavailable on insecure origins in some browsers, so
 * there is a real fallback rather than a crash at checkout.
 */
export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * A key that is stable for one logical attempt.
 *
 * Kept in sessionStorage so a refresh mid-checkout reuses the same key and the
 * server returns the original payment rather than opening a second one.
 */
export function stableKey(scope: string): string {
  const storageKey = `pm-idem-${scope}`;

  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const fresh = uuid();
    sessionStorage.setItem(storageKey, fresh);
    return fresh;
  } catch {
    return uuid();
  }
}

/** Clears a stable key once its attempt has definitively finished. */
export function clearStableKey(scope: string): void {
  try {
    sessionStorage.removeItem(`pm-idem-${scope}`);
  } catch {
    // Storage unavailable; the key was per-request anyway.
  }
}
