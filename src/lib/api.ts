import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, badRequest, toAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { assertCsrf, getAuth, requestMeta, type AuthContext } from "@/lib/auth/session";
import { enforceRateLimit, type RateLimitName } from "@/lib/rate-limit";
import { forbidden, unauthenticated } from "@/lib/errors";
import { permissionsFor, type Permission } from "@/lib/auth/rbac";
import { LIMITS } from "@/lib/constants";

/**
 * The single front door for every route handler.
 *
 * `route()` applies, in order: body-size guard, CSRF, rate limit, auth, role
 * check, schema validation. A handler therefore never has to remember any of
 * them, and "I forgot the auth check on this one endpoint" stops being a class
 * of bug that can exist.
 */

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB for JSON; uploads use their own route

export interface RouteContext<TBody, TQuery, TParams> {
  request: Request;
  body: TBody;
  query: TQuery;
  params: TParams;
  auth: AuthContext | null;
  ip: string | null;
  userAgent: string | null;
}

interface RouteOptions<TBody, TQuery, TParams> {
  /** Require a signed-in, non-suspended account. */
  auth?: boolean;
  /** Require a confirmed email address on top of `auth`. */
  verifiedEmail?: boolean;
  /** Require a permission; implies `auth`. */
  permission?: Permission;
  /** Rate-limit bucket. Keyed by user id when signed in, otherwise by IP. */
  rateLimit?: RateLimitName;
  /** Skip CSRF. Only for provider webhooks, which authenticate by signature. */
  skipCsrf?: boolean;
  body?: z.ZodType<TBody>;
  query?: z.ZodType<TQuery>;
  params?: z.ZodType<TParams>;
  handler: (ctx: RouteContext<TBody, TQuery, TParams>) => Promise<unknown>;
}

type NextRouteArgs = { params: Promise<Record<string, string | string[]>> };

export function route<TBody = undefined, TQuery = undefined, TParams = undefined>(
  options: RouteOptions<TBody, TQuery, TParams>,
) {
  return async function handler(request: Request, ctx?: NextRouteArgs) {
    const started = performance.now();
    const method = request.method.toUpperCase();
    const path = new URL(request.url).pathname;

    try {
      // ---- 1. CSRF, before anything reads the body -------------------------
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);
      if (mutating && !options.skipCsrf) {
        if (!(await assertCsrf(request))) {
          throw forbidden("Your session expired. Refresh the page and try again.");
        }
      }

      // ---- 2. Identity -----------------------------------------------------
      const auth = await getAuth();
      const needsAuth = options.auth || options.verifiedEmail || options.permission;

      if (needsAuth && !auth) throw unauthenticated();

      if (auth && needsAuth) {
        if (auth.user.status === "SUSPENDED") {
          throw forbidden("Your account is suspended. Contact support to appeal.");
        }
        if (auth.user.status === "FROZEN") {
          throw forbidden("Your account is frozen while we review recent activity.");
        }
      }

      if (options.verifiedEmail && auth && !auth.user.emailVerified) {
        throw forbidden("Please confirm your email address before continuing.");
      }

      if (options.permission && auth) {
        if (!permissionsFor(auth.user.roles).has(options.permission)) {
          throw forbidden("You do not have permission to do that.", `missing ${options.permission}`);
        }
      }

      const meta = await requestMeta();

      // ---- 3. Rate limit ---------------------------------------------------
      if (options.rateLimit) {
        const identifier = auth?.user.id ?? meta.ip ?? "anonymous";
        await enforceRateLimit(options.rateLimit, identifier);
      }

      // ---- 4. Input --------------------------------------------------------
      let body = undefined as TBody;
      if (options.body) {
        body = await parseBody(request, options.body);
      }

      let query = undefined as TQuery;
      if (options.query) {
        const url = new URL(request.url);
        const raw: Record<string, string | string[]> = {};
        for (const key of new Set(url.searchParams.keys())) {
          const all = url.searchParams.getAll(key);
          raw[key] = all.length > 1 ? all : all[0]!;
        }
        query = validate(options.query, raw, "query");
      }

      let params = undefined as TParams;
      if (options.params) {
        const raw = ctx?.params ? await ctx.params : {};
        params = validate(options.params, raw, "params");
      }

      // ---- 5. Run ----------------------------------------------------------
      const result = await options.handler({
        request,
        body,
        query,
        params,
        auth,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      if (result instanceof NextResponse || result instanceof Response) return result;
      if (result === undefined || result === null) {
        return NextResponse.json({ ok: true });
      }
      return NextResponse.json(result);
    } catch (error) {
      return errorResponse(error, { method, path, started });
    }
  };
}

async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    throw badRequest("Request body is too large.");
  }

  const contentType = request.headers.get("content-type") ?? "";
  let raw: unknown;

  if (contentType.includes("application/json")) {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) throw badRequest("Request body is too large.");
    if (!text.trim()) throw badRequest("A request body is required.");
    try {
      raw = JSON.parse(text);
    } catch {
      throw badRequest("Request body is not valid JSON.");
    }
  } else if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await request.formData();
    const obj: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") obj[k] = v;
    }
    raw = obj;
  } else {
    throw badRequest("Unsupported content type.");
  }

  // Objects only. A top-level array or scalar is never a valid body here, and
  // refusing it early removes a whole class of prototype-pollution shape.
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw badRequest("Request body must be a JSON object.");
  }
  for (const key of ["__proto__", "constructor", "prototype"]) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      Reflect.deleteProperty(raw as object, key);
    }
  }

  return validate(schema, raw, "body");
}

function validate<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  const fields = parsed.error.issues.map((i) => ({
    field: i.path.join(".") || where,
    message: i.message,
  }));
  throw new AppError("VALIDATION_ERROR", "Please check the highlighted fields.", { fields });
}

function errorResponse(
  error: unknown,
  ctx: { method: string; path: string; started: number },
): NextResponse {
  const appError = toAppError(error);
  const ms = Math.round(performance.now() - ctx.started);

  if (appError.status >= 500) {
    logger.exception(`${ctx.method} ${ctx.path} failed`, error, {
      code: appError.code,
      internal: appError.internal,
      ms,
    });
  } else if (appError.status === 429 || appError.status === 403) {
    logger.warn(`${ctx.method} ${ctx.path} rejected`, {
      code: appError.code,
      internal: appError.internal,
      ms,
    });
  }

  const headers: Record<string, string> = {};
  if (appError.code === "RATE_LIMITED") {
    const retry = (appError.meta?.retryAfterSeconds as number | undefined) ?? 60;
    headers["Retry-After"] = String(retry);
  }

  return NextResponse.json(appError.toJSON(), { status: appError.status, headers });
}

// ---------------------------------------------------------------------------
// Shared query schemas
// ---------------------------------------------------------------------------

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(LIMITS.pageSizeDefault),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function paginate({ page, limit }: Pagination) {
  return { skip: (page - 1) * limit, take: limit };
}

export function pageResult<T>(items: T[], total: number, { page, limit }: Pagination) {
  return {
    items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}

export const idParam = z.object({ id: z.string().min(1).max(64) });
export const slugParam = z.object({ slug: z.string().min(1).max(200) });
