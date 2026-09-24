import "server-only";
import { z } from "zod";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { readableCode } from "@/lib/utils";
import { notFound, conflict } from "@/lib/errors";
import { queueEmail, emailTemplates } from "@/lib/email";
import { notify } from "@/lib/services/notification.service";
import { clientEnv, env } from "@/lib/env";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/session";
import { permissionsFor } from "@/lib/auth/rbac";
import { safeText, safeParagraph, emailSchema, optionalText } from "@/lib/validation/common";
import { SUPPORT_TOPICS, type SupportTopic } from "@/lib/support-topics";
import { getEntitlements } from "@/lib/billing/entitlements";

/**
 * Support tickets.
 *
 * Anyone can open one, including a signed-out visitor, because "I cannot log
 * in" is the single most common reason to contact support and requiring a
 * login to report it would be circular. That means the write path is
 * unauthenticated, so it is rate limited by IP and the IP is stored hashed for
 * abuse investigation rather than in the clear.
 */

// The vocabulary lives in a client-safe module: importing it from here into a
// client component would pull `server-only` and Prisma into the browser bundle.
export { SUPPORT_TOPICS, SUPPORT_TOPIC_LABEL, type SupportTopic } from "@/lib/support-topics";

/** Topics we treat as urgent on arrival rather than waiting for triage. */
const HIGH_PRIORITY_TOPICS = new Set<SupportTopic>(["SAFETY", "PAYMENT"]);

/**
 * Queue order, most pressing first. Priority is stored as a word, and sorting
 * the words alphabetically would put URGENT last, so the order is explicit.
 */
export const SUPPORT_PRIORITY_ORDER = ["URGENT", "HIGH", "NORMAL", "LOW"] as const;

/**
 * The priority a new ticket opens at. Safety and payment problems are high
 * for everyone; a subscriber whose plan includes priority support gets the
 * same treatment for everything else, which is what that line on the pricing
 * page promises. URGENT is left for staff to escalate to by hand.
 */
export function initialTicketPriority(topic: SupportTopic, prioritySupport: boolean): "HIGH" | "NORMAL" {
  return HIGH_PRIORITY_TOPICS.has(topic) || prioritySupport ? "HIGH" : "NORMAL";
}

export const supportTicketSchema = z.object({
  name: safeText(80, 2),
  email: emailSchema,
  topic: z.enum(SUPPORT_TOPICS),
  subject: safeText(140, 5),
  message: safeParagraph(4000, 20),
  orderRef: optionalText(64),
});

export type SupportTicketInput = z.infer<typeof supportTicketSchema>;

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  // Salted with the app secret so the hashes are useless outside this install.
  return createHash("sha256").update(`${env().AUTH_SECRET}:${ip}`).digest("hex").slice(0, 32);
}

export async function createSupportTicket(
  input: SupportTicketInput,
  context: { userId?: string | null; ip?: string | null },
): Promise<{ reference: string; id: string }> {
  const email = input.email.toLowerCase().trim();

  // One unresolved ticket per person per subject stops a double-submitted form
  // from creating two threads that get two different answers.
  const duplicate = await db.supportTicket.findFirst({
    where: {
      email,
      subject: input.subject,
      status: { in: ["OPEN", "AWAITING_USER"] },
      createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
    },
    select: { id: true, reference: true },
  });
  if (duplicate) return duplicate;

  const topic = input.topic as SupportTopic;
  const prioritySupport = context.userId
    ? (await getEntitlements(context.userId)).prioritySupport
    : false;

  const ticket = await db.$transaction(async (tx) => {
    const created = await tx.supportTicket.create({
      data: {
        reference: `SUP-${readableCode(8)}`,
        userId: context.userId ?? null,
        email,
        name: input.name,
        topic,
        subject: input.subject,
        orderRef: input.orderRef ?? null,
        ipHash: hashIp(context.ip ?? null),
        priority: initialTicketPriority(topic, prioritySupport),
        status: "OPEN",
        messages: {
          create: {
            authorId: context.userId ?? null,
            authorName: input.name,
            isStaff: false,
            body: input.message,
          },
        },
      },
      select: { id: true, reference: true },
    });

    // Written inside the transaction: the acknowledgement cannot be sent for a
    // ticket that failed to save.
    await queueEmail(
      {
        to: email,
        toName: input.name,
        template: "support.received",
        email: emailTemplates.generic({
          subject: `We got your message (${created.reference})`,
          heading: "We have your message",
          body:
            `Thanks ${input.name}. Your reference is ${created.reference}. ` +
            `We read every message and reply by email, usually within one working day. ` +
            `Urgent animal-welfare reports are handled first.`,
          cta: { label: "Track this request", url: `${clientEnv.NEXT_PUBLIC_APP_URL}/support/${created.reference}` },
        }),
      },
      tx,
    );

    return created;
  });

  return ticket;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface SupportTicketView {
  id: string;
  reference: string;
  subject: string;
  topic: SupportTopic;
  status: string;
  priority: string;
  createdAt: Date;
  lastReplyAt: Date;
  messages: {
    id: string;
    authorName: string;
    isStaff: boolean;
    body: string;
    createdAt: Date;
  }[];
}

/**
 * Look a ticket up by reference.
 *
 * The reference is an 8-character code, which is not a secret strong enough to
 * be the only thing protecting a thread. So a signed-in user may only see
 * their own tickets, and an anonymous visitor must also supply the email the
 * ticket was opened with. Both wrong-email and no-such-ticket return the same
 * "not found", so the endpoint is not an oracle for which references exist.
 */
export async function getSupportTicket(
  reference: string,
  viewer: { userId?: string | null; email?: string | null; isStaff?: boolean },
): Promise<SupportTicketView> {
  const ticket = await db.supportTicket.findUnique({
    where: { reference: reference.toUpperCase() },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, authorName: true, isStaff: true, body: true, createdAt: true },
      },
    },
  });

  if (!ticket) throw notFound("That request");

  const allowed =
    viewer.isStaff === true ||
    (ticket.userId != null && ticket.userId === viewer.userId) ||
    (viewer.email != null && viewer.email.toLowerCase().trim() === ticket.email);

  if (!allowed) throw notFound("That request");

  return {
    id: ticket.id,
    reference: ticket.reference,
    subject: ticket.subject,
    topic: ticket.topic as SupportTopic,
    status: ticket.status,
    priority: ticket.priority,
    createdAt: ticket.createdAt,
    lastReplyAt: ticket.lastReplyAt,
    messages: ticket.messages,
  };
}

export async function listMySupportTickets(userId: string, email: string) {
  return db.supportTicket.findMany({
    where: { OR: [{ userId }, { email: email.toLowerCase().trim() }] },
    orderBy: { lastReplyAt: "desc" },
    take: 50,
    select: {
      id: true,
      reference: true,
      subject: true,
      topic: true,
      status: true,
      lastReplyAt: true,
      createdAt: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Replying
// ---------------------------------------------------------------------------

export async function replyToSupportTicket(
  reference: string,
  body: string,
  author: { userId?: string | null; name?: string | null; email?: string | null; isStaff?: boolean },
): Promise<void> {
  const ticket = await getSupportTicket(reference, {
    userId: author.userId,
    email: author.email,
    isStaff: author.isStaff,
  });

  if (ticket.status === "CLOSED") {
    throw conflict("This request is closed. Open a new one and we will pick it up.");
  }

  // An anonymous replier is whoever opened the ticket, by definition: they had
  // to know the reference and the email to get this far. Trusting a name posted
  // from the browser would let the thread be signed with anyone's.
  const owner = await db.supportTicket.findUnique({
    where: { id: ticket.id },
    select: { name: true },
  });

  await db.$transaction(async (tx) => {
    await tx.supportMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: author.userId ?? null,
        authorName: author.isStaff
          ? "PetMate Support"
          : (author.name ?? owner?.name ?? "Member"),
        isStaff: author.isStaff === true,
        body,
      },
    });

    await tx.supportTicket.update({
      where: { id: ticket.id },
      data: {
        lastReplyAt: new Date(),
        // A staff reply puts the ball in the user's court; a user reply puts it
        // back in ours. Neither ever reopens a CLOSED ticket.
        status: author.isStaff ? "AWAITING_USER" : "OPEN",
      },
    });

    if (author.isStaff) {
      const full = await tx.supportTicket.findUnique({
        where: { id: ticket.id },
        select: { email: true, name: true, userId: true, reference: true, subject: true },
      });
      if (full) {
        await queueEmail(
          {
            to: full.email,
            toName: full.name,
            template: "support.reply",
            email: emailTemplates.generic({
              subject: `Re: ${full.subject} (${full.reference})`,
              heading: "Support replied",
              body,
              cta: {
                label: "Read and reply",
                url: `${clientEnv.NEXT_PUBLIC_APP_URL}/support/${full.reference}`,
              },
            }),
          },
          tx,
        );
        if (full.userId) {
          await notify(
            {
              userId: full.userId,
              category: "SYSTEM",
              type: "support.reply",
              title: `Support replied to ${full.reference}`,
              body: body.slice(0, 160),
              url: `/support/${full.reference}`,
              skipInApp: false,
            },
            tx,
          );
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export function isSupportStaff(auth: AuthContext | null): boolean {
  if (!auth) return false;
  return permissionsFor(auth.user.roles).has("admin:moderation");
}

const QUEUE_SIZE = 100;

export async function listSupportQueue(filter: { status?: string; topic?: string } = {}) {
  const where = {
    ...(filter.status ? { status: filter.status } : { status: { in: ["OPEN", "AWAITING_USER"] } }),
    ...(filter.topic ? { topic: filter.topic } : {}),
  };

  // One indexed read per priority level, most pressing first, until the page is
  // full. That is exact where an in-memory sort of a bounded read is not: a
  // backlog of old NORMAL tickets can never push an URGENT one off the page.
  const queue: Awaited<ReturnType<typeof readQueueLevel>> = [];
  for (const priority of SUPPORT_PRIORITY_ORDER) {
    if (queue.length >= QUEUE_SIZE) break;
    queue.push(...(await readQueueLevel(where, priority, QUEUE_SIZE - queue.length)));
  }
  return queue;
}

function readQueueLevel(
  where: { status: string | { in: string[] }; topic?: string },
  priority: string,
  take: number,
) {
  return db.supportTicket.findMany({
    where: { ...where, priority },
    orderBy: { lastReplyAt: "asc" },
    take,
    select: {
      id: true,
      reference: true,
      subject: true,
      topic: true,
      status: true,
      priority: true,
      name: true,
      email: true,
      userId: true,
      createdAt: true,
      lastReplyAt: true,
      _count: { select: { messages: true } },
    },
  });
}

export async function setSupportTicketStatus(
  auth: AuthContext,
  reference: string,
  status: "OPEN" | "AWAITING_USER" | "RESOLVED" | "CLOSED",
): Promise<void> {
  const ticket = await db.supportTicket.findUnique({
    where: { reference: reference.toUpperCase() },
    select: { id: true, reference: true },
  });
  if (!ticket) throw notFound("That request");

  await db.supportTicket.update({
    where: { id: ticket.id },
    data: {
      status,
      resolvedAt: status === "RESOLVED" || status === "CLOSED" ? new Date() : null,
      assignedToId: auth.user.id,
    },
  });

  await audit({
    actorId: auth.user.id,
    action: "support.status_changed",
    entityType: "SupportTicket",
    entityId: ticket.id,
    summary: `${ticket.reference} -> ${status}`,
  });
}
