import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import {
  submitApplication,
  adoptionApplicationSchema,
  decideApplication,
  withdrawApplication,
  completeAdoption,
  listApplicationsForListing,
  listMyApplications,
} from "@/lib/services/adoption.service";
import { cuidSchema, safeParagraph } from "@/lib/validation/common";

export const GET = route({
  auth: true,
  query: z.object({
    listingId: cuidSchema.optional(),
  }),
  async handler({ query }) {
    const auth = await requireActive();

    if (query.listingId) {
      const applications = await listApplicationsForListing(auth, query.listingId);
      return { applications };
    }

    const applications = await listMyApplications(auth);
    return { applications };
  },
});

export const POST = route({
  auth: true,
  verifiedEmail: true,
  rateLimit: "adoptionApply",
  body: z.discriminatedUnion("action", [
    z.object({ action: z.literal("apply"), application: adoptionApplicationSchema }),
    z.object({
      action: z.literal("decide"),
      applicationId: cuidSchema,
      decision: z.enum(["APPROVED", "REJECTED", "IN_REVIEW"]),
      note: safeParagraph(1000, 0).optional(),
    }),
    z.object({ action: z.literal("withdraw"), applicationId: cuidSchema }),
    z.object({ action: z.literal("complete"), applicationId: cuidSchema }),
  ]),
  async handler({ body }) {
    const auth = await requireActive();

    switch (body.action) {
      case "apply": {
        const application = await submitApplication(auth, body.application);
        return { application };
      }
      case "decide":
        await decideApplication(auth, body.applicationId, body.decision, body.note);
        return { ok: true };
      case "withdraw":
        await withdrawApplication(auth, body.applicationId);
        return { ok: true };
      case "complete":
        await completeAdoption(auth, body.applicationId);
        return { ok: true };
    }
  },
});
