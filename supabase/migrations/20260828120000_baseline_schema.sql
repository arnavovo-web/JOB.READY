-- =============================================================================
-- 0001 BASELINE SCHEMA
-- -----------------------------------------------------------------------------
-- JOB.READY was developed against a live Supabase project whose schema was
-- managed ad hoc (columns added directly with ALTER TABLE, no migration files).
-- This migration ESTABLISHES repository-tracked schema state for that existing
-- project. It is NOT a record of historical change — it is a full, current
-- snapshot of every database object the application code depends on.
--
-- IDEMPOTENT BY DESIGN. Every statement is `... if not exists`, `create or
-- replace`, or `drop ... if exists` + recreate. Running it against the existing
-- live database is a verified no-op: nothing is dropped, no row is touched, RLS
-- and policies are re-asserted to their current definitions. Running it against
-- a fresh database reproduces a schema compatible with the current code.
--
-- NOT INCLUDED (see supabase/README.md):
--   * the `ai-generate` Edge Function (separate deploy artifact)
--   * the `rls_auto_enable` event trigger (superuser-owned Supabase hardening;
--     this migration enables RLS explicitly on every table regardless)
--   * the legacy, code-unused `job-ready-documents` storage bucket
-- =============================================================================

-- gen_random_uuid() is in core Postgres (>= 13); this project is PG17. No extension needed.

-- =============================================================================
-- TABLES
-- =============================================================================

-- profiles: one row per auth user. Seeded by handle_new_user() (below).
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name  text,
  email      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- applications: one row per company/role the candidate is preparing for.
create table if not exists public.applications (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.profiles(id) on delete cascade,
  company                 text not null,
  role                    text not null,
  job_description         text,
  interview_stage         text,
  interview_type          text,
  interview_length        integer,
  interview_date          timestamptz,
  status                  text not null default 'active',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  jd_profile              jsonb,
  jd_profile_hash         text,
  application_intelligence jsonb
);
-- Catch-up for an older DB that has `applications` but not these later additions
-- (all no-ops on the current live DB, which already has every column):
alter table public.applications add column if not exists jd_profile              jsonb;
alter table public.applications add column if not exists jd_profile_hash         text;
alter table public.applications add column if not exists application_intelligence jsonb;

create table if not exists public.interviews (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.profiles(id) on delete cascade,
  application_id           uuid not null references public.applications(id) on delete cascade,
  overall_score           integer,
  readiness               text,
  status                  text not null default 'planned',
  started_at              timestamptz,
  completed_at            timestamptz,
  created_at              timestamptz not null default now(),
  stage                   text,
  format                  text,
  config                  jsonb,
  methodology_distribution jsonb
);
alter table public.interviews add column if not exists stage                   text;
alter table public.interviews add column if not exists format                  text;
alter table public.interviews add column if not exists config                  jsonb;
alter table public.interviews add column if not exists methodology_distribution jsonb;

create table if not exists public.interview_questions (
  id              uuid primary key default gen_random_uuid(),
  interview_id    uuid not null references public.interviews(id) on delete cascade,
  question_number integer not null,
  question_text   text not null,
  category        text,
  competency      text,
  created_at      timestamptz not null default now(),
  generation_mode text,
  prep_seconds    integer,
  answer_seconds  integer,
  metadata        jsonb,
  anchor_source   jsonb,
  constraint interview_questions_interview_number_unique unique (interview_id, question_number),
  constraint interview_questions_generation_mode_check
    check (generation_mode is null or generation_mode in ('independent', 'adaptive'))
);
alter table public.interview_questions add column if not exists generation_mode text;
alter table public.interview_questions add column if not exists prep_seconds    integer;
alter table public.interview_questions add column if not exists answer_seconds  integer;
alter table public.interview_questions add column if not exists metadata        jsonb;
alter table public.interview_questions add column if not exists anchor_source   jsonb;

create table if not exists public.answers (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.interview_questions(id) on delete cascade,
  answer_text  text not null,
  created_at   timestamptz not null default now(),
  time_expired boolean,
  constraint answers_question_id_unique unique (question_id)
);
alter table public.answers add column if not exists time_expired boolean;

create table if not exists public.evaluations (
  id                       uuid primary key default gen_random_uuid(),
  answer_id                uuid not null references public.answers(id) on delete cascade,
  relevance                integer,
  specificity              integer,
  structure                integer,
  evidence                 integer,
  clarity                  integer,
  competency_demonstration integer,
  strengths                jsonb not null default '[]'::jsonb,
  issues                   jsonb not null default '[]'::jsonb,
  decision                 text,
  created_at               timestamptz not null default now(),
  constraint evaluations_answer_id_unique unique (answer_id)
);

create table if not exists public.interview_reports (
  id                           uuid primary key default gen_random_uuid(),
  interview_id                  uuid not null references public.interviews(id) on delete cascade,
  overall_score                integer,
  readiness                    text,
  breakdown                    jsonb not null default '{}'::jsonb,
  strongest_areas              jsonb not null default '[]'::jsonb,
  weakest_areas                jsonb not null default '[]'::jsonb,
  per_question_feedback        jsonb not null default '[]'::jsonb,
  next_practice_focus          text,
  updated_candidate_weaknesses jsonb not null default '[]'::jsonb,
  updated_candidate_strengths  jsonb not null default '[]'::jsonb,
  interview_style_notes        jsonb not null default '[]'::jsonb,
  classroom_topics             jsonb not null default '[]'::jsonb,
  created_at                   timestamptz not null default now(),
  constraint interview_reports_interview_id_key unique (interview_id)
);

create table if not exists public.candidate_dna (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  strengths    jsonb not null default '[]'::jsonb,
  weaknesses   jsonb not null default '[]'::jsonb,
  style_notes  jsonb not null default '[]'::jsonb,
  common_issues jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now()
);

create table if not exists public.competency_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  competency  text not null,
  score       integer not null,
  source_type text not null,
  source_id   uuid,
  company     text,
  role        text,
  created_at  timestamptz not null default now()
);

create table if not exists public.interview_memory (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  interview_id  uuid references public.interviews(id) on delete cascade,
  question_text text not null,
  category      text,
  competency    text,
  score         integer,
  company       text,
  role          text,
  answer_text   text,
  created_at    timestamptz not null default now()
);

create table if not exists public.memory_comparisons (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  interview_id       uuid not null references public.interviews(id) on delete cascade,
  question_text      text not null,
  previous_memory_id uuid references public.interview_memory(id) on delete set null,
  previous_score     integer,
  current_score      integer,
  improvement        integer,
  created_at         timestamptz not null default now()
);

create table if not exists public.classroom_topics (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  application_id     uuid references public.applications(id) on delete cascade,
  company           text,
  role              text,
  topic             text not null,
  category          text not null default 'general',
  description       text,
  related_question  text,
  scores            jsonb not null default '[]'::jsonb,
  last_interview_id uuid references public.interviews(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.classroom_lessons (
  id                     uuid primary key default gen_random_uuid(),
  topic_id               uuid not null references public.classroom_topics(id) on delete cascade,
  title                  text not null,
  why_it_matters         text,
  core_knowledge         jsonb not null default '[]'::jsonb,
  key_points             jsonb not null default '[]'::jsonb,
  example_answer_snippet text,
  interview_application   text,
  quick_check            jsonb not null default '[]'::jsonb,
  grounding_note         text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table if not exists public.classroom_quiz_results (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  topic_id     uuid not null references public.classroom_topics(id) on delete cascade,
  lesson_id    uuid references public.classroom_lessons(id) on delete set null,
  answers      jsonb not null default '{}'::jsonb,
  score        integer,
  total        integer,
  completed_at timestamptz not null default now(),
  constraint quiz_results_user_topic_unique unique (user_id, topic_id)
);

create table if not exists public.assessment_attempts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,
  type          text not null,
  type_label    text,
  company       text,
  role          text,
  overall_score integer,
  breakdown     jsonb not null default '{}'::jsonb,
  scenario      jsonb,
  submission    text,
  result        jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists public.candidate_claims (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  application_id            uuid references public.applications(id) on delete set null,
  origin_interview_id      uuid references public.interviews(id) on delete set null,
  claim_text               text not null,
  category                 text,
  source                   text not null default 'cv',
  status                   text not null default 'unverified',
  confidence               text not null default 'low',
  evidence                 jsonb not null default '[]'::jsonb,
  evidence_count           integer not null default 0,
  last_tested_interview_id uuid references public.interviews(id) on delete set null,
  last_tested_at           timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint candidate_claims_source_check
    check (source in ('cv', 'interview', 'candidate_input')),
  constraint candidate_claims_status_check
    check (status in ('unverified', 'partially_supported', 'supported', 'contradicted')),
  constraint candidate_claims_confidence_check
    check (confidence in ('low', 'medium', 'high'))
);

create table if not exists public.documents (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  application_id  uuid references public.applications(id) on delete cascade,
  document_type  text not null,
  filename       text not null,
  storage_path   text,
  mime_type      text,
  file_size      bigint,
  extracted_text text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ai_usage / api_usage_limits: written by the `ai-generate` Edge Function
-- (server side). The browser client only ever SELECTs its own ai_usage rows.
create table if not exists public.ai_usage (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  application_id  uuid references public.applications(id) on delete set null,
  interview_id   uuid references public.interviews(id) on delete set null,
  request_type   text not null,
  model          text,
  input_tokens   integer,
  output_tokens  integer,
  estimated_cost numeric,
  status         text not null default 'completed',
  created_at     timestamptz not null default now()
);

create table if not exists public.api_usage_limits (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count     integer not null default 0,
  updated_at        timestamptz not null default now()
);

-- =============================================================================
-- INDEXES (foreign-key / lookup indexes; PK & UNIQUE indexes come with the constraints)
-- =============================================================================
create index if not exists ai_usage_application_id_idx            on public.ai_usage            (application_id);
create index if not exists ai_usage_created_at_idx                on public.ai_usage            (created_at);
create index if not exists ai_usage_interview_id_idx              on public.ai_usage            (interview_id);
create index if not exists ai_usage_user_id_idx                   on public.ai_usage            (user_id);
create index if not exists answers_question_id_idx                on public.answers             (question_id);
create index if not exists applications_user_id_idx               on public.applications        (user_id);
create index if not exists assessment_attempts_application_id_idx on public.assessment_attempts (application_id);
create index if not exists assessment_attempts_user_id_idx        on public.assessment_attempts (user_id);
create index if not exists candidate_claims_application_id_idx    on public.candidate_claims    (application_id);
create index if not exists candidate_claims_last_tested_interview_id_idx on public.candidate_claims (last_tested_interview_id);
create index if not exists candidate_claims_origin_interview_id_idx on public.candidate_claims  (origin_interview_id);
create index if not exists candidate_claims_user_id_idx           on public.candidate_claims    (user_id);
create index if not exists candidate_claims_user_status_idx       on public.candidate_claims    (user_id, status);
create index if not exists classroom_lessons_topic_id_idx         on public.classroom_lessons   (topic_id);
create index if not exists classroom_quiz_results_lesson_id_idx   on public.classroom_quiz_results (lesson_id);
create index if not exists classroom_quiz_results_topic_id_idx    on public.classroom_quiz_results (topic_id);
create index if not exists classroom_quiz_results_user_id_idx     on public.classroom_quiz_results (user_id);
create index if not exists classroom_topics_application_id_idx    on public.classroom_topics    (application_id);
create index if not exists classroom_topics_last_interview_id_idx on public.classroom_topics    (last_interview_id);
create index if not exists classroom_topics_user_id_idx           on public.classroom_topics    (user_id);
create index if not exists competency_history_user_id_idx         on public.competency_history  (user_id);
create index if not exists documents_application_id_idx           on public.documents           (application_id);
create index if not exists documents_user_id_idx                  on public.documents           (user_id);
create index if not exists evaluations_answer_id_idx              on public.evaluations         (answer_id);
create index if not exists interview_memory_interview_id_idx      on public.interview_memory    (interview_id);
create index if not exists interview_memory_user_id_idx           on public.interview_memory    (user_id);
create index if not exists interview_questions_interview_id_idx   on public.interview_questions (interview_id);
create index if not exists interviews_application_id_idx          on public.interviews          (application_id);
create index if not exists interviews_user_id_idx                 on public.interviews          (user_id);
create index if not exists memory_comparisons_interview_id_idx    on public.memory_comparisons  (interview_id);
create index if not exists memory_comparisons_previous_memory_id_idx on public.memory_comparisons (previous_memory_id);
create index if not exists memory_comparisons_user_id_idx         on public.memory_comparisons  (user_id);

-- =============================================================================
-- ROW LEVEL SECURITY
-- `enable row level security` is idempotent (no error if already enabled).
-- Policies are dropped + recreated so this file always reflects their current
-- definition without ever erroring on a second run.
-- =============================================================================
alter table public.profiles              enable row level security;
alter table public.applications          enable row level security;
alter table public.interviews            enable row level security;
alter table public.interview_questions   enable row level security;
alter table public.answers               enable row level security;
alter table public.evaluations           enable row level security;
alter table public.interview_reports     enable row level security;
alter table public.candidate_dna         enable row level security;
alter table public.competency_history    enable row level security;
alter table public.interview_memory      enable row level security;
alter table public.memory_comparisons    enable row level security;
alter table public.classroom_topics      enable row level security;
alter table public.classroom_lessons     enable row level security;
alter table public.classroom_quiz_results enable row level security;
alter table public.assessment_attempts   enable row level security;
alter table public.candidate_claims      enable row level security;
alter table public.documents             enable row level security;
alter table public.ai_usage              enable row level security;
alter table public.api_usage_limits      enable row level security;

-- ---- direct user-owned tables: user_id = auth.uid() -------------------------
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists applications_self on public.applications;
create policy applications_self on public.applications
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists interviews_self on public.interviews;
create policy interviews_self on public.interviews
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists dna_self on public.candidate_dna;
create policy dna_self on public.candidate_dna
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists competency_history_self on public.competency_history;
create policy competency_history_self on public.competency_history
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists memory_self on public.interview_memory;
create policy memory_self on public.interview_memory
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists memory_comparisons_self on public.memory_comparisons;
create policy memory_comparisons_self on public.memory_comparisons
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists classroom_topics_self on public.classroom_topics;
create policy classroom_topics_self on public.classroom_topics
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists quiz_results_self on public.classroom_quiz_results;
create policy quiz_results_self on public.classroom_quiz_results
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists assessment_attempts_self on public.assessment_attempts;
create policy assessment_attempts_self on public.assessment_attempts
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists candidate_claims_self on public.candidate_claims;
create policy candidate_claims_self on public.candidate_claims
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists documents_self on public.documents;
create policy documents_self on public.documents
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---- ai_usage / api_usage_limits: read-own, plus self-scoped writes --------
drop policy if exists ai_usage_self on public.ai_usage;
create policy ai_usage_self on public.ai_usage
  for select using (user_id = (select auth.uid()));
drop policy if exists ai_usage_insert_self on public.ai_usage;
create policy ai_usage_insert_self on public.ai_usage
  for insert with check (user_id = (select auth.uid()));

drop policy if exists api_usage_limits_self on public.api_usage_limits;
create policy api_usage_limits_self on public.api_usage_limits
  for select using (user_id = (select auth.uid()));
drop policy if exists api_usage_limits_insert_self on public.api_usage_limits;
create policy api_usage_limits_insert_self on public.api_usage_limits
  for insert with check (user_id = (select auth.uid()));
drop policy if exists api_usage_limits_update_self on public.api_usage_limits;
create policy api_usage_limits_update_self on public.api_usage_limits
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---- child tables: ownership proven by joining up to interviews ------------
drop policy if exists questions_via_interview_owner on public.interview_questions;
create policy questions_via_interview_owner on public.interview_questions
  for all using (exists (
    select 1 from public.interviews i
    where i.id = interview_questions.interview_id and i.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.interviews i
    where i.id = interview_questions.interview_id and i.user_id = (select auth.uid())
  ));

drop policy if exists answers_via_interview_owner on public.answers;
create policy answers_via_interview_owner on public.answers
  for all using (exists (
    select 1 from public.interview_questions q
    join public.interviews i on i.id = q.interview_id
    where q.id = answers.question_id and i.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.interview_questions q
    join public.interviews i on i.id = q.interview_id
    where q.id = answers.question_id and i.user_id = (select auth.uid())
  ));

drop policy if exists evaluations_via_interview_owner on public.evaluations;
create policy evaluations_via_interview_owner on public.evaluations
  for all using (exists (
    select 1 from public.answers a
    join public.interview_questions q on q.id = a.question_id
    join public.interviews i on i.id = q.interview_id
    where a.id = evaluations.answer_id and i.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.answers a
    join public.interview_questions q on q.id = a.question_id
    join public.interviews i on i.id = q.interview_id
    where a.id = evaluations.answer_id and i.user_id = (select auth.uid())
  ));

drop policy if exists reports_via_interview_owner on public.interview_reports;
create policy reports_via_interview_owner on public.interview_reports
  for all using (exists (
    select 1 from public.interviews i
    where i.id = interview_reports.interview_id and i.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.interviews i
    where i.id = interview_reports.interview_id and i.user_id = (select auth.uid())
  ));

drop policy if exists classroom_lessons_via_topic_owner on public.classroom_lessons;
create policy classroom_lessons_via_topic_owner on public.classroom_lessons
  for all using (exists (
    select 1 from public.classroom_topics t
    where t.id = classroom_lessons.topic_id and t.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.classroom_topics t
    where t.id = classroom_lessons.topic_id and t.user_id = (select auth.uid())
  ));

-- =============================================================================
-- FUNCTIONS & TRIGGERS
-- =============================================================================

-- Seed public.profiles + public.candidate_dna when a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  insert into public.candidate_dna (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Create the trigger only if it isn't already present. (Guarded rather than
-- drop+recreate: on the existing project the trigger already exists and belongs
-- to a privileged role, so we must not attempt to drop it here.)
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'on_auth_user_created'
      and tgrelid = 'auth.users'::regclass
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end$$;

-- =============================================================================
-- STORAGE
-- Private bucket for CVs / job descriptions. `storage_path` on public.documents
-- points into this bucket. Objects are foldered by auth uid: <uid>/<app>/<file>.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 10485760,
  array['text/plain', 'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

drop policy if exists documents_read_own_objects on storage.objects;
create policy documents_read_own_objects on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and owner_id = (select (auth.uid())::text));

drop policy if exists documents_upload_own_folder on storage.objects;
create policy documents_upload_own_folder on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select (auth.uid())::text)
  );

drop policy if exists documents_update_own_objects on storage.objects;
create policy documents_update_own_objects on storage.objects
  for update to authenticated
  using (bucket_id = 'documents' and owner_id = (select (auth.uid())::text))
  with check (bucket_id = 'documents' and owner_id = (select (auth.uid())::text));

drop policy if exists documents_delete_own_objects on storage.objects;
create policy documents_delete_own_objects on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and owner_id = (select (auth.uid())::text));
