import type { FastifyPluginAsync } from "fastify";
import multipart from "@fastify/multipart";
import { ok } from "../../utils/response";
import { sessionParamSchema, standardErrors } from "../../schemas/common";
import { transcriptSchema, transcriptTurnSchema } from "../../schemas/entities";
import { countWords, extractTranscriptText, parseTranscriptTurns, transcriptHash } from "../../utils/transcript";
import { ValidationError } from "../../utils/errors";

export const transcriptsRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(multipart, {
    limits: {
      fileSize: 15 * 1024 * 1024,
      files: 1,
    },
  });

  fastify.post(
    "/sessions/:sessionId/transcript",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Transcripts"],
        operationId: "uploadTranscript",
        summary: "Upload .txt or .docx transcript and store turns as JSONB-compatible blob",
        security: [{ bearerAuth: [] }],
        consumes: ["multipart/form-data"],
        params: sessionParamSchema,
        response: {
          201: {
            type: "object",
            properties: {
              data: {
                type: "object",
                properties: {
                  sessionId: { type: "string", format: "uuid" },
                  transcriptId: { type: "string", format: "uuid" },
                  status: { type: "string" },
                  wordCount: { type: "integer" },
                  charCount: { type: "integer" },
                  turnsCount: { type: "integer" },
                  duplicateWarning: { type: "boolean" },
                },
              },
              meta: { type: "object" },
            },
          },
          ...standardErrors,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { sessionId: string };
      const session = fastify.store.getSession(params.sessionId);
      const part = await request.file();
      if (!part) throw new ValidationError("Transcript file is required");
      const buffer = await part.toBuffer();
      const text = await extractTranscriptText({
        filename: part.filename,
        mimetype: part.mimetype,
        buffer,
      });
      const turns = parseTranscriptTurns(text);
      const transcript = fastify.store.upsertTranscript({
        organizationId: request.authUser!.organizationId,
        sessionId: session.id,
        sourceFileName: part.filename,
        sourceMimeType: part.mimetype,
        sourceFileSizeBytes: buffer.length,
        sourceFileSha256: transcriptHash(buffer),
        turns: {
          schemaVersion: 1,
          source: part.filename.toLowerCase().endsWith(".docx") ? "uploaded_docx" : "uploaded_txt",
          turns,
        },
        rawText: text,
        redactedText: null,
        language: null,
        wordCount: countWords(text),
        charCount: text.length,
        schemaVersion: 1,
        createdBy: request.authUser!.id,
      });
      fastify.store.addAudit({
        organizationId: request.authUser!.organizationId,
        actorUserId: request.authUser!.id,
        action: "transcript.uploaded",
        entityType: "session",
        entityId: session.id,
        afterData: { transcriptId: transcript.id, turnsCount: turns.length },
      });
      reply.status(201).send(
        ok(request, {
          sessionId: session.id,
          transcriptId: transcript.id,
          status: "uploaded",
          wordCount: transcript.wordCount,
          charCount: transcript.charCount,
          turnsCount: turns.length,
          duplicateWarning: false,
        }),
      );
    },
  );

  fastify.get(
    "/sessions/:sessionId/transcript",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Transcripts"],
        operationId: "getTranscript",
        summary: "Get transcript turns for a session",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        response: { 200: { type: "object", properties: { data: transcriptSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const transcript = fastify.store.getTranscriptBySession((request.params as { sessionId: string }).sessionId);
      return ok(request, { ...transcript, turns: transcript.turns.turns, rawText: undefined });
    },
  );

  fastify.patch(
    "/sessions/:sessionId/transcript",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Transcripts"],
        operationId: "updateTranscriptTurns",
        summary: "Replace corrected transcript turns",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        body: {
          type: "object",
          required: ["turns"],
          properties: {
            turns: { type: "array", items: transcriptTurnSchema },
          },
        },
        response: { 200: { type: "object", properties: { data: transcriptSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const sessionId = (request.params as { sessionId: string }).sessionId;
      const body = request.body as { turns: Array<{ turnNo: number; speaker: "Therapist" | "Client" | "Unknown"; text: string }> };
      const existing = fastify.store.getTranscriptBySession(sessionId);
      const updated = fastify.store.updateTranscript(existing.id, {
        turns: {
          ...existing.turns,
          source: "manual_correction",
          turns: body.turns.map((turn, index) => ({ ...turn, turnNo: index + 1 })),
        },
      });
      return ok(request, { ...updated, turns: updated.turns.turns, rawText: undefined });
    },
  );

  fastify.delete(
    "/sessions/:sessionId/transcript",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Transcripts"],
        operationId: "deleteTranscript",
        summary: "Delete transcript before sign-off",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        response: { 200: { type: "object", properties: { data: { type: "object" }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      fastify.store.deleteTranscriptBySession((request.params as { sessionId: string }).sessionId);
      return ok(request, { deleted: true });
    },
  );
};
