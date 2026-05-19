import type { FastifyPluginAsync } from "fastify";
import { ok } from "../../utils/response";
import { standardErrors, uuidParamSchema } from "../../schemas/common";
import { caseSchema } from "../../schemas/entities";

export const casesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/cases/:id",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Cases"],
        operationId: "getCase",
        summary: "Get case detail",
        security: [{ bearerAuth: [] }],
        params: uuidParamSchema,
        response: { 200: { type: "object", properties: { data: caseSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => ok(request, fastify.store.getCase((request.params as { id: string }).id)),
  );

  fastify.patch(
    "/cases/:id",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Cases"],
        operationId: "updateCase",
        summary: "Update case metadata/status",
        security: [{ bearerAuth: [] }],
        params: uuidParamSchema,
        body: {
          type: "object",
          properties: {
            primaryTherapistId: { type: ["string", "null"], format: "uuid" },
            caseCode: { type: ["string", "null"] },
            modality: { type: ["string", "null"] },
            presentingProblem: { type: ["string", "null"] },
            status: { type: "string", enum: ["active", "closed", "archived"] },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        response: { 200: { type: "object", properties: { data: caseSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => ok(request, fastify.store.updateCase((request.params as { id: string }).id, request.body as Record<string, unknown>)),
  );
};
