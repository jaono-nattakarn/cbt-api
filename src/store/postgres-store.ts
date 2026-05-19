import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";
import { MemoryStore } from "./memory-store";
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
  TranscriptRecord,
  UserRecord,
} from "./types";

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function maybeIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return iso(value);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function json(value: unknown) {
  return JSON.stringify(value ?? null);
}

export class PostgresStore extends MemoryStore {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly pool: Pool,
    private readonly logger: FastifyBaseLogger,
  ) {
    super();
  }

  override async seed(): Promise<void> {
    await this.loadFromDatabase();
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private enqueue(label: string, task: () => Promise<unknown>): void {
    this.writeQueue = this.writeQueue
      .then(task)
      .catch((err: unknown) => {
        const error = err as { message?: string; code?: string; detail?: string; constraint?: string; stack?: string };
        this.logger.error(
          {
            label,
            message: error?.message,
            code: error?.code,
            detail: error?.detail,
            constraint: error?.constraint,
            stack: error?.stack,
          },
          "Postgres store write failed",
        );
      });
  }

  private async loadFromDatabase(): Promise<void> {
    const [
      organizations,
      users,
      refreshTokens,
      clients,
      cases,
      sessions,
      transcripts,
      analysisJobs,
      analysisResults,
      scores,
      evidence,
      feedback,
      reports,
      auditLogs,
    ] = await Promise.all([
      this.pool.query(`
        select public_id::text as "id", name, slug, status, settings,
          created_at as "createdAt", updated_at as "updatedAt"
        from organizations
      `),
      this.pool.query(`
        select u.public_id::text as "id", o.public_id::text as "organizationId",
          u.email, u.password_hash as "passwordHash", u.display_name as "name",
          u.role, u.status, u.affiliation, u.created_at as "createdAt",
          u.updated_at as "updatedAt", u.last_login_at as "lastLoginAt"
        from users u
        join organizations o on o.id = u.organization_id
        where u.deleted_at is null
      `),
      this.pool.query(`
        select rt.token_hash as "tokenHash", u.public_id::text as "userId",
          rt.family_id::text as "familyId", rt.expires_at as "expiresAt",
          rt.revoked_at as "revokedAt", rt.created_at as "createdAt"
        from user_refresh_tokens rt
        join users u on u.id = rt.user_id
      `),
      this.pool.query(`
        select c.public_id::text as "id", o.public_id::text as "organizationId",
          c.client_code as "clientCode", c.display_label as "displayLabel",
          c.risk_level as "riskLevel", c.metadata, c.archived_at as "archivedAt",
          c.created_at as "createdAt", c.updated_at as "updatedAt"
        from clients c
        join organizations o on o.id = c.organization_id
      `),
      this.pool.query(`
        select tc.public_id::text as "id", o.public_id::text as "organizationId",
          c.public_id::text as "clientId", pt.public_id::text as "primaryTherapistId",
          tc.case_code as "caseCode", tc.modality, tc.presenting_problem as "presentingProblem",
          tc.status, tc.metadata, tc.created_at as "createdAt", tc.updated_at as "updatedAt"
        from therapy_cases tc
        join organizations o on o.id = tc.organization_id
        join clients c on c.id = tc.client_id
        left join users pt on pt.id = tc.primary_therapist_id
      `),
      this.pool.query(`
        select ts.public_id::text as "id", ts.display_code as "displayCode",
          o.public_id::text as "organizationId", tc.public_id::text as "caseId",
          c.public_id::text as "clientId", ts.case_alias as "caseAlias",
          ts.therapist_name as "therapistName",
          supervisor.public_id::text as "supervisorId", ts.session_number as "sessionNumber",
          ts.session_date as "sessionDate", ts.short_description as "shortDescription",
          ts.duration_seconds as "durationSeconds", ts.status,
          ts.ai_total_score as "aiTotalScore", ts.ai_mean_score as "aiMeanScore",
          ts.final_total_score as "finalTotalScore", ts.final_mean_score as "finalMeanScore",
          ts.kappa, ts.submitted_at as "submittedAt", ts.signed_off_at as "signedOffAt",
          ts.archived_at as "archivedAt", ts.created_at as "createdAt", ts.updated_at as "updatedAt"
        from therapy_sessions ts
        join organizations o on o.id = ts.organization_id
        left join therapy_cases tc on tc.id = ts.case_id
        left join clients c on c.id = ts.client_id
        join users supervisor on supervisor.id = ts.supervisor_id
      `),
      this.pool.query(`
        select t.public_id::text as "id", o.public_id::text as "organizationId",
          s.public_id::text as "sessionId", t.source_file_name as "sourceFileName",
          t.source_mime_type as "sourceMimeType", t.source_file_size_bytes as "sourceFileSizeBytes",
          t.source_file_sha256 as "sourceFileSha256", t.turns, t.raw_text as "rawText",
          t.redacted_text as "redactedText", t.language, t.word_count as "wordCount",
          t.char_count as "charCount", t.schema_version as "schemaVersion",
          cb.public_id::text as "createdBy", t.created_at as "createdAt", t.updated_at as "updatedAt"
        from transcripts t
        join organizations o on o.id = t.organization_id
        join therapy_sessions s on s.id = t.session_id
        left join users cb on cb.id = t.created_by
      `),
      this.pool.query(`
        select aj.public_id::text as "id", o.public_id::text as "organizationId",
          s.public_id::text as "sessionId", t.public_id::text as "transcriptId",
          aj.provider, aj.status, aj.attempt, aj.max_attempts as "maxAttempts",
          aj.request_payload as "requestPayload", aj.response_payload as "responsePayload",
          aj.error_code as "errorCode", aj.error_message as "errorMessage",
          aj.started_at as "startedAt", aj.completed_at as "completedAt",
          aj.created_at as "createdAt", aj.updated_at as "updatedAt"
        from analysis_jobs aj
        join organizations o on o.id = aj.organization_id
        join therapy_sessions s on s.id = aj.session_id
        join transcripts t on t.id = aj.transcript_id
      `),
      this.pool.query(`
        select ar.public_id::text as "id", o.public_id::text as "organizationId",
          s.public_id::text as "sessionId", aj.public_id::text as "analysisJobId",
          ar.result_version as "resultVersion", ar.status, ar.n8n_received_at as "n8nReceivedAt",
          ar.meta, ar.summary, ar.raw_response as "rawResponse", ar.parse_warnings as "parseWarnings",
          ar.created_at as "createdAt"
        from ai_analysis_results ar
        join organizations o on o.id = ar.organization_id
        join therapy_sessions s on s.id = ar.session_id
        join analysis_jobs aj on aj.id = ar.analysis_job_id
      `),
      this.pool.query(`
        select sc.public_id::text as "id", o.public_id::text as "organizationId",
          s.public_id::text as "sessionId", ar.public_id::text as "analysisResultId",
          sc.ctsr_item_id as "ctsrItemId", sc.ai_score as "aiScore",
          sc.ai_anchor_label as "aiAnchorLabel", sc.ai_reasoning as "aiReasoning",
          sc.ai_evidence_review as "aiEvidenceReview", sc.final_score as "finalScore",
          sc.final_anchor_label as "finalAnchorLabel", sc.supervisor_comment as "supervisorComment",
          sc.status, cb.public_id::text as "confirmedBy", sc.confirmed_at as "confirmedAt",
          sc.created_at as "createdAt", sc.updated_at as "updatedAt"
        from session_ctsr_scores sc
        join organizations o on o.id = sc.organization_id
        join therapy_sessions s on s.id = sc.session_id
        left join ai_analysis_results ar on ar.id = sc.analysis_result_id
        left join users cb on cb.id = sc.confirmed_by
      `),
      this.pool.query(`
        select ev.public_id::text as "id", o.public_id::text as "organizationId",
          s.public_id::text as "sessionId", ar.public_id::text as "analysisResultId",
          sc.public_id::text as "scoreId", ev.ctsr_item_id as "ctsrItemId",
          ev.transcript_turn_no as "transcriptTurnNo", ev.speaker, ev.quote_text as "quoteText",
          ev.timestamp_label as "timestampLabel", ev.timestamp_seconds as "timestampSeconds",
          ev.polarity, ev.source, ev.status, ev.review_note as "reviewNote",
          created.public_id::text as "createdBy", reviewed.public_id::text as "reviewedBy",
          ev.reviewed_at as "reviewedAt", ev.created_at as "createdAt", ev.updated_at as "updatedAt"
        from evidence_quotes ev
        join organizations o on o.id = ev.organization_id
        join therapy_sessions s on s.id = ev.session_id
        left join ai_analysis_results ar on ar.id = ev.analysis_result_id
        left join session_ctsr_scores sc on sc.id = ev.score_id
        left join users created on created.id = ev.created_by
        left join users reviewed on reviewed.id = ev.reviewed_by
      `),
      this.pool.query(`
        select s.public_id::text as "sessionId", fb.strengths,
          fb.growth_areas as "growthAreas", fb.suggestions,
          fb.overall_comment as "overallComment", updated.public_id::text as "updatedBy",
          fb.created_at as "createdAt", fb.updated_at as "updatedAt"
        from supervision_feedback fb
        join therapy_sessions s on s.id = fb.session_id
        left join users updated on updated.id = fb.updated_by
      `),
      this.pool.query(`
        select r.public_id::text as "id", o.public_id::text as "organizationId",
          s.public_id::text as "sessionId", r.format, r.status,
          r.included_sections as "includedSections", r.storage_key as "storageKey",
          r.file_name as "fileName", r.file_size_bytes as "fileSizeBytes",
          gb.public_id::text as "generatedBy", r.generated_at as "generatedAt",
          r.created_at as "createdAt"
        from reports r
        join organizations o on o.id = r.organization_id
        join therapy_sessions s on s.id = r.session_id
        left join users gb on gb.id = r.generated_by
      `),
      this.pool.query(`
        select al.id::text as "id", o.public_id::text as "organizationId",
          actor.public_id::text as "actorUserId", al.action, al.entity_type as "entityType",
          al.entity_public_id::text as "entityId", al.before_data as "beforeData",
          al.after_data as "afterData", al.created_at as "createdAt"
        from audit_logs al
        join organizations o on o.id = al.organization_id
        left join users actor on actor.id = al.actor_user_id
      `),
    ]);

    organizations.rows.forEach((row) => this.organizations.set(row.id, this.organization(row)));
    users.rows.forEach((row) => this.users.set(row.id, this.user(row)));
    refreshTokens.rows.forEach((row) => this.refreshTokens.set(row.tokenHash, this.refreshToken(row)));
    clients.rows.forEach((row) => this.clients.set(row.id, this.client(row)));
    cases.rows.forEach((row) => this.cases.set(row.id, this.caseRecord(row)));
    sessions.rows.forEach((row) => this.sessions.set(row.id, this.session(row)));
    transcripts.rows.forEach((row) => this.transcripts.set(row.id, this.transcript(row)));
    analysisJobs.rows.forEach((row) => this.analysisJobs.set(row.id, this.analysisJob(row)));
    analysisResults.rows.forEach((row) => this.analysisResults.set(row.id, this.analysisResult(row)));
    scores.rows.forEach((row) => this.scores.set(row.id, this.score(row)));
    evidence.rows.forEach((row) => this.evidence.set(row.id, this.evidenceRecord(row)));
    feedback.rows.forEach((row) => this.feedback.set(row.sessionId, this.feedbackRecord(row)));
    reports.rows.forEach((row) => this.reports.set(row.id, this.report(row)));
    auditLogs.rows.forEach((row) => this.auditLogs.set(row.id, this.audit(row)));
  }

  private organization(row: any): OrganizationRecord {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      settings: row.settings ?? {},
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private user(row: any): UserRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      email: row.email,
      passwordHash: row.passwordHash,
      name: row.name,
      role: row.role,
      status: row.status,
      affiliation: row.affiliation ?? undefined,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      lastLoginAt: maybeIso(row.lastLoginAt),
    };
  }

  private refreshToken(row: any): RefreshTokenRecord {
    return {
      tokenHash: row.tokenHash,
      userId: row.userId,
      familyId: row.familyId,
      expiresAt: iso(row.expiresAt),
      revokedAt: maybeIso(row.revokedAt),
      createdAt: iso(row.createdAt),
    };
  }

  private client(row: any): ClientRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      clientCode: row.clientCode,
      displayLabel: row.displayLabel,
      riskLevel: row.riskLevel ?? null,
      metadata: row.metadata ?? {},
      archivedAt: maybeIso(row.archivedAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private caseRecord(row: any): CaseRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      clientId: row.clientId,
      primaryTherapistId: row.primaryTherapistId ?? null,
      caseCode: row.caseCode ?? null,
      modality: row.modality ?? null,
      presentingProblem: row.presentingProblem ?? null,
      status: row.status,
      metadata: row.metadata ?? {},
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private session(row: any): SessionRecord {
    const sessionDate = row.sessionDate instanceof Date
      ? row.sessionDate.toISOString().slice(0, 10)
      : row.sessionDate ?? null;
    return {
      id: row.id,
      displayCode: row.displayCode,
      organizationId: row.organizationId,
      caseId: row.caseId ?? null,
      clientId: row.clientId ?? null,
      caseAlias: row.caseAlias ?? null,
      therapistName: row.therapistName ?? null,
      supervisorId: row.supervisorId,
      sessionNumber: row.sessionNumber === null || row.sessionNumber === undefined ? null : String(row.sessionNumber),
      sessionDate,
      shortDescription: row.shortDescription ?? null,
      durationSeconds: row.durationSeconds ?? null,
      status: row.status,
      aiTotalScore: row.aiTotalScore ?? null,
      aiMeanScore: numberOrNull(row.aiMeanScore),
      finalTotalScore: row.finalTotalScore ?? null,
      finalMeanScore: numberOrNull(row.finalMeanScore),
      kappa: numberOrNull(row.kappa),
      submittedAt: maybeIso(row.submittedAt),
      signedOffAt: maybeIso(row.signedOffAt),
      archivedAt: maybeIso(row.archivedAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private transcript(row: any): TranscriptRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      sessionId: row.sessionId,
      sourceFileName: row.sourceFileName,
      sourceMimeType: row.sourceMimeType,
      sourceFileSizeBytes: Number(row.sourceFileSizeBytes),
      sourceFileSha256: row.sourceFileSha256,
      turns: row.turns,
      rawText: row.rawText ?? null,
      redactedText: row.redactedText ?? null,
      language: row.language ?? null,
      wordCount: row.wordCount ?? 0,
      charCount: row.charCount ?? 0,
      schemaVersion: row.schemaVersion,
      createdBy: row.createdBy,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private analysisJob(row: any): AnalysisJobRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      sessionId: row.sessionId,
      transcriptId: row.transcriptId,
      provider: row.provider,
      status: row.status,
      attempt: row.attempt,
      maxAttempts: row.maxAttempts,
      requestPayload: row.requestPayload ?? {},
      responsePayload: row.responsePayload,
      errorCode: row.errorCode ?? null,
      errorMessage: row.errorMessage ?? null,
      startedAt: maybeIso(row.startedAt),
      completedAt: maybeIso(row.completedAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private analysisResult(row: any): AnalysisResultRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      sessionId: row.sessionId,
      analysisJobId: row.analysisJobId,
      resultVersion: row.resultVersion,
      status: row.status,
      n8nReceivedAt: maybeIso(row.n8nReceivedAt),
      meta: row.meta ?? {},
      summary: row.summary ?? {},
      rawResponse: row.rawResponse,
      parseWarnings: row.parseWarnings ?? [],
      createdAt: iso(row.createdAt),
    };
  }

  private score(row: any): ScoreRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      sessionId: row.sessionId,
      analysisResultId: row.analysisResultId ?? null,
      ctsrItemId: row.ctsrItemId,
      aiScore: row.aiScore ?? null,
      aiAnchorLabel: row.aiAnchorLabel ?? null,
      aiReasoning: row.aiReasoning ?? null,
      aiEvidenceReview: row.aiEvidenceReview ?? null,
      finalScore: row.finalScore ?? null,
      finalAnchorLabel: row.finalAnchorLabel ?? null,
      supervisorComment: row.supervisorComment ?? null,
      status: row.status,
      confirmedBy: row.confirmedBy ?? null,
      confirmedAt: maybeIso(row.confirmedAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private evidenceRecord(row: any): EvidenceRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      sessionId: row.sessionId,
      analysisResultId: row.analysisResultId ?? null,
      scoreId: row.scoreId ?? null,
      ctsrItemId: row.ctsrItemId,
      transcriptTurnNo: row.transcriptTurnNo ?? null,
      speaker: row.speaker,
      quoteText: row.quoteText,
      timestampLabel: row.timestampLabel ?? null,
      timestampSeconds: row.timestampSeconds ?? null,
      polarity: row.polarity,
      source: row.source,
      status: row.status,
      reviewNote: row.reviewNote ?? null,
      createdBy: row.createdBy ?? null,
      reviewedBy: row.reviewedBy ?? null,
      reviewedAt: maybeIso(row.reviewedAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private feedbackRecord(row: any): FeedbackRecord {
    return {
      sessionId: row.sessionId,
      strengths: row.strengths,
      growthAreas: row.growthAreas,
      suggestions: row.suggestions,
      overallComment: row.overallComment ?? null,
      updatedBy: row.updatedBy ?? "",
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private report(row: any): ReportRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      sessionId: row.sessionId,
      format: row.format,
      status: row.status,
      includedSections: row.includedSections ?? {},
      storageKey: row.storageKey ?? null,
      fileName: row.fileName ?? null,
      fileSizeBytes: row.fileSizeBytes === null || row.fileSizeBytes === undefined ? null : Number(row.fileSizeBytes),
      generatedBy: row.generatedBy,
      generatedAt: maybeIso(row.generatedAt),
      createdAt: iso(row.createdAt),
    };
  }

  private audit(row: any): AuditLogRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      actorUserId: row.actorUserId ?? null,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId ?? null,
      beforeData: row.beforeData,
      afterData: row.afterData,
      createdAt: iso(row.createdAt),
    };
  }

  override async registerUser(input: {
    organizationId?: string;
    organizationName?: string;
    name: string;
    email: string;
    password: string;
    role?: Role;
  }): Promise<UserRecord> {
    const user = await super.registerUser(input);
    const organization = this.organizations.get(user.organizationId);
    if (organization) await this.persistOrganization(organization);
    await this.persistUser(user);
    return user;
  }

  override async verifyLogin(email: string, password: string): Promise<UserRecord> {
    const user = await super.verifyLogin(email, password);
    await this.persistUser(user);
    return user;
  }

  override issueRefreshToken(userId: string, days: number) {
    const issued = super.issueRefreshToken(userId, days);
    this.enqueue("refreshToken.insert", () => this.persistRefreshToken(issued.record));
    return issued;
  }

  override rotateRefreshToken(token: string, days: number) {
    const rotated = super.rotateRefreshToken(token, days);
    this.enqueue("refreshToken.rotate", () =>
      this.pool.query(
        `update user_refresh_tokens set revoked_at = now() where token_hash = encode(digest($1, 'sha256'), 'hex')`,
        [token],
      ),
    );
    return rotated;
  }

  override revokeRefreshToken(token: string): void {
    super.revokeRefreshToken(token);
    this.enqueue("refreshToken.revoke", () =>
      this.pool.query(
        `update user_refresh_tokens set revoked_at = now() where token_hash = encode(digest($1, 'sha256'), 'hex')`,
        [token],
      ),
    );
  }

  override revokeUserRefreshTokens(userId: string): void {
    super.revokeUserRefreshTokens(userId);
    this.enqueue("refreshToken.revokeUser", () =>
      this.pool.query(
        `update user_refresh_tokens set revoked_at = now()
         where user_id = (select id from users where public_id = $1::uuid)`,
        [userId],
      ),
    );
  }

  override updateUser(id: string, patch: Partial<Pick<UserRecord, "name" | "role" | "status" | "affiliation">>): UserRecord {
    const user = super.updateUser(id, patch);
    this.enqueue("user.update", () => this.persistUser(user));
    return user;
  }

  override createClient(organizationId: string, input: { clientCode: string; displayLabel?: string; riskLevel?: string | null }): ClientRecord {
    const client = super.createClient(organizationId, input);
    this.enqueue("client.insert", () => this.persistClient(client));
    return client;
  }

  override updateClient(id: string, patch: Partial<Pick<ClientRecord, "displayLabel" | "riskLevel" | "metadata" | "archivedAt">>): ClientRecord {
    const client = super.updateClient(id, patch);
    this.enqueue("client.update", () => this.persistClient(client));
    return client;
  }

  override createCase(organizationId: string, clientId: string, input: Partial<CaseRecord>): CaseRecord {
    const record = super.createCase(organizationId, clientId, input);
    this.enqueue("case.insert", () => this.persistCase(record));
    return record;
  }

  override updateCase(id: string, patch: Partial<CaseRecord>): CaseRecord {
    const record = super.updateCase(id, patch);
    this.enqueue("case.update", () => this.persistCase(record));
    return record;
  }

  override createSession(organizationId: string, supervisorId: string, input: Partial<SessionRecord>): SessionRecord {
    const session = super.createSession(organizationId, supervisorId, input);
    this.enqueue("session.insert", () => this.persistSession(session));
    return session;
  }

  override updateSession(id: string, patch: Partial<SessionRecord>): SessionRecord {
    const session = super.updateSession(id, patch);
    this.enqueue("session.update", () => this.persistSession(session));
    return session;
  }

  override upsertTranscript(input: Omit<TranscriptRecord, "id" | "createdAt" | "updatedAt">): TranscriptRecord {
    const transcript = super.upsertTranscript(input);
    this.enqueue("transcript.upsert", () => this.persistTranscript(transcript));
    return transcript;
  }

  override updateTranscript(id: string, patch: Partial<TranscriptRecord>): TranscriptRecord {
    const transcript = super.updateTranscript(id, patch);
    this.enqueue("transcript.update", () => this.persistTranscript(transcript));
    return transcript;
  }

  override deleteTranscriptBySession(sessionId: string): void {
    const transcript = this.getTranscriptBySession(sessionId);
    super.deleteTranscriptBySession(sessionId);
    this.enqueue("transcript.delete", () =>
      this.pool.query(`delete from transcripts where public_id = $1::uuid`, [transcript.id]),
    );
  }

  override createAnalysisJob(organizationId: string, sessionId: string): AnalysisJobRecord {
    const job = super.createAnalysisJob(organizationId, sessionId);
    this.enqueue("analysisJob.insert", () => this.persistAnalysisJob(job));
    return job;
  }

  override updateAnalysisJob(id: string, patch: Partial<AnalysisJobRecord>): AnalysisJobRecord {
    const job = super.updateAnalysisJob(id, patch);
    this.enqueue("analysisJob.update", () => this.persistAnalysisJob(job));
    return job;
  }

  override saveAnalysisResult(input: Omit<AnalysisResultRecord, "id" | "createdAt" | "resultVersion">): AnalysisResultRecord {
    const result = super.saveAnalysisResult(input);
    this.enqueue("analysisResult.insert", () => this.persistAnalysisResult(result));
    return result;
  }

  override upsertScore(input: Omit<ScoreRecord, "id" | "createdAt" | "updatedAt">): ScoreRecord {
    const score = super.upsertScore(input);
    this.enqueue("score.upsert", () => this.persistScore(score));
    return score;
  }

  override updateScore(sessionId: string, itemId: number, patch: Partial<ScoreRecord>): ScoreRecord {
    const score = super.updateScore(sessionId, itemId, patch);
    this.enqueue("score.update", () => this.persistScore(score));
    return score;
  }

  override createEvidence(input: Omit<EvidenceRecord, "id" | "createdAt" | "updatedAt">): EvidenceRecord {
    const evidence = super.createEvidence(input);
    this.enqueue("evidence.insert", () => this.persistEvidence(evidence));
    return evidence;
  }

  override deleteAiEvidenceBySession(sessionId: string): void {
    super.deleteAiEvidenceBySession(sessionId);
    this.enqueue("evidence.deleteAiBySession", () =>
      this.pool.query(
        `delete from evidence_quotes
         where session_id = (select id from therapy_sessions where public_id = $1::uuid)
           and source = 'ai'`,
        [sessionId],
      ),
    );
  }

  override updateEvidence(id: string, patch: Partial<EvidenceRecord>): EvidenceRecord {
    const evidence = super.updateEvidence(id, patch);
    this.enqueue("evidence.update", () => this.persistEvidence(evidence));
    return evidence;
  }

  override deleteEvidence(id: string): void {
    super.deleteEvidence(id);
    this.enqueue("evidence.delete", () =>
      this.pool.query(`delete from evidence_quotes where public_id = $1::uuid`, [id]),
    );
  }

  override upsertFeedback(input: Omit<FeedbackRecord, "createdAt" | "updatedAt">): FeedbackRecord {
    const feedback = super.upsertFeedback(input);
    this.enqueue("feedback.upsert", () => this.persistFeedback(feedback));
    return feedback;
  }

  override createReport(input: Omit<ReportRecord, "id" | "status" | "generatedAt" | "createdAt" | "fileName">): ReportRecord {
    const report = super.createReport(input);
    this.enqueue("report.insert", () => this.persistReport(report));
    return report;
  }

  override addAudit(input: Omit<AuditLogRecord, "id" | "createdAt">): AuditLogRecord {
    const audit = super.addAudit(input);
    this.enqueue("audit.insert", () => this.persistAudit(audit));
    return audit;
  }

  private persistOrganization(record: OrganizationRecord) {
    return this.pool.query(
      `insert into organizations (public_id, name, slug, status, settings, created_at, updated_at)
       values ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7)
       on conflict (public_id) do update set
         name = excluded.name, slug = excluded.slug, status = excluded.status,
         settings = excluded.settings, updated_at = excluded.updated_at`,
      [record.id, record.name, record.slug, record.status, json(record.settings), record.createdAt, record.updatedAt],
    );
  }

  private persistUser(record: UserRecord) {
    return this.pool.query(
      `insert into users (public_id, organization_id, email, password_hash, display_name, role, status, affiliation, last_login_at, created_at, updated_at)
       values ($1::uuid, (select id from organizations where public_id = $2::uuid), $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (public_id) do update set
         email = excluded.email, password_hash = excluded.password_hash, display_name = excluded.display_name,
         role = excluded.role, status = excluded.status, affiliation = excluded.affiliation,
         last_login_at = excluded.last_login_at, updated_at = excluded.updated_at`,
      [
        record.id,
        record.organizationId,
        record.email,
        record.passwordHash,
        record.name,
        record.role,
        record.status,
        record.affiliation ?? null,
        record.lastLoginAt ?? null,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  private persistRefreshToken(record: RefreshTokenRecord) {
    return this.pool.query(
      `insert into user_refresh_tokens (user_id, token_hash, family_id, expires_at, revoked_at, created_at)
       values ((select id from users where public_id = $1::uuid), $2, $3::uuid, $4, $5, $6)
       on conflict (token_hash) do update set revoked_at = excluded.revoked_at`,
      [record.userId, record.tokenHash, record.familyId, record.expiresAt, record.revokedAt ?? null, record.createdAt],
    );
  }

  private persistClient(record: ClientRecord) {
    return this.pool.query(
      `insert into clients (public_id, organization_id, client_code, display_label, risk_level, metadata, archived_at, created_at, updated_at)
       values ($1::uuid, (select id from organizations where public_id = $2::uuid), $3, $4, $5, $6::jsonb, $7, $8, $9)
       on conflict (public_id) do update set
         client_code = excluded.client_code, display_label = excluded.display_label,
         risk_level = excluded.risk_level, metadata = excluded.metadata,
         archived_at = excluded.archived_at, updated_at = excluded.updated_at`,
      [
        record.id,
        record.organizationId,
        record.clientCode,
        record.displayLabel,
        record.riskLevel ?? null,
        json(record.metadata),
        record.archivedAt ?? null,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  private persistCase(record: CaseRecord) {
    return this.pool.query(
      `insert into therapy_cases (public_id, organization_id, client_id, primary_therapist_id, case_code, modality, presenting_problem, status, metadata, created_at, updated_at)
       values (
         $1::uuid,
         (select id from organizations where public_id = $2::uuid),
         (select id from clients where public_id = $3::uuid),
         (select id from users where public_id = $4::uuid),
         $5, $6, $7, $8, $9::jsonb, $10, $11
       )
       on conflict (public_id) do update set
         primary_therapist_id = excluded.primary_therapist_id, case_code = excluded.case_code,
         modality = excluded.modality, presenting_problem = excluded.presenting_problem,
         status = excluded.status, metadata = excluded.metadata, updated_at = excluded.updated_at`,
      [
        record.id,
        record.organizationId,
        record.clientId,
        record.primaryTherapistId ?? null,
        record.caseCode ?? null,
        record.modality ?? null,
        record.presentingProblem ?? null,
        record.status,
        json(record.metadata),
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  private persistSession(record: SessionRecord) {
    return this.pool.query(
      `insert into therapy_sessions (
         public_id, display_code, organization_id, case_id, client_id, case_alias,
         therapist_name, supervisor_id, session_number, session_date, short_description,
         duration_seconds, status,
         ai_total_score, ai_mean_score, final_total_score, final_mean_score, kappa,
         submitted_at, signed_off_at, archived_at, created_at, updated_at
       )
       values (
         $1::uuid, $2, (select id from organizations where public_id = $3::uuid),
         (select id from therapy_cases where public_id = $4::uuid),
         (select id from clients where public_id = $5::uuid),
         $6, $7, (select id from users where public_id = $8::uuid),
         $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
       )
       on conflict (public_id) do update set
         display_code = excluded.display_code, case_id = excluded.case_id, client_id = excluded.client_id,
         case_alias = excluded.case_alias, therapist_name = excluded.therapist_name,
         supervisor_id = excluded.supervisor_id,
         session_number = excluded.session_number, session_date = excluded.session_date,
         short_description = excluded.short_description, duration_seconds = excluded.duration_seconds,
         status = excluded.status,
         ai_total_score = excluded.ai_total_score, ai_mean_score = excluded.ai_mean_score,
         final_total_score = excluded.final_total_score, final_mean_score = excluded.final_mean_score,
         kappa = excluded.kappa, submitted_at = excluded.submitted_at,
         signed_off_at = excluded.signed_off_at, archived_at = excluded.archived_at,
         updated_at = excluded.updated_at`,
      [
        record.id,
        record.displayCode,
        record.organizationId,
        record.caseId ?? null,
        record.clientId ?? null,
        record.caseAlias ?? null,
        record.therapistName ?? null,
        record.supervisorId,
        record.sessionNumber ?? null,
        record.sessionDate ?? null,
        record.shortDescription ?? null,
        record.durationSeconds ?? null,
        record.status,
        record.aiTotalScore ?? null,
        record.aiMeanScore ?? null,
        record.finalTotalScore ?? null,
        record.finalMeanScore ?? null,
        record.kappa ?? null,
        record.submittedAt ?? null,
        record.signedOffAt ?? null,
        record.archivedAt ?? null,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  private persistTranscript(record: TranscriptRecord) {
    return this.pool.query(
      `insert into transcripts (
         public_id, organization_id, session_id, source_file_name, source_mime_type,
         source_file_size_bytes, source_file_sha256, turns, raw_text, redacted_text,
         language, word_count, char_count, schema_version, created_by, created_at, updated_at
       )
       values (
         $1::uuid, (select id from organizations where public_id = $2::uuid),
         (select id from therapy_sessions where public_id = $3::uuid), $4, $5, $6,
         $7, $8::jsonb, $9, $10, $11, $12, $13, $14,
         (select id from users where public_id = $15::uuid), $16, $17
       )
       on conflict (session_id) do update set
         public_id = excluded.public_id, source_file_name = excluded.source_file_name,
         source_mime_type = excluded.source_mime_type, source_file_size_bytes = excluded.source_file_size_bytes,
         source_file_sha256 = excluded.source_file_sha256, turns = excluded.turns,
         raw_text = excluded.raw_text, redacted_text = excluded.redacted_text,
         language = excluded.language, word_count = excluded.word_count,
         char_count = excluded.char_count, schema_version = excluded.schema_version,
         created_by = excluded.created_by, updated_at = excluded.updated_at`,
      [
        record.id,
        record.organizationId,
        record.sessionId,
        record.sourceFileName,
        record.sourceMimeType,
        record.sourceFileSizeBytes,
        record.sourceFileSha256,
        json(record.turns),
        record.rawText ?? null,
        record.redactedText ?? null,
        record.language ?? null,
        record.wordCount,
        record.charCount,
        record.schemaVersion,
        record.createdBy,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  private persistAnalysisJob(record: AnalysisJobRecord) {
    return this.pool.query(
      `insert into analysis_jobs (
         public_id, organization_id, session_id, transcript_id, provider, status,
         attempt, max_attempts, request_payload, response_payload, error_code,
         error_message, started_at, completed_at, created_at, updated_at
       )
       values (
         $1::uuid, (select id from organizations where public_id = $2::uuid),
         (select id from therapy_sessions where public_id = $3::uuid),
         (select id from transcripts where public_id = $4::uuid),
         $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16
       )
       on conflict (public_id) do update set
         status = excluded.status, attempt = excluded.attempt, max_attempts = excluded.max_attempts,
         request_payload = excluded.request_payload, response_payload = excluded.response_payload,
         error_code = excluded.error_code, error_message = excluded.error_message,
         started_at = excluded.started_at, completed_at = excluded.completed_at,
         updated_at = excluded.updated_at`,
      [
        record.id,
        record.organizationId,
        record.sessionId,
        record.transcriptId,
        record.provider,
        record.status,
        record.attempt,
        record.maxAttempts,
        json(record.requestPayload),
        record.responsePayload === undefined ? null : json(record.responsePayload),
        record.errorCode ?? null,
        record.errorMessage ?? null,
        record.startedAt ?? null,
        record.completedAt ?? null,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  private persistAnalysisResult(record: AnalysisResultRecord) {
    return this.pool.query(
      `insert into ai_analysis_results (
         public_id, organization_id, session_id, analysis_job_id, result_version,
         status, n8n_received_at, meta, summary, raw_response, parse_warnings, created_at
       )
       values (
         $1::uuid, (select id from organizations where public_id = $2::uuid),
         (select id from therapy_sessions where public_id = $3::uuid),
         (select id from analysis_jobs where public_id = $4::uuid),
         $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12
       )
       on conflict (session_id, result_version) do update set
         status = excluded.status, n8n_received_at = excluded.n8n_received_at,
         meta = excluded.meta, summary = excluded.summary,
         raw_response = excluded.raw_response, parse_warnings = excluded.parse_warnings`,
      [
        record.id,
        record.organizationId,
        record.sessionId,
        record.analysisJobId,
        record.resultVersion,
        record.status,
        record.n8nReceivedAt ?? null,
        json(record.meta),
        json(record.summary),
        json(record.rawResponse),
        json(record.parseWarnings),
        record.createdAt,
      ],
    );
  }

  private persistScore(record: ScoreRecord) {
    return this.pool.query(
      `insert into session_ctsr_scores (
         public_id, organization_id, session_id, analysis_result_id, ctsr_item_id, ai_score,
         ai_anchor_label, ai_reasoning, ai_evidence_review, final_score,
         final_anchor_label, supervisor_comment, status, confirmed_by,
         confirmed_at, created_at, updated_at
       )
       values (
         $1::uuid,
         (select id from organizations where public_id = $2::uuid),
         (select id from therapy_sessions where public_id = $3::uuid),
         (select id from ai_analysis_results where public_id = $4::uuid),
         $5, $6, $7, $8, $9, $10, $11, $12, $13,
         (select id from users where public_id = $14::uuid), $15, $16, $17
       )
       on conflict (session_id, ctsr_item_id) do update set
         analysis_result_id = excluded.analysis_result_id, ai_score = excluded.ai_score,
         ai_anchor_label = excluded.ai_anchor_label, ai_reasoning = excluded.ai_reasoning,
         ai_evidence_review = excluded.ai_evidence_review, final_score = excluded.final_score,
         final_anchor_label = excluded.final_anchor_label, supervisor_comment = excluded.supervisor_comment,
         status = excluded.status, confirmed_by = excluded.confirmed_by,
         confirmed_at = excluded.confirmed_at, updated_at = excluded.updated_at`,
      [
        record.id,
        record.organizationId,
        record.sessionId,
        record.analysisResultId ?? null,
        record.ctsrItemId,
        record.aiScore ?? null,
        record.aiAnchorLabel ?? null,
        record.aiReasoning ?? null,
        record.aiEvidenceReview ?? null,
        record.finalScore ?? null,
        record.finalAnchorLabel ?? null,
        record.supervisorComment ?? null,
        record.status,
        record.confirmedBy ?? null,
        record.confirmedAt ?? null,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  private persistEvidence(record: EvidenceRecord) {
    return this.pool.query(
      `insert into evidence_quotes (
         public_id, organization_id, session_id, analysis_result_id, score_id,
         ctsr_item_id, transcript_turn_no, speaker, quote_text, timestamp_label,
         timestamp_seconds, polarity, source, status, review_note, created_by,
         reviewed_by, reviewed_at, created_at, updated_at
       )
       values (
         $1::uuid, (select id from organizations where public_id = $2::uuid),
         (select id from therapy_sessions where public_id = $3::uuid),
         (select id from ai_analysis_results where public_id = $4::uuid),
         (select id from session_ctsr_scores where public_id = $5::uuid),
         $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
         (select id from users where public_id = $16::uuid),
         (select id from users where public_id = $17::uuid),
         $18, $19, $20
       )
       on conflict (public_id) do update set
         analysis_result_id = excluded.analysis_result_id, score_id = excluded.score_id,
         ctsr_item_id = excluded.ctsr_item_id, transcript_turn_no = excluded.transcript_turn_no,
         speaker = excluded.speaker, quote_text = excluded.quote_text,
         timestamp_label = excluded.timestamp_label, timestamp_seconds = excluded.timestamp_seconds,
         polarity = excluded.polarity, source = excluded.source, status = excluded.status,
         review_note = excluded.review_note, reviewed_by = excluded.reviewed_by,
         reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at`,
      [
        record.id,
        record.organizationId,
        record.sessionId,
        record.analysisResultId ?? null,
        record.scoreId ?? null,
        record.ctsrItemId,
        record.transcriptTurnNo ?? null,
        record.speaker,
        record.quoteText,
        record.timestampLabel ?? null,
        record.timestampSeconds ?? null,
        record.polarity,
        record.source,
        record.status,
        record.reviewNote ?? null,
        record.createdBy ?? null,
        record.reviewedBy ?? null,
        record.reviewedAt ?? null,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  private persistFeedback(record: FeedbackRecord) {
    return this.pool.query(
      `insert into supervision_feedback (
         session_id, strengths, growth_areas, suggestions, overall_comment,
         created_by, updated_by, created_at, updated_at
       )
       values (
         (select id from therapy_sessions where public_id = $1::uuid),
         $2, $3, $4, $5,
         (select id from users where public_id = $6::uuid),
         (select id from users where public_id = $6::uuid), $7, $8
       )
       on conflict (session_id) do update set
         strengths = excluded.strengths, growth_areas = excluded.growth_areas,
         suggestions = excluded.suggestions, overall_comment = excluded.overall_comment,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [
        record.sessionId,
        record.strengths,
        record.growthAreas,
        record.suggestions,
        record.overallComment ?? null,
        record.updatedBy || null,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  private persistReport(record: ReportRecord) {
    return this.pool.query(
      `insert into reports (
         public_id, organization_id, session_id, format, status, included_sections,
         storage_key, file_name, file_size_bytes, generated_by, generated_at, created_at
       )
       values (
         $1::uuid, (select id from organizations where public_id = $2::uuid),
         (select id from therapy_sessions where public_id = $3::uuid),
         $4, $5, $6::jsonb, $7, $8, $9,
         (select id from users where public_id = $10::uuid), $11, $12
       )
       on conflict (public_id) do update set
         status = excluded.status, included_sections = excluded.included_sections,
         storage_key = excluded.storage_key, file_name = excluded.file_name,
         file_size_bytes = excluded.file_size_bytes, generated_at = excluded.generated_at`,
      [
        record.id,
        record.organizationId,
        record.sessionId,
        record.format,
        record.status,
        json(record.includedSections),
        record.storageKey ?? null,
        record.fileName ?? null,
        record.fileSizeBytes ?? null,
        record.generatedBy,
        record.generatedAt ?? null,
        record.createdAt,
      ],
    );
  }

  private persistAudit(record: AuditLogRecord) {
    return this.pool.query(
      `insert into audit_logs (
         organization_id, actor_user_id, action, entity_type, entity_public_id,
         before_data, after_data, created_at
       )
       values (
         (select id from organizations where public_id = $1::uuid),
         (select id from users where public_id = $2::uuid),
         $3, $4, $5::uuid, $6::jsonb, $7::jsonb, $8
       )`,
      [
        record.organizationId,
        record.actorUserId ?? null,
        record.action,
        record.entityType,
        record.entityId ?? null,
        record.beforeData === undefined ? null : json(record.beforeData),
        record.afterData === undefined ? null : json(record.afterData),
        record.createdAt,
      ],
    );
  }
}
