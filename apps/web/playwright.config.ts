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
  // Screenshot baselines (styleContract.screenshots.spec.ts) are stored per
  // platform: text renders differently on macOS and Linux, so each platform
  // compares only with its own committed set.
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{testFileName}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      // Tolerant: anti-aliasing and GPU noise pass; a moved, recoloured or
      // resized element does not.
      threshold: 0.2,
      maxDiffPixelRatio: 0.005,
    },
  },
  use: {
    // Playwright's bundled Chromium by default. For the release browser matrix
    // (Docs/Browser Matrix.md), AIRBOARD_E2E_CHANNEL=chrome or msedge runs the
    // suite in the installed browser, and AIRBOARD_E2E_EXECUTABLE in any other
    // Chromium build, such as an earlier Chrome for Testing.
    ...(process.env.AIRBOARD_E2E_CHANNEL ? { channel: process.env.AIRBOARD_E2E_CHANNEL } : {}),
    ...(process.env.AIRBOARD_E2E_EXECUTABLE
      ? { launchOptions: { executablePath: process.env.AIRBOARD_E2E_EXECUTABLE } }
      : {}),
    baseURL: "http://127.0.0.1:3100",
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://127.0.0.1:3100",
          localStorage: [
            { name: "airboard.cookie-choice.v1", value: "necessary" },
            // The Airo panel starts hidden; most specs type into it, so they
            // start with it shown. boardLayout.spec checks the hidden default.
            { name: "airboard.copilot.v2", value: "open" },
          ],
        },
      ],
    },
  },
  webServer: [
    {
      // Dedicated API instance for E2E: real sessions + board sync, in-memory
      // store, no provider keys needed for the flows under test.
      // The API does not need file watching during a deterministic E2E run.
      // Avoiding `node --watch` also prevents macOS's per-process file watcher
      // limit from turning a valid browser suite into an EMFILE startup error.
      command: "pnpm --filter @airboard/api build && pnpm --filter @airboard/api start",
      url: "http://127.0.0.1:4600/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: "4600",
        HOST: "127.0.0.1",
        AIRBOARD_ALLOWED_ORIGINS: "http://127.0.0.1:3100,http://localhost:3100",
        // A parallel browser suite legitimately creates more sessions than
        // the customer-facing abuse limit. Keep the runtime limit intact and
        // raise it only inside this isolated loopback test process.
        AIRBOARD_RATE_LIMIT_SESSION_START_PER_MINUTE: "10000",
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
