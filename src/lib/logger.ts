import { redact } from "./json";

/**
 * Structured logging.
 *
 * Production emits one JSON object per line so a log shipper can index it.
 * Development emits something a human can scan. Every context object is
 * redacted before it is written, so a secret cannot reach a log even if a
 * caller passes one in by mistake.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = (process.env.LOG_LEVEL as Level | undefined) ?? "info";
  return LEVEL_ORDER[configured] ?? LEVEL_ORDER.info;
}

const COLOR: Record<Level, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

export interface LogContext {
  [key: string]: unknown;
}

function emit(level: Level, message: string, context?: LogContext) {
  if (LEVEL_ORDER[level] < threshold()) return;

  const safe = context ? (redact(context) as LogContext) : undefined;

  if (process.env.NODE_ENV === "production") {
    const line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      message,
      ...safe,
    });
    (level === "error" ? console.error : console.log)(line);
    return;
  }

  const prefix = `${COLOR[level]}${level.toUpperCase().padEnd(5)}\x1b[0m`;
  const extra = safe && Object.keys(safe).length ? ` ${JSON.stringify(safe)}` : "";
  (level === "error" ? console.error : console.log)(`${prefix} ${message}${extra}`);
}

export const logger = {
  debug: (m: string, c?: LogContext) => emit("debug", m, c),
  info: (m: string, c?: LogContext) => emit("info", m, c),
  warn: (m: string, c?: LogContext) => emit("warn", m, c),
  error: (m: string, c?: LogContext) => emit("error", m, c),

  /**
   * Logs a thrown value with its internal detail, which never goes to the
   * client. Returns nothing: the caller decides what the user sees.
   */
  exception(m: string, error: unknown, c?: LogContext) {
    const detail =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { value: String(error) };
    emit("error", m, { ...c, error: detail });
  },
};

/** Wraps an async span and logs how long it took. Used on the slow paths. */
export async function timed<T>(
  label: string,
  fn: () => Promise<T>,
  context?: LogContext,
): Promise<T> {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    const ms = Math.round(performance.now() - started);
    if (ms > 500) logger.warn(`slow: ${label}`, { ...context, ms });
    else logger.debug(label, { ...context, ms });
  }
}
