import type { Metadata } from "next";
import { Dna, Info } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { listBreedingRequests } from "@/lib/services/breeding.service";
import { getEntitlements } from "@/lib/billing/entitlements";
import { PageHeader, EmptyState, Alert } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { BreedingWorkspace } from "@/components/breeding/breeding-workspace";

export const metadata: Metadata = {
  title: "Breeding",
  robots: { index: false, follow: false },
};

export default async function BreedingPage() {
  const auth = await requireAuth();

  const [pets, requests, entitlements] = await Promise.all([
    db.pet.findMany({
      where: {
        ownerId: auth.user.id,
        deletedAt: null,
        isNeutered: false,
        sex: { not: "UNKNOWN" },
        status: { notIn: ["DECEASED", "REHOMED", "ARCHIVED"] },
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        species: true,
        sex: true,
        birthDate: true,
        healthScore: true,
        breed: { select: { name: true } },
        breedText: true,
        photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
        breedingProfile: {
          select: {
            id: true,
            status: true,
            studFeeCents: true,
            currency: true,
            feeType: true,
            willingToTravelKm: true,
            requiresHealthTests: true,
            requiresVaccination: true,
            requiresPedigree: true,
            allowsMixedBreed: true,
            notes: true,
          },
        },
      },
    }),
    listBreedingRequests(auth, "all"),
    getEntitlements(auth.user.id),
  ]);

  const eligible = pets.filter((p) => p.sex !== "UNKNOWN");

  return (
    <div className="container-page py-8">
      <PageHeader
        eyebrow="Breeding network"
        title="Breeding"
        description="Compatibility is scored from age, health records, relatedness, distance and each owner's stated requirements. Every score shows its working."
      />

      <div className="mt-6">
        <Alert tone="info" icon={<Info className="size-4" aria-hidden />}>
          <strong className="font-semibold">How the matching works.</strong> PetMate uses a
          deterministic rule engine, not a machine-learning model. Identical inputs always produce
          an identical score, and you can see every factor that contributed. Pairings that would be
          irresponsible — too young, neutered, or closely related — are blocked outright rather
          than scored low.
        </Alert>
      </div>

      {eligible.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<Dna className="size-6" aria-hidden />}
            title="No pets eligible for breeding"
            description="A pet needs a recorded sex and must not be neutered. Add a pet, or update an existing profile."
            action={
              <div className="flex flex-wrap justify-center gap-3">
                <ButtonLink href="/dashboard/pets">My pets</ButtonLink>
                <ButtonLink href="/dashboard/pets/new" variant="outline">
                  Add a pet
                </ButtonLink>
              </div>
            }
          />
        </div>
      ) : (
        <div className="mt-8">
          <BreedingWorkspace
            pets={eligible.map((pet) => ({
              id: pet.id,
              name: pet.name,
              species: pet.species,
              sex: pet.sex as "MALE" | "FEMALE",
              birthDate: pet.birthDate?.toISOString() ?? null,
              healthScore: pet.healthScore,
              breedName: pet.breed?.name ?? pet.breedText ?? null,
              photo: pet.photos[0]?.url ?? null,
              hasProfile: Boolean(pet.breedingProfile),
              profileStatus: pet.breedingProfile?.status ?? null,
              studFeeCents: pet.breedingProfile?.studFeeCents ?? 0,
              currency: pet.breedingProfile?.currency ?? auth.user.currency,
              feeType: pet.breedingProfile?.feeType ?? "FEE",
              willingToTravelKm: pet.breedingProfile?.willingToTravelKm ?? 50,
              requiresHealthTests: pet.breedingProfile?.requiresHealthTests ?? true,
              requiresVaccination: pet.breedingProfile?.requiresVaccination ?? true,
              requiresPedigree: pet.breedingProfile?.requiresPedigree ?? false,
              allowsMixedBreed: pet.breedingProfile?.allowsMixedBreed ?? false,
              notes: pet.breedingProfile?.notes ?? "",
            }))}
            requests={requests.map((r) => ({
              id: r.id,
              status: r.status,
              isIncoming: r.isIncoming,
              message: r.message,
              score: r.compatibilityScore,
              feeCents: r.feeCents,
              currency: r.currency,
              feeType: r.feeType,
              createdAt: r.createdAt.toISOString(),
              scheduledAt: r.scheduledAt?.toISOString() ?? null,
              iAgreed: r.iAgreed,
              theyAgreed: r.theyAgreed,
              conversationId: r.conversationId,
              myPet: { id: r.myPet.id, name: r.myPet.name, photo: r.myPet.photos[0]?.url ?? null },
              theirPet: {
                id: r.theirPet.id,
                name: r.theirPet.name,
                photo: r.theirPet.photos[0]?.url ?? null,
                breedName: r.theirPet.breed?.name ?? null,
              },
              counterparty: {
                id: r.counterparty.id,
                name: r.counterparty.name,
                handle: r.counterparty.handle,
                avatarUrl: r.counterparty.avatarUrl,
              },
            }))}
            advancedMatching={entitlements.advancedMatching}
            planName={entitlements.planName}
          />
        </div>
      )}
    </div>
  );
}
