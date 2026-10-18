import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { AlertTriangle, PawPrint, Phone } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { isAppError } from "@/lib/errors";
import { getCareBookingForProvider } from "@/lib/services/care-booking.service";
import { formatMoney } from "@/lib/money";
import { formatInZone } from "@/lib/care/format";
import { SPECIES_LABEL, type Species } from "@/lib/constants";
import { Alert, Badge, Breadcrumbs, Card, CardHeader, DataRow } from "@/components/ui/primitives";
import { CareStatus } from "@/components/care/care-status";
import { CareTimeline } from "@/components/care/care-timeline";
import { PostCareUpdate, RecordSession, TeamStatusActions, TransportLegCard } from "@/components/care/team-booking-actions";

export const metadata: Metadata = { title: "Booking", robots: { index: false, follow: false } };

export default async function ProviderBookingPage({ params }: { params: Promise<{ id: string; bookingId: string }> }) {
  const [{ id, bookingId }, auth] = await Promise.all([params, requireAuth()]);

  let booking;
  try {
    booking = await getCareBookingForProvider(auth, bookingId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  // The URL's provider must be the booking's provider, or this is someone
  // else's booking reached through a provider the caller does work at.
  if (booking.providerId !== id) notFound();

  const tz = booking.provider.timezone;
  const now = new Date();
  const openLegs = booking.transports.filter((t) => ["SCHEDULED", "EN_ROUTE"].includes(t.status));
  const openSessions = booking.trainingSessions.filter((s) => s.status === "SCHEDULED");
  // Sessions are recorded in order, from an hour before they start.
  const dueSession = openSessions.find((s) => s.startAt.getTime() <= now.getTime() + 3_600_000);
  const active = ["CONFIRMED", "IN_CARE"].includes(booking.status);
  // Same rule the service enforces: two hours past the start before a no-show.
  const noShowAllowed = now.getTime() > booking.startAt.getTime() + 2 * 3_600_000;

  return (
    <div className="container-page max-w-5xl py-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: "Provider console", href: "/provider" },
          { label: booking.provider.name, href: `/provider/${id}` },
          { label: booking.reference },
        ]}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="relative size-16 shrink-0 overflow-hidden rounded-2xl bg-bg-sunken">
            {booking.pet.photos[0]?.url ? (
              <Image src={booking.pet.photos[0].url} alt="" fill sizes="64px" className="object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-fg-subtle">
                <PawPrint className="size-6" aria-hidden />
              </span>
            )}
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold text-fg">
              {booking.pet.name} · {booking.unit?.name ?? booking.program?.name}
            </h1>
            <p className="mt-1 text-sm text-fg-muted">
              {SPECIES_LABEL[booking.pet.species as Species] ?? booking.pet.species}
              {booking.pet.breed?.name && ` · ${booking.pet.breed.name}`}
              {booking.pet.weightKg != null && ` · ${booking.pet.weightKg} kg`}
              {" · "}
              {booking.reference}
            </p>
          </div>
        </div>
        <CareStatus status={booking.status} kind={booking.kind} />
      </div>

      {booking.status === "PENDING_PAYMENT" && (
        <Alert tone="warning" className="mt-6" title="Not paid yet">
          The owner has 30 minutes to pay before the booking is released. Do not accept the pet until it is confirmed.
        </Alert>
      )}

      <div className="mt-6">
        <TeamStatusActions
          bookingId={booking.id}
          kind={booking.kind}
          status={booking.status}
          role={booking.role}
          hasOpenPickup={openLegs.some((l) => l.direction === "PICKUP")}
          hasOpenDropoff={openLegs.some((l) => l.direction === "DROPOFF")}
          hasOpenSessions={openSessions.length > 0}
          noShowAllowed={noShowAllowed}
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="space-y-5">
          {booking.transports.length > 0 && (
            <Card>
              <CardHeader title="Pickup and drop-off" description="Start the trip when the driver leaves. The owner's code completes it." />
              <div className="space-y-3 p-5">
                {booking.transports.map((leg) => (
                  <TransportLegCard
                    key={leg.id}
                    timezone={tz}
                    leg={{ ...leg, scheduledAt: leg.scheduledAt.toISOString() }}
                  />
                ))}
              </div>
            </Card>
          )}

          {booking.kind === "TRAINING" && (
            <Card>
              <CardHeader title="Sessions" />
              <ol className="divide-y divide-[var(--border)]">
                {booking.trainingSessions.map((s) => (
                  <li key={s.id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-fg">
                        Session {s.sequence} · <span className="tabular">{formatInZone(s.startAt, tz)}</span>
                      </p>
                      <Badge size="sm" tone={s.status === "COMPLETED" ? "success" : s.status === "MISSED" ? "danger" : "neutral"}>
                        {s.status.toLowerCase()}
                      </Badge>
                    </div>
                    {s.trainerNotes && <p className="mt-1.5 whitespace-pre-wrap text-sm text-fg-muted">{s.trainerNotes}</p>}
                    {active && dueSession?.id === s.id && <RecordSession sessionId={s.id} sequence={s.sequence} />}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {["CONFIRMED", "IN_CARE", "COMPLETED"].includes(booking.status) && (
            <PostCareUpdate bookingId={booking.id} petName={booking.pet.name} />
          )}

          <Card>
            <CardHeader title="Timeline" />
            <div className="p-5">
              <CareTimeline events={booking.events} />
            </div>
          </Card>
        </div>

        <aside className="space-y-5">
          {booking.careInstructions && (
            <Card className="border-[var(--warning)]">
              <CardHeader title="Care instructions" />
              <p className="whitespace-pre-wrap p-5 text-sm text-fg">{booking.careInstructions}</p>
            </Card>
          )}

          <Card>
            <CardHeader title="Owner" />
            <div className="space-y-2 p-5 text-sm">
              <p className="font-medium text-fg">{booking.user.name}</p>
              {(booking.contactPhone ?? booking.user.phone) && (
                <a href={`tel:${booking.contactPhone ?? booking.user.phone}`} className="flex items-center gap-2 text-fg-muted hover:text-fg">
                  <Phone className="size-4" aria-hidden />
                  {booking.contactPhone ?? booking.user.phone}
                </a>
              )}
              {booking.emergencyContact && (
                <p className="flex items-start gap-2 text-fg-muted">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Emergency: {booking.emergencyContact}
                </p>
              )}
              {booking.serviceAddress && <p className="text-fg-muted">{booking.serviceAddress}</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Booking" />
            <div className="p-5">
              <dl>
                <DataRow label={booking.kind === "BOARDING" ? "Check-in" : "First session"} value={formatInZone(booking.startAt, tz)} />
                <DataRow label={booking.kind === "BOARDING" ? "Check-out" : "Last session ends"} value={formatInZone(booking.endAt, tz)} />
                <DataRow label="Total paid" value={formatMoney(booking.totalCents, booking.currency)} />
                {!booking.provider.isOfficial && (
                  <>
                    <DataRow label="Commission" value={formatMoney(booking.commissionCents, booking.currency)} />
                    <DataRow label="Your earnings" value={<span className="font-bold">{formatMoney(booking.totalCents - booking.commissionCents, booking.currency)}</span>} />
                  </>
                )}
                {booking.refundedCents > 0 && <DataRow label="Refunded" value={formatMoney(booking.refundedCents, booking.currency)} />}
              </dl>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
