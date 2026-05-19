import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fp from "fastify-plugin";

export const swaggerPlugin = fp(async (fastify) => {
  await fastify.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "CTR API",
        description: "Fastify API for CTS-R CBT supervision platform",
        version: "0.1.0",
      },
      servers: [
        {
          url: "/api/v1",
          description: "Versioned API",
        },
      ],
      tags: [
        { name: "Auth" },
        { name: "Users" },
        { name: "Clients" },
        { name: "Cases" },
        { name: "Sessions" },
        { name: "Transcripts" },
        { name: "AI Analysis" },
        { name: "Evidence" },
        { name: "Scoring" },
        { name: "Feedback" },
        { name: "Reports" },
        { name: "CTS-R Reference" },
        { name: "Analytics" },
        { name: "System" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      persistAuthorization: true,
    },
  });
});
