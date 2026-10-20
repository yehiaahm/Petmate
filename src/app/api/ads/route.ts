import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import {
  adCampaignSchema,
  createAdCampaign,
  payForDraft,
  cancelDraft,
  setCampaignPaused,
  endCampaignEarly,
  recordImpression,
  listMyCampaigns,
} from "@/lib/services/ad.service";
import { cuidSchema } from "@/lib/validation/common";
import { adVisitorKey } from "@/lib/ads/visitor";

export const GET = route({
  auth: true,
  async handler() {
    const auth = await requireActive();
    return { campaigns: await listMyCampaigns(auth) };
  },
});

export const POST = route({
  body: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("create"),
      // Validated (and its dates parsed) by the service, which owns the rules.
      campaign: z.record(z.string(), z.unknown()),
      idempotencyKey: z.string().min(8).max(80),
    }),
    z.object({ action: z.literal("pay"), campaignId: cuidSchema }),
    z.object({ action: z.literal("discard"), campaignId: cuidSchema }),
    z.object({ action: z.literal("pause"), campaignId: cuidSchema }),
    z.object({ action: z.literal("resume"), campaignId: cuidSchema }),
    z.object({ action: z.literal("end"), campaignId: cuidSchema }),
    // Public: the beacon an ad sends once it has actually been on screen.
    z.object({ action: z.literal("impression"), campaignId: cuidSchema }),
  ]),
  async handler({ body, request, ip }) {
    if (body.action === "impression") {
      return recordImpression(body.campaignId, adVisitorKey(request, ip), ip);
    }

    const auth = await requireActive();
    switch (body.action) {
      case "create":
        return createAdCampaign(auth, body.campaign as z.input<typeof adCampaignSchema>, body.idempotencyKey);
      case "pay":
        return payForDraft(auth, body.campaignId);
      case "discard":
        return cancelDraft(auth, body.campaignId);
      case "pause":
        return setCampaignPaused(auth, body.campaignId, true);
      case "resume":
        return setCampaignPaused(auth, body.campaignId, false);
      case "end":
        return endCampaignEarly(auth, body.campaignId);
    }
  },
});
