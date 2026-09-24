import { z } from "zod";
import { route, idParam } from "@/lib/api";
import { requireActive, requireAuth } from "@/lib/auth/rbac";
import {
  addHealthRecord,
  healthRecordBodySchema,
  getHealthTimeline,
  completeReminder,
  dismissReminder,
  createReminder,
} from "@/lib/services/health.service";
import { cuidSchema, safeText, futureDateSchema } from "@/lib/validation/common";

export const GET = route({
  auth: true,
  params: idParam,
  async handler({ params }) {
    const auth = await requireAuth();
    return getHealthTimeline(params.id, auth);
  },
});

/**
 * The pet id comes from the path, not the body, so a record cannot be written
 * against a different animal than the one the caller is authorised for.
 */
export const POST = route({
  auth: true,
  params: idParam,
  body: z.union([
    z.object({
      kind: z.literal("reminder"),
      title: safeText(120, 2),
      dueAt: futureDateSchema,
    }),
    z.object({ kind: z.literal("record"), record: healthRecordBodySchema }),
  ]),
  async handler({ params, body }) {
    const auth = await requireActive();

    if (body.kind === "reminder") {
      const reminder = await createReminder(auth, {
        petId: params.id,
        title: body.title,
        dueAt: body.dueAt,
      });
      return { reminder };
    }

    const created = await addHealthRecord(auth, { ...body.record, petId: params.id });
    return { record: created };
  },
});

export const PATCH = route({
  auth: true,
  params: idParam,
  body: z.object({
    reminderId: cuidSchema,
    action: z.enum(["complete", "dismiss"]),
  }),
  async handler({ body }) {
    const auth = await requireActive();
    if (body.action === "complete") {
      await completeReminder(auth, body.reminderId);
    } else {
      await dismissReminder(auth, body.reminderId);
    }
    return { ok: true };
  },
});
