import assert from "node:assert/strict";
import test from "node:test";
import cors from "@fastify/cors";
import Fastify from "fastify";

import { AIRBOARD_CORS_MAX_AGE_SECONDS, AIRBOARD_CORS_METHODS } from "../src/cors.ts";

test("browser API CORS permits every control-plane mutation method", () => {
  assert.deepEqual(AIRBOARD_CORS_METHODS, [
    "GET",
    "HEAD",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ]);
});

test("a PATCH preflight advertises the mutation method to the browser", async () => {
  const server = Fastify();
  await server.register(cors, {
    origin: ["https://airboard.example"],
    methods: [...AIRBOARD_CORS_METHODS],
    maxAge: AIRBOARD_CORS_MAX_AGE_SECONDS,
  });
  const response = await server.inject({
    method: "OPTIONS",
    url: "/me/profile",
    headers: {
      origin: "https://airboard.example",
      "access-control-request-method": "PATCH",
      "access-control-request-headers": "authorization,content-type",
    },
  });
  assert.equal(response.statusCode, 204);
  assert.match(response.headers["access-control-allow-methods"], /PATCH/);
  // Browsers reuse the answer instead of preflighting every call again.
  assert.equal(response.headers["access-control-max-age"], "600");
  await server.close();
});
