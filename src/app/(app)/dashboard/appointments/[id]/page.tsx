import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, Phone, Stethoscope, FileHeart } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { AppointmentActions } from "@/components/appointments/appointment-actions";
import { Breadcrumbs, Card, Badge, Alert, DataRow } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Appointment"),
  robots: { index: false, follow: false },
};
}

const TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  PENDING_PAYMENT: "warning",
  CONFIRMED: "info",
  CHECKED_IN: "info",
  COMPLETED: "success",
  CANCELLED: "neutral",
  NO_SHOW: "danger",
};

export default async function AppointmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t, fmt } = await getI18n();
  const [{ id }, auth] = await Promise.all([params, requireAuth()]);

  // Scoped to the customer. A clinic's own view of the same booking lives in
  // the clinic console, with a different authorisation path.
  const appointment = await db.appointment.findFirst({
    where: { id, userId: auth.user.id },
    select: {
      id: true,
      reference: true,
      startAt: true,
      endAt: true,
      status: true,
      priceCents: true,
      currency: true,
      commissionCents: true,
      reasonForVisit: true,
      outcome: true,
      cancellationReason: true,
      paidAt: true,
      createdAt: true,
      clinic: {
        select: {
          id: true,
          name: true,
          slug: true,
          addressLine: true,
          city: true,
          country: true,
          phone: true,
          cancellationHours: true,
        },
      },
      service: { select: { name: true, category: true, durationMinutes: true } },
      vet: { select: { user: { select: { name: true } } } },
      pet: { select: { id: true, name: true, species: true } },
      healthRecords: {
        where: { deletedAt: null },
        orderBy: { occurredAt: "desc" },
        select: { id: true, type: true, title: true, occurredAt: true, source: true },
      },
    },
  });

  if (!appointment) notFound();

  const settings = await getSettings();
  // One clock read for the whole render.
  // A server component renders once per request, so this is the request's
  // timestamp rather than a value that can change between renders.
  // eslint-disable-next-line react-hooks/purity -- server render, once per request
  const now = Date.now();
  const hoursUntil = (appointment.startAt.getTime() - now) / 3_600_000;
  const freeCancellation = hoursUntil >= appointment.clinic.cancellationHours;
  const cancellable = ["PENDING_PAYMENT", "CONFIRMED"].includes(appointment.status);

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: "Appointments", href: "/dashboard/appointments" },
          { label: appointment.reference },
        ]}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge tone={TONE[appointment.status] ?? "neutral"}>
          {appointment.status.replaceAll("_", " ").toLowerCase()}
        </Badge>
        <span className="font-mono text-xs text-fg-subtle">{appointment.reference}</span>
      </div>

      <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
        {appointment.service.name}
      </h1>
      <p className="mt-1 text-[15px] text-fg-muted">
        {fmt.dateTime(appointment.startAt)} · {t.plural(appointment.service.durationMinutes, { one: "{count} minute", other: "{count} minutes" })}
        {appointment.status === "CONFIRMED" && hoursUntil > 0
          ? ` · ${fmt.relative(appointment.startAt)}`
          : ""}
      </p>

      {appointment.status === "CANCELLED" && appointment.cancellationReason && (
        <Alert tone="info" className="mt-5" title={t("Cancelled")}>
          <p className="mt-1">{appointment.cancellationReason}</p>
        </Alert>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_280px] lg:items-start">
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
              <Stethoscope className="size-4.5 text-brand" aria-hidden />
              {t("Where to go")}
            </h2>
            <Link
              href={`/clinics/${appointment.clinic.slug}`}
              className="mt-3 block text-[15px] font-medium text-fg hover:underline"
            >
              {appointment.clinic.name}
            </Link>
            <p className="mt-1 flex items-start gap-1.5 text-sm text-fg-muted">
              <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {[appointment.clinic.addressLine, appointment.clinic.city, appointment.clinic.country]
                .filter(Boolean)
                .join(", ")}
            </p>
            {appointment.clinic.phone && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-muted">
                <Phone className="size-3.5" aria-hidden />
                <a href={`tel:${appointment.clinic.phone}`} className="hover:underline">
                  {appointment.clinic.phone}
                </a>
              </p>
            )}
            {appointment.vet?.user.name && (
              <p className="mt-3 text-sm text-fg-muted">
                {t("Seeing")} <span className="font-medium text-fg">{appointment.vet.user.name}</span>
              </p>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-fg">{t("Patient")}</h2>
            <Link
              href={`/dashboard/pets/${appointment.pet.id}`}
              className="mt-2 block text-[15px] font-medium text-fg hover:underline"
            >
              {appointment.pet.name}
            </Link>
            {appointment.reasonForVisit && (
              <p className="mt-3 text-sm leading-relaxed text-fg-muted">
                <span className="font-medium text-fg">{t("Reason given:")} </span>
                {appointment.reasonForVisit}
              </p>
            )}
          </Card>

          {appointment.status === "COMPLETED" && (
            <Card className="p-5">
              <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
                <FileHeart className="size-4.5 text-brand" aria-hidden />
                {t("What the clinic recorded")}
              </h2>
              {appointment.outcome && (
                <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">
                  {appointment.outcome}
                </p>
              )}
              {appointment.healthRecords.length > 0 ? (
                <ul className="mt-4 divide-y divide-[var(--border)]">
                  {appointment.healthRecords.map((record) => (
                    <li key={record.id} className="flex items-baseline justify-between gap-3 py-2.5">
                      <span className="text-sm text-fg">
                        {record.title}
                        {record.source === "CLINIC" && (
                          <Badge tone="success" size="sm" className="ms-2">
                            {t("Clinic verified")}
                          </Badge>
                        )}
                      </span>
                      <time className="shrink-0 text-xs text-fg-subtle tabular">
                        {fmt.date(record.occurredAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-fg-muted">
                  {t("No health entries were written for this visit. If the clinic told you something that should be on the record, ask them to add it — an entry they write carries a badge that one you add yourself cannot.")}
                </p>
              )}
              <div className="mt-4">
                <ButtonLink
                  href={`/dashboard/pets/${appointment.pet.id}/health`}
                  variant="outline"
                  size="sm"
                >
                  {t("Open {name}’s health record", { name: appointment.pet.name })}
                </ButtonLink>
              </div>
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-fg">{t("Payment")}</h2>
            <dl className="mt-3">
              <DataRow
                label={t("Consultation")}
                value={fmt.money(appointment.priceCents, appointment.currency)}
              />
              <DataRow
                label={t("Status")}
                value={appointment.paidAt ? `Paid ${fmt.date(appointment.paidAt)}` : "Unpaid"}
              />
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-fg-subtle">
              {t("Paid at booking and held until the appointment completes, so a clinic that never sees you is never paid.")}
            </p>
          </Card>

          {cancellable && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-fg">{t("Need to change it?")}</h2>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                {freeCancellation
                  ? t("Free cancellation until {count} hours before the appointment.", { count: appointment.clinic.cancellationHours })
                  : t("You are inside this clinic's {count}-hour cancellation window, so a fee may apply.", { count: appointment.clinic.cancellationHours })}
              </p>
              <div className="mt-4">
                <AppointmentActions
                  appointmentId={appointment.id}
                  clinicId={appointment.clinic.id}
                  freeCancellation={freeCancellation}
                />
              </div>
            </Card>
          )}

          {appointment.status === "COMPLETED" && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-fg">{t("How did it go?")}</h2>
              <p className="mt-2 text-sm text-fg-muted">
                {t("Reviews here are tied to a booking that actually happened, which is why they are worth reading.")}
              </p>
              <div className="mt-4">
                <ButtonLink
                  href={`/dashboard/reviews?clinicId=${appointment.clinic.id}`}
                  variant="outline"
                  size="sm"
                >
                  {t("Leave a review")}
                </ButtonLink>
              </div>
            </Card>
          )}

          <p className="text-xs leading-relaxed text-fg-subtle">
            {t.plural(settings.disputeWindowDays, {
              one: "Disputes about a booking can be opened for {count} day afterwards.",
              other: "Disputes about a booking can be opened for {count} days afterwards.",
            })}
          </p>
        </aside>
      </div>
    </div>
  );
}
