import { z } from "zod";
import { getAuth } from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertCsrf } from "@/lib/auth/session";
import { toAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  buildPetContext,
  careAssistantStream,
  careAssistantFallback,
} from "@/lib/ai/features";
import { aiAvailable } from "@/lib/ai/client";

/**
 * Care assistant.
 *
 * Streams rather than returning a single body, because a grounded answer takes
 * a few seconds and a spinner for that long reads as broken. When AI is not
 * configured the endpoint does not pretend: it returns the deterministic router
 * with `source: "rules"`, and the UI renders it as links rather than as a
 * chat reply.
 *
 * Hand-rolled instead of using `route()` because the success path is a stream.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  question: z.string().min(2).max(2000),
  petId: z.string().min(1).max(64).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      }),
    )
    .max(10)
    .optional(),
});

export async function POST(request: Request) {
  try {
    if (!(await assertCsrf(request))) {
      return Response.json(
        { error: { code: "FORBIDDEN", message: "Your session expired. Refresh and try again." } },
        { status: 403 },
      );
    }

    const auth = await getAuth();
    if (!auth) {
      return Response.json(
        { error: { code: "UNAUTHENTICATED", message: "Please sign in to continue." } },
        { status: 401 },
      );
    }

    await enforceRateLimit("aiAssistant", auth.user.id);

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: { code: "VALIDATION_ERROR", message: "Ask a question between 2 and 2000 characters." } },
        { status: 422 },
      );
    }

    if (!aiAvailable()) {
      const fallback = careAssistantFallback(parsed.data.question);
      return Response.json({ source: "rules", ...fallback });
    }

    // Grounding is scoped to a pet the caller actually owns.
    const petContext = parsed.data.petId
      ? await buildPetContext(parsed.data.petId, auth.user.id)
      : null;

    const stream = await careAssistantStream({
      question: parsed.data.question,
      petContext,
      history: parsed.data.history ?? [],
    });

    if (!stream) {
      const fallback = careAssistantFallback(parsed.data.question);
      return Response.json({ source: "rules", ...fallback });
    }

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-PetMate-Source": "ai",
      },
    });
  } catch (error) {
    const appError = toAppError(error);
    if (appError.status >= 500) logger.exception("assistant failed", error);
    return Response.json(appError.toJSON(), { status: appError.status });
  }
}
