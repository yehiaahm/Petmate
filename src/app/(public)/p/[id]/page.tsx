import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { BadgeCheck, Syringe, Stethoscope, FileHeart, Dna, MapPin } from "lucide-react";
import { getAuth } from "@/lib/auth/session";
import { getPetDetail, getLineage } from "@/lib/services/pet.service";
import { getPublicHealthSummary, healthScoreLabel } from "@/lib/services/health.service";
import { isAppError } from "@/lib/errors";
import { db } from "@/lib/db";
import { LineageTree } from "@/components/pets/lineage-tree";
import { Card, Badge, Avatar, Alert, DataRow } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { formatAge, formatDate } from "@/lib/utils";
import { SPECIES_LABEL, type Species } from "@/lib/constants";
import { clientEnv } from "@/lib/env";

/**
 * The public passport for an animal.
 *
 * Distinct from /pets/[slug], which is a *listing*. This page exists for every
 * animal with a record — including ancestors nobody is selling — because a
 * pedigree that links to dead ends is not checkable.
 *
 * It is deliberately sparse: provenance, documentation level and lineage. The
 * medical file itself belongs to the owner and does not appear here.
 */

const VERIFICATION_LABEL: Record<string, string> = {
  NONE: "Unverified",
  OWNER_CLAIMED: "Owner claimed",
  DOCUMENTED: "Documented",
  CLINIC_VERIFIED: "Clinic verified",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const pet = await db.pet.findFirst({
    where: { id, deletedAt: null },
    select: {
      name: true,
      species: true,
      passportNo: true,
      visibility: true,
      breed: { select: { name: true } },
      breedText: true,
    },
  });

  if (!pet) return { title: "Pet not found", robots: { index: false, follow: false } };

  const breed = pet.breed?.name ?? pet.breedText ?? SPECIES_LABEL[pet.species as Species];
  return {
    title: `${pet.name} — ${breed}`,
    description: `PetMate passport ${pet.passportNo}: ownership history, documentation level and recorded lineage for ${pet.name}.`,
    alternates: { canonical: `/p/${id}` },
    // UNLISTED is reachable by direct link but must stay out of the index.
    ...(pet.visibility === "PUBLIC" ? {} : { robots: { index: false, follow: false } }),
  };
}

export default async function PetPassportPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, auth] = await Promise.all([params, getAuth()]);

  let pet;
  try {
    pet = await getPetDetail(id, auth);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  // An UNLISTED pet is reachable by direct link but must not be indexed.
  const indexable = pet.visibility === "PUBLIC";

  const [health, lineage, activeListing] = await Promise.all([
    getPublicHealthSummary(pet.id),
    getLineage(pet.id, 3),
    db.listing.findFirst({
      where: { petId: pet.id, status: "ACTIVE", deletedAt: null },
      select: { slug: true, title: true },
    }),
  ]);

  const score = healthScoreLabel(pet.healthScore);
  const primaryPhoto = pet.photos.find((p) => p.isPrimary) ?? pet.photos[0];
  const breed = pet.breed?.name ?? pet.breedText ?? SPECIES_LABEL[pet.species as Species];

  return (
    <div className="container-page max-w-4xl py-10 lg:py-14">
      <div className="passport-edge overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border)] bg-bg-elevated">
        <div className="flex flex-col gap-6 p-6 sm:flex-row sm:p-8">
          {primaryPhoto ? (
            <Image
              src={primaryPhoto.url}
              alt={primaryPhoto.alt ?? pet.name}
              width={160}
              height={160}
              className="size-40 shrink-0 rounded-[var(--radius-card)] object-cover"
            />
          ) : (
            <div className="flex size-40 shrink-0 items-center justify-center rounded-[var(--radius-card)] bg-bg-sunken text-fg-subtle">
              <FileHeart className="size-10" aria-hidden />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-subtle">
              {pet.passportNo}
            </p>
            <h1 className="mt-1.5 font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
              {pet.name}
            </h1>
            <p className="mt-1 text-[15px] text-fg-muted">
              {breed} · {SPECIES_LABEL[pet.species as Species]}
              {pet.birthDate ? ` · ${formatAge(pet.birthDate)}` : ""}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Badge
                tone={pet.verificationLevel === "CLINIC_VERIFIED" ? "success" : "neutral"}
                icon={
                  pet.verificationLevel === "CLINIC_VERIFIED" ? (
                    <BadgeCheck className="size-3.5" aria-hidden />
                  ) : undefined
                }
              >
                {VERIFICATION_LABEL[pet.verificationLevel] ?? pet.verificationLevel}
              </Badge>
              {health.vaccinated && (
                <Badge tone={health.vaccinationsCurrent ? "success" : "warning"}>
                  <Syringe className="mr-1 size-3.5" aria-hidden />
                  {health.vaccinationsCurrent ? "Vaccinations current" : "Vaccinations overdue"}
                </Badge>
              )}
              {pet.isNeutered && <Badge tone="neutral">Neutered</Badge>}
              {pet.status === "DECEASED" && <Badge tone="neutral">Deceased</Badge>}
            </div>

            {(pet.city || pet.country) && (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-fg-subtle">
                <MapPin className="size-3.5" aria-hidden />
                {[pet.city, pet.country].filter(Boolean).join(", ")}
              </p>
            )}
          </div>
        </div>

        {activeListing && (
          <div className="border-t border-[var(--border)] bg-brand-soft/40 px-6 py-4 sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-fg">
                <span className="font-semibold">{pet.name} is currently listed.</span>{" "}
                {activeListing.title}
              </p>
              <ButtonLink href={`/pets/${activeListing.slug}`} size="sm">
                View the listing
              </ButtonLink>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_300px] lg:items-start">
        <div className="space-y-5">
          {pet.description && (
            <Card className="p-6">
              <h2 className="font-display text-lg font-semibold text-fg">About {pet.name}</h2>
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-fg-muted">
                {pet.description}
              </p>
              {pet.temperamentTags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {pet.temperamentTags.map((tag) => (
                    <Badge key={tag} tone="neutral" size="sm">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </Card>
          )}

          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
              <Dna className="size-4.5 text-brand" aria-hidden />
              Recorded lineage
            </h2>
            {lineage && (lineage.dam || lineage.sire) ? (
              <>
                <p className="mt-2 text-sm text-fg-muted">
                  Each ancestor links to its own passport, so a pedigree can be followed rather
                  than taken on trust.
                </p>
                <div className="mt-4">
                  <LineageTree node={lineage} />
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-fg-muted">
                No parents recorded. A pedigree only means something when both sides are on the
                system, so an owner has to add them deliberately.
              </p>
            )}

            {pet.offspringCount > 0 && (
              <p className="mt-4 border-t border-[var(--border)] pt-4 text-sm text-fg-muted">
                {pet.offspringCount} recorded{" "}
                {pet.offspringCount === 1 ? "offspring" : "offspring"} on PetMate.
              </p>
            )}
          </Card>
        </div>

        <aside className="space-y-5">
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <Stethoscope className="size-4 text-brand" aria-hidden />
              Documentation
            </h2>

            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-display text-3xl font-semibold tabular text-fg">
                {pet.healthScore}
              </span>
              <Badge tone={score.tone === "neutral" ? "neutral" : score.tone} size="sm">
                {score.label}
              </Badge>
            </div>

            <dl className="mt-4">
              <DataRow label="Health entries" value={health.recordCount} />
              <DataRow label="Clinic verified" value={health.clinicVerifiedCount} />
              <DataRow
                label="Last check-up"
                value={health.lastCheckupAt ? formatDate(health.lastCheckupAt) : "—"}
              />
              <DataRow label="Microchip" value={pet.microchipId ?? "Not recorded"} />
            </dl>

            <p className="mt-4 text-xs leading-relaxed text-fg-subtle">
              This score measures how well documented {pet.name} is, not how healthy. The medical
              file itself is private to the owner and transfers with the animal.
            </p>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-fg">Registered to</h2>
            <Link
              href={`/u/${pet.owner.handle}`}
              className="mt-3 flex items-center gap-3 rounded-[var(--radius-field)] p-1 -m-1 hover:bg-bg-sunken"
            >
              <Avatar src={pet.owner.avatarUrl} name={pet.owner.name} size="md" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-fg">
                  {pet.owner.name}
                </span>
                <span className="block text-xs text-fg-subtle">
                  Trust {pet.owner.trustScore} · member since{" "}
                  {formatDate(pet.owner.createdAt)}
                </span>
              </span>
            </Link>
          </Card>

          {pet.isOwner && (
            <Alert tone="info">
              <p>
                This is the public view of {pet.name}.{" "}
                <Link href={`/dashboard/pets/${pet.id}`} className="font-medium underline">
                  Manage the record
                </Link>{" "}
                to see the full health file and change what is visible.
              </p>
            </Alert>
          )}
        </aside>
      </div>

      {indexable && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Thing",
              name: pet.name,
              identifier: pet.passportNo,
              url: `${clientEnv.NEXT_PUBLIC_APP_URL}/p/${pet.id}`,
              description: pet.description ?? `${breed} registered on PetMate.`,
            }),
          }}
        />
      )}
    </div>
  );
}
