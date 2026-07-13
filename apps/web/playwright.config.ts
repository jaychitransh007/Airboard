import { defineConfig } from "@playwright/test";

/**
 * E2E harness for the interaction layer. The dev server runs on a dedicated
 * port (3100) with the voice test hooks enabled, so a developer's own dev
 * server on 3000 is never reused by mistake (it would lack the hooks).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:3100",
  },
  webServer: [
    {
      // Dedicated API instance for E2E: real sessions + board sync, in-memory
      // store, no provider keys needed for the flows under test.
      command: "pnpm --filter @airboard/api dev",
      url: "http://127.0.0.1:4600/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: "4600",
        HOST: "127.0.0.1",
        AIRBOARD_ALLOWED_ORIGINS: "http://127.0.0.1:3100,http://localhost:3100",
      },
    },
    {
      command: "pnpm exec next dev -p 3100",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_AIRBOARD_TEST_HOOKS: "1",
        NEXT_PUBLIC_AIRBOARD_API_URL: "http://127.0.0.1:4600",
      },
    },
  ],
});
