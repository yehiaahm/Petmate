import { z } from "zod";
import { route } from "@/lib/api";
import { requireActive } from "@/lib/auth/rbac";
import { getAuth } from "@/lib/auth/session";
import { createListing, createListingSchema } from "@/lib/services/listing.service";
import { searchListings } from "@/lib/services/search.service";
import { SPECIES, LISTING_INTENT, LIMITS } from "@/lib/constants";
import { csvParam, csvIds, booleanParam } from "@/lib/validation/common";

const searchQuerySchema = z.object({
  q: z.string().max(200).optional(),
  intent: z.enum(LISTING_INTENT).optional(),
  species: csvParam(SPECIES).optional(),
  breedIds: csvIds.optional(),
  sex: z.enum(["MALE", "FEMALE"]).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  minAge: z.coerce.number().int().min(0).max(360).optional(),
  maxAge: z.coerce.number().int().min(0).max(360).optional(),
  city: z.string().max(80).optional(),
  country: z.string().max(60).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().min(1).max(2000).optional(),
  verified: booleanParam.optional(),
  vaccinated: booleanParam.optional(),
  minHealth: z.coerce.number().int().min(0).max(100).optional(),
  minTrust: z.coerce.number().int().min(0).max(100).optional(),
  sort: z.enum(["relevance", "newest", "price_asc", "price_desc", "distance", "health"]).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(LIMITS.pageSizeDefault),
});

export const GET = route({
  query: searchQuerySchema,
  rateLimit: "search",
  async handler({ query }) {
    const auth = await getAuth();

    return searchListings({
      query: query.q,
      intent: query.intent,
      species: query.species,
      breedIds: query.breedIds,
      sex: query.sex,
      minPriceCents: query.minPrice != null ? query.minPrice * 100 : undefined,
      maxPriceCents: query.maxPrice != null ? query.maxPrice * 100 : undefined,
      minAgeMonths: query.minAge,
      maxAgeMonths: query.maxAge,
      city: query.city,
      country: query.country,
      lat: query.lat,
      lng: query.lng,
      radiusKm: query.radius,
      verifiedOnly: query.verified,
      vaccinatedOnly: query.vaccinated,
      minHealthScore: query.minHealth,
      minSellerTrust: query.minTrust,
      sort: query.sort,
      page: query.page,
      limit: query.limit,
      viewerId: auth?.user.id,
    });
  },
});

export const POST = route({
  auth: true,
  verifiedEmail: true,
  rateLimit: "listingCreate",
  body: createListingSchema,
  async handler({ body }) {
    const auth = await requireActive();
    const listing = await createListing(auth, body);
    return { listing };
  },
});
