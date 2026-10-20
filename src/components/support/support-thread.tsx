"use client";

import { useState } from "react";
import Link from "next/link";
import { Headset, Lock, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Alert, Badge, Card } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/i18n-provider";
import { RichText } from "@/components/i18n/rich-text";

export interface ThreadTicket {
  id: string;
  reference: string;
  subject: string;
  topic: string;
  status: string;
  priority: string;
  createdAt: string | Date;
  lastReplyAt: string | Date;
  messages: {
    id: string;
    authorName: string;
    isStaff: boolean;
    body: string;
    createdAt: string | Date;
  }[];
}

const STATUS_TONE: Record<string, "info" | "warning" | "success" | "neutral"> = {
  OPEN: "info",
  AWAITING_USER: "warning",
  RESOLVED: "success",
  CLOSED: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: "With support",
  AWAITING_USER: "Waiting on you",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

/**
 * The whole ticket surface, including the identity gate.
 *
 * A signed-out visitor proves which mailbox the ticket belongs to by typing
 * the address it was opened with. That address is POSTed, never put in the
 * URL, so it does not end up in browser history, server access logs or a
 * Referer header on the way to an external link.
 */
export function SupportThread({
  reference,
  initialTicket,
  signedIn,
  isStaff = false,
}: {
  reference: string;
  initialTicket: ThreadTicket | null;
  signedIn: boolean;
  isStaff?: boolean;
}) {
  const { t, fmt } = useI18n();
  const [ticket, setTicket] = useState<ThreadTicket | null>(initialTicket);
  // Held in memory only, for the reply call. Never persisted, never in the URL.
  const [email, setEmail] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    setUnlocking(true);
    setGateError(null);
    try {
      const result = await api.post<{ ticket: ThreadTicket }>("/api/support", {
        action: "view",
        reference,
        email,
      });
      setTicket(result.ticket);
    } catch (err) {
      // The server answers the same way for a wrong address and a reference
      // that does not exist, and so does this message.
      setGateError(
        err instanceof ApiError && err.status !== 404
          ? err.message
          : "We could not find a request with that reference and email address.",
      );
    } finally {
      setUnlocking(false);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setReplyError(null);
    try {
      await api.post("/api/support", {
        action: "reply",
        reference,
        body: reply,
        ...(signedIn ? {} : { email }),
      });
      const refreshed = await api.post<{ ticket: ThreadTicket }>("/api/support", {
        action: "view",
        reference,
        ...(signedIn ? {} : { email }),
      });
      setTicket(refreshed.ticket);
      setReply("");
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Could not send that.");
    } finally {
      setSending(false);
    }
  }

  if (!ticket) {
    return (
      <Card className="mx-auto max-w-md p-6">
        <div className="flex items-center gap-2.5">
          <Lock className="size-5 text-brand" aria-hidden />
          <h2 className="font-display text-lg font-semibold text-fg">{t("Confirm it is you")}</h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          <RichText
            text={t("Request {reference}. Enter the email address it was opened with and we will show the thread.")}
            values={{ reference: <span className="font-mono font-medium text-fg">{reference}</span> }}
          />
        </p>

        <form onSubmit={unlock} className="mt-5 space-y-4" noValidate>
          {gateError && <Alert tone="danger">{gateError}</Alert>}
          <Field label={t("Email address")} required>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            )}
          </Field>
          <Button type="submit" fullWidth loading={unlocking} loadingText={t("Checking…")}>
            {t("Show my request")}
          </Button>
        </form>

        <p className="mt-4 text-xs leading-relaxed text-fg-subtle">
          {t("Signing in shows all of your requests without this step.")}
        </p>
      </Card>
    );
  }

  const closed = ticket.status === "CLOSED";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[ticket.status] ?? "neutral"}>
          {t(STATUS_LABEL[ticket.status] ?? ticket.status)}
        </Badge>
        {ticket.priority === "HIGH" || ticket.priority === "URGENT" ? (
          <Badge tone="warning" size="sm">
            {t("Priority")}
          </Badge>
        ) : null}
        <span className="text-xs text-fg-subtle">
          {t("Opened {when}", { when: fmt.relative(new Date(ticket.createdAt)) })}
        </span>
      </div>

      <ol className="mt-5 space-y-3">
        {ticket.messages.map((message) => (
          <li key={message.id}>
            <Card
              as="article"
              className={cn("p-5", message.isStaff && "border-brand/30 bg-brand-soft/30")}
            >
              <div className="flex items-center gap-2">
                {message.isStaff ? (
                  <Headset className="size-4 text-brand" aria-hidden />
                ) : (
                  <MessageSquare className="size-4 text-fg-subtle" aria-hidden />
                )}
                <span className="text-sm font-semibold text-fg">{message.authorName}</span>
                <span className="text-xs text-fg-subtle">
                  {fmt.relative(new Date(message.createdAt))}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-fg-muted">
                {message.body}
              </p>
            </Card>
          </li>
        ))}
      </ol>

      {closed ? (
        <Alert tone="info" className="mt-5">
          <p className="text-sm">
            {t("This request is closed. If it comes back,")}{" "}
            <Link href="/support#contact" className="font-medium text-brand hover:underline">
              {t("open a new one")}
            </Link>{" "}
            {t("and quote {reference}.", { reference: ticket.reference })}
          </p>
        </Alert>
      ) : (
        <form onSubmit={send} className="mt-6 space-y-3">
          {replyError && <Alert tone="danger">{replyError}</Alert>}
          <Field label={t("Add to this request")} trailing={`${reply.length}/4000`}>
            {({ id, invalid }) => (
              <Textarea
                id={id}
                invalid={invalid}
                rows={5}
                maxLength={4000}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={
                  isStaff ? t("Reply to the member…") : t("Anything else that would help us?")
                }
              />
            )}
          </Field>
          <Button type="submit" loading={sending} loadingText={t("Sending…")} disabled={!reply.trim()}>
            {isStaff ? t("Send reply") : t("Send")}
          </Button>
        </form>
      )}
    </div>
  );
}
