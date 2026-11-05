import { loadConfig } from "./config";
import { buildServer } from "./server";
import { registerGracefulShutdown } from "./shutdown";

const config = loadConfig();
const server = await buildServer(config);
registerGracefulShutdown(server);

await server.listen({
  host: config.host,
  port: config.port,
});
