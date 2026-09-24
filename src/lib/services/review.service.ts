import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { nextRatingAvgBps } from "@/lib/money";
import { awardTrustSignal } from "./trust.service";
import { notify } from "./notification.service";
import { safeText, safeParagraph, cuidSchema } from "@/lib/validation/common";

/**
 * Reviews.
 *
 * A review must be attached to a transaction the author actually took part in.
 * That single rule is the difference between a rating that means something and
 * a comment box that fills with competitors and friends.
 *
 * Unverified reviews are not accepted at all here. It is a deliberate trade:
 * fewer reviews, all of them real.
 */

export const reviewSchema = z.object({
  targetType: z.enum(["SELLER", "SHOP", "CLINIC", "VET", "PRODUCT", "BREEDER"]),
  targetId: cuidSchema,
  rating: z.number().int().min(1).max(5),
  title: safeText(120, 0).optional(),
  body: safeParagraph(2000, 20),
  orderId: cuidSchema.optional(),
  petOrderId: cuidSchema.optional(),
  appointmentId: cuidSchema.optional(),
});

export async function createReview(auth: AuthContext, input: z.infer<typeof reviewSchema>) {
  await enforceRateLimit("review", auth.user.id);

  // Proving the transaction is what makes the review worth reading.
  const proof = await verifyTransaction(auth, input);
  if (!proof.verified) {
    throw badRequest(
      "You can only review someone you have completed a transaction with on PetMate.",
    );
  }

  const existing = await db.review.findFirst({
    where: {
      authorId: auth.user.id,
      targetType: input.targetType,
      targetId: input.targetId,
      orderId: input.orderId ?? null,
    },
    select: { id: true },
  });
  if (existing) throw conflict("You have already reviewed this.");

  const review = await db.$transaction(async (tx) => {
    const created = await tx.review.create({
      data: {
        authorId: auth.user.id,
        targetType: input.targetType,
        targetId: input.targetId,
        rating: input.rating,
        title: input.title ?? null,
        body: input.body,
        orderId: input.orderId ?? null,
        petOrderId: input.petOrderId ?? null,
        appointmentId: input.appointmentId ?? null,
        isVerified: true,
      },
      select: { id: true, rating: true },
    });

    // Aggregates are updated in the same transaction as the review, so the
    // displayed average can never disagree with the underlying rows.
    await updateAggregate(tx, input.targetType, input.targetId, input.rating);

    return created;
  });

  if (proof.targetUserId) {
    await awardTrustSignal(
      proof.targetUserId,
      input.rating >= 4 ? "REVIEW_RECEIVED_POSITIVE" : "REVIEW_RECEIVED_NEGATIVE",
      { reference: review.id },
    );

    await notify({
      userId: proof.targetUserId,
      category: "SYSTEM",
      type: "review.received",
      title: `You received a ${input.rating}-star review`,
      body: input.title ?? input.body.slice(0, 140),
      url: "/dashboard/reviews",
      entityType: "REVIEW",
      entityId: review.id,
    });
  }

  return review;
}

/** Confirms the author really transacted with the target. */
async function verifyTransaction(
  auth: AuthContext,
  input: z.infer<typeof reviewSchema>,
): Promise<{ verified: boolean; targetUserId: string | null }> {
  switch (input.targetType) {
    case "CLINIC":
    case "VET": {
      const appointment = await db.appointment.findFirst({
        where: {
          userId: auth.user.id,
          status: "COMPLETED",
          ...(input.appointmentId ? { id: input.appointmentId } : {}),
          ...(input.targetType === "CLINIC" ? { clinicId: input.targetId } : { vetId: input.targetId }),
        },
        select: { id: true, clinic: { select: { ownerUserId: true } } },
      });
      return { verified: Boolean(appointment), targetUserId: appointment?.clinic.ownerUserId ?? null };
    }

    case "SHOP":
    case "PRODUCT": {
      const item = await db.orderItem.findFirst({
        where: {
          order: { buyerId: auth.user.id, status: { in: ["DELIVERED", "SHIPPED"] } },
          ...(input.targetType === "SHOP"
            ? { shopId: input.targetId }
            : { variant: { productId: input.targetId } }),
          ...(input.orderId ? { orderId: input.orderId } : {}),
        },
        select: { id: true, shop: { select: { ownerUserId: true } } },
      });
      return { verified: Boolean(item), targetUserId: item?.shop.ownerUserId ?? null };
    }

    case "SELLER":
    case "BREEDER": {
      const petOrder = await db.petOrder.findFirst({
        where: {
          buyerId: auth.user.id,
          sellerId: input.targetId,
          status: "COMPLETED",
          ...(input.petOrderId ? { id: input.petOrderId } : {}),
        },
        select: { id: true, sellerId: true },
      });
      if (petOrder) return { verified: true, targetUserId: petOrder.sellerId };

      // A completed adoption counts too: money did not change hands, but a
      // real, verifiable handover did.
      const adoption = await db.adoptionApplication.findFirst({
        where: {
          applicantId: auth.user.id,
          status: "COMPLETED",
          listing: { sellerId: input.targetId },
        },
        select: { id: true },
      });
      return { verified: Boolean(adoption), targetUserId: adoption ? input.targetId : null };
    }

    default:
      return { verified: false, targetUserId: null };
  }
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function updateAggregate(tx: Tx, targetType: string, targetId: string, rating: number) {
  switch (targetType) {
    case "CLINIC": {
      const clinic = await tx.clinic.findUnique({
        where: { id: targetId },
        select: { ratingAvgBps: true, ratingCount: true },
      });
      if (!clinic) return;
      await tx.clinic.update({
        where: { id: targetId },
        data: {
          ratingAvgBps: nextRatingAvgBps(clinic.ratingAvgBps, clinic.ratingCount, rating),
          ratingCount: { increment: 1 },
        },
      });
      break;
    }
    case "VET": {
      const vet = await tx.vet.findUnique({
        where: { id: targetId },
        select: { ratingAvgBps: true, ratingCount: true },
      });
      if (!vet) return;
      await tx.vet.update({
        where: { id: targetId },
        data: {
          ratingAvgBps: nextRatingAvgBps(vet.ratingAvgBps, vet.ratingCount, rating),
          ratingCount: { increment: 1 },
        },
      });
      break;
    }
    case "SHOP": {
      const shop = await tx.shop.findUnique({
        where: { id: targetId },
        select: { ratingAvgBps: true, ratingCount: true },
      });
      if (!shop) return;
      await tx.shop.update({
        where: { id: targetId },
        data: {
          ratingAvgBps: nextRatingAvgBps(shop.ratingAvgBps, shop.ratingCount, rating),
          ratingCount: { increment: 1 },
        },
      });
      break;
    }
    case "PRODUCT": {
      const product = await tx.product.findUnique({
        where: { id: targetId },
        select: { ratingAvgBps: true, ratingCount: true },
      });
      if (!product) return;
      await tx.product.update({
        where: { id: targetId },
        data: {
          ratingAvgBps: nextRatingAvgBps(product.ratingAvgBps, product.ratingCount, rating),
          ratingCount: { increment: 1 },
        },
      });
      break;
    }
    case "SELLER":
    case "BREEDER": {
      const user = await tx.user.findUnique({
        where: { id: targetId },
        select: { ratingAvgBps: true, ratingCount: true },
      });
      if (!user) return;
      await tx.user.update({
        where: { id: targetId },
        data: {
          ratingAvgBps: nextRatingAvgBps(user.ratingAvgBps, user.ratingCount, rating),
          ratingCount: { increment: 1 },
        },
      });
      break;
    }
  }
}

export async function respondToReview(auth: AuthContext, reviewId: string, response: string) {
  const review = await db.review.findUnique({
    where: { id: reviewId },
    select: { id: true, targetType: true, targetId: true, sellerResponse: true, authorId: true },
  });
  if (!review) throw notFound("That review");
  if (review.sellerResponse) throw conflict("You have already responded to this review.");

  const owns = await ownsTarget(auth, review.targetType, review.targetId);
  if (!owns) throw notFound("That review");

  await db.review.update({
    where: { id: reviewId },
    data: { sellerResponse: response.slice(0, 1500), sellerRespondedAt: new Date() },
  });

  await notify({
    userId: review.authorId,
    category: "SYSTEM",
    type: "review.response",
    title: "Your review received a reply",
    body: response.slice(0, 140),
    url: "/dashboard/reviews",
    entityType: "REVIEW",
    entityId: reviewId,
  });
}

async function ownsTarget(auth: AuthContext, targetType: string, targetId: string): Promise<boolean> {
  switch (targetType) {
    case "CLINIC":
      return Boolean(
        await db.clinic.findFirst({
          where: {
            id: targetId,
            OR: [{ ownerUserId: auth.user.id }, { members: { some: { userId: auth.user.id, role: { in: ["OWNER", "ADMIN"] } } } }],
          },
          select: { id: true },
        }),
      );
    case "SHOP":
      return Boolean(
        await db.shop.findFirst({ where: { id: targetId, ownerUserId: auth.user.id }, select: { id: true } }),
      );
    case "PRODUCT":
      return Boolean(
        await db.product.findFirst({
          where: { id: targetId, shop: { ownerUserId: auth.user.id } },
          select: { id: true },
        }),
      );
    case "VET":
      return Boolean(
        await db.vet.findFirst({ where: { id: targetId, userId: auth.user.id }, select: { id: true } }),
      );
    case "SELLER":
    case "BREEDER":
      return targetId === auth.user.id;
    default:
      return false;
  }
}

export async function listReviews(
  targetType: string,
  targetId: string,
  opts: { limit?: number; page?: number } = {},
) {
  const limit = Math.min(opts.limit ?? 10, 50);
  const page = Math.max(1, opts.page ?? 1);

  const where = { targetType, targetId, status: "PUBLISHED" } as const;

  const [items, total, distribution] = await Promise.all([
    db.review.findMany({
      where,
      orderBy: [{ helpfulCount: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        isVerified: true,
        sellerResponse: true,
        sellerRespondedAt: true,
        helpfulCount: true,
        createdAt: true,
        author: { select: { id: true, name: true, handle: true, avatarUrl: true, trustScore: true } },
      },
    }),
    db.review.count({ where }),
    db.review.groupBy({ by: ["rating"], where, _count: true }),
  ]);

  const counts = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: distribution.find((d) => d.rating === star)?._count ?? 0,
  }));

  return { items, total, page, limit, distribution: counts };
}

/** Things the user has completed but not yet reviewed. Drives the prompt. */
export async function getPendingReviews(auth: AuthContext) {
  const [appointments, orders, purchases] = await Promise.all([
    db.appointment.findMany({
      where: { userId: auth.user.id, status: "COMPLETED" },
      orderBy: { startAt: "desc" },
      take: 5,
      select: {
        id: true,
        clinicId: true,
        startAt: true,
        clinic: { select: { id: true, name: true, slug: true, logoUrl: true } },
        pet: { select: { name: true } },
      },
    }),
    db.order.findMany({
      where: { buyerId: auth.user.id, status: "DELIVERED" },
      orderBy: { placedAt: "desc" },
      take: 5,
      select: {
        id: true,
        orderNumber: true,
        items: { select: { shopId: true, titleSnapshot: true, imageSnapshot: true, shop: { select: { name: true } } } },
      },
    }),
    db.petOrder.findMany({
      where: { buyerId: auth.user.id, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        sellerId: true,
        listing: { select: { title: true, pet: { select: { name: true } } } },
      },
    }),
  ]);

  const reviewed = await db.review.findMany({
    where: { authorId: auth.user.id },
    select: { targetType: true, targetId: true, orderId: true, appointmentId: true, petOrderId: true },
  });

  const done = new Set(reviewed.map((r) => `${r.targetType}:${r.targetId}`));

  const pending: { type: string; targetType: string; targetId: string; label: string; context: string; refId: string }[] = [];

  for (const a of appointments) {
    if (!done.has(`CLINIC:${a.clinicId}`)) {
      pending.push({
        type: "appointment",
        targetType: "CLINIC",
        targetId: a.clinicId,
        label: a.clinic.name,
        context: `Visit for ${a.pet.name}`,
        refId: a.id,
      });
    }
  }
  for (const o of orders) {
    for (const item of o.items) {
      if (!done.has(`SHOP:${item.shopId}`)) {
        pending.push({
          type: "order",
          targetType: "SHOP",
          targetId: item.shopId,
          label: item.shop.name,
          context: item.titleSnapshot,
          refId: o.id,
        });
      }
    }
  }
  for (const p of purchases) {
    if (!done.has(`SELLER:${p.sellerId}`)) {
      pending.push({
        type: "purchase",
        targetType: "SELLER",
        targetId: p.sellerId,
        label: p.listing.pet.name,
        context: p.listing.title,
        refId: p.id,
      });
    }
  }

  return pending.slice(0, 6);
}

export async function markHelpful(auth: AuthContext, reviewId: string) {
  const existing = await db.reaction.findUnique({
    where: {
      userId_targetType_targetId: { userId: auth.user.id, targetType: "REVIEW", targetId: reviewId },
    },
    select: { id: true },
  });

  if (existing) {
    await db.$transaction([
      db.reaction.delete({ where: { id: existing.id } }),
      db.review.update({ where: { id: reviewId }, data: { helpfulCount: { decrement: 1 } } }),
    ]);
    return { helpful: false };
  }

  await db.$transaction([
    db.reaction.create({
      data: { userId: auth.user.id, targetType: "REVIEW", targetId: reviewId, kind: "HELPFUL" },
    }),
    db.review.update({ where: { id: reviewId }, data: { helpfulCount: { increment: 1 } } }),
  ]);
  return { helpful: true };
}
