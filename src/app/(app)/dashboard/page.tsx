import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  PawPrint,
  Plus,
  Syringe,
  CalendarDays,
  MessageSquare,
  ShoppingBag,
  Heart,
  TrendingUp,
  ArrowRight,
  Stethoscope,
  ShieldCheck,
  Dna,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { getTrustBreakdown } from "@/lib/services/trust.service";
import { getRecommendedListings } from "@/lib/services/search.service";
import { getPendingReviews } from "@/lib/services/review.service";
import { formatAge, formatDate } from "@/lib/utils";
import { healthScoreLabel } from "@/lib/services/health.service";
import { Card, EmptyState, PageHeader, Badge, StatusPill } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { ListingCard, ListingGrid } from "@/components/listings/listing-card";
import { TrustMeter } from "@/components/dashboard/trust-meter";
import { SPECIES_LABEL, type Species } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  const auth = await requireAuth();
  const userId = auth.user.id;
  const now = new Date();

  const [
    pets,
    dueReminders,
    upcomingAppointments,
    activeListings,
    openOrders,
    incomingBreeding,
    adoptionApplications,
    unreadMessages,
    trust,
    recommended,
    pendingReviews,
  ] = await Promise.all([
    db.pet.findMany({
      where: { ownerId: userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        name: true,
        species: true,
        birthDate: true,
        healthScore: true,
        verificationLevel: true,
        availability: true,
        breed: { select: { name: true } },
        breedText: true,
        photos: { where: { isPrimary: true }, take: 1, select: { url: true, alt: true } },
      },
    }),
    db.healthReminder.findMany({
      where: {
        pet: { ownerId: userId, deletedAt: null },
        status: { in: ["PENDING", "SENT"] },
        dueAt: { lte: new Date(now.getTime() + 45 * 86_400_000) },
      },
      orderBy: { dueAt: "asc" },
      take: 5,
      select: { id: true, title: true, dueAt: true, pet: { select: { id: true, name: true } } },
    }),
    db.appointment.findMany({
      where: {
        userId,
        startAt: { gte: now },
        status: { in: ["CONFIRMED", "PENDING_PAYMENT", "CHECKED_IN"] },
      },
      orderBy: { startAt: "asc" },
      take: 3,
      select: {
        id: true,
        startAt: true,
        status: true,
        service: { select: { name: true } },
        clinic: { select: { name: true, slug: true } },
        pet: { select: { name: true } },
      },
    }),
    db.listing.count({
      where: { sellerId: userId, status: { in: ["ACTIVE", "RESERVED"] }, deletedAt: null },
    }),
    db.order.count({
      where: { buyerId: userId, status: { in: ["PAID", "PROCESSING", "SHIPPED"] } },
    }),
    db.breedingRequest.count({ where: { receiverUserId: userId, status: "PENDING" } }),
    db.adoptionApplication.count({
      where: { listing: { sellerId: userId }, status: { in: ["SUBMITTED", "IN_REVIEW"] } },
    }),
    db.conversationParticipant.aggregate({
      where: { userId, leftAt: null, isArchived: false },
      _sum: { unreadCount: true },
    }),
    getTrustBreakdown(userId),
    getRecommendedListings(userId, {
      lat: auth.user.lat,
      lng: auth.user.lng,
      country: auth.user.country,
    }),
    getPendingReviews(auth),
  ]);

  const firstName = auth.user.name.split(" ")[0];
  const unread = unreadMessages._sum.unreadCount ?? 0;

  // Things that need the user's attention, ordered by how time-sensitive they
  // are. An empty list is a good outcome and says so.
  const actions = [
    incomingBreeding > 0 && {
      href: "/dashboard/breeding",
      icon: Dna,
      label: `${incomingBreeding} breeding ${incomingBreeding === 1 ? "request" : "requests"} waiting`,
      tone: "brand" as const,
    },
    adoptionApplications > 0 && {
      href: "/dashboard/listings",
      icon: Heart,
      label: `${adoptionApplications} adoption ${adoptionApplications === 1 ? "application" : "applications"} to review`,
      tone: "accent" as const,
    },
    unread > 0 && {
      href: "/messages",
      icon: MessageSquare,
      label: `${unread} unread ${unread === 1 ? "message" : "messages"}`,
      tone: "brand" as const,
    },
    pendingReviews.length > 0 && {
      href: "/dashboard/reviews",
      icon: ShieldCheck,
      label: `Review ${pendingReviews.length} recent ${pendingReviews.length === 1 ? "transaction" : "transactions"}`,
      tone: "neutral" as const,
    },
  ].filter(Boolean) as { href: string; icon: typeof Dna; label: string; tone: "brand" | "accent" | "neutral" }[];

  return (
    <div className="container-page py-8">
      <PageHeader
        title={`Good to see you, ${firstName}`}
        description={
          pets.length === 0
            ? "Start by adding your first pet. Everything else on PetMate builds on that record."
            : "Here is what needs you today."
        }
        action={
          <ButtonLink href="/dashboard/pets/new">
            <Plus className="size-4" aria-hidden />
            Add a pet
          </ButtonLink>
        }
      />

      {actions.length > 0 && (
        <ul className="mt-6 grid gap-2 sm:grid-cols-2">
          {actions.map((action) => (
            <li key={action.href}>
              <Link
                href={action.href}
                className="surface surface-lift flex items-center gap-3 p-3.5"
              >
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                    action.tone === "accent"
                      ? "bg-accent-soft text-accent-soft-fg"
                      : action.tone === "brand"
                        ? "bg-brand-soft text-brand-soft-fg"
                        : "bg-bg-sunken text-fg-muted"
                  }`}
                >
                  <action.icon className="size-[18px]" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-sm font-medium text-fg">{action.label}</span>
                <ArrowRight className="rtl:-scale-x-100 size-4 shrink-0 text-fg-subtle" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          <section>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="font-display text-xl font-semibold text-fg">Your pets</h2>
              {pets.length > 0 && (
                <Link href="/dashboard/pets" className="text-sm font-semibold text-brand hover:underline">
                  See all
                </Link>
              )}
            </div>

            {pets.length === 0 ? (
              <EmptyState
                icon={<PawPrint className="size-6" aria-hidden />}
                title="No pets yet"
                description="A pet profile is the foundation: health records, reminders, listings and breeding all hang off it. It takes about a minute."
                action={
                  <ButtonLink href="/dashboard/pets/new">
                    <Plus className="size-4" aria-hidden />
                    Add your first pet
                  </ButtonLink>
                }
              />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {pets.map((pet) => {
                  const health = healthScoreLabel(pet.healthScore);
                  return (
                    <li key={pet.id}>
                      <Link href={`/dashboard/pets/${pet.id}`} className="surface surface-lift flex gap-4 p-4">
                        <div className="relative size-16 shrink-0 overflow-hidden rounded-[var(--radius-field)] bg-bg-sunken">
                          {pet.photos[0] ? (
                            <Image
                              src={pet.photos[0].url}
                              alt=""
                              fill
                              sizes="64px"
                              className="object-cover"
                            />
                          ) : (
                            <span className="flex size-full items-center justify-center text-fg-subtle">
                              <PawPrint className="size-6" aria-hidden />
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate font-display text-base font-semibold text-fg">
                            {pet.name}
                          </p>
                          <p className="truncate text-xs text-fg-muted">
                            {pet.breed?.name ?? pet.breedText ?? SPECIES_LABEL[pet.species as Species]} ·{" "}
                            {formatAge(pet.birthDate)}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <StatusPill tone={health.tone} className="text-[10px]">
                              {health.label}
                            </StatusPill>
                            {pet.availability !== "NOT_AVAILABLE" && (
                              <Badge tone="brand" size="sm">
                                {pet.availability === "FOR_SALE"
                                  ? "Listed"
                                  : pet.availability === "FOR_ADOPTION"
                                    ? "Adoption"
                                    : "Breeding"}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {dueReminders.length > 0 && (
            <section>
              <h2 className="mb-4 font-display text-xl font-semibold text-fg">Coming up</h2>
              <Card>
                <ul className="divide-y divide-[var(--border)]">
                  {dueReminders.map((reminder) => {
                    const overdue = reminder.dueAt < now;
                    return (
                      <li key={reminder.id}>
                        <Link
                          href={`/dashboard/pets/${reminder.pet.id}/health`}
                          className="flex items-center gap-3 p-4 transition-colors hover:bg-bg-sunken"
                        >
                          <span
                            className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                              overdue
                                ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                                : "bg-brand-soft text-brand-soft-fg"
                            }`}
                          >
                            <Syringe className="size-4" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-fg">
                              {reminder.pet.name}: {reminder.title}
                            </p>
                            <p className="text-xs text-fg-muted">
                              {overdue ? "Overdue since " : "Due "}
                              {formatDate(reminder.dueAt, "long")}
                            </p>
                          </div>
                          {overdue && <Badge tone="danger" size="sm">Overdue</Badge>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <div className="border-t border-[var(--border)] p-3">
                  <ButtonLink href="/clinics" variant="ghost" size="sm" fullWidth>
                    <Stethoscope className="size-4" aria-hidden />
                    Book a clinic visit
                  </ButtonLink>
                </div>
              </Card>
            </section>
          )}

          {upcomingAppointments.length > 0 && (
            <section>
              <h2 className="mb-4 font-display text-xl font-semibold text-fg">
                Upcoming appointments
              </h2>
              <Card>
                <ul className="divide-y divide-[var(--border)]">
                  {upcomingAppointments.map((appointment) => (
                    <li key={appointment.id}>
                      <Link
                        href={`/dashboard/appointments/${appointment.id}`}
                        className="flex items-center gap-3 p-4 transition-colors hover:bg-bg-sunken"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-soft-fg">
                          <CalendarDays className="size-4" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg">
                            {appointment.pet.name} · {appointment.service.name}
                          </p>
                          <p className="truncate text-xs text-fg-muted">
                            {appointment.clinic.name} · {formatDate(appointment.startAt, "long")}
                          </p>
                        </div>
                        {appointment.status === "PENDING_PAYMENT" && (
                          <Badge tone="warning" size="sm">Unpaid</Badge>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          {recommended.items.length > 0 && (
            <section>
              <div className="mb-4">
                <h2 className="font-display text-xl font-semibold text-fg">
                  {recommended.personalised ? "Picked for you" : "Popular right now"}
                </h2>
                <p className="mt-0.5 text-sm text-fg-muted">{recommended.basis}</p>
              </div>
              <ListingGrid>
                {recommended.items.slice(0, 4).map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </ListingGrid>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <TrustMeter trust={trust} />

          <Card className="p-5">
            <h2 className="font-display text-base font-semibold text-fg">At a glance</h2>
            <dl className="mt-3 space-y-2.5">
              {[
                { label: "Active listings", value: activeListings, href: "/dashboard/listings" },
                { label: "Orders in progress", value: openOrders, href: "/dashboard/orders" },
                { label: "Pets", value: pets.length, href: "/dashboard/pets" },
              ].map((stat) => (
                <div key={stat.label} className="flex items-center justify-between gap-3">
                  <dt className="text-sm text-fg-muted">
                    <Link href={stat.href} className="hover:text-fg hover:underline">
                      {stat.label}
                    </Link>
                  </dt>
                  <dd className="text-sm font-semibold tabular text-fg">{stat.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-base font-semibold text-fg">Quick actions</h2>
            <div className="mt-3 space-y-2">
              {[
                { href: "/dashboard/listings/new", label: "List a pet", icon: TrendingUp },
                { href: "/clinics", label: "Book a vet", icon: Stethoscope },
                { href: "/dashboard/breeding", label: "Find a breeding match", icon: Dna },
                { href: "/store", label: "Shop supplies", icon: ShoppingBag },
              ].map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="flex items-center gap-2.5 rounded-[var(--radius-field)] px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg"
                >
                  <action.icon className="size-4 shrink-0" aria-hidden />
                  {action.label}
                </Link>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
