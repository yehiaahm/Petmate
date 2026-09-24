import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import {
  PawPrint,
  Stethoscope,
  Dna,
  Pencil,
  TrendingUp,
  ShieldCheck,
  CalendarDays,
  Syringe,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth, assertOwnsPet } from "@/lib/auth/rbac";
import { getPetDetail, getLineage } from "@/lib/services/pet.service";
import { healthScoreLabel } from "@/lib/services/health.service";
import { formatAge, formatDate } from "@/lib/utils";
import { Card, Badge, StatusPill, DataRow, Breadcrumbs } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { LineageTree } from "@/components/pets/lineage-tree";
import { PetActions } from "@/components/pets/pet-actions";
import { SPECIES_LABEL, VERIFICATION_LEVEL_LABEL, type Species, type VerificationLevel } from "@/lib/constants";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const pet = await db.pet.findUnique({ where: { id }, select: { name: true } });
  return {
    title: pet ? pet.name : "Pet",
    robots: { index: false, follow: false },
  };
}

export default async function PetDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const auth = await requireAuth();

  // Ownership is checked before anything is read, and a stranger's pet 404s.
  await assertOwnsPet(id, auth);

  const [pet, lineage, records, reminders, listings, appointments, documents] = await Promise.all([
    getPetDetail(id, auth),
    getLineage(id, 3),
    db.healthRecord.findMany({
      where: { petId: id, deletedAt: null },
      orderBy: { occurredAt: "desc" },
      take: 4,
      select: { id: true, type: true, title: true, occurredAt: true, source: true, nextDueAt: true },
    }),
    db.healthReminder.findMany({
      where: { petId: id, status: { in: ["PENDING", "SENT"] } },
      orderBy: { dueAt: "asc" },
      take: 3,
      select: { id: true, title: true, dueAt: true },
    }),
    db.listing.findMany({
      where: { petId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, status: true, intent: true, slug: true, priceCents: true, currency: true },
    }),
    db.appointment.findMany({
      where: { petId: id, startAt: { gte: new Date() }, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } },
      orderBy: { startAt: "asc" },
      take: 3,
      select: {
        id: true,
        startAt: true,
        service: { select: { name: true } },
        clinic: { select: { name: true } },
      },
    }),
    db.petDocument.count({ where: { petId: id } }),
  ]);

  if (!pet) notFound();

  const health = healthScoreLabel(pet.healthScore);
  const openListing = listings.find((l) => ["ACTIVE", "RESERVED", "PENDING_REVIEW", "DRAFT"].includes(l.status));

  return (
    <div className="container-page py-8">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My pets", href: "/dashboard/pets" },
          { label: pet.name },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="relative aspect-square w-full shrink-0 overflow-hidden rounded-[var(--radius-panel)] bg-bg-sunken sm:size-40">
              {pet.photos[0] ? (
                <Image
                  src={pet.photos[0].url}
                  alt={pet.photos[0].alt ?? pet.name}
                  fill
                  sizes="(max-width: 640px) 100vw, 160px"
                  priority
                  className="object-cover"
                />
              ) : (
                <span className="flex size-full items-center justify-center text-fg-subtle">
                  <PawPrint className="size-10" aria-hidden />
                </span>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral" size="sm">
                  {SPECIES_LABEL[pet.species as Species]}
                </Badge>
                {pet.verificationLevel !== "NONE" && (
                  <Badge tone="success" size="sm" icon={<ShieldCheck className="size-3" aria-hidden />}>
                    {VERIFICATION_LEVEL_LABEL[pet.verificationLevel as VerificationLevel]}
                  </Badge>
                )}
                {pet.availability !== "NOT_AVAILABLE" && (
                  <Badge tone="brand" size="sm">
                    {pet.availability === "FOR_SALE"
                      ? "For sale"
                      : pet.availability === "FOR_ADOPTION"
                        ? "For adoption"
                        : "For breeding"}
                  </Badge>
                )}
              </div>

              <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg">
                {pet.name}
              </h1>

              <p className="mt-1 text-[15px] text-fg-muted">
                {pet.breed?.name ?? pet.breedText ?? "Breed not recorded"} ·{" "}
                {pet.sex === "MALE" ? "Male" : pet.sex === "FEMALE" ? "Female" : "Sex unknown"} ·{" "}
                {formatAge(pet.birthDate)}
              </p>

              <p className="mt-2 font-mono text-xs text-fg-subtle">
                Passport {pet.passportNo}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <ButtonLink href={`/dashboard/pets/${id}/health`} size="sm">
                  <Stethoscope className="size-4" aria-hidden />
                  Health record
                </ButtonLink>
                <ButtonLink href={`/dashboard/pets/${id}/edit`} variant="outline" size="sm">
                  <Pencil className="size-4" aria-hidden />
                  Edit
                </ButtonLink>
                {!openListing && (
                  <ButtonLink href={`/dashboard/listings/new?petId=${id}`} variant="outline" size="sm">
                    <TrendingUp className="size-4" aria-hidden />
                    List {pet.name}
                  </ButtonLink>
                )}
              </div>
            </div>
          </div>

          {pet.photos.length > 1 && (
            <ul className="mt-5 flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
              {pet.photos.slice(1).map((photo) => (
                <li key={photo.id} className="relative size-20 shrink-0 overflow-hidden rounded-[var(--radius-field)]">
                  <Image src={photo.url} alt={photo.alt ?? ""} fill sizes="80px" className="object-cover" />
                </li>
              ))}
            </ul>
          )}

          {pet.description && (
            <section className="mt-8">
              <h2 className="font-display text-lg font-semibold text-fg">About {pet.name}</h2>
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-fg-muted">
                {pet.description}
              </p>
            </section>
          )}

          {pet.temperamentTags.length > 0 && (
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-fg">Temperament</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {pet.temperamentTags.map((tag) => (
                  <li key={tag}>
                    <Badge tone="neutral">{tag}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-fg">Recent health record</h2>
              <Link
                href={`/dashboard/pets/${id}/health`}
                className="text-sm font-semibold text-brand hover:underline"
              >
                See all
              </Link>
            </div>

            {records.length === 0 ? (
              <Card className="p-6 text-center">
                <Syringe className="mx-auto size-6 text-fg-subtle" aria-hidden />
                <p className="mt-2 text-sm font-medium text-fg">No records yet</p>
                <p className="mt-1 text-sm text-fg-muted">
                  Adding vaccinations and check-ups is what turns this profile into proof.
                </p>
                <div className="mt-4">
                  <ButtonLink href={`/dashboard/pets/${id}/health`} size="sm">
                    Add a record
                  </ButtonLink>
                </div>
              </Card>
            ) : (
              <Card>
                <ul className="divide-y divide-[var(--border)]">
                  {records.map((record) => (
                    <li key={record.id} className="flex items-center gap-3 p-4">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-bg-sunken text-fg-muted">
                        <Syringe className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">{record.title}</p>
                        <p className="text-xs text-fg-muted">{formatDate(record.occurredAt, "long")}</p>
                      </div>
                      <Badge tone={record.source === "CLINIC" ? "success" : "neutral"} size="sm">
                        {record.source === "CLINIC" ? "Clinic" : "Self-reported"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>

          {(lineage?.dam || lineage?.sire) && (
            <section className="mt-8">
              <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
                <Dna className="size-4 text-brand" aria-hidden />
                Lineage
              </h2>
              <div className="mt-3">
                <LineageTree node={lineage} />
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-5">
          <Card className="p-5">
            <h2 className="font-display text-base font-semibold text-fg">Health documentation</h2>
            <div className="mt-3">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-2xl font-semibold tabular text-fg">
                  {pet.healthScore}
                </span>
                <StatusPill tone={health.tone}>{health.label}</StatusPill>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-inset">
                <div
                  className={`h-full rounded-full ${
                    pet.healthScore >= 75
                      ? "bg-[var(--success)]"
                      : pet.healthScore >= 45
                        ? "bg-[var(--warning)]"
                        : "bg-[var(--danger)]"
                  }`}
                  style={{ width: `${Math.max(3, pet.healthScore)}%` }}
                />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-fg-muted">
                This measures how well documented {pet.name} is, not their medical condition. It is
                what buyers and clinics see.
              </p>
            </div>

            <dl className="mt-4 divide-y divide-[var(--border)] border-t border-[var(--border)]">
              <DataRow label="Records" value={records.length} />
              <DataRow label="Documents" value={documents} />
              <DataRow label="Reminders" value={reminders.length} />
            </dl>
          </Card>

          {reminders.length > 0 && (
            <Card className="p-5">
              <h2 className="font-display text-base font-semibold text-fg">Due soon</h2>
              <ul className="mt-3 space-y-2.5">
                {reminders.map((reminder) => {
                  const overdue = reminder.dueAt < new Date();
                  return (
                    <li key={reminder.id} className="flex items-start gap-2 text-sm">
                      <CalendarDays
                        className={`mt-0.5 size-4 shrink-0 ${overdue ? "text-[var(--danger)]" : "text-fg-subtle"}`}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-fg">{reminder.title}</span>
                        <span className={`block text-xs ${overdue ? "text-[var(--danger)]" : "text-fg-muted"}`}>
                          {overdue ? "Overdue since " : "Due "}
                          {formatDate(reminder.dueAt)}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {appointments.length > 0 && (
            <Card className="p-5">
              <h2 className="font-display text-base font-semibold text-fg">Upcoming visits</h2>
              <ul className="mt-3 space-y-2.5">
                {appointments.map((appointment) => (
                  <li key={appointment.id} className="text-sm">
                    <Link
                      href={`/dashboard/appointments/${appointment.id}`}
                      className="font-medium text-fg hover:underline"
                    >
                      {appointment.service.name}
                    </Link>
                    <p className="text-xs text-fg-muted">
                      {appointment.clinic.name} · {formatDate(appointment.startAt, "long")}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {listings.length > 0 && (
            <Card className="p-5">
              <h2 className="font-display text-base font-semibold text-fg">Listings</h2>
              <ul className="mt-3 space-y-2.5">
                {listings.map((listing) => (
                  <li key={listing.id} className="text-sm">
                    <Link
                      href={`/dashboard/listings/${listing.id}`}
                      className="font-medium text-fg hover:underline"
                    >
                      {listing.title}
                    </Link>
                    <div className="mt-1">
                      <Badge
                        tone={
                          listing.status === "ACTIVE"
                            ? "success"
                            : listing.status === "PENDING_REVIEW"
                              ? "warning"
                              : "neutral"
                        }
                        size="sm"
                      >
                        {listing.status.replace("_", " ").toLowerCase()}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <PetActions petId={id} petName={pet.name} hasOpenListing={Boolean(openListing)} />
        </aside>
      </div>
    </div>
  );
}
