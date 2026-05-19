import fp from "fastify-plugin";
import { AppError } from "../utils/errors";

export const errorHandlerPlugin = fp(async (fastify) => {
  fastify.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id,
        },
      });
      return;
    }

    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    request.log.error({ err: error }, "Unhandled request error");
    reply.status(statusCode).send({
      error: {
        code: statusCode === 400 ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
        message: statusCode === 500 && fastify.config.NODE_ENV === "production" ? "Internal server error" : error.message,
        requestId: request.id,
      },
    });
  });
});
