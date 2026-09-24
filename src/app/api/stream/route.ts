import { getAuth } from "@/lib/auth/session";
import { assertConversationAccess } from "@/lib/auth/rbac";
import { sseStream } from "@/lib/realtime";

/**
 * Server-Sent Events.
 *
 * Subscribes the caller to their own user channel, plus one conversation
 * channel when a conversation id is given. Access to that conversation is
 * checked here, before the subscription exists — otherwise a stream is a way to
 * read someone else's messages by guessing an id.
 *
 * Runs on the Node runtime because it holds a long-lived connection.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await getAuth();
  if (!auth) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversation");

  const channels = [`user:${auth.user.id}`];

  if (conversationId) {
    try {
      await assertConversationAccess(conversationId, auth);
      channels.push(`conversation:${conversationId}`);
    } catch {
      // Subscribing to the user channel alone is still valid; silently
      // dropping the conversation avoids confirming whether the id exists.
    }
  }

  const stream = sseStream(channels, request.signal);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops nginx buffering the stream into uselessness.
      "X-Accel-Buffering": "no",
    },
  });
}
