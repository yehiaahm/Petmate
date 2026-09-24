import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { ProfileForm } from "@/components/settings/profile-form";
import { PageHeader, Card, CardHeader } from "@/components/ui/primitives";
import { PhoneVerification } from "@/components/settings/phone-verification";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "Profile settings",
  robots: { index: false, follow: false },
};

export default async function ProfileSettingsPage() {
  const [auth, { t }] = await Promise.all([requireAuth(), getI18n()]);

  const profile = await db.user.findUniqueOrThrow({
    where: { id: auth.user.id },
    select: {
      name: true,
      handle: true,
      email: true,
      bio: true,
      phone: true,
      phoneVerifiedAt: true,
      phoneChannel: true,
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
      <div className="mt-6 space-y-5">
        <Card>
          <CardHeader
            title={t("Mobile number")}
            description={t("Verified with a code. Never shown on your profile; used for deliveries and, if you choose, WhatsApp updates.")}
          />
          <div className="p-5">
            <PhoneVerification
              phone={profile.phone}
              verified={Boolean(profile.phoneVerifiedAt)}
              channel={profile.phoneChannel === "SMS" ? "SMS" : "WHATSAPP"}
            />
          </div>
        </Card>
        <ProfileForm profile={profile} />
      </div>
    </>
  );
}
