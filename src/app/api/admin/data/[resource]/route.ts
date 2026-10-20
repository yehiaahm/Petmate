import { z } from "zod";
import { route } from "@/lib/api";
import { requireStaff } from "@/lib/auth/rbac";
import { bulkAction, listRecords, resolveResource } from "@/lib/admin/data.service";
import { parseListParams } from "@/lib/admin/query";
import { cuidSchema } from "@/lib/validation/common";

/**
 * Admin data API: list a table, or act on many of its rows at once.
 *
 * The table key is checked against the registry and the caller's role before
 * anything else, and every bulk action fans out to the single-record path, so
 * it carries the same guards and leaves one audit row per record.
 */

const params = z.object({ resource: z.string().min(1).max(60).regex(/^[a-z-]+$/) });

export const GET = route({
  permission: "admin:read",
  rateLimit: "api",
  params,
  async handler({ params, request }) {
    const auth = await requireStaff();
    const def = resolveResource(auth, params.resource);
    return listRecords(def, parseListParams(new URL(request.url).searchParams));
  },
});

export const POST = route({
  permission: "admin:read",
  rateLimit: "api",
  params,
  body: z.object({
    action: z.enum(["delete", "restore", "purge", "set-status"]),
    ids: z.array(cuidSchema).min(1).max(100),
    value: z.string().min(1).max(40).optional(),
  }),
  async handler({ params, body, ip, userAgent }) {
    const auth = await requireStaff();
    const def = resolveResource(auth, params.resource);
    return bulkAction(auth, def, body.action, [...new Set(body.ids)], body.value, { ip, userAgent });
  },
});
