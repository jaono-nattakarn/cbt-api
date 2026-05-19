import bcrypt from "bcryptjs";
import { addDays, createOpaqueToken, createPublicId, nowIso, sha256 } from "../utils/ids";
import { NotFoundError, UnauthorizedError, ValidationError } from "../utils/errors";
import { anchorLabel } from "../modules/ctsr/ctsr.data";
import type {
  AnalysisJobRecord,
  AnalysisResultRecord,
  AuditLogRecord,
  CaseRecord,
  ClientRecord,
  EvidenceRecord,
  FeedbackRecord,
  OrganizationRecord,
  RefreshTokenRecord,
  ReportRecord,
  Role,
  ScoreRecord,
  SessionRecord,
  SessionStatus,
  TranscriptRecord,
  UserRecord,
} from "./types";

export class MemoryStore {
  organizations = new Map<string, OrganizationRecord>();
  users = new Map<string, UserRecord>();
  refreshTokens = new Map<string, RefreshTokenRecord>();
  clients = new Map<string, ClientRecord>();
  cases = new Map<string, CaseRecord>();
  sessions = new Map<string, SessionRecord>();
  transcripts = new Map<string, TranscriptRecord>();
  analysisJobs = new Map<string, AnalysisJobRecord>();
  analysisResults = new Map<string, AnalysisResultRecord>();
  scores = new Map<string, ScoreRecord>();
  evidence = new Map<string, EvidenceRecord>();
  feedback = new Map<string, FeedbackRecord>();
  reports = new Map<string, ReportRecord>();
  auditLogs = new Map<string, AuditLogRecord>();

  async seed(): Promise<void> {
    if (this.users.size > 0) return;
    const now = nowIso();
    const organization: OrganizationRecord = {
      id: createPublicId(),
      name: "CBT Lab",
      slug: "cbt-lab",
      status: "active",
      settings: {},
      createdAt: now,
      updatedAt: now,
    };
    this.organizations.set(organization.id, organization);

    const supervisor: UserRecord = {
      id: createPublicId(),
      organizationId: organization.id,
      email: "supervisor@thera.app",
      passwordHash: await bcrypt.hash("demo1234", 10),
      name: "Dr. Wattana",
      role: "supervisor",
      status: "active",
      affiliation: "CBT Lab",
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    };
    this.users.set(supervisor.id, supervisor);
  }

  getUserById(id: string): UserRecord {
    const user = this.users.get(id);
    if (!user) throw new NotFoundError("User");
    return user;
  }

  findUserByEmail(email: string): UserRecord | undefined {
    const normalized = email.trim().toLowerCase();
    return [...this.users.values()].find((user) => user.email === normalized);
  }

  async registerUser(input: {
    organizationId?: string;
    organizationName?: string;
    name: string;
    email: string;
    password: string;
    role?: Role;
  }): Promise<UserRecord> {
    const email = input.email.trim().toLowerCase();
    if (this.findUserByEmail(email)) {
      throw new ValidationError("Email already exists");
    }

    const now = nowIso();
    let organization = input.organizationId
      ? this.organizations.get(input.organizationId)
      : undefined;
    if (!organization) {
      const name = input.organizationName?.trim() || "CBT Lab";
      const baseSlug = (name || "cbt-lab")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "cbt-lab";
      const existingSlugs = new Set(
        [...this.organizations.values()].map((org) => org.slug),
      );
      let slug = baseSlug;
      let suffix = 2;
      while (existingSlugs.has(slug)) {
        slug = `${baseSlug}-${suffix++}`;
      }
      organization = {
        id: createPublicId(),
        name,
        slug,
        status: "active",
        settings: {},
        createdAt: now,
        updatedAt: now,
      };
      this.organizations.set(organization.id, organization);
    }

    const user: UserRecord = {
      id: createPublicId(),
      organizationId: organization.id,
      email,
      passwordHash: await bcrypt.hash(input.password, 10),
      name: input.name.trim(),
      role: input.role || "supervisor",
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    };
    this.users.set(user.id, user);
    return user;
  }

  async verifyLogin(email: string, password: string): Promise<UserRecord> {
    const user = this.findUserByEmail(email);
    if (!user || user.status !== "active") throw new UnauthorizedError("Invalid credentials");
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedError("Invalid credentials");
    user.lastLoginAt = nowIso();
    user.updatedAt = nowIso();
    return user;
  }

  issueRefreshToken(userId: string, days: number): { token: string; record: RefreshTokenRecord } {
    const token = createOpaqueToken();
    const record: RefreshTokenRecord = {
      tokenHash: sha256(token),
      userId,
      familyId: createPublicId(),
      expiresAt: addDays(new Date(), days).toISOString(),
      revokedAt: null,
      createdAt: nowIso(),
    };
    this.refreshTokens.set(record.tokenHash, record);
    return { token, record };
  }

  rotateRefreshToken(token: string, days: number): { user: UserRecord; token: string } {
    const tokenHash = sha256(token);
    const record = this.refreshTokens.get(tokenHash);
    if (!record || record.revokedAt || new Date(record.expiresAt) <= new Date()) {
      throw new UnauthorizedError("Invalid refresh token");
    }
    record.revokedAt = nowIso();
    const user = this.getUserById(record.userId);
    const next = this.issueRefreshToken(user.id, days);
    next.record.familyId = record.familyId;
    return { user, token: next.token };
  }

  revokeRefreshToken(token: string): void {
    const record = this.refreshTokens.get(sha256(token));
    if (record) record.revokedAt = nowIso();
  }

  revokeUserRefreshTokens(userId: string): void {
    for (const record of this.refreshTokens.values()) {
      if (record.userId === userId) record.revokedAt = nowIso();
    }
  }

  listUsers(organizationId: string, role?: Role): UserRecord[] {
    return [...this.users.values()]
      .filter((user) => user.organizationId === organizationId)
      .filter((user) => !role || user.role === role)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  updateUser(id: string, patch: Partial<Pick<UserRecord, "name" | "role" | "status" | "affiliation">>): UserRecord {
    const user = this.getUserById(id);
    Object.assign(user, patch, { updatedAt: nowIso() });
    return user;
  }

  createClient(organizationId: string, input: { clientCode: string; displayLabel?: string; riskLevel?: string | null }): ClientRecord {
    const now = nowIso();
    const client: ClientRecord = {
      id: createPublicId(),
      organizationId,
      clientCode: input.clientCode,
      displayLabel: input.displayLabel || input.clientCode,
      riskLevel: input.riskLevel || null,
      metadata: {},
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.clients.set(client.id, client);
    return client;
  }

  listClients(organizationId: string, q?: string): ClientRecord[] {
    return [...this.clients.values()]
      .filter((client) => client.organizationId === organizationId)
      .filter((client) => !q || `${client.clientCode} ${client.displayLabel}`.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getClient(id: string): ClientRecord {
    const client = this.clients.get(id);
    if (!client) throw new NotFoundError("Client");
    return client;
  }

  updateClient(id: string, patch: Partial<Pick<ClientRecord, "displayLabel" | "riskLevel" | "metadata" | "archivedAt">>): ClientRecord {
    const client = this.getClient(id);
    Object.assign(client, patch, { updatedAt: nowIso() });
    return client;
  }

  createCase(organizationId: string, clientId: string, input: Partial<CaseRecord>): CaseRecord {
    this.getClient(clientId);
    const now = nowIso();
    const record: CaseRecord = {
      id: createPublicId(),
      organizationId,
      clientId,
      primaryTherapistId: input.primaryTherapistId || null,
      caseCode: input.caseCode || null,
      modality: input.modality || null,
      presentingProblem: input.presentingProblem || null,
      status: "active",
      metadata: input.metadata || {},
      createdAt: now,
      updatedAt: now,
    };
    this.cases.set(record.id, record);
    return record;
  }

  listCases(organizationId: string, clientId?: string): CaseRecord[] {
    return [...this.cases.values()]
      .filter((record) => record.organizationId === organizationId)
      .filter((record) => !clientId || record.clientId === clientId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getCase(id: string): CaseRecord {
    const record = this.cases.get(id);
    if (!record) throw new NotFoundError("Case");
    return record;
  }

  updateCase(id: string, patch: Partial<CaseRecord>): CaseRecord {
    const record = this.getCase(id);
    Object.assign(record, patch, { updatedAt: nowIso() });
    return record;
  }

  createSession(organizationId: string, supervisorId: string, input: Partial<SessionRecord>): SessionRecord {
    const now = nowIso();
    const existingCodes = new Set(
      [...this.sessions.values()].map((session) => session.displayCode),
    );
    let counter = this.sessions.size + 1;
    let displayCode = `S-${String(1000 + counter)}`;
    while (existingCodes.has(displayCode)) {
      counter += 1;
      displayCode = `S-${String(1000 + counter)}`;
    }
    const session: SessionRecord = {
      id: createPublicId(),
      displayCode,
      organizationId,
      caseId: input.caseId || null,
      clientId: input.clientId || null,
      caseAlias: input.caseAlias?.trim() || null,
      therapistName: input.therapistName?.trim() || null,
      supervisorId,
      sessionNumber: input.sessionNumber || null,
      sessionDate: input.sessionDate || null,
      shortDescription: input.shortDescription || null,
      durationSeconds: input.durationSeconds || null,
      status: "draft",
      aiTotalScore: null,
      aiMeanScore: null,
      finalTotalScore: null,
      finalMeanScore: null,
      kappa: null,
      submittedAt: null,
      signedOffAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  listSessions(organizationId: string, filters: { status?: SessionStatus; q?: string } = {}): SessionRecord[] {
    return [...this.sessions.values()]
      .filter((session) => session.organizationId === organizationId)
      .filter((session) => !filters.status || session.status === filters.status)
      .filter((session) => {
        if (!filters.q) return true;
        return [
          session.displayCode,
          session.caseAlias,
          session.therapistName,
          session.sessionNumber,
          session.shortDescription,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(filters.q.toLowerCase());
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listTherapistNames(organizationId: string, q?: string): string[] {
    const search = q?.trim().toLowerCase();
    return [...new Set(
      [...this.sessions.values()]
        .filter((session) => session.organizationId === organizationId)
        .map((session) => session.therapistName?.trim())
        .filter((name): name is string => Boolean(name))
        .filter((name) => !search || name.toLowerCase().includes(search)),
    )]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 20);
  }

  getSession(id: string): SessionRecord {
    const session = this.sessions.get(id);
    if (!session) throw new NotFoundError("Session");
    return session;
  }

  updateSession(id: string, patch: Partial<SessionRecord>): SessionRecord {
    const session = this.getSession(id);
    Object.assign(session, patch, { updatedAt: nowIso() });
    return session;
  }

  upsertTranscript(input: Omit<TranscriptRecord, "id" | "createdAt" | "updatedAt">): TranscriptRecord {
    const existing = [...this.transcripts.values()].find((transcript) => transcript.sessionId === input.sessionId);
    const now = nowIso();
    const record: TranscriptRecord = {
      ...input,
      id: existing?.id || createPublicId(),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.transcripts.set(record.id, record);
    this.updateSession(input.sessionId, { status: "uploaded" });
    return record;
  }

  updateTranscript(id: string, patch: Partial<TranscriptRecord>): TranscriptRecord {
    const transcript = this.transcripts.get(id);
    if (!transcript) throw new NotFoundError("Transcript");
    Object.assign(transcript, patch, { id, updatedAt: nowIso() });
    this.transcripts.set(id, transcript);
    return transcript;
  }

  getTranscriptBySession(sessionId: string): TranscriptRecord {
    const transcript = [...this.transcripts.values()].find((item) => item.sessionId === sessionId);
    if (!transcript) throw new NotFoundError("Transcript");
    return transcript;
  }

  deleteTranscriptBySession(sessionId: string): void {
    const transcript = this.getTranscriptBySession(sessionId);
    this.transcripts.delete(transcript.id);
    this.updateSession(sessionId, { status: "draft" });
  }

  createAnalysisJob(organizationId: string, sessionId: string): AnalysisJobRecord {
    const transcript = this.getTranscriptBySession(sessionId);
    const now = nowIso();
    const job: AnalysisJobRecord = {
      id: createPublicId(),
      organizationId,
      sessionId,
      transcriptId: transcript.id,
      provider: "n8n",
      status: "pending",
      attempt: 0,
      maxAttempts: 3,
      requestPayload: { sessionId, transcriptId: transcript.id },
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.analysisJobs.set(job.id, job);
    this.updateSession(sessionId, { status: "queued" });
    return job;
  }

  listAnalysisJobs(sessionId: string): AnalysisJobRecord[] {
    return [...this.analysisJobs.values()]
      .filter((job) => job.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getAnalysisJob(id: string): AnalysisJobRecord {
    const job = this.analysisJobs.get(id);
    if (!job) throw new NotFoundError("Analysis job");
    return job;
  }

  updateAnalysisJob(id: string, patch: Partial<AnalysisJobRecord>): AnalysisJobRecord {
    const job = this.getAnalysisJob(id);
    Object.assign(job, patch, { updatedAt: nowIso() });
    return job;
  }

  saveAnalysisResult(input: Omit<AnalysisResultRecord, "id" | "createdAt" | "resultVersion">): AnalysisResultRecord {
    const version =
      [...this.analysisResults.values()].filter((result) => result.sessionId === input.sessionId).length + 1;
    const result: AnalysisResultRecord = {
      ...input,
      id: createPublicId(),
      resultVersion: version,
      createdAt: nowIso(),
    };
    this.analysisResults.set(result.id, result);
    return result;
  }

  getLatestAnalysisResult(sessionId: string): AnalysisResultRecord {
    const result = [...this.analysisResults.values()]
      .filter((item) => item.sessionId === sessionId)
      .sort((a, b) => b.resultVersion - a.resultVersion)[0];
    if (!result) throw new NotFoundError("Analysis result");
    return result;
  }

  upsertScore(input: Omit<ScoreRecord, "id" | "createdAt" | "updatedAt">): ScoreRecord {
    const existing = [...this.scores.values()].find(
      (score) => score.sessionId === input.sessionId && score.ctsrItemId === input.ctsrItemId,
    );
    const now = nowIso();
    const record: ScoreRecord = {
      ...input,
      id: existing?.id || createPublicId(),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.scores.set(record.id, record);
    return record;
  }

  listScores(sessionId: string): ScoreRecord[] {
    return [...this.scores.values()]
      .filter((score) => score.sessionId === sessionId)
      .sort((a, b) => a.ctsrItemId - b.ctsrItemId);
  }

  updateScore(sessionId: string, itemId: number, patch: Partial<ScoreRecord>): ScoreRecord {
    const score = this.listScores(sessionId).find((item) => item.ctsrItemId === itemId);
    if (!score) {
      const session = this.getSession(sessionId);
      return this.upsertScore({
        organizationId: session.organizationId,
        sessionId,
        analysisResultId: null,
        ctsrItemId: itemId,
        aiScore: null,
        aiAnchorLabel: null,
        aiReasoning: null,
        aiEvidenceReview: null,
        finalScore: patch.finalScore ?? null,
        finalAnchorLabel: anchorLabel(patch.finalScore),
        supervisorComment: patch.supervisorComment ?? null,
        status: patch.status || "reviewed",
        confirmedBy: patch.confirmedBy ?? null,
        confirmedAt: patch.confirmedAt ?? null,
      });
    }
    Object.assign(score, patch, {
      finalAnchorLabel: patch.finalScore !== undefined ? anchorLabel(patch.finalScore) : score.finalAnchorLabel,
      updatedAt: nowIso(),
    });
    return score;
  }

  recomputeFinalTotals(sessionId: string): SessionRecord {
    const scores = this.listScores(sessionId);
    if (scores.length < 12 || scores.some((score) => score.finalScore === null || score.finalScore === undefined)) {
      throw new ValidationError("All 12 CTS-R scores are required before submission");
    }
    const total = scores.reduce((sum, score) => sum + (score.finalScore || 0), 0);
    return this.updateSession(sessionId, {
      finalTotalScore: total,
      finalMeanScore: Number((total / 12).toFixed(2)),
      status: "scored",
      submittedAt: nowIso(),
    });
  }

  createEvidence(input: Omit<EvidenceRecord, "id" | "createdAt" | "updatedAt">): EvidenceRecord {
    const now = nowIso();
    const record: EvidenceRecord = {
      ...input,
      id: createPublicId(),
      createdAt: now,
      updatedAt: now,
    };
    this.evidence.set(record.id, record);
    return record;
  }

  deleteAiEvidenceBySession(sessionId: string): void {
    for (const [id, record] of this.evidence.entries()) {
      if (record.sessionId === sessionId && record.source === "ai") {
        this.evidence.delete(id);
      }
    }
  }

  listEvidence(sessionId: string, filters: { itemId?: number; status?: EvidenceRecord["status"] } = {}): EvidenceRecord[] {
    return [...this.evidence.values()]
      .filter((item) => item.sessionId === sessionId)
      .filter((item) => !filters.itemId || item.ctsrItemId === filters.itemId)
      .filter((item) => !filters.status || item.status === filters.status)
      .sort((a, b) => (a.timestampSeconds || 0) - (b.timestampSeconds || 0));
  }

  getEvidence(id: string): EvidenceRecord {
    const record = this.evidence.get(id);
    if (!record) throw new NotFoundError("Evidence");
    return record;
  }

  updateEvidence(id: string, patch: Partial<EvidenceRecord>): EvidenceRecord {
    const record = this.getEvidence(id);
    Object.assign(record, patch, { updatedAt: nowIso() });
    return record;
  }

  deleteEvidence(id: string): void {
    if (!this.evidence.delete(id)) throw new NotFoundError("Evidence");
  }

  getFeedback(sessionId: string): FeedbackRecord {
    const record = this.feedback.get(sessionId);
    if (record) return record;
    const now = nowIso();
    return {
      sessionId,
      strengths: "",
      growthAreas: "",
      suggestions: "",
      overallComment: null,
      updatedBy: "",
      createdAt: now,
      updatedAt: now,
    };
  }

  upsertFeedback(input: Omit<FeedbackRecord, "createdAt" | "updatedAt">): FeedbackRecord {
    const existing = this.feedback.get(input.sessionId);
    const now = nowIso();
    const record: FeedbackRecord = {
      ...input,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.feedback.set(record.sessionId, record);
    return record;
  }

  createReport(input: Omit<ReportRecord, "id" | "status" | "generatedAt" | "createdAt" | "fileName">): ReportRecord {
    const now = nowIso();
    const report: ReportRecord = {
      ...input,
      id: createPublicId(),
      status: "generated",
      fileName: `cts-r-${input.sessionId}.${input.format}`,
      generatedAt: now,
      createdAt: now,
    };
    this.reports.set(report.id, report);
    return report;
  }

  listReports(sessionId: string): ReportRecord[] {
    return [...this.reports.values()]
      .filter((report) => report.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getReport(id: string): ReportRecord {
    const report = this.reports.get(id);
    if (!report) throw new NotFoundError("Report");
    return report;
  }

  addAudit(input: Omit<AuditLogRecord, "id" | "createdAt">): AuditLogRecord {
    const log: AuditLogRecord = {
      ...input,
      id: createPublicId(),
      createdAt: nowIso(),
    };
    this.auditLogs.set(log.id, log);
    return log;
  }

  listSessionAudit(sessionId: string): AuditLogRecord[] {
    return [...this.auditLogs.values()]
      .filter((log) => log.entityId === sessionId || log.afterData && JSON.stringify(log.afterData).includes(sessionId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
