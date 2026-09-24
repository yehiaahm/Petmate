import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { listApplicationsForListing } from "@/lib/services/adoption.service";
import { isAppError } from "@/lib/errors";
import { ApplicationReview } from "@/components/adoption/application-review";
import { Breadcrumbs, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Applications",
  robots: { index: false, follow: false },
};

export default async function ListingApplicationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, auth] = await Promise.all([params, requireAuth()]);

  const listing = await db.listing.findFirst({
    where: { id, sellerId: auth.user.id, deletedAt: null },
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      intent: true,
      pet: { select: { id: true, name: true, species: true } },
    },
  });
  if (!listing) notFound();

  let applications;
  try {
    applications = await listApplicationsForListing(auth, listing.id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="container-page max-w-4xl py-8 lg:py-10">
      <Breadcrumbs
        items={[
          { label: "My listings", href: "/dashboard/listings" },
          { label: listing.title, href: `/dashboard/listings/${listing.id}` },
          { label: "Applications" },
        ]}
      />

      <PageHeader
        title={`Applications for ${listing.pet.name}`}
        description="Ranked by a deterministic fit score against the answers each applicant gave. The score is a starting point — the reasons below it are the part worth reading."
      />

      <div className="mt-6">
        <ApplicationReview
          petName={listing.pet.name}
          applications={applications.map((a) => ({
            id: a.id,
            status: a.status,
            score: a.score ?? 0,
            homeType: a.homeType,
            hasYard: a.hasYard,
            hasOtherPets: a.hasOtherPets,
            otherPetsInfo: a.otherPetsInfo,
            hasChildren: a.hasChildren,
            childrenAges: a.childrenAges,
            hoursAloneDaily: a.hoursAloneDaily,
            experienceLevel: a.experienceLevel,
            previousPets: a.previousPets,
            motivation: a.motivation,
            createdAt: a.createdAt.toISOString(),
            decisionNote: a.decisionNote,
            conversationId: a.conversationId,
            reasons: a.reasons,
            applicant: {
              name: a.applicant.name,
              handle: a.applicant.handle,
              avatarUrl: a.applicant.avatarUrl,
              trustScore: a.applicant.trustScore,
              city: a.applicant.city,
              country: a.applicant.country,
              emailVerified: a.applicant.emailVerifiedAt !== null,
              memberSince: a.applicant.createdAt.toISOString(),
              petCount: a.applicant._count.pets,
            },
          }))}
        />
      </div>
    </div>
  );
}
