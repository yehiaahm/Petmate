"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";

/**
 * The owner's one destructive action. The dialog states the refund the
 * server will actually issue under the policy agreed at booking, so nobody
 * cancels expecting money that the policy does not give back.
 */
export function CustomerBookingActions({
  bookingId,
  canCancel,
  paid,
  refundIfCancelledNow,
  totalCents,
  currency,
}: {
  bookingId: string;
  canCancel: boolean;
  paid: boolean;
  refundIfCancelledNow: number;
  totalCents: number;
  currency: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);

  if (!canCancel) return null;

  const description = !paid
    ? "The booking has not been paid, so nothing is charged. The room or trainer is released straight away."
    : refundIfCancelledNow >= totalCents
      ? `You will get a full refund of ${formatMoney(totalCents, currency)}.`
      : refundIfCancelledNow > 0
        ? `Under the cancellation policy you will get ${formatMoney(refundIfCancelledNow, currency)} back of ${formatMoney(totalCents, currency)}.`
        : "Under the cancellation policy no refund is due at this point. Message the provider first if your plans changed for a reason they may help with.";

  async function cancel() {
    setWorking(true);
    try {
      const result = await api.post<{ refundCents: number }>("/api/care/bookings", { action: "cancel", bookingId });
      toast.success(
        "Booking cancelled",
        result.refundCents > 0 ? `${formatMoney(result.refundCents, currency)} is on its way back to you.` : undefined,
      );
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error("Could not cancel", err instanceof ApiError ? err.message : "Please try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Cancel booking
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => void cancel()}
        title="Cancel this booking?"
        description={description}
        confirmLabel="Cancel booking"
        loading={working}
      />
    </>
  );
}
