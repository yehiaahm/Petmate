import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { issueCsrfTokenEdge } from "@/lib/auth/csrf-edge";
import { verifyCsrfToken, issueCsrfToken } from "@/lib/auth/session";

/**
 * The Edge and Node implementations must agree.
 *
 * Middleware mints tokens with Web Crypto; the API verifies them with
 * `node:crypto`. If those two ever disagree on encoding, every mutating
 * request in the product fails with "your session expired" — and nothing in
 * the type system would catch it.
 */
describe("CSRF tokens", () => {
  const secret = process.env.AUTH_SECRET!;

  it("verifies a token minted by the Edge implementation", async () => {
    const token = await issueCsrfTokenEdge(secret);
    expect(verifyCsrfToken(token)).toBe(true);
  });

  it("verifies a token minted by the Node implementation", () => {
    expect(verifyCsrfToken(issueCsrfToken())).toBe(true);
  });

  it("produces identical signatures for the same input", async () => {
    const edge = await issueCsrfTokenEdge(secret);
    const [raw, edgeSignature] = edge.split(".");

    const nodeSignature = createHmac("sha256", secret).update(raw!).digest("base64url");
    expect(edgeSignature).toBe(nodeSignature);
  });

  it("rejects a forged or altered token", () => {
    expect(verifyCsrfToken("not-a-token")).toBe(false);
    expect(verifyCsrfToken("")).toBe(false);
    expect(verifyCsrfToken(null)).toBe(false);
    expect(verifyCsrfToken("raw.signature")).toBe(false);

    // A valid token with a tampered payload must fail.
    const valid = issueCsrfToken();
    const [, signature] = valid.split(".");
    expect(verifyCsrfToken(`tampered.${signature}`)).toBe(false);
  });
});
