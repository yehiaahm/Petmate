import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { ProfileForm } from "@/components/settings/profile-form";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Profile settings",
  robots: { index: false, follow: false },
};

export default async function ProfileSettingsPage() {
  const auth = await requireAuth();

  const profile = await db.user.findUniqueOrThrow({
    where: { id: auth.user.id },
    select: {
      name: true,
      handle: true,
      email: true,
      bio: true,
      phone: true,
      avatarUrl: true,
      country: true,
      region: true,
      city: true,
      postalCode: true,
      createdAt: true,
    },
  });

  return (
    <>
      <PageHeader
        title="Profile"
        description="What other members see. Your email address, phone number and exact address are never shown publicly."
      />
      <div className="mt-6">
        <ProfileForm profile={profile} />
      </div>
    </>
  );
}
