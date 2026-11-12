import assert from "node:assert/strict";
import { test } from "node:test";
import { createCspNonce, securityHeaders } from "../src/platform/securityHeaders.ts";

const PRODUCTION = {
  nonce: "bm9uY2Utdmx1ZS0xMjM0NQ==",
  development: false,
  apiUrl: "https://api.airboard.test",
  supabaseUrl: "https://project.supabase.co",
};

function directives(headers) {
  return Object.fromEntries(
    headers["Content-Security-Policy"].split("; ").map((directive) => {
      const [name, ...sources] = directive.split(" ");
      return [name, sources];
    }),
  );
}

test("a normal page gets a nonce-based CSP that refuses framing", () => {
  const headers = securityHeaders({ ...PRODUCTION, pathname: "/app/boards" });
  const csp = directives(headers);
  assert.deepEqual(csp["script-src"], [
    "'self'",
    `'nonce-${PRODUCTION.nonce}'`,
    "'wasm-unsafe-eval'",
    "blob:",
  ]);
  assert.equal(csp["script-src"].includes("'unsafe-inline'"), false);
  assert.equal(csp["script-src"].includes("'unsafe-eval'"), false);
  assert.deepEqual(csp["default-src"], ["'self'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]);
  assert.deepEqual(csp["base-uri"], ["'self'"]);
  assert.deepEqual(csp["form-action"], ["'self'"]);
  assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
  assert.deepEqual(csp["worker-src"], ["'none'"]);
  assert.deepEqual(csp["font-src"], ["'self'"]);
  assert.deepEqual(csp["media-src"], ["'self'", "blob:"]);
  assert.deepEqual(csp["connect-src"], [
    "'self'",
    "https://api.airboard.test",
    "wss://api.airboard.test",
    "https://project.supabase.co",
    "https://api.github.com",
  ]);
  assert.deepEqual(csp["img-src"], [
    "'self'",
    "data:",
    "blob:",
    "https://api.airboard.test",
    "https://project.supabase.co",
  ]);
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(headers["Strict-Transport-Security"], "max-age=63072000; includeSubDomains");
  assert.match(headers["Permissions-Policy"], /^camera=\(self\), microphone=\(self\), display-capture=\(self\), /);
  assert.match(headers["Permissions-Policy"], /geolocation=\(\)/);
  assert.match(headers["Permissions-Policy"], /payment=\(\)/);
});

test("embeds are limited to the playback allowlist over HTTPS", () => {
  const csp = directives(securityHeaders({ ...PRODUCTION, pathname: "/" }));
  assert.ok(csp["frame-src"].includes("https://youtube-nocookie.com"));
  assert.ok(csp["frame-src"].includes("https://*.youtube-nocookie.com"));
  assert.ok(csp["frame-src"].includes("https://*.figma.com"));
  assert.ok(csp["frame-src"].every((source) => source.startsWith("https://")));
});

test("the share page sends no referrer", () => {
  const headers = securityHeaders({ ...PRODUCTION, pathname: "/s/abc123" });
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(
    securityHeaders({ ...PRODUCTION, pathname: "/support" })["Referrer-Policy"],
    "strict-origin-when-cross-origin",
  );
});

test("no page may be framed, including the retired Meet paths", () => {
  for (const pathname of ["/meet/overlay-engine", "/meet/main-stage", "/meet/side-panel", "/"]) {
    const headers = securityHeaders({ ...PRODUCTION, pathname });
    assert.deepEqual(directives(headers)["frame-ancestors"], ["'none'"], pathname);
    assert.equal(headers["X-Frame-Options"], "DENY", pathname);
    assert.match(headers["Permissions-Policy"], /^camera=\(self\), microphone=\(self\), display-capture=\(self\), /);
  }
});

test("development allows eval and sends no HSTS", () => {
  const headers = securityHeaders({
    ...PRODUCTION,
    development: true,
    apiUrl: "http://127.0.0.1:4600",
    supabaseUrl: "",
    pathname: "/",
  });
  const csp = directives(headers);
  assert.ok(csp["script-src"].includes("'unsafe-eval'"));
  assert.deepEqual(csp["connect-src"], [
    "'self'",
    "http://127.0.0.1:4600",
    "ws://127.0.0.1:4600",
    "https://api.github.com",
  ]);
  assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
  assert.equal("Strict-Transport-Security" in headers, false);
});

test("an API URL with a path still yields bare origins", () => {
  const csp = directives(securityHeaders({ ...PRODUCTION, apiUrl: "https://api.airboard.test/v1/", pathname: "/" }));
  assert.ok(csp["connect-src"].includes("https://api.airboard.test"));
  assert.ok(csp["connect-src"].includes("wss://api.airboard.test"));
});

test("nonces are fresh and in the form Next.js reads back", () => {
  const first = createCspNonce();
  assert.match(first, /^[A-Za-z0-9+/]{22}==$/);
  assert.notEqual(first, createCspNonce());
});
