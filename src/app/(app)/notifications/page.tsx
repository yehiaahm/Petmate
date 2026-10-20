import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/rbac";
import { listNotifications, unreadNotificationCount } from "@/lib/services/notification.service";
import { NotificationFeed } from "@/components/notifications/notification-feed";
import { PageHeader } from "@/components/ui/primitives";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  title: t("Notifications"),
  robots: { index: false, follow: false },
};
}

export default async function NotificationsPage() {
  const { t } = await getI18n();
  const auth = await requireAuth();

  const [notifications, unread] = await Promise.all([
    listNotifications(auth.user.id, { limit: 30 }),
    unreadNotificationCount(auth.user.id),
  ]);

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <PageHeader
        title={t("Notifications")}
        description={
          unread > 0
            ? t("{count} unread. Marking them read here does not change your email settings.", { count: unread })
            : t("You are up to date.")
        }
      />

      <div className="mt-6">
        <NotificationFeed
          initial={notifications.map((n) => ({
            id: n.id,
            category: n.category,
            type: n.type,
            title: n.title,
            body: n.body,
            url: n.url,
            imageUrl: n.imageUrl,
            readAt: n.readAt ? n.readAt.toISOString() : null,
            createdAt: n.createdAt.toISOString(),
          }))}
          initialUnread={unread}
        />
      </div>
    </div>
  );
}
