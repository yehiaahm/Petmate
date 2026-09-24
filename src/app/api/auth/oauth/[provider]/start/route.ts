import { NextResponse } from "next/server";
import { enabledOAuthProviders, isOAuthProvider } from "@/lib/auth/oauth";
import { startOAuth, OAUTH_STATE_COOKIE } from "@/lib/services/oauth.service";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isAppError } from "@/lib/errors";
import { clientEnv } from "@/lib/env";

/**
 * Sends the browser to Google or Facebook. A plain GET link, so it works
 * without JavaScript; it changes nothing except a short-lived state record.
 */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const home = clientEnv.NEXT_PUBLIC_APP_URL;
  if (!isOAuthProvider(provider) || !enabledOAuthProviders().includes(provider)) {
    return NextResponse.redirect(new URL("/login", home), 302);
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    await enforceRateLimit("loginPerIp", ip);
  } catch (e) {
    if (isAppError(e)) return NextResponse.redirect(new URL("/login?oauth=expired", home), 302);
    throw e;
  }

  const next = new URL(request.url).searchParams.get("next");
  const { url, state, maxAgeSeconds } = await startOAuth(provider, next);
  const response = NextResponse.redirect(url, 302);
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: home.startsWith("https://"),
    // Lax: the provider's redirect back is a top-level GET, which Lax allows.
    sameSite: "lax",
    path: "/api/auth/oauth",
    maxAge: maxAgeSeconds,
  });
  response.headers.set("cache-control", "no-store");
  return response;
}
