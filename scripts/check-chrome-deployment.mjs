#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect as connectTcp } from "node:net";
import { resolve } from "node:path";
import { connect as connectTls } from "node:tls";
import {
  CHROME_ORIGIN_GATED_API_SURFACES,
  evaluateChromeCorsPreflightProbe,
  evaluateChromeHttpOriginProbe,
  extractChromeExtensionDeploymentTargets,
  validateChromeDeploymentCompatibility,
  validateChromeDeploymentTargets,
} from "./lib/chrome-deployment-compatibility.mjs";

const root = resolve(import.meta.dirname, "..");
const [manifestSource, backgroundSource, engineRelaySource] = await Promise.all([
  readFile(resolve(root, "extensions/chrome-meet-bridge/manifest.json"), "utf8"),
  readFile(resolve(root, "extensions/chrome-meet-bridge/background.js"), "utf8"),
  readFile(resolve(root, "extensions/chrome-meet-bridge/engine-relay.js"), "utf8"),
]);
const manifest = JSON.parse(manifestSource);
const extensionTargets = extractChromeExtensionDeploymentTargets({
  backgroundSource,
  engineRelaySource,
});
const webUrl = requiredUrl("AIRBOARD_APP_URL");
const apiUrl = requiredUrl("NEXT_PUBLIC_AIRBOARD_API_URL");
const extensionId = process.env.NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID?.trim() ?? "";
const chromeWebStoreUrl = process.env.NEXT_PUBLIC_CHROME_WEB_STORE_URL?.trim() || null;
const allowedOrigins = requiredOriginList("AIRBOARD_ALLOWED_ORIGINS");

const targetResult = validateChromeDeploymentTargets({
  configuredAppUrl: webUrl,
  configuredApiUrl: apiUrl,
  extensionAppUrl: extensionTargets.appUrl,
  extensionApiUrl: extensionTargets.apiUrl,
  allowedOrigins,
});
let web = null;
let api = null;
let originProbeResults = [];
let result = targetResult;
if (targetResult.ok) {
  [web, api, originProbeResults] = await Promise.all([
    compatibility(`${webUrl}/meet/overlay-engine/compatibility`),
    compatibility(`${apiUrl}/integrations/extension/compatibility`),
    probeOriginGatedApiSurfaces(apiUrl, webUrl),
  ]);
  result = validateChromeDeploymentCompatibility({
    extensionVersion: manifest.version,
    extensionId,
    chromeWebStoreUrl,
    web,
    api,
    configuredAppUrl: webUrl,
    configuredApiUrl: apiUrl,
    extensionAppUrl: extensionTargets.appUrl,
    extensionApiUrl: extensionTargets.apiUrl,
    allowedOrigins,
    originProbeResults,
  });
}

console.log(JSON.stringify({
  ok: result.ok,
  extensionVersion: manifest.version,
  extensionId,
  chromeWebStoreUrl,
  configuredTargets: { appUrl: webUrl, apiUrl },
  extensionTargets,
  web,
  api,
  allowedOrigins,
  originProbeResults,
  failures: result.failures,
}, null, 2));
if (!result.ok) process.exitCode = 1;

function requiredUrl(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  const url = new URL(value);
  const localHttp = url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error(`${name} must use HTTPS outside local development.`);
  }
  return url.toString().replace(/\/$/, "");
}

function requiredOriginList(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value.split(",").map((candidate) => {
    const trimmed = candidate.trim();
    const url = new URL(trimmed);
    if (
      trimmed === "*" ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error(`${name} must contain only explicit HTTPS origins.`);
    }
    return url.origin;
  });
}

async function compatibility(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}. Deploy the matching service before packaging.`);
  }
  return response.json();
}

async function probeOriginGatedApiSurfaces(apiUrl, rendererUrl) {
  const rendererOrigin = new URL(rendererUrl).origin;
  return Promise.all(CHROME_ORIGIN_GATED_API_SURFACES.map(async (surface) => {
    try {
      if (surface.method === "WEBSOCKET") {
        const close = await probeWebSocketOrigin(
          new URL(surface.path, apiUrl),
          rendererOrigin,
        );
        const ok = close.code === 1008 && close.reason === "Airboard authentication required";
        return {
          id: surface.id,
          ok,
          detail: ok ? "allowed origin reached authentication" : `close ${close.code}: ${close.reason}`,
        };
      }
      if (surface.method === "POST") {
        const preflightResponse = await fetch(new URL(surface.path, apiUrl), {
          method: "OPTIONS",
          headers: {
            Origin: rendererOrigin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
          },
          signal: AbortSignal.timeout(10_000),
        });
        const preflight = evaluateChromeCorsPreflightProbe({
          rendererOrigin,
          status: preflightResponse.status,
          accessControlAllowOrigin:
            preflightResponse.headers.get("access-control-allow-origin"),
          accessControlAllowMethods:
            preflightResponse.headers.get("access-control-allow-methods"),
          accessControlAllowHeaders:
            preflightResponse.headers.get("access-control-allow-headers"),
        });
        if (!preflight.ok) {
          return {
            id: surface.id,
            ok: false,
            status: preflightResponse.status,
            detail: `preflight: ${preflight.detail}`,
          };
        }
      }
      const response = await fetch(new URL(surface.path, apiUrl), {
        method: surface.method,
        headers: {
          Accept: "application/json",
          Origin: rendererOrigin,
          ...(surface.method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(surface.method === "POST" ? { body: "{}" } : {}),
        signal: AbortSignal.timeout(10_000),
      });
      const payload = await response.json().catch(() => null);
      const evaluation = evaluateChromeHttpOriginProbe({
        rendererOrigin,
        status: response.status,
        error: payload?.error,
        accessControlAllowOrigin: response.headers.get("access-control-allow-origin"),
      });
      return {
        id: surface.id,
        ok: evaluation.ok,
        status: response.status,
        detail: evaluation.detail,
      };
    } catch (error) {
      return {
        id: surface.id,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }));
}

async function probeWebSocketOrigin(httpUrl, rendererOrigin) {
  const url = new URL(httpUrl);
  const secure = url.protocol === "https:";
  if (!secure && url.protocol !== "http:") {
    throw new Error("The transcription WebSocket target must use HTTP or HTTPS.");
  }
  const port = Number(url.port || (secure ? 443 : 80));
  const key = randomBytes(16).toString("base64");
  const expectedAccept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  const hostHeader = url.port ? `${url.hostname}:${url.port}` : url.hostname;

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let upgraded = false;
    let buffered = Buffer.alloc(0);
    const socket = secure
      ? connectTls({ host: url.hostname, port, servername: url.hostname })
      : connectTcp({ host: url.hostname, port });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) rejectPromise(error);
      else resolvePromise(value);
    };
    socket.setTimeout(10_000, () => finish(new Error("WebSocket Origin probe timed out.")));
    socket.on("error", (error) => finish(error));
    socket.on("close", () => {
      if (!settled) finish(new Error("WebSocket closed without an authentication result."));
    });
    socket.on(secure ? "secureConnect" : "connect", () => {
      socket.write([
        `GET ${url.pathname}${url.search} HTTP/1.1`,
        `Host: ${hostHeader}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        `Origin: ${rendererOrigin}`,
        "",
        "",
      ].join("\r\n"));
    });
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!upgraded) {
        const headerEnd = buffered.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const headers = buffered.subarray(0, headerEnd).toString("utf8");
        buffered = buffered.subarray(headerEnd + 4);
        const [statusLine, ...headerLines] = headers.split("\r\n");
        if (!/^HTTP\/1\.[01] 101\b/.test(statusLine ?? "")) {
          finish(new Error(`WebSocket upgrade failed: ${String(statusLine)}`));
          return;
        }
        const responseHeaders = new Map(headerLines.flatMap((line) => {
          const separator = line.indexOf(":");
          return separator > 0
            ? [[line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()]]
            : [];
        }));
        if (responseHeaders.get("sec-websocket-accept") !== expectedAccept) {
          finish(new Error("WebSocket upgrade returned an invalid accept key."));
          return;
        }
        upgraded = true;
      }
      try {
        const close = decodeServerCloseFrame(buffered);
        if (close) finish(null, close);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

function decodeServerCloseFrame(buffer) {
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLength = second & 0x7f;
    let headerLength = 2;
    if (masked) throw new Error("The server returned an invalid masked WebSocket frame.");
    if (payloadLength === 126) {
      if (buffer.length - offset < 4) return null;
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      throw new Error("The server returned an unexpectedly large WebSocket frame.");
    }
    if (buffer.length - offset < headerLength + payloadLength) return null;
    if (opcode === 0x8) {
      const payload = buffer.subarray(offset + headerLength, offset + headerLength + payloadLength);
      return {
        code: payload.length >= 2 ? payload.readUInt16BE(0) : 1005,
        reason: payload.length > 2 ? payload.subarray(2).toString("utf8") : "",
      };
    }
    offset += headerLength + payloadLength;
  }
  return null;
}
