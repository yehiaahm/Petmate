import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { PageHeader, Breadcrumbs, Alert } from "@/components/ui/primitives";
import { PetForm } from "@/components/pets/pet-form";
import { splitTags } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Edit pet",
  robots: { index: false, follow: false },
};

export default async function EditPetPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, auth] = await Promise.all([params, requireAuth()]);

  // Scoped to the owner: someone else's pet id matches nothing here, which is
  // the same outcome as an id that does not exist.
  const [pet, breeds] = await Promise.all([
    db.pet.findFirst({
      where: { id, ownerId: auth.user.id, deletedAt: null },
      select: {
        id: true,
        name: true,
        species: true,
        breedId: true,
        breedText: true,
        sex: true,
        birthDate: true,
        birthDateIsEstimate: true,
        weightKg: true,
        color: true,
        description: true,
        microchipId: true,
        isNeutered: true,
        temperament: true,
        city: true,
        country: true,
        status: true,
        _count: { select: { listings: true } },
      },
    }),
    db.breed.findMany({
      orderBy: [{ species: "asc" }, { popularity: "desc" }, { name: "asc" }],
      select: { id: true, name: true, species: true },
    }),
  ]);

  if (!pet) notFound();

  return (
    <div className="container-page max-w-3xl py-8">
      <Breadcrumbs
        items={[
          { label: "My pets", href: "/dashboard/pets" },
          { label: pet.name, href: `/dashboard/pets/${pet.id}` },
          { label: "Edit" },
        ]}
      />

      <PageHeader
        title={`Edit ${pet.name}`}
        description="Changes apply to the animal's permanent record, so anything already published from it updates too."
      />

      {pet._count.listings > 0 && (
        <Alert tone="info" className="mt-6">
          <p>
            {pet.name} has {pet._count.listings} listing
            {pet._count.listings === 1 ? "" : "s"}. Edits here change what buyers see, including on
            listings that are already live.
          </p>
        </Alert>
      )}

      <div className="mt-8">
        <PetForm
          breeds={breeds}
          petId={pet.id}
          initial={{
            name: pet.name,
            species: pet.species as never,
            breedId: pet.breedId ?? "",
            breedText: pet.breedText ?? "",
            sex: pet.sex as never,
            // The form works in `yyyy-mm-dd`, which is also what the API takes.
            birthDate: pet.birthDate ? pet.birthDate.toISOString().slice(0, 10) : "",
            birthDateIsEstimate: pet.birthDateIsEstimate,
            weightKg: pet.weightKg != null ? String(pet.weightKg) : "",
            color: pet.color ?? "",
            description: pet.description ?? "",
            microchipId: pet.microchipId ?? "",
            isNeutered: pet.isNeutered,
            temperament: splitTags(pet.temperament),
            city: pet.city ?? "",
            country: pet.country ?? "",
          }}
        />
      </div>
    </div>
  );
}
