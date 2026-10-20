import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Stethoscope } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { listMyAppointments } from "@/lib/services/vet.service";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Appointments"),
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

const LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Checked in",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "Missed",
};

export default async function AppointmentsPage() {
  const { t } = await getI18n();
  const auth = await requireAuth();
  const appointments = await listMyAppointments(auth);

  const now = new Date();
  const upcoming = appointments.filter(
    (a) => a.startAt >= now && ["PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN"].includes(a.status),
  );
  const past = appointments.filter((a) => !upcoming.includes(a));

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <PageHeader
        title={t("Appointments")}
        description={t("Vet visits you have booked. Anything a clinic writes during one lands on your pet's record automatically.")}
        action={<ButtonLink href="/clinics">{t("Book a vet")}</ButtonLink>}
      />

      {appointments.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={<Stethoscope className="size-5" aria-hidden />}
          title={t("No appointments yet")}
          description={t("Booking through PetMate means the clinic's notes become part of your pet's permanent record, with a verified badge an owner cannot fake.")}
          action={<ButtonLink href="/clinics">{t("Find a clinic")}</ButtonLink>}
        />
      ) : (
        <div className="mt-8 space-y-10">
          {upcoming.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-fg">
                <CalendarDays className="size-4.5 text-brand" aria-hidden />
                {t("Upcoming")}
              </h2>
              <ul className="mt-4 space-y-2">
                {upcoming.map((appointment) => (
                  <AppointmentRow key={appointment.id} appointment={appointment} highlight />
                ))}
              </ul>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 className="font-display text-xl font-semibold text-fg">{t("Past")}</h2>
              <ul className="mt-4 space-y-2">
                {past.map((appointment) => (
                  <AppointmentRow key={appointment.id} appointment={appointment} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

type Appointment = Awaited<ReturnType<typeof listMyAppointments>>[number];

async function AppointmentRow({
  appointment,
  highlight = false,
}: {
  appointment: Appointment;
    highlight?: boolean;
}) {
  const { t, fmt } = await getI18n();
  return (
    <li>
      <Link href={`/dashboard/appointments/${appointment.id}`} className="block">
        <Card
          interactive
          className={highlight ? "border-brand/25 bg-brand-soft/20 p-4" : "p-4"}
        >
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <p className="text-[15px] font-medium text-fg">
                {appointment.service.name} · {appointment.pet.name}
              </p>
              <p className="mt-0.5 text-sm text-fg-muted">{appointment.clinic.name}</p>
              <p className="mt-0.5 text-xs text-fg-subtle">
                {fmt.dateTime(appointment.startAt)}
                {highlight ? ` · ${fmt.relative(appointment.startAt)}` : ""}
                {appointment.vet?.user.name ? ` · ${appointment.vet.user.name}` : ""}
              </p>
            </div>
            <div className="text-end">
              <p className="text-sm font-semibold tabular text-fg">
                {fmt.money(appointment.priceCents, appointment.currency)}
              </p>
              <Badge tone={TONE[appointment.status] ?? "neutral"} size="sm">
                {t(LABEL[appointment.status] ?? appointment.status)}
              </Badge>
            </div>
          </div>
        </Card>
      </Link>
    </li>
  );
}
