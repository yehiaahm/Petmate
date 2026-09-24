import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db, makeUser, resetDatabase } from "./helpers";
import { resetEnvForTests } from "@/lib/env";
import { normalizePhone, formatPhone, maskPhone } from "@/lib/phone";
import { requestPhoneCode, confirmPhoneCode } from "@/lib/services/phone.service";
import { notify } from "@/lib/services/notification.service";
import { deliverMessage, processMessageQueue, queueMessage } from "@/lib/messaging";

/**
 * Phone verification and the WhatsApp/SMS outbox. Codes are read back from
 * the outbox row, the way a person reads them off their phone.
 */

const saved = { ...process.env };

async function lastCodeSentTo(phone: string): Promise<string> {
  const row = await db.outboundMessage.findFirstOrThrow({ where: { to: phone, kind: "OTP" }, orderBy: { createdAt: "desc" } });
  return (JSON.parse(row.params ?? "[]") as string[])[0]!;
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...saved };
  resetEnvForTests();
});

describe("Egyptian numbers", () => {
  it("normalises every common way of writing one", () => {
    for (const raw of ["01012345678", "+20 101 234 5678", "00201012345678", "٠١٠١٢٣٤٥٦٧٨", "201012345678", "(010) 1234-5678"]) {
      expect(normalizePhone(raw)).toBe("+201012345678");
    }
    expect(normalizePhone("01112345678")).toBe("+201112345678");
    expect(normalizePhone("01512345678")).toBe("+201512345678");
  });

  it("rejects numbers that are not Egyptian mobiles", () => {
    expect(normalizePhone("0101234567")).toBeNull(); // too short
    expect(normalizePhone("01312345678")).toBeNull(); // no such network
    expect(normalizePhone("0223456789")).toBeNull(); // a Cairo landline
    expect(normalizePhone("hello")).toBeNull();
  });

  it("formats and masks for display", () => {
    expect(formatPhone("+201012345678")).toBe("+20 101 234 5678");
    expect(maskPhone("+201012345678")).toBe("•••• 5678");
  });
});

describe("verifying a number", () => {
  it("verifies with the code that was sent, over WhatsApp by default", async () => {
    const user = await makeUser();
    const sent = await requestPhoneCode(user.auth, "010 1234 5678");
    expect(sent).toMatchObject({ sentTo: "•••• 5678", channel: "WHATSAPP" });

    const message = await db.outboundMessage.findFirstOrThrow({ where: { to: "+201012345678" } });
    expect(message.status).toBe("SENT"); // delivered inline, not left for the worker
    expect(message.body).not.toContain("undefined");

    await confirmPhoneCode(user.auth, await lastCodeSentTo("+201012345678"));
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true, phoneVerifiedAt: true } });
    expect(row.phone).toBe("+201012345678");
    expect(row.phoneVerifiedAt).not.toBeNull();
    expect(await db.trustSignal.count({ where: { userId: user.id, kind: "PHONE_VERIFIED" } })).toBe(1);
  });

  it("accepts the code typed on an Arabic keyboard", async () => {
    const user = await makeUser();
    await requestPhoneCode(user.auth, "٠١٠١٢٣٤٥٦٧٨");
    const code = await lastCodeSentTo("+201012345678");
    const arabic = code.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
    await confirmPhoneCode(user.auth, arabic);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).phoneVerifiedAt).not.toBeNull();
  });

  it("allows five tries per code", async () => {
    const user = await makeUser();
    await requestPhoneCode(user.auth, "01012345678");
    const code = await lastCodeSentTo("+201012345678");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await expect(confirmPhoneCode(user.auth, wrong)).rejects.toThrow(/not correct/);
    await expect(confirmPhoneCode(user.auth, code)).rejects.toThrow(/Too many wrong codes/);
  });

  it("does not resend within a minute", async () => {
    const user = await makeUser();
    await requestPhoneCode(user.auth, "01012345678");
    await expect(requestPhoneCode(user.auth, "01012345678")).rejects.toThrow();
  });

  it("verifies a number on one account only", async () => {
    const first = await makeUser();
    await requestPhoneCode(first.auth, "01012345678");
    await confirmPhoneCode(first.auth, await lastCodeSentTo("+201012345678"));

    const second = await makeUser();
    await expect(requestPhoneCode(second.auth, "+20 10 1234 5678")).rejects.toThrow(/another PetMate account/);
  });

  it("refuses a code sent for a different account", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await requestPhoneCode(a.auth, "01012345678");
    await requestPhoneCode(b.auth, "01112345678");
    await expect(confirmPhoneCode(b.auth, await lastCodeSentTo("+201012345678"))).rejects.toThrow(/not correct|expired/);
  });
});

describe("phone notifications", () => {
  async function verified() {
    const user = await makeUser();
    await requestPhoneCode(user.auth, "01012345678");
    await confirmPhoneCode(user.auth, await lastCodeSentTo("+201012345678"));
    return user;
  }

  it("sends order updates to a verified number, in the recipient's language", async () => {
    const user = await verified();
    await db.user.update({ where: { id: user.id }, data: { locale: "ar" } });
    await notify({ userId: user.id, category: "ORDER", type: "order.shipped", title: "Order cancelled", url: "/dashboard/orders/1" });

    const message = await db.outboundMessage.findFirstOrThrow({ where: { userId: user.id, kind: "NOTIFICATION" } });
    const [text, link] = JSON.parse(message.params!) as string[];
    expect(text).not.toBe("Order cancelled");
    expect(link).toMatch(/\/dashboard\/orders\/1$/);
  });

  it("stays quiet for categories that are off by default, and for unverified numbers", async () => {
    const user = await verified();
    await notify({ userId: user.id, category: "COMMUNITY", type: "community.comment", title: "New comment" });
    const unverified = await makeUser();
    await db.user.update({ where: { id: unverified.id }, data: { phone: "+201112345678" } });
    await notify({ userId: unverified.id, category: "ORDER", type: "order.paid", title: "Paid" });
    expect(await db.outboundMessage.count({ where: { kind: "NOTIFICATION" } })).toBe(0);
  });
});

describe("providers", () => {
  it("sends WhatsApp templates through Meta and SMS through Twilio", async () => {
    process.env.WHATSAPP_PROVIDER = "meta";
    process.env.META_WHATSAPP_TOKEN = "meta-token";
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = "12345";
    process.env.SMS_PROVIDER = "twilio";
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "secret";
    process.env.TWILIO_FROM = "PetMate";
    resetEnvForTests();

    const requests: { url: string; body: string; auth: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push({ url: String(url), body: String(init.body), auth: new Headers(init.headers).get("authorization") });
      return String(url).includes("facebook")
        ? new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 })
        : new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
    });

    const wa = await queueMessage({ to: "+201012345678", channel: "WHATSAPP", kind: "OTP", body: "code 123456", params: ["123456"] });
    const sms = await queueMessage({ to: "+201012345678", channel: "SMS", kind: "NOTIFICATION", body: "Your order shipped", params: [] });
    await processMessageQueue();

    expect(requests[0]!.url).toBe("https://graph.facebook.com/v21.0/12345/messages");
    expect(JSON.parse(requests[0]!.body)).toMatchObject({ to: "201012345678", type: "template", template: { name: "petmate_verification_code" } });
    expect(requests[1]!.url).toContain("/Accounts/AC123/Messages.json");
    expect(requests[1]!.body).toContain("From=PetMate");
    expect(requests[1]!.auth).toMatch(/^Basic /);

    expect((await db.outboundMessage.findUniqueOrThrow({ where: { id: wa.id } })).providerRef).toBe("wamid.1");
    expect((await db.outboundMessage.findUniqueOrThrow({ where: { id: sms.id } })).status).toBe("SENT");
  });

  it("retries a temporary failure and gives up on a permanent one", async () => {
    process.env.SMS_PROVIDER = "twilio";
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "secret";
    process.env.TWILIO_FROM = "MG123";
    resetEnvForTests();

    let status = 503;
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ message: "nope" }), { status }));
    const msg = await queueMessage({ to: "+201012345678", channel: "SMS", kind: "NOTIFICATION", body: "hi", params: [] });

    expect(await deliverMessage(msg.id)).toBe("failed");
    expect((await db.outboundMessage.findUniqueOrThrow({ where: { id: msg.id } })).status).toBe("QUEUED");

    status = 400;
    expect(await deliverMessage(msg.id)).toBe("failed");
    expect((await db.outboundMessage.findUniqueOrThrow({ where: { id: msg.id } })).status).toBe("FAILED");
    expect(await deliverMessage(msg.id)).toBe("skipped");
  });
});
