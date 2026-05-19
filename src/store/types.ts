export type Role = "admin" | "supervisor" | "therapist" | "viewer";
export type SessionStatus =
  | "draft"
  | "uploaded"
  | "queued"
  | "processing"
  | "ai_rejected"
  | "ai_failed"
  | "ready_for_review"
  | "review_in_progress"
  | "scoring"
  | "scored"
  | "signed_off"
  | "archived";

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UserRecord {
  id: string;
  organizationId: string;
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
  status: "active" | "invited" | "disabled";
  affiliation?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string | null;
}

export interface RefreshTokenRecord {
  tokenHash: string;
  userId: string;
  familyId: string;
  expiresAt: string;
  revokedAt?: string | null;
  createdAt: string;
}

export interface ClientRecord {
  id: string;
  organizationId: string;
  clientCode: string;
  displayLabel: string;
  riskLevel?: string | null;
  metadata: Record<string, unknown>;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaseRecord {
  id: string;
  organizationId: string;
  clientId: string;
  primaryTherapistId?: string | null;
  caseCode?: string | null;
  modality?: string | null;
  presentingProblem?: string | null;
  status: "active" | "closed" | "archived";
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  displayCode: string;
  organizationId: string;
  caseId?: string | null;
  clientId?: string | null;
  caseAlias?: string | null;
  therapistName?: string | null;
  supervisorId: string;
  sessionNumber?: string | null;
  sessionDate?: string | null;
  shortDescription?: string | null;
  durationSeconds?: number | null;
  status: SessionStatus;
  aiTotalScore?: number | null;
  aiMeanScore?: number | null;
  finalTotalScore?: number | null;
  finalMeanScore?: number | null;
  kappa?: number | null;
  submittedAt?: string | null;
  signedOffAt?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptTurn {
  turnNo: number;
  speaker: "Therapist" | "Client" | "Unknown";
  speakerLabel?: string;
  timestamp?: string | null;
  startSeconds?: number | null;
  endSeconds?: number | null;
  text: string;
}

export interface TranscriptRecord {
  id: string;
  organizationId: string;
  sessionId: string;
  sourceFileName: string;
  sourceMimeType: string;
  sourceFileSizeBytes: number;
  sourceFileSha256: string;
  turns: {
    schemaVersion: number;
    source: string;
    turns: TranscriptTurn[];
  };
  rawText?: string | null;
  redactedText?: string | null;
  language?: string | null;
  wordCount: number;
  charCount: number;
  schemaVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisJobRecord {
  id: string;
  organizationId: string;
  sessionId: string;
  transcriptId: string;
  provider: "n8n";
  status: "pending" | "processing" | "succeeded" | "rejected" | "failed" | "cancelled";
  attempt: number;
  maxAttempts: number;
  requestPayload: Record<string, unknown>;
  responsePayload?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisResultRecord {
  id: string;
  organizationId: string;
  sessionId: string;
  analysisJobId: string;
  resultVersion: number;
  status: "ok" | "rejected" | "error";
  n8nReceivedAt?: string | null;
  meta: Record<string, unknown>;
  summary: Record<string, unknown>;
  rawResponse: unknown;
  parseWarnings: string[];
  createdAt: string;
}

export interface ScoreRecord {
  id: string;
  organizationId: string;
  sessionId: string;
  analysisResultId?: string | null;
  ctsrItemId: number;
  aiScore?: number | null;
  aiAnchorLabel?: string | null;
  aiReasoning?: string | null;
  aiEvidenceReview?: string | null;
  finalScore?: number | null;
  finalAnchorLabel?: string | null;
  supervisorComment?: string | null;
  status: "ai_suggested" | "reviewed" | "confirmed" | "overridden";
  confirmedBy?: string | null;
  confirmedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceRecord {
  id: string;
  organizationId: string;
  sessionId: string;
  analysisResultId?: string | null;
  scoreId?: string | null;
  ctsrItemId: number;
  transcriptTurnNo?: number | null;
  speaker: "Therapist" | "Client" | "Unknown";
  quoteText: string;
  timestampLabel?: string | null;
  timestampSeconds?: number | null;
  polarity: "positive" | "negative" | "neutral";
  source: "ai" | "manual";
  status: "suggested" | "confirmed" | "rejected" | "manual";
  reviewNote?: string | null;
  createdBy?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackRecord {
  sessionId: string;
  strengths: string;
  growthAreas: string;
  suggestions: string;
  overallComment?: string | null;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportRecord {
  id: string;
  organizationId: string;
  sessionId: string;
  format: "pdf" | "docx";
  status: "pending" | "generated" | "failed";
  includedSections: Record<string, boolean>;
  storageKey?: string | null;
  fileName?: string | null;
  fileSizeBytes?: number | null;
  generatedBy: string;
  generatedAt?: string | null;
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  createdAt: string;
}

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  name: string;
}
