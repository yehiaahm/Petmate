import { z } from "zod";
import { route } from "@/lib/api";
import { requireStaff } from "@/lib/auth/rbac";
import {
  getRecord,
  purgeRecord,
  resolveResource,
  restoreRecord,
  softDeleteRecord,
  updateRecord,
} from "@/lib/admin/data.service";
import { cuidSchema } from "@/lib/validation/common";

/**
 * One record: read it, edit it, archive it, restore it, or (super admin only)
 * delete it for good. Field-level validation lives in the data service, which
 * builds its schema from the registry for exactly the fields being changed.
 */

const params = z.object({
  resource: z.string().min(1).max(60).regex(/^[a-z-]+$/),
  id: cuidSchema,
});

export const GET = route({
  permission: "admin:read",
  params,
  async handler({ params }) {
    const auth = await requireStaff();
    const def = resolveResource(auth, params.resource);
    return getRecord(auth, def, params.id);
  },
});

export const PATCH = route({
  permission: "admin:read",
  rateLimit: "api",
  params,
  body: z.object({ data: z.record(z.string().max(40), z.unknown()) }),
  async handler({ params, body, ip, userAgent }) {
    const auth = await requireStaff();
    const def = resolveResource(auth, params.resource);
    return updateRecord(auth, def, params.id, body.data, { ip, userAgent });
  },
});

export const DELETE = route({
  permission: "admin:read",
  rateLimit: "api",
  params,
  query: z.object({ mode: z.enum(["soft", "hard"]).default("soft") }),
  async handler({ params, query, ip, userAgent }) {
    const auth = await requireStaff();
    const def = resolveResource(auth, params.resource);
    if (query.mode === "hard") await purgeRecord(auth, def, params.id, { ip, userAgent });
    else await softDeleteRecord(auth, def, params.id, { ip, userAgent });
    return { ok: true };
  },
});

export const POST = route({
  permission: "admin:read",
  rateLimit: "api",
  params,
  body: z.object({ action: z.literal("restore") }),
  async handler({ params, ip, userAgent }) {
    const auth = await requireStaff();
    const def = resolveResource(auth, params.resource);
    await restoreRecord(auth, def, params.id, { ip, userAgent });
    return { ok: true };
  },
});
