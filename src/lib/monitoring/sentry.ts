import { redact } from "@/lib/json";

/**
 * Error reporting to Sentry, over its plain HTTP "envelope" API.
 *
 * The official SDK wraps the whole build and ships its own tracing; all this
 * application needs is "tell us when something breaks, with the stack", so
 * this sends exactly that and nothing else. It runs anywhere `fetch` does
 * (server, edge, worker) and never throws: reporting an error must not become
 * a second error.
 *
 * What is sent is deliberately thin: the error, its stack, the log message
 * and the context the code already passes to the logger — redacted by the
 * same rules as the logs, so no password, token, cookie or email leaves.
 */

interface Dsn {
  key: string;
  host: string;
  projectId: string;
  protocol: string;
}

export function parseDsn(dsn: string | undefined | null): Dsn | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!url.username || !projectId) return null;
    return { key: url.username, host: url.host, projectId, protocol: url.protocol.replace(":", "") };
  } catch {
    return null;
  }
}

const PRIVATE_KEY = /email|phone|^to$|address|recipient|name$|token|otp|code|secret|password|cookie|authorization|apikey/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+|00)?\d[\d\s-]{8,}\d/g;

/** Masks email addresses and phone numbers wherever they appear in text. */
export function scrubText(text: string): string {
  return text.replace(EMAIL, "[email]").replace(PHONE, "[phone]");
}

/**
 * Stricter than the log redaction, because this leaves our infrastructure:
 * contact details and anything code-like are dropped by key, and emails and
 * phone numbers are masked inside any remaining text.
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return scrubText(value).slice(0, 2000);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PRIVATE_KEY.test(k) ? "[redacted]" : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface StackFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

/** V8 and Firefox stack lines, oldest call first, as Sentry expects. */
export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n").slice(0, 60)) {
    const v8 = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    const gecko = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/.exec(line);
    const m = v8 ?? gecko;
    if (!m) continue;
    const filename = m[2]!;
    frames.push({
      function: m[1] || "<anonymous>",
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !/node_modules|node:internal|^node:/.test(filename),
    });
  }
  return frames.reverse();
}

export interface SentryEventInput {
  error: unknown;
  message?: string;
  context?: Record<string, unknown>;
  platform?: "node" | "javascript";
  level?: "error" | "warning";
  tags?: Record<string, string>;
  url?: string;
}

export function buildEvent(input: SentryEventInput, meta: { environment: string; release?: string }) {
  const err =
    input.error instanceof Error
      ? input.error
      : { name: "Error", message: typeof input.error === "string" ? input.error : String(input.error), stack: undefined };
  const eventId = globalThis.crypto.randomUUID().replaceAll("-", "");
  return {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: input.platform ?? "node",
    level: input.level ?? "error",
    environment: meta.environment,
    ...(meta.release ? { release: meta.release } : {}),
    message: input.message ? { formatted: scrubText(input.message).slice(0, 500) } : undefined,
    exception: {
      values: [
        {
          type: err.name || "Error",
          value: scrubText(String(err.message ?? "")).slice(0, 1000),
          stacktrace: { frames: parseStack(err.stack) },
        },
      ],
    },
    tags: input.tags,
    extra: input.context ? (scrub(redact(input.context)) as Record<string, unknown>) : undefined,
    ...(input.url ? { request: { url: input.url.split("?")[0] } } : {}),
  };
}

// A burst of the same failure (a dead database, a loop) should arrive as a
// handful of events, not thousands: at most 30 a minute, and one per distinct
// error message per minute.
const WINDOW_MS = 60_000;
let windowStart = 0;
let sentInWindow = 0;
const recent = new Map<string, number>();

function allowed(fingerprint: string, now = Date.now()): boolean {
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    sentInWindow = 0;
    recent.clear();
  }
  if (sentInWindow >= 30 || recent.has(fingerprint)) return false;
  sentInWindow++;
  recent.set(fingerprint, now);
  return true;
}

/** Test hook: forget the throttle state. */
export function resetSentryThrottle() {
  windowStart = 0;
  sentInWindow = 0;
  recent.clear();
}

/** Sends one event. Resolves to the event id, or null when not sent. */
export async function captureException(input: SentryEventInput): Promise<string | null> {
  try {
    const dsn = parseDsn(process.env.SENTRY_DSN);
    if (!dsn) return null;

    const message = input.error instanceof Error ? input.error.message : String(input.error);
    if (!allowed(`${input.platform ?? "node"}:${input.message ?? ""}:${message}`.slice(0, 300))) return null;

    const event = buildEvent(input, {
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
      release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    });
    const envelope = [
      JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n");

    await fetch(`${dsn.protocol}://${dsn.host}/api/${dsn.projectId}/envelope/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=petmate/1.0`,
      },
      body: envelope,
      signal: AbortSignal.timeout(5_000),
    });
    return event.event_id;
  } catch {
    // Never let reporting fail the thing that was being reported.
    return null;
  }
}
