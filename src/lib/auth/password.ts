import "server-only";
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing with scrypt.
 *
 * scrypt is memory-hard and is in Node core, so there is no native module to
 * build and nothing to go stale. Parameters follow the OWASP guidance of
 * N=2^17, r=8, p=1 (~128 MB, ~100ms on a modern server).
 *
 * The cost parameters live in the stored hash, so raising them later keeps
 * every existing password verifiable. `needsRehash` tells the login path when
 * to transparently upgrade a hash.
 */
const PARAMS = { N: 1 << 17, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// scrypt's own guard rail is 32MB; N=2^17,r=8 needs ~128MB.
const MAX_MEM = 256 * 1024 * 1024;

const PREFIX = "scrypt";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(normalize(password), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: MAX_MEM,
  });
  return [
    PREFIX,
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Refuse absurd parameters from a tampered row: they would be a CPU DoS.
  if (N > 1 << 20 || r > 32 || p > 16) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, "base64url");
    expected = Buffer.from(parts[5]!, "base64url");
  } catch {
    return false;
  }

  try {
    const derived = await scryptAsync(normalize(password), salt, expected.length, {
      N,
      r,
      p,
      maxmem: MAX_MEM,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** True when the stored hash uses weaker parameters than the current policy. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return true;
  return Number(parts[1]) < PARAMS.N || Number(parts[2]) < PARAMS.r;
}

/**
 * Unicode normalisation, so a password typed on a Mac and on Windows with the
 * same visible characters produces the same hash.
 */
function normalize(password: string): string {
  return password.normalize("NFKC");
}

// ---------------------------------------------------------------------------
// Strength policy
// ---------------------------------------------------------------------------

/**
 * The 200 most common leaked passwords would be a file; this is the shortlist
 * that actually shows up in credential-stuffing lists plus product-specific
 * guesses. The real defence is length and rate limiting, not a blocklist.
 */
const COMMON = new Set([
  "password", "123456", "123456789", "12345678", "qwerty", "abc123", "111111",
  "password1", "1234567", "letmein", "welcome", "monkey", "dragon", "sunshine",
  "princess", "football", "iloveyou", "admin", "login", "master", "qwerty123",
  "password123", "petmate", "petmate123", "changeme", "passw0rd", "trustno1",
]);

export interface PasswordStrength {
  ok: boolean;
  score: 0 | 1 | 2 | 3 | 4;
  label: "Too weak" | "Weak" | "Fair" | "Strong" | "Excellent";
  problems: string[];
}

export function assessPassword(password: string, context: string[] = []): PasswordStrength {
  const problems: string[] = [];
  const pw = password.normalize("NFKC");
  const lower = pw.toLowerCase();

  if (pw.length < 10) problems.push("Use at least 10 characters.");
  if (pw.length > 200) problems.push("Keep it under 200 characters.");
  if (COMMON.has(lower)) problems.push("That password appears in known breach lists.");
  if (/^(.)\1+$/.test(pw)) problems.push("Avoid repeating a single character.");
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/.test(lower)) {
    problems.push("Avoid keyboard and number sequences.");
  }
  // Compare on a squashed form as well as the raw one: "Alex Morgan" must
  // still catch "alexmorgan2024", and each name part is checked on its own so
  // "morgan1985!" is caught too.
  const squashed = lower.replace(/[^a-z0-9]/g, "");
  const contextTokens = new Set<string>();
  for (const c of context) {
    const value = c?.toLowerCase().trim();
    if (!value) continue;
    contextTokens.add(value);
    contextTokens.add(value.replace(/[^a-z0-9]/g, ""));
    for (const part of value.split(/[^a-z0-9]+/)) {
      if (part.length >= 4) contextTokens.add(part);
    }
  }
  for (const token of contextTokens) {
    if (token.length >= 4 && (lower.includes(token) || squashed.includes(token))) {
      problems.push("Do not include your name or email in your password.");
      break;
    }
  }

  // Score on variety and length rather than forcing a symbol, which mostly
  // produces "Password1!" and nothing safer.
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (problems.length) score = Math.min(score, 1);

  const clamped = Math.max(0, Math.min(4, score)) as 0 | 1 | 2 | 3 | 4;
  const labels = ["Too weak", "Weak", "Fair", "Strong", "Excellent"] as const;

  return {
    ok: problems.length === 0,
    score: clamped,
    label: labels[clamped]!,
    problems,
  };
}
