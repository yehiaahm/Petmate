import { describe, it, expect, beforeEach, vi } from "vitest";

// Sign-in sets a cookie; outside a request there is no cookie store to set it on.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));

import { db, makeUser, resetDatabase } from "./helpers";
import { base32Encode, base32Decode, hotp, verifyTotp, totpCounter, otpauthUrl } from "@/lib/auth/totp";
import { seal, open } from "@/lib/auth/secret-box";
import { login } from "@/lib/services/auth.service";
import {
  beginTwoFactorSetup,
  confirmTwoFactorSetup,
  completeTwoFactorLogin,
  disableTwoFactor,
  regenerateBackupCodes,
  getTwoFactorStatus,
} from "@/lib/services/two-factor.service";

const PASSWORD = "TestPassword123!";

/** The code an authenticator app would show right now, one step ahead of the last one used. */
function codeFor(secret: string, step = 0): string {
  return hotp(secret.replace(/\s/g, ""), totpCounter() + step);
}

describe("TOTP (RFC 6238)", () => {
  // RFC 6238 appendix B, SHA-1, secret "12345678901234567890", last six digits.
  const secret = base32Encode(Buffer.from("12345678901234567890"));

  it("matches the published test vectors", () => {
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(hotp(secret, Math.floor(59 / 30))).toBe("287082");
    expect(hotp(secret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(hotp(secret, Math.floor(1234567890 / 30))).toBe("005924");
    expect(hotp(secret, Math.floor(2000000000 / 30))).toBe("279037");
  });

  it("round-trips base32", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it("accepts one step of clock drift and refuses a step already used", () => {
    const at = 1_700_000_000_000;
    const now = totpCounter(at);
    expect(verifyTotp(secret, hotp(secret, now), { at })).toBe(now);
    expect(verifyTotp(secret, hotp(secret, now - 1), { at })).toBe(now - 1);
    expect(verifyTotp(secret, hotp(secret, now - 2), { at })).toBeNull();
    expect(verifyTotp(secret, hotp(secret, now), { at, lastUsedCounter: now })).toBeNull();
    expect(verifyTotp(secret, "12345", { at })).toBeNull();
  });

  it("builds the URI authenticator apps scan", () => {
    const url = otpauthUrl({ secret, account: "nour@example.com", issuer: "PetMate" });
    expect(url).toMatch(/^otpauth:\/\/totp\/PetMate%3Anour%40example\.com\?/);
    expect(url).toContain(`secret=${secret}`);
  });
});

describe("secret box", () => {
  it("encrypts so the stored value reveals nothing and cannot be altered", () => {
    const sealed = seal("JBSWY3DPEHPK3PXP", "totp-secret");
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(open(sealed, "totp-secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(() => open(sealed, "another-purpose")).toThrow();
    const parts = sealed.split(".");
    parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith("A") ? "BB" : "AA");
    expect(() => open(parts.join("."), "totp-secret")).toThrow();
  });
});

describe("two-step sign-in", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function enrolled() {
    const user = await makeUser();
    const setup = await beginTwoFactorSetup(user.auth);
    expect(setup.qrSvg).toContain("<svg");
    const { backupCodes } = await confirmTwoFactorSetup(user.auth, codeFor(setup.secret));
    return { user, secret: setup.secret.replace(/\s/g, ""), backupCodes };
  }

  it("is only switched on once the app has produced a correct code", async () => {
    const user = await makeUser();
    const setup = await beginTwoFactorSetup(user.auth);
    await expect(confirmTwoFactorSetup(user.auth, "000000")).rejects.toThrow(/not correct/);
    expect((await getTwoFactorStatus(user.id)).enabled).toBe(false);

    await confirmTwoFactorSetup(user.auth, codeFor(setup.secret));
    const status = await getTwoFactorStatus(user.id);
    expect(status.enabled).toBe(true);
    expect(status.backupCodesLeft).toBe(10);

    // The stored seed is encrypted, not the raw secret.
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { twoFactorSecret: true } });
    expect(row.twoFactorSecret).not.toContain(setup.secret.replace(/\s/g, ""));
  });

  it("makes the password yield only a challenge, and the code the session", async () => {
    const { user, secret } = await enrolled();
    const sessionsBefore = await db.session.count({ where: { userId: user.id } });

    const first = await login({ email: user.email, password: PASSWORD });
    expect(first.kind).toBe("TWO_FACTOR");
    expect(await db.session.count({ where: { userId: user.id } })).toBe(sessionsBefore);
    if (first.kind !== "TWO_FACTOR") return;

    await expect(completeTwoFactorLogin({ challenge: first.challenge, code: "000000" })).rejects.toThrow(/not correct/);
    // The step used during setup cannot be used again; the next one works.
    const code = codeFor(secret, 1);
    const signedIn = await completeTwoFactorLogin({ challenge: first.challenge, code });
    expect(signedIn.id).toBe(user.id);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(sessionsBefore + 1);

    // A challenge works once.
    await expect(completeTwoFactorLogin({ challenge: first.challenge, code })).rejects.toThrow(/expired/);
  });

  it("refuses a code that was already used, even on a fresh challenge", async () => {
    const { user, secret } = await enrolled();
    // Computed once: the same six digits, presented twice.
    const code = codeFor(secret, 1);
    const a = await login({ email: user.email, password: PASSWORD });
    if (a.kind !== "TWO_FACTOR") throw new Error("expected a challenge");
    await completeTwoFactorLogin({ challenge: a.challenge, code });

    const b = await login({ email: user.email, password: PASSWORD });
    if (b.kind !== "TWO_FACTOR") throw new Error("expected a challenge");
    await expect(completeTwoFactorLogin({ challenge: b.challenge, code })).rejects.toThrow(/not correct/);
  });

  it("locks a challenge after five wrong codes", async () => {
    const { user, secret } = await enrolled();
    const result = await login({ email: user.email, password: PASSWORD });
    if (result.kind !== "TWO_FACTOR") throw new Error("expected a challenge");
    for (let i = 0; i < 5; i++) {
      await expect(completeTwoFactorLogin({ challenge: result.challenge, code: "111111" })).rejects.toThrow(/not correct/);
    }
    await expect(completeTwoFactorLogin({ challenge: result.challenge, code: codeFor(secret, 1) })).rejects.toThrow(
      /Too many wrong codes/,
    );
  });

  it("accepts each backup code once", async () => {
    const { user, backupCodes } = await enrolled();
    const a = await login({ email: user.email, password: PASSWORD });
    if (a.kind !== "TWO_FACTOR") throw new Error("expected a challenge");
    await completeTwoFactorLogin({ challenge: a.challenge, code: backupCodes[0]!.toUpperCase() });
    expect((await getTwoFactorStatus(user.id)).backupCodesLeft).toBe(9);

    const b = await login({ email: user.email, password: PASSWORD });
    if (b.kind !== "TWO_FACTOR") throw new Error("expected a challenge");
    await expect(completeTwoFactorLogin({ challenge: b.challenge, code: backupCodes[0]! })).rejects.toThrow(/not correct/);
  });

  it("needs the password and a second factor to turn it off", async () => {
    const { user, secret } = await enrolled();
    await expect(disableTwoFactor(user.auth, "wrong-password", codeFor(secret, 1))).rejects.toThrow(/password is not correct/);
    await expect(disableTwoFactor(user.auth, PASSWORD, "123456")).rejects.toThrow(/code is not correct/);
    await disableTwoFactor(user.auth, PASSWORD, codeFor(secret, 1));
    expect((await getTwoFactorStatus(user.id)).enabled).toBe(false);
    expect(await db.twoFactorBackupCode.count({ where: { userId: user.id } })).toBe(0);

    const result = await login({ email: user.email, password: PASSWORD });
    expect(result.kind).toBe("SIGNED_IN");
  });

  it("replaces backup codes so the old ones stop working", async () => {
    const { user, secret, backupCodes } = await enrolled();
    const { backupCodes: fresh } = await regenerateBackupCodes(user.auth, codeFor(secret, 1));
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toContain(backupCodes[0]);

    const result = await login({ email: user.email, password: PASSWORD });
    if (result.kind !== "TWO_FACTOR") throw new Error("expected a challenge");
    await expect(completeTwoFactorLogin({ challenge: result.challenge, code: backupCodes[0]! })).rejects.toThrow(/not correct/);
    await completeTwoFactorLogin({ challenge: result.challenge, code: fresh[0]! });
  });
});
