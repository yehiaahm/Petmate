import { z } from "zod";
import { route } from "@/lib/api";
import { requireStaff } from "@/lib/auth/rbac";
import { globalSearch } from "@/lib/admin/data.service";

/** Backs the console's command palette: one query across every table the caller can read. */
export const GET = route({
  permission: "admin:read",
  rateLimit: "search",
  query: z.object({ q: z.string().trim().max(100).default("") }),
  async handler({ query }) {
    const auth = await requireStaff();
    return { groups: await globalSearch(auth, query.q) };
  },
});
