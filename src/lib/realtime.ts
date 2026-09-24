import "server-only";
import { logger } from "@/lib/logger";

/**
 * Realtime delivery over Server-Sent Events.
 *
 * SSE rather than WebSockets: the traffic here is one-directional (the server
 * pushes, the client posts over normal HTTP), it survives proxies that break
 * WebSocket upgrades, and it reconnects on its own. No extra infrastructure.
 *
 * SCALING NOTE: this registry lives in one process. With several instances a
 * subscriber only receives events published by the instance it is connected to,
 * so `publish` must become a Redis pub/sub fan-out before running more than one
 * node. That is the only change needed — the API here stays the same. Clients
 * also poll as a fallback, so the product degrades to "a few seconds late"
 * rather than "broken" if this is not wired up. See docs/ARCHITECTURE.md.
 */

type Subscriber = (event: unknown) => void;

const channels = new Map<string, Set<Subscriber>>();

export function subscribe(channel: string, subscriber: Subscriber): () => void {
  let set = channels.get(channel);
  if (!set) {
    set = new Set();
    channels.set(channel, set);
  }
  set.add(subscriber);

  return () => {
    set.delete(subscriber);
    if (set.size === 0) channels.delete(channel);
  };
}

export function publish(channel: string, event: unknown): void {
  const set = channels.get(channel);
  if (!set?.size) return;

  for (const subscriber of set) {
    try {
      subscriber(event);
    } catch (e) {
      logger.exception("realtime subscriber failed", e, { channel });
    }
  }
}

export function channelStats() {
  return {
    channels: channels.size,
    subscribers: [...channels.values()].reduce((sum, s) => sum + s.size, 0),
  };
}

/** Builds the SSE stream for a set of channels. */
export function sseStream(channelNames: string[], signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      const send = (data: unknown, eventName = "message") => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // The client went away between the check and the write.
        }
      };

      send({ ok: true, channels: channelNames }, "ready");

      const unsubscribers = channelNames.map((name) => subscribe(name, (event) => send(event)));

      // Proxies and load balancers close an idle connection; a comment every
      // 25 seconds keeps it open without producing a client-visible event.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        for (const off of unsubscribers) off();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      signal.addEventListener("abort", cleanup, { once: true });
    },
  });
}
