import next from "eslint-config-next";

/**
 * Flat config.
 *
 * `eslint-config-next` 16 already exports a flat config array, so it is spread
 * directly. Going through `FlatCompat` — which the eslintrc-era setup needed —
 * crashes while serialising the config for validation.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "prisma/generated/**",
      "public/**",
      "next-env.d.ts",
    ],
  },

  ...next,

  {
    // Scoped to the same files as the config layer that registers the plugin:
    // a flat-config rule can only be set where its plugin is in scope.
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  {
    // Scripts, seeds and tests run in Node and legitimately log to the console.
    files: ["scripts/**/*.ts", "prisma/**/*.ts", "tests/**/*.ts", "src/worker/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
]

export default config;
