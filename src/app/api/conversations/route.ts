import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import {
  listConversations,
  getConversation,
  listMessages,
  sendMessage,
  sendMessageSchema,
  markConversationRead,
  archiveConversation,
  blockUser,
  unblockUser,
  totalUnread,
} from "@/lib/services/chat.service";
import { cuidSchema, optionalText } from "@/lib/validation/common";

export const GET = route({
  auth: true,
  query: z.object({
    id: cuidSchema.optional(),
    archived: z.coerce.boolean().optional(),
    before: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
  async handler({ query }) {
    const auth = await requireActive();

    if (query.id) {
      const [conversation, messages] = await Promise.all([
        getConversation(auth, query.id),
        listMessages(auth, query.id, {
          before: query.before ? new Date(query.before) : undefined,
          limit: query.limit,
        }),
      ]);
      return { conversation, messages };
    }

    const [conversations, unread] = await Promise.all([
      listConversations(auth, { archived: query.archived }),
      totalUnread(auth.user.id),
    ]);
    return { conversations, unread };
  },
});

export const POST = route({
  auth: true,
  rateLimit: "message",
  body: z.discriminatedUnion("action", [
    z.object({ action: z.literal("send"), message: sendMessageSchema }),
    z.object({ action: z.literal("read"), conversationId: cuidSchema }),
    z.object({
      action: z.literal("archive"),
      conversationId: cuidSchema,
      archived: z.boolean().default(true),
    }),
    z.object({ action: z.literal("block"), userId: cuidSchema, reason: optionalText(200) }),
    z.object({ action: z.literal("unblock"), userId: cuidSchema }),
  ]),
  async handler({ body }) {
    const auth = await requireActive();

    switch (body.action) {
      case "send": {
        const message = await sendMessage(auth, body.message);
        return { message };
      }
      case "read":
        await markConversationRead(auth, body.conversationId);
        return { ok: true };
      case "archive":
        await archiveConversation(auth, body.conversationId, body.archived);
        return { ok: true };
      case "block":
        await blockUser(auth, body.userId, body.reason);
        return { ok: true };
      case "unblock":
        await unblockUser(auth, body.userId);
        return { ok: true };
    }
  },
});
