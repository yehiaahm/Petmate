import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { NotificationPreferences } from "@/components/settings/notification-preferences";
import { PageHeader } from "@/components/ui/primitives";
import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CATEGORY_LABEL,
  MANDATORY_NOTIFICATION_CATEGORIES,
} from "@/lib/constants";

export const metadata: Metadata = {
  title: "Notification settings",
  robots: { index: false, follow: false },
};

export default async function NotificationSettingsPage() {
  const auth = await requireAuth();

  const saved = await db.notificationPreference.findMany({
    where: { userId: auth.user.id },
    select: { category: true, inApp: true, email: true },
  });

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
      mandatory,
    };
  });

  return (
    <>
      <PageHeader
        title="Notifications"
        description="What reaches you, and where. Security alerts cannot be switched off — a silent password change is how accounts get taken."
      />
      <div className="mt-6">
        <NotificationPreferences rows={rows} />
      </div>
    </>
  );
}
