import { config } from "dotenv";
config();

import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

/**
 * Drops and rebuilds the local database, then reseeds.
 *
 * Refuses to run against anything that is not a local SQLite file. Wiping a
 * Postgres database because someone typed `npm run db:reset` with the wrong
 * env loaded is a mistake worth making impossible.
 */
const url = process.env.PETMATE_DATABASE_URL ?? "";

if (!url.startsWith("file:")) {
  console.error(
    "Refusing to reset: PETMATE_DATABASE_URL is not a local SQLite file.\n" +
      "This command only ever touches a local development database.",
  );
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to reset in production.");
  process.exit(1);
}

const file = url.replace(/^file:/, "");
const resolved = path.isAbsolute(file) ? file : path.join(process.cwd(), "prisma", file);

console.log(`Removing ${resolved}`);
for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  const target = `${resolved}${suffix}`;
  if (!existsSync(target)) continue;

  try {
    unlinkSync(target);
  } catch (error) {
    // On Windows the dev server keeps the SQLite file open, and the raw EBUSY
    // stack trace tells the reader nothing useful.
    if ((error as NodeJS.ErrnoException).code === "EBUSY") {
      console.error(
        `
Cannot delete ${target} because another process has it open.
` +
          "Stop the dev server (and Prisma Studio, if running) and try again.",
      );
      process.exit(1);
    }
    throw error;
  }
}

console.log("Pushing schema...");
execSync("npx prisma db push --skip-generate", { stdio: "inherit" });

console.log("Seeding...");
execSync("npx tsx --conditions=react-server prisma/seed.ts", { stdio: "inherit" });

console.log("\nDatabase reset.");
