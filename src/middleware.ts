import { NextResponse, type NextRequest } from "next/server";
import { issueCsrfTokenEdge } from "@/lib/auth/csrf-edge";
import { isDisabledModulePath } from "@/lib/features";

/**
 * Middleware.
 *
 * Two jobs: mint a CSRF token for every visitor, and set a per-request
 * Content-Security-Policy nonce.
 *
 * The CSRF token matters for visitors who have never signed in. Registration, sign-in and password reset are all mutating
 * requests made by anonymous users, and login CSRF is a real attack — logging
 * a victim into an attacker's account so their next actions land there. So the
 * answer is to give anonymous visitors a token, not to exempt those routes.
 *
 * The token is HMAC-signed, so a forged cookie fails verification even though
 * the cookie itself is readable by JavaScript (it has to be: the client echoes
 * it in a header, which is the half an attacker on another origin cannot do).
 */
const CSRF_COOKIE = "pm_csrf";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy.
 *
 * Next injects inline bootstrap scripts, so they need either a nonce or
 * 'unsafe-inline'. Production uses the nonce below, which Next reads from the
 * request header and stamps onto every script tag it emits.
 *
 * `strict-dynamic` lets a nonced script load the chunks it needs without every
 * chunk URL being listed. Development keeps 'unsafe-inline' and 'unsafe-eval'
 * because the dev overlay and fast refresh need both, and a policy nobody can
 * develop under is a policy that gets turned off.
 */
function contentSecurityPolicy(nonce: string): string {
  const scriptSrc = isProduction
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `'self' 'unsafe-inline' 'unsafe-eval'`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Tailwind and next/font emit inline styles; there is no nonce path for
    // them, and style injection is a far smaller risk than script injection.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // The app talks to itself. `blob:` covers the assistant's streamed reply.
    "connect-src 'self' blob:",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/**
 * Pages that only make sense signed in. A visitor with no session cookie is sent
 * to sign in and then brought back to the page they actually asked for, rather
 * than always landing on the dashboard. This is a cheap presence check only:
 * the layout still validates the session against the database.
 */
const SIGNED_IN_PREFIXES = [
  "/dashboard",
  "/messages",
  "/notifications",
  "/settings",
  "/assistant",
  "/sell",
  "/checkout",
  "/clinic/",
  "/provider",
  "/store/cart",
  "/admin",
];

function needsSession(pathname: string): boolean {
  return (
    pathname === "/clinic" ||
    SIGNED_IN_PREFIXES.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)))
  );
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // A switched-off module answers exactly like a page that never existed, so
  // the gate runs before the sign-in redirect: otherwise a signed-out visitor
  // to /clinic would learn the route is real by being asked to sign in.
  const disabled = isDisabledModulePath(pathname);
  if (disabled && pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "That page could not be found." } },
      { status: 404 },
    );
  }

  if (!disabled && needsSession(pathname) && !request.cookies.get("pm_session")) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  // 16 random bytes, base64. Regenerated per request: a reused nonce is the
  // same as no nonce at all.
  const nonce = Buffer.from(crypto.randomUUID().replaceAll("-", ""), "hex").toString("base64");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", contentSecurityPolicy(nonce));

  // A rewrite to a path no route matches renders the app's own not-found page
  // with a real 404 status, under the same CSP as every other page.
  const response = disabled
    ? NextResponse.rewrite(new URL("/__module-unavailable", request.url), {
        request: { headers: requestHeaders },
      })
    : NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", contentSecurityPolicy(nonce));

  if (!request.cookies.get(CSRF_COOKIE)) {
    const secret =
      process.env.AUTH_SECRET ?? "dev-only-insecure-secret-change-me-0123456789abcdef";

    response.cookies.set(CSRF_COOKIE, await issueCsrfTokenEdge(secret), {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets, uploaded files and the image optimiser.
     * Those never need a token and matching them would add latency to every
     * image on the page.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|uploads/|robots.txt|sitemap.xml).*)",
  ],
};
