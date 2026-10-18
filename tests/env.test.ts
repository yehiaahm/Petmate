import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { env, productionReadiness, resetEnvForTests } from "@/lib/env";

/**
 * `.env.example` ships most optional keys as `KEY=`, and run-all.sh copies it
 * to `.env` unchanged. An empty value has to parse as unset: if it fails
 * validation instead, every server route that reads the environment throws.
 */

const saved = { ...process.env };

function withEnv(values: Record<string, string>) {
  Object.assign(process.env, values);
  resetEnvForTests();
}

afterEach(() => {
  process.env = { ...saved };
  resetEnvForTests();
});

describe("empty environment values", () => {
  it("treats an empty SENTRY_DSN as unset", () => {
    withEnv({ SENTRY_DSN: "" });
    expect(() => env()).not.toThrow();
    expect(env().SENTRY_DSN).toBeUndefined();
    expect(productionReadiness()).toContain("SENTRY_DSN is not set: errors in production would go unnoticed");
  });

  it("falls back to the default for an empty URL", () => {
    withEnv({ APP_URL: "", BOSTA_BASE_URL: "", PAYMOB_BASE_URL: "" });
    expect(env().APP_URL).toBe("http://localhost:3000");
    expect(env().BOSTA_BASE_URL).toBe("https://app.bosta.co/api/v2");
    expect(env().PAYMOB_BASE_URL).toBe("https://accept.paymob.com");
  });

  it("treats empty keys and secrets as unset", () => {
    withEnv({ GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", S3_PUBLIC_URL: "", CRON_SECRET: "" });
    expect(env().GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env().GOOGLE_CLIENT_SECRET).toBeUndefined();
    expect(env().S3_PUBLIC_URL).toBeUndefined();
    expect(env().CRON_SECRET).toBeUndefined();
  });

  it("still rejects a URL that is set but invalid", () => {
    withEnv({ SENTRY_DSN: "not-a-url" });
    expect(() => env()).toThrow(/SENTRY_DSN/);
  });

  it("parses a fresh copy of .env.example", () => {
    withEnv(parse(readFileSync(path.join(process.cwd(), ".env.example"))));
    expect(() => env()).not.toThrow();
    expect(env().SENTRY_DSN).toBeUndefined();
    expect(env().FACEBOOK_APP_SECRET).toBeUndefined();
  });
});
