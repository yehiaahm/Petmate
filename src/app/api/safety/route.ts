import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import {
  fileReport,
  reportSchema,
  submitVerification,
  verificationSchema,
  openDispute,
  disputeSchema,
  addDisputeMessage,
  getDispute,
  listMyDisputes,
} from "@/lib/services/safety.service";
import { cuidSchema, safeParagraph } from "@/lib/validation/common";

export const GET = route({
  auth: true,
  query: z.object({
    mode: z.enum(["disputes", "dispute"]).default("disputes"),
    id: cuidSchema.optional(),
  }),
  async handler({ query }) {
    const auth = await requireActive();

    if (query.mode === "dispute" && query.id) {
      const dispute = await getDispute(auth, query.id);
      return { dispute };
    }

    const disputes = await listMyDisputes(auth);
    return { disputes };
  },
});

export const POST = route({
  auth: true,
  body: z.discriminatedUnion("action", [
    z.object({ action: z.literal("report"), report: reportSchema }),
    z.object({ action: z.literal("verify"), verification: verificationSchema }),
    z.object({ action: z.literal("dispute"), dispute: disputeSchema }),
    z.object({
      action: z.literal("dispute-message"),
      disputeId: cuidSchema,
      body: safeParagraph(3000, 5),
      evidence: z.array(cuidSchema).max(5).optional(),
    }),
  ]),
  async handler({ body }) {
    const auth = await requireActive();

    switch (body.action) {
      case "report": {
        await fileReport(auth, body.report);
        // Never confirm what happened next: that would tell a bad actor
        // whether their listing was auto-paused.
        return { ok: true, message: "Thanks — our team will review this." };
      }
      case "verify": {
        const verification = await submitVerification(auth, body.verification);
        return { verification };
      }
      case "dispute": {
        const dispute = await openDispute(auth, body.dispute);
        return { dispute };
      }
      case "dispute-message":
        await addDisputeMessage(auth, body.disputeId, body.body, body.evidence);
        return { ok: true };
    }
  },
});
