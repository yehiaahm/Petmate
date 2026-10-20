import type { Metadata } from "next";
import Link from "next/link";
import { PawPrint } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getSettings } from "@/lib/settings";
import { Breadcrumbs, PageHeader, EmptyState, Alert } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { ListingForm } from "@/components/listings/listing-form";
import { PLATFORM_CURRENCY } from "@/lib/currency";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Create a listing"),
  robots: { index: false, follow: false },
};
}

export default async function NewListingPage({
  searchParams,
}: {
  searchParams: Promise<{ petId?: string }>;
}) {
  const { t } = await getI18n();
  const { petId } = await searchParams;
  const auth = await requireAuth();

  const [pets, entitlements, activeCount, settings] = await Promise.all([
    db.pet.findMany({
      where: { ownerId: auth.user.id, deletedAt: null, status: { notIn: ["DECEASED", "REHOMED"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        species: true,
        sex: true,
        birthDate: true,
        breedText: true,
        breed: { select: { name: true } },
        photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
        _count: { select: { photos: true, healthRecords: true } },
        listings: {
          where: { status: { in: ["DRAFT", "ACTIVE", "PENDING_REVIEW", "RESERVED"] }, deletedAt: null },
          select: { id: true },
        },
      },
    }),
    getEntitlements(auth.user.id),
    db.listing.count({
      where: {
        sellerId: auth.user.id,
        status: { in: ["ACTIVE", "PENDING_REVIEW", "RESERVED"] },
        deletedAt: null,
      },
    }),
    getSettings(),
  ]);

  const available = pets.filter((pet) => pet.listings.length === 0);
  const atLimit = activeCount >= entitlements.activeListings;

  return (
    <div className="container-page max-w-3xl py-8">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My listings", href: "/dashboard/listings" },
          { label: "New listing" },
        ]}
      />

      <PageHeader
        eyebrow={t("Marketplace")}
        title={t("Create a listing")}
        description={t("A listing points at one of your pet profiles, so the photos and health record stay in one place and cannot drift apart.")}
      />

      {atLimit && (
        <div className="mt-6">
          <Alert tone="warning" title={t("You have reached your listing limit")}>
            {t("Your {plan} plan allows {limit} active listings and you have {count}.", {
              plan: entitlements.planName,
              limit: entitlements.activeListings,
              count: activeCount,
            })}{" "}
            {t("Close one, or")}{" "}
            <Link href="/pricing" className="font-semibold underline">
              {t("see plans")}
            </Link>
            .
          </Alert>
        </div>
      )}

      {pets.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<PawPrint className="size-6" aria-hidden />}
            title={t("Add a pet first")}
            description={t("Listings are built on a pet profile. Create one and you can list them in a couple of clicks.")}
            action={
              <ButtonLink href="/dashboard/pets/new">{t("Add a pet")}</ButtonLink>
            }
          />
        </div>
      ) : available.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<PawPrint className="size-6" aria-hidden />}
            title={t("Every pet already has an open listing")}
            description={t("Close an existing listing, or add another pet.")}
            action={
              <div className="flex flex-wrap justify-center gap-3">
                <ButtonLink href="/dashboard/listings" variant="outline">
                  {t("My listings")}
                </ButtonLink>
                <ButtonLink href="/dashboard/pets/new">{t("Add a pet")}</ButtonLink>
              </div>
            }
          />
        </div>
      ) : (
        <div className="mt-8">
          <ListingForm
            pets={available.map((pet) => ({
              id: pet.id,
              name: pet.name,
              species: pet.species,
              sex: pet.sex,
              breedName: pet.breed?.name ?? pet.breedText ?? null,
              photo: pet.photos[0]?.url ?? null,
              photoCount: pet._count.photos,
              healthRecordCount: pet._count.healthRecords,
            }))}
            preselectedPetId={petId}
            currency={PLATFORM_CURRENCY}
            disabled={atLimit}
            manualReviewPriceCents={settings.manualReviewPriceCents}
            defaultCity={auth.user.city}
            defaultCountry={auth.user.country}
          />
        </div>
      )}
    </div>
  );
}
