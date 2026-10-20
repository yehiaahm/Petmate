import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));

import { db, makeUser, resetDatabase } from "./helpers";
import { resetEnvForTests } from "@/lib/env";
import { authorizeUrl, enabledOAuthProviders, pkcePair } from "@/lib/auth/oauth";
import { startOAuth, completeOAuth, OAuthError } from "@/lib/services/oauth.service";
import { verifyPassword } from "@/lib/auth/password";
import { beginTwoFactorSetup, confirmTwoFactorSetup } from "@/lib/services/two-factor.service";
import { hotp, totpCounter } from "@/lib/auth/totp";
import { createHash } from "node:crypto";

/**
 * Social sign-in is tested against a fake provider: the token and profile
 * endpoints are stubbed, and everything on our side (state, PKCE, matching and
 * linking accounts) runs for real.
 */

const saved = { ...process.env };

function fakeProvider(profile: Record<string, unknown>) {
  const calls: { url: string; body?: string }[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, body: init?.body ? String(init.body) : undefined });
    if (href.includes("/token") || href.includes("oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "provider-access-token", token_type: "Bearer" }), { status: 200 });
    }
    return new Response(JSON.stringify(profile), { status: 200 });
  });
  return calls;
}

async function runFlow(provider: "google" | "facebook", profile: Record<string, unknown>, next = "/dashboard/pets") {
  const calls = fakeProvider(profile);
  const started = await startOAuth(provider, next);
  const result = await completeOAuth({ provider, code: "auth-code", state: started.state, cookieState: started.state });
  return { result, calls, started };
}

beforeEach(async () => {
  process.env.GOOGLE_CLIENT_ID = "google-client";
  process.env.GOOGLE_CLIENT_SECRET = "google-secret";
  process.env.FACEBOOK_APP_ID = "fb-app";
  process.env.FACEBOOK_APP_SECRET = "fb-secret";
  resetEnvForTests();
  await resetDatabase();
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...saved };
  resetEnvForTests();
});

describe("provider setup", () => {
  it("shows only providers with credentials", () => {
    expect(enabledOAuthProviders()).toEqual(["google", "facebook"]);
    delete process.env.FACEBOOK_APP_SECRET;
    resetEnvForTests();
    expect(enabledOAuthProviders()).toEqual(["google"]);
  });

  it("sends a PKCE challenge, never the verifier", () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    const url = new URL(authorizeUrl("google", { state: "s", challenge }));
    expect(url.searchParams.get("code_challenge")).toBe(challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.toString()).not.toContain(verifier);
    expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/auth\/oauth\/google\/callback$/);
  });
});

describe("state", () => {
  it("only completes in the browser that started it, once", async () => {
    fakeProvider({ sub: "g-1", email: "a@example.com", email_verified: true, name: "A" });
    const started = await startOAuth("google", null);
    await expect(
      completeOAuth({ provider: "google", code: "c", state: started.state, cookieState: "someone-elses-state-value!" }),
    ).rejects.toThrow(OAuthError);
    await expect(completeOAuth({ provider: "google", code: "c", state: started.state, cookieState: null })).rejects.toThrow(
      OAuthError,
    );

    const ok = await startOAuth("google", null);
    await completeOAuth({ provider: "google", code: "c", state: ok.state, cookieState: ok.state });
    await expect(completeOAuth({ provider: "google", code: "c", state: ok.state, cookieState: ok.state })).rejects.toThrow(
      OAuthError,
    );
  });

  it("will not accept a Google state on the Facebook callback", async () => {
    fakeProvider({ id: "f-1", email: "a@example.com", name: "A" });
    const started = await startOAuth("google", null);
    await expect(completeOAuth({ provider: "facebook", code: "c", state: started.state, cookieState: started.state })).rejects.toThrow(
      OAuthError,
    );
  });

  it("keeps where the person was going, but only inside PetMate", async () => {
    const { result } = await runFlow("google", { sub: "g-2", email: "b@example.com", email_verified: true, name: "B" }, "/store");
    expect(result.next).toBe("/store");
    const evil = await runFlow("google", { sub: "g-3", email: "c@example.com", email_verified: true, name: "C" }, "https://evil.example");
    expect(evil.result.next).toBe("/dashboard");
  });
});

describe("accounts", () => {
  it("creates a confirmed account on first sign-in and reuses it after", async () => {
    const { result, calls } = await runFlow("google", {
      sub: "g-100",
      email: "Nour.Adel@Example.com",
      email_verified: true,
      name: "Nour Adel",
      picture: "https://lh3.example/photo.jpg",
    });
    expect(result).toMatchObject({ kind: "SIGNED_IN", created: true });
    // The PKCE verifier went to the token endpoint, from the server.
    expect(calls[0]!.body).toContain("code_verifier=");

    const user = await db.user.findUniqueOrThrow({ where: { emailNormalized: "nour.adel@example.com" } });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.avatarUrl).toBe("https://lh3.example/photo.jpg");

    const again = await runFlow("google", { sub: "g-100", email: "nour.adel@example.com", email_verified: true, name: "Nour" });
    expect(again.result).toMatchObject({ kind: "SIGNED_IN", created: false });
    expect(await db.user.count()).toBe(1);
  });

  it("links to an existing confirmed account and keeps its password", async () => {
    const existing = await makeUser();
    const { result } = await runFlow("facebook", { id: "fb-9", email: existing.email, name: "Someone" });
    expect(result).toMatchObject({ kind: "SIGNED_IN", created: false });
    const row = await db.user.findUniqueOrThrow({ where: { id: existing.id }, select: { passwordHash: true } });
    expect(await verifyPassword("TestPassword123!", row.passwordHash)).toBe(true);
    expect(await db.oAuthAccount.count({ where: { userId: existing.id, provider: "FACEBOOK" } })).toBe(1);
  });

  it("takes back an unconfirmed account from whoever registered it", async () => {
    // Someone registered with an address they do not own and never confirmed it.
    const squatter = await makeUser({ emailVerified: false });
    await db.session.create({
      data: { userId: squatter.id, tokenHash: "squatter-session", expiresAt: new Date(Date.now() + 86_400_000) },
    });

    await runFlow("google", { sub: "g-owner", email: squatter.email, email_verified: true, name: "Real Owner" });

    const row = await db.user.findUniqueOrThrow({ where: { id: squatter.id }, select: { passwordHash: true, emailVerifiedAt: true } });
    expect(row.emailVerifiedAt).not.toBeNull();
    expect(await verifyPassword("TestPassword123!", row.passwordHash)).toBe(false);
    const old = await db.session.findUniqueOrThrow({ where: { tokenHash: "squatter-session" } });
    expect(old.revokedAt).not.toBeNull();
  });

  it("refuses a provider address that is not confirmed", async () => {
    const existing = await makeUser();
    await expect(
      runFlow("google", { sub: "g-x", email: existing.email, email_verified: false, name: "X" }),
    ).rejects.toMatchObject({ code: "no-email" });
    await expect(runFlow("facebook", { id: "fb-noemail", name: "No Email" })).rejects.toMatchObject({ code: "no-email" });
    expect(await db.oAuthAccount.count()).toBe(0);
  });

  it("does not sign in a closed account", async () => {
    const banned = await makeUser({ status: "BANNED" });
    await expect(runFlow("google", { sub: "g-b", email: banned.email, email_verified: true, name: "B" })).rejects.toMatchObject({
      code: "closed",
    });
  });

  it("still asks for the second factor", async () => {
    const user = await makeUser();
    const setup = await beginTwoFactorSetup(user.auth);
    await confirmTwoFactorSetup(user.auth, hotp(setup.secret.replace(/\s/g, ""), totpCounter()));

    const { result } = await runFlow("google", { sub: "g-2fa", email: user.email, email_verified: true, name: "U" });
    expect(result.kind).toBe("TWO_FACTOR");
    const sessions = await db.session.count({ where: { userId: user.id } });
    expect(sessions).toBe(0);
  });
});
