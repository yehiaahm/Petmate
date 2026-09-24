import "server-only";
import { db, type DbClient } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * WhatsApp and SMS.
 *
 * Every message goes through the OutboundMessage table first, for the same
 * reasons email does: a provider outage delays a message instead of losing
 * it, and there is a record of what was sent to whom. Verification codes are
 * also sent straight away, because nobody waits for a worker tick at a
 * sign-up screen.
 *
 * WhatsApp is the default channel in Egypt, where nearly every phone has it.
 * A business may only start a WhatsApp conversation with a template Meta has
 * approved, so both kinds of message are templates: the code, and a general
 * update carrying the text and a link.
 */

export type Channel = "WHATSAPP" | "SMS";
const MAX_ATTEMPTS = 5;

export function channelAvailable(channel: Channel): boolean {
  const e = env();
  return channel === "WHATSAPP" ? e.WHATSAPP_PROVIDER !== "log" : e.SMS_PROVIDER !== "log";
}

/** In development everything "sends" to the log; in production only configured channels exist. */
export function resolveChannel(preferred: Channel): Channel {
  if (channelAvailable(preferred)) return preferred;
  const other: Channel = preferred === "WHATSAPP" ? "SMS" : "WHATSAPP";
  return channelAvailable(other) ? other : preferred;
}

export interface QueueMessageInput {
  userId?: string | null;
  to: string;
  channel: Channel;
  kind: "OTP" | "NOTIFICATION";
  /** Plain text, used for SMS and as the record of what was said. */
  body: string;
  /** WhatsApp template parameters, in order. */
  params: string[];
}

export async function queueMessage(input: QueueMessageInput, client: DbClient = db) {
  const e = env();
  const template =
    input.channel === "WHATSAPP" ? (input.kind === "OTP" ? e.META_WHATSAPP_OTP_TEMPLATE : e.META_WHATSAPP_UPDATE_TEMPLATE) : null;
  return client.outboundMessage.create({
    data: {
      userId: input.userId ?? null,
      channel: input.channel,
      to: input.to,
      kind: input.kind,
      body: input.body.slice(0, 1000),
      template,
      params: JSON.stringify(input.params.map((p) => p.slice(0, 900))),
    },
    select: { id: true },
  });
}

type SendResult = { ok: true; providerRef: string | null } | { ok: false; error: string; permanent?: boolean };

interface Message {
  id: string;
  channel: string;
  to: string;
  kind: string;
  body: string;
  template: string | null;
  params: string | null;
  attempts: number;
}

async function sendWhatsApp(message: Message, language: string): Promise<SendResult> {
  const e = env();
  if (e.WHATSAPP_PROVIDER === "log") {
    logger.info("whatsapp message (not sent: WHATSAPP_PROVIDER=log)", { to: message.to, body: message.body });
    return { ok: true, providerRef: "log" };
  }
  const params = JSON.parse(message.params ?? "[]") as string[];
  const bodyParams = params.map((text) => ({ type: "text", text }));
  const components: unknown[] = [{ type: "body", parameters: bodyParams }];
  // Authentication templates carry the code on a copy-code button as well.
  if (message.kind === "OTP") {
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: params[0] ?? "" }] });
  }

  const response = await fetch(`https://graph.facebook.com/v21.0/${e.META_WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${e.META_WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: message.to.replace(/^\+/, ""),
      type: "template",
      template: { name: message.template, language: { code: language === "ar" ? "ar" : "en" }, components },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    messages?: { id: string }[];
    error?: { message?: string; code?: number };
  };
  if (!response.ok) {
    // 131026: the number is not on WhatsApp. Retrying will not change that.
    const permanent = body.error?.code === 131026 || response.status === 400;
    return { ok: false, error: `meta ${response.status}: ${body.error?.message ?? "unknown"}`, permanent };
  }
  return { ok: true, providerRef: body.messages?.[0]?.id ?? null };
}

async function sendSms(message: Message): Promise<SendResult> {
  const e = env();
  if (e.SMS_PROVIDER === "log") {
    logger.info("sms message (not sent: SMS_PROVIDER=log)", { to: message.to, body: message.body });
    return { ok: true, providerRef: "log" };
  }
  const form = new URLSearchParams({ To: message.to, Body: message.body });
  if (e.TWILIO_FROM!.startsWith("MG")) form.set("MessagingServiceSid", e.TWILIO_FROM!);
  else form.set("From", e.TWILIO_FROM!);

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${e.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
  if (!response.ok) {
    return { ok: false, error: `twilio ${response.status}: ${body.message ?? "unknown"}`, permanent: response.status === 400 };
  }
  return { ok: true, providerRef: body.sid ?? null };
}

/** Sends one queued message. Safe to call from the worker and inline at once. */
export async function deliverMessage(id: string): Promise<"sent" | "failed" | "skipped"> {
  const claimed = await db.outboundMessage.updateMany({
    where: { id, status: "QUEUED", attempts: { lt: MAX_ATTEMPTS } },
    data: { status: "SENDING", attempts: { increment: 1 }, claimedAt: new Date() },
  });
  if (claimed.count === 0) return "skipped";

  const message = await db.outboundMessage.findUniqueOrThrow({
    where: { id },
    select: { id: true, channel: true, to: true, kind: true, body: true, template: true, params: true, attempts: true, userId: true },
  });
  const language = message.userId
    ? ((await db.user.findUnique({ where: { id: message.userId }, select: { locale: true } }))?.locale ?? "ar")
    : "ar";

  let result: SendResult;
  try {
    result = message.channel === "WHATSAPP" ? await sendWhatsApp(message, language) : await sendSms(message);
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (result.ok) {
    await db.outboundMessage.update({
      where: { id },
      data: { status: "SENT", sentAt: new Date(), providerRef: result.providerRef, error: null, provider: message.channel === "WHATSAPP" ? env().WHATSAPP_PROVIDER : env().SMS_PROVIDER },
    });
    return "sent";
  }

  const giveUp = result.permanent || message.attempts >= MAX_ATTEMPTS;
  await db.outboundMessage.update({
    where: { id },
    data: { status: giveUp ? "FAILED" : "QUEUED", error: result.error.slice(0, 500) },
  });
  logger.error("phone message delivery failed", { id, channel: message.channel, attempts: message.attempts, error: result.error });
  return "failed";
}

/** Run by the `messages.process` job. */
export async function processMessageQueue(limit = 50): Promise<{ sent: number; failed: number }> {
  const pending = await db.outboundMessage.findMany({
    where: { status: "QUEUED", attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let sent = 0;
  let failed = 0;
  for (const { id } of pending) {
    const outcome = await deliverMessage(id);
    if (outcome === "sent") sent++;
    if (outcome === "failed") failed++;
  }
  // A worker that died mid-send leaves SENDING rows; after ten minutes they go back in the queue.
  await db.outboundMessage.updateMany({
    where: { status: "SENDING", claimedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
    data: { status: "QUEUED" },
  });
  return { sent, failed };
}
