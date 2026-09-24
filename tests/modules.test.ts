import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Module evaluation smoke test.
 *
 * Some errors only appear when a module is *evaluated*, not when it is
 * typechecked. Zod, for instance, throws at construction time if `.partial()`
 * is called on a schema carrying refinements — valid TypeScript, guaranteed
 * 500 in production.
 *
 * This walks every server module and imports it. It is not a substitute for
 * behavioural tests; it is the cheapest possible guard against a whole class
 * of crash-on-first-request bugs.
 */

const ROOT = path.join(process.cwd(), "src", "lib");

function collect(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, found);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
      found.push(full);
    }
  }
  return found;
}

describe("server modules", () => {
  const files = collect(ROOT);

  it("finds modules to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    const relative = path.relative(process.cwd(), file).replace(/\\/g, "/");

    it(`evaluates ${relative}`, async () => {
      const specifier = `@/${path.relative(path.join(process.cwd(), "src"), file).replace(/\\/g, "/").replace(/\.ts$/, "")}`;
      await expect(import(specifier)).resolves.toBeDefined();
    });
  }
});
