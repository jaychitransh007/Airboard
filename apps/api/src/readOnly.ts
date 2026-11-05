import type { FastifyInstance } from "fastify";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** How long clients are told to wait before trying a refused change again. */
export const MAINTENANCE_RETRY_AFTER_SECONDS = 300;

/**
 * While AIRBOARD_READ_ONLY is on, for example while the database is copied to
 * a new project, every request that could change data is refused with
 * 503 MAINTENANCE so nothing written during the copy is lost. Reads keep
 * working. Register it after CORS so browsers can read the refusal.
 */
export function registerReadOnlyGuard(server: FastifyInstance, readOnly: boolean): void {
  if (!readOnly) return;
  server.addHook("onRequest", async (request, reply) => {
    if (READ_METHODS.has(request.method)) return;
    reply.header("retry-after", String(MAINTENANCE_RETRY_AFTER_SECONDS));
    await reply.code(503).send({ error: "MAINTENANCE" });
    return reply;
  });
}
