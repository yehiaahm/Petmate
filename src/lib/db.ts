import { PrismaClient } from "@prisma/client";

/**
 * Prisma singleton.
 *
 * Next.js hot-reloads modules in development; without the global cache every
 * reload would open a new connection pool until the database refuses more.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? [{ emit: "event", level: "query" }, "warn", "error"]
        : ["error"],
    datasources: {
      db: { url: process.env.PETMATE_DATABASE_URL },
    },
  });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

/** Prisma's own type for the transactional client handed to `db.$transaction`. */
export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/** Accepts either the root client or a transaction, so services compose. */
export type DbClient = PrismaClient | Tx;

export type { PrismaClient };
