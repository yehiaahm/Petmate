import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/rbac";
import { listNotifications, unreadNotificationCount } from "@/lib/services/notification.service";
import { NotificationFeed } from "@/components/notifications/notification-feed";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false, follow: false },
};

export default async function NotificationsPage() {
  const auth = await requireAuth();

  const [notifications, unread] = await Promise.all([
    listNotifications(auth.user.id, { limit: 30 }),
    unreadNotificationCount(auth.user.id),
  ]);

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <PageHeader
        title="Notifications"
        description={
          unread > 0
            ? `${unread} unread. Marking them read here does not change your email settings.`
            : "You are up to date."
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
