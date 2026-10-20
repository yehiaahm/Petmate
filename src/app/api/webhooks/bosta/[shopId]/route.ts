import { NextResponse } from "next/server";
import { applyCarrierState, authenticateBostaWebhook } from "@/lib/services/carrier.service";
import { logger } from "@/lib/logger";

/**
 * Bosta status updates for one shop's parcels.
 *
 * Not wrapped in `route()`: there is no session or CSRF token. It is
 * authenticated by the secret the shop pasted into Bosta's webhook settings,
 * which Bosta sends back in the Authorization header. Unknown parcels return
 * 200, so Bosta does not keep retrying something we will never recognise.
 */
export async function POST(request: Request, { params }: { params: Promise<{ shopId: string }> }) {
  const { shopId } = await params;
  if (!/^[a-z0-9]{20,32}$/.test(shopId)) return NextResponse.json({ ok: false }, { status: 404 });

  if (!(await authenticateBostaWebhook(shopId, request.headers.get("authorization")))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const tracking = body?.trackingNumber != null ? String(body.trackingNumber) : null;
  if (!body || !tracking) return NextResponse.json({ ok: false }, { status: 400 });

  const state = (body.state ?? {}) as Record<string, unknown> | number;
  const code = typeof state === "number" ? state : ((state.code as number | undefined) ?? (body.stateCode as number | undefined) ?? null);
  const label = typeof state === "object" ? ((state.value as string | undefined) ?? null) : null;

  try {
    const result = await applyCarrierState({
      shopId,
      trackingNumber: tracking,
      stateCode: code,
      stateLabel: label,
      reason: typeof body.exceptionReason === "string" ? body.exceptionReason : null,
    });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    logger.exception("bosta webhook failed", e, { shopId, tracking });
    // A 500 makes Bosta retry, which is what we want for our own failure.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
