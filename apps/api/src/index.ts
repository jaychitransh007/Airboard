import { loadConfig } from "./config";
import { buildServer } from "./server";
import { registerCrashHandlers, registerGracefulShutdown } from "./shutdown";

const config = loadConfig();
const server = await buildServer(config);
registerCrashHandlers(server, registerGracefulShutdown(server));

await server.listen({
  host: config.host,
  port: config.port,
});
