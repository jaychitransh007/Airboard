import { loadConfig } from "./config";
import { buildServer } from "./server";

const config = loadConfig();
const server = await buildServer(config);

await server.listen({
  host: config.host,
  port: config.port,
});
