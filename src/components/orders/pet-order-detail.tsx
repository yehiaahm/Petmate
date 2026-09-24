"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Lock,
  CheckCircle2,
  Circle,
  MessageSquare,
  Scale,
  XCircle,
  ShieldAlert,
} from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, Badge, Avatar, Alert, DataRow } from "@/components/ui/primitives";
import { Field, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { formatDateTime, relativeTime } from "@/lib/utils";

export interface PetOrderView {
  id: string;
  orderNumber: string;
  status: string;
  amountCents: number;
  currency: string;
  platformFeeCents: number;
  sellerPayoutCents: number;
  buyerConfirmedAt: string | null;
  sellerConfirmedAt: string | null;
  autoReleaseAt: string | null;
  escrowReleasedAt: string | null;
  createdAt: string;
  meetingNote: string | null;
  isBuyer: boolean;
  iConfirmed: boolean;
  theyConfirmed: boolean;
  escrowWindowHours: number;
  listing: {
    slug: string;
    title: string;
    city: string | null;
    country: string | null;
    pet: {
      id: string;
      name: string;
      passportNo: string;
      breedName: string | null;
      photoUrl: string | null;
    };
    seller: {
      id: string;
      name: string;
      handle: string;
      avatarUrl: string | null;
      trustScore: number;
    };
  };
  counterparty: {
    name: string;
    handle: string;
    avatarUrl: string | null;
    trustScore: number;
  };
}

const STATUS_TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  PENDING_PAYMENT: "warning",
  IN_ESCROW: "info",
  HANDOVER_PENDING: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
  REFUNDED: "neutral",
  DISPUTED: "danger",
};

export function PetOrderDetail({ order }: { order: PetOrderView }) {
  const router = useRouter();
  const toast = useToast();

  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [working, setWorking] = useState(false);

  const canConfirm =
    ["IN_ESCROW", "HANDOVER_PENDING"].includes(order.status) && !order.iConfirmed;
  const canCancel = ["PENDING_PAYMENT", "IN_ESCROW", "HANDOVER_PENDING"].includes(order.status);
  const canDispute = ["IN_ESCROW", "HANDOVER_PENDING", "COMPLETED"].includes(order.status);

  async function confirm() {
    setWorking(true);
    try {
      const result = await api.post<{ bothConfirmed: boolean; message: string }>("/api/orders", {
        action: "confirm-handover",
        petOrderId: order.id,
        note: note.trim() || undefined,
      });
      toast.success(result.bothConfirmed ? "Escrow released" : "Confirmed", result.message);
      setConfirming(false);
      router.refresh();
    } catch (err) {
      toast.error(
        "Could not confirm",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function cancel() {
    setWorking(true);
    try {
      await api.post("/api/orders", {
        action: "cancel",
        petOrderId: order.id,
        reason: cancelReason,
      });
      toast.success("Cancelled", "Any money held in escrow is on its way back.");
      setCancelOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(
        "Could not cancel",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function message() {
    setWorking(true);
    try {
      const { conversationId } = await api.post<{ conversationId: string }>("/api/orders", {
        action: "open-conversation",
        petOrderId: order.id,
      });
      router.push(`/messages/${conversationId}`);
    } catch (err) {
      toast.error(
        "Could not open the conversation",
        err instanceof ApiError ? err.message : "Please try again.",
      );
      setWorking(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:p-6">
          {order.listing.pet.photoUrl ? (
            <Image
              src={order.listing.pet.photoUrl}
              alt={order.listing.pet.name}
              width={112}
              height={112}
              className="size-28 shrink-0 rounded-[var(--radius-card)] object-cover"
            />
          ) : null}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[order.status] ?? "neutral"}>
                {order.status.replaceAll("_", " ").toLowerCase()}
              </Badge>
              <span className="font-mono text-xs text-fg-subtle">{order.orderNumber}</span>
            </div>

            <h2 className="mt-2 font-display text-xl font-semibold text-fg">
              {order.listing.title}
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              <Link href={`/p/${order.listing.pet.id}`} className="hover:underline">
                {order.listing.pet.name}
              </Link>
              {order.listing.pet.breedName ? ` · ${order.listing.pet.breedName}` : ""} ·{" "}
              <span className="font-mono text-xs">{order.listing.pet.passportNo}</span>
            </p>
          </div>

          <div className="shrink-0 text-right">
            <p className="font-display text-2xl font-semibold tabular text-fg">
              {formatMoney(order.amountCents, order.currency)}
            </p>
            {!order.isBuyer && (
              <p className="mt-1 text-xs text-fg-subtle tabular">
                you receive {formatMoney(order.sellerPayoutCents, order.currency)}
              </p>
            )}
          </div>
        </div>
      </Card>

      {order.status === "IN_ESCROW" || order.status === "HANDOVER_PENDING" ? (
        <Card className="p-5">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            <Lock className="size-4.5 text-brand" aria-hidden />
            Where the money is
          </h3>
          <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">
            {formatMoney(order.amountCents, order.currency)} is held by PetMate. The seller can see
            it has cleared but cannot touch it. It moves when you both confirm the handover
            {order.autoReleaseAt
              ? `, or automatically ${relativeTime(new Date(order.autoReleaseAt))} if nobody opens a dispute`
              : ""}
            .
          </p>

          <ul className="mt-4 space-y-2.5">
            <ConfirmRow
              label={order.isBuyer ? "You confirmed" : "The buyer confirmed"}
              done={Boolean(order.buyerConfirmedAt)}
              at={order.buyerConfirmedAt}
            />
            <ConfirmRow
              label={order.isBuyer ? "The seller confirmed" : "You confirmed"}
              done={Boolean(order.sellerConfirmedAt)}
              at={order.sellerConfirmedAt}
            />
          </ul>

          {canConfirm && (
            <div className="mt-5">
              <Button onClick={() => setConfirming(true)}>Confirm the handover</Button>
              <p className="mt-2 text-xs leading-relaxed text-fg-subtle">
                {order.isBuyer
                  ? "Only confirm once you have the animal. This releases the money and cannot be undone except through a dispute."
                  : "Confirm once you have handed the animal over."}
              </p>
            </div>
          )}

          {order.iConfirmed && !order.theyConfirmed && (
            <Alert tone="info" className="mt-5">
              <p>
                You have confirmed. Waiting on {order.counterparty.name}
                {order.autoReleaseAt
                  ? `, or it releases automatically ${relativeTime(new Date(order.autoReleaseAt))}.`
                  : "."}
              </p>
            </Alert>
          )}
        </Card>
      ) : null}

      {order.status === "COMPLETED" && (
        <Alert tone="success" title="Completed">
          <p className="mt-1">
            Escrow released{" "}
            {order.escrowReleasedAt ? relativeTime(new Date(order.escrowReleasedAt)) : ""}.{" "}
            {order.isBuyer
              ? `${order.listing.pet.name}'s full record — health history, documents and lineage — is now yours.`
              : `${formatMoney(order.sellerPayoutCents, order.currency)} was credited to your balance.`}
          </p>
        </Alert>
      )}

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-fg">
          {order.isBuyer ? "Seller" : "Buyer"}
        </h3>
        <div className="mt-3 flex items-center justify-between gap-4">
          <Link
            href={`/u/${order.counterparty.handle}`}
            className="flex min-w-0 items-center gap-3 hover:underline"
          >
            <Avatar
              src={order.counterparty.avatarUrl}
              name={order.counterparty.name}
              size="md"
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-fg">
                {order.counterparty.name}
              </span>
              <span className="block text-xs text-fg-subtle">
                Trust {order.counterparty.trustScore}
              </span>
            </span>
          </Link>
          <Button variant="outline" size="sm" onClick={message} loading={working}>
            <MessageSquare className="size-4" aria-hidden />
            Message
          </Button>
        </div>

        {order.meetingNote && (
          <p className="mt-4 rounded-[var(--radius-field)] bg-bg-sunken px-3.5 py-2.5 text-sm text-fg-muted">
            {order.meetingNote}
          </p>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-fg">Breakdown</h3>
        <dl className="mt-3">
          <DataRow label="Price" value={formatMoney(order.amountCents, order.currency)} />
          {!order.isBuyer && (
            <>
              <DataRow
                label="Platform commission"
                value={`− ${formatMoney(order.platformFeeCents, order.currency)}`}
              />
              <DataRow
                label="You receive"
                value={formatMoney(order.sellerPayoutCents, order.currency)}
              />
            </>
          )}
          <DataRow label="Ordered" value={formatDateTime(order.createdAt)} />
        </dl>
      </Card>

      <div className="flex flex-wrap gap-3">
        {canDispute && (
          <ButtonLink href={`/dashboard/disputes/new?petOrderId=${order.id}`} variant="outline">
            <Scale className="size-4" aria-hidden />
            Open a dispute
          </ButtonLink>
        )}
        {canCancel && (
          <Button variant="ghost" onClick={() => setCancelOpen(true)}>
            <XCircle className="size-4" aria-hidden />
            Cancel
          </Button>
        )}
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Confirm the handover?"
      >
        <div className="space-y-4">
          <Alert tone="warning" icon={<ShieldAlert className="size-4" aria-hidden />}>
            <p>
              {order.isBuyer
                ? `This releases ${formatMoney(order.amountCents, order.currency)} to the seller once they confirm too. Only do it if you have the animal.`
                : "This confirms you have handed the animal over."}
            </p>
          </Alert>

          <Field label="Note" hint="Optional — where and when you met, anything agreed.">
            {({ id, invalid }) => (
              <Textarea
                id={id}
                invalid={invalid}
                rows={3}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Not yet
            </Button>
            <Button onClick={confirm} loading={working} loadingText="Confirming…">
              Confirm handover
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this purchase?">
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-fg-muted">
            Money held in escrow is returned in full. The listing goes back on sale. Repeatedly
            cancelling after payment affects your trust score, because the other side held an
            animal for you.
          </p>

          <Field label="Why are you cancelling?" required>
            {({ id, invalid }) => (
              <Textarea
                id={id}
                invalid={invalid}
                rows={3}
                maxLength={300}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="We could not agree on a meeting time."
              />
            )}
          </Field>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={cancel}
              loading={working}
              loadingText="Cancelling…"
              disabled={cancelReason.trim().length < 5}
            >
              Cancel purchase
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ConfirmRow({
  label,
  done,
  at,
}: {
  label: string;
  done: boolean;
  at: string | null;
}) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      {done ? (
        <CheckCircle2 className="size-4 shrink-0 text-[var(--success)]" aria-hidden />
      ) : (
        <Circle className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      )}
      <span className={done ? "text-fg" : "text-fg-muted"}>{label}</span>
      {at && <span className="text-xs text-fg-subtle">{relativeTime(new Date(at))}</span>}
    </li>
  );
}
