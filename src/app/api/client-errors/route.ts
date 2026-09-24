import { z } from "zod";
import { route } from "@/lib/api";
import { captureException } from "@/lib/monitoring/sentry";

/**
 * Errors from visitors' browsers, relayed to Sentry so the DSN never has to
 * be public. Rate limited per visitor, sized so a stack fits and nothing
 * else does, and sent without the query string or any identity.
 */
export const POST = route({
  rateLimit: "clientError",
  body: z.object({
    message: z.string().max(1000),
    name: z.string().max(100).optional(),
    stack: z.string().max(8000).optional(),
    url: z.string().max(1000).optional(),
    digest: z.string().max(100).optional(),
    source: z.enum(["window", "promise", "boundary"]),
  }),
  async handler({ body, userAgent }) {
    const error = Object.assign(new Error(body.message), { name: body.name || "Error", stack: body.stack });
    await captureException({
      error,
      platform: "javascript",
      message: `Browser error (${body.source})`,
      url: body.url,
      tags: { source: body.source, ...(body.digest ? { digest: body.digest } : {}) },
      context: { userAgent: userAgent?.slice(0, 200) ?? null },
    });
    return { ok: true };
  },
});
