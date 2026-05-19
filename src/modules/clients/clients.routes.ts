import type { FastifyPluginAsync } from "fastify";
import { ok, paginated } from "../../utils/response";
import { paginationQuerySchema, standardErrors, uuidParamSchema } from "../../schemas/common";
import { clientSchema, caseSchema } from "../../schemas/entities";

export const clientsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/clients",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Clients"],
        operationId: "listClients",
        summary: "List/search pseudonymized clients",
        security: [{ bearerAuth: [] }],
        querystring: paginationQuerySchema,
        response: {
          200: { type: "object", properties: { data: { type: "array", items: clientSchema }, pageInfo: { type: "object" }, meta: { type: "object" } } },
          ...standardErrors,
        },
      },
    },
    async (request) => {
      const query = request.query as { q?: string; limit?: number };
      const limit = query.limit || 20;
      return paginated(request, fastify.store.listClients(request.authUser!.organizationId, query.q).slice(0, limit), limit, null);
    },
  );

  fastify.post(
    "/clients",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Clients"],
        operationId: "createClient",
        summary: "Create a pseudonymized client",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["clientCode"],
          properties: {
            clientCode: { type: "string" },
            displayLabel: { type: "string" },
            riskLevel: { type: ["string", "null"] },
          },
        },
        response: { 201: { type: "object", properties: { data: clientSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request, reply) => {
      const body = request.body as { clientCode: string; displayLabel?: string; riskLevel?: string | null };
      const client = fastify.store.createClient(request.authUser!.organizationId, body);
      reply.status(201).send(ok(request, client));
    },
  );

  fastify.get(
    "/clients/:id",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Clients"],
        operationId: "getClient",
        summary: "Get client detail",
        security: [{ bearerAuth: [] }],
        params: uuidParamSchema,
        response: { 200: { type: "object", properties: { data: clientSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => ok(request, fastify.store.getClient((request.params as { id: string }).id)),
  );

  fastify.patch(
    "/clients/:id",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Clients"],
        operationId: "updateClient",
        summary: "Update client label/status",
        security: [{ bearerAuth: [] }],
        params: uuidParamSchema,
        body: {
          type: "object",
          properties: {
            displayLabel: { type: "string" },
            riskLevel: { type: ["string", "null"] },
            archivedAt: { type: ["string", "null"], format: "date-time" },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        response: { 200: { type: "object", properties: { data: clientSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => ok(request, fastify.store.updateClient((request.params as { id: string }).id, request.body as Record<string, unknown>)),
  );

  fastify.get(
    "/clients/:id/cases",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Cases"],
        operationId: "listClientCases",
        summary: "List cases for a client",
        security: [{ bearerAuth: [] }],
        params: uuidParamSchema,
        response: { 200: { type: "object", properties: { data: { type: "array", items: caseSchema }, pageInfo: { type: "object" }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const clientId = (request.params as { id: string }).id;
      return paginated(request, fastify.store.listCases(request.authUser!.organizationId, clientId), 100, null);
    },
  );

  fastify.post(
    "/clients/:id/cases",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Cases"],
        operationId: "createClientCase",
        summary: "Create a therapy case for a client",
        security: [{ bearerAuth: [] }],
        params: uuidParamSchema,
        body: {
          type: "object",
          properties: {
            primaryTherapistId: { type: ["string", "null"], format: "uuid" },
            caseCode: { type: ["string", "null"] },
            modality: { type: ["string", "null"] },
            presentingProblem: { type: ["string", "null"] },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        response: { 201: { type: "object", properties: { data: caseSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request, reply) => {
      const clientId = (request.params as { id: string }).id;
      const record = fastify.store.createCase(request.authUser!.organizationId, clientId, request.body as Record<string, unknown>);
      reply.status(201).send(ok(request, record));
    },
  );
};
