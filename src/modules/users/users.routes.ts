import type { FastifyPluginAsync } from "fastify";
import { ok, paginated } from "../../utils/response";
import { uuidParamSchema, paginationQuerySchema, standardErrors } from "../../schemas/common";
import { userSchema } from "../../schemas/entities";
import type { Role, UserRecord } from "../../store/types";

function publicUser(item: UserRecord) {
  return {
    id: item.id,
    organizationId: item.organizationId,
    email: item.email,
    name: item.name,
    role: item.role,
    status: item.status,
    affiliation: item.affiliation ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastLoginAt: item.lastLoginAt ?? null,
  };
}

export const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/users",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Users"],
        operationId: "listUsers",
        summary: "List organization users",
        security: [{ bearerAuth: [] }],
        querystring: {
          ...paginationQuerySchema,
          properties: {
            ...paginationQuerySchema.properties,
            role: { type: "string", enum: ["admin", "supervisor", "therapist", "viewer"] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              data: { type: "array", items: userSchema },
              pageInfo: { type: "object" },
              meta: { type: "object" },
            },
          },
          ...standardErrors,
        },
      },
    },
    async (request) => {
      const query = request.query as { limit?: number; role?: Role };
      const limit = query.limit || 20;
      const users = fastify.store.listUsers(request.authUser!.organizationId, query.role).slice(0, limit);
      return paginated(request, users.map(publicUser), limit, null);
    },
  );

  fastify.post(
    "/users",
    {
      preHandler: [fastify.authorize(["admin", "supervisor"])],
      schema: {
        tags: ["Users"],
        operationId: "createUser",
        summary: "Create or invite a user",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["name", "email", "password", "role"],
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8 },
            role: { type: "string", enum: ["admin", "supervisor", "therapist", "viewer"] },
            affiliation: { type: "string" },
          },
        },
        response: { 201: { type: "object", properties: { data: userSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request, reply) => {
      const body = request.body as { name: string; email: string; password: string; role: Role; affiliation?: string };
      const user = await fastify.store.registerUser({
        organizationId: request.authUser!.organizationId,
        name: body.name,
        email: body.email,
        password: body.password,
        role: body.role,
      });
      user.affiliation = body.affiliation;
      fastify.store.updateUser(user.id, { affiliation: body.affiliation });
      reply.status(201).send(ok(request, publicUser(user)));
    },
  );

  fastify.get(
    "/users/:id",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Users"],
        operationId: "getUser",
        summary: "Get user profile",
        security: [{ bearerAuth: [] }],
        params: uuidParamSchema,
        response: { 200: { type: "object", properties: { data: userSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const params = request.params as { id: string };
      return ok(request, publicUser(fastify.store.getUserById(params.id)));
    },
  );

  fastify.patch(
    "/users/:id",
    {
      preHandler: [fastify.authorize(["admin", "supervisor"])],
      schema: {
        tags: ["Users"],
        operationId: "updateUser",
        summary: "Update user role/status/profile",
        security: [{ bearerAuth: [] }],
        params: uuidParamSchema,
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: "string", enum: ["admin", "supervisor", "therapist", "viewer"] },
            status: { type: "string", enum: ["active", "invited", "disabled"] },
            affiliation: { type: "string" },
          },
        },
        response: { 200: { type: "object", properties: { data: userSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const params = request.params as { id: string };
      const body = request.body as { name?: string; role?: Role; status?: "active" | "invited" | "disabled"; affiliation?: string };
      return ok(request, publicUser(fastify.store.updateUser(params.id, body)));
    },
  );

  fastify.get(
    "/therapists",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Users"],
        operationId: "listTherapists",
        summary: "List therapist users",
        security: [{ bearerAuth: [] }],
        response: { 200: { type: "object", properties: { data: { type: "array", items: userSchema }, pageInfo: { type: "object" }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => paginated(request, fastify.store.listUsers(request.authUser!.organizationId, "therapist").map(publicUser), 100, null),
  );

  fastify.get(
    "/supervisors",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Users"],
        operationId: "listSupervisors",
        summary: "List supervisor users",
        security: [{ bearerAuth: [] }],
        response: { 200: { type: "object", properties: { data: { type: "array", items: userSchema }, pageInfo: { type: "object" }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => paginated(request, fastify.store.listUsers(request.authUser!.organizationId, "supervisor").map(publicUser), 100, null),
  );
};
