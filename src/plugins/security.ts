import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";

export const securityPlugin = fp(async (fastify) => {
  const origins = fastify.config.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim());

  await fastify.register(helmet);
  await fastify.register(cors, {
    origin: (origin, callback) => {
      if (!origin || origins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed"), false);
    },
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Requested-With"],
    credentials: true,
  });
  await fastify.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });
});
