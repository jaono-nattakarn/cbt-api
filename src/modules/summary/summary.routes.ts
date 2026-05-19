import type { FastifyPluginAsync } from "fastify";
import { ok } from "../../utils/response";
import { sessionParamSchema, standardErrors } from "../../schemas/common";
import { CTSR_ITEMS } from "../ctsr/ctsr.data";

export const summaryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/sessions/:sessionId/summary",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Feedback"],
        operationId: "getSessionSummary",
        summary: "Get aggregate CTS-R summary for a session",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        response: {
          200: {
            type: "object",
            properties: {
              data: { type: "object", additionalProperties: true },
              meta: { type: "object" },
            },
          },
          ...standardErrors,
        },
      },
    },
    async (request) => {
      const sessionId = (request.params as { sessionId: string }).sessionId;
      const session = fastify.store.getSession(sessionId);
      const scores = fastify.store.listScores(sessionId);
      const items = scores.map((score) => {
        const ref = CTSR_ITEMS.find((item) => item.id === score.ctsrItemId);
        return {
          itemId: score.ctsrItemId,
          itemName: ref?.nameEn,
          category: ref?.category,
          aiScore: score.aiScore ?? null,
          finalScore: score.finalScore ?? null,
          adjusted: score.aiScore !== score.finalScore,
        };
      });
      const sorted = [...scores].sort((a, b) => (b.finalScore ?? b.aiScore ?? 0) - (a.finalScore ?? a.aiScore ?? 0));
      return ok(request, {
        session: {
          id: session.id,
          displayCode: session.displayCode,
          caseAlias: session.caseAlias,
          therapistName: session.therapistName,
          sessionNumber: session.sessionNumber,
          shortDescription: session.shortDescription,
          status: session.status,
        },
        total: session.finalTotalScore ?? session.aiTotalScore ?? null,
        mean: session.finalMeanScore ?? session.aiMeanScore ?? null,
        maxPossible: 72,
        items,
        strengthItems: sorted.slice(0, 3).map((score) => score.ctsrItemId),
        developmentItems: sorted.slice(-3).map((score) => score.ctsrItemId),
      });
    },
  );
};
