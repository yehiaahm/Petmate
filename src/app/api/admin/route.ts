import { z } from "zod";
import { route } from "@/lib/api";
import { requireStaff, requireAdmin, requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { resolveReport, suspendUser, reinstateUser, decideVerification, resolveDispute } from "@/lib/services/safety.service";
import { updateSetting, getSettings, DEFAULT_SETTINGS, type SettingsShape } from "@/lib/settings";
import { assertLedgerBalanced } from "@/lib/payments/ledger-core";
import { listPendingPayouts, markPayoutPaid, rejectPayout } from "@/lib/payments/payout.service";
import {
  listSupportQueue,
  setSupportTicketStatus,
  replyToSupportTicket,
} from "@/lib/services/support.service";
import { notify } from "@/lib/services/notification.service";
import { resolveBreedingFee } from "@/lib/services/breeding-fee.service";
import { reviewAdCampaign } from "@/lib/services/ad.service";
import { couponSchema, createCoupon, setCouponActive } from "@/lib/services/coupon.service";
import { cuidSchema, safeParagraph, safeText } from "@/lib/validation/common";
import { ROLES } from "@/lib/constants";

/**
 * Admin operations.
 *
 * Every action re-checks the actor's role server-side and writes an audit row.
 * The two escalation paths that matter are blocked explicitly: a moderator
 * cannot grant roles, and nobody below SUPER_ADMIN can grant SUPER_ADMIN.
 */

export const GET = route({
  permission: "admin:read",
  query: z.object({
    mode: z.enum(["queue", "settings", "ledger-check", "finance", "support"]).default("queue"),
  }),
  async handler({ query }) {
    await requireStaff();

    if (query.mode === "settings") {
      const settings = await getSettings();
      return { settings, defaults: DEFAULT_SETTINGS };
    }

    if (query.mode === "ledger-check") {
      await requireAdmin();
      return assertLedgerBalanced();
    }

    if (query.mode === "finance") {
      // Money movement is a narrower permission than reading the queue.
      await requirePermission("admin:finance");
      const [payouts, ledger] = await Promise.all([
        listPendingPayouts(),
        assertLedgerBalanced(),
      ]);
      return { payouts, ledger };
    }

    if (query.mode === "support") {
      await requirePermission("admin:moderation");
      return { tickets: await listSupportQueue() };
    }

    const [reports, verifications, listings, disputes, riskEvents] = await Promise.all([
      db.report.findMany({
        where: { status: { in: ["OPEN", "IN_REVIEW"] } },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        take: 50,
        select: {
          id: true,
          entityType: true,
          entityId: true,
          reason: true,
          details: true,
          priority: true,
          status: true,
          createdAt: true,
          reporter: { select: { id: true, name: true, handle: true } },
        },
      }),
      db.verification.findMany({
        where: { status: { in: ["PENDING", "IN_REVIEW"] } },
        orderBy: { createdAt: "asc" },
        take: 50,
        select: {
          id: true,
          subjectType: true,
          subjectId: true,
          type: true,
          documents: true,
          notes: true,
          createdAt: true,
          user: { select: { id: true, name: true, handle: true, email: true } },
        },
      }),
      db.listing.findMany({
        where: { status: "PENDING_REVIEW", deletedAt: null },
        orderBy: { createdAt: "asc" },
        take: 50,
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          priceCents: true,
          currency: true,
          intent: true,
          createdAt: true,
          moderationNote: true,
          seller: { select: { id: true, name: true, handle: true, trustScore: true, createdAt: true } },
          pet: {
            select: {
              name: true,
              species: true,
              photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
            },
          },
        },
      }),
      db.dispute.findMany({
        where: { status: { in: ["OPEN", "AWAITING_RESPONSE", "IN_REVIEW"] } },
        orderBy: { createdAt: "asc" },
        take: 50,
        select: {
          id: true,
          reference: true,
          reason: true,
          status: true,
          amountCents: true,
          createdAt: true,
          responseDueAt: true,
          raisedBy: { select: { id: true, name: true } },
          against: { select: { id: true, name: true } },
        },
      }),
      db.riskEvent.findMany({
        where: { handled: false, score: { gte: 40 } },
        orderBy: [{ score: "desc" }, { createdAt: "desc" }],
        take: 30,
        select: {
          id: true,
          type: true,
          score: true,
          entityType: true,
          entityId: true,
          details: true,
          createdAt: true,
          user: { select: { id: true, name: true, handle: true } },
        },
      }),
    ]);

    return { reports, verifications, listings, disputes, riskEvents };
  },
});

export const POST = route({
  permission: "admin:read",
  body: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("moderate-listing"),
      listingId: cuidSchema,
      decision: z.enum(["APPROVE", "REJECT"]),
      note: safeParagraph(1000, 0).optional(),
    }),
    z.object({
      action: z.literal("resolve-report"),
      reportId: cuidSchema,
      status: z.enum(["UPHELD", "DISMISSED", "DUPLICATE"]),
      resolution: safeText(1000, 3),
      enforcement: z.enum(["REMOVE", "SUSPEND", "NONE"]).default("NONE"),
    }),
    z.object({
      action: z.literal("decide-verification"),
      verificationId: cuidSchema,
      decision: z.enum(["APPROVED", "REJECTED"]),
      note: safeText(500, 3),
    }),
    z.object({
      action: z.literal("resolve-dispute"),
      disputeId: cuidSchema,
      outcome: z.enum(["RESOLVED_BUYER", "RESOLVED_SELLER", "RESOLVED_SPLIT"]),
      refundCents: z.number().int().min(0),
      resolution: safeParagraph(2000, 10),
    }),
    z.object({
      action: z.literal("suspend-user"),
      userId: cuidSchema,
      reason: safeText(500, 3),
      days: z.number().int().min(1).max(3650).optional(),
    }),
    z.object({ action: z.literal("reinstate-user"), userId: cuidSchema, note: safeText(500, 3) }),
    z.object({
      action: z.literal("set-role"),
      userId: cuidSchema,
      role: z.enum(ROLES),
      grant: z.boolean(),
    }),
    z.object({
      action: z.literal("update-setting"),
      key: z.string().min(1).max(60),
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
    z.object({ action: z.literal("dismiss-risk"), riskEventId: cuidSchema }),
    z.object({
      action: z.literal("pay-payout"),
      payoutId: cuidSchema,
      providerRef: safeText(100, 0).optional(),
    }),
    z.object({
      action: z.literal("reject-payout"),
      payoutId: cuidSchema,
      reason: safeText(300, 3),
    }),
    z.object({ action: z.literal("create-coupon"), coupon: z.record(z.string(), z.unknown()) }),
    z.object({ action: z.literal("set-coupon-active"), couponId: cuidSchema, active: z.boolean() }),
    z.object({
      action: z.literal("review-ad"),
      campaignId: cuidSchema,
      decision: z.enum(["APPROVE", "REJECT"]),
      note: safeText(300, 3),
    }),
    z.object({
      action: z.literal("resolve-breeding-fee"),
      requestId: cuidSchema,
      decision: z.enum(["RELEASE", "REFUND"]),
      note: safeText(300, 3),
    }),
    z.object({
      action: z.literal("support-status"),
      reference: z.string().trim().toUpperCase().regex(/^SUP-[A-Z0-9]{4,16}$/),
      status: z.enum(["OPEN", "AWAITING_USER", "RESOLVED", "CLOSED"]),
    }),
    z.object({
      action: z.literal("support-reply"),
      reference: z.string().trim().toUpperCase().regex(/^SUP-[A-Z0-9]{4,16}$/),
      body: safeParagraph(4000, 2),
    }),
  ]),
  async handler({ body }) {
    const auth = await requireStaff();

    switch (body.action) {
      case "moderate-listing": {
        await requirePermission("listing:moderate");

        const listing = await db.listing.findUnique({
          where: { id: body.listingId },
          select: { id: true, sellerId: true, title: true, petId: true, status: true },
        });
        if (!listing) throw notFound("That listing");

        const approved = body.decision === "APPROVE";
        const settings = await getSettings();

        await db.$transaction([
          db.listing.update({
            where: { id: body.listingId },
            data: {
              status: approved ? "ACTIVE" : "REJECTED",
              moderationStatus: approved ? "APPROVED" : "REJECTED",
              moderationNote: body.note ?? null,
              moderatedAt: new Date(),
              moderatedById: auth.user.id,
              publishedAt: approved ? new Date() : null,
              expiresAt: approved
                ? new Date(Date.now() + settings.listingDurationDays * 86_400_000)
                : null,
            },
          }),
          db.pet.update({
            where: { id: listing.petId },
            data: { status: approved ? "LISTED" : "ACTIVE" },
          }),
        ]);

        await audit({
          action: "listing.moderated",
          actorId: auth.user.id,
          entityType: "LISTING",
          entityId: body.listingId,
          summary: `${body.decision}: ${body.note ?? "no note"}`,
        });

        await notify({
          userId: listing.sellerId,
          category: "LISTING",
          type: approved ? "listing.approved" : "listing.rejected",
          title: approved ? "Your listing is live" : "Your listing was not approved",
          body: approved ? listing.title : (body.note ?? "It did not meet our listing rules."),
          url: `/dashboard/listings/${listing.id}`,
          entityType: "LISTING",
          entityId: listing.id,
        });

        return { ok: true };
      }

      case "resolve-report":
        await requirePermission("admin:moderation");
        await resolveReport(auth, body.reportId, {
          status: body.status,
          resolution: body.resolution,
          action: body.enforcement,
        });
        return { ok: true };

      case "decide-verification":
        await requirePermission("admin:moderation");
        await decideVerification(auth, body.verificationId, body.decision, body.note);
        return { ok: true };

      case "resolve-dispute":
        await requirePermission("admin:finance");
        await resolveDispute(auth, body.disputeId, {
          outcome: body.outcome,
          refundCents: body.refundCents,
          resolution: body.resolution,
        });
        return { ok: true };

      case "suspend-user":
        await requirePermission("admin:moderation");
        await suspendUser(auth, body.userId, body.reason, body.days);
        return { ok: true };

      case "reinstate-user":
        await requirePermission("admin:users");
        await reinstateUser(auth, body.userId, body.note);
        return { ok: true };

      case "set-role": {
        await requirePermission("admin:users");

        // Only a super admin can create another super admin.
        if (body.role === "SUPER_ADMIN" && !auth.user.roles.includes("SUPER_ADMIN")) {
          await audit({
            action: "admin.impersonation_denied",
            actorId: auth.user.id,
            entityType: "USER",
            entityId: body.userId,
            summary: "Attempted to grant SUPER_ADMIN",
          });
          throw forbidden("Only a super admin can grant that role.");
        }
        // Granting ADMIN is also super-admin-only: otherwise an admin can mint
        // peers and the role boundary means nothing.
        if (body.role === "ADMIN" && !auth.user.roles.includes("SUPER_ADMIN")) {
          throw forbidden("Only a super admin can grant the admin role.");
        }
        if (body.userId === auth.user.id && !body.grant) {
          throw badRequest("You cannot remove your own role.");
        }

        if (body.grant) {
          await db.userRole.upsert({
            where: { userId_role: { userId: body.userId, role: body.role } },
            create: { userId: body.userId, role: body.role, grantedBy: auth.user.id },
            update: {},
          });
        } else {
          await db.userRole.deleteMany({ where: { userId: body.userId, role: body.role } });
        }

        await audit({
          action: body.grant ? "user.role_granted" : "user.role_revoked",
          actorId: auth.user.id,
          entityType: "USER",
          entityId: body.userId,
          summary: body.role,
        });

        return { ok: true };
      }

      case "update-setting": {
        await requirePermission("admin:settings");

        if (!(body.key in DEFAULT_SETTINGS)) throw badRequest("Unknown setting.");
        const key = body.key as keyof SettingsShape;

        await updateSetting(key, body.value as SettingsShape[typeof key], auth.user.id);

        await audit({
          action: "admin.setting_changed",
          actorId: auth.user.id,
          entityType: "SETTING",
          entityId: body.key,
          summary: `${body.key} = ${String(body.value)}`,
        });

        return { settings: await getSettings() };
      }

      case "pay-payout":
        await requirePermission("admin:finance");
        await markPayoutPaid(auth, body.payoutId, body.providerRef);
        return { ok: true };

      case "reject-payout":
        await requirePermission("admin:finance");
        await rejectPayout(auth, body.payoutId, body.reason);
        return { ok: true };

      case "create-coupon": {
        await requirePermission("admin:finance");
        const parsed = couponSchema.safeParse(body.coupon);
        if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Please check the coupon.");
        return { coupon: await createCoupon(auth, parsed.data) };
      }

      case "set-coupon-active":
        await requirePermission("admin:finance");
        return setCouponActive(auth, body.couponId, body.active);

      case "review-ad":
        await requirePermission("admin:moderation");
        return reviewAdCampaign(auth, body.campaignId, body.decision, body.note);

      case "resolve-breeding-fee":
        await requirePermission("admin:finance");
        return resolveBreedingFee(auth, body.requestId, body.decision, body.note);

      case "support-status":
        await requirePermission("admin:moderation");
        await setSupportTicketStatus(auth, body.reference, body.status);
        return { ok: true };

      case "support-reply":
        await requirePermission("admin:moderation");
        await replyToSupportTicket(body.reference, body.body, {
          userId: auth.user.id,
          name: auth.user.name,
          email: auth.user.email,
          isStaff: true,
        });
        return { ok: true };

      case "dismiss-risk":
        await db.riskEvent.update({ where: { id: body.riskEventId }, data: { handled: true } });
        return { ok: true };
    }
  },
});
