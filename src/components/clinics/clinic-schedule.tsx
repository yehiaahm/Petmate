"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { CalendarDays, Phone, CheckCircle2, PawPrint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Badge, EmptyState, Alert } from "@/components/ui/primitives";
import { Field, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { formatDateTime, relativeTime, cn } from "@/lib/utils";

export interface ScheduleAppointment {
  id: string;
  reference: string;
  startAt: string;
  endAt: string;
  status: string;
  priceCents: number;
  currency: string;
  reasonForVisit: string | null;
  serviceName: string;
  vetName: string | null;
  petId: string;
  petName: string;
  petSpecies: string;
  petBreed: string | null;
  petPhoto: string | null;
  customerName: string;
  customerPhone: string | null;
  /** Decided on the server so render stays pure. */
  isPast: boolean;
}

const TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  PENDING_PAYMENT: "warning",
  CONFIRMED: "info",
  CHECKED_IN: "info",
  COMPLETED: "success",
  CANCELLED: "neutral",
  NO_SHOW: "danger",
};

export function ClinicSchedule({ appointments }: { appointments: ScheduleAppointment[] }) {
  const router = useRouter();
  const toast = useToast();

  const [completing, setCompleting] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");
  const [clinicNotes, setClinicNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function complete(id: string) {
    setBusy(id);
    try {
      await api.post("/api/appointments", {
        action: "complete",
        appointmentId: id,
        outcome: outcome.trim() || undefined,
        clinicNotes: clinicNotes.trim() || undefined,
      });
      toast.success(
        "Appointment completed",
        "The payment has been released to your balance and the visit is on the animal's record.",
      );
      setCompleting(null);
      setOutcome("");
      setClinicNotes("");
      router.refresh();
    } catch (err) {
      toast.error(
        "Could not complete that",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (appointments.length === 0) {
    return (
      <EmptyState
        className="border-0 py-10"
        icon={<CalendarDays className="size-5" aria-hidden />}
        title="Nothing on the calendar"
        description="Bookings appear here the moment someone takes a slot. Add services and opening hours below to become bookable."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {appointments.map((appointment) => {
        const start = new Date(appointment.startAt);
        // `past` is decided on the server and passed in. Reading the clock
        // during render makes the output depend on when React happened to
        // render, which is exactly what a hydration mismatch is.
        const past = appointment.isPast;
        const closable = past && ["CONFIRMED", "CHECKED_IN"].includes(appointment.status);
        const open = completing === appointment.id;

        return (
          <li key={appointment.id}>
            <Card
              className={cn(
                "p-4",
                closable && "border-[var(--warning)]/40 bg-[var(--warning-soft)]/30",
              )}
            >
              <div className="flex gap-3">
                {appointment.petPhoto ? (
                  <Image
                    src={appointment.petPhoto}
                    alt=""
                    width={48}
                    height={48}
                    className="size-12 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-bg-sunken text-fg-subtle">
                    <PawPrint className="size-5" aria-hidden />
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-medium text-fg">
                      {appointment.petName}
                    </span>
                    <Badge tone={TONE[appointment.status] ?? "neutral"} size="sm">
                      {appointment.status.replaceAll("_", " ").toLowerCase()}
                    </Badge>
                    <span className="font-mono text-xs text-fg-subtle">
                      {appointment.reference}
                    </span>
                  </div>

                  <p className="mt-0.5 text-sm text-fg-muted">
                    {appointment.serviceName}
                    {appointment.petBreed ? ` · ${appointment.petBreed}` : ""}
                    {appointment.vetName ? ` · ${appointment.vetName}` : ""}
                  </p>

                  <p className="mt-0.5 text-xs text-fg-subtle">
                    {formatDateTime(appointment.startAt)} ·{" "}
                    {past ? relativeTime(start) : `in ${relativeTime(start).replace("in ", "")}`}{" "}
                    · {appointment.customerName}
                    {appointment.customerPhone && (
                      <>
                        {" · "}
                        <a
                          href={`tel:${appointment.customerPhone}`}
                          className="inline-flex items-center gap-1 hover:text-fg hover:underline"
                        >
                          <Phone className="size-3" aria-hidden />
                          {appointment.customerPhone}
                        </a>
                      </>
                    )}
                  </p>

                  {appointment.reasonForVisit && (
                    <p className="mt-2 rounded-[var(--radius-field)] bg-bg-sunken px-3 py-2 text-sm text-fg-muted">
                      {appointment.reasonForVisit}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span className="text-sm font-semibold tabular text-fg">
                      {formatMoney(appointment.priceCents, appointment.currency)}
                    </span>
                    <Link
                      href={`/dashboard/pets/${appointment.petId}/health`}
                      className="text-xs font-medium text-brand hover:underline"
                    >
                      Health record
                    </Link>
                    {closable && !open && (
                      <Button size="sm" onClick={() => setCompleting(appointment.id)}>
                        <CheckCircle2 className="size-4" aria-hidden />
                        Mark complete
                      </Button>
                    )}
                  </div>

                  {open && (
                    <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                      <Alert tone="info">
                        <p>
                          Completing this releases{" "}
                          {formatMoney(appointment.priceCents, appointment.currency)} less
                          commission to your balance, and writes the visit onto{" "}
                          {appointment.petName}&rsquo;s permanent record as clinic-verified.
                        </p>
                      </Alert>

                      <Field
                        label="Outcome"
                        hint="The owner sees this. Plain language, not shorthand."
                      >
                        {({ id, invalid }) => (
                          <Textarea
                            id={id}
                            invalid={invalid}
                            rows={3}
                            maxLength={1000}
                            value={outcome}
                            onChange={(e) => setOutcome(e.target.value)}
                            placeholder="Healthy. Second vaccination given, due again in 12 months."
                          />
                        )}
                      </Field>

                      <Field
                        label="Clinical notes"
                        hint="Visible to your clinic only, never to the owner."
                      >
                        {({ id, invalid }) => (
                          <Textarea
                            id={id}
                            invalid={invalid}
                            rows={3}
                            maxLength={2000}
                            value={clinicNotes}
                            onChange={(e) => setClinicNotes(e.target.value)}
                          />
                        )}
                      </Field>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          loading={busy === appointment.id}
                          loadingText="Completing…"
                          onClick={() => complete(appointment.id)}
                        >
                          Complete appointment
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setCompleting(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
