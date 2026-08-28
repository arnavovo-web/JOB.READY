-- =============================================================================
-- DEVELOPMENT MODULES (Phase 14)
-- -----------------------------------------------------------------------------
-- First repo-tracked incremental migration after 20260828120000_baseline_schema.
-- This exact version is already recorded in the live project's migration ledger
-- (it was applied through the Supabase management API); the file here is the
-- committed source of truth for a fresh environment.
--
-- Purely additive. Two new tables that power the Classroom development loop:
--   development_modules          one AI-generated, reusable learning module per
--                                diagnosed development need (classroom_topics row).
--                                Powers: learning guide + flashcards + written
--                                quiz + deterministic concept coverage — all
--                                WITHOUT any further AI call.
--   development_module_progress  per-user learning progress against a module
--                                (flashcards seen, last written-quiz attempt,
--                                best coverage, redo-question captures).
--
-- Idempotent (`create table if not exists`, `drop policy if exists` + create).
-- Does NOT touch the baseline or any existing table. RLS is explicit, matching
-- the repo convention: development_modules is scoped through its owning
-- classroom_topics row (same pattern as classroom_lessons); progress is scoped
-- directly by user_id.
-- =============================================================================

create table if not exists public.development_modules (
  id                  uuid primary key default gen_random_uuid(),
  topic_id            uuid not null unique references public.classroom_topics(id) on delete cascade,
  user_id             uuid not null references public.profiles(id) on delete cascade,
  dimension           text not null default 'behavioural'
                        check (dimension in ('technical', 'behavioural', 'motivational')),
  topic               text not null,
  why_it_matters      text,
  context_note        text,
  -- snapshots taken at build time so the learning->retry loop stays intact even
  -- if the source classroom_topics row is later updated by a new interview.
  source_question     text,
  source_category     text,
  source_interview_id uuid references public.interviews(id) on delete set null,
  source_fingerprint  text,
  -- the single generation call's structured output:
  learning_guide      jsonb not null default '{}'::jsonb,   -- { core_explanation, frameworks[], examples[], common_mistakes[], application_context }
  learning_items      jsonb not null default '[]'::jsonb,    -- [{ concept, explanation, flashcard_front, flashcard_back,
                                                             --    quiz_question, model_answer, review,
                                                             --    expected_concepts:[{ label, accepted_terms[] }] }]
  generation_meta     jsonb not null default '{}'::jsonb,    -- { model, generated_at, grounded_from[] }
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists development_modules_topic_id_idx on public.development_modules (topic_id);
create index if not exists development_modules_user_id_idx   on public.development_modules (user_id);

create table if not exists public.development_module_progress (
  id              uuid primary key default gen_random_uuid(),
  module_id       uuid not null references public.development_modules(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  flashcards_seen integer not null default 0,
  last_quiz       jsonb not null default '{}'::jsonb,   -- { started_at, order[], answers:[{ itemIdx, text, covered[], missing[], coverage:{n,total} }], completed_at }
  best_coverage   numeric,
  attempts        integer not null default 0,
  retry_answers   jsonb not null default '[]'::jsonb,   -- [{ answered_at, text, source_question }]  (no score — see Phase 14 report)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint development_module_progress_module_user_unique unique (module_id, user_id)
);
create index if not exists development_module_progress_module_id_idx on public.development_module_progress (module_id);
create index if not exists development_module_progress_user_id_idx   on public.development_module_progress (user_id);

alter table public.development_modules         enable row level security;
alter table public.development_module_progress enable row level security;

-- development_modules: reachable only through a classroom_topics row the caller owns
drop policy if exists development_modules_via_topic_owner on public.development_modules;
create policy development_modules_via_topic_owner on public.development_modules
  for all using (exists (
    select 1 from public.classroom_topics t
    where t.id = development_modules.topic_id and t.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.classroom_topics t
    where t.id = development_modules.topic_id and t.user_id = (select auth.uid())
  ));

drop policy if exists development_module_progress_self on public.development_module_progress;
create policy development_module_progress_self on public.development_module_progress
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
