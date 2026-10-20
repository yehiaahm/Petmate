import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { badRequest, conflict, rateLimited } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { normalizePhone, maskPhone } from "@/lib/phone";
import { deliverMessage, queueMessage, resolveChannel, type Channel } from "@/lib/messaging";
import { translatorFor } from "@/lib/i18n/server";
import { generateToken } from "@/lib/utils";
import { awardTrustSignal } from "./trust.service";
import { toWesternDigits } from "@/lib/digits";

/**
 * Phone verification by a six-digit code over WhatsApp or SMS.
 *
 * A verified phone is what couriers call, what cash-on-delivery depends on,
 * and one of the strongest signals that an account is a real person, so a
 * number may be verified on one account only. Six digits can be guessed, so
 * each code allows five tries, lasts ten minutes, and is stored as a keyed
 * hash that is useless without the server secret.
 */

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const RESEND_AFTER_MS = 60_000;

function codeHash(userId: string, phone: string, code: string): string {
  return createHmac("sha256", env().AUTH_SECRET).update(`phone:${userId}:${phone}:${code}`).digest("hex");
}

export async function requestPhoneCode(auth: AuthContext, rawPhone: string, preferred: Channel = "WHATSAPP") {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw badRequest("Enter a valid mobile number, such as 010 1234 5678.");

  await enforceRateLimit("phoneCode", auth.user.id);
  await enforceRateLimit("phoneCodePerNumber", phone);

  const takenBy = await db.user.findFirst({
    where: { phone, phoneVerifiedAt: { not: null }, id: { not: auth.user.id } },
    select: { id: true },
  });
  if (takenBy) throw conflict("That number is already verified on another PetMate account.");

  const recent = await db.verificationToken.findFirst({
    where: { userId: auth.user.id, purpose: "PHONE_VERIFY", consumedAt: null, createdAt: { gt: new Date(Date.now() - RESEND_AFTER_MS) } },
    select: { id: true },
  });
  if (recent) throw rateLimited(60);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const channel = resolveChannel(preferred);
  const user = await db.user.findUniqueOrThrow({ where: { id: auth.user.id }, select: { locale: true } });
  const t = translatorFor(user.locale);

  const { message } = await db.$transaction(async (tx) => {
    // One live code at a time: asking again replaces the last one.
    await tx.verificationToken.updateMany({
      where: { userId: auth.user.id, purpose: "PHONE_VERIFY", consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await tx.verificationToken.create({
      data: {
        userId: auth.user.id,
        identifier: phone,
        purpose: "PHONE_VERIFY",
        // The lookup key is random; the code's hash lives in the payload,
        // since two requests can legitimately draw the same six digits.
        tokenHash: generateToken(24),
        payload: JSON.stringify({ attempts: 0, channel, codeHash: codeHash(auth.user.id, phone, code) }),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    const message = await queueMessage(
      {
        userId: auth.user.id,
        to: phone,
        channel,
        kind: "OTP",
        body: t("Your PetMate code is {code}. It expires in 10 minutes. Never share it with anyone.", { code }),
        params: [code],
      },
      tx,
    );
    return { message };
  });

  await deliverMessage(message.id);
  return { sentTo: maskPhone(phone), channel, expiresInSeconds: CODE_TTL_MS / 1000 };
}

export async function confirmPhoneCode(auth: AuthContext, code: string) {
  const token = await db.verificationToken.findFirst({
    where: { userId: auth.user.id, purpose: "PHONE_VERIFY", consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, identifier: true, payload: true },
  });
  if (!token) throw badRequest("That code has expired. Ask for a new one.");

  const state = JSON.parse(token.payload ?? "{}") as { attempts?: number; channel?: Channel; codeHash?: string };
  const attempts = state.attempts ?? 0;
  if (attempts >= MAX_ATTEMPTS) {
    await db.verificationToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
    throw badRequest("Too many wrong codes. Ask for a new one.");
  }

  const expected = Buffer.from(state.codeHash ?? "");
  const given = Buffer.from(codeHash(auth.user.id, token.identifier, toWesternDigits(code).replace(/\D/g, "")));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    await db.verificationToken.update({
      where: { id: token.id },
      data: { payload: JSON.stringify({ ...state, attempts: attempts + 1 }) },
    });
    throw badRequest("That code is not correct.");
  }

  const phone = token.identifier;
  // Checked again at the moment of claiming: two accounts racing for one number.
  const takenBy = await db.user.findFirst({
    where: { phone, phoneVerifiedAt: { not: null }, id: { not: auth.user.id } },
    select: { id: true },
  });
  if (takenBy) throw conflict("That number is already verified on another PetMate account.");

  const consumed = await db.verificationToken.updateMany({
    where: { id: token.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count === 0) throw badRequest("That code has expired. Ask for a new one.");

  await db.user.update({
    where: { id: auth.user.id },
    data: { phone, phoneVerifiedAt: new Date(), phoneChannel: state.channel ?? "WHATSAPP" },
  });
  await awardTrustSignal(auth.user.id, "PHONE_VERIFIED");
  await audit({ action: "user.phone_verified", actorId: auth.user.id, entityType: "USER", entityId: auth.user.id, summary: maskPhone(phone) });

  return { phone, verified: true };
}

export async function setPhoneChannel(auth: AuthContext, channel: Channel) {
  await db.user.update({ where: { id: auth.user.id }, data: { phoneChannel: channel } });
  return { channel };
}
