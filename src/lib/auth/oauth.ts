import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { env, clientEnv } from "@/lib/env";

/**
 * Google and Facebook sign-in (OAuth 2.0 authorization code flow with PKCE).
 *
 * Only the profile needed to find or create the account is requested: an id,
 * the email address and the name. Nothing is posted anywhere, and the access
 * token is used once to read the profile and then dropped.
 */

export const OAUTH_PROVIDERS = ["google", "facebook"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export interface OAuthProfile {
  provider: OAuthProvider;
  id: string;
  email: string | null;
  /** Whether the provider vouches that the person controls this address. */
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
}

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
}

const FACEBOOK_GRAPH = "https://graph.facebook.com/v21.0";

function config(provider: OAuthProvider): ProviderConfig | null {
  const e = env();
  if (provider === "google") {
    if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) return null;
    return {
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
    };
  }
  if (!e.FACEBOOK_APP_ID || !e.FACEBOOK_APP_SECRET) return null;
  return {
    clientId: e.FACEBOOK_APP_ID,
    clientSecret: e.FACEBOOK_APP_SECRET,
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: `${FACEBOOK_GRAPH}/oauth/access_token`,
    scope: "email,public_profile",
  };
}

/** Providers with credentials configured, in the order the buttons appear. */
export function enabledOAuthProviders(): OAuthProvider[] {
  return OAUTH_PROVIDERS.filter((p) => config(p) !== null);
}

export function isOAuthProvider(value: string): value is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

export const redirectUri = (provider: OAuthProvider) =>
  `${clientEnv.NEXT_PUBLIC_APP_URL}/api/auth/oauth/${provider}/callback`;

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(provider: OAuthProvider, params: { state: string; challenge: string }): string {
  const c = config(provider);
  if (!c) throw new Error(`${provider} sign-in is not configured`);
  const query = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: redirectUri(provider),
    response_type: "code",
    scope: c.scope,
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: "S256",
  });
  // Google: always let the person pick the account, rather than silently
  // signing in whichever one the browser happens to be logged in to.
  if (provider === "google") query.set("prompt", "select_account");
  return `${c.authorizeUrl}?${query.toString()}`;
}

async function readJson(response: Response, what: string): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const detail = typeof body.error === "string" ? body.error : JSON.stringify(body.error ?? body).slice(0, 200);
    throw new Error(`${what} failed (${response.status}): ${detail}`);
  }
  return body;
}

/** Trades the one-time code (and the PKCE verifier) for the person's profile. */
export async function fetchOAuthProfile(
  provider: OAuthProvider,
  params: { code: string; verifier: string },
): Promise<OAuthProfile> {
  const c = config(provider);
  if (!c) throw new Error(`${provider} sign-in is not configured`);

  const tokenResponse = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: redirectUri(provider),
      client_id: c.clientId,
      client_secret: c.clientSecret,
      code_verifier: params.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const token = await readJson(tokenResponse, `${provider} token exchange`);
  const accessToken = typeof token.access_token === "string" ? token.access_token : null;
  if (!accessToken) throw new Error(`${provider} returned no access token`);

  if (provider === "google") {
    const info = await readJson(
      await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      }),
      "google userinfo",
    );
    return {
      provider,
      id: String(info.sub ?? ""),
      email: typeof info.email === "string" ? info.email : null,
      emailVerified: info.email_verified === true,
      name: typeof info.name === "string" && info.name.trim() ? info.name.trim() : "PetMate member",
      avatarUrl: typeof info.picture === "string" && info.picture.startsWith("https://") ? info.picture : null,
    };
  }

  // Graph API calls are signed with the app secret so a stolen token cannot
  // be replayed from another app (appsecret_proof).
  const proof = createHmac("sha256", c.clientSecret).update(accessToken).digest("hex");
  const me = await readJson(
    await fetch(
      `${FACEBOOK_GRAPH}/me?${new URLSearchParams({
        fields: "id,name,email,picture.type(large)",
        access_token: accessToken,
        appsecret_proof: proof,
      })}`,
      { signal: AbortSignal.timeout(10_000) },
    ),
    "facebook profile",
  );
  const picture = (me.picture as { data?: { url?: string; is_silhouette?: boolean } } | undefined)?.data;
  return {
    provider,
    id: String(me.id ?? ""),
    email: typeof me.email === "string" ? me.email : null,
    // Facebook only returns an address the person has confirmed with it.
    emailVerified: typeof me.email === "string",
    name: typeof me.name === "string" && me.name.trim() ? me.name.trim() : "PetMate member",
    avatarUrl: picture?.url && !picture.is_silhouette && picture.url.startsWith("https://") ? picture.url : null,
  };
}
