// eslint.config.mjs
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // ── Ignore generated / vendor files ─────────────────────────────
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "db/migrations/**",
      "*.config.mjs",
    ],
  },

  // ── Base recommended rules ──────────────────────────────────────
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // ── Project-wide rules ──────────────────────────────────────────
  {
    files: ["src/**/*.ts"],
    languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir: import.meta.dirname,
        },
      },
    rules: {
      // Underscore-prefix unused args/vars to opt out
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Legitimate in this codebase (req.log, dynamic DTOs)
      "@typescript-eslint/no-explicit-any": "off",
      // Pino logging is structured, not debug console.log
      "no-console": "warn",
      // Empty catch is a valid pattern (see verifyPassword)
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-await": "error",
    },
  },

  // ── Tests — looser rules ────────────────────────────────────────
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
