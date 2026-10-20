import { z } from "zod";
import { route } from "@/lib/api";
import { requireStaff } from "@/lib/auth/rbac";
import { exportCsv, resolveResource } from "@/lib/admin/data.service";
import { parseListParams } from "@/lib/admin/query";

/**
 * CSV export of whatever the list page is showing: same search, same filters,
 * same view, capped at 5,000 rows. Exports are audited, because a CSV of
 * members is the most portable copy of personal data the console can make.
 */
export const GET = route({
  permission: "admin:read",
  rateLimit: "api",
  params: z.object({ resource: z.string().min(1).max(60).regex(/^[a-z-]+$/) }),
  async handler({ params, request, ip, userAgent }) {
    const auth = await requireStaff();
    const def = resolveResource(auth, params.resource);
    const { q, filters, view, sort, dir } = parseListParams(new URL(request.url).searchParams);
    const { csv } = await exportCsv(auth, def, { q, filters, view, sort, dir }, { ip, userAgent });

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="petmate-${def.key}-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  },
});
