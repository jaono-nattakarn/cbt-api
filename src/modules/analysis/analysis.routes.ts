import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { ok, paginated } from "../../utils/response";
import { sessionParamSchema, standardErrors, uuidParamSchema } from "../../schemas/common";
import { analysisJobSchema, evidenceSchema, scoreSchema } from "../../schemas/entities";
import { N8nClient, N8nWebhookTimeoutError } from "../../integrations/n8n/n8n.client";
import { mapEvidence, mapScores, normalizeN8nResult } from "../../integrations/n8n/n8n.mapper";
import { countWords, parseTranscriptTurns, turnsToPlainText } from "../../utils/transcript";
import { UnauthorizedError, ValidationError } from "../../utils/errors";
import type { AnalysisJobRecord } from "../../store/types";

const ANALYSIS_PHASES = ["parse", "speakers", "analyze", "highlight", "score"] as const;
type AnalysisPhase = (typeof ANALYSIS_PHASES)[number];

interface AnalysisProgress {
  phase: AnalysisPhase;
  completed: AnalysisPhase[];
  message?: string;
  waitingForCallback?: boolean;
  updatedAt: string;
}

const analysisResultSchema = {
  type: "object",
  required: ["id", "sessionId", "status", "meta", "summary", "items"],
  properties: {
    id: { type: "string", format: "uuid" },
    sessionId: { type: "string", format: "uuid" },
    status: { type: "string", enum: ["ok", "rejected", "error"] },
    meta: { type: "object", additionalProperties: true },
    summary: { type: "object", additionalProperties: true },
    items: { type: "array", items: scoreSchema },
    evidence: { type: "array", items: evidenceSchema },
  },
} as const;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Analysis job failed";
}

function failAnalysisJob(fastify: Parameters<FastifyPluginAsync>[0], jobId: string, error: unknown) {
  const message = errorMessage(error);
  const job = fastify.store.getAnalysisJob(jobId);
  fastify.store.updateAnalysisJob(job.id, {
    status: "failed",
    errorCode: "analysis_job_failed",
    errorMessage: message,
    completedAt: new Date().toISOString(),
  });
  fastify.store.updateSession(job.sessionId, { status: "ai_failed" });
  fastify.log.error({ err: error, jobId, sessionId: job.sessionId }, "Analysis job failed");
}

function holdAnalysisJobForCallback(fastify: FastifyInstance, jobId: string, error: unknown) {
  const message = errorMessage(error);
  const job = fastify.store.getAnalysisJob(jobId);
  updateAnalysisProgress(fastify, job, buildProgress({
    phase: "analyze",
    message: "n8n is still running; waiting for callback.",
    waitingForCallback: true,
  }), {
    status: "processing",
    errorCode: "n8n_webhook_timeout",
    errorMessage: `${message}. Workflow may still be running; waiting for n8n callback.`,
  });
  fastify.store.updateSession(job.sessionId, { status: "processing" });
  fastify.log.warn({ err: error, jobId, sessionId: job.sessionId }, "n8n webhook timed out; keeping job processing");
}

function queueAnalysisJob(fastify: FastifyInstance, jobId: string) {
  void runAnalysisJob(fastify, jobId).catch((error) => {
    if (error instanceof N8nWebhookTimeoutError) {
      holdAnalysisJobForCallback(fastify, jobId, error);
      return;
    }
    failAnalysisJob(fastify, jobId, error);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizePhase(value: unknown): AnalysisPhase | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (["parse", "parsing", "transcript", "upload"].includes(normalized)) return "parse";
  if (["speaker", "speakers", "identifyspeakers", "identifyingspeakers"].includes(normalized)) return "speakers";
  if (["analyze", "analysis", "analyzing", "therapeuticcontent", "content"].includes(normalized)) return "analyze";
  if (["highlight", "highlights", "evidence", "extractquotes", "extractquote", "quotes"].includes(normalized)) return "highlight";
  if (["score", "scores", "scoring", "scoreitems", "scoreitem", "summary", "done", "complete", "completed"].includes(normalized)) return "score";
  return null;
}

function completedBefore(phase: AnalysisPhase): AnalysisPhase[] {
  const index = ANALYSIS_PHASES.indexOf(phase);
  return ANALYSIS_PHASES.slice(0, Math.max(index, 0));
}

function normalizeCompleted(value: unknown, phase: AnalysisPhase): AnalysisPhase[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const phases = items.map(normalizePhase).filter((item): item is AnalysisPhase => Boolean(item));
  return phases.length ? [...new Set(phases)] : completedBefore(phase);
}

function buildProgress(input: {
  phase: AnalysisPhase;
  completed?: unknown;
  message?: string | null;
  waitingForCallback?: boolean;
}): AnalysisProgress {
  return {
    phase: input.phase,
    completed: normalizeCompleted(input.completed, input.phase),
    message: input.message || undefined,
    waitingForCallback: input.waitingForCallback || undefined,
    updatedAt: new Date().toISOString(),
  };
}

function extractProgressFromRecord(record: Record<string, unknown>): AnalysisProgress | null {
  const progressRecord = isRecord(record.progress) ? record.progress : record;
  const phase = normalizePhase(progressRecord.phase ?? record.phase);
  if (!phase) return null;
  return buildProgress({
    phase,
    completed: progressRecord.completed ?? record.completed,
    message: stringFromUnknown(progressRecord.message ?? record.message),
    waitingForCallback: progressRecord.waitingForCallback === true || record.waitingForCallback === true,
  });
}

function extractProgress(...sources: unknown[]): AnalysisProgress | null {
  for (const source of sources) {
    const value = Array.isArray(source) ? source[0] : source;
    if (!isRecord(value)) continue;
    const direct = extractProgressFromRecord(value);
    if (direct) return direct;
    for (const key of ["body", "data", "output", "result"]) {
      const child = value[key];
      if (isRecord(child)) {
        const nested = extractProgressFromRecord(child);
        if (nested) return nested;
      }
    }
  }
  return null;
}

function progressPayload(existing: unknown, progress: AnalysisProgress) {
  if (isRecord(existing)) {
    return { ...existing, progress };
  }
  return existing === undefined ? { progress } : { raw: existing, progress };
}

function updateAnalysisProgress(
  fastify: FastifyInstance,
  job: AnalysisJobRecord,
  progress: AnalysisProgress,
  patch: Partial<AnalysisJobRecord> = {},
) {
  return fastify.store.updateAnalysisJob(job.id, {
    ...patch,
    responsePayload: progressPayload(job.responsePayload, progress),
  });
}

function storedProgress(payload: unknown): AnalysisProgress | null {
  if (!isRecord(payload) || !isRecord(payload.progress)) return null;
  const phase = normalizePhase(payload.progress.phase);
  if (!phase) return null;
  return {
    phase,
    completed: normalizeCompleted(payload.progress.completed, phase),
    message: stringFromUnknown(payload.progress.message) || undefined,
    waitingForCallback: payload.progress.waitingForCallback === true || undefined,
    updatedAt: stringFromUnknown(payload.progress.updatedAt) || new Date().toISOString(),
  };
}

function serializeAnalysisJob(job: AnalysisJobRecord) {
  return {
    ...job,
    progress: storedProgress(job.responsePayload),
  };
}

function isFinalN8nResult(raw: unknown) {
  const { result } = normalizeN8nResult(raw);
  return (
    result.status === "ok" ||
    result.status === "rejected" ||
    result.status === "error" ||
    Array.isArray(result.ctsr_items) ||
    Boolean(result.summary)
  );
}

function saveN8nAnalysisResult(
  fastify: FastifyInstance,
  job: AnalysisJobRecord,
  raw: unknown,
  options: { callbackBody?: unknown; progress?: AnalysisProgress | null } = {},
) {
  const normalized = normalizeN8nResult(raw);
  const finalProgress =
    options.progress ??
    buildProgress({
      phase: "score",
      completed: ANALYSIS_PHASES,
      message: "Analysis complete.",
    });
  const finalResponsePayload = progressPayload(raw, finalProgress);

  if (normalized.result.status === "rejected") {
    fastify.store.updateAnalysisJob(job.id, {
      status: "rejected",
      responsePayload: finalResponsePayload,
      errorCode: normalized.result.reason || "n8n_rejected",
      errorMessage: normalized.result.message || normalized.result.reason || "n8n rejected transcript",
      completedAt: new Date().toISOString(),
    });
    fastify.store.updateSession(job.sessionId, { status: "ai_rejected" });
    return;
  }

  if (normalized.result.status === "error") {
    fastify.store.updateAnalysisJob(job.id, {
      status: "failed",
      responsePayload: finalResponsePayload,
      errorCode: normalized.result.reason || "n8n_error",
      errorMessage: normalized.result.message || normalized.result.reason || "n8n analysis returned an error",
      completedAt: new Date().toISOString(),
    });
    fastify.store.updateSession(job.sessionId, { status: "ai_failed" });
    return;
  }

  const result = fastify.store.saveAnalysisResult({
    organizationId: job.organizationId,
    sessionId: job.sessionId,
    analysisJobId: job.id,
    status: normalized.result.status === "ok" ? "ok" : "error",
    n8nReceivedAt: normalized.result.received_at || null,
    meta: normalized.result.meta || {},
    summary: normalized.result.summary || {},
    rawResponse: raw,
    parseWarnings: normalized.warnings,
  });

  const scores = mapScores({
    organizationId: job.organizationId,
    sessionId: job.sessionId,
    analysisResultId: result.id,
    result: normalized.result,
  }).map((score) => fastify.store.upsertScore(score));
  const transcript = syncTranscriptFromN8nPayload(fastify, job, options.callbackBody, raw, normalized.result);
  const scoreIdByItemId = new Map(scores.map((score) => [score.ctsrItemId, score.id]));
  fastify.store.deleteAiEvidenceBySession(job.sessionId);
  mapEvidence({
    organizationId: job.organizationId,
    sessionId: job.sessionId,
    analysisResultId: result.id,
    scoreIdByItemId,
    result: normalized.result,
    transcriptTurns: transcript.turns.turns,
  }).forEach((record) => fastify.store.createEvidence(record));

  const summary = normalized.result.summary || {};
  fastify.store.updateSession(job.sessionId, {
    status: "ready_for_review",
    aiTotalScore: typeof summary.total_score === "number" ? summary.total_score : null,
    aiMeanScore: typeof summary.mean_score === "number" ? summary.mean_score : null,
  });
  fastify.store.updateAnalysisJob(job.id, {
    status: "succeeded",
    responsePayload: finalResponsePayload,
    errorCode: null,
    errorMessage: null,
    completedAt: new Date().toISOString(),
  });
}

async function runAnalysisJob(fastify: FastifyInstance, jobId: string) {
  const job = fastify.store.updateAnalysisJob(jobId, {
    status: "processing",
    attempt: fastify.store.getAnalysisJob(jobId).attempt + 1,
    startedAt: new Date().toISOString(),
  });
  updateAnalysisProgress(fastify, job, buildProgress({
    phase: "parse",
    message: "Submitting transcript to n8n.",
  }), {
    status: "processing",
  });
  fastify.store.updateSession(job.sessionId, { status: "processing" });
  const transcript = fastify.store.getTranscriptBySession(job.sessionId);
  const client = new N8nClient(
    fastify.config.N8N_WEBHOOK_URL,
    fastify.config.N8N_TRUSTED_HEADER_VALUE,
    fastify.config.N8N_BINARY_FIELD_NAME,
    fastify.config.N8N_CALLBACK_URL,
  );
  fastify.log.info({ jobId: job.id, sessionId: job.sessionId }, "Submitting analysis job to n8n");
  const raw = await client.analyzeTranscript({
    jobId: job.id,
    sessionId: job.sessionId,
    transcriptText: transcript.rawText || turnsToPlainText(transcript.turns.turns),
  });
  fastify.log.info({ jobId: job.id, sessionId: job.sessionId }, "Received n8n analysis response");
  if (!isFinalN8nResult(raw)) {
    const latestJob = fastify.store.getAnalysisJob(job.id);
    updateAnalysisProgress(fastify, latestJob, extractProgress(raw) || buildProgress({
      phase: "analyze",
      message: "n8n accepted the request; waiting for callback.",
      waitingForCallback: true,
    }), {
      status: "processing",
      errorCode: null,
      errorMessage: "n8n accepted the request; waiting for callback.",
    });
    fastify.log.info({ jobId: job.id, sessionId: job.sessionId }, "n8n accepted job; waiting for callback");
    return;
  }

  saveN8nAnalysisResult(fastify, job, raw);
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nestedString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = stringFromUnknown(record[key]);
    if (value) return value;
  }
  const meta = isRecord(record.meta) ? record.meta : null;
  if (!meta) return null;
  for (const key of keys) {
    const value = stringFromUnknown(meta[key]);
    if (value) return value;
  }
  return null;
}

const TRANSCRIPT_TEXT_KEYS = [
  "transcript_text",
  "transcriptText",
  "full_transcript",
  "fullTranscript",
  "raw_transcript",
  "rawTranscript",
  "redacted_transcript_text",
  "redactedTranscriptText",
];

const REDACTED_TRANSCRIPT_TEXT_KEYS = ["redacted_transcript_text", "redactedTranscriptText"];

function stringFromNestedRecord(record: Record<string, unknown>, keys: string[]): string | null {
  const direct = nestedString(record, keys);
  if (direct) return direct;
  for (const key of ["body", "data", "output", "result", "payload"]) {
    const child = record[key];
    if (isRecord(child)) {
      const nested = nestedString(child, keys);
      if (nested) return nested;
    }
  }
  return null;
}

function extractStringFromSources(keys: string[], ...sources: unknown[]): string | null {
  for (const source of sources) {
    const value = Array.isArray(source) ? source[0] : source;
    if (!isRecord(value)) continue;
    const found = stringFromNestedRecord(value, keys);
    if (found) return found;
  }
  return null;
}

function syncTranscriptFromN8nPayload(
  fastify: FastifyInstance,
  job: AnalysisJobRecord,
  ...payloadSources: unknown[]
) {
  const transcript = fastify.store.getTranscriptBySession(job.sessionId);
  const transcriptText = extractStringFromSources(TRANSCRIPT_TEXT_KEYS, ...payloadSources);
  if (!transcriptText) return transcript;

  const turns = parseTranscriptTurns(transcriptText);
  if (turns.length === 0) return transcript;

  return fastify.store.updateTranscript(transcript.id, {
    turns: {
      schemaVersion: 1,
      source: "n8n_callback",
      turns,
    },
    rawText: transcriptText,
    redactedText: extractStringFromSources(REDACTED_TRANSCRIPT_TEXT_KEYS, ...payloadSources) || transcript.redactedText || null,
    wordCount: countWords(transcriptText),
    charCount: transcriptText.length,
  });
}

function callbackHeaderValue(request: FastifyRequest) {
  const header = request.headers["x-is-trusted"];
  return Array.isArray(header) ? header[0] : header;
}

function requireTrustedN8nCallback(fastify: FastifyInstance, request: FastifyRequest) {
  if (callbackHeaderValue(request) !== fastify.config.N8N_TRUSTED_HEADER_VALUE) {
    throw new UnauthorizedError("Invalid n8n callback trust header");
  }
}

function resolveCallbackJob(fastify: FastifyInstance, rawBody: unknown) {
  const body = Array.isArray(rawBody) ? rawBody[0] : rawBody;
  if (!isRecord(body)) {
    throw new ValidationError("n8n callback body must be an object");
  }

  const result = body.result ?? body.data ?? body.output ?? body;
  const resultRecord = isRecord(result) ? result : {};
  const jobId =
    nestedString(body, ["job_id", "jobId", "analysis_job_id", "analysisJobId"]) ||
    nestedString(resultRecord, ["job_id", "jobId", "analysis_job_id", "analysisJobId"]);

  if (jobId) {
    return { job: fastify.store.getAnalysisJob(jobId), result, body };
  }

  const sessionId =
    nestedString(body, ["session_id", "sessionId"]) ||
    nestedString(resultRecord, ["session_id", "sessionId"]);

  if (!sessionId) {
    throw new ValidationError("n8n callback must include job_id or session_id");
  }

  const job = fastify.store
    .listAnalysisJobs(sessionId)
    .find((item) => item.status === "processing" || item.status === "pending");
  if (!job) {
    throw new ValidationError("No pending analysis job found for callback session");
  }
  return { job, result, body };
}

export const analysisRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/integrations/n8n/analysis-results",
    {
      schema: {
        tags: ["AI Analysis"],
        operationId: "receiveN8nAnalysisResult",
        summary: "Receive final n8n analysis result callback",
        body: {
          anyOf: [
            { type: "object", additionalProperties: true },
            { type: "array", items: { type: "object", additionalProperties: true } },
          ],
        },
        response: {
          200: {
            type: "object",
            properties: {
              data: {
                type: "object",
                properties: {
                  jobId: { type: "string", format: "uuid" },
                  sessionId: { type: "string", format: "uuid" },
                  status: { type: "string" },
                },
              },
              meta: { type: "object" },
            },
          },
          ...standardErrors,
        },
      },
    },
    async (request) => {
      requireTrustedN8nCallback(fastify, request);
      const { job, result, body } = resolveCallbackJob(fastify, request.body);
      const progress = extractProgress(body, result);
      if (!isFinalN8nResult(result)) {
        if (!progress) {
          throw new ValidationError("n8n callback does not contain a final analysis result or progress phase");
        }
        syncTranscriptFromN8nPayload(fastify, job, body, result);
        const updated = updateAnalysisProgress(fastify, job, progress, {
          status: "processing",
          errorCode: null,
          errorMessage: null,
        });
        fastify.store.updateSession(job.sessionId, { status: "processing" });
        fastify.log.info({ jobId: job.id, sessionId: job.sessionId, phase: progress.phase }, "Received n8n progress callback");
        return ok(request, { jobId: job.id, sessionId: job.sessionId, status: updated.status, phase: progress.phase });
      }
      saveN8nAnalysisResult(fastify, job, result, { callbackBody: body, progress });
      const updated = fastify.store.getAnalysisJob(job.id);
      fastify.log.info({ jobId: job.id, sessionId: job.sessionId }, "Received n8n analysis callback");
      return ok(request, { jobId: job.id, sessionId: job.sessionId, status: updated.status });
    },
  );

  fastify.post(
    "/sessions/:sessionId/analysis-jobs",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["AI Analysis"],
        operationId: "createAnalysisJob",
        summary: "Create an AI analysis job for a session transcript",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        response: {
          202: {
            type: "object",
            properties: {
              data: {
                type: "object",
                properties: {
                  jobId: { type: "string", format: "uuid" },
                  sessionId: { type: "string", format: "uuid" },
                  status: { type: "string" },
                  pollUrl: { type: "string" },
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
      const sessionId = (request.params as { sessionId: string }).sessionId;
      const job = fastify.store.createAnalysisJob(request.authUser!.organizationId, sessionId);
      if (fastify.config.RUN_ANALYSIS_INLINE) {
        try {
          await runAnalysisJob(fastify, job.id);
        } catch (error) {
          if (error instanceof N8nWebhookTimeoutError) {
            holdAnalysisJobForCallback(fastify, job.id, error);
          } else {
            failAnalysisJob(fastify, job.id, error);
            throw error;
          }
        }
      } else {
        queueAnalysisJob(fastify, job.id);
      }
      reply.status(202).send(ok(request, { jobId: job.id, sessionId, status: job.status, pollUrl: `/api/v1/analysis-jobs/${job.id}` }));
    },
  );

  fastify.get(
    "/sessions/:sessionId/analysis-jobs",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["AI Analysis"],
        operationId: "listAnalysisJobs",
        summary: "List analysis jobs for a session",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        response: { 200: { type: "object", properties: { data: { type: "array", items: analysisJobSchema }, pageInfo: { type: "object" }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) =>
      paginated(
        request,
        fastify.store.listAnalysisJobs((request.params as { sessionId: string }).sessionId).map(serializeAnalysisJob),
        100,
        null,
      ),
  );

  fastify.get(
    "/analysis-jobs/:id",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["AI Analysis"],
        operationId: "getAnalysisJob",
        summary: "Get analysis job status",
        security: [{ bearerAuth: [] }],
        params: uuidParamSchema,
        response: { 200: { type: "object", properties: { data: analysisJobSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => ok(request, serializeAnalysisJob(fastify.store.getAnalysisJob((request.params as { id: string }).id))),
  );

  fastify.post(
    "/analysis-jobs/:id/cancel",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["AI Analysis"],
        operationId: "cancelAnalysisJob",
        summary: "Cancel a pending analysis job",
        security: [{ bearerAuth: [] }],
        params: uuidParamSchema,
        response: { 200: { type: "object", properties: { data: analysisJobSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) =>
      ok(request, serializeAnalysisJob(fastify.store.updateAnalysisJob((request.params as { id: string }).id, { status: "cancelled" }))),
  );

  fastify.post(
    "/analysis-jobs/:id/retry",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["AI Analysis"],
        operationId: "retryAnalysisJob",
        summary: "Retry a failed or rejected analysis job",
        security: [{ bearerAuth: [] }],
        params: uuidParamSchema,
        response: { 202: { type: "object", properties: { data: analysisJobSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request, reply) => {
      const oldJob = fastify.store.getAnalysisJob((request.params as { id: string }).id);
      const job = fastify.store.createAnalysisJob(oldJob.organizationId, oldJob.sessionId);
      if (fastify.config.RUN_ANALYSIS_INLINE) {
        try {
          await runAnalysisJob(fastify, job.id);
        } catch (error) {
          if (error instanceof N8nWebhookTimeoutError) {
            holdAnalysisJobForCallback(fastify, job.id, error);
          } else {
            failAnalysisJob(fastify, job.id, error);
            throw error;
          }
        }
      } else {
        queueAnalysisJob(fastify, job.id);
      }
      reply.status(202).send(ok(request, serializeAnalysisJob(fastify.store.getAnalysisJob(job.id))));
    },
  );

  fastify.get(
    "/sessions/:sessionId/analysis-result",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["AI Analysis"],
        operationId: "getLatestAnalysisResult",
        summary: "Get latest normalized AI analysis result",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        response: { 200: { type: "object", properties: { data: analysisResultSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const sessionId = (request.params as { sessionId: string }).sessionId;
      const result = fastify.store.getLatestAnalysisResult(sessionId);
      return ok(request, {
        id: result.id,
        sessionId,
        status: result.status,
        meta: result.meta,
        summary: result.summary,
        items: fastify.store.listScores(sessionId),
        evidence: fastify.store.listEvidence(sessionId),
      });
    },
  );

  fastify.get(
    "/sessions/:sessionId/analysis-result/raw",
    {
      preHandler: [fastify.authorize(["admin", "supervisor"])],
      schema: {
        tags: ["AI Analysis"],
        operationId: "getRawAnalysisResult",
        summary: "Get raw n8n analysis response for debugging",
        security: [{ bearerAuth: [] }],
        params: sessionParamSchema,
        response: { 200: { type: "object", properties: { data: { type: "object", additionalProperties: true }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const result = fastify.store.getLatestAnalysisResult((request.params as { sessionId: string }).sessionId);
      return ok(request, { rawResponse: result.rawResponse, parseWarnings: result.parseWarnings });
    },
  );
};
