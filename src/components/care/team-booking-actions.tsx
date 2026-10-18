"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, KeyRound, LogIn, LogOut, Send, Truck, UserX, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatInZone } from "@/lib/care/format";
import { CARE_UPDATE_TYPE, CARE_UPDATE_TYPE_LABEL, TRANSPORT_STATUS_LABEL, type CareUpdateType, type TransportStatus } from "@/lib/constants";

type Role = "STAFF" | "MANAGER" | "OWNER";

function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, body: Record<string, unknown>, success: string) {
    setBusy(key);
    try {
      await api.post("/api/care/bookings", body);
      toast.success(success);
      router.refresh();
      return true;
    } catch (err) {
      toast.error("That did not go through", err instanceof ApiError ? err.message : "Please try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { run, busy };
}

/** Status-level actions: check in, check out, no-show, cancel. */
export function TeamStatusActions({
  bookingId,
  kind,
  status,
  role,
  hasOpenPickup,
  hasOpenDropoff,
  hasOpenSessions,
  noShowAllowed,
}: {
  bookingId: string;
  kind: string;
  status: string;
  role: Role;
  hasOpenPickup: boolean;
  hasOpenDropoff: boolean;
  hasOpenSessions: boolean;
  /** Decided by the page at request time; the service checks it again. */
  noShowAllowed: boolean;
}) {
  const { run, busy } = useAction();
  const [confirm, setConfirm] = useState<"cancel" | "no-show" | null>(null);
  const manager = role !== "STAFF";

  return (
    <div className="flex flex-wrap gap-2">
      {kind === "BOARDING" && status === "CONFIRMED" && !hasOpenPickup && (
        <Button size="sm" loading={busy === "check-in"} onClick={() => void run("check-in", { action: "check-in", bookingId }, "Checked in")}>
          <LogIn className="size-4" aria-hidden /> Check in
        </Button>
      )}
      {status === "IN_CARE" && !hasOpenDropoff && !hasOpenSessions && (
        <Button size="sm" loading={busy === "complete"} onClick={() => void run("complete", { action: "complete", bookingId }, "Completed")}>
          <LogOut className="size-4" aria-hidden /> {kind === "BOARDING" ? "Check out" : "Close the programme"}
        </Button>
      )}
      {manager && status === "CONFIRMED" && noShowAllowed && (
        <Button size="sm" variant="outline" onClick={() => setConfirm("no-show")}>
          <UserX className="size-4" aria-hidden /> No-show
        </Button>
      )}
      {manager && ["PENDING_PAYMENT", "CONFIRMED"].includes(status) && (
        <Button size="sm" variant="ghost" onClick={() => setConfirm("cancel")}>
          <XCircle className="size-4" aria-hidden /> Cancel booking
        </Button>
      )}

      <ConfirmDialog
        open={confirm === "cancel"}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (await run("cancel", { action: "cancel", bookingId }, "Booking cancelled")) setConfirm(null);
        }}
        title="Cancel this booking?"
        description="When the business cancels, the owner always gets a full refund, whatever the policy. Your earnings for this booking are reversed."
        confirmLabel="Cancel and refund"
        loading={busy === "cancel"}
      />
      <ConfirmDialog
        open={confirm === "no-show"}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (await run("no-show", { action: "no-show", bookingId }, "Marked as a no-show")) setConfirm(null);
        }}
        title="Mark as a no-show?"
        description="Use this only if the pet never arrived and the owner did not cancel. The payment is kept and the owner is told."
        confirmLabel="Mark no-show"
        loading={busy === "no-show"}
      />
    </div>
  );
}

/** One pickup or drop-off leg, run by the driver from a phone. */
export function TransportLegCard({
  leg,
  timezone,
}: {
  leg: { id: string; direction: string; status: string; scheduledAt: string; address: string; driverName: string | null; otpAttempts: number };
  timezone: string;
}) {
  const { run, busy } = useAction();
  const [driver, setDriver] = useState(leg.driverName ?? "");
  const [code, setCode] = useState("");

  return (
    <div className="rounded-[var(--radius-field)] border border-[var(--border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <Truck className="size-4 text-brand" aria-hidden />
          {leg.direction === "PICKUP" ? "Pickup" : "Drop-off"} · <span className="tabular">{formatInZone(leg.scheduledAt, timezone)}</span>
        </p>
        <Badge size="sm" tone={leg.status === "COMPLETED" ? "success" : leg.status === "EN_ROUTE" ? "brand" : "neutral"}>
          {TRANSPORT_STATUS_LABEL[leg.status as TransportStatus]}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-fg-muted">{leg.address}</p>
      {leg.driverName && <p className="mt-0.5 text-xs text-fg-subtle">Driver: {leg.driverName}</p>}

      {leg.status === "SCHEDULED" && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Driver" className="min-w-40 flex-1">
            {({ id }) => <Input id={id} className="h-10" value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="Name shown to the owner" />}
          </Field>
          <Button
            size="sm"
            loading={busy === "start"}
            onClick={() => void run("start", { action: "start-transport", transportId: leg.id, driverName: driver.trim() || undefined }, "Trip started — the owner can now see their code")}
          >
            Start trip
          </Button>
        </div>
      )}

      {leg.status === "EN_ROUTE" && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run("complete", { action: "complete-transport", transportId: leg.id, code }, "Handover confirmed");
          }}
        >
          <Field label="Owner's six-digit code" hint={leg.otpAttempts ? `${leg.otpAttempts} wrong attempt(s) so far. Five locks the trip.` : "Ask the owner to read it from their booking page."} className="min-w-40 flex-1">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="h-10 tracking-[0.3em] tabular"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                leading={<KeyRound className="size-4" aria-hidden />}
              />
            )}
          </Field>
          <Button size="sm" type="submit" loading={busy === "complete"} disabled={code.length !== 6}>
            Confirm handover
          </Button>
        </form>
      )}
    </div>
  );
}

export function RecordSession({ sessionId, sequence }: { sessionId: string; sequence: number }) {
  const { run, busy } = useAction();
  const [notes, setNotes] = useState("");

  return (
    <div className="mt-3 space-y-2">
      <Field label={`Notes for session ${sequence}`} hint="The owner sees these. What you worked on, and what to practise at home.">
        {({ id }) => <Textarea id={id} rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
      <div className="flex gap-2">
        <Button
          size="sm"
          loading={busy === "done"}
          onClick={() => void run("done", { action: "record-session", sessionId, outcome: "COMPLETED", notes: notes.trim() || undefined }, "Session recorded")}
        >
          Mark done
        </Button>
        <Button
          size="sm"
          variant="outline"
          loading={busy === "missed"}
          onClick={() => void run("missed", { action: "record-session", sessionId, outcome: "MISSED", notes: notes.trim() || undefined }, "Marked as missed")}
        >
          Missed
        </Button>
      </div>
    </div>
  );
}

/** The daily report: a note, a meal, a walk, a photo. */
export function PostCareUpdate({ bookingId, petName }: { bookingId: string; petName: string }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const [type, setType] = useState<CareUpdateType>("UPDATE");
  const [body, setBody] = useState("");
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", "CARE_PHOTO");
      const { file: stored } = await api.upload<{ file: { id: string; url: string } }>("/api/uploads", form);
      setPhoto(stored);
    } catch (err) {
      toast.error("That image was not accepted", err instanceof ApiError ? err.message : "Try another file.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Post an update" description={`The owner gets a notification. Photos of ${petName} mean more than anything you can write.`} />
      <form
        className="space-y-3 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(
            "post",
            { action: "post-update", update: { bookingId, type, body: body.trim(), ...(photo ? { photoFileId: photo.id } : {}) } },
            "Update posted",
          );
          if (ok) {
            setBody("");
            setPhoto(null);
          }
        }}
      >
        <Select aria-label="Kind of update" value={type} onChange={(e) => setType(e.target.value as CareUpdateType)}>
          {CARE_UPDATE_TYPE.map((t) => (
            <option key={t} value={t}>
              {CARE_UPDATE_TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        <Textarea rows={3} maxLength={2000} aria-label="Update" value={body} onChange={(e) => setBody(e.target.value)} placeholder={`${petName} ate everything and spent the afternoon in the garden.`} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg-muted hover:text-fg">
            <ImagePlus className="size-4" aria-hidden />
            {uploading ? "Uploading…" : photo ? "Photo attached" : "Attach a photo"}
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          </label>
          <Button size="sm" type="submit" loading={busy === "post"} disabled={body.trim().length < 2 || uploading}>
            <Send className="size-4" aria-hidden /> Post
          </Button>
        </div>
      </form>
    </Card>
  );
}
