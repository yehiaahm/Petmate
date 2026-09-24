"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Scale, Headset, Clock, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Card, Badge, Alert, DataRow } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { formatDateTime, relativeTime, cn } from "@/lib/utils";
import {
  DISPUTE_REASON_LABEL,
  DISPUTE_STATUS_LABEL,
  type DisputeReason,
  type DisputeStatus,
} from "@/lib/constants";

export interface DisputeView {
  id: string;
  reference: string;
  status: string;
  reason: string;
  amountCents: number;
  refundCents: number;
  currency: string;
  resolution: string | null;
  responseDueAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
  isRaiser: boolean;
  orderLabel: string;
  orderHref: string | null;
  counterpartyName: string;
  messages: {
    id: string;
    body: string;
    isStaff: boolean;
    isMine: boolean;
    authorName: string;
    createdAt: string;
  }[];
}

const TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  OPEN: "warning",
  AWAITING_RESPONSE: "warning",
  IN_REVIEW: "info",
  RESOLVED_BUYER: "success",
  RESOLVED_SELLER: "success",
  RESOLVED_SPLIT: "success",
  WITHDRAWN: "neutral",
};

const OPEN_STATUSES = ["OPEN", "AWAITING_RESPONSE", "IN_REVIEW"];

export function DisputeThread({ dispute }: { dispute: DisputeView }) {
  const router = useRouter();
  const toast = useToast();

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const isOpen = OPEN_STATUSES.includes(dispute.status);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    try {
      await api.post("/api/safety", {
        action: "dispute-message",
        disputeId: dispute.id,
        body,
      });
      setBody("");
      toast.success("Added to the case");
      router.refresh();
    } catch (err) {
      toast.error(
        "Could not send that",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[dispute.status] ?? "neutral"}>
          {DISPUTE_STATUS_LABEL[dispute.status as DisputeStatus] ?? dispute.status}
        </Badge>
        <span className="font-mono text-xs text-fg-subtle">{dispute.reference}</span>
      </div>

      <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
        {DISPUTE_REASON_LABEL[dispute.reason as DisputeReason] ?? dispute.reason}
      </h1>
      <p className="mt-1 text-sm text-fg-muted">
        {dispute.orderHref ? (
          <Link href={dispute.orderHref} className="font-medium text-brand hover:underline">
            {dispute.orderLabel}
          </Link>
        ) : (
          dispute.orderLabel
        )}{" "}
        · {dispute.isRaiser ? `against ${dispute.counterpartyName}` : `raised by ${dispute.counterpartyName}`}
      </p>

      {isOpen && (
        <Alert tone="info" className="mt-5" icon={<Lock className="size-4" aria-hidden />}>
          <p>
            {formatMoney(dispute.amountCents, dispute.currency)} is frozen while this is open.
            Nothing moves in either direction until it is decided.
          </p>
        </Alert>
      )}

      {dispute.status === "AWAITING_RESPONSE" && dispute.responseDueAt && (
        <Alert
          tone="warning"
          className="mt-3"
          icon={<Clock className="size-4" aria-hidden />}
          title={dispute.isRaiser ? "Waiting on the other side" : "You need to respond"}
        >
          <p className="mt-1">
            {dispute.isRaiser
              ? `${dispute.counterpartyName} has until ${formatDateTime(dispute.responseDueAt)} to answer. After that our team reviews it either way.`
              : `Add your side by ${formatDateTime(dispute.responseDueAt)}. If you do not, the case is decided on the evidence available.`}
          </p>
        </Alert>
      )}

      {dispute.resolution && (
        <Card className="mt-5 p-5">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            <Scale className="size-4.5 text-brand" aria-hidden />
            Decision
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">{dispute.resolution}</p>
          <dl className="mt-4">
            <DataRow
              label="Refunded to the buyer"
              value={formatMoney(dispute.refundCents, dispute.currency)}
            />
            <DataRow
              label="Decided"
              value={dispute.resolvedAt ? formatDateTime(dispute.resolvedAt) : "—"}
            />
          </dl>
        </Card>
      )}

      <ol className="mt-6 space-y-3">
        {dispute.messages.map((message) => (
          <li key={message.id}>
            <Card
              as="article"
              className={cn(
                "p-5",
                message.isStaff && "border-brand/30 bg-brand-soft/30",
                !message.isStaff && message.isMine && "bg-bg-sunken",
              )}
            >
              <div className="flex items-center gap-2">
                {message.isStaff && <Headset className="size-4 text-brand" aria-hidden />}
                <span className="text-sm font-semibold text-fg">
                  {message.isStaff
                    ? "PetMate review team"
                    : message.isMine
                      ? "You"
                      : message.authorName}
                </span>
                <span className="text-xs text-fg-subtle">
                  {relativeTime(new Date(message.createdAt))}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-fg-muted">
                {message.body}
              </p>
            </Card>
          </li>
        ))}
      </ol>

      {isOpen ? (
        <form onSubmit={send} className="mt-6 space-y-3">
          <Field
            label="Add evidence or context"
            hint="Dates, amounts, what was agreed. Anything you can show beats anything you can assert."
            trailing={`${body.length}/3000`}
          >
            {({ id, invalid }) => (
              <Textarea
                id={id}
                invalid={invalid}
                rows={5}
                maxLength={3000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" loading={sending} loadingText="Sending…" disabled={body.trim().length < 3}>
            Add to the case
          </Button>
        </form>
      ) : (
        <p className="mt-6 text-sm text-fg-muted">
          This case is closed. If circumstances have changed,{" "}
          <Link href="/support?topic=PAYMENT" className="font-medium text-brand hover:underline">
            contact support
          </Link>{" "}
          and quote {dispute.reference}.
        </p>
      )}
    </div>
  );
}
