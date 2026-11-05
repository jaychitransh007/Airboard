import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// A deliberately small rule set: mistakes that are bugs, not style. The
// TypeScript compiler already checks types and unused code, so none of that
// is repeated here.
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.next-production/**",
      "**/*.d.ts",
      "apps/web/src/generated/**",
      // Vendored third-party bundles (MediaPipe WASM glue).
      "apps/web/public/vendor/**",
      "apps/web/test-results/**",
      "apps/web/playwright-report/**",
    ],
  },
  {
    files: ["apps/**/*.{ts,tsx,mjs,js}", "packages/**/*.{ts,tsx,mjs}", "scripts/**/*.mjs"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: { "react-hooks": reactHooks },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-cond-assign": "error",
      "no-constant-binary-expression": "error",
      "no-debugger": "error",
      "no-dupe-else-if": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-new-func": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "no-sparse-arrays": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",
      "no-unsafe-negation": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
    },
  },
);
