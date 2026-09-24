import "server-only";
import { z } from "zod";
import { db, type DbClient } from "@/lib/db";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { assertConversationAccess } from "@/lib/auth/rbac";
import type { AuthContext } from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { stringifyJson } from "@/lib/json";
import { truncate } from "@/lib/utils";
import { notifications } from "./notification.service";
import { scoreMessageRisk, recordRiskEvent } from "./risk.service";
import { publish } from "@/lib/realtime";
import { safeParagraph, cuidSchema } from "@/lib/validation/common";
import { CONVERSATION_TYPE, LIMITS, type ConversationType } from "@/lib/constants";

/**
 * Messaging.
 *
 * Authorization is per conversation and checked on every read and write.
 * `assertConversationAccess` looks up the participant row keyed by
 * (conversationId, userId), so a conversation id belonging to someone else
 * resolves to nothing — there is no path where knowing an id grants access.
 *
 * Messages are plain text at rest and rendered as text, never HTML, which
 * removes stored XSS as a category rather than relying on sanitising.
 */

export const sendMessageSchema = z.object({
  conversationId: cuidSchema,
  body: safeParagraph(LIMITS.messageMax, 1),
  attachments: z.array(cuidSchema).max(5).optional(),
});

export async function getOrCreateConversation(params: {
  type: ConversationType;
  participantIds: string[];
  contextType?: string;
  contextId?: string;
  listingId?: string;
  subject?: string;
  createdById: string;
}): Promise<{ id: string; created: boolean }> {
  const participants = [...new Set(params.participantIds)];
  if (participants.length < 2) throw badRequest("A conversation needs two people.");

  // Reuse an existing thread for the same context so a buyer and seller do not
  // end up with five separate threads about one listing.
  if (params.contextType && params.contextId) {
    const existing = await db.conversation.findFirst({
      where: {
        type: params.type,
        contextType: params.contextType,
        contextId: params.contextId,
        participants: { every: { userId: { in: participants } } },
      },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };
  }

  if (params.type === "LISTING" && params.listingId) {
    const existing = await db.conversation.findFirst({
      where: {
        type: "LISTING",
        listingId: params.listingId,
        AND: participants.map((userId) => ({ participants: { some: { userId } } })),
      },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };
  }

  if (params.type === "DIRECT") {
    const existing = await db.conversation.findFirst({
      where: {
        type: "DIRECT",
        AND: participants.map((userId) => ({ participants: { some: { userId } } })),
      },
      select: { id: true, participants: { select: { userId: true } } },
    });
    if (existing && existing.participants.length === participants.length) {
      return { id: existing.id, created: false };
    }
  }

  const conversation = await db.conversation.create({
    data: {
      type: params.type,
      contextType: params.contextType ?? null,
      contextId: params.contextId ?? null,
      listingId: params.listingId ?? null,
      subject: params.subject?.slice(0, 200) ?? null,
      createdById: params.createdById,
      participants: { create: participants.map((userId) => ({ userId })) },
    },
    select: { id: true },
  });

  return { id: conversation.id, created: true };
}

/** Opens a thread about a listing, checking the block list first. */
export async function startListingConversation(
  auth: AuthContext,
  listingId: string,
  firstMessage: string,
) {
  await enforceRateLimit("message", auth.user.id);

  const listing = await db.listing.findFirst({
    where: { id: listingId, deletedAt: null, status: { in: ["ACTIVE", "RESERVED"] } },
    select: { id: true, sellerId: true, title: true, intent: true },
  });
  if (!listing) throw notFound("That listing");
  if (listing.sellerId === auth.user.id) throw badRequest("This is your own listing.");

  await assertNotBlocked(auth.user.id, listing.sellerId);

  const conversation = await getOrCreateConversation({
    type: "LISTING",
    participantIds: [auth.user.id, listing.sellerId],
    listingId,
    contextType: "LISTING",
    contextId: listingId,
    subject: listing.title,
    createdById: auth.user.id,
  });

  await db.listing.update({
    where: { id: listingId },
    data: { inquiryCount: { increment: 1 } },
  });

  await sendMessage(auth, { conversationId: conversation.id, body: firstMessage });

  return conversation;
}

export async function sendMessage(
  auth: AuthContext,
  input: z.infer<typeof sendMessageSchema>,
) {
  await enforceRateLimit("message", auth.user.id);
  await assertConversationAccess(input.conversationId, auth);

  const conversation = await db.conversation.findUnique({
    where: { id: input.conversationId },
    select: {
      id: true,
      subject: true,
      type: true,
      participants: {
        select: { userId: true, leftAt: true, mutedUntil: true },
      },
    },
  });
  if (!conversation) throw notFound("That conversation");

  const recipients = conversation.participants
    .filter((p) => p.userId !== auth.user.id && !p.leftAt)
    .map((p) => p.userId);

  // One-way block still stops the message: the blocker should not receive it.
  for (const recipientId of recipients) {
    await assertNotBlocked(auth.user.id, recipientId);
  }

  const risk = scoreMessageRisk(input.body);

  const message = await db.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId: input.conversationId,
        senderId: auth.user.id,
        body: input.body,
        attachments: input.attachments?.length ? stringifyJson(input.attachments) : null,
        flagged: risk.flagged,
        flagReason: risk.reason,
      },
      select: { id: true, body: true, createdAt: true, senderId: true, flagged: true },
    });

    await tx.conversation.update({
      where: { id: input.conversationId },
      data: {
        lastMessageAt: created.createdAt,
        lastMessagePreview: truncate(input.body, 140),
        messageCount: { increment: 1 },
      },
    });

    await tx.conversationParticipant.updateMany({
      where: { conversationId: input.conversationId, userId: { in: recipients } },
      data: { unreadCount: { increment: 1 }, isArchived: false },
    });

    await tx.conversationParticipant.updateMany({
      where: { conversationId: input.conversationId, userId: auth.user.id },
      data: { lastReadAt: created.createdAt, unreadCount: 0 },
    });

    return created;
  });

  if (risk.flagged) {
    await recordRiskEvent({
      userId: auth.user.id,
      type: "OFF_PLATFORM_CONTACT",
      score: 55,
      entityType: "MESSAGE",
      entityId: message.id,
      details: { reason: risk.reason },
    });
  }

  // Push to anyone watching the thread right now.
  publish(`conversation:${input.conversationId}`, {
    type: "message",
    message: {
      id: message.id,
      body: message.body,
      senderId: message.senderId,
      createdAt: message.createdAt.toISOString(),
      flagged: message.flagged,
    },
  });

  for (const recipientId of recipients) {
    publish(`user:${recipientId}`, { type: "unread", conversationId: input.conversationId });

    await notifications.newMessage({
      recipientId,
      senderName: auth.user.name,
      preview: truncate(input.body, 160),
      conversationId: input.conversationId,
      context: conversation.subject ?? undefined,
    });
  }

  return message;
}

/** Narrates a state change inside the thread. Has no sender. */
export async function postSystemMessage(
  params: {
    conversationId: string;
    systemType: string;
    body: string;
    data?: Record<string, unknown>;
  },
  client: DbClient = db,
): Promise<void> {
  const message = await client.message.create({
    data: {
      conversationId: params.conversationId,
      senderId: null,
      body: params.body,
      systemType: params.systemType,
      systemData: params.data ? stringifyJson(params.data) : null,
    },
    select: { id: true, createdAt: true },
  });

  await client.conversation.update({
    where: { id: params.conversationId },
    data: {
      lastMessageAt: message.createdAt,
      lastMessagePreview: truncate(params.body, 140),
      messageCount: { increment: 1 },
    },
  });

  publish(`conversation:${params.conversationId}`, {
    type: "message",
    message: {
      id: message.id,
      body: params.body,
      senderId: null,
      systemType: params.systemType,
      createdAt: message.createdAt.toISOString(),
    },
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listConversations(auth: AuthContext, opts: { archived?: boolean } = {}) {
  const participants = await db.conversationParticipant.findMany({
    where: { userId: auth.user.id, leftAt: null, isArchived: opts.archived ?? false },
    orderBy: { conversation: { lastMessageAt: "desc" } },
    take: 60,
    select: {
      unreadCount: true,
      lastReadAt: true,
      mutedUntil: true,
      conversation: {
        select: {
          id: true,
          type: true,
          subject: true,
          lastMessageAt: true,
          lastMessagePreview: true,
          contextType: true,
          contextId: true,
          listing: {
            select: {
              id: true,
              slug: true,
              title: true,
              priceCents: true,
              currency: true,
              status: true,
              pet: {
                select: { photos: { where: { isPrimary: true }, take: 1, select: { url: true } } },
              },
            },
          },
          participants: {
            where: { userId: { not: auth.user.id } },
            select: {
              user: { select: { id: true, name: true, handle: true, avatarUrl: true, trustScore: true, lastSeenAt: true } },
            },
          },
        },
      },
    },
  });

  return participants.map((p) => ({
    id: p.conversation.id,
    type: p.conversation.type,
    subject: p.conversation.subject,
    lastMessageAt: p.conversation.lastMessageAt,
    preview: p.conversation.lastMessagePreview,
    unreadCount: p.unreadCount,
    muted: p.mutedUntil ? p.mutedUntil > new Date() : false,
    listing: p.conversation.listing,
    contextType: p.conversation.contextType,
    contextId: p.conversation.contextId,
    counterparty: p.conversation.participants[0]?.user ?? null,
  }));
}

export async function getConversation(auth: AuthContext, conversationId: string) {
  await assertConversationAccess(conversationId, auth);

  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      type: true,
      subject: true,
      contextType: true,
      contextId: true,
      listing: {
        select: {
          id: true,
          slug: true,
          title: true,
          priceCents: true,
          currency: true,
          status: true,
          intent: true,
          sellerId: true,
          pet: {
            select: {
              id: true,
              name: true,
              photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
            },
          },
        },
      },
      participants: {
        select: {
          userId: true,
          leftAt: true,
          user: {
            select: {
              id: true,
              name: true,
              handle: true,
              avatarUrl: true,
              trustScore: true,
              lastSeenAt: true,
              city: true,
              country: true,
            },
          },
        },
      },
    },
  });
  if (!conversation) throw notFound("That conversation");

  const counterparty = conversation.participants.find((p) => p.userId !== auth.user.id);
  const blocked = counterparty
    ? await db.block.findFirst({
        where: { blockerId: auth.user.id, blockedId: counterparty.userId },
        select: { id: true },
      })
    : null;

  return {
    ...conversation,
    counterparty: counterparty?.user ?? null,
    isBlocked: Boolean(blocked),
  };
}

export async function listMessages(
  auth: AuthContext,
  conversationId: string,
  opts: { before?: Date; limit?: number } = {},
) {
  await assertConversationAccess(conversationId, auth);

  const messages = await db.message.findMany({
    where: {
      conversationId,
      deletedAt: null,
      ...(opts.before ? { createdAt: { lt: opts.before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 40, 100),
    select: {
      id: true,
      body: true,
      senderId: true,
      systemType: true,
      systemData: true,
      attachments: true,
      createdAt: true,
      editedAt: true,
      flagged: true,
      flagReason: true,
      sender: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  return messages.reverse();
}

export async function markConversationRead(auth: AuthContext, conversationId: string) {
  await assertConversationAccess(conversationId, auth);

  await db.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId: auth.user.id } },
    data: { lastReadAt: new Date(), unreadCount: 0 },
  });
}

export async function totalUnread(userId: string): Promise<number> {
  const result = await db.conversationParticipant.aggregate({
    where: { userId, leftAt: null, isArchived: false },
    _sum: { unreadCount: true },
  });
  return result._sum.unreadCount ?? 0;
}

export async function archiveConversation(auth: AuthContext, conversationId: string, archived = true) {
  await assertConversationAccess(conversationId, auth);
  await db.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId: auth.user.id } },
    data: { isArchived: archived },
  });
}

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------

export async function blockUser(auth: AuthContext, targetUserId: string, reason?: string) {
  if (targetUserId === auth.user.id) throw badRequest("You cannot block yourself.");

  const target = await db.user.findFirst({
    where: { id: targetUserId, deletedAt: null },
    select: { id: true },
  });
  if (!target) throw notFound("That member");

  await db.block.upsert({
    where: { blockerId_blockedId: { blockerId: auth.user.id, blockedId: targetUserId } },
    create: { blockerId: auth.user.id, blockedId: targetUserId, reason: reason ?? null },
    update: { reason: reason ?? null },
  });
}

export async function unblockUser(auth: AuthContext, targetUserId: string) {
  await db.block
    .delete({
      where: { blockerId_blockedId: { blockerId: auth.user.id, blockedId: targetUserId } },
    })
    .catch(() => undefined);
}

async function assertNotBlocked(senderId: string, recipientId: string): Promise<void> {
  const block = await db.block.findFirst({
    where: {
      OR: [
        { blockerId: recipientId, blockedId: senderId },
        { blockerId: senderId, blockedId: recipientId },
      ],
    },
    select: { blockerId: true },
  });

  if (block) {
    // Same message either way, so a sender cannot tell they have been blocked.
    throw forbidden("You cannot message this member.");
  }
}

export { CONVERSATION_TYPE };
