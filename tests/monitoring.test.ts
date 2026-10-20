import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  parseDsn,
  parseStack,
  buildEvent,
  captureException,
  resetSentryThrottle,
  scrub,
  scrubText,
} from "@/lib/monitoring/sentry";
import { logger } from "@/lib/logger";

/**
 * Error reporting must never leak personal data and never become a failure
 * of its own; these tests pin both.
 */

const DSN = "https://publickey123@o4501.ingest.sentry.io/4505";
const saved = { ...process.env };

beforeEach(() => resetSentryThrottle());
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...saved };
});

describe("DSN and stacks", () => {
  it("parses a DSN", () => {
    expect(parseDsn(DSN)).toEqual({ key: "publickey123", host: "o4501.ingest.sentry.io", projectId: "4505", protocol: "https" });
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn(undefined)).toBeNull();
  });

  it("turns a V8 stack into frames, oldest first", () => {
    const frames = parseStack(
      "Error: boom\n    at inner (/app/src/lib/x.ts:10:5)\n    at outer (/app/node_modules/lib/y.js:3:1)\n    at /app/src/z.ts:1:2",
    );
    expect(frames.map((f) => f.function)).toEqual(["<anonymous>", "outer", "inner"]);
    expect(frames[2]).toMatchObject({ filename: "/app/src/lib/x.ts", lineno: 10, in_app: true });
    expect(frames[1]!.in_app).toBe(false);
  });
});

describe("scrubbing", () => {
  it("masks emails and phone numbers in text", () => {
    expect(scrubText("Could not mail nour.adel@example.com at +20 101 234 5678")).toBe("Could not mail [email] at [phone]");
  });

  it("drops private keys and scrubs the rest", () => {
    expect(
      scrub({ orderId: "o1", email: "a@b.co", shippingPhone: "01012345678", nested: { note: "call 01012345678", apiKey: "k" } }),
    ).toEqual({ orderId: "o1", email: "[redacted]", shippingPhone: "[redacted]", nested: { note: "call [phone]", apiKey: "[redacted]" } });
  });

  it("builds an event with nothing personal in it", () => {
    const event = buildEvent(
      { error: new Error("User nour@example.com failed"), message: "checkout failed", context: { password: "x", orderId: "o1" } },
      { environment: "test" },
    );
    expect(event.exception.values[0]!.value).toBe("User [email] failed");
    expect(event.extra).toEqual({ password: "[redacted]", orderId: "o1" });
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("sending", () => {
  it("sends an envelope to the project's endpoint", async () => {
    process.env.SENTRY_DSN = DSN;
    const requests: { url: string; headers: Headers; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push({ url, headers: new Headers(init.headers), body: String(init.body) });
      return new Response("{}", { status: 200 });
    });

    const id = await captureException({ error: new Error("boom"), message: "it broke" });
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(requests[0]!.url).toBe("https://o4501.ingest.sentry.io/api/4505/envelope/");
    expect(requests[0]!.headers.get("x-sentry-auth")).toContain("sentry_key=publickey123");
    const [header, item, event] = requests[0]!.body.split("\n").map((l) => JSON.parse(l));
    expect(header.event_id).toBe(id);
    expect(item.type).toBe("event");
    expect(event.exception.values[0].type).toBe("Error");
  });

  it("sends one event per distinct error per minute", async () => {
    process.env.SENTRY_DSN = DSN;
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return new Response("{}");
    });
    for (let i = 0; i < 10; i++) await captureException({ error: new Error("database down") });
    await captureException({ error: new Error("something else") });
    expect(calls).toBe(2);
  });

  it("does nothing without a DSN, and never throws", async () => {
    delete process.env.SENTRY_DSN;
    vi.stubGlobal("fetch", async () => {
      throw new Error("should not be called");
    });
    expect(await captureException({ error: new Error("x") })).toBeNull();

    process.env.SENTRY_DSN = DSN;
    expect(await captureException({ error: new Error("network down") })).toBeNull();
  });

  it("reports what the logger records as an exception", async () => {
    process.env.SENTRY_DSN = DSN;
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response("{}");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    logger.exception("settlement failed", new Error("ledger unbalanced"), { intentId: "pi_1" });
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toContain("ledger unbalanced");
    expect(bodies[0]).toContain("pi_1");
  });
});
