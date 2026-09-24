import { z } from "zod";
import { route, idParam } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { transferPet, respondToTransfer } from "@/lib/services/pet.service";
import { cuidSchema, optionalText } from "@/lib/validation/common";

/**
 * Pet ownership transfer.
 *
 * Two-sided by design: the owner offers, the recipient accepts. A one-sided
 * transfer would let anyone push an animal — and its costs and obligations —
 * onto someone who never agreed to it.
 */

export const GET = route({
  auth: true,
  params: idParam,
  async handler({ params, auth }) {
    // Visible to either party, and nobody else.
    const transfers = await db.petTransfer.findMany({
      where: {
        petId: params.id,
        OR: [{ fromUserId: auth!.user.id }, { toUserId: auth!.user.id }],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        reason: true,
        note: true,
        createdAt: true,
        respondedAt: true,
        from: { select: { id: true, name: true, handle: true } },
        to: { select: { id: true, name: true, handle: true } },
      },
    });

    return { transfers };
  },
});

export const POST = route({
  auth: true,
  verifiedEmail: true,
  params: idParam,
  body: z.object({
    toUserId: cuidSchema,
    reason: z.enum(["GIFT", "RESCUE", "SALE", "ADOPTION"]),
    note: optionalText(500),
  }),
  async handler({ params, body }) {
    const auth = await requireActive();

    const transfer = await transferPet(auth, {
      petId: params.id,
      toUserId: body.toUserId,
      reason: body.reason,
      note: body.note,
    });

    return { transfer };
  },
});

export const PATCH = route({
  auth: true,
  params: idParam,
  body: z.object({ transferId: cuidSchema, accept: z.boolean() }),
  async handler({ body }) {
    const auth = await requireActive();
    await respondToTransfer(auth, body.transferId, body.accept);
    return { ok: true };
  },
});
