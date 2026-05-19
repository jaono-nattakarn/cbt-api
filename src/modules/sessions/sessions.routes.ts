import type { FastifyPluginAsync } from "fastify";
import { ok, paginated } from "../../utils/response";
import { paginationQuerySchema, sessionParamSchema, standardErrors } from "../../schemas/common";
import { sessionSchema } from "../../schemas/entities";
import type { SessionStatus } from "../../store/types";

export const sessionsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/sessions",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Sessions"],
        operationId: "listSessions",
        summary: "List sessions with filters",
        security: [{ bearerAuth: [] }],
        querystring: {
          ...paginationQuerySchema,
          properties: {
            ...paginationQuerySchema.properties,
            status: { type: "string" },
          },
        },
        response: { 200: { type: "object", properties: { data: { type: "array", items: sessionSchema }, pageInfo: { type: "object" }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const query = request.query as { status?: SessionStatus; q?: string; limit?: number };
      const limit = query.limit || 20;
      const sessions = fastify.store
        .listSessions(request.authUser!.organizationId, {
          status: query.status,
          q: query.q,
        })
        .slice(0, limit);
      return paginated(request, sessions, limit, null);
    },
  );

  fastify.get(
    "/sessions/therapist-names",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Sessions"],
        operationId: "listSessionTherapistNames",
        summary: "List distinct therapist names from session metadata",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            q: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              data: { type: "array", items: { type: "string" } },
              meta: { type: "object" },
            },
          },
          ...standardErrors,
        },
      },
    },
    async (request) => {
      const query = request.query as { q?: string };
      return ok(request, fastify.store.listTherapistNames(request.authUser!.organizationId, query.q));
    },
  );

  fastify.post(
    "/sessions",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Sessions"],
        operationId: "createSession",
        summary: "Create a draft CTS-R review session",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            clientId: { type: "string", format: "uuid" },
            caseId: { type: "string", format: "uuid" },
            caseAlias: { type: "string" },
            therapistName: { type: "string" },
            sessionNumber: { type: "string", pattern: "^[0-9]+$" },
            sessionDate: { type: "string", format: "date" },
            shortDescription: { type: "string", maxLength: 72 },
            durationSeconds: { type: "integer", minimum: 0 },
          },
        },
        response: { 201: { type: "object", properties: { data: sessionSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request, reply) => {
      const session = fastify.store.createSession(
        request.authUser!.organizationId,
        request.authUser!.id,
        request.body as Record<string, unknown>,
      );
      fastify.store.addAudit({
        organizationId: request.authUser!.organizationId,
        actorUserId: request.authUser!.id,
        action: "session.created",
        entityType: "session",
        entityId: session.id,
        afterData: session,
      });
      reply.status(201).send(ok(request, session));
    },
  );

  fastify.get(
    "/sessions/:sessionId",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Sessions"],
        operationId: "getSession",
        summary: "Get session detail",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        response: { 200: { type: "object", properties: { data: sessionSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => ok(request, fastify.store.getSession((request.params as { sessionId: string }).sessionId)),
  );

  fastify.patch(
    "/sessions/:sessionId",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Sessions"],
        operationId: "updateSession",
        summary: "Update session metadata or status",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        body: {
          type: "object",
          properties: {
            caseId: { type: ["string", "null"], format: "uuid" },
            clientId: { type: ["string", "null"], format: "uuid" },
            caseAlias: { type: ["string", "null"] },
            therapistName: { type: ["string", "null"] },
            sessionNumber: { type: ["string", "null"], pattern: "^[0-9]+$" },
            sessionDate: { type: ["string", "null"], format: "date" },
            shortDescription: { type: ["string", "null"], maxLength: 72 },
            durationSeconds: { type: ["integer", "null"] },
            status: { type: "string" },
          },
        },
        response: { 200: { type: "object", properties: { data: sessionSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const params = request.params as { sessionId: string };
      const before = fastify.store.getSession(params.sessionId);
      const session = fastify.store.updateSession(params.sessionId, request.body as Record<string, unknown>);
      fastify.store.addAudit({
        organizationId: request.authUser!.organizationId,
        actorUserId: request.authUser!.id,
        action: "session.updated",
        entityType: "session",
        entityId: session.id,
        beforeData: before,
        afterData: session,
      });
      return ok(request, session);
    },
  );

  fastify.patch(
    "/sessions/:sessionId/archive",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Sessions"],
        operationId: "archiveSession",
        summary: "Archive or unarchive a session",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        body: {
          type: "object",
          required: ["archived"],
          properties: {
            archived: { type: "boolean" },
          },
        },
        response: { 200: { type: "object", properties: { data: sessionSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const params = request.params as { sessionId: string };
      const body = request.body as { archived: boolean };
      const session = fastify.store.updateSession(params.sessionId, {
        archivedAt: body.archived ? new Date().toISOString() : null,
        status: body.archived ? "archived" : "signed_off",
      });
      return ok(request, session);
    },
  );

  fastify.get(
    "/sessions/:sessionId/timeline",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Sessions"],
        operationId: "getSessionTimeline",
        summary: "Get audit timeline for a session",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        response: { 200: { type: "object", properties: { data: { type: "array", items: { type: "object", additionalProperties: true } }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const sessionId = (request.params as { sessionId: string }).sessionId;
      return ok(request, fastify.store.listSessionAudit(sessionId));
    },
  );
};
