import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Integration tests share one SQLite file; running files in parallel would
    // produce lock contention that looks like a failure but is not one.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: path.resolve(process.cwd(), "src/$1") },
      // `server-only` throws unless it is resolved under the react-server
      // condition, which only Next's bundler sets. In tests the modules under
      // test *are* the server, so the guard is replaced with a no-op.
      { find: /^server-only$/, replacement: path.resolve(process.cwd(), "tests/stubs/server-only.ts") },
    ],
  },
});
