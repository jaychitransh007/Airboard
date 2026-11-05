import assert from "node:assert/strict";
import test from "node:test";
import cors from "@fastify/cors";
import Fastify from "fastify";

import { registerReadOnlyGuard } from "../src/readOnly.ts";

const ORIGIN = "https://airboard.example";

async function buildApp(t, readOnly) {
  const server = Fastify();
  t.after(() => server.close());
  // Same order as server.ts: CORS first, so refusals still carry its headers.
  await server.register(cors, { origin: [ORIGIN], methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] });
  registerReadOnlyGuard(server, readOnly);
  server.get("/boards", async () => ({ boards: [] }));
  server.post("/boards", async () => ({ created: true }));
  server.patch("/boards/:id", async () => ({ saved: true }));
  server.delete("/boards/:id", async (_request, reply) => reply.code(204).send());
  return server;
}

test("read-only mode refuses every change but keeps reads working", async (t) => {
  const server = await buildApp(t, true);
  const headers = { origin: ORIGIN };

  const read = await server.inject({ method: "GET", url: "/boards", headers });
  assert.equal(read.statusCode, 200);

  for (const [method, url] of [["POST", "/boards"], ["PATCH", "/boards/1"], ["DELETE", "/boards/1"]]) {
    const refused = await server.inject({ method, url, headers, payload: method === "DELETE" ? undefined : {} });
    assert.equal(refused.statusCode, 503, `${method} ${url}`);
    assert.deepEqual(refused.json(), { error: "MAINTENANCE" });
    assert.equal(refused.headers["retry-after"], "300");
    // The browser can only read the refusal if CORS headers are on it.
    assert.equal(refused.headers["access-control-allow-origin"], ORIGIN);
  }

  const preflight = await server.inject({
    method: "OPTIONS",
    url: "/boards",
    headers: { ...headers, "access-control-request-method": "POST" },
  });
  assert.equal(preflight.statusCode, 204);
});

test("with read-only off, changes go through", async (t) => {
  const server = await buildApp(t, false);
  const created = await server.inject({ method: "POST", url: "/boards", payload: {} });
  assert.equal(created.statusCode, 200);
  assert.deepEqual(created.json(), { created: true });
});
