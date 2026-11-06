import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchOptionsWith } from "./support/launchOptions";

/**
 * E2E path: the browser security headers (threat model W-1, set in
 * middleware.ts). Every page gets a nonce-based CSP and refuses framing; the
 * share page sends no referrer; only Meet and the extension may frame the
 * overlay engine. The app's own scripts, MediaPipe's WebAssembly and Airo's
 * microphone worklet still run under the policy.
 */

// A fake camera and microphone, so Airo and hand tracking start for real. The
// framing test puts the loopback dev server inside a public origin, which
// Chrome's Local Network Access check would refuse before the headers decide;
// the deployed engine is public, so production never meets that check.
test.use({
  launchOptions: launchOptionsWith([
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--disable-features=LocalNetworkAccessChecks",
  ]),
  permissions: ["camera", "microphone"],
});

const sharedBoard = readFileSync(resolve(import.meta.dirname, "fixtures/shared-board.json"), "utf8");
const TOKEN = "A".repeat(43);

type Violation = { directive: string; blocked: string };

declare global {
  interface Window {
    __cspViolations: Violation[];
  }
}

/** Records every CSP violation the page reports, from before any app code runs. */
async function recordCspViolations(page: Page): Promise<() => Promise<Violation[]>> {
  const refusals: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Refused to")) refusals.push(message.text());
  });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
  });
  return async () => [
    ...(await page.evaluate(() => window.__cspViolations)),
    ...refusals.map((text) => ({ directive: "console", blocked: text })),
  ];
}

function cspDirectives(header: string | undefined): Record<string, string[]> {
  expect(header, "Content-Security-Policy header").toBeTruthy();
  return Object.fromEntries(
    header!.split(";").map((directive) => {
      const [name = "", ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

test("every page type gets its security headers", async ({ request }) => {
  const normal = await request.get("/");
  const shared = await request.get(`/s/${TOKEN}`);
  const engine = await request.get("/meet/overlay-engine");
  for (const response of [normal, shared, engine]) {
    expect(response.status()).toBe(200);
    const headers = response.headers();
    const csp = cspDirectives(headers["content-security-policy"]);
    expect(csp["script-src"]).toEqual(expect.arrayContaining(["'self'", "'wasm-unsafe-eval'"]));
    expect(csp["script-src"]!.filter((source) => /^'nonce-[A-Za-z0-9+/]+={0,2}'$/.test(source))).toHaveLength(1);
    expect(csp["script-src"]).not.toContain("'unsafe-inline'");
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["connect-src"]).toEqual(
      expect.arrayContaining(["'self'", "http://127.0.0.1:4600", "ws://127.0.0.1:4600", "https://api.github.com"]),
    );
    expect(headers["x-content-type-options"]).toBe("nosniff");
  }

  // A fresh nonce for every response.
  const nonces = [normal, shared, engine].map(
    (response) => /'nonce-([^']+)'/.exec(response.headers()["content-security-policy"] ?? "")?.[1],
  );
  expect(new Set(nonces).size).toBe(3);

  for (const response of [normal, shared]) {
    const headers = response.headers();
    expect(cspDirectives(headers["content-security-policy"])["frame-ancestors"]).toEqual(["'none'"]);
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["permissions-policy"]).toMatch(/^camera=\(self\), microphone=\(self\), display-capture=\(self\), /);
    expect(headers["permissions-policy"]).toContain("geolocation=()");
  }
  expect(normal.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(shared.headers()["referrer-policy"]).toBe("no-referrer");

  const engineHeaders = engine.headers();
  expect(cspDirectives(engineHeaders["content-security-policy"])["frame-ancestors"]).toContain(
    "https://meet.google.com",
  );
  expect(engineHeaders["x-frame-options"]).toBeUndefined();
  expect(engineHeaders["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(engineHeaders["permissions-policy"]).toMatch(/^camera=\(\), microphone=\(\), display-capture=\(\), /);
});

test("public pages hydrate and reach the API and GitHub under the CSP", async ({ page }) => {
  const violations = await recordCspViolations(page);
  await page.route("**/shared-boards/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: sharedBoard }),
  );
  await page.route("https://api.github.com/repos/**", (route) => route.fulfill({ json: [] }));

  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();

  // Both pages draw data that only client code fetches.
  await page.goto(`/s/${TOKEN}`);
  await expect(page.getByRole("heading", { level: 1, name: "Checkout flow" })).toBeVisible();
  await expect(page.locator("#shared-board-text")).toContainText("Checkout API");

  await page.goto("/status");
  await expect(page.getByText("No incidents in the last 90 days", { exact: false })).toBeVisible();

  expect(await violations()).toEqual([]);
});

test("the camera, MediaPipe hand tracking and Airo's microphone worklet run under the CSP", async ({ page }) => {
  const violations = await recordCspViolations(page);
  const wasm = page.waitForResponse((response) => response.url().endsWith("/vision_wasm_internal.wasm"), {
    timeout: 60_000,
  });
  const model = page.waitForResponse((response) => response.url().endsWith("/hand_landmarker.task"), {
    timeout: 60_000,
  });
  await page.goto("/?testStandalone=1");
  await page.getByRole("button", { name: "Start building" }).click();

  const copilot = page.getByTestId("canvas-copilot");
  await copilot.getByRole("button", { name: "Enable Airo voice and hand tracking" }).click();
  expect((await wasm).ok()).toBe(true);
  expect((await model).ok()).toBe(true);
  await expect(copilot.getByRole("button", { name: "Turn off Airo voice and hand tracking" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect
    .poll(() => page.locator("video.camera-preview").evaluate((video: HTMLVideoElement) => video.videoWidth), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  // Realtime transcription loads its PCM worklet from a Blob the page writes.
  const workletLoaded = await page.evaluate(async () => {
    const context = new AudioContext();
    const url = URL.createObjectURL(
      new Blob(["registerProcessor('csp-probe', class extends AudioWorkletProcessor { process() { return false; } });"], {
        type: "text/javascript",
      }),
    );
    try {
      await context.audioWorklet.addModule(url);
      return true;
    } catch {
      return false;
    } finally {
      URL.revokeObjectURL(url);
      await context.close();
    }
  });
  expect(workletLoaded).toBe(true);

  expect(await violations()).toEqual([]);
});

test("an injected inline script does not run", async ({ page }) => {
  const violations = await recordCspViolations(page);
  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__injected = true;";
    document.body.append(script);
  });
  await expect.poll(async () => (await violations()).some((violation) => violation.directive === "script-src-elem")).toBe(
    true,
  );
  expect(await page.evaluate(() => (window as { __injected?: boolean }).__injected)).toBeUndefined();
});

test("only Meet's origin may frame the overlay engine, and no origin may frame other pages", async ({
  page,
  baseURL,
}) => {
  const framing = (src: string) =>
    `<!doctype html><title>frame test</title><iframe name="target" src="${baseURL}${src}"></iframe>`;
  await page.route("https://meet.google.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: framing(new URL(route.request().url()).searchParams.get("src")!) }),
  );
  await page.route("https://elsewhere.example/**", (route) =>
    route.fulfill({ contentType: "text/html", body: framing(new URL(route.request().url()).searchParams.get("src")!) }),
  );

  async function frameLoads(top: string, src: string): Promise<boolean> {
    await page.goto(`${top}/frame?src=${encodeURIComponent(src)}`);
    const frame = page.frame({ name: "target" });
    expect(frame).not.toBeNull();
    await frame!.waitForLoadState("domcontentloaded");
    // A refused frame is replaced by Chrome's error page.
    return frame!.url().startsWith(baseURL!);
  }

  expect(await frameLoads("https://meet.google.com", "/meet/overlay-engine")).toBe(true);
  expect(await frameLoads("https://elsewhere.example", "/meet/overlay-engine")).toBe(false);
  expect(await frameLoads("https://meet.google.com", "/")).toBe(false);
  expect(await frameLoads("https://meet.google.com", `/s/${TOKEN}`)).toBe(false);
});
