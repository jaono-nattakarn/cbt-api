import type { FastifyPluginAsync } from "fastify";
import { ok } from "../../utils/response";
import { itemParamSchema, sessionParamSchema, standardErrors } from "../../schemas/common";
import { scoreSchema, sessionSchema } from "../../schemas/entities";

export const scoringRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/sessions/:sessionId/scores",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Scoring"],
        operationId: "listScores",
        summary: "Get 12 CTS-R item scores for a session",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        response: { 200: { type: "object", properties: { data: { type: "array", items: scoreSchema }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => ok(request, fastify.store.listScores((request.params as { sessionId: string }).sessionId)),
  );

  fastify.put(
    "/sessions/:sessionId/scores",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Scoring"],
        operationId: "bulkUpdateScores",
        summary: "Bulk save final supervisor scores",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        body: {
          type: "object",
          required: ["scores"],
          properties: {
            scores: {
              type: "array",
              items: {
                type: "object",
                required: ["itemId", "finalScore"],
                properties: {
                  itemId: { type: "integer", minimum: 1, maximum: 12 },
                  finalScore: { type: "integer", minimum: 0, maximum: 6 },
                  supervisorComment: { type: ["string", "null"] },
                },
              },
            },
          },
        },
        response: { 200: { type: "object", properties: { data: { type: "array", items: scoreSchema }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const sessionId = (request.params as { sessionId: string }).sessionId;
      const body = request.body as { scores: Array<{ itemId: number; finalScore: number; supervisorComment?: string | null }> };
      const scores = body.scores.map((item) =>
        fastify.store.updateScore(sessionId, item.itemId, {
          finalScore: item.finalScore,
          supervisorComment: item.supervisorComment ?? null,
          status: "confirmed",
          confirmedBy: request.authUser!.id,
          confirmedAt: new Date().toISOString(),
        }),
      );
      return ok(request, scores);
    },
  );

  fastify.patch(
    "/sessions/:sessionId/scores/:itemId",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Scoring"],
        operationId: "updateScore",
        summary: "Update one CTS-R final score/comment",
        security: [{ bearerAuth: [] }],
        params: itemParamSchema,
        body: {
          type: "object",
          properties: {
            finalScore: { type: "integer", minimum: 0, maximum: 6 },
            supervisorComment: { type: ["string", "null"] },
            status: { type: "string", enum: ["reviewed", "confirmed", "overridden"] },
          },
        },
        response: { 200: { type: "object", properties: { data: scoreSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const params = request.params as { sessionId: string; itemId: number };
      const body = request.body as { finalScore?: number; supervisorComment?: string | null; status?: "reviewed" | "confirmed" | "overridden" };
      const score = fastify.store.updateScore(params.sessionId, Number(params.itemId), {
        finalScore: body.finalScore,
        supervisorComment: body.supervisorComment,
        status: body.status || "reviewed",
        confirmedBy: request.authUser!.id,
        confirmedAt: new Date().toISOString(),
      });
      return ok(request, score);
    },
  );

  fastify.post(
    "/sessions/:sessionId/score-submissions",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Scoring"],
        operationId: "submitScores",
        summary: "Validate and submit final scoring",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        response: { 200: { type: "object", properties: { data: sessionSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const session = fastify.store.recomputeFinalTotals((request.params as { sessionId: string }).sessionId);
      return ok(request, session);
    },
  );
};
