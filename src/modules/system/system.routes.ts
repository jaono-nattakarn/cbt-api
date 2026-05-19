import type { FastifyPluginAsync } from "fastify";

export const systemRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/health",
    {
      schema: {
        tags: ["System"],
        operationId: "healthCheck",
        summary: "Process health check",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              uptime: { type: "number" },
            },
          },
        },
      },
    },
    async () => ({ status: "ok", uptime: process.uptime() }),
  );

  fastify.get(
    "/ready",
    {
      schema: {
        tags: ["System"],
        operationId: "readinessCheck",
        summary: "Dependency readiness check",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              dependencies: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
    async () => ({
      status: "ready",
      dependencies: {
        store: fastify.pg ? "postgres" : "memory",
        postgres: fastify.pg ? "configured" : "not_configured",
        n8n: fastify.config.N8N_WEBHOOK_URL ? "configured" : "not_configured",
      },
    }),
  );
};
