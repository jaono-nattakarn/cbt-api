import type { FastifyPluginAsync } from "fastify";
import { ok } from "../../utils/response";
import { standardErrors } from "../../schemas/common";

export const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/dashboard/overview",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Analytics"],
        operationId: "getDashboardOverview",
        summary: "Get dashboard KPI overview",
        security: [{ bearerAuth: [] }],
        response: { 200: { type: "object", properties: { data: { type: "object", additionalProperties: true }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const sessions = fastify.store.listSessions(request.authUser!.organizationId);
      return ok(request, {
        totalSessions: sessions.length,
        inReview: sessions.filter((session) => ["ready_for_review", "review_in_progress", "scoring"].includes(session.status)).length,
        completed: sessions.filter((session) => session.status === "signed_off").length,
        recentSessions: sessions.slice(0, 5),
      });
    },
  );

  fastify.get(
    "/analytics/sessions",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Analytics"],
        operationId: "getSessionAnalytics",
        summary: "Get session trend analytics",
        security: [{ bearerAuth: [] }],
        response: { 200: { type: "object", properties: { data: { type: "object", additionalProperties: true }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const sessions = fastify.store.listSessions(request.authUser!.organizationId);
      return ok(request, {
        byStatus: sessions.reduce<Record<string, number>>((acc, session) => {
          acc[session.status] = (acc[session.status] || 0) + 1;
          return acc;
        }, {}),
      });
    },
  );

  fastify.get(
    "/analytics/therapists/:name/progress",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Analytics"],
        operationId: "getTherapistProgress",
        summary: "Get CTS-R progress by therapist",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
          },
        },
        response: { 200: { type: "object", properties: { data: { type: "object", additionalProperties: true }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const therapistName = (request.params as { name: string }).name;
      const sessions = fastify.store
        .listSessions(request.authUser!.organizationId)
        .filter((session) => session.therapistName === therapistName);
      return ok(request, {
        therapistName,
        points: sessions.map((session) => ({
          sessionId: session.id,
          sessionDate: session.sessionDate,
          totalScore: session.finalTotalScore ?? session.aiTotalScore,
          meanScore: session.finalMeanScore ?? session.aiMeanScore,
        })),
      });
    },
  );

  fastify.get(
    "/analytics/ctsr-items",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Analytics"],
        operationId: "getCtsrItemAnalytics",
        summary: "Get aggregate CTS-R item scores",
        security: [{ bearerAuth: [] }],
        response: { 200: { type: "object", properties: { data: { type: "array", items: { type: "object", additionalProperties: true } }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const sessions = new Set(fastify.store.listSessions(request.authUser!.organizationId).map((session) => session.id));
      const scores = [...fastify.store.scores.values()].filter((score) => sessions.has(score.sessionId));
      const grouped = Array.from({ length: 12 }, (_, index) => {
        const itemId = index + 1;
        const itemScores = scores.filter((score) => score.ctsrItemId === itemId && score.finalScore !== null && score.finalScore !== undefined);
        const avg = itemScores.length ? itemScores.reduce((sum, score) => sum + (score.finalScore || 0), 0) / itemScores.length : null;
        return { itemId, averageScore: avg === null ? null : Number(avg.toFixed(2)), count: itemScores.length };
      });
      return ok(request, grouped);
    },
  );
};
