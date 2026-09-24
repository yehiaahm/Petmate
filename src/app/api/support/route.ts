import { z } from "zod";
import { route } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { safeParagraph } from "@/lib/validation/common";
import {
  supportTicketSchema,
  createSupportTicket,
  getSupportTicket,
  listMySupportTickets,
  replyToSupportTicket,
  listSupportQueue,
  setSupportTicketStatus,
  isSupportStaff,
} from "@/lib/services/support.service";

const referenceSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^SUP-[A-Z0-9]{4,16}$/, "That does not look like a support reference.");

export const GET = route({
  query: z.object({
    mode: z.enum(["ticket", "mine", "queue"]).default("mine"),
    reference: referenceSchema.optional(),
    status: z.string().max(32).optional(),
  }),
  async handler({ query, auth }) {
    const staff = isSupportStaff(auth);

    if (query.mode === "queue") {
      // No 403 here either: a non-staff caller is told the mode does not exist
      // for them, not that a staff queue is sitting behind this parameter.
      if (!staff) return { tickets: [] };
      return { tickets: await listSupportQueue({ status: query.status }) };
    }

    if (query.mode === "ticket") {
      if (!query.reference) return { ticket: null };
      // Signed-in only. An anonymous visitor uses the POST "view" action so
      // their email address never travels in a query string.
      if (!auth) return { ticket: null };
      const ticket = await getSupportTicket(query.reference, {
        userId: auth.user.id,
        email: auth.user.email,
        isStaff: staff,
      });
      return { ticket };
    }

    if (!auth) return { tickets: [] };
    return { tickets: await listMySupportTickets(auth.user.id, auth.user.email) };
  },
});

export const POST = route({
  // Deliberately unauthenticated: "I cannot sign in" has to be reportable.
  rateLimit: "supportReply",
  body: z.discriminatedUnion("action", [
    z.object({ action: z.literal("create"), ticket: supportTicketSchema }),
    z.object({
      action: z.literal("view"),
      reference: referenceSchema,
      // POST rather than GET purely so this never appears in a query string.
      email: z.string().email().optional(),
    }),
    z.object({
      action: z.literal("reply"),
      reference: referenceSchema,
      email: z.string().email().optional(),
      body: safeParagraph(4000, 2),
    }),
    z.object({
      action: z.literal("status"),
      reference: referenceSchema,
      status: z.enum(["OPEN", "AWAITING_USER", "RESOLVED", "CLOSED"]),
    }),
  ]),
  async handler({ body, auth, ip }) {
    switch (body.action) {
      case "create": {
        // Opening a ticket is far more expensive than reading or replying to
        // one, so it gets its own, much tighter bucket on top of the route's.
        await enforceRateLimit("supportTicket", auth?.user.id ?? ip ?? "anonymous");

        // A signed-in user cannot open a ticket under someone else's identity:
        // their own account details win over whatever the form posted.
        const input = auth
          ? { ...body.ticket, name: auth.user.name, email: auth.user.email }
          : body.ticket;

        const ticket = await createSupportTicket(input, {
          userId: auth?.user.id ?? null,
          ip,
        });

        await audit({
          actorId: auth?.user.id ?? null,
          action: "support.ticket_opened",
          entityType: "SupportTicket",
          entityId: ticket.id,
          summary: `${body.ticket.topic}: ${body.ticket.subject}`,
        });

        return { reference: ticket.reference };
      }

      case "view": {
        const ticket = await getSupportTicket(body.reference, {
          userId: auth?.user.id ?? null,
          email: body.email ?? auth?.user.email ?? null,
          isStaff: isSupportStaff(auth),
        });
        return { ticket };
      }

      case "reply": {
        const staff = isSupportStaff(auth);
        await replyToSupportTicket(body.reference, body.body, {
          userId: auth?.user.id ?? null,
          // Server-derived when signed in; otherwise the service falls back to
          // the name the ticket was opened with.
          name: auth?.user.name ?? null,
          email: body.email ?? auth?.user.email ?? null,
          isStaff: staff,
        });
        return { ok: true };
      }

      case "status": {
        if (!auth || !isSupportStaff(auth)) {
          // Same shape as an unknown reference, for the same reason.
          const { notFound } = await import("@/lib/errors");
          throw notFound("That request");
        }
        await setSupportTicketStatus(auth, body.reference, body.status);
        return { ok: true };
      }
    }
  },
});
