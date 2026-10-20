import { NextResponse } from "next/server";
import { recordClick } from "@/lib/services/ad.service";
import { adVisitorKey } from "@/lib/ads/visitor";
import { clientEnv } from "@/lib/env";

/**
 * Where an ad's link points. Counting happens here, then the visitor is sent
 * on to the destination the campaign was approved with; nothing in the
 * request decides where they go, so this cannot be used as an open redirect.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const destination = /^[a-z0-9]{20,32}$/.test(id) ? await recordClick(id, adVisitorKey(request, ip)) : null;
  const target = destination
    ? destination.startsWith("/")
      ? new URL(destination, clientEnv.NEXT_PUBLIC_APP_URL)
      : new URL(destination)
    : new URL("/", clientEnv.NEXT_PUBLIC_APP_URL);
  const response = NextResponse.redirect(target, 302);
  response.headers.set("cache-control", "no-store");
  // The destination is someone else's site: do not tell it which page linked there.
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}
