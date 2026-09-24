import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CalendarDays,
  Stethoscope,
  Wallet,
  Star,
  ExternalLink,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { listClinicAppointments } from "@/lib/services/vet.service";
import { getClinicAnalytics } from "@/lib/services/analytics.service";
import { getEarnings } from "@/lib/payments/ledger-core";
import { getSettings } from "@/lib/settings";
import { isAppError } from "@/lib/errors";
import { ClinicSchedule } from "@/components/clinics/clinic-schedule";
import { ClinicSetup } from "@/components/clinics/clinic-setup";
import {
  PageHeader,
  Card,
  CardHeader,
  Stat,
  Badge,
  Alert,
  DataRow,
} from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { formatMoney, bpsToPercent } from "@/lib/money";
import { splitTags } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Clinic console",
  robots: { index: false, follow: false },
};

export default async function ClinicConsolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, auth] = await Promise.all([params, requireAuth()]);

  // Membership check happens here and again inside every service call below.
  const clinic = await db.clinic.findFirst({
    where: {
      id,
      deletedAt: null,
      OR: [{ ownerUserId: auth.user.id }, { members: { some: { userId: auth.user.id } } }],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      city: true,
      country: true,
      commissionBps: true,
      bookingLeadHours: true,
      cancellationHours: true,
      ownerUserId: true,
      ratingAvgBps: true,
      ratingCount: true,
      _count: { select: { vets: true, services: true } },
      services: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          category: true,
          durationMinutes: true,
          priceCents: true,
          currency: true,
          isActive: true,
          vet: { select: { user: { select: { name: true } } } },
        },
      },
      vets: {
        select: {
          id: true,
          licenseNumber: true,
          specialties: true,
          user: { select: { name: true } },
        },
      },
      hours: {
        where: { vetId: null },
        select: { weekday: true, startMinute: true, endMinute: true, slotMinutes: true },
      },
    },
  });
  if (!clinic) notFound();

  const isOwner = clinic.ownerUserId === auth.user.id;
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000);

  let appointments;
  try {
    appointments = await listClinicAppointments(auth, clinic.id, {
      from: new Date(now.getTime() - 7 * 86_400_000),
    });
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const [analytics, earnings, settings] = await Promise.all([
    getClinicAnalytics(clinic.id, { from, to: now }),
    isOwner ? getEarnings("CLINIC", clinic.id, auth.user.currency) : null,
    getSettings(),
  ]);

  const commissionBps =
    clinic.commissionBps ?? settings.commissionAppointmentBps;

  const upcoming = appointments.filter(
    (a) => a.startAt >= now && ["PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN"].includes(a.status),
  );
  const toComplete = appointments.filter(
    (a) => a.startAt < now && ["CONFIRMED", "CHECKED_IN"].includes(a.status),
  );

  return (
    <div className="container-page max-w-5xl py-8 lg:py-10">
      <PageHeader
        eyebrow="Clinic console"
        title={clinic.name}
        description={[clinic.city, clinic.country].filter(Boolean).join(", ") || undefined}
        action={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/clinics/${clinic.slug}`} variant="outline" size="sm">
              <ExternalLink className="size-4" aria-hidden />
              Public page
            </ButtonLink>
          </div>
        }
      />

      {clinic.status === "PENDING" && (
        <Alert
          tone="warning"
          className="mt-6"
          title="Awaiting licence verification"
          icon={<Clock className="size-4" aria-hidden />}
        >
          <p className="mt-1">
            A person is checking your registration number. Until it clears, the clinic does not
            appear in search and cannot take bookings — but you can add services, vets and hours
            now so the calendar is ready.
          </p>
        </Alert>
      )}

      {clinic.status === "SUSPENDED" && (
        <Alert
          tone="danger"
          className="mt-6"
          title="Suspended"
          icon={<AlertTriangle className="size-4" aria-hidden />}
        >
          <p className="mt-1">
            New bookings are blocked. Appointments already on the calendar stand and must still be
            honoured. Contact support to appeal.
          </p>
        </Alert>
      )}

      {toComplete.length > 0 && (
        <Alert tone="info" className="mt-4" title="Appointments waiting to be closed">
          <p className="mt-1">
            {toComplete.length} appointment{toComplete.length === 1 ? " has" : "s have"} passed
            without being marked complete. Completing one is what releases its payment to you and
            writes the visit onto the animal&rsquo;s record.
          </p>
        </Alert>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Upcoming"
          value={String(upcoming.length)}
          hint="Next 7 days and beyond"
          icon={<CalendarDays className="size-4" aria-hidden />}
        />
        <Stat
          label="Completed (30d)"
          value={String(analytics.appointments.completed)}
          hint={`${analytics.appointments.noShowRate}% no-show`}
          icon={<Stethoscope className="size-4" aria-hidden />}
        />
        <Stat
          label="Net earned (30d)"
          value={formatMoney(analytics.revenue.netCents, auth.user.currency)}
          hint={`after ${formatMoney(analytics.revenue.commissionCents, auth.user.currency)} commission`}
          icon={<Wallet className="size-4" aria-hidden />}
        />
        <Stat
          label="Rating"
          value={
            analytics.rating.count > 0 ? `${analytics.rating.average.toFixed(1)} / 5` : "—"
          }
          hint={
            analytics.rating.count > 0
              ? `${analytics.rating.count} reviews`
              : "No reviews yet"
          }
          icon={<Star className="size-4" aria-hidden />}
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_300px] lg:items-start">
        <Card>
          <CardHeader
            title="Schedule"
            description="The last seven days and everything ahead. Completing an appointment releases its payment and lets you write the visit onto the pet's record."
          />
          <div className="p-5">
            <ClinicSchedule
              appointments={appointments.map((a) => ({
                id: a.id,
                reference: a.reference,
                startAt: a.startAt.toISOString(),
                endAt: a.endAt.toISOString(),
                status: a.status,
                priceCents: a.priceCents,
                currency: a.currency,
                reasonForVisit: a.reasonForVisit,
                serviceName: a.service.name,
                vetName: a.vet?.user.name ?? null,
                petId: a.pet.id,
                petName: a.pet.name,
                petSpecies: a.pet.species,
                petBreed: a.pet.breed?.name ?? null,
                petPhoto: a.pet.photos[0]?.url ?? null,
                customerName: a.user.name,
                customerPhone: a.user.phone,
                isPast: a.startAt < now,
              }))}
            />
          </div>
        </Card>

        <aside className="space-y-5">
          <Card>
            <CardHeader title="Your terms" />
            <div className="p-5">
              <dl>
                <DataRow label="Commission" value={bpsToPercent(commissionBps)} />
                <DataRow
                  label="Booking lead time"
                  value={`${clinic.bookingLeadHours} hours`}
                />
                <DataRow
                  label="Free cancellation"
                  value={`${clinic.cancellationHours} hours before`}
                />
                <DataRow label="Vets" value={clinic._count.vets} />
                <DataRow label="Services" value={clinic._count.services} />
              </dl>
              {clinic.commissionBps !== null && (
                <Badge tone="brand" size="sm" className="mt-3">
                  negotiated rate
                </Badge>
              )}
            </div>
          </Card>

          {earnings && (
            <Card>
              <CardHeader title="Balance" />
              <div className="p-5">
                <dl>
                  <DataRow
                    label="Available"
                    value={formatMoney(earnings.availableCents, earnings.currency)}
                  />
                  <DataRow
                    label="Pending"
                    value={formatMoney(earnings.pendingCents, earnings.currency)}
                  />
                  <DataRow
                    label="Lifetime"
                    value={formatMoney(earnings.lifetimeCents, earnings.currency)}
                  />
                </dl>
                <div className="mt-4">
                  <ButtonLink href="/dashboard/wallet" variant="outline" size="sm" fullWidth>
                    Withdraw
                  </ButtonLink>
                </div>
              </div>
            </Card>
          )}

          {analytics.services.length > 0 && (
            <Card>
              <CardHeader title="Top services (30d)" />
              <div className="p-5">
                <ul className="space-y-2.5">
                  {analytics.services.slice(0, 6).map((service) => (
                    <li
                      key={service.name}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0 truncate text-fg-muted">{service.name}</span>
                      <span className="shrink-0 text-end">
                        <span className="block font-medium tabular text-fg">
                          {formatMoney(service.revenueCents, auth.user.currency)}
                        </span>
                        <span className="block text-xs text-fg-subtle tabular">
                          {service.count} visits
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          )}

          <p className="text-xs leading-relaxed text-fg-subtle">
            Something not covered here?{" "}
            <Link href="/support?topic=CLINIC" className="font-medium text-brand hover:underline">
              Ask support
            </Link>
            .
          </p>
        </aside>
      </div>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold text-fg">Setup</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Services, hours and vets. Changes take effect on the booking calendar immediately.
        </p>
        <div className="mt-4">
          <ClinicSetup
            clinicId={clinic.id}
            canManage={isOwner}
            services={clinic.services.map((s) => ({
              id: s.id,
              name: s.name,
              category: s.category,
              durationMinutes: s.durationMinutes,
              priceCents: s.priceCents,
              currency: s.currency,
              isActive: s.isActive,
              vetName: s.vet?.user.name ?? null,
            }))}
            vets={clinic.vets.map((v) => ({
              id: v.id,
              name: v.user.name,
              licenseNumber: v.licenseNumber,
              specialties: splitTags(v.specialties),
            }))}
            hours={clinic.hours}
          />
        </div>
      </section>
    </div>
  );
}
