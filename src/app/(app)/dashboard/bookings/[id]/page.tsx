import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { BedDouble, GraduationCap, KeyRound, MapPin, Phone, Truck, CreditCard } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { getCareBookingForCustomer } from "@/lib/services/care-booking.service";
import { formatMoney } from "@/lib/money";
import { formatInZone } from "@/lib/care/format";
import {
  CANCELLATION_POLICY_LABEL,
  CANCELLATION_POLICY_SUMMARY,
  TRANSPORT_STATUS_LABEL,
  type CancellationPolicy,
  type TransportStatus,
} from "@/lib/constants";
import { Alert, Badge, Breadcrumbs, Card, CardHeader, DataRow } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { CareStatus } from "@/components/care/care-status";
import { CareTimeline } from "@/components/care/care-timeline";
import { CustomerBookingActions } from "@/components/care/customer-booking-actions";
import { ReviewComposer } from "@/components/reviews/review-composer";

export const metadata: Metadata = { title: "Booking", robots: { index: false, follow: false } };

export default async function CareBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, auth] = await Promise.all([params, requireAuth()]);

  let booking;
  try {
    booking = await getCareBookingForCustomer(auth, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const tz = booking.provider.timezone;
  const pendingPayment =
    booking.status === "PENDING_PAYMENT"
      ? await db.paymentIntent.findFirst({
          where: { referenceType: "CARE_BOOKING", referenceId: booking.id, userId: auth.user.id, status: "REQUIRES_PAYMENT" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
      : null;
  const liveLeg = booking.transports.find((t) => t.handoverCode);

  return (
    <div className="container-page max-w-5xl py-8 lg:py-10">
      <Breadcrumbs items={[{ label: "My bookings", href: "/dashboard/bookings" }, { label: booking.reference }]} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="relative size-16 shrink-0 overflow-hidden rounded-2xl bg-bg-sunken">
            {booking.pet.photos[0]?.url ? (
              <Image src={booking.pet.photos[0].url} alt="" fill sizes="64px" className="object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-fg-subtle">
                {booking.kind === "BOARDING" ? <BedDouble className="size-6" aria-hidden /> : <GraduationCap className="size-6" aria-hidden />}
              </span>
            )}
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">
              {booking.pet.name} · {booking.unit?.name ?? booking.program?.name}
            </h1>
            <p className="mt-1 text-sm text-fg-muted">
              <Link href={`/care/${booking.provider.slug}`} className="font-medium text-fg hover:underline">
                {booking.provider.name}
              </Link>
              {" · "}
              {booking.reference}
            </p>
          </div>
        </div>
        <CareStatus status={booking.status} kind={booking.kind} />
      </div>

      {liveLeg && (
        <Card className="mt-6 border-2 border-[var(--brand)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                <KeyRound className="size-4 text-brand" aria-hidden />
                {liveLeg.direction === "PICKUP" ? "Your pickup code" : "Your drop-off code"}
              </p>
              <p className="mt-1 text-xs text-fg-muted">
                {liveLeg.driverName ? `${liveLeg.driverName} is on the way. ` : "The driver is on the way. "}
                Give this code only in person, when you hand over or receive {booking.pet.name}.
              </p>
            </div>
            <p className="font-display text-4xl font-bold tracking-[0.3em] tabular text-fg" aria-label={`Code ${liveLeg.handoverCode!.split("").join(" ")}`}>
              {liveLeg.handoverCode}
            </p>
          </div>
        </Card>
      )}

      {booking.status === "PENDING_PAYMENT" && (
        <Alert tone="warning" className="mt-6" title="Waiting for payment" icon={<CreditCard className="size-4" aria-hidden />}>
          <p>The room or trainer is held for 30 minutes from booking. Pay to confirm, or it is released.</p>
          {pendingPayment && (
            <div className="mt-2">
              <ButtonLink href={`/checkout/${pendingPayment.id}`} size="sm">
                Pay now
              </ButtonLink>
            </div>
          )}
        </Alert>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="space-y-5">
          {booking.kind === "TRAINING" && booking.trainingSessions.length > 0 && (
            <Card>
              <CardHeader title="Sessions" description="Your trainer's notes appear here after each one." />
              <ol className="divide-y divide-[var(--border)]">
                {booking.trainingSessions.map((s) => (
                  <li key={s.id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-fg">
                        Session {s.sequence} · <span className="tabular">{formatInZone(s.startAt, tz)}</span>
                      </p>
                      <Badge size="sm" tone={s.status === "COMPLETED" ? "success" : s.status === "MISSED" ? "danger" : "neutral"}>
                        {s.status === "COMPLETED" ? "Done" : s.status === "MISSED" ? "Missed" : "Scheduled"}
                      </Badge>
                    </div>
                    {s.trainerNotes && <p className="mt-1.5 whitespace-pre-wrap text-sm text-fg-muted">{s.trainerNotes}</p>}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {booking.transports.length > 0 && (
            <Card>
              <CardHeader title="Pickup and drop-off" />
              <ul className="divide-y divide-[var(--border)]">
                {booking.transports.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                    <div>
                      <p className="flex items-center gap-1.5 text-sm font-medium text-fg">
                        <Truck className="size-4 text-brand" aria-hidden />
                        {t.direction === "PICKUP" ? "Pickup" : "Drop-off"} · <span className="tabular">{formatInZone(t.scheduledAt, tz)}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-fg-muted">{t.address}</p>
                    </div>
                    <Badge size="sm" tone={t.status === "COMPLETED" ? "success" : t.status === "EN_ROUTE" ? "brand" : "neutral"}>
                      {TRANSPORT_STATUS_LABEL[t.status as TransportStatus]}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Updates" description="Everything that happened, newest first." />
            <div className="p-5">
              <CareTimeline events={booking.events} />
            </div>
          </Card>

          {booking.canReview && (
            <Card className="p-5">
              <ReviewComposer
                targetType="CARE_PROVIDER"
                targetId={booking.providerId}
                refType="care"
                refId={booking.id}
                label={`Review ${booking.provider.name}`}
              />
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <div className="p-5">
              <dl>
                <DataRow label={booking.kind === "BOARDING" ? "Check-in" : "First session"} value={formatInZone(booking.startAt, tz)} />
                <DataRow label={booking.kind === "BOARDING" ? "Check-out" : "Ends"} value={formatInZone(booking.endAt, tz)} />
                {booking.kind === "BOARDING" && <DataRow label="Nights" value={booking.nights} />}
                <DataRow label={booking.kind === "BOARDING" ? "Stay" : "Programme"} value={formatMoney(booking.serviceCents, booking.currency)} />
                {booking.transportCents > 0 && <DataRow label="Transport" value={formatMoney(booking.transportCents, booking.currency)} />}
                <DataRow label="Total" value={<span className="font-bold">{formatMoney(booking.totalCents, booking.currency)}</span>} />
                {booking.refundedCents > 0 && <DataRow label="Refunded" value={formatMoney(booking.refundedCents, booking.currency)} />}
              </dl>
              <p className="mt-3 text-xs text-fg-muted">
                <span className="font-semibold text-fg">{CANCELLATION_POLICY_LABEL[booking.cancellationPolicy as CancellationPolicy]} policy.</span>{" "}
                {CANCELLATION_POLICY_SUMMARY[booking.cancellationPolicy as CancellationPolicy]}
              </p>
              <div className="mt-4">
                <CustomerBookingActions
                  bookingId={booking.id}
                  canCancel={booking.canCancel}
                  paid={Boolean(booking.paidAt)}
                  refundIfCancelledNow={booking.refundIfCancelledNow}
                  totalCents={booking.totalCents}
                  currency={booking.currency}
                />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title={booking.provider.name} />
            <div className="space-y-2 p-5 text-sm text-fg-muted">
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                {[booking.provider.addressLine, booking.provider.city].filter(Boolean).join(", ")}
              </p>
              {booking.provider.phone && (
                <a href={`tel:${booking.provider.phone}`} className="flex items-center gap-2 hover:text-fg">
                  <Phone className="size-4" aria-hidden />
                  {booking.provider.phone}
                </a>
              )}
            </div>
          </Card>

          {booking.careInstructions && (
            <Card>
              <CardHeader title="Your instructions" />
              <p className="whitespace-pre-wrap p-5 text-sm text-fg-muted">{booking.careInstructions}</p>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
