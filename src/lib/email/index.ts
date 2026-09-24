import "server-only";
import { db, type DbClient } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { RenderedEmail } from "./templates";

export { emailTemplates } from "./templates";
export type { RenderedEmail } from "./templates";

/**
 * Outbox pattern.
 *
 * `queueEmail` writes a row inside the caller's transaction. The worker picks
 * rows up and delivers them. Two properties fall out of that:
 *
 *   * an email is never sent for a transaction that rolled back
 *   * a provider outage delays mail instead of losing it
 *
 * A direct `await resend.send()` inside a business transaction gets both of
 * those wrong, and also holds a database transaction open across a network
 * call to a third party.
 */

export interface QueueEmailInput {
  to: string;
  toName?: string | null;
  email: RenderedEmail;
  template?: string;
  category?: "TRANSACTIONAL" | "MARKETING";
}

export async function queueEmail(input: QueueEmailInput, client: DbClient = db): Promise<void> {
  await client.emailMessage.create({
    data: {
      to: input.to.toLowerCase().trim(),
      toName: input.toName ?? null,
      subject: input.email.subject,
      html: input.email.html,
      text: input.email.text,
      template: input.template ?? null,
      category: input.category ?? "TRANSACTIONAL",
      status: "QUEUED",
    },
  });
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

interface SendResult {
  ok: boolean;
  providerRef?: string;
  error?: string;
}

async function sendViaResend(message: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const key = env().RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY is not configured" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env().EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    const json = (await res.json()) as { id?: string };
    return { ok: true, providerRef: json.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Drains the outbox. Called by the worker; safe to run concurrently because
 * each row is claimed with a conditional update before it is sent.
 */
export async function processEmailQueue(limit = 25): Promise<{ sent: number; failed: number }> {
  const provider = env().EMAIL_PROVIDER;

  const pending = await db.emailMessage.findMany({
    where: { status: "QUEUED", attempts: { lt: 5 } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, to: true, subject: true, html: true, text: true, attempts: true },
  });

  let sent = 0;
  let failed = 0;

  for (const message of pending) {
    // Claim it. If another worker got there first, `count` is 0 and we skip.
    const claimed = await db.emailMessage.updateMany({
      where: { id: message.id, status: "QUEUED" },
      data: { status: "SENT", attempts: { increment: 1 }, provider },
    });
    if (claimed.count === 0) continue;

    let result: SendResult;

    if (provider === "resend") {
      result = await sendViaResend(message);
    } else {
      // The outbox provider is the development default. It does not pretend to
      // deliver: the row stays in the database and is readable at /dev/mailbox,
      // and `assertProductionSafety` refuses to boot production with it.
      logger.info("email queued to outbox (not delivered)", {
        to: message.to,
        subject: message.subject,
      });
      result = { ok: true, providerRef: "outbox" };
    }

    if (result.ok) {
      sent++;
      await db.emailMessage.update({
        where: { id: message.id },
        data: { status: "SENT", sentAt: new Date(), providerRef: result.providerRef ?? null, error: null },
      });
    } else {
      failed++;
      const permanent = message.attempts + 1 >= 5;
      await db.emailMessage.update({
        where: { id: message.id },
        data: {
          status: permanent ? "FAILED" : "QUEUED",
          error: result.error?.slice(0, 500) ?? "unknown error",
        },
      });
      logger.error("email delivery failed", {
        id: message.id,
        attempts: message.attempts + 1,
        permanent,
        error: result.error,
      });
    }
  }

  return { sent, failed };
}
