import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import {
  listNotifications,
  markNotificationsRead,
  unreadNotificationCount,
} from "@/lib/services/notification.service";
import { cuidSchema } from "@/lib/validation/common";
import { NOTIFICATION_CATEGORY, MANDATORY_NOTIFICATION_CATEGORIES } from "@/lib/constants";

export const GET = route({
  auth: true,
  query: z.object({
    unreadOnly: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    before: z.string().datetime({ offset: true }).optional(),
  }),
  async handler({ auth, query }) {
    const [notifications, unread] = await Promise.all([
      listNotifications(auth!.user.id, {
        limit: query.limit,
        unreadOnly: query.unreadOnly,
        before: query.before ? new Date(query.before) : undefined,
      }),
      unreadNotificationCount(auth!.user.id),
    ]);
    return { notifications, unread };
  },
});

export const POST = route({
  auth: true,
  body: z.discriminatedUnion("action", [
    z.object({ action: z.literal("read"), ids: z.array(cuidSchema).max(50).optional() }),
    z.object({
      action: z.literal("preferences"),
      preferences: z
        .array(
          z.object({
            category: z.enum(NOTIFICATION_CATEGORY),
            inApp: z.boolean(),
            email: z.boolean(),
            phone: z.boolean().default(false),
          }),
        )
        .max(20),
    }),
  ]),
  async handler({ body }) {
    const auth = await requireActive();

    if (body.action === "read") {
      const count = await markNotificationsRead(auth.user.id, body.ids);
      return { marked: count };
    }

    for (const pref of body.preferences) {
      // Security alerts are not optional. Silently forcing them on is better
      // than accepting a setting and ignoring it.
      const mandatory = MANDATORY_NOTIFICATION_CATEGORIES.includes(pref.category);

      await db.notificationPreference.upsert({
        where: { userId_category: { userId: auth.user.id, category: pref.category } },
        create: {
          userId: auth.user.id,
          category: pref.category,
          inApp: mandatory ? true : pref.inApp,
          email: mandatory ? true : pref.email,
          // The phone channel is a cost to the person as well as a channel, so
          // even security alerts may be kept to email there.
          phone: pref.phone,
        },
        update: {
          inApp: mandatory ? true : pref.inApp,
          email: mandatory ? true : pref.email,
          phone: pref.phone,
        },
      });
    }

    const preferences = await db.notificationPreference.findMany({
      where: { userId: auth.user.id },
      select: { category: true, inApp: true, email: true, phone: true },
    });

    return { preferences };
  },
});
