import jwt from "@fastify/jwt";
import fp from "fastify-plugin";
import { ForbiddenError, UnauthorizedError } from "../utils/errors";
import type { AuthenticatedUser, Role } from "../store/types";

export const authPlugin = fp(async (fastify) => {
  await fastify.register(jwt, {
    secret: fastify.config.JWT_SECRET,
    sign: {
      expiresIn: `${fastify.config.ACCESS_TOKEN_TTL_SECONDS}s`,
    },
  });

  fastify.decorate("authenticate", async (request) => {
    try {
      const payload = await request.jwtVerify<AuthenticatedUser>();
      request.authUser = payload;
    } catch {
      throw new UnauthorizedError();
    }
  });

  fastify.decorate("authorize", (roles: Role[]) => async (request, reply) => {
    await fastify.authenticate(request, reply);
    if (!request.authUser || !roles.includes(request.authUser.role)) {
      throw new ForbiddenError();
    }
  });
});
