import { z } from "zod";
import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { handleSchema } from "@/lib/validation/common";

/**
 * Handle lookup.
 *
 * Deliberately narrow: it takes a handle the caller already knows and returns
 * only what is needed to address a transfer or an invitation. It does not
 * search, so it cannot be walked to enumerate the member list, and it never
 * returns an email address.
 *
 * Requires a session and is rate limited, because even a narrow lookup is a
 * way to confirm which handles exist.
 */
export const GET = route({
  auth: true,
  rateLimit: "api",
  query: z.object({ handle: handleSchema }),
  async handler({ query }) {
    const user = await db.user.findFirst({
      where: { handle: query.handle, deletedAt: null, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        handle: true,
        avatarUrl: true,
        city: true,
        country: true,
        trustScore: true,
      },
    });

    return { user };
  },
});
