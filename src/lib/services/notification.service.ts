import "server-only";
import { db, type DbClient } from "@/lib/db";
import { clientEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { queueEmail, emailTemplates, type RenderedEmail } from "@/lib/email";
import {
  MANDATORY_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY,
  type NotificationCategory,
} from "@/lib/constants";

/**
 * One notification engine for every channel.
 *
 * Callers say what happened; this decides where it goes. Preferences are
 * honoured per category, except for SECURITY, which a user cannot switch off —
 * "your password changed" is not a marketing preference.
 */

export interface NotifyInput {
  userId: string;
  category: NotificationCategory;
  type: string;
  title: string;
  body?: string;
  url?: string;
  imageUrl?: string;
  entityType?: string;
  entityId?: string;
  /** Provide to also send email when the user allows it for this category. */
  email?: RenderedEmail | (() => RenderedEmail);
  /** Skip the in-app record, e.g. for a purely email digest. */
  skipInApp?: boolean;
}

export async function notify(input: NotifyInput, client: DbClient = db): Promise<void> {
  try {
    const prefs = await resolvePreferences(input.userId, input.category, client);

    if (!input.skipInApp && prefs.inApp) {
      await client.notification.create({
        data: {
          userId: input.userId,
          category: input.category,
          type: input.type,
          title: input.title.slice(0, 200),
          body: input.body?.slice(0, 500) ?? null,
          url: input.url ?? null,
          imageUrl: input.imageUrl ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
        },
      });
    }

    if (input.email && prefs.email) {
      const user = await client.user.findUnique({
        where: { id: input.userId },
        select: { email: true, name: true, deletedAt: true, status: true },
      });
      // Never mail a deleted or banned account.
      if (user && !user.deletedAt && user.status !== "BANNED") {
        const rendered = typeof input.email === "function" ? input.email() : input.email;
        await queueEmail(
          { to: user.email, toName: user.name, email: rendered, template: input.type },
          client,
        );
      }
    }
  } catch (e) {
    // A notification failure must not roll back the thing that caused it.
    logger.exception("notify failed", e, { userId: input.userId, type: input.type });
  }
}

/** Fan-out helper that keeps one slow recipient from blocking the rest. */
export async function notifyMany(inputs: NotifyInput[], client: DbClient = db): Promise<void> {
  await Promise.allSettled(inputs.map((i) => notify(i, client)));
}

async function resolvePreferences(
  userId: string,
  category: NotificationCategory,
  client: DbClient,
): Promise<{ inApp: boolean; email: boolean }> {
  if (MANDATORY_NOTIFICATION_CATEGORIES.includes(category)) {
    return { inApp: true, email: true };
  }

  const pref = await client.notificationPreference.findUnique({
    where: { userId_category: { userId, category } },
    select: { inApp: true, email: true },
  });

  // Opt-out by default for marketing, opt-in for everything operational.
  if (!pref) {
    return category === "MARKETING" ? { inApp: true, email: false } : { inApp: true, email: true };
  }
  return pref;
}

/** Creates the default preference rows for a new account. */
export async function seedNotificationPreferences(userId: string, client: DbClient = db) {
  await client.notificationPreference.createMany({
    data: NOTIFICATION_CATEGORY.map((category) => ({
      userId,
      category,
      inApp: true,
      email: category !== "MARKETING",
      push: false,
    })),
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function unreadNotificationCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

export async function listNotifications(
  userId: string,
  opts: { limit?: number; before?: Date; unreadOnly?: boolean } = {},
) {
  return db.notification.findMany({
    where: {
      userId,
      ...(opts.unreadOnly ? { readAt: null } : {}),
      ...(opts.before ? { createdAt: { lt: opts.before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 20, 50),
  });
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
  const { count } = await db.notification.updateMany({
    // Scoped by userId as well as id: an attacker passing someone else's
    // notification id changes nothing.
    where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return count;
}

// ---------------------------------------------------------------------------
// Convenience wrappers for the common events
// ---------------------------------------------------------------------------

const url = (path: string) => `${clientEnv.NEXT_PUBLIC_APP_URL}${path}`;

export const notifications = {
  async newMessage(params: {
    recipientId: string;
    senderName: string;
    preview: string;
    conversationId: string;
    context?: string;
  }) {
    await notify({
      userId: params.recipientId,
      category: "MESSAGE",
      type: "message.received",
      title: `${params.senderName} sent you a message`,
      body: params.preview.slice(0, 160),
      url: `/messages/${params.conversationId}`,
      entityType: "CONVERSATION",
      entityId: params.conversationId,
      email: () =>
        emailTemplates.newMessage({
          name: "",
          fromName: params.senderName,
          preview: params.preview,
          url: url(`/messages/${params.conversationId}`),
          context: params.context,
        }),
    });
  },

  async listingInterest(params: { sellerId: string; listingTitle: string; listingId: string }) {
    await notify({
      userId: params.sellerId,
      category: "LISTING",
      type: "listing.saved",
      title: "Someone saved your listing",
      body: params.listingTitle,
      url: `/dashboard/listings/${params.listingId}`,
      entityType: "LISTING",
      entityId: params.listingId,
    });
  },

  async paymentSucceeded(params: { userId: string; amount: string; what: string; url: string }) {
    await notify({
      userId: params.userId,
      category: "PAYMENT",
      type: "payment.succeeded",
      title: `Payment of ${params.amount} received`,
      body: params.what,
      url: params.url,
    });
  },

  async securityAlert(params: { userId: string; title: string; body: string; email?: RenderedEmail }) {
    await notify({
      userId: params.userId,
      category: "SECURITY",
      type: "security.alert",
      title: params.title,
      body: params.body,
      url: "/settings/security",
      email: params.email,
    });
  },
};
