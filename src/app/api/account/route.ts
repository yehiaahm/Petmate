import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { badRequest, conflict } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { requestPhoneCode, confirmPhoneCode, setPhoneChannel } from "@/lib/services/phone.service";
import { audit } from "@/lib/audit";
import {
  changePassword,
  listSessions,
  revokeSession,
} from "@/lib/services/auth.service";
import { revokeAllSessions, destroySession } from "@/lib/auth/session";
import {
  beginTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
  regenerateBackupCodes,
} from "@/lib/services/two-factor.service";
import { awardTrustSignal, getTrustBreakdown } from "@/lib/services/trust.service";
import { assertOwnsFile } from "@/lib/services/upload.service";
import { getUsage } from "@/lib/billing/entitlements";
import {
  startSubscription,
  cancelSubscription,
  resumeSubscription,
  getCurrentSubscription,
  listPlans,
  getBillingHistory,
} from "@/lib/services/subscription.service";
import {
  safeText,
  safeParagraph,
  optionalText,
  handleSchema,
  phoneSchema,
  passwordSchema,
  cuidSchema,
} from "@/lib/validation/common";
import { LIMITS } from "@/lib/constants";
import { LOCALES } from "@/lib/i18n/config";

export const GET = route({
  auth: true,
  query: z.object({
    mode: z.enum(["profile", "sessions", "trust", "billing"]).default("profile"),
  }),
  async handler({ query }) {
    const auth = await requireActive();

    if (query.mode === "sessions") {
      const sessions = await listSessions(auth.user.id, auth.sessionId);
      return { sessions };
    }

    if (query.mode === "trust") {
      return getTrustBreakdown(auth.user.id);
    }

    if (query.mode === "billing") {
      const [subscription, plans, usage, invoices] = await Promise.all([
        getCurrentSubscription(auth.user.id),
        listPlans(),
        getUsage(auth.user.id),
        getBillingHistory(auth.user.id),
      ]);
      return { subscription, plans, ...usage, invoices };
    }

    const profile = await db.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        handle: true,
        avatarUrl: true,
        bannerUrl: true,
        bio: true,
        phone: true,
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
        country: true,
        region: true,
        city: true,
        postalCode: true,
        lat: true,
        lng: true,
        currency: true,
        trustScore: true,
        createdAt: true,
        roles: { select: { role: true } },
        notifPrefs: { select: { category: true, inApp: true, email: true } },
      },
    });

    return { profile };
  },
});

export const POST = route({
  auth: true,
  body: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("update-profile"),
      name: safeText(80, 2).optional(),
      handle: handleSchema.optional(),
      bio: safeParagraph(LIMITS.bioMax, 0).optional(),
      phone: phoneSchema.optional(),
      country: optionalText(60),
      region: optionalText(80),
      city: optionalText(80),
      postalCode: optionalText(20),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      avatarFileId: cuidSchema.optional(),
      bannerFileId: cuidSchema.optional(),
    }),
    z.object({
      action: z.literal("change-password"),
      currentPassword: z.string().min(1).max(200),
      newPassword: passwordSchema,
    }),
    z.object({ action: z.literal("set-locale"), locale: z.enum(LOCALES) }),
    z.object({ action: z.literal("revoke-session"), sessionId: cuidSchema }),
    z.object({ action: z.literal("revoke-all-sessions") }),
    z.object({
      action: z.literal("subscribe"),
      planCode: z.string().min(1).max(40),
      interval: z.enum(["MONTH", "YEAR"]),
      idempotencyKey: z.string().min(8).max(64),
    }),
    z.object({ action: z.literal("cancel-subscription"), immediate: z.boolean().default(false) }),
    z.object({ action: z.literal("resume-subscription") }),
    z.object({ action: z.literal("delete-account"), confirm: z.literal("DELETE") }),
    z.object({ action: z.literal("2fa-begin") }),
    z.object({ action: z.literal("phone-code"), phone: z.string().trim().min(6).max(30), channel: z.enum(["WHATSAPP", "SMS"]).default("WHATSAPP") }),
    z.object({ action: z.literal("phone-confirm"), code: z.string().trim().min(6).max(10) }),
    z.object({ action: z.literal("phone-channel"), channel: z.enum(["WHATSAPP", "SMS"]) }),
    z.object({ action: z.literal("2fa-confirm"), code: z.string().trim().min(6).max(8) }),
    z.object({
      action: z.literal("2fa-disable"),
      password: z.string().min(1).max(200),
      code: z.string().trim().min(6).max(20),
    }),
    z.object({ action: z.literal("2fa-backup-codes"), code: z.string().trim().min(6).max(20) }),
  ]),
  async handler({ body, ip }) {
    const auth = await requireActive();

    switch (body.action) {
      case "set-locale": {
        // Stored so email, SMS and notifications written without a request
        // (by the worker) arrive in the language the person chose.
        await db.user.update({ where: { id: auth.user.id }, data: { locale: body.locale } });
        return { ok: true };
      }
      case "update-profile": {
        if (body.handle && body.handle !== auth.user.handle) {
          const taken = await db.user.findUnique({
            where: { handle: body.handle },
            select: { id: true },
          });
          if (taken) throw conflict("That handle is already taken.");
        }

        // A changed number is an unverified number until the owner proves it again.
        let phoneChange: { phone: string | null; phoneVerifiedAt?: null } | null = null;
        if (body.phone !== undefined) {
          const normalized = body.phone ? normalizePhone(body.phone) : null;
          if (body.phone && !normalized) throw badRequest("Enter a valid mobile number, such as 010 1234 5678.");
          const current = await db.user.findUniqueOrThrow({ where: { id: auth.user.id }, select: { phone: true } });
          phoneChange = normalized === current.phone ? null : { phone: normalized, phoneVerifiedAt: null };
        }

        // Images must be files this user uploaded.
        const avatar = body.avatarFileId
          ? await assertOwnsFile(body.avatarFileId, auth.user.id)
          : null;
        const banner = body.bannerFileId
          ? await assertOwnsFile(body.bannerFileId, auth.user.id)
          : null;

        const updated = await db.user.update({
          where: { id: auth.user.id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.handle !== undefined ? { handle: body.handle } : {}),
            ...(body.bio !== undefined ? { bio: body.bio ?? null } : {}),
            ...(phoneChange ?? {}),
            ...(body.country !== undefined ? { country: body.country ?? null } : {}),
            ...(body.region !== undefined ? { region: body.region ?? null } : {}),
            ...(body.city !== undefined ? { city: body.city ?? null } : {}),
            ...(body.postalCode !== undefined ? { postalCode: body.postalCode ?? null } : {}),
            ...(body.lat !== undefined ? { lat: body.lat } : {}),
            ...(body.lng !== undefined ? { lng: body.lng } : {}),
            ...(avatar ? { avatarUrl: avatar.url } : {}),
            ...(banner ? { bannerUrl: banner.url } : {}),
          },
          select: { id: true, name: true, handle: true, avatarUrl: true, bio: true, city: true, country: true },
        });

        // A complete profile is a real trust signal, so award it once here.
        const full = await db.user.findUniqueOrThrow({
          where: { id: auth.user.id },
          select: { bio: true, city: true, country: true, avatarUrl: true, phone: true },
        });
        if (full.bio && full.city && full.country && full.avatarUrl) {
          await awardTrustSignal(auth.user.id, "PROFILE_COMPLETE");
        }

        await audit({
          action: "user.updated",
          actorId: auth.user.id,
          entityType: "USER",
          entityId: auth.user.id,
          metadata: { fields: Object.keys(body).filter((k) => k !== "action") },
        });

        return { profile: updated };
      }

      case "change-password":
        await changePassword({
          userId: auth.user.id,
          currentPassword: body.currentPassword,
          newPassword: body.newPassword,
          currentSessionId: auth.sessionId,
          ip,
        });
        return { ok: true, message: "Password changed. Other devices have been signed out." };

      case "revoke-session":
        await revokeSession(auth.user.id, body.sessionId);
        return { ok: true };

      case "phone-code":
        return requestPhoneCode(auth, body.phone, body.channel);

      case "phone-confirm":
        return confirmPhoneCode(auth, body.code);

      case "phone-channel":
        return setPhoneChannel(auth, body.channel);

      case "2fa-begin":
        return beginTwoFactorSetup(auth);

      case "2fa-confirm":
        return confirmTwoFactorSetup(auth, body.code);

      case "2fa-disable":
        return disableTwoFactor(auth, body.password, body.code);

      case "2fa-backup-codes":
        return regenerateBackupCodes(auth, body.code);

      case "revoke-all-sessions":
        await revokeAllSessions(auth.user.id, auth.sessionId);
        await audit({
          action: "auth.sessions_revoked",
          actorId: auth.user.id,
          entityType: "USER",
          entityId: auth.user.id,
        });
        return { ok: true };

      case "subscribe":
        return startSubscription(auth, {
          planCode: body.planCode,
          interval: body.interval,
          idempotencyKey: `sub:${auth.user.id}:${body.idempotencyKey}`,
        });

      case "cancel-subscription":
        return cancelSubscription(auth, body.immediate);

      case "resume-subscription":
        await resumeSubscription(auth);
        return { ok: true };

      case "delete-account": {
        // Money in flight must settle before an account can disappear, or a
        // counterparty is left with an escrow row pointing at nobody.
        const [openSales, openPurchases, openOrders] = await Promise.all([
          db.petOrder.count({
            where: { sellerId: auth.user.id, status: { in: ["IN_ESCROW", "HANDOVER_PENDING", "DISPUTED"] } },
          }),
          db.petOrder.count({
            where: { buyerId: auth.user.id, status: { in: ["IN_ESCROW", "HANDOVER_PENDING", "DISPUTED"] } },
          }),
          db.order.count({
            where: { buyerId: auth.user.id, status: { in: ["PAID", "PROCESSING", "SHIPPED"] } },
          }),
        ]);

        if (openSales + openPurchases + openOrders > 0) {
          throw conflict(
            "You have transactions still in progress. Complete or cancel them before deleting your account.",
          );
        }

        // Soft delete with anonymisation: audit trails and the other side of
        // completed transactions must survive, but the person does not.
        await db.$transaction(async (tx) => {
          await tx.listing.updateMany({
            where: { sellerId: auth.user.id, status: { in: ["ACTIVE", "PENDING_REVIEW", "PAUSED", "DRAFT"] } },
            data: { status: "REMOVED", deletedAt: new Date() },
          });

          await tx.user.update({
            where: { id: auth.user.id },
            data: {
              deletedAt: new Date(),
              status: "DEACTIVATED",
              email: `deleted-${auth.user.id}@petmate.invalid`,
              emailNormalized: `deleted-${auth.user.id}@petmate.invalid`,
              name: "Deleted member",
              handle: `deleted-${auth.user.id.slice(0, 12)}`,
              avatarUrl: null,
              bannerUrl: null,
              bio: null,
              phone: null,
              lat: null,
              lng: null,
              postalCode: null,
            },
          });

          await audit(
            {
              action: "user.deleted",
              actorId: auth.user.id,
              entityType: "USER",
              entityId: auth.user.id,
              summary: "Self-service account deletion",
            },
            tx,
          );
        });

        await revokeAllSessions(auth.user.id);
        await destroySession();

        return { ok: true, message: "Your account has been closed." };
      }
    }
  },
});
