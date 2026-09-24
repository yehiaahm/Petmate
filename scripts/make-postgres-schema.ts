/**
 * Emits prisma/schema.postgres.prisma from the SQLite schema.
 *
 * The schema is deliberately written in the SQLite/PostgreSQL intersection
 * (see the PORTABILITY CONTRACT at the top of schema.prisma), so the only
 * difference between the two files is the datasource block. Generating rather
 * than maintaining a second copy is the whole point: two hand-edited schemas
 * drift, and the drift shows up in production.
 *
 * This script also *verifies* the contract rather than trusting it. If someone
 * adds a native enum, a Json column, a scalar list or a Decimal, the build
 * fails here with the line number instead of at deploy time.
 *
 *   npm run pg:schema
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SOURCE = join(ROOT, "prisma", "schema.prisma");
const TARGET = join(ROOT, "prisma", "schema.postgres.prisma");

interface Violation {
  line: number;
  text: string;
  rule: string;
}

/** Checks that nothing in the schema has left the portable subset. */
function verifyPortability(source: string): Violation[] {
  const violations: Violation[] = [];
  const lines = source.split("\n");

  let inBlockComment = false;

  lines.forEach((raw, index) => {
    const line = raw.trim();
    const number = index + 1;

    // Skip comments; prose about Json or enums is not a violation.
    if (line.startsWith("//") || line.startsWith("///")) return;
    if (inBlockComment) return;

    if (/^enum\s+\w+\s*\{/.test(line)) {
      violations.push({
        line: number,
        text: line,
        rule: "native enums are not portable — use a String column validated by Zod",
      });
    }

    // Field declarations only: `  name  Type  @attrs`.
    const field = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?/);
    if (!field) return;

    const [, , type, isList] = field;

    if (type === "Json") {
      violations.push({
        line: number,
        text: line,
        rule: "Json is not supported on SQLite — store a String and read it via lib/json.ts",
      });
    }

    if (type === "Decimal") {
      violations.push({
        line: number,
        text: line,
        rule: "Decimal is not portable — money is Int in the currency minor unit",
      });
    }

    // A list of a scalar (String[], Int[]) is Postgres-only. A list of a model
    // is a relation, which is fine.
    if (isList && ["String", "Int", "Float", "Boolean", "DateTime", "Bytes"].includes(type ?? "")) {
      violations.push({
        line: number,
        text: line,
        rule: "scalar lists are Postgres-only — use a join table or a delimited String",
      });
    }
  });

  return violations;
}

function main() {
  const source = readFileSync(SOURCE, "utf8");

  const violations = verifyPortability(source);
  if (violations.length > 0) {
    console.error("\nThe schema has left the portable subset:\n");
    for (const v of violations) {
      console.error(`  prisma/schema.prisma:${v.line}`);
      console.error(`    ${v.text}`);
      console.error(`    → ${v.rule}\n`);
    }
    console.error(
      "Fix these, or change the contract deliberately and update this script.\n",
    );
    process.exit(1);
  }

  const datasource = /datasource\s+db\s*\{[^}]*\}/;
  if (!datasource.test(source)) {
    console.error("Could not find the datasource block in prisma/schema.prisma.");
    process.exit(1);
  }

  const output = source.replace(
    datasource,
    `datasource db {
  provider  = "postgresql"
  url       = env("PETMATE_DATABASE_URL")
  directUrl = env("PETMATE_DIRECT_URL")
}`,
  );

  const header = `// GENERATED FILE — do not edit.
//
// Produced from prisma/schema.prisma by scripts/make-postgres-schema.ts.
// Edit the SQLite schema and re-run \`npm run pg:schema\`.
//
// \`directUrl\` is used by migrations so they bypass a connection pooler; set
// PETMATE_DIRECT_URL to the unpooled connection string, or to the same value
// as PETMATE_DATABASE_URL when there is no pooler.

`;

  writeFileSync(TARGET, header + output.replace(/^\/\/ PetMate — database schema\n/, ""), "utf8");

  const models = (source.match(/^model\s+\w+/gm) ?? []).length;
  console.log(`Wrote prisma/schema.postgres.prisma (${models} models, portability verified).`);
  console.log("Deploy with: prisma migrate deploy --schema prisma/schema.postgres.prisma");
}

main();
