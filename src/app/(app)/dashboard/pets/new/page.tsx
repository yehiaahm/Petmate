import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { PageHeader, Breadcrumbs } from "@/components/ui/primitives";
import { PetForm } from "@/components/pets/pet-form";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Add a pet"),
  robots: { index: false, follow: false },
};
}

export default async function NewPetPage() {
  const { t } = await getI18n();
  const auth = await requireAuth();

  const breeds = await db.breed.findMany({
    orderBy: [{ species: "asc" }, { popularity: "desc" }, { name: "asc" }],
    select: { id: true, name: true, species: true },
  });

  return (
    <div className="container-page max-w-3xl py-8">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My pets", href: "/dashboard/pets" },
          { label: "Add a pet" },
        ]}
      />

      <PageHeader
        title={t("Add a pet")}
        description={t("This creates a permanent record for the animal. You can list them, book a vet or find a breeding match once it exists — and none of that requires listing them for sale.")}
      />

      <div className="mt-8">
        <PetForm
          breeds={breeds}
          defaultCity={auth.user.city}
          defaultCountry={auth.user.country}
        />
      </div>
    </div>
  );
}
