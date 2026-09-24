"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LifeBuoy, Send, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Badge, EmptyState } from "@/components/ui/primitives";
import { Field, Textarea, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { relativeTime } from "@/lib/utils";
import { SUPPORT_TOPIC_LABEL, type SupportTopic } from "@/lib/support-topics";

export interface QueueTicket {
  id: string;
  reference: string;
  subject: string;
  topic: string;
  status: string;
  priority: string;
  name: string;
  email: string;
  hasAccount: boolean;
  messageCount: number;
  createdAt: string;
  lastReplyAt: string;
}

const STATUS_TONE: Record<string, "info" | "warning" | "success" | "neutral"> = {
  OPEN: "info",
  AWAITING_USER: "warning",
  RESOLVED: "success",
  CLOSED: "neutral",
};

export function SupportQueue({ tickets }: { tickets: QueueTicket[] }) {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function act(key: string, body: unknown, title: string) {
    setBusy(key);
    try {
      await api.post("/api/admin", body);
      toast.success(title);
      router.refresh();
      return true;
    } catch (err) {
      toast.error(
        "That did not go through",
        err instanceof ApiError ? err.message : "Please try again.",
      );
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (tickets.length === 0) {
    return (
      <EmptyState
        icon={<LifeBuoy className="size-5" aria-hidden />}
        title="The queue is empty"
        description="Every open ticket has been answered. Resolved and closed ones stay searchable but are not listed here."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[ticket.status] ?? "neutral"} size="sm">
                    {ticket.status.replaceAll("_", " ").toLowerCase()}
                  </Badge>
                  {(ticket.priority === "HIGH" || ticket.priority === "URGENT") && (
                    <Badge tone="danger" size="sm">
                      {ticket.priority.toLowerCase()}
                    </Badge>
                  )}
                  <span className="font-mono text-xs text-fg-subtle">{ticket.reference}</span>
                </div>

                <h3 className="mt-1.5 text-[15px] font-medium text-fg">{ticket.subject}</h3>
                <p className="mt-0.5 text-sm text-fg-muted">
                  {SUPPORT_TOPIC_LABEL[ticket.topic as SupportTopic] ?? ticket.topic}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
                  <span>{ticket.name}</span>
                  <span>·</span>
                  <span>{ticket.email}</span>
                  {ticket.hasAccount && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <UserCheck className="size-3" aria-hidden />
                        has an account
                      </span>
                    </>
                  )}
                  <span>·</span>
                  <span>
                    {ticket.messageCount} message{ticket.messageCount === 1 ? "" : "s"}
                  </span>
                  <span>·</span>
                  <span>updated {relativeTime(new Date(ticket.lastReplyAt))}</span>
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <Link
                  href={`/support/${ticket.reference}`}
                  className="text-sm font-medium text-brand hover:underline"
                >
                  Read
                </Link>
                {open !== ticket.id && (
                  <Button size="sm" variant="outline" onClick={() => setOpen(ticket.id)}>
                    Reply
                  </Button>
                )}
              </div>
            </div>

            {open === ticket.id && (
              <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                <Field
                  label="Reply"
                  required
                  hint="This is emailed to them verbatim and appears in the thread signed as PetMate Support."
                >
                  {({ id, invalid }) => (
                    <Textarea
                      id={id}
                      invalid={invalid}
                      rows={5}
                      maxLength={4000}
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                    />
                  )}
                </Field>

                <div className="flex flex-wrap items-end gap-3">
                  <Button
                    size="sm"
                    loading={busy === `reply:${ticket.id}`}
                    disabled={reply.trim().length < 2}
                    onClick={async () => {
                      const ok = await act(
                        `reply:${ticket.id}`,
                        {
                          action: "support-reply",
                          reference: ticket.reference,
                          body: reply,
                        },
                        "Reply sent",
                      );
                      if (ok) {
                        setReply("");
                        setOpen(null);
                      }
                    }}
                  >
                    <Send className="size-4" aria-hidden />
                    Send reply
                  </Button>

                  <div className="w-48">
                    <Field label="Set status">
                      {({ id }) => (
                        <Select
                          id={id}
                          value={ticket.status}
                          onChange={(e) =>
                            act(
                              `status:${ticket.id}`,
                              {
                                action: "support-status",
                                reference: ticket.reference,
                                status: e.target.value,
                              },
                              "Status updated",
                            )
                          }
                        >
                          <option value="OPEN">With support</option>
                          <option value="AWAITING_USER">Waiting on them</option>
                          <option value="RESOLVED">Resolved</option>
                          <option value="CLOSED">Closed</option>
                        </Select>
                      )}
                    </Field>
                  </div>

                  <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}
