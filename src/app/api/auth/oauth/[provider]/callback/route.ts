import { NextResponse } from "next/server";
import { isOAuthProvider } from "@/lib/auth/oauth";
import { completeOAuth, OAuthError, OAUTH_STATE_COOKIE } from "@/lib/services/oauth.service";
import { logger } from "@/lib/logger";
import { clientEnv } from "@/lib/env";

/**
 * Where Google or Facebook sends the browser back. Failures go to the sign-in
 * page as a fixed code, never as text from the request, so a crafted link
 * cannot put words on our page.
 */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const home = clientEnv.NEXT_PUBLIC_APP_URL;
  const url = new URL(request.url);

  const back = (target: string) => {
    const response = NextResponse.redirect(new URL(target, home), 302);
    response.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/api/auth/oauth", maxAge: 0 });
    response.headers.set("cache-control", "no-store");
    return response;
  };

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // The person pressed "cancel" on the provider's screen.
  if (!isOAuthProvider(provider) || !code || !state) return back("/login?oauth=cancelled");

  const cookieState = /(?:^|;\s*)pm_oauth_state=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1] ?? null;

  try {
    const result = await completeOAuth({
      provider,
      code,
      state,
      cookieState: cookieState ? decodeURIComponent(cookieState) : null,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: request.headers.get("user-agent"),
    });
    if (result.kind === "TWO_FACTOR") {
      return back(`/login?next=${encodeURIComponent(result.next)}&tf=${encodeURIComponent(result.challenge)}`);
    }
    return back(result.next);
  } catch (e) {
    if (e instanceof OAuthError) return back(`/login?oauth=${e.code}`);
    logger.exception("oauth callback failed", e, { provider });
    return back("/login?oauth=provider");
  }
}
