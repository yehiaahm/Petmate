/**
 * CSRF token minting for the Edge runtime.
 *
 * Middleware cannot use `node:crypto`, so this produces the same
 * `raw.signature` shape with Web Crypto. The two implementations must agree
 * byte for byte, which is what `csrf.test.ts` checks.
 */

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function issueCsrfTokenEdge(secret: string): Promise<string> {
  const raw = base64url(crypto.getRandomValues(new Uint8Array(24)));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return `${raw}.${base64url(new Uint8Array(signature))}`;
}
