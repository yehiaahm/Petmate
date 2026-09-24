import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * The server/client boundary.
 *
 * A `"use client"` component that imports a module marked `server-only` — or
 * one that transitively reaches Prisma or `next/headers` — compiles fine under
 * `tsc` and then fails at build time with an error that points at the leaf
 * module rather than the component that dragged it in. This test names the
 * component instead.
 *
 * The rule it enforces: shared vocabulary (labels, enums, pure helpers) lives
 * in its own dependency-free module, and only the server imports the service.
 */

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC);

/** Resolves a `@/`-prefixed specifier to a file on disk, trying each extension. */
function resolveAlias(specifier: string): string | null {
  if (!specifier.startsWith("@/")) return null;
  const base = join(SRC, specifier.slice(2));
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not this extension; keep trying.
    }
  }
  return null;
}

const IMPORT_RE = /^[ 	]*(?:import|export)[ 	]+([^;]*?)from[ 	]+["']([^"']+)["']/gm;

/**
 * Value imports only.
 *
 * `import type { X }` and `import { type X }` are erased by the compiler and
 * emit nothing, so they cannot drag a server module into the browser bundle.
 * Counting them would make this test reject correct code.
 */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const out: string[] = [];

  for (const match of source.matchAll(IMPORT_RE)) {
    const clause = (match[1] ?? "").trim();
    const specifier = match[2];
    if (!specifier) continue;

    if (/^type\b/.test(clause)) continue;

    // A brace clause where every named specifier carries its own `type`.
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces?.[1]) {
      const named = braces[1]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const beforeBrace = clause.slice(0, clause.indexOf("{")).replace(/,\s*$/, "").trim();
      if (named.length > 0 && named.every((n) => /^type\s/.test(n)) && beforeBrace === "") {
        continue;
      }
    }

    out.push(specifier);
  }

  return out;
}

function isServerOnly(file: string): boolean {
  const source = readFileSync(file, "utf8");
  return (
    /^\s*import\s+["']server-only["']/m.test(source) ||
    /from\s+["']next\/headers["']/.test(source) ||
    /from\s+["']@prisma\/client["']/.test(source)
  );
}

/** Follows `@/` imports from a client entry point until it hits a server module. */
function findServerLeak(entry: string): string[] | null {
  const seen = new Set<string>();

  function visit(file: string, path: string[]): string[] | null {
    if (seen.has(file)) return null;
    seen.add(file);

    for (const specifier of importsOf(file)) {
      const resolved = resolveAlias(specifier);
      if (!resolved) continue;

      const next = [...path, relative(SRC, resolved).split(sep).join("/")];
      if (isServerOnly(resolved)) return next;

      const deeper = visit(resolved, next);
      if (deeper) return deeper;
    }
    return null;
  }

  return visit(entry, [relative(SRC, entry).split(sep).join("/")]);
}

describe("server/client module boundary", () => {
  const clientFiles = FILES.filter((file) =>
    /^\s*["']use client["']/.test(readFileSync(file, "utf8")),
  );

  it("finds the client components", () => {
    // A guard on the guard: if the detection breaks, the suite must not go
    // quietly green with zero files checked.
    expect(clientFiles.length).toBeGreaterThan(10);
  });

  it.each(clientFiles.map((f) => [relative(SRC, f).split(sep).join("/"), f] as const))(
    "%s reaches no server-only module",
    (_name, file) => {
      const leak = findServerLeak(file);
      expect(
        leak,
        leak
          ? `Client component pulls in a server module:\n  ${leak.join("\n    → ")}\n` +
              "Move the shared values into a dependency-free module instead."
          : undefined,
      ).toBeNull();
    },
  );
});
