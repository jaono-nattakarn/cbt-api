import Fastify from "fastify";
import { loadEnv } from "./config/env";
import { authPlugin } from "./plugins/auth";
import { dbPlugin } from "./plugins/db";
import { errorHandlerPlugin } from "./plugins/error-handler";
import { securityPlugin } from "./plugins/security";
import { storePlugin } from "./plugins/store";
import { swaggerPlugin } from "./plugins/swagger";
import { routes } from "./routes";

export async function buildApp() {
  const config = loadEnv();
  const fastify = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === "development"
          ? {
              target: "pino-pretty",
              options: { colorize: true },
            }
          : undefined,
    },
    requestIdHeader: "x-request-id",
  });

  fastify.decorate("config", config);

  await fastify.register(errorHandlerPlugin);
  await fastify.register(dbPlugin);
  await fastify.register(storePlugin);
  await fastify.register(securityPlugin);
  await fastify.register(authPlugin);
  await fastify.register(swaggerPlugin);
  await fastify.register(routes, { prefix: "/api/v1" });

  fastify.get("/openapi.json", async () => fastify.swagger());

  return fastify;
}
