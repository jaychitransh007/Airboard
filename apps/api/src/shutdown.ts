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
): (signal: NodeJS.Signals, exitCode?: number) => Promise<void> {
  let closing = false;
  const shutdown = async (signal: NodeJS.Signals, exitCode = 0) => {
    if (closing) return;
    closing = true;
    server.log.info({ signal }, "shutting down");
    const forced = setTimeout(() => exit(exitCode), graceMs);
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
    exit(exitCode);
  };
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    onSignal(signal, () => void shutdown(signal));
  }
  return shutdown;
}

/**
 * An error nothing caught leaves the process in an unknown state. Log it and
 * shut down as on SIGTERM (board sockets reconnect elsewhere, requests in
 * flight finish), but exit non-zero so Cloud Run replaces the instance.
 */
export function registerCrashHandlers(
  server: FastifyInstance,
  shutdown: (signal: NodeJS.Signals, exitCode?: number) => Promise<void>,
  on: (event: "unhandledRejection" | "uncaughtException", handler: (error: unknown) => void) => void =
    (event, handler) => process.on(event, handler),
): void {
  for (const event of ["unhandledRejection", "uncaughtException"] as const) {
    on(event, (error) => {
      server.log.fatal({ err: error, event }, "unhandled error; shutting down");
      void shutdown("SIGTERM", 1);
    });
  }
}
