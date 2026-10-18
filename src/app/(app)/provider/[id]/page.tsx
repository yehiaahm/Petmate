import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, BedDouble, CalendarCheck, Clock, ExternalLink, PawPrint, Sparkles, Star, Truck, Wallet } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { isAppError } from "@/lib/errors";
import { getProviderConsole } from "@/lib/services/care-provider.service";
import { listProviderBookings } from "@/lib/services/care-booking.service";
import { getEarnings } from "@/lib/payments/ledger-core";
import { getSettings } from "@/lib/settings";
import { bpsToPercent, formatMoney } from "@/lib/money";
import { splitTags } from "@/lib/utils";
import { formatInZone } from "@/lib/care/format";
import type { CancellationPolicy } from "@/lib/constants";
import { Alert, Badge, Card, CardHeader, DataRow, EmptyState, PageHeader, Stat } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { CareStatus } from "@/components/care/care-status";
import { ProviderSetup } from "@/components/care/provider-setup";
import { ProviderForm, type ProviderFormValues } from "@/components/care/provider-form";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Provider console", robots: { index: false, follow: false } };

const VIEWS = [
  { key: "bookings", label: "Bookings" },
  { key: "past", label: "History" },
  { key: "setup", label: "Rooms, programmes & team" },
  { key: "settings", label: "Business settings" },
] as const;
type View = (typeof VIEWS)[number]["key"];

export default async function ProviderConsolePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ id }, query, auth] = await Promise.all([params, searchParams, requireAuth()]);
  const view: View = (VIEWS.map((v) => v.key) as readonly string[]).includes(query.view ?? "") ? (query.view as View) : "bookings";

  let consoleData;
  try {
    consoleData = await getProviderConsole(auth, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { provider, role } = consoleData;
  const tz = provider.timezone;

  const [active, past, earnings, settings] = await Promise.all([
    listProviderBookings(auth, provider.id, { scope: "active" }),
    view === "past" ? listProviderBookings(auth, provider.id, { scope: "past" }) : Promise.resolve([]),
    role === "OWNER" && !provider.isOfficial ? getEarnings("PROVIDER", provider.id, provider.currency) : null,
    getSettings(),
  ]);

  const inCare = active.filter((b) => b.status === "IN_CARE");
  const now = new Date().getTime();
  const today = active.filter(
    (b) => b.transports[0] && Math.abs(new Date(b.transports[0].scheduledAt).getTime() - now) < 18 * 3_600_000,
  );
  const commissionBps = provider.isOfficial ? null : provider.commissionBps ?? settings.commissionCareBps;
  const list = view === "past" ? past : active;

  const formValues: ProviderFormValues = {
    name: provider.name,
    tagline: provider.tagline ?? "",
    description: provider.description ?? "",
    email: provider.email,
    phone: provider.phone ?? "",
    website: provider.website ?? "",
    addressLine: provider.addressLine ?? "",
    city: provider.city ?? "",
    region: provider.region ?? "",
    country: provider.country ?? "",
    postalCode: provider.postalCode ?? "",
    coords: provider.lat != null && provider.lng != null ? { lat: provider.lat, lng: provider.lng } : null,
    timezone: provider.timezone,
    licenseNumber: provider.licenseNumber ?? "",
    offersBoarding: provider.offersBoarding,
    offersTraining: provider.offersTraining,
    checkInMinute: provider.checkInMinute,
    checkOutMinute: provider.checkOutMinute,
    offersTransport: provider.offersTransport,
    transportRadiusKm: String(provider.transportRadiusKm),
    transportBase: (provider.transportBaseCents / 100).toString(),
    transportPerKm: (provider.transportPerKmCents / 100).toString(),
    trainerCount: String(provider.trainerCount),
    amenities: splitTags(provider.amenities),
    requiresVaccination: provider.requiresVaccination,
    cancellationPolicy: provider.cancellationPolicy as CancellationPolicy,
    bookingLeadHours: String(provider.bookingLeadHours),
    currency: provider.currency,
    official: provider.isOfficial,
  };

  return (
    <div className="container-page max-w-6xl py-8 lg:py-10">
      <PageHeader
        eyebrow={provider.isOfficial ? "PetMate operation" : "Provider console"}
        title={provider.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {provider.city}
            {provider.isOfficial && (
              <Badge tone="brand" size="sm" icon={<Sparkles className="size-3" aria-hidden />}>
                PetMate Official
              </Badge>
            )}
            <Badge size="sm">{role.toLowerCase()}</Badge>
          </span>
        }
        action={
          provider.status === "ACTIVE" ? (
            <ButtonLink href={`/care/${provider.slug}`} variant="outline" size="sm">
              <ExternalLink className="size-4" aria-hidden /> Public page
            </ButtonLink>
          ) : undefined
        }
      />

      {provider.status === "PENDING" && (
        <Alert tone="warning" className="mt-6" title="Awaiting review" icon={<Clock className="size-4" aria-hidden />}>
          <p>
            A person is checking your registration. Until then you do not appear in search, but you can set up rooms,
            programmes and hours now so you can take bookings the moment you are approved.
          </p>
        </Alert>
      )}
      {provider.status === "SUSPENDED" && (
        <Alert tone="danger" className="mt-6" title="Suspended" icon={<AlertTriangle className="size-4" aria-hidden />}>
          <p>New bookings are blocked. Bookings already confirmed stand and must be honoured. Contact support to appeal.</p>
        </Alert>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="In your care now" value={String(inCare.length)} icon={<PawPrint className="size-4" aria-hidden />} />
        <Stat label="Upcoming" value={String(active.filter((b) => b.status === "CONFIRMED").length)} hint="Confirmed and paid" icon={<CalendarCheck className="size-4" aria-hidden />} />
        <Stat
          label="Rating"
          value={provider.ratingCount > 0 ? `${(provider.ratingAvgBps / 100).toFixed(1)} / 5` : "—"}
          hint={provider.ratingCount > 0 ? `${provider.ratingCount} reviews` : "No reviews yet"}
          icon={<Star className="size-4" aria-hidden />}
        />
        {earnings ? (
          <Stat
            label="Available to withdraw"
            value={formatMoney(earnings.availableCents, earnings.currency)}
            hint={`${formatMoney(earnings.pendingCents, earnings.currency)} pending`}
            icon={<Wallet className="size-4" aria-hidden />}
          />
        ) : (
          <Stat label="Completed bookings" value={String(provider.bookingCount)} icon={<BedDouble className="size-4" aria-hidden />} />
        )}
      </div>

      {today.length > 0 && view === "bookings" && (
        <Card className="mt-6">
          <CardHeader title="Trips due around now" description="Pickups and drop-offs within the next hours." />
          <ul className="divide-y divide-[var(--border)]">
            {today.map((b) => (
              <li key={b.id}>
                <Link href={`/provider/${provider.id}/bookings/${b.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-bg-sunken">
                  <span className="flex items-center gap-2 text-sm text-fg">
                    <Truck className="size-4 text-brand" aria-hidden />
                    {b.transports[0]!.direction === "PICKUP" ? "Pickup" : "Drop-off"}: {b.pet.name} ({b.user.name})
                  </span>
                  <span className="text-xs tabular text-fg-muted">{formatInZone(b.transports[0]!.scheduledAt, tz)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <nav aria-label="Console sections" className="mt-8 flex flex-wrap gap-1 border-b border-[var(--border)]">
        {VIEWS.filter((v) => v.key !== "settings" || role !== "STAFF").map((v) => (
          <Link
            key={v.key}
            href={`/provider/${provider.id}${v.key === "bookings" ? "" : `?view=${v.key}`}`}
            aria-current={view === v.key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2.5 text-sm font-medium",
              view === v.key ? "border-[var(--brand)] text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {(view === "bookings" || view === "past") &&
          (list.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck className="size-6" aria-hidden />}
              title={view === "past" ? "No past bookings" : "No bookings yet"}
              description={view === "past" ? "Completed and cancelled bookings appear here." : "Confirmed bookings appear here the moment they are paid."}
            />
          ) : (
            <Card>
              <ul className="divide-y divide-[var(--border)]">
                {list.map((b) => (
                  <li key={b.id}>
                    <Link href={`/provider/${provider.id}/bookings/${b.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-bg-sunken">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-fg">
                          {b.pet.name} · {b.unit?.name ?? b.program?.name}
                        </p>
                        <p className="text-xs text-fg-muted">
                          {b.user.name} · {b.reference} · {formatInZone(b.startAt, tz)}
                          {b.kind === "BOARDING" ? ` → ${formatInZone(b.endAt, tz, { weekday: undefined, hour: undefined, minute: undefined })}` : ` · ${b.sessions} sessions`}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {b._count.transports > 0 && <Truck className="size-4 text-fg-subtle" aria-label="Has pickup or drop-off" />}
                        <span className="text-sm font-semibold tabular text-fg">{formatMoney(b.totalCents, b.currency)}</span>
                        <CareStatus status={b.status} kind={b.kind} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}

        {view === "setup" && (
          <div className="grid gap-5 lg:grid-cols-[1fr_300px] lg:items-start">
            <ProviderSetup
              providerId={provider.id}
              role={role}
              offersBoarding={provider.offersBoarding}
              offersTraining={provider.offersTraining}
              currency={provider.currency}
              units={provider.units}
              programs={provider.programs}
              hours={provider.hours}
              members={provider.members}
              ownerUserId={provider.ownerUserId}
            />
            <aside className="space-y-5">
              <Card>
                <CardHeader title="Your terms" />
                <div className="p-5">
                  <dl>
                    <DataRow label="Commission" value={commissionBps == null ? "None (PetMate's own)" : bpsToPercent(commissionBps)} />
                    <DataRow label="Booking notice" value={`${provider.bookingLeadHours} hours`} />
                    <DataRow label="Cancellation" value={provider.cancellationPolicy.toLowerCase()} />
                    {provider.offersTransport && <DataRow label="Coverage" value={`${provider.transportRadiusKm} km`} />}
                  </dl>
                  {earnings && (
                    <div className="mt-4">
                      <ButtonLink href="/dashboard/wallet" variant="outline" size="sm" fullWidth>
                        Withdraw earnings
                      </ButtonLink>
                    </div>
                  )}
                </div>
              </Card>
            </aside>
          </div>
        )}

        {view === "settings" && role !== "STAFF" && <ProviderForm mode="edit" providerId={provider.id} initial={formValues} />}
      </div>
    </div>
  );
}
