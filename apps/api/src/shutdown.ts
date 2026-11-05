import type { FastifyInstance } from "fastify";

/** The close code that tells a board socket the server is restarting, so it reconnects. */
export const SERVICE_RESTART_CLOSE_CODE = 1012;

type ShutdownOptions = {
  /** Longest wait for in-flight requests before exiting anyway. */
  graceMs?: number;
  exit?: (code: number) => void;
  onSignal?: (signal: NodeJS.Signals, handler: () => void) => void;
};

/**
 * Cloud Run sends SIGTERM before stopping an instance (on every deploy and
 * scale-down) and kills it about 10 seconds later. On that signal, ask open
 * board sockets to reconnect, which lands them on the new instance, stop
 * accepting requests, and let the ones in flight finish within the grace
 * period. Returns the shutdown routine for tests.
 */
export function registerGracefulShutdown(
  server: FastifyInstance,
  {
    graceMs = 8_000,
    exit = (code) => process.exit(code),
    onSignal = (signal, handler) => process.once(signal, handler),
  }: ShutdownOptions = {},
): (signal: NodeJS.Signals) => Promise<void> {
  let closing = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    server.log.info({ signal }, "shutting down");
    const forced = setTimeout(() => exit(0), graceMs);
    forced.unref();
    for (const client of server.websocketServer?.clients ?? []) {
      try {
        client.close(SERVICE_RESTART_CLOSE_CODE, "SERVICE_RESTART");
      } catch {
        // Already closing.
      }
    }
    try {
      await server.close();
    } catch (error) {
      server.log.error({ err: error }, "shutdown could not close the server cleanly");
    }
    clearTimeout(forced);
    exit(0);
  };
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    onSignal(signal, () => void shutdown(signal));
  }
  return shutdown;
}
