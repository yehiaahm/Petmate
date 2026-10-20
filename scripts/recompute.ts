import { config } from "dotenv";
config();

import { PrismaClient } from "@prisma/client";
import { recomputeHealthScore } from "../src/lib/services/health.service";
import { recomputeTrustScore } from "../src/lib/services/trust.service";
import { rebuildSearchText } from "../src/lib/search/reindex";

/**
 * Recomputes every derived score, and rebuilds the search haystacks.
 *
 * Health and trust scores are stored so they can be sorted and filtered on in
 * SQL. That means a change to the scoring rules needs a backfill, and this is
 * it. Safe to run any time; it is pure recomputation from existing rows.
 */
const db = new PrismaClient();

async function main() {
  const pets = await db.pet.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });

  for (const pet of pets) {
    const score = await recomputeHealthScore(pet.id, db);
    console.log(`health  ${pet.name.padEnd(20)} ${score}`);
  }

  const users = await db.user.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });

  for (const user of users) {
    const score = await recomputeTrustScore(user.id, db);
    console.log(`trust   ${user.name.padEnd(20)} ${score}`);
  }

  const indexed = await rebuildSearchText(db);
  console.log(`search  ${JSON.stringify(indexed)}`);

  console.log(`\nRecomputed ${pets.length} pets and ${users.length} users.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
