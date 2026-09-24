import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { isStaff } from "@/lib/auth/rbac";
import type { AuthContext } from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { stringifyJson, parseJsonArray } from "@/lib/json";
import { addDays, readableCode } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { notify } from "./notification.service";
import { awardTrustSignal, recomputeTrustScore } from "./trust.service";
import { revokeAllSessions } from "@/lib/auth/session";
import { safeParagraph, cuidSchema } from "@/lib/validation/common";
import { REPORT_REASON, DISPUTE_REASON, VERIFICATION_TYPE } from "@/lib/constants";
import { PLATFORM_CURRENCY } from "@/lib/currency";

/**
 * Trust and safety.
 *
 * Reports, verification, disputes and enforcement. The design principle is that
 * a user only ever sees the outcome, never the machinery: risk scores, internal
 * notes and moderation reasoning stay on the staff side of the boundary. Telling
 * a fraudster which signal caught them is handing them the next bypass.
 */

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const reportSchema = z.object({
  entityType: z.enum(["LISTING", "USER", "MESSAGE", "PRODUCT", "POST", "COMMENT", "REVIEW", "CLINIC"]),
  entityId: cuidSchema,
  reason: z.enum(REPORT_REASON),
  details: safeParagraph(2000, 0).optional(),
  evidence: z.array(cuidSchema).max(5).optional(),
});

export async function fileReport(auth: AuthContext, input: z.infer<typeof reportSchema>) {
  await enforceRateLimit("report", auth.user.id);

  const duplicate = await db.report.findFirst({
    where: {
      reporterId: auth.user.id,
      entityType: input.entityType,
      entityId: input.entityId,
      status: { in: ["OPEN", "IN_REVIEW"] },
    },
    select: { id: true },
  });
  if (duplicate) throw conflict("You have already reported this. Our team is looking at it.");

  // Animal welfare and fraud jump the queue: both have a real deadline.
  const priority =
    input.reason === "ANIMAL_WELFARE"
      ? "URGENT"
      : input.reason === "FRAUD" || input.reason === "PROHIBITED"
        ? "HIGH"
        : "NORMAL";

  const report = await db.report.create({
    data: {
      reporterId: auth.user.id,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: input.reason,
      details: input.details ?? null,
      evidence: input.evidence?.length ? stringifyJson(input.evidence) : null,
      priority,
    },
    select: { id: true },
  });

  // Several independent reports on one listing pull it out of circulation
  // pending review, rather than waiting for a moderator to be at their desk.
  const reportCount = await db.report.count({
    where: { entityType: input.entityType, entityId: input.entityId, status: { in: ["OPEN", "IN_REVIEW"] } },
  });

  if (reportCount >= 3 && input.entityType === "LISTING") {
    await db.listing.updateMany({
      where: { id: input.entityId, status: "ACTIVE" },
      data: { status: "PENDING_REVIEW", moderationStatus: "FLAGGED", moderationNote: "Auto-paused: multiple reports" },
    });
  }

  await audit({
    action: "report.filed",
    actorId: auth.user.id,
    entityType: input.entityType,
    entityId: input.entityId,
    summary: `${input.reason} (${priority})`,
    metadata: { reportId: report.id },
  });

  return report;
}

export async function resolveReport(
  auth: AuthContext,
  reportId: string,
  input: { status: "UPHELD" | "DISMISSED" | "DUPLICATE"; resolution: string; action?: "REMOVE" | "SUSPEND" | "NONE" },
) {
  if (!isStaff(auth.user)) throw forbidden("Moderation is staff only.");

  const report = await db.report.findUnique({
    where: { id: reportId },
    select: { id: true, status: true, entityType: true, entityId: true, reporterId: true, reason: true },
  });
  if (!report) throw notFound("That report");
  if (report.status !== "OPEN" && report.status !== "IN_REVIEW") {
    throw conflict("This report is already resolved.");
  }

  await db.report.update({
    where: { id: reportId },
    data: {
      status: input.status,
      resolution: input.resolution.slice(0, 1000),
      resolvedById: auth.user.id,
      resolvedAt: new Date(),
    },
  });

  if (input.status === "UPHELD") {
    const offenderId = await resolveOwner(report.entityType, report.entityId);

    if (input.action === "REMOVE" && report.entityType === "LISTING") {
      await db.listing.update({
        where: { id: report.entityId },
        data: { status: "REMOVED", moderationStatus: "REJECTED", moderationNote: input.resolution, deletedAt: new Date() },
      });
    }
    if (input.action === "REMOVE" && report.entityType === "POST") {
      await db.post.update({ where: { id: report.entityId }, data: { status: "REMOVED" } });
    }
    if (input.action === "REMOVE" && report.entityType === "REVIEW") {
      await db.review.update({ where: { id: report.entityId }, data: { status: "REMOVED" } });
    }

    if (offenderId) {
      await awardTrustSignal(offenderId, "REPORT_UPHELD", { reference: reportId });
      if (input.action === "SUSPEND") {
        await suspendUser(auth, offenderId, input.resolution, 30);
      }
      await notify({
        userId: offenderId,
        category: "SECURITY",
        type: "moderation.action",
        title: "Action taken on your content",
        body: input.resolution,
        url: "/settings/account",
      });
    }
  } else {
    // A dismissed report is still worth telling the reporter about: silence is
    // what makes people stop reporting.
    await db.listing.updateMany({
      where: { id: report.entityId, status: "PENDING_REVIEW", moderationStatus: "FLAGGED" },
      data: { status: "ACTIVE", moderationStatus: "APPROVED", moderationNote: null },
    });
  }

  await notify({
    userId: report.reporterId,
    category: "SYSTEM",
    type: "report.resolved",
    title: "Thanks — we reviewed your report",
    body:
      input.status === "UPHELD"
        ? "We took action based on what you told us."
        : "We looked into it and did not find a breach of our rules this time.",
    url: "/dashboard",
  });

  await audit({
    action: "report.resolved",
    actorId: auth.user.id,
    entityType: "REPORT",
    entityId: reportId,
    summary: `${input.status}: ${input.resolution}`,
  });
}

async function resolveOwner(entityType: string, entityId: string): Promise<string | null> {
  switch (entityType) {
    case "LISTING":
      return (await db.listing.findUnique({ where: { id: entityId }, select: { sellerId: true } }))?.sellerId ?? null;
    case "USER":
      return entityId;
    case "PRODUCT":
      return (
        (await db.product.findUnique({ where: { id: entityId }, select: { shop: { select: { ownerUserId: true } } } }))
          ?.shop.ownerUserId ?? null
      );
    case "MESSAGE":
      return (await db.message.findUnique({ where: { id: entityId }, select: { senderId: true } }))?.senderId ?? null;
    case "POST":
      return (await db.post.findUnique({ where: { id: entityId }, select: { authorId: true } }))?.authorId ?? null;
    case "COMMENT":
      return (await db.comment.findUnique({ where: { id: entityId }, select: { authorId: true } }))?.authorId ?? null;
    case "REVIEW":
      return (await db.review.findUnique({ where: { id: entityId }, select: { authorId: true } }))?.authorId ?? null;
    case "CLINIC":
      return (await db.clinic.findUnique({ where: { id: entityId }, select: { ownerUserId: true } }))?.ownerUserId ?? null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

export async function suspendUser(
  auth: AuthContext,
  userId: string,
  reason: string,
  days?: number,
) {
  if (!isStaff(auth.user)) throw forbidden("Staff only.");
  if (userId === auth.user.id) throw badRequest("You cannot suspend your own account.");

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, roles: { select: { role: true } } },
  });
  if (!target) throw notFound("That member");

  // A moderator cannot suspend an admin. Privilege escalation via the
  // moderation console is a real attack, not a theoretical one.
  const targetRoles = target.roles.map((r) => r.role);
  if (
    (targetRoles.includes("ADMIN") || targetRoles.includes("SUPER_ADMIN")) &&
    !auth.user.roles.includes("SUPER_ADMIN")
  ) {
    await audit({
      action: "admin.impersonation_denied",
      actorId: auth.user.id,
      entityType: "USER",
      entityId: userId,
      summary: "Attempted to suspend a higher-privileged account",
    });
    throw forbidden("You cannot action that account.");
  }

  await db.user.update({
    where: { id: userId },
    data: {
      status: "SUSPENDED",
      statusReason: reason.slice(0, 500),
      statusUntil: days ? addDays(new Date(), days) : null,
    },
  });

  // Suspension that leaves live sessions is theatre.
  await revokeAllSessions(userId);

  // Their listings come down with them.
  await db.listing.updateMany({
    where: { sellerId: userId, status: { in: ["ACTIVE", "PENDING_REVIEW"] } },
    data: { status: "PAUSED", statusReason: "Account suspended" },
  });

  await audit({
    action: "user.suspended",
    actorId: auth.user.id,
    entityType: "USER",
    entityId: userId,
    summary: `${reason}${days ? ` (${days} days)` : " (indefinite)"}`,
  });

  await notify({
    userId,
    category: "SECURITY",
    type: "account.suspended",
    title: "Your account has been suspended",
    body: reason,
    url: "/support",
  });
}

export async function reinstateUser(auth: AuthContext, userId: string, note: string) {
  if (!isStaff(auth.user)) throw forbidden("Staff only.");

  await db.user.update({
    where: { id: userId },
    data: { status: "ACTIVE", statusReason: null, statusUntil: null },
  });

  await audit({
    action: "user.reinstated",
    actorId: auth.user.id,
    entityType: "USER",
    entityId: userId,
    summary: note,
  });

  await notify({
    userId,
    category: "SECURITY",
    type: "account.reinstated",
    title: "Your account has been restored",
    body: "You can sign in and use PetMate again.",
    url: "/dashboard",
  });
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export const verificationSchema = z.object({
  subjectType: z.enum(["USER", "PET", "CLINIC", "SHOP"]),
  subjectId: cuidSchema,
  type: z.enum(VERIFICATION_TYPE),
  documents: z.array(cuidSchema).min(1, "Attach at least one document.").max(5),
  notes: safeParagraph(1000, 0).optional(),
});

export async function submitVerification(auth: AuthContext, input: z.infer<typeof verificationSchema>) {
  // The subject must belong to the submitter.
  await assertOwnsSubject(auth, input.subjectType, input.subjectId);

  const pending = await db.verification.findFirst({
    where: {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      type: input.type,
      status: { in: ["PENDING", "IN_REVIEW"] },
    },
    select: { id: true },
  });
  if (pending) throw conflict("A verification of this type is already under review.");

  // Every referenced file must be one this user uploaded.
  const files = await db.fileObject.findMany({
    where: { id: { in: input.documents }, ownerId: auth.user.id },
    select: { id: true },
  });
  if (files.length !== input.documents.length) {
    throw badRequest("One of those documents could not be found.");
  }

  const verification = await db.verification.create({
    data: {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      userId: auth.user.id,
      type: input.type,
      documents: stringifyJson(input.documents),
      notes: input.notes ?? null,
    },
    select: { id: true },
  });

  await audit({
    action: "verification.submitted",
    actorId: auth.user.id,
    entityType: input.subjectType,
    entityId: input.subjectId,
    summary: input.type,
  });

  return verification;
}

async function assertOwnsSubject(auth: AuthContext, subjectType: string, subjectId: string) {
  switch (subjectType) {
    case "USER":
      if (subjectId !== auth.user.id) throw notFound("That account");
      return;
    case "PET": {
      const pet = await db.pet.findFirst({
        where: { id: subjectId, ownerId: auth.user.id, deletedAt: null },
        select: { id: true },
      });
      if (!pet) throw notFound("That pet");
      return;
    }
    case "CLINIC": {
      const clinic = await db.clinic.findFirst({
        where: { id: subjectId, ownerUserId: auth.user.id, deletedAt: null },
        select: { id: true },
      });
      if (!clinic) throw notFound("That clinic");
      return;
    }
    case "SHOP": {
      const shop = await db.shop.findFirst({
        where: { id: subjectId, ownerUserId: auth.user.id, deletedAt: null },
        select: { id: true },
      });
      if (!shop) throw notFound("That shop");
      return;
    }
    default:
      throw badRequest("Unsupported verification subject.");
  }
}

export async function decideVerification(
  auth: AuthContext,
  verificationId: string,
  decision: "APPROVED" | "REJECTED",
  note: string,
) {
  if (!isStaff(auth.user)) throw forbidden("Staff only.");

  const verification = await db.verification.findUnique({
    where: { id: verificationId },
    select: { id: true, status: true, subjectType: true, subjectId: true, type: true, userId: true },
  });
  if (!verification) throw notFound("That verification");
  if (verification.status === "APPROVED" || verification.status === "REJECTED") {
    throw conflict("This verification has already been decided.");
  }

  await db.$transaction(async (tx) => {
    await tx.verification.update({
      where: { id: verificationId },
      data: {
        status: decision,
        reviewedById: auth.user.id,
        reviewedAt: new Date(),
        rejectionReason: decision === "REJECTED" ? note.slice(0, 500) : null,
        expiresAt: decision === "APPROVED" ? addDays(new Date(), 365) : null,
      },
    });

    if (decision === "APPROVED") {
      switch (verification.subjectType) {
        case "PET":
          await tx.pet.update({
            where: { id: verification.subjectId },
            data: {
              verifiedAt: new Date(),
              verifiedById: auth.user.id,
              verificationLevel: verification.type === "HEALTH" ? "CLINIC_VERIFIED" : "DOCUMENTED",
            },
          });
          break;
        case "CLINIC":
          await tx.clinic.update({
            where: { id: verification.subjectId },
            data: { verifiedAt: new Date(), status: "ACTIVE" },
          });
          break;
        case "SHOP":
          await tx.shop.update({
            where: { id: verification.subjectId },
            data: { verifiedAt: new Date(), status: "ACTIVE" },
          });
          break;
      }
    }
  });

  if (decision === "APPROVED" && verification.userId) {
    const signal =
      verification.type === "IDENTITY"
        ? "ID_VERIFIED"
        : verification.type === "ADDRESS"
          ? "ADDRESS_VERIFIED"
          : verification.type === "BREEDER"
            ? "BREEDER_VERIFIED"
            : verification.type === "CLINIC_LICENSE"
              ? "CLINIC_VERIFIED"
              : "PET_DOCUMENTED";

    await awardTrustSignal(verification.userId, signal, { reference: verificationId });
  }

  await audit({
    action: "verification.decided",
    actorId: auth.user.id,
    entityType: "VERIFICATION",
    entityId: verificationId,
    summary: `${decision}: ${note}`,
  });

  if (verification.userId) {
    await notify({
      userId: verification.userId,
      category: "SECURITY",
      type: `verification.${decision.toLowerCase()}`,
      title: decision === "APPROVED" ? "Verification approved" : "Verification needs attention",
      body: decision === "APPROVED" ? "Your verified badge is now live." : note,
      url: "/settings/verification",
    });
  }
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

export const disputeSchema = z.object({
  orderId: cuidSchema.optional(),
  petOrderId: cuidSchema.optional(),
  reason: z.enum(DISPUTE_REASON),
  details: safeParagraph(3000, 40),
  amountCents: z.number().int().min(0).optional(),
});

export async function openDispute(auth: AuthContext, input: z.infer<typeof disputeSchema>) {
  if (!input.orderId && !input.petOrderId) throw badRequest("Tell us which order this is about.");

  const settings = await getSettings();
  let againstId: string;
  let amountCents = 0;

  if (input.petOrderId) {
    const order = await db.petOrder.findUnique({
      where: { id: input.petOrderId },
      select: { id: true, buyerId: true, sellerId: true, amountCents: true, status: true, escrowReleasedAt: true },
    });
    if (!order) throw notFound("That purchase");
    if (order.buyerId !== auth.user.id && order.sellerId !== auth.user.id) throw notFound("That purchase");

    if (order.escrowReleasedAt) {
      const days = (Date.now() - order.escrowReleasedAt.getTime()) / 86_400_000;
      if (days > settings.disputeWindowDays) {
        throw conflict(`Disputes must be opened within ${settings.disputeWindowDays} days of completion.`);
      }
    }

    againstId = order.buyerId === auth.user.id ? order.sellerId : order.buyerId;
    amountCents = order.amountCents;

    // Opening a dispute freezes escrow. That is the entire point of escrow.
    await db.petOrder.updateMany({
      where: { id: order.id, status: { in: ["IN_ESCROW", "HANDOVER_PENDING"] } },
      data: { status: "DISPUTED" },
    });
  } else {
    const order = await db.order.findUnique({
      where: { id: input.orderId! },
      select: {
        id: true,
        buyerId: true,
        totalCents: true,
        placedAt: true,
        items: { select: { shop: { select: { ownerUserId: true } } } },
      },
    });
    if (!order || order.buyerId !== auth.user.id) throw notFound("That order");

    if (order.placedAt) {
      const days = (Date.now() - order.placedAt.getTime()) / 86_400_000;
      if (days > settings.disputeWindowDays + 30) {
        throw conflict("This order is too old to dispute. Contact support instead.");
      }
    }

    againstId = order.items[0]?.shop.ownerUserId ?? auth.user.id;
    amountCents = order.totalCents;
  }

  const existing = await db.dispute.findFirst({
    where: {
      raisedById: auth.user.id,
      ...(input.petOrderId ? { petOrderId: input.petOrderId } : { orderId: input.orderId }),
      status: { in: ["OPEN", "AWAITING_RESPONSE", "IN_REVIEW"] },
    },
    select: { id: true },
  });
  if (existing) throw conflict("You already have an open dispute for this order.");

  const dispute = await db.dispute.create({
    data: {
      reference: `DSP-${readableCode(8)}`,
      orderId: input.orderId ?? null,
      petOrderId: input.petOrderId ?? null,
      raisedById: auth.user.id,
      againstId,
      reason: input.reason,
      details: input.details,
      amountCents: input.amountCents ?? amountCents,
      responseDueAt: addDays(new Date(), 3),
      status: "AWAITING_RESPONSE",
      messages: {
        create: { authorId: auth.user.id, body: input.details },
      },
    },
    select: { id: true, reference: true },
  });

  await audit({
    action: "dispute.opened",
    actorId: auth.user.id,
    entityType: "DISPUTE",
    entityId: dispute.id,
    summary: `${input.reason}: ${dispute.reference}`,
  });

  await notify({
    userId: againstId,
    category: "ORDER",
    type: "dispute.opened",
    title: "A dispute has been opened",
    body: "You have 3 days to respond before our team reviews it.",
    url: `/dashboard/disputes/${dispute.id}`,
    entityType: "DISPUTE",
    entityId: dispute.id,
  });

  return dispute;
}

export async function addDisputeMessage(
  auth: AuthContext,
  disputeId: string,
  body: string,
  evidence?: string[],
) {
  const dispute = await db.dispute.findUnique({
    where: { id: disputeId },
    select: { id: true, raisedById: true, againstId: true, status: true },
  });
  if (!dispute) throw notFound("That dispute");

  const isParty = dispute.raisedById === auth.user.id || dispute.againstId === auth.user.id;
  const staff = isStaff(auth.user);
  if (!isParty && !staff) throw notFound("That dispute");

  if (["RESOLVED_BUYER", "RESOLVED_SELLER", "RESOLVED_SPLIT", "WITHDRAWN"].includes(dispute.status)) {
    throw conflict("This dispute is closed.");
  }

  await db.disputeMessage.create({
    data: {
      disputeId,
      authorId: auth.user.id,
      body: body.slice(0, 3000),
      evidence: evidence?.length ? stringifyJson(evidence) : null,
      isStaff: staff && !isParty,
    },
  });

  if (dispute.status === "AWAITING_RESPONSE" && dispute.againstId === auth.user.id) {
    await db.dispute.update({ where: { id: disputeId }, data: { status: "IN_REVIEW" } });
  }

  const otherId = dispute.raisedById === auth.user.id ? dispute.againstId : dispute.raisedById;
  await notify({
    userId: otherId,
    category: "ORDER",
    type: "dispute.message",
    title: "New message on your dispute",
    body: body.slice(0, 140),
    url: `/dashboard/disputes/${disputeId}`,
    entityType: "DISPUTE",
    entityId: disputeId,
  });
}

export async function resolveDispute(
  auth: AuthContext,
  disputeId: string,
  input: {
    outcome: "RESOLVED_BUYER" | "RESOLVED_SELLER" | "RESOLVED_SPLIT";
    refundCents: number;
    resolution: string;
  },
) {
  if (!isStaff(auth.user)) throw forbidden("Staff only.");

  const dispute = await db.dispute.findUnique({
    where: { id: disputeId },
    select: {
      id: true,
      reference: true,
      status: true,
      raisedById: true,
      againstId: true,
      orderId: true,
      petOrderId: true,
      amountCents: true,
      order: { select: { paymentIntentId: true, currency: true, totalCents: true } },
      petOrder: { select: { paymentIntentId: true, currency: true, amountCents: true, status: true } },
    },
  });
  if (!dispute) throw notFound("That dispute");
  if (dispute.status.startsWith("RESOLVED")) throw conflict("This dispute is already resolved.");

  const maxRefund = dispute.petOrder?.amountCents ?? dispute.order?.totalCents ?? 0;
  if (input.refundCents > maxRefund) {
    throw badRequest("The refund cannot exceed the original payment.");
  }

  await db.dispute.update({
    where: { id: disputeId },
    data: {
      status: input.outcome,
      resolution: input.resolution.slice(0, 2000),
      refundCents: input.refundCents,
      resolvedById: auth.user.id,
      resolvedAt: new Date(),
    },
  });

  const currency = dispute.petOrder?.currency ?? dispute.order?.currency ?? PLATFORM_CURRENCY;

  if (input.refundCents > 0) {
    const intentId = dispute.petOrder?.paymentIntentId ?? dispute.order?.paymentIntentId;
    if (intentId) {
      // Escrowed money leaves escrow first, then the gateway refund is issued.
      if (dispute.petOrderId) {
        const { postTransaction, accounts } = await import("@/lib/payments/ledger-core");
        await postTransaction({
          kind: "ESCROW_RELEASE",
          description: `Dispute ${dispute.reference} refund`,
          currency,
          referenceType: "DISPUTE",
          referenceId: dispute.id,
          createdById: auth.user.id,
          entries: [
            { account: accounts.escrow(currency), amountCents: -input.refundCents },
            { account: accounts.platformRevenue(currency), amountCents: input.refundCents },
          ],
        });
      }

      // A store order's refund comes back from the shops that were paid for
      // it, not out of the platform's commission.
      if (dispute.orderId) {
        const { clawBackOrderEarnings } = await import("@/lib/payments/settlement");
        await db.$transaction((tx) =>
          clawBackOrderEarnings(tx, {
            orderId: dispute.orderId!,
            refundCents: input.refundCents,
            actorId: auth.user.id,
            reason: `dispute ${dispute.reference}`,
          }),
        );
      }

      const { refundPayment } = await import("@/lib/payments/service");
      await refundPayment({
        intentId,
        amountCents: input.refundCents,
        reason: "DISPUTE_RESOLUTION",
        approvedById: auth.user.id,
        note: `Dispute ${dispute.reference}`,
      });
    }
  }

  // Whatever remains in escrow after a partial refund goes to the seller.
  if (dispute.petOrderId && dispute.petOrder && input.outcome !== "RESOLVED_BUYER") {
    const { releaseEscrow } = await import("@/lib/payments/settlement");
    await db.petOrder.updateMany({
      where: { id: dispute.petOrderId, status: "DISPUTED" },
      data: { status: "IN_ESCROW" },
    });
    await releaseEscrow({
      petOrderId: dispute.petOrderId,
      reason: "DISPUTE_RESOLVED",
      actorId: auth.user.id,
    });
  } else if (dispute.petOrderId) {
    await db.petOrder.updateMany({
      where: { id: dispute.petOrderId },
      data: { status: "REFUNDED" },
    });
  }

  const loserId = input.outcome === "RESOLVED_BUYER" ? dispute.againstId : dispute.raisedById;
  if (input.outcome !== "RESOLVED_SPLIT") {
    await awardTrustSignal(loserId, "DISPUTE_LOST", { reference: disputeId });
  }

  await audit({
    action: "dispute.resolved",
    actorId: auth.user.id,
    entityType: "DISPUTE",
    entityId: disputeId,
    summary: `${input.outcome}, refund ${formatMoney(input.refundCents, currency)}`,
  });

  for (const userId of [dispute.raisedById, dispute.againstId]) {
    await notify({
      userId,
      category: "ORDER",
      type: "dispute.resolved",
      title: `Dispute ${dispute.reference} resolved`,
      body: input.resolution,
      url: `/dashboard/disputes/${disputeId}`,
      entityType: "DISPUTE",
      entityId: disputeId,
    });
  }
}

export async function getDispute(auth: AuthContext, disputeId: string) {
  const dispute = await db.dispute.findUnique({
    where: { id: disputeId },
    select: {
      id: true,
      reference: true,
      status: true,
      reason: true,
      details: true,
      amountCents: true,
      refundCents: true,
      resolution: true,
      responseDueAt: true,
      createdAt: true,
      resolvedAt: true,
      raisedById: true,
      againstId: true,
      raisedBy: { select: { id: true, name: true, avatarUrl: true } },
      against: { select: { id: true, name: true, avatarUrl: true } },
      order: { select: { id: true, orderNumber: true, totalCents: true, currency: true } },
      petOrder: {
        select: {
          id: true,
          orderNumber: true,
          amountCents: true,
          currency: true,
          listing: { select: { title: true } },
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, authorId: true, isStaff: true, evidence: true, createdAt: true },
      },
    },
  });
  if (!dispute) throw notFound("That dispute");

  const isParty = dispute.raisedById === auth.user.id || dispute.againstId === auth.user.id;
  if (!isParty && !isStaff(auth.user)) throw notFound("That dispute");

  return {
    ...dispute,
    isRaiser: dispute.raisedById === auth.user.id,
    messages: dispute.messages.map((m) => ({ ...m, evidenceIds: parseJsonArray<string>(m.evidence) })),
  };
}

export async function listMyDisputes(auth: AuthContext) {
  return db.dispute.findMany({
    where: { OR: [{ raisedById: auth.user.id }, { againstId: auth.user.id }] },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      reference: true,
      status: true,
      reason: true,
      amountCents: true,
      refundCents: true,
      createdAt: true,
      responseDueAt: true,
      raisedById: true,
      order: { select: { orderNumber: true, currency: true } },
      petOrder: { select: { orderNumber: true, currency: true, listing: { select: { title: true } } } },
    },
  });
}

export { recomputeTrustScore };
