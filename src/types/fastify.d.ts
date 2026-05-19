import type { FastifyReply, FastifyRequest } from "fastify";
import type { Env } from "../config/env";
import type { MemoryStore } from "../store/memory-store";
import type { AuthenticatedUser, Role } from "../store/types";

declare module "fastify" {
  interface FastifyInstance {
    config: Env;
    store: MemoryStore;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authorize: (roles: Role[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    authUser?: AuthenticatedUser;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthenticatedUser;
    user: AuthenticatedUser;
  }
}
