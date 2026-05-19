import type { FastifyPluginAsync } from "fastify";
import { ok, paginated } from "../../utils/response";
import { sessionParamSchema, standardErrors, uuidParamSchema } from "../../schemas/common";
import { evidenceSchema } from "../../schemas/entities";
import { parseTimestampLabel } from "../../utils/transcript";

export const evidenceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/sessions/:sessionId/evidence",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Evidence"],
        operationId: "listEvidence",
        summary: "List evidence by session, CTS-R item, or status",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        querystring: {
          type: "object",
          properties: {
            itemId: { type: "integer", minimum: 1, maximum: 12 },
            status: { type: "string", enum: ["suggested", "confirmed", "rejected", "manual"] },
          },
        },
        response: { 200: { type: "object", properties: { data: { type: "array", items: evidenceSchema }, pageInfo: { type: "object" }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const params = request.params as { sessionId: string };
      const query = request.query as { itemId?: number; status?: "suggested" | "confirmed" | "rejected" | "manual" };
      return paginated(request, fastify.store.listEvidence(params.sessionId, query), 100, null);
    },
  );

  fastify.post(
    "/sessions/:sessionId/evidence",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Evidence"],
        operationId: "createEvidence",
        summary: "Add manual supervisor evidence",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        body: {
          type: "object",
          required: ["ctsrItemId", "quoteText", "speaker"],
          properties: {
            ctsrItemId: { type: "integer", minimum: 1, maximum: 12 },
            transcriptTurnNo: { type: ["integer", "null"] },
            quoteText: { type: "string" },
            speaker: { type: "string", enum: ["Therapist", "Client", "Unknown"] },
            timestampLabel: { type: ["string", "null"] },
            polarity: { type: "string", enum: ["positive", "negative", "neutral"], default: "positive" },
            reviewNote: { type: ["string", "null"] },
          },
        },
        response: { 201: { type: "object", properties: { data: evidenceSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request, reply) => {
      const sessionId = (request.params as { sessionId: string }).sessionId;
      const body = request.body as { ctsrItemId: number; transcriptTurnNo?: number | null; quoteText: string; speaker: "Therapist" | "Client" | "Unknown"; timestampLabel?: string | null; polarity?: "positive" | "negative" | "neutral"; reviewNote?: string | null };
      const evidence = fastify.store.createEvidence({
        organizationId: request.authUser!.organizationId,
        sessionId,
        analysisResultId: null,
        scoreId: null,
        ctsrItemId: body.ctsrItemId,
        transcriptTurnNo: body.transcriptTurnNo ?? null,
        speaker: body.speaker,
        quoteText: body.quoteText,
        timestampLabel: body.timestampLabel ?? null,
        timestampSeconds: parseTimestampLabel(body.timestampLabel),
        polarity: body.polarity || "positive",
        source: "manual",
        status: "manual",
        reviewNote: body.reviewNote ?? null,
        createdBy: request.authUser!.id,
        reviewedBy: request.authUser!.id,
        reviewedAt: new Date().toISOString(),
      });
      reply.status(201).send(ok(request, evidence));
    },
  );

  fastify.get(
    "/evidence/:id",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Evidence"],
        operationId: "getEvidence",
        summary: "Get evidence detail",
        security: [{ bearerAuth: [] }],
        params: uuidParamSchema,
        response: { 200: { type: "object", properties: { data: evidenceSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => ok(request, fastify.store.getEvidence((request.params as { id: string }).id)),
  );

  fastify.patch(
    "/evidence/:id",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Evidence"],
        operationId: "updateEvidence",
        summary: "Confirm, reject, or relabel evidence",
        security: [{ bearerAuth: [] }],
        params: uuidParamSchema,
        body: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["suggested", "confirmed", "rejected", "manual"] },
            ctsrItemId: { type: "integer", minimum: 1, maximum: 12 },
            transcriptTurnNo: { type: ["integer", "null"] },
            reviewNote: { type: ["string", "null"] },
            quoteText: { type: "string" },
            speaker: { type: "string", enum: ["Therapist", "Client", "Unknown"] },
            timestampLabel: { type: ["string", "null"] },
            polarity: { type: "string", enum: ["positive", "negative", "neutral"] },
          },
        },
        response: { 200: { type: "object", properties: { data: evidenceSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const patch = request.body as Record<string, unknown>;
      const evidence = fastify.store.updateEvidence((request.params as { id: string }).id, {
        ...patch,
        reviewedBy: request.authUser!.id,
        reviewedAt: new Date().toISOString(),
      });
      return ok(request, evidence);
    },
  );

  fastify.delete(
    "/evidence/:id",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Evidence"],
        operationId: "deleteEvidence",
        summary: "Delete draft/manual evidence",
        security: [{ bearerAuth: [] }],
        params: uuidParamSchema,
        response: { 200: { type: "object", properties: { data: { type: "object" }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      fastify.store.deleteEvidence((request.params as { id: string }).id);
      return ok(request, { deleted: true });
    },
  );
};
