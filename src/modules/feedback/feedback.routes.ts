import type { FastifyPluginAsync } from "fastify";
import { ok } from "../../utils/response";
import { sessionParamSchema, standardErrors } from "../../schemas/common";

const feedbackSchema = {
  type: "object",
  required: ["sessionId", "strengths", "growthAreas", "suggestions", "createdAt", "updatedAt"],
  properties: {
    sessionId: { type: "string", format: "uuid" },
    strengths: { type: "string" },
    growthAreas: { type: "string" },
    suggestions: { type: "string" },
    overallComment: { type: ["string", "null"] },
    updatedBy: { type: "string", format: "uuid" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

export const feedbackRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/sessions/:sessionId/feedback",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Feedback"],
        operationId: "getFeedback",
        summary: "Get supervision feedback text",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        response: { 200: { type: "object", properties: { data: feedbackSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => ok(request, fastify.store.getFeedback((request.params as { sessionId: string }).sessionId)),
  );

  fastify.put(
    "/sessions/:sessionId/feedback",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Feedback"],
        operationId: "upsertFeedback",
        summary: "Save strengths, growth areas, and suggestions",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        body: {
          type: "object",
          required: ["strengths", "growthAreas", "suggestions"],
          properties: {
            strengths: { type: "string" },
            growthAreas: { type: "string" },
            suggestions: { type: "string" },
            overallComment: { type: ["string", "null"] },
          },
        },
        response: { 200: { type: "object", properties: { data: feedbackSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const sessionId = (request.params as { sessionId: string }).sessionId;
      const body = request.body as { strengths: string; growthAreas: string; suggestions: string; overallComment?: string | null };
      return ok(request, fastify.store.upsertFeedback({ sessionId, ...body, updatedBy: request.authUser!.id }));
    },
  );
};
