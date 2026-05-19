import { isoDateTimeSchema, nullableDateTimeSchema } from "./common";

export const userSchema = {
  type: "object",
  required: ["id", "organizationId", "email", "name", "role", "status", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    organizationId: { type: "string", format: "uuid" },
    email: { type: "string", format: "email" },
    name: { type: "string" },
    role: { type: "string", enum: ["admin", "supervisor", "therapist", "viewer"] },
    status: { type: "string", enum: ["active", "invited", "disabled"] },
    affiliation: { type: ["string", "null"] },
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    lastLoginAt: nullableDateTimeSchema,
  },
} as const;

export const clientSchema = {
  type: "object",
  required: ["id", "organizationId", "clientCode", "displayLabel", "metadata", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    organizationId: { type: "string", format: "uuid" },
    clientCode: { type: "string" },
    displayLabel: { type: "string" },
    riskLevel: { type: ["string", "null"] },
    metadata: { type: "object", additionalProperties: true },
    archivedAt: nullableDateTimeSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  },
} as const;

export const caseSchema = {
  type: "object",
  required: ["id", "organizationId", "clientId", "status", "metadata", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    organizationId: { type: "string", format: "uuid" },
    clientId: { type: "string", format: "uuid" },
    primaryTherapistId: { type: ["string", "null"], format: "uuid" },
    caseCode: { type: ["string", "null"] },
    modality: { type: ["string", "null"] },
    presentingProblem: { type: ["string", "null"] },
    status: { type: "string", enum: ["active", "closed", "archived"] },
    metadata: { type: "object", additionalProperties: true },
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  },
} as const;

export const sessionSchema = {
  type: "object",
  required: ["id", "displayCode", "organizationId", "supervisorId", "status", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    displayCode: { type: "string" },
    organizationId: { type: "string", format: "uuid" },
    caseId: { type: ["string", "null"], format: "uuid" },
    clientId: { type: ["string", "null"], format: "uuid" },
    caseAlias: { type: ["string", "null"] },
    therapistName: { type: ["string", "null"] },
    supervisorId: { type: "string", format: "uuid" },
    sessionNumber: { type: ["string", "null"], pattern: "^[0-9]+$" },
    sessionDate: { type: ["string", "null"], format: "date" },
    shortDescription: { type: ["string", "null"] },
    durationSeconds: { type: ["integer", "null"] },
    status: {
      type: "string",
      enum: [
        "draft",
        "uploaded",
        "queued",
        "processing",
        "ai_rejected",
        "ai_failed",
        "ready_for_review",
        "review_in_progress",
        "scoring",
        "scored",
        "signed_off",
        "archived",
      ],
    },
    aiTotalScore: { type: ["integer", "null"] },
    aiMeanScore: { type: ["number", "null"] },
    finalTotalScore: { type: ["integer", "null"] },
    finalMeanScore: { type: ["number", "null"] },
    kappa: { type: ["number", "null"] },
    submittedAt: nullableDateTimeSchema,
    signedOffAt: nullableDateTimeSchema,
    archivedAt: nullableDateTimeSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  },
} as const;

export const transcriptTurnSchema = {
  type: "object",
  required: ["turnNo", "speaker", "text"],
  properties: {
    turnNo: { type: "integer" },
    speaker: { type: "string", enum: ["Therapist", "Client", "Unknown"] },
    speakerLabel: { type: ["string", "null"] },
    timestamp: { type: ["string", "null"] },
    startSeconds: { type: ["integer", "null"] },
    endSeconds: { type: ["integer", "null"] },
    text: { type: "string" },
  },
} as const;

export const transcriptSchema = {
  type: "object",
  required: ["id", "organizationId", "sessionId", "sourceFileName", "wordCount", "charCount", "turns"],
  properties: {
    id: { type: "string", format: "uuid" },
    organizationId: { type: "string", format: "uuid" },
    sessionId: { type: "string", format: "uuid" },
    sourceFileName: { type: "string" },
    sourceMimeType: { type: "string" },
    sourceFileSizeBytes: { type: "integer" },
    sourceFileSha256: { type: "string" },
    wordCount: { type: "integer" },
    charCount: { type: "integer" },
    language: { type: ["string", "null"] },
    turns: { type: "array", items: transcriptTurnSchema },
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  },
} as const;

export const analysisJobSchema = {
  type: "object",
  required: ["id", "organizationId", "sessionId", "transcriptId", "provider", "status", "attempt", "maxAttempts", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    organizationId: { type: "string", format: "uuid" },
    sessionId: { type: "string", format: "uuid" },
    transcriptId: { type: "string", format: "uuid" },
    provider: { type: "string", enum: ["n8n"] },
    status: { type: "string", enum: ["pending", "processing", "succeeded", "rejected", "failed", "cancelled"] },
    attempt: { type: "integer" },
    maxAttempts: { type: "integer" },
    progress: {
      type: ["object", "null"],
      properties: {
        phase: { type: "string", enum: ["parse", "speakers", "analyze", "highlight", "score"] },
        completed: {
          type: "array",
          items: { type: "string", enum: ["parse", "speakers", "analyze", "highlight", "score"] },
        },
        message: { type: ["string", "null"] },
        waitingForCallback: { type: ["boolean", "null"] },
        updatedAt: isoDateTimeSchema,
      },
      additionalProperties: true,
    },
    errorCode: { type: ["string", "null"] },
    errorMessage: { type: ["string", "null"] },
    startedAt: nullableDateTimeSchema,
    completedAt: nullableDateTimeSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  },
} as const;

export const evidenceSchema = {
  type: "object",
  required: ["id", "organizationId", "sessionId", "ctsrItemId", "speaker", "quoteText", "polarity", "source", "status", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    organizationId: { type: "string", format: "uuid" },
    sessionId: { type: "string", format: "uuid" },
    analysisResultId: { type: ["string", "null"], format: "uuid" },
    scoreId: { type: ["string", "null"], format: "uuid" },
    ctsrItemId: { type: "integer", minimum: 1, maximum: 12 },
    transcriptTurnNo: { type: ["integer", "null"] },
    speaker: { type: "string", enum: ["Therapist", "Client", "Unknown"] },
    quoteText: { type: "string" },
    timestampLabel: { type: ["string", "null"] },
    timestampSeconds: { type: ["integer", "null"] },
    polarity: { type: "string", enum: ["positive", "negative", "neutral"] },
    source: { type: "string", enum: ["ai", "manual"] },
    status: { type: "string", enum: ["suggested", "confirmed", "rejected", "manual"] },
    reviewNote: { type: ["string", "null"] },
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  },
} as const;

export const scoreSchema = {
  type: "object",
  required: ["id", "organizationId", "sessionId", "ctsrItemId", "status", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    organizationId: { type: "string", format: "uuid" },
    sessionId: { type: "string", format: "uuid" },
    analysisResultId: { type: ["string", "null"], format: "uuid" },
    ctsrItemId: { type: "integer", minimum: 1, maximum: 12 },
    aiScore: { type: ["integer", "null"], minimum: 0, maximum: 6 },
    aiAnchorLabel: { type: ["string", "null"] },
    aiReasoning: { type: ["string", "null"] },
    aiEvidenceReview: { type: ["string", "null"] },
    finalScore: { type: ["integer", "null"], minimum: 0, maximum: 6 },
    finalAnchorLabel: { type: ["string", "null"] },
    supervisorComment: { type: ["string", "null"] },
    status: { type: "string", enum: ["ai_suggested", "reviewed", "confirmed", "overridden"] },
    confirmedAt: nullableDateTimeSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  },
} as const;

export const reportSchema = {
  type: "object",
  required: ["id", "organizationId", "sessionId", "format", "status", "includedSections", "generatedBy", "createdAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    organizationId: { type: "string", format: "uuid" },
    sessionId: { type: "string", format: "uuid" },
    format: { type: "string", enum: ["pdf", "docx"] },
    status: { type: "string", enum: ["pending", "generated", "failed"] },
    includedSections: { type: "object", additionalProperties: { type: "boolean" } },
    storageKey: { type: ["string", "null"] },
    fileName: { type: ["string", "null"] },
    fileSizeBytes: { type: ["integer", "null"] },
    generatedBy: { type: "string", format: "uuid" },
    generatedAt: nullableDateTimeSchema,
    createdAt: isoDateTimeSchema,
  },
} as const;
