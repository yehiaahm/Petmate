/**
 * Error taxonomy.
 *
 * Two rules hold everywhere:
 *   1. `message` on an AppError is safe to show a user. Anything sensitive goes
 *      in `internal`, which is logged and never serialised to a response.
 *   2. Unknown errors become a generic 500. A stack trace never leaves the
 *      server.
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_FAILED"
  | "UPGRADE_REQUIRED"
  | "UNPROCESSABLE"
  | "DEPENDENCY_FAILED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYMENT_REQUIRED: 402,
  PAYMENT_FAILED: 402,
  UPGRADE_REQUIRED: 402,
  UNPROCESSABLE: 422,
  DEPENDENCY_FAILED: 502,
  INTERNAL: 500,
};

export interface FieldError {
  field: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: FieldError[];
  readonly internal?: string;
  readonly meta?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      fields?: FieldError[];
      internal?: string;
      meta?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.fields = options.fields;
    this.internal = options.internal;
    this.meta = options.meta;
  }

  /** The shape every API error response uses. */
  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields ? { fields: this.fields } : {}),
        ...(this.meta ? { meta: this.meta } : {}),
      },
    };
  }
}

export const badRequest = (m: string, fields?: FieldError[]) =>
  new AppError("BAD_REQUEST", m, { fields });

export const unauthenticated = (m = "Please sign in to continue.") =>
  new AppError("UNAUTHENTICATED", m);

export const forbidden = (m = "You do not have access to this.", internal?: string) =>
  new AppError("FORBIDDEN", m, { internal });

export const notFound = (what = "That page") =>
  new AppError("NOT_FOUND", `${what} could not be found.`);

export const conflict = (m: string) => new AppError("CONFLICT", m);

export const unprocessable = (m: string, fields?: FieldError[]) =>
  new AppError("UNPROCESSABLE", m, { fields });

export const rateLimited = (retryAfterSeconds: number) =>
  new AppError("RATE_LIMITED", "Too many requests. Please slow down and try again.", {
    meta: { retryAfterSeconds },
  });

export const paymentFailed = (m: string, internal?: string) =>
  new AppError("PAYMENT_FAILED", m, { internal });

export const upgradeRequired = (m: string, meta?: Record<string, unknown>) =>
  new AppError("UPGRADE_REQUIRED", m, { meta });

export const dependencyFailed = (m: string, internal?: string) =>
  new AppError("DEPENDENCY_FAILED", m, { internal });

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/**
 * Turns anything thrown into a user-safe AppError. Prisma's own error codes are
 * translated so a unique-constraint violation reads as a conflict rather than a
 * 500 with a column name in it.
 */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;

  const code = (e as { code?: string } | null)?.code;
  if (typeof code === "string" && code.startsWith("P")) {
    switch (code) {
      case "P2002":
        return new AppError("CONFLICT", "That already exists.", {
          internal: `Prisma ${code}`,
          cause: e,
        });
      case "P2025":
        return new AppError("NOT_FOUND", "That record could not be found.", {
          internal: `Prisma ${code}`,
          cause: e,
        });
      case "P2003":
        return new AppError("CONFLICT", "That action references something that no longer exists.", {
          internal: `Prisma ${code}`,
          cause: e,
        });
    }
  }

  return new AppError("INTERNAL", "Something went wrong on our side. Please try again.", {
    internal: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    cause: e,
  });
}
