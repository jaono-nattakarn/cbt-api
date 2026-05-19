import type { FastifyPluginAsync } from "fastify";
import { ok, paginated } from "../../utils/response";
import { sessionParamSchema, standardErrors, uuidParamSchema } from "../../schemas/common";
import { reportSchema, sessionSchema } from "../../schemas/entities";

export const reportsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/sessions/:sessionId/reports",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Reports"],
        operationId: "createReport",
        summary: "Generate a PDF or DOCX supervision report",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        body: {
          type: "object",
          required: ["format", "includedSections"],
          properties: {
            format: { type: "string", enum: ["pdf", "docx"] },
            includedSections: {
              type: "object",
              required: ["overall", "perItem", "feedback"],
              properties: {
                overall: { type: "boolean" },
                perItem: { type: "boolean" },
                feedback: { type: "boolean" },
              },
            },
          },
        },
        response: { 201: { type: "object", properties: { data: reportSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request, reply) => {
      const sessionId = (request.params as { sessionId: string }).sessionId;
      const body = request.body as { format: "pdf" | "docx"; includedSections: Record<string, boolean> };
      const report = fastify.store.createReport({
        organizationId: request.authUser!.organizationId,
        sessionId,
        format: body.format,
        includedSections: body.includedSections,
        storageKey: null,
        fileSizeBytes: null,
        generatedBy: request.authUser!.id,
      });
      reply.status(201).send(ok(request, report));
    },
  );

  fastify.get(
    "/sessions/:sessionId/reports",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Reports"],
        operationId: "listReports",
        summary: "List generated reports for a session",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        response: { 200: { type: "object", properties: { data: { type: "array", items: reportSchema }, pageInfo: { type: "object" }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => paginated(request, fastify.store.listReports((request.params as { sessionId: string }).sessionId), 100, null),
  );

  fastify.get(
    "/reports/:id",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Reports"],
        operationId: "getReport",
        summary: "Get report metadata",
        security: [{ bearerAuth: [] }],
        params: uuidParamSchema,
        response: { 200: { type: "object", properties: { data: reportSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => ok(request, fastify.store.getReport((request.params as { id: string }).id)),
  );

  fastify.get(
    "/reports/:id/download",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Reports"],
        operationId: "downloadReport",
        summary: "Get report download metadata or signed URL",
        security: [{ bearerAuth: [] }],
        params: uuidParamSchema,
        response: { 200: { type: "object", properties: { data: { type: "object", additionalProperties: true }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const report = fastify.store.getReport((request.params as { id: string }).id);
      return ok(request, { reportId: report.id, fileName: report.fileName, downloadUrl: null, note: "Wire object storage or PDF renderer in production." });
    },
  );

  fastify.post(
    "/sessions/:sessionId/sign-off",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Reports"],
        operationId: "signOffSession",
        summary: "Submit evaluation and sign off a session",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        response: { 200: { type: "object", properties: { data: sessionSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const session = fastify.store.updateSession((request.params as { sessionId: string }).sessionId, {
        status: "signed_off",
        signedOffAt: new Date().toISOString(),
      });
      return ok(request, session);
    },
  );
};
