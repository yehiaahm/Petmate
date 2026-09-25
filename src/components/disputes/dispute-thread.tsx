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
import { cn } from "@/lib/utils";
import {
  DISPUTE_REASON_LABEL,
  DISPUTE_STATUS_LABEL,
  type DisputeReason,
  type DisputeStatus,
} from "@/lib/constants";
import { useI18n } from "@/components/i18n/i18n-provider";

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
  const { t, fmt } = useI18n();
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
      toast.success(t("Added to the case"));
      router.refresh();
    } catch (err) {
      toast.error(
        t("Could not send that"),
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
          {t(DISPUTE_STATUS_LABEL[dispute.status as DisputeStatus] ?? dispute.status)}
        </Badge>
        <span className="font-mono text-xs text-fg-subtle">{dispute.reference}</span>
      </div>

      <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
        {t(DISPUTE_REASON_LABEL[dispute.reason as DisputeReason] ?? dispute.reason)}
      </h1>
      <p className="mt-1 text-sm text-fg-muted">
        {dispute.orderHref ? (
          <Link href={dispute.orderHref} className="font-medium text-brand hover:underline">
            {dispute.orderLabel}
          </Link>
        ) : (
          dispute.orderLabel
        )}{" "}
        · {dispute.isRaiser ? t("against {name}", { name: dispute.counterpartyName }) : t("raised by {name}", { name: dispute.counterpartyName })}
      </p>

      {isOpen && (
        <Alert tone="info" className="mt-5" icon={<Lock className="size-4" aria-hidden />}>
          <p>
            {t("{amount} is frozen while this is open. Nothing moves in either direction until it is decided.", { amount: fmt.money(dispute.amountCents, dispute.currency) })}
          </p>
        </Alert>
      )}

      {dispute.status === "AWAITING_RESPONSE" && dispute.responseDueAt && (
        <Alert
          tone="warning"
          className="mt-3"
          icon={<Clock className="size-4" aria-hidden />}
          title={dispute.isRaiser ? t("Waiting on the other side") : t("You need to respond")}
        >
          <p className="mt-1">
            {dispute.isRaiser
              ? t("{name} has until {when} to answer. After that our team reviews it either way.", { name: dispute.counterpartyName, when: fmt.dateTime(dispute.responseDueAt) })
              : t("Add your side by {when}. If you do not, the case is decided on the evidence available.", { when: fmt.dateTime(dispute.responseDueAt) })}
          </p>
        </Alert>
      )}

      {dispute.resolution && (
        <Card className="mt-5 p-5">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            <Scale className="size-4.5 text-brand" aria-hidden />
            {t("Decision")}
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">{dispute.resolution}</p>
          <dl className="mt-4">
            <DataRow
              label={t("Refunded to the buyer")}
              value={fmt.money(dispute.refundCents, dispute.currency)}
            />
            <DataRow
              label={t("Decided")}
              value={dispute.resolvedAt ? fmt.dateTime(dispute.resolvedAt) : "—"}
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
                    ? t("PetMate review team")
                    : message.isMine
                      ? t("You")
                      : message.authorName}
                </span>
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

      {isOpen ? (
        <form onSubmit={send} className="mt-6 space-y-3">
          <Field
            label={t("Add evidence or context")}
            hint={t("Dates, amounts, what was agreed. Anything you can show beats anything you can assert.")}
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
          <Button type="submit" loading={sending} loadingText={t("Sending…")} disabled={body.trim().length < 3}>
            {t("Add to the case")}
          </Button>
        </form>
      ) : (
        <p className="mt-6 text-sm text-fg-muted">
          {t("This case is closed. If circumstances have changed,")}{" "}
          <Link href="/support?topic=PAYMENT" className="font-medium text-brand hover:underline">
            {t("contact support")}
          </Link>{" "}
          {t("and quote {reference}.", { reference: dispute.reference })}
        </p>
      )}
    </div>
  );
}
