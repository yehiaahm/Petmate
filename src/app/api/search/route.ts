import { z } from "zod";
import { route } from "@/lib/api";
import { getAuth } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { searchSuggestions, getListingFacets, getRecommendedListings } from "@/lib/services/search.service";
import { parseNaturalSearch } from "@/lib/ai/features";
import { assertCanCreateSavedSearchAlert } from "@/lib/billing/entitlements";
import { requireActive } from "@/lib/auth/rbac";
import { safeText, cuidSchema } from "@/lib/validation/common";
import { LISTING_INTENT } from "@/lib/constants";

export const GET = route({
  rateLimit: "search",
  query: z.object({
    q: z.string().max(200).optional(),
    mode: z.enum(["suggest", "facets", "recommend"]).default("suggest"),
    intent: z.enum(LISTING_INTENT).optional(),
    country: z.string().max(60).optional(),
  }),
  async handler({ query }) {
    const auth = await getAuth();

    if (query.mode === "facets") {
      return getListingFacets({ intent: query.intent, country: query.country });
    }

    if (query.mode === "recommend") {
      return getRecommendedListings(auth?.user.id ?? null, {
        lat: auth?.user.lat,
        lng: auth?.user.lng,
        country: auth?.user.country ?? query.country ?? null,
      });
    }

    const suggestions = await searchSuggestions(query.q ?? "");
    return { suggestions };
  },
});

export const POST = route({
  rateLimit: "search",
  body: z.discriminatedUnion("action", [
    // Natural-language query -> structured filters. Returns which engine ran.
    z.object({ action: z.literal("parse"), query: z.string().min(1).max(300) }),
    z.object({
      action: z.literal("save"),
      name: safeText(80, 2),
      filters: z.record(z.string(), z.unknown()),
      alerts: z.boolean().default(true),
    }),
    z.object({ action: z.literal("delete-saved"), id: cuidSchema }),
  ]),
  async handler({ body }) {
    if (body.action === "parse") {
      const result = await parseNaturalSearch(body.query);
      return { filters: result.data, source: result.source, note: result.note };
    }

    const auth = await requireActive();

    if (body.action === "delete-saved") {
      await db.savedSearch.deleteMany({ where: { id: body.id, userId: auth.user.id } });
      return { ok: true };
    }

    if (body.alerts) await assertCanCreateSavedSearchAlert(auth.user.id);

    const saved = await db.savedSearch.create({
      data: {
        userId: auth.user.id,
        name: body.name,
        entity: "LISTING",
        query: JSON.stringify(body.filters),
        alertsEnabled: body.alerts,
      },
      select: { id: true, name: true, alertsEnabled: true },
    });

    return { saved };
  },
});
