create extension if not exists pgcrypto;

create table if not exists organizations (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  name text not null,
  slug text unique,
  status text not null default 'active' check (status in ('active', 'suspended')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references organizations(id),
  email text not null,
  password_hash text not null,
  display_name text not null,
  role text not null check (role in ('admin', 'supervisor', 'therapist', 'viewer')),
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  affiliation text,
  metadata jsonb not null default '{}'::jsonb,
  last_login_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_org_email_active_uidx
  on users (organization_id, lower(email))
  where deleted_at is null;

create index if not exists users_org_role_status_idx
  on users (organization_id, role, status);

create table if not exists user_refresh_tokens (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  token_hash text not null unique,
  family_id uuid not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by_token_id bigint references user_refresh_tokens(id),
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists user_refresh_tokens_user_idx
  on user_refresh_tokens (user_id, created_at desc);

create table if not exists password_reset_tokens (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists clients (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references organizations(id),
  client_code text not null,
  display_label text not null,
  risk_level text,
  metadata jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists clients_org_code_active_uidx
  on clients (organization_id, lower(client_code))
  where archived_at is null;

create index if not exists clients_org_created_idx
  on clients (organization_id, created_at desc, id desc);

create table if not exists therapy_cases (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references organizations(id),
  client_id bigint not null references clients(id) on delete cascade,
  primary_therapist_id bigint references users(id),
  case_code text,
  modality text,
  presenting_problem text,
  status text not null default 'active' check (status in ('active', 'closed', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists therapy_cases_org_status_created_idx
  on therapy_cases (organization_id, status, created_at desc, id desc);

create index if not exists therapy_cases_client_idx
  on therapy_cases (client_id);

create table if not exists therapy_sessions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  display_code text unique,
  organization_id bigint not null references organizations(id),
  case_id bigint references therapy_cases(id),
  client_id bigint references clients(id),
  therapist_id bigint references users(id),
  supervisor_id bigint not null references users(id),
  session_number integer,
  session_date date,
  short_description text,
  modality text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  status text not null default 'draft' check (status in (
    'draft', 'uploaded', 'queued', 'processing', 'ai_rejected', 'ai_failed',
    'ready_for_review', 'review_in_progress', 'scoring', 'scored', 'signed_off', 'archived'
  )),
  ai_total_score integer check (ai_total_score is null or ai_total_score between 0 and 72),
  ai_mean_score numeric(4,2),
  final_total_score integer check (final_total_score is null or final_total_score between 0 and 72),
  final_mean_score numeric(4,2),
  kappa numeric(4,3),
  submitted_at timestamptz,
  signed_off_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists therapy_sessions_org_status_created_idx
  on therapy_sessions (organization_id, status, created_at desc, id desc);

create index if not exists therapy_sessions_org_supervisor_status_idx
  on therapy_sessions (organization_id, supervisor_id, status, created_at desc, id desc);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'therapy_sessions'
      and column_name = 'therapist_id'
  ) then
    create index if not exists therapy_sessions_org_therapist_date_idx
      on therapy_sessions (organization_id, therapist_id, session_date desc, id desc);
  end if;
end $$;

create index if not exists therapy_sessions_active_idx
  on therapy_sessions (organization_id, created_at desc, id desc)
  where archived_at is null;

create table if not exists transcripts (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references organizations(id),
  session_id bigint not null unique references therapy_sessions(id) on delete cascade,
  source_file_name text not null,
  source_mime_type text not null,
  source_file_size_bytes bigint not null,
  source_file_sha256 text not null,
  turns jsonb not null,
  raw_text text,
  redacted_text text,
  language text,
  word_count integer,
  char_count integer,
  schema_version integer not null default 1,
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transcripts_turns_object_chk check (jsonb_typeof(turns) = 'object')
);

create index if not exists transcripts_org_created_idx
  on transcripts (organization_id, created_at desc, id desc);

create index if not exists transcripts_turns_gin
  on transcripts using gin (turns jsonb_path_ops);

create table if not exists analysis_jobs (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references organizations(id),
  session_id bigint not null references therapy_sessions(id) on delete cascade,
  transcript_id bigint not null references transcripts(id) on delete cascade,
  provider text not null default 'n8n',
  status text not null default 'pending' check (status in ('pending', 'processing', 'succeeded', 'rejected', 'failed', 'cancelled')),
  attempt integer not null default 0,
  max_attempts integer not null default 3,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb,
  error_code text,
  error_message text,
  locked_by text,
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists analysis_jobs_pending_idx
  on analysis_jobs (created_at, id)
  where status = 'pending';

create index if not exists analysis_jobs_session_created_idx
  on analysis_jobs (session_id, created_at desc, id desc);

create table if not exists ai_analysis_results (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references organizations(id),
  session_id bigint not null references therapy_sessions(id) on delete cascade,
  analysis_job_id bigint not null references analysis_jobs(id) on delete cascade,
  result_version integer not null,
  status text not null check (status in ('ok', 'rejected', 'error')),
  n8n_received_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  raw_response jsonb not null,
  parse_warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, result_version)
);

create table if not exists ctsr_items (
  id smallint primary key check (id between 1 and 12),
  code text not null unique,
  name_en text not null,
  name_th text,
  short_name text not null,
  category text not null check (category in ('Structure', 'Technique', 'Relationship')),
  display_order smallint not null unique,
  active boolean not null default true
);

create table if not exists ctsr_rubric_anchors (
  id bigint generated always as identity primary key,
  ctsr_item_id smallint not null references ctsr_items(id) on delete cascade,
  score smallint not null check (score between 0 and 6),
  label text not null,
  description_en text,
  description_th text,
  created_at timestamptz not null default now(),
  unique (ctsr_item_id, score)
);

create table if not exists session_ctsr_scores (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references organizations(id),
  session_id bigint not null references therapy_sessions(id) on delete cascade,
  analysis_result_id bigint references ai_analysis_results(id) on delete set null,
  ctsr_item_id smallint not null references ctsr_items(id),
  ai_score smallint check (ai_score is null or ai_score between 0 and 6),
  ai_anchor_label text,
  ai_reasoning text,
  ai_evidence_review text,
  final_score smallint check (final_score is null or final_score between 0 and 6),
  final_anchor_label text,
  supervisor_comment text,
  status text not null default 'ai_suggested' check (status in ('ai_suggested', 'reviewed', 'confirmed', 'overridden')),
  confirmed_by bigint references users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, ctsr_item_id)
);

create index if not exists session_ctsr_scores_session_idx
  on session_ctsr_scores (session_id, ctsr_item_id);

alter table session_ctsr_scores
  add column if not exists public_id uuid not null default gen_random_uuid();

create unique index if not exists session_ctsr_scores_public_id_uidx
  on session_ctsr_scores (public_id);

create table if not exists evidence_quotes (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references organizations(id),
  session_id bigint not null references therapy_sessions(id) on delete cascade,
  analysis_result_id bigint references ai_analysis_results(id) on delete set null,
  score_id bigint references session_ctsr_scores(id) on delete set null,
  ctsr_item_id smallint not null references ctsr_items(id),
  transcript_turn_no integer,
  speaker text not null check (speaker in ('Therapist', 'Client', 'Unknown')),
  quote_text text not null,
  timestamp_label text,
  timestamp_seconds integer,
  polarity text not null default 'neutral' check (polarity in ('positive', 'negative', 'neutral')),
  source text not null default 'ai' check (source in ('ai', 'manual')),
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'rejected', 'manual')),
  review_note text,
  created_by bigint references users(id),
  reviewed_by bigint references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists evidence_quotes_session_item_status_idx
  on evidence_quotes (session_id, ctsr_item_id, status);

create index if not exists evidence_quotes_session_timestamp_idx
  on evidence_quotes (session_id, timestamp_seconds);

create table if not exists supervision_feedback (
  id bigint generated always as identity primary key,
  session_id bigint not null unique references therapy_sessions(id) on delete cascade,
  strengths text not null default '',
  growth_areas text not null default '',
  suggestions text not null default '',
  overall_comment text,
  created_by bigint references users(id),
  updated_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reports (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references organizations(id),
  session_id bigint not null references therapy_sessions(id) on delete cascade,
  format text not null check (format in ('pdf', 'docx')),
  status text not null default 'pending' check (status in ('pending', 'generated', 'failed')),
  included_sections jsonb not null default '{}'::jsonb,
  storage_key text,
  file_name text,
  file_size_bytes bigint,
  generated_by bigint references users(id),
  generated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists reports_session_created_idx
  on reports (session_id, created_at desc);

create table if not exists audit_logs (
  id bigint generated always as identity primary key,
  organization_id bigint not null references organizations(id),
  actor_user_id bigint references users(id),
  action text not null,
  entity_type text not null,
  entity_id bigint,
  entity_public_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_org_created_idx
  on audit_logs (organization_id, created_at desc, id desc);

create index if not exists audit_logs_entity_idx
  on audit_logs (entity_type, entity_id, created_at desc);
