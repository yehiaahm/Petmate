import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { PawPrint, Plus, Syringe, AlertTriangle } from "lucide-react";
import { requireAuth } from "@/lib/auth/rbac";
import { listPetsForOwner } from "@/lib/services/pet.service";
import { healthScoreLabel } from "@/lib/services/health.service";
import { formatAge, formatDate } from "@/lib/utils";
import { Card, EmptyState, PageHeader, Badge, StatusPill } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { SPECIES_LABEL, VERIFICATION_LEVEL_LABEL, type Species, type VerificationLevel } from "@/lib/constants";

export const metadata: Metadata = {
  title: "My pets",
  robots: { index: false, follow: false },
};

export default async function MyPetsPage() {
  const auth = await requireAuth();
  const pets = await listPetsForOwner(auth.user.id);

  return (
    <div className="container-page py-8">
      <PageHeader
        eyebrow="Your animals"
        title="My pets"
        description="Each pet has a permanent record: health history, documents, lineage and reminders. It stays with the animal even if they change hands."
        action={
          <ButtonLink href="/dashboard/pets/new">
            <Plus className="size-4" aria-hidden />
            Add a pet
          </ButtonLink>
        }
      />

      {pets.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<PawPrint className="size-6" aria-hidden />}
            title="No pets yet"
            description="Adding a pet takes a minute and unlocks everything else: vet booking, health reminders, listings and breeding matches."
            action={
              <ButtonLink href="/dashboard/pets/new">
                <Plus className="size-4" aria-hidden />
                Add your first pet
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pets.map((pet) => {
            const health = healthScoreLabel(pet.healthScore);
            const reminder = pet.reminders[0];
            const overdue = reminder && reminder.dueAt < new Date();

            return (
              <li key={pet.id}>
                <Card interactive as="article" className="flex h-full flex-col overflow-hidden">
                  <Link href={`/dashboard/pets/${pet.id}`} className="block">
                    <div className="relative aspect-card bg-bg-sunken">
                      {pet.photos[0] ? (
                        <Image
                          src={pet.photos[0].url}
                          alt={pet.photos[0].alt ?? pet.name}
                          fill
                          sizes="(max-width: 640px) 100vw, 33vw"
                          className="object-cover"
                        />
                      ) : (
                        <span className="flex size-full items-center justify-center text-fg-subtle">
                          <PawPrint className="size-8" aria-hidden />
                        </span>
                      )}

                      {pet.verificationLevel !== "NONE" && (
                        <div className="absolute start-3 top-3">
                          <Badge tone="success" size="sm">
                            {VERIFICATION_LEVEL_LABEL[pet.verificationLevel as VerificationLevel]}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </Link>

                  <div className="flex flex-1 flex-col p-4">
                    <Link href={`/dashboard/pets/${pet.id}`}>
                      <h2 className="font-display text-lg font-semibold text-fg hover:underline">
                        {pet.name}
                      </h2>
                    </Link>
                    <p className="mt-0.5 text-sm text-fg-muted">
                      {pet.breed?.name ?? pet.breedText ?? SPECIES_LABEL[pet.species as Species]} ·{" "}
                      {formatAge(pet.birthDate)}
                    </p>

                    <p className="mt-2 font-mono text-[11px] text-fg-subtle">{pet.passportNo}</p>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <StatusPill tone={health.tone}>{health.label}</StatusPill>
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

                    {reminder && (
                      <div
                        className={`mt-3 flex items-start gap-2 rounded-[var(--radius-field)] px-3 py-2 text-xs ${
                          overdue
                            ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                            : "bg-bg-sunken text-fg-muted"
                        }`}
                      >
                        {overdue ? (
                          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                        ) : (
                          <Syringe className="mt-px size-3.5 shrink-0" aria-hidden />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{reminder.title}</span>
                          <span className="block">
                            {overdue ? "Overdue since " : "Due "}
                            {formatDate(reminder.dueAt)}
                          </span>
                        </span>
                      </div>
                    )}

                    <div className="mt-auto flex gap-2 pt-4">
                      <ButtonLink
                        href={`/dashboard/pets/${pet.id}/health`}
                        variant="outline"
                        size="sm"
                        className="flex-1"
                      >
                        Health
                        <span className="tabular text-fg-subtle">{pet._count.healthRecords}</span>
                      </ButtonLink>
                      <ButtonLink
                        href={`/dashboard/pets/${pet.id}`}
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                      >
                        Open
                      </ButtonLink>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
