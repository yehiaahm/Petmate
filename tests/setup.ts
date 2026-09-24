import { config } from "dotenv";
import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { beforeAll, afterAll } from "vitest";

/**
 * Test environment.
 *
 * Integration tests run against a real SQLite database, not a mock. Mocking
 * Prisma would test that the mock behaves like the mock — it would not catch a
 * missing index, a broken cascade, a unique constraint that does not fire, or a
 * transaction that does not roll back, which is most of what these tests exist
 * to prove.
 *
 * The file is disposable and lives outside `prisma/` so it never collides with
 * the development database.
 */
config();

const TEST_DB = path.join(process.cwd(), "tests", ".test.db");

// `NODE_ENV` is declared read-only by @types/node. Tests legitimately need to
// set it, so the assignment goes through a widened view of the object.
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.PETMATE_DATABASE_URL = `file:${TEST_DB}`;
process.env.AUTH_SECRET = "test-secret-at-least-thirty-two-characters-long";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.EMAIL_PROVIDER = "outbox";
process.env.PAYMENT_PROVIDER = "ledger";
process.env.AI_ENABLED = "false";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.LOG_LEVEL = "error";

beforeAll(() => {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = `${TEST_DB}${suffix}`;
    if (existsSync(file)) unlinkSync(file);
  }

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    env: { ...process.env, PETMATE_DATABASE_URL: `file:${TEST_DB}` },
    stdio: "pipe",
  });
}, 120_000);

afterAll(async () => {
  const { db } = await import("@/lib/db");
  await db.$disconnect().catch(() => undefined);
});
