import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BedDouble, GraduationCap, CalendarHeart } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { listMyCareBookings } from "@/lib/services/care-booking.service";
import { formatMoney } from "@/lib/money";
import { formatInZone } from "@/lib/care/format";
import { CARE_ACTIVE_STATUSES, type CareBookingStatus } from "@/lib/constants";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { CareStatus } from "@/components/care/care-status";

export const metadata: Metadata = { title: "My bookings", robots: { index: false, follow: false } };

export default async function MyCareBookingsPage() {
  const auth = await requireAuth();
  const bookings = await listMyCareBookings(auth);

  const active = bookings
    .filter((b) => CARE_ACTIVE_STATUSES.includes(b.status as CareBookingStatus))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const past = bookings.filter((b) => !CARE_ACTIVE_STATUSES.includes(b.status as CareBookingStatus));

  return (
    <div className="container-page max-w-4xl py-8 lg:py-10">
      <PageHeader
        eyebrow="Pet care"
        title="My bookings"
        description="Hotel stays and training programmes, with every update from the team."
        action={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/boarding" variant="outline" size="sm">
              <BedDouble className="size-4" aria-hidden /> Pet hotels
            </ButtonLink>
            <ButtonLink href="/training" variant="outline" size="sm">
              <GraduationCap className="size-4" aria-hidden /> Training
            </ButtonLink>
          </div>
        }
      />

      {bookings.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={<CalendarHeart className="size-6" aria-hidden />}
          title="No bookings yet"
          description="Book a pet hotel for when you travel, or a training programme for a calmer walk."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <ButtonLink href="/boarding">Find a pet hotel</ButtonLink>
              <ButtonLink href="/training" variant="outline">
                Find a trainer
              </ButtonLink>
            </div>
          }
        />
      ) : (
        <div className="mt-8 space-y-8">
          {[
            { title: "Upcoming and current", items: active },
            { title: "Past", items: past },
          ]
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <section key={group.title}>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-fg-subtle">{group.title}</h2>
                <ul className="space-y-2">
                  {group.items.map((b) => (
                    <li key={b.id}>
                      <Link href={`/dashboard/bookings/${b.id}`} className="block">
                        <Card interactive className="flex items-center gap-4 p-4">
                          <span className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-bg-sunken">
                            {b.pet.photos[0]?.url ? (
                              <Image src={b.pet.photos[0].url} alt="" fill sizes="56px" className="object-cover" />
                            ) : (
                              <span className="flex size-full items-center justify-center text-fg-subtle">
                                {b.kind === "BOARDING" ? <BedDouble className="size-5" aria-hidden /> : <GraduationCap className="size-5" aria-hidden />}
                              </span>
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-fg">
                              {b.pet.name} · {b.unit?.name ?? b.program?.name ?? "Booking"}
                            </p>
                            <p className="truncate text-xs text-fg-muted">
                              {b.provider.name} · {formatInZone(b.startAt, b.provider.timezone)}
                              {b.kind === "BOARDING" ? ` · ${b.nights} nights` : ` · ${b.sessions} sessions`}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <CareStatus status={b.status} kind={b.kind} />
                            <span className="text-xs font-semibold tabular text-fg">{formatMoney(b.totalCents, b.currency)}</span>
                          </div>
                        </Card>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
