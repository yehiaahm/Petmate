import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clientEnv } from "@/lib/env";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_DAYS, isReferralCode } from "@/lib/services/referral.service";

/**
 * An invite link: /r/CODE. Remembers who sent it for 30 days and goes on to
 * sign-up. An unknown code simply goes to sign-up with nothing remembered.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = raw.toUpperCase();
  const home = clientEnv.NEXT_PUBLIC_APP_URL;
  const response = NextResponse.redirect(new URL("/register?invited=1", home), 302);
  response.headers.set("cache-control", "no-store");

  if (isReferralCode(code) && (await db.user.findUnique({ where: { referralCode: code }, select: { id: true } }))) {
    response.cookies.set(REFERRAL_COOKIE, code, {
      httpOnly: true,
      secure: home.startsWith("https://"),
      sameSite: "lax",
      path: "/",
      maxAge: REFERRAL_COOKIE_DAYS * 86_400,
    });
  }
  return response;
}
