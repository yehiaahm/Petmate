"use client";

import { useEffect, useRef, useState } from "react";
import { Send, AlertTriangle, Loader2 } from "lucide-react";
import { Avatar } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { relativeTime, cn } from "@/lib/utils";
import { LIMITS } from "@/lib/constants";

interface ThreadMessage {
  id: string;
  body: string;
  senderId: string | null;
  senderName: string | null;
  senderAvatar: string | null;
  systemType: string | null;
  createdAt: string;
  flagged: boolean;
  flagReason: string | null;
}

/**
 * The message thread.
 *
 * Live over Server-Sent Events, with a polling fallback: if the stream drops —
 * a proxy, a sleeping laptop, a scaled-out deployment without shared pub/sub —
 * messages still arrive a few seconds late rather than not at all.
 *
 * Message bodies are rendered as text, never as HTML, so a pasted `<script>`
 * is just characters on screen.
 */
export function MessageThread({
  conversationId,
  viewerId,
  initialMessages,
  disabled,
  counterpartyName,
}: {
  conversationId: string;
  viewerId: string;
  initialMessages: ThreadMessage[];
  disabled?: boolean;
  counterpartyName: string;
}) {
  const toast = useToast();

  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef(new Set(initialMessages.map((m) => m.id)));

  function append(message: ThreadMessage) {
    if (seenIds.current.has(message.id)) return;
    seenIds.current.add(message.id);
    setMessages((current) => [...current, message]);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  // Live stream.
  useEffect(() => {
    const source = new EventSource(`/api/stream?conversation=${conversationId}`);

    source.addEventListener("ready", () => setLive(true));

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          type: string;
          message?: {
            id: string;
            body: string;
            senderId: string | null;
            systemType?: string | null;
            createdAt: string;
            flagged?: boolean;
          };
        };

        if (payload.type === "message" && payload.message) {
          append({
            id: payload.message.id,
            body: payload.message.body,
            senderId: payload.message.senderId,
            senderName: null,
            senderAvatar: null,
            systemType: payload.message.systemType ?? null,
            createdAt: payload.message.createdAt,
            flagged: payload.message.flagged ?? false,
            flagReason: null,
          });
        }
      } catch {
        // A malformed frame is not worth breaking the thread over.
      }
    };

    source.onerror = () => setLive(false);

    return () => source.close();
  }, [conversationId]);

  // Fallback poll. Runs only while the stream is down.
  useEffect(() => {
    if (live) return;

    const timer = setInterval(async () => {
      try {
        const result = await api.get<{ messages: ThreadMessage[] }>(
          `/api/conversations?id=${conversationId}&limit=30`,
        );
        for (const message of result.messages ?? []) {
          append({
            ...message,
            createdAt: String(message.createdAt),
          });
        }
      } catch {
        // Offline; the next tick tries again.
      }
    }, 8000);

    return () => clearInterval(timer);
  }, [live, conversationId]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text || sending) return;

    setSending(true);

    try {
      const result = await api.post<{ message: ThreadMessage }>("/api/conversations", {
        action: "send",
        message: { conversationId, body: text },
      });

      append({
        ...result.message,
        senderName: null,
        senderAvatar: null,
        systemType: null,
        flagReason: null,
        createdAt: String(result.message.createdAt),
      });
      setBody("");
    } catch (err) {
      toast.error(
        "Message not sent",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div
        className="max-h-[60dvh] min-h-64 overflow-y-auto p-4"
        role="log"
        aria-live="polite"
        aria-label="Conversation"
      >
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-fg-muted">
            No messages yet. Say hello to {counterpartyName}.
          </p>
        ) : (
          <ul className="space-y-3">
            {messages.map((message) => {
              if (message.systemType) {
                return (
                  <li key={message.id} className="flex justify-center">
                    <span className="rounded-full bg-bg-sunken px-3 py-1.5 text-center text-xs text-fg-muted">
                      {message.body}
                    </span>
                  </li>
                );
              }

              const mine = message.senderId === viewerId;

              return (
                <li key={message.id} className={cn("flex gap-2", mine && "flex-row-reverse")}>
                  {!mine && (
                    <Avatar
                      src={message.senderAvatar}
                      name={message.senderName ?? counterpartyName}
                      size="xs"
                      className="mt-1"
                    />
                  )}

                  <div className={cn("max-w-[78%] min-w-0", mine && "items-end")}>
                    <div
                      className={cn(
                        "rounded-2xl px-3.5 py-2.5",
                        mine
                          ? "rounded-ee-sm bg-brand text-brand-fg"
                          : "rounded-es-sm bg-bg-sunken text-fg",
                      )}
                    >
                      {/* Rendered as text. Never dangerouslySetInnerHTML here. */}
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {message.body}
                      </p>
                    </div>

                    <p
                      className={cn(
                        "mt-1 px-1 text-[11px] text-fg-subtle",
                        mine && "text-end",
                      )}
                    >
                      {relativeTime(message.createdAt)}
                    </p>

                    {message.flagged && (
                      <p className="mt-1 flex items-start gap-1.5 rounded-[var(--radius-field)] bg-[var(--warning-soft)] px-2.5 py-1.5 text-[11px] text-[var(--warning)]">
                        <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
                        This message mentions paying outside PetMate. Escrow and dispute cover only
                        work for payments made here.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="border-t border-[var(--border)] p-3">
        <div className="flex items-end gap-2">
          <label htmlFor="message-body" className="sr-only">
            Message
          </label>
          <textarea
            id="message-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter makes a new line.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(e as unknown as React.FormEvent);
              }
            }}
            rows={1}
            maxLength={LIMITS.messageMax}
            disabled={disabled || sending}
            placeholder={disabled ? "You have blocked this member" : "Write a message…"}
            className="max-h-32 min-h-11 flex-1 resize-none rounded-[var(--radius-field)] border border-[var(--border-strong)] bg-bg-elevated px-3.5 py-2.5 text-[15px] text-fg placeholder:text-fg-subtle focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={disabled || sending || !body.trim()}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-field)] bg-brand text-brand-fg transition-colors hover:bg-brand-hover disabled:opacity-40"
            aria-label="Send message"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="rtl:-scale-x-100 size-4" aria-hidden />
            )}
          </button>
        </div>

        <p className="mt-1.5 px-1 text-[11px] text-fg-subtle">
          {live ? "Live" : "Reconnecting…"} · Enter to send, Shift+Enter for a new line
        </p>
      </form>
    </>
  );
}
