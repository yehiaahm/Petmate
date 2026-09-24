import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { NotificationPreferences } from "@/components/settings/notification-preferences";
import { PageHeader } from "@/components/ui/primitives";
import { PHONE_DEFAULT_CATEGORIES } from "@/lib/services/notification.service";
import { getI18n } from "@/lib/i18n/server";
import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CATEGORY_LABEL,
  MANDATORY_NOTIFICATION_CATEGORIES,
} from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Notification settings"), robots: { index: false, follow: false } };
}

export default async function NotificationSettingsPage() {
  const [auth, { t }] = await Promise.all([requireAuth(), getI18n()]);

  const [saved, user] = await Promise.all([
    db.notificationPreference.findMany({
      where: { userId: auth.user.id },
      select: { category: true, inApp: true, email: true, phone: true },
    }),
    db.user.findUniqueOrThrow({ where: { id: auth.user.id }, select: { phoneVerifiedAt: true } }),
  ]);

  const byCategory = new Map(saved.map((p) => [p.category, p]));

  // Absent rows mean "default on": a new category should reach people, and a
  // row is written the first time they actually choose something.
  const rows = NOTIFICATION_CATEGORY.map((category) => {
    const existing = byCategory.get(category);
    const mandatory = MANDATORY_NOTIFICATION_CATEGORIES.includes(category);
    return {
      category,
      label: NOTIFICATION_CATEGORY_LABEL[category],
      inApp: mandatory ? true : (existing?.inApp ?? true),
      email: mandatory ? true : (existing?.email ?? category !== "MARKETING"),
      phone: existing?.phone ?? PHONE_DEFAULT_CATEGORIES.includes(category),
      mandatory,
    };
  });

  return (
    <>
      <PageHeader
        title={t("Notifications")}
        description={t("What reaches you, and where. Security alerts cannot be switched off — a silent password change is how accounts get taken.")}
      />
      <div className="mt-6">
        <NotificationPreferences rows={rows} phoneVerified={Boolean(user.phoneVerifiedAt)} />
      </div>
    </>
  );
}
