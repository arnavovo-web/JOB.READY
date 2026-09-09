-- =============================================================================
-- EKI² — INTELLIGENCE PLATFORM (final product-completeness push)
-- -----------------------------------------------------------------------------
-- One deterministic per-student analytics engine feeds ten connected
-- capabilities: no-contact detection, stuck detection, Interview DNA evolution,
-- programme employability pulse, resource recommendations, personalised
-- development plans, student trajectory, follow-up automation, and
-- programme-level intelligence. The adviser briefing (a thin optional AI
-- synthesis) is deployed separately as an Edge Function; nothing here calls an
-- LLM — every figure is SQL.
--
-- REUSE, NEVER DUPLICATE: student identity / applications / interviews /
-- evaluations / competency_history / cohorts / institution_staff / appointments
-- / appointment_outcomes / careers_messages all stay the source of truth. New
-- objects: `resources`, `development_plans`, `development_plan_items`,
-- `adviser_briefings`, one `appointment_outcomes` follow-up column, and a set of
-- SECURITY DEFINER RPCs that self-authorise exactly like eki_student_briefing.
--
-- SECURITY: institution-scoped + cohort-membership + staff-role, RLS on every
-- new table, k-anonymity (MIN_COHORT_N = 5) on every INSTITUTIONAL AGGREGATE
-- (programme pulse included). Student-facing RPCs return ONLY the caller's own
-- data. Adviser notes are never exposed to a student path.
--
-- Idempotent, additive. Timestamped after
-- 20260909210000_careers_performance_intervention.sql.
-- =============================================================================

-- =============================================================================
-- 0. SHARED DETERMINISTIC HELPERS
-- =============================================================================

-- Trajectory classification — the SINGLE definition, reused everywhere.
--   improving   : gained >= 6 overall AND still moving up recently (>= +2)
--   declining   : lost >= 6 overall OR a sharp recent drop (<= -4)
--   plateauing  : >= 4 attempts, flat recently (|recent| < 3) AND last-3 span < 4
--   stable      : some movement, not decisively any of the above
--   insufficient_data : < 3 attempts
create or replace function public.jr_classify_trajectory(
  p_n int, p_first numeric, p_last numeric, p_recent_delta numeric, p_last3_span numeric
)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when p_n is null or p_n < 3 or p_first is null or p_last is null then 'insufficient_data'
    when (p_last - p_first) >= 6 and coalesce(p_recent_delta, 0) >= 2 then 'improving'
    when (p_last - p_first) <= -6 or coalesce(p_recent_delta, 0) <= -4 then 'declining'
    when p_n >= 4 and abs(coalesce(p_recent_delta, 0)) < 3 and coalesce(p_last3_span, 99) < 4 then 'plateauing'
    else 'stable'
  end
$$;

-- Readiness group from a mean practice score (mirrors taxonomy.readinessGroup).
create or replace function public.jr_readiness_group(p_mean numeric)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when p_mean is null then null
    when p_mean >= 70 then 'ready'
    when p_mean >= 55 then 'developing'
    else 'needs_support'
  end
$$;

-- Per-student overall interview series + derived trajectory inputs, for the
-- students in `p_students`, over an optional window. One row per student.
create or replace function public.jr_student_trajectory_rows(
  p_students uuid[], p_from timestamptz default null, p_to timestamptz default null
)
returns table (
  student_id uuid, n_interviews int, first_score numeric, latest_score numeric,
  mean_score numeric, latest_at timestamptz, first_at timestamptz,
  overall_delta numeric, recent_delta numeric, last3_span numeric, trajectory text,
  first_group text, latest_group text
)
language sql
stable
set search_path to 'public'
as $$
  with iv as (
    select i.user_id,
           coalesce(ir.overall_score, i.overall_score)::numeric score,
           coalesce(i.completed_at, i.created_at) at,
           row_number() over (partition by i.user_id order by coalesce(i.completed_at, i.created_at)) rn,
           count(*) over (partition by i.user_id) n
      from public.interviews i
      left join public.interview_reports ir on ir.interview_id = i.id
     where i.user_id = any(p_students) and i.status = 'completed'
       and coalesce(ir.overall_score, i.overall_score) is not null
       and (p_from is null or coalesce(i.completed_at, i.created_at) >= p_from)
       and (p_to   is null or coalesce(i.completed_at, i.created_at) <= p_to)
  ),
  agg as (
    select user_id,
           max(n)::int n,
           (array_agg(score order by rn))[1] first_score,
           (array_agg(score order by rn desc))[1] latest_score,
           round(avg(score)) mean_score,
           min(at) first_at, max(at) latest_at,
           (array_agg(score order by rn desc))[1]
             - (array_agg(score order by rn desc))[least(3, max(n)::int)] recent_delta,
           (select max(s) - min(s) from unnest(
              (array_agg(score order by rn desc))[1:least(3, max(n)::int)]) s) last3_span
      from iv group by user_id
  )
  select a.user_id,
         a.n,
         a.first_score, a.latest_score, a.mean_score, a.latest_at, a.first_at,
         (a.latest_score - a.first_score) overall_delta,
         a.recent_delta, a.last3_span,
         public.jr_classify_trajectory(a.n, a.first_score, a.latest_score, a.recent_delta, a.last3_span),
         public.jr_readiness_group(a.first_score),
         public.jr_readiness_group(a.latest_score)
    from agg a
$$;

-- Per-student per-competency latest mean + earliest mean (Interview DNA evolution
-- inputs), from competency_history (source_type = 'interview').
create or replace function public.jr_student_dna_rows(p_students uuid[])
returns table (
  student_id uuid, competency text, earliest_score numeric, latest_score numeric, n_points int
)
language sql
stable
set search_path to 'public'
as $$
  with ch as (
    select user_id, competency, source_id iid, score::numeric score, created_at
      from public.competency_history
     where user_id = any(p_students) and source_type = 'interview'
       and competency in ('relevance','specificity','structure','evidence','communication','competency_demonstration')
  ),
  ord as (
    select user_id, competency, iid, score,
           row_number() over (partition by user_id, competency order by created_at) rn,
           count(*) over (partition by user_id, competency) n
      from ch
  )
  select user_id, competency,
         round(avg(score) filter (where rn = 1)) earliest_score,
         round(avg(score) filter (where rn = n)) latest_score,
         max(n)::int n_points
    from ord group by user_id, competency
$$;

-- =============================================================================
-- 1. RESOURCES  — lightweight extensible recommendation model
-- =============================================================================
create table if not exists public.resources (
  id               uuid primary key default gen_random_uuid(),
  institution_id   uuid references public.institutions(id) on delete cascade,  -- null = global
  title            text not null check (char_length(title) between 1 and 200),
  description      text check (description is null or char_length(description) <= 1000),
  type             text not null default 'guide' check (type in ('guide','exercise','practice','workshop','video','template','other')),
  competency       text check (competency is null or competency in
                     ('relevance','specificity','structure','evidence','communication','competency_demonstration')),
  career_path      text,
  difficulty       text check (difficulty is null or difficulty in ('intro','core','advanced')),
  duration_minutes int check (duration_minutes is null or duration_minutes between 1 and 600),
  url              text check (url is null or char_length(url) <= 2000),
  active           boolean not null default true,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists resources_lookup_idx on public.resources (competency, active) where active;
create index if not exists resources_institution_idx on public.resources (institution_id);

alter table public.resources enable row level security;

drop policy if exists resources_read on public.resources;
create policy resources_read on public.resources
  for select using (
    active and (
      institution_id is null
      or public.jr_inst_role(institution_id) is not null
      or institution_id in (select public.jr_student_institution_ids())
    )
  );
drop policy if exists resources_manage on public.resources;
create policy resources_manage on public.resources
  for all using (institution_id is not null and public.jr_inst_can_manage(institution_id))
  with check (institution_id is not null and public.jr_inst_can_manage(institution_id));

-- seed: two global resources per competency dimension
insert into public.resources (institution_id, title, description, type, competency, difficulty, duration_minutes, url) values
  (null, 'Building stronger evidence-based interview answers', 'Turn experiences into specific, credible examples using concrete detail and outcomes.', 'guide', 'evidence', 'core', 10, null),
  (null, 'Evidence bank exercise', 'Draft five STAR examples you can reuse across competency questions.', 'exercise', 'evidence', 'core', 20, null),
  (null, 'Answering the exact question asked', 'Spot what a question is really testing and keep your answer on target.', 'guide', 'relevance', 'intro', 8, null),
  (null, 'Relevance drill', 'Practise re-framing a rambling answer into a direct one.', 'practice', 'relevance', 'core', 15, null),
  (null, 'Adding concrete detail to your answers', 'Replace generalities with numbers, names and specifics.', 'guide', 'specificity', 'intro', 8, null),
  (null, 'Specificity practice set', 'Rewrite three vague answers with concrete detail.', 'exercise', 'specificity', 'core', 15, null),
  (null, 'Structuring answers with STAR', 'A clear, followable shape for behavioural answers.', 'guide', 'structure', 'intro', 10, null),
  (null, 'Answer-structure exercise', 'Practise opening, signposting and closing an answer cleanly.', 'exercise', 'structure', 'core', 15, null),
  (null, 'Clear, concise interview delivery', 'Cut filler, land the point, and keep answers to time.', 'guide', 'communication', 'core', 10, null),
  (null, 'Mock interview: delivery focus', 'One short mock focused only on clarity and concision.', 'practice', 'communication', 'core', 20, null),
  (null, 'Demonstrating the skill each question targets', 'Make the competency behind a question obvious in your answer.', 'guide', 'competency_demonstration', 'core', 10, null),
  (null, 'Competency-signalling exercise', 'Tag each of your examples with the competency it best shows.', 'exercise', 'competency_demonstration', 'core', 15, null),
  (null, '"Why this company?" practice guide', 'Build a specific, researched motivation answer.', 'guide', null, 'intro', 10, null),
  (null, 'Commercial awareness starter', 'Follow one sector and one company for two weeks; note three developments.', 'exercise', null, 'core', 30, null)
on conflict do nothing;

-- =============================================================================
-- 2. DEVELOPMENT PLANS
-- =============================================================================
create table if not exists public.development_plans (
  id               uuid primary key default gen_random_uuid(),
  institution_id   uuid not null references public.institutions(id) on delete cascade,
  student_id       uuid not null references public.profiles(id) on delete cascade,
  development_area  text check (development_area is null or development_area in
                     ('relevance','specificity','structure','evidence','communication','competency_demonstration')),
  title            text not null check (char_length(title) between 1 and 200),
  description      text check (description is null or char_length(description) <= 2000),
  goal_target      int check (goal_target is null or goal_target between 0 and 100),
  status           text not null default 'active' check (status in ('active','in_progress','completed','archived')),
  resource_id      uuid references public.resources(id) on delete set null,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  review_date      date,
  completed_at     timestamptz,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id) on delete set null
);
create index if not exists development_plans_student_idx on public.development_plans (student_id, status);
create index if not exists development_plans_institution_idx on public.development_plans (institution_id);
create index if not exists development_plans_review_idx on public.development_plans (institution_id, review_date) where status in ('active','in_progress');

create table if not exists public.development_plan_items (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.development_plans(id) on delete cascade,
  kind        text not null check (kind in ('resource','practice','goal','action')),
  label       text not null check (char_length(label) between 1 and 300),
  status      text not null default 'todo' check (status in ('todo','in_progress','done')),
  sort_order  int not null default 100,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists development_plan_items_plan_idx on public.development_plan_items (plan_id, sort_order);

alter table public.development_plans enable row level security;
alter table public.development_plan_items enable row level security;

-- a student reads their OWN plans; staff read their institution's. NO client
-- writes — every mutation goes through a SECURITY DEFINER RPC.
drop policy if exists development_plans_student_read on public.development_plans;
create policy development_plans_student_read on public.development_plans
  for select using (student_id = (select auth.uid()));
drop policy if exists development_plans_staff_read on public.development_plans;
create policy development_plans_staff_read on public.development_plans
  for select using (public.jr_inst_role(institution_id) is not null);

drop policy if exists development_plan_items_student_read on public.development_plan_items;
create policy development_plan_items_student_read on public.development_plan_items
  for select using (plan_id in (select id from public.development_plans where student_id = (select auth.uid())));
drop policy if exists development_plan_items_staff_read on public.development_plan_items;
create policy development_plan_items_staff_read on public.development_plan_items
  for select using (plan_id in (select id from public.development_plans where public.jr_inst_role(institution_id) is not null));

-- =============================================================================
-- 3. ADVISER BRIEFINGS  — persisted synthesis (staff-only), avoids re-cost
-- =============================================================================
create table if not exists public.adviser_briefings (
  id               uuid primary key default gen_random_uuid(),
  institution_id   uuid not null references public.institutions(id) on delete cascade,
  student_id       uuid not null references public.profiles(id) on delete cascade,
  appointment_id   uuid references public.appointments(id) on delete cascade,
  briefing_text    text not null check (char_length(briefing_text) <= 8000),
  discussion_points jsonb not null default '[]'::jsonb,
  generated_by     text not null default 'deterministic' check (generated_by in ('deterministic','ai')),
  model            text,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id) on delete set null
);
create unique index if not exists adviser_briefings_appt_uidx on public.adviser_briefings (appointment_id) where appointment_id is not null;
create index if not exists adviser_briefings_student_idx on public.adviser_briefings (institution_id, student_id, created_at desc);

alter table public.adviser_briefings enable row level security;
drop policy if exists adviser_briefings_staff_read on public.adviser_briefings;
create policy adviser_briefings_staff_read on public.adviser_briefings
  for select using (public.jr_inst_role(institution_id) is not null);
-- NO student policy. NO client write policy.

-- follow-up completion + due date on the existing outcome record
alter table public.appointment_outcomes
  add column if not exists follow_up_due          date,
  add column if not exists follow_up_completed_at timestamptz,
  add column if not exists follow_up_completed_by uuid references public.profiles(id) on delete set null;

-- =============================================================================
-- 4. eki_student_intelligence — the shared per-student engine (staff workflow)
-- -----------------------------------------------------------------------------
-- Staff-gated + scope-gated via jr_inst_scope_student_ids (raises 42501 for a
-- non-staff / wrong-institution caller). Returns the authorised per-student
-- roster used by No-Contact, Stuck, Follow-up prioritisation and trajectory
-- chips, plus institution summary counts + term movement. NOT k-anonymised
-- (authorised individual workflow, cf. eki_student_briefing); no transcript.
-- =============================================================================
create or replace function public.eki_student_intelligence(
  p_institution_id uuid, p_cohort_ids uuid[] default null,
  p_from timestamptz default null, p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c_target constant int := 70;
  c_nc_min_interviews constant int := 3;
  c_nc_min_gap constant int := 5;
  c_stuck_eps constant int := 3;
  v_students uuid[];
begin
  select array_agg(s) into v_students
    from public.jr_inst_scope_student_ids(p_institution_id, p_cohort_ids) s;
  v_students := coalesce(v_students, '{}');

  return (
  with tr as (
    select * from public.jr_student_trajectory_rows(v_students, p_from, p_to)
  ),
  dna as (
    select student_id,
           (array_agg(competency order by latest_score asc))[1] weakest_dim
      from public.jr_student_dna_rows(v_students) group by student_id
  ),
  contact as (
    select ap.student_id,
           bool_or(ap.status = 'completed') has_completed_appt,
           count(*) filter (where ap.status in ('booked','completed','no_show')) appt_count,
           max(sl.starts_at) filter (where ap.status = 'completed') last_contact_at
      from public.appointments ap
      left join public.appointment_slots sl on sl.id = ap.slot_id
     where ap.institution_id = p_institution_id and ap.student_id = any(v_students)
     group by ap.student_id
  ),
  outc as (
    select ap.student_id, bool_or(true) has_outcome
      from public.appointment_outcomes o
      join public.appointments ap on ap.id = o.appointment_id
     where ap.institution_id = p_institution_id and ap.student_id = any(v_students)
     group by ap.student_id
  ),
  srow as (
    select tr.student_id,
           (select nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '')
              from public.profiles p where p.id = tr.student_id) name,
           tr.n_interviews, tr.first_score, tr.latest_score, tr.mean_score,
           tr.overall_delta, tr.recent_delta, tr.trajectory,
           tr.latest_at, tr.first_group, tr.latest_group,
           tr.latest_group readiness_group,
           d.weakest_dim main_development_area,
           coalesce(c.has_completed_appt, false) has_completed_appointment,
           coalesce(o.has_outcome, false) has_outcome,
           coalesce(c.appt_count, 0) appointment_count,
           c.last_contact_at,
           greatest(0, c_target - tr.mean_score) gap_from_target,
           ((tr.n_interviews >= c_nc_min_interviews)
             and tr.latest_score < c_target
             and (c_target - tr.mean_score) >= c_nc_min_gap
             and not coalesce(c.has_completed_appt, false)
             and not coalesce(o.has_outcome, false)) no_prior_contact,
           ((tr.n_interviews >= c_nc_min_interviews)
             and tr.latest_score < c_target
             and tr.trajectory in ('plateauing','stable','declining')
             and coalesce(tr.recent_delta, 0) < c_stuck_eps
             and (not coalesce(c.has_completed_appt, false)
                  or tr.latest_at > coalesce(c.last_contact_at, 'epoch'::timestamptz))) is_stuck
      from tr
      left join dna d on d.student_id = tr.student_id
      left join contact c on c.student_id = tr.student_id
      left join outc o on o.student_id = tr.student_id
  )
  select jsonb_build_object(
    'supported', true, 'min_n', 5, 'readiness_target', c_target,
    'generated_at', now(),
    'thresholds', jsonb_build_object(
      'no_contact_min_interviews', c_nc_min_interviews, 'no_contact_min_gap', c_nc_min_gap,
      'stuck_recent_epsilon', c_stuck_eps),
    'scope', jsonb_build_object('institution_id', p_institution_id, 'cohort_ids', to_jsonb(p_cohort_ids),
      'from', p_from, 'to', p_to,
      'students_in_scope', coalesce(array_length(v_students,1),0),
      'students_assessed', (select count(*) from srow)),
    'summary', jsonb_build_object(
      'assessed', (select count(*) from srow),
      'no_contact', (select count(*) from srow where no_prior_contact),
      'stuck', (select count(*) from srow where is_stuck),
      'improving', (select count(*) from srow where trajectory = 'improving'),
      'plateauing', (select count(*) from srow where trajectory = 'plateauing'),
      'declining', (select count(*) from srow where trajectory = 'declining')),
    'movement', jsonb_build_object(
      'needs_support_to_developing', (select count(*) from srow where first_group='needs_support' and latest_group in ('developing','ready')),
      'developing_to_ready', (select count(*) from srow where first_group in ('needs_support','developing') and latest_group='ready'),
      'slipped_back', (select count(*) from srow where
         array_position(array['needs_support','developing','ready'], latest_group)
         < array_position(array['needs_support','developing','ready'], first_group))),
    'students', (select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', student_id, 'name', name,
        'readiness_group', readiness_group,
        'n_interviews', n_interviews, 'first_score', first_score, 'latest_score', latest_score,
        'mean_score', mean_score, 'overall_delta', overall_delta, 'trajectory', trajectory,
        'main_development_area', main_development_area,
        'gap_from_target', gap_from_target,
        'last_practice_at', latest_at,
        'appointment_count', appointment_count, 'last_contact_at', last_contact_at,
        'careers_contact', case when has_completed_appointment or has_outcome then 'contacted' else 'none' end,
        'no_prior_contact', no_prior_contact, 'is_stuck', is_stuck,
        'no_contact_priority', round((greatest(0, gap_from_target)) * ln(n_interviews + 1))
      ) order by is_stuck desc, no_prior_contact desc, gap_from_target desc), '[]'::jsonb) from srow)
  ));
end;
$$;

-- =============================================================================
-- 5. eki_programme_pulse — programme (= cohort) aggregates, k-ANONYMISED
-- -----------------------------------------------------------------------------
-- "Programme" is the cohort (documented heuristic — the only membership-backed
-- grouping in the schema). Every programme with fewer than MIN_COHORT_N (5)
-- assessed students returns { suppressed: true } and no figures.
-- =============================================================================
create or replace function public.eki_programme_pulse(
  p_institution_id uuid, p_from timestamptz default null, p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c_min_n constant int := 5;
  c_target constant int := 70;
begin
  if public.jr_inst_role(p_institution_id) is null then
    raise exception 'not authorised for this institution' using errcode = '42501';
  end if;

  return (
  with cohort_students as (
    select c.id cohort_id, c.name cohort_name, cm.student_id
      from public.cohorts c
      join public.cohort_members cm on cm.cohort_id = c.id
     where c.institution_id = p_institution_id and cm.student_id is not null and cm.status <> 'removed'
  ),
  tr as (
    select cs.cohort_id, cs.cohort_name, t.*
      from cohort_students cs
      join lateral public.jr_student_trajectory_rows(array[cs.student_id]::uuid[], p_from, p_to) t on true
  ),
  dna as (
    select cs.cohort_id, r.competency, avg(r.latest_score) m, count(*) n
      from cohort_students cs
      join lateral public.jr_student_dna_rows(array[cs.student_id]::uuid[]) r on true
     group by cs.cohort_id, r.competency
  ),
  eng as (
    select cs.cohort_id, count(distinct ap.student_id) contacted
      from cohort_students cs
      join public.appointments ap on ap.student_id = cs.student_id and ap.institution_id = p_institution_id
     where ap.status in ('booked','completed')
     group by cs.cohort_id
  ),
  prog as (
    select cohort_id, min(cohort_name) name,
           count(*) assessed,
           round(avg(mean_score)) mean_readiness,
           round(100.0 * count(*) filter (where latest_group='ready') / nullif(count(*),0)) pct_ready,
           round(100.0 * count(*) filter (where latest_group='developing') / nullif(count(*),0)) pct_developing,
           round(100.0 * count(*) filter (where latest_group='needs_support') / nullif(count(*),0)) pct_needs,
           count(*) filter (where trajectory='improving') n_improving,
           count(*) filter (where trajectory in ('plateauing','declining')) n_stalled
      from tr group by cohort_id
  )
  select coalesce(jsonb_agg(
    case when p.assessed < c_min_n then jsonb_build_object(
      'cohort_id', p.cohort_id, 'name', p.name, 'assessed', p.assessed, 'suppressed', true)
    else jsonb_build_object(
      'cohort_id', p.cohort_id, 'name', p.name, 'assessed', p.assessed, 'suppressed', false,
      'pct_ready', p.pct_ready, 'pct_developing', p.pct_developing, 'pct_needs', p.pct_needs,
      'mean_readiness', p.mean_readiness,
      'strongest_competency', (select competency from dna where dna.cohort_id = p.cohort_id and n >= c_min_n order by m desc limit 1),
      'weakest_competency', (select competency from dna where dna.cohort_id = p.cohort_id and n >= c_min_n order by m asc limit 1),
      'weakest_competency_below_target_pct', (
        select round(100.0 * count(*) filter (where r.latest_score < c_target) / nullif(count(*),0))
          from cohort_students cs2
          join lateral public.jr_student_dna_rows(array[cs2.student_id]::uuid[]) r on true
         where cs2.cohort_id = p.cohort_id
           and r.competency = (select competency from dna where dna.cohort_id = p.cohort_id and n >= c_min_n order by m asc limit 1)),
      'trajectory', case when p.n_improving > p.n_stalled then 'improving'
                         when p.n_stalled > p.n_improving then 'stalling' else 'mixed' end,
      'careers_engagement_pct', coalesce((select round(100.0 * e.contacted / nullif(p.assessed,0)) from eng e where e.cohort_id = p.cohort_id), 0)
    ) end
    order by p.assessed desc), '[]'::jsonb)
  from prog p);
end;
$$;

-- =============================================================================
-- 6. eki_follow_up_queue — derived, no duplicated state
-- =============================================================================
create or replace function public.eki_follow_up_queue(
  p_institution_id uuid, p_cohort_ids uuid[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c_target constant int := 70;
  v_students uuid[];
begin
  select array_agg(s) into v_students
    from public.jr_inst_scope_student_ids(p_institution_id, p_cohort_ids) s;
  v_students := coalesce(v_students, '{}');

  return (
  with tr as (select * from public.jr_student_trajectory_rows(v_students)),
  -- (a) an outcome flagged follow-up required, not yet completed
  fu_outcome as (
    select ap.student_id, o.appointment_id, sl.starts_at last_contact_at,
           coalesce(o.follow_up_due, (sl.starts_at + interval '14 days')::date) due_date,
           coalesce(at.label, 'Careers appointment') prev_type,
           'follow_up_required' reason_key, 1 prio
      from public.appointment_outcomes o
      join public.appointments ap on ap.id = o.appointment_id
      left join public.appointment_slots sl on sl.id = ap.slot_id
      left join public.appointment_types at on at.id = ap.appointment_type_id
     where ap.institution_id = p_institution_id and ap.student_id = any(v_students)
       and o.follow_up_required and o.follow_up_completed_at is null
  ),
  -- (b) a development plan whose review date has passed
  fu_plan as (
    select dp.student_id, null::uuid appointment_id, dp.created_at::timestamptz last_contact_at,
           dp.review_date due_date, 'Development plan' prev_type,
           'plan_review_due' reason_key, 2 prio, dp.id plan_id
      from public.development_plans dp
     where dp.institution_id = p_institution_id and dp.student_id = any(v_students)
       and dp.status in ('active','in_progress') and dp.review_date is not null and dp.review_date <= current_date
  ),
  -- (c) still below target after a recorded intervention, and has practised since
  fu_still_below as (
    select ap.student_id, ap.id appointment_id, max(sl.starts_at) last_contact_at,
           (max(sl.starts_at) + interval '10 days')::date due_date,
           'Previous support' prev_type, 'still_below_after_support' reason_key, 3 prio
      from public.appointment_outcomes o
      join public.appointments ap on ap.id = o.appointment_id
      left join public.appointment_slots sl on sl.id = ap.slot_id
      join tr on tr.student_id = ap.student_id
     where ap.institution_id = p_institution_id and ap.student_id = any(v_students)
       and tr.latest_score < c_target
       and tr.latest_at > coalesce(sl.starts_at, 'epoch'::timestamptz)
     group by ap.student_id, ap.id
  ),
  unioned as (
    select student_id, appointment_id, null::uuid plan_id, last_contact_at, due_date, prev_type, reason_key, prio from fu_outcome
    union all
    select student_id, appointment_id, plan_id, last_contact_at, due_date, prev_type, reason_key, prio from fu_plan
    union all
    select student_id, appointment_id, null::uuid, last_contact_at, due_date, prev_type, reason_key, prio from fu_still_below
  ),
  ranked as (
    select distinct on (student_id) u.*,
           (select nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '')
              from public.profiles p where p.id = u.student_id) name
      from unioned u order by student_id, prio
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'student_id', r.student_id, 'name', r.name,
    'reason_key', r.reason_key,
    'reason', case r.reason_key
       when 'follow_up_required' then 'Follow-up was marked required at the last appointment'
       when 'plan_review_due' then 'Development plan review date has passed'
       when 'still_below_after_support' then 'Still below the readiness target after previous support'
       else r.reason_key end,
    'previous_intervention', r.prev_type,
    'last_contact_at', r.last_contact_at,
    'due_date', r.due_date,
    'appointment_id', r.appointment_id,
    'plan_id', r.plan_id,
    'current_readiness_group', (select tr.latest_group from tr where tr.student_id = r.student_id)
  ) order by r.due_date nulls last), '[]'::jsonb)
  from ranked r);
end;
$$;

-- =============================================================================
-- 7. Extend eki_student_snapshot — trajectory + DNA evolution + resources +
--    flags + development plan + last briefing. (create or replace; same shape
--    family, new blocks. The frontend already tolerates the appointment/outcome
--    blocks being null.)
-- =============================================================================
create or replace function public.eki_student_snapshot(
  p_institution_id uuid, p_student_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c_target   constant int := 70;
  c_recent_n constant int := 3;
  c_window   constant interval := interval '120 days';
  v_student  uuid := p_student_id;
  v_inst     uuid := p_institution_id;
  v_now      timestamptz := now();
  v_prev_id  uuid;
  v_prev_at  timestamptz;
  v_result   jsonb;
begin
  if public.jr_inst_role(v_inst) is null then
    raise exception 'not authorised for this institution' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.cohort_members cm join public.cohorts c on c.id = cm.cohort_id
    where c.institution_id = v_inst and cm.student_id = v_student and cm.status <> 'removed'
  ) then
    raise exception 'student is not in your institution' using errcode = '42501';
  end if;

  select ap.id, coalesce(sl.starts_at, ap.booked_at) into v_prev_id, v_prev_at
    from public.appointments ap left join public.appointment_slots sl on sl.id = ap.slot_id
   where ap.student_id = v_student and ap.institution_id = v_inst
   order by coalesce(sl.starts_at, ap.booked_at) desc limit 1;

  with
  ivs as (
    select i.id, coalesce(ir.overall_score, i.overall_score)::numeric score,
           coalesce(i.completed_at, i.created_at) at,
           row_number() over (order by coalesce(i.completed_at, i.created_at)) rn,
           count(*) over () cnt
      from public.interviews i left join public.interview_reports ir on ir.interview_id = i.id
     where i.user_id = v_student and i.status = 'completed'
  ),
  raw_e as (
    select q.interview_id iv, coalesce(i.completed_at, i.created_at) at,
           e.relevance, e.specificity, e.structure, e.evidence, e.clarity, e.competency_demonstration
      from public.evaluations e
      join public.answers a on a.id = e.answer_id
      join public.interview_questions q on q.id = a.question_id
      join public.interviews i on i.id = q.interview_id
     where i.user_id = v_student and i.status = 'completed'
  ),
  ans as (
    select 'relevance' dim, relevance v, iv, at from raw_e where relevance is not null
    union all select 'specificity', specificity, iv, at from raw_e where specificity is not null
    union all select 'structure', structure, iv, at from raw_e where structure is not null
    union all select 'evidence', evidence, iv, at from raw_e where evidence is not null
    union all select 'communication', clarity, iv, at from raw_e where clarity is not null
    union all select 'competency_demonstration', competency_demonstration, iv, at from raw_e where competency_demonstration is not null
  ),
  dim_overall as (select dim, round(avg(v))::int mean, count(*) n_answers from ans group by dim),
  recent_ivs as (select id from ivs order by rn desc limit c_recent_n),
  dim_recent as (
    select dim, round(avg(v))::int mean, count(distinct iv) n_interviews
      from ans where iv in (select id from recent_ivs) group by dim
  ),
  prev_dim as (
    select dim, round(avg(v))::int mean from ans where v_prev_at is not null and at <= v_prev_at group by dim
  ),
  cat as (
    select public.jr_canonical_category(q.category) k,
      round(avg((coalesce(e.relevance,0)+coalesce(e.specificity,0)+coalesce(e.structure,0)+coalesce(e.evidence,0)+coalesce(e.clarity,0)+coalesce(e.competency_demonstration,0))::numeric
        / nullif((case when e.relevance is not null then 1 else 0 end)+(case when e.specificity is not null then 1 else 0 end)
                +(case when e.structure is not null then 1 else 0 end)+(case when e.evidence is not null then 1 else 0 end)
                +(case when e.clarity is not null then 1 else 0 end)+(case when e.competency_demonstration is not null then 1 else 0 end),0)))::int mean,
      count(*) n_answers
      from public.evaluations e join public.answers a on a.id = e.answer_id
      join public.interview_questions q on q.id = a.question_id join public.interviews i on i.id = q.interview_id
     where i.user_id = v_student and i.status = 'completed' group by 1
  ),
  hist as (
    select ap.id, coalesce(sl.starts_at, ap.booked_at) at, ap.status, ap.student_comment,
           coalesce(at2.label, 'Careers appointment') type_label,
           nullif(trim(coalesce(stf.first_name,'') || ' ' || coalesce(stf.last_name,'')), '') adviser_name,
           o.discussed, o.actions_agreed, o.next_steps, o.follow_up_required, o.follow_up_notes,
           o.updated_at outcome_updated_at,
           nullif(trim(coalesce(ub.first_name,'') || ' ' || coalesce(ub.last_name,'')), '') outcome_by
      from public.appointments ap
      left join public.appointment_slots sl on sl.id = ap.slot_id
      left join public.appointment_types at2 on at2.id = ap.appointment_type_id
      left join public.profiles stf on stf.id = sl.staff_id
      left join public.appointment_outcomes o on o.appointment_id = ap.id
      left join public.profiles ub on ub.id = o.updated_by
     where ap.student_id = v_student and ap.institution_id = v_inst
  ),
  prev_with_outcome as (
    select h.id, h.at, h.type_label, h.actions_agreed from hist h
     where (h.discussed is not null or h.actions_agreed is not null or h.next_steps is not null)
     order by h.at desc limit 1
  ),
  long_calc as (
    select p.id prior_id, p.at prior_at, p.type_label prior_type,
           (select round(avg(score)) from ivs where at >  p.at - c_window and at <= p.at) before_mean,
           (select count(*)          from ivs where at >  p.at - c_window and at <= p.at) n_before,
           (select round(avg(score)) from ivs where at >  p.at) after_mean,
           (select count(*)          from ivs where at >  p.at) n_after
      from prev_with_outcome p
  ),
  traj as (select * from public.jr_student_trajectory_rows(array[v_student]::uuid[]) limit 1),
  dnae as (select * from public.jr_student_dna_rows(array[v_student]::uuid[])),
  plan as (
    select dp.* from public.development_plans dp
     where dp.student_id = v_student and dp.institution_id = v_inst and dp.status <> 'archived'
     order by (dp.status = 'completed'), dp.created_at desc limit 1
  )
  select jsonb_build_object(
    'generated_at', v_now, 'target', c_target, 'recent_window', c_recent_n,
    'student', jsonb_build_object(
      'id', v_student,
      'name', (select nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), '') from public.profiles where id = v_student),
      'institution_name', (select name from public.institutions where id = v_inst),
      'cohorts', (select coalesce(jsonb_agg(distinct c.name), '[]'::jsonb) from public.cohort_members cm join public.cohorts c on c.id = cm.cohort_id
                   where c.institution_id = v_inst and cm.student_id = v_student and cm.status <> 'removed')),
    'appointment', null, 'current_outcome', null, 'application', null,
    'interview_dna', jsonb_build_object(
      'n_completed_interviews', (select coalesce(max(cnt), 0) from ivs),
      'has_enough_data', (select coalesce(max(cnt), 0) from ivs) >= 1,
      'overall_mean', (select round(avg(score)) from ivs),
      'dimensions', (select coalesce(jsonb_agg(jsonb_build_object(
          'key', dim, 'mean', mean, 'n_answers', n_answers,
          'band', case when mean >= 75 then 'strong' when mean >= c_target then 'solid' when mean >= c_target - 15 then 'developing' else 'priority' end,
          'below_target', (mean < c_target)) order by mean desc), '[]'::jsonb) from dim_overall),
      'strengths', (select coalesce(jsonb_agg(jsonb_build_object('key', dim, 'mean', mean) order by mean desc), '[]'::jsonb)
                      from (select dim, mean from dim_overall where mean >= c_target order by mean desc limit 3) s),
      'development_areas', (select coalesce(jsonb_agg(jsonb_build_object('key', dim, 'mean', mean) order by mean asc), '[]'::jsonb)
                      from (select dim, mean from dim_overall where mean < c_target order by mean asc limit 3) w)),
    'patterns', jsonb_build_object(
      'repeated_development_area', (
        select case when d.dim is null then null else jsonb_build_object('key', d.dim, 'overall_mean', o.mean, 'recent_mean', d.mean, 'recent_interviews', d.n_interviews) end
        from dim_recent d join dim_overall o on o.dim = d.dim
        where d.mean < c_target and o.mean < c_target and d.n_interviews >= 2 order by d.mean asc limit 1),
      'performance_trend', (
        select case when (select coalesce(max(cnt),0) from ivs) < 2 then null else jsonb_build_object(
          'first', (select score from ivs where rn = 1),
          'latest', (select score from ivs where rn = (select max(rn) from ivs)),
          'delta', (select score from ivs where rn = (select max(rn) from ivs)) - (select score from ivs where rn = 1),
          'n_interviews', (select max(cnt) from ivs)) end),
      'hardest_question_category', (
        select jsonb_build_object('key', k, 'mean', mean, 'n_answers', n_answers) from cat where n_answers >= 2 order by mean asc limit 1)),
    'trajectory', (
      select case when t.student_id is null then jsonb_build_object('classification','insufficient_data')
        else jsonb_build_object(
          'classification', t.trajectory,
          'n_interviews', t.n_interviews,
          'first_score', t.first_score, 'latest_score', t.latest_score,
          'overall_delta', t.overall_delta, 'recent_delta', t.recent_delta,
          'series', (select coalesce(jsonb_agg(round(s.score) order by s.rn), '[]'::jsonb)
             from (select coalesce(ir.overall_score, i.overall_score)::numeric score,
                          row_number() over (order by coalesce(i.completed_at,i.created_at)) rn
                     from public.interviews i left join public.interview_reports ir on ir.interview_id=i.id
                    where i.user_id = v_student and i.status='completed'
                      and coalesce(ir.overall_score,i.overall_score) is not null) s)
        ) end from traj t),
    'dna_evolution', (
      select case when count(*) = 0 then jsonb_build_object('has_data', false)
        else jsonb_build_object(
          'has_data', true,
          'dimensions', jsonb_agg(jsonb_build_object(
            'key', competency, 'earliest', earliest_score, 'latest', latest_score,
            'delta', (latest_score - earliest_score), 'n_points', n_points) order by (latest_score - earliest_score) desc),
          'strongest_improvement', (select competency from dnae order by (latest_score - earliest_score) desc limit 1),
          'persistent_weakness', (select competency from dnae order by latest_score asc limit 1))
        end from dnae),
    'recommended_resources', (
      select coalesce(jsonb_agg(r), '[]'::jsonb) from (
        select jsonb_build_object('id', rs.id, 'title', rs.title, 'description', rs.description,
                 'type', rs.type, 'competency', rs.competency, 'duration_minutes', rs.duration_minutes, 'url', rs.url) r
          from public.resources rs
         where rs.active and (rs.institution_id is null or rs.institution_id = v_inst)
           and rs.competency = (select dim from dim_overall where mean < c_target order by mean asc limit 1)
         order by rs.institution_id nulls last, rs.difficulty limit 3
      ) x),
    'flags', jsonb_build_object(
      'is_stuck', (select is_stuck from (
        select (t.n_interviews >= 3 and t.latest_score < c_target
          and t.trajectory in ('plateauing','stable','declining') and coalesce(t.recent_delta,0) < 3) is_stuck
        from traj t) z),
      'no_prior_contact', not exists (
        select 1 from public.appointments ap
        where ap.student_id = v_student and ap.institution_id = v_inst and ap.status = 'completed')
        and not exists (
        select 1 from public.appointment_outcomes o join public.appointments ap on ap.id = o.appointment_id
        where ap.student_id = v_student and ap.institution_id = v_inst)),
    'development_plan', (
      select case when pl.id is null then null else jsonb_build_object(
        'id', pl.id, 'development_area', pl.development_area, 'title', pl.title, 'description', pl.description,
        'goal_target', pl.goal_target, 'status', pl.status, 'review_date', pl.review_date,
        'resource_id', pl.resource_id, 'created_at', pl.created_at, 'completed_at', pl.completed_at,
        'items', (select coalesce(jsonb_agg(jsonb_build_object(
           'id', it.id, 'kind', it.kind, 'label', it.label, 'status', it.status) order by it.sort_order), '[]'::jsonb)
           from public.development_plan_items it where it.plan_id = pl.id)
      ) end from plan pl),
    'last_briefing', (
      select case when b.id is null then null else jsonb_build_object(
        'briefing_text', b.briefing_text, 'discussion_points', b.discussion_points,
        'generated_by', b.generated_by, 'model', b.model, 'created_at', b.created_at) end
      from public.adviser_briefings b
      where b.student_id = v_student and b.institution_id = v_inst
      order by b.created_at desc limit 1),
    'previous_support', (
      select case when v_prev_id is null then null else jsonb_build_object(
        'appointment_id', h.id, 'starts_at', h.at,
        'days_ago', greatest(0, floor(extract(epoch from (v_now - h.at)) / 86400))::int,
        'type_label', h.type_label, 'adviser_name', h.adviser_name, 'status', h.status,
        'student_comment', h.student_comment,
        'key_development_area', (select dim from prev_dim order by mean asc limit 1),
        'has_outcome', (h.discussed is not null or h.actions_agreed is not null or h.next_steps is not null),
        'actions_agreed', h.actions_agreed, 'next_steps', h.next_steps,
        'follow_up_required', coalesce(h.follow_up_required, false)
      ) end from hist h where h.id = v_prev_id),
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'appointment_id', id, 'starts_at', at, 'status', status, 'type_label', type_label,
        'adviser_name', adviser_name, 'student_comment', student_comment,
        'has_outcome', (discussed is not null or actions_agreed is not null or next_steps is not null),
        'discussed', discussed, 'actions_agreed', actions_agreed, 'next_steps', next_steps,
        'follow_up_required', coalesce(follow_up_required, false), 'follow_up_notes', follow_up_notes,
        'outcome_updated_at', outcome_updated_at, 'outcome_by', outcome_by
      ) order by at desc), '[]'::jsonb) from hist),
    'longitudinal', (
      select case when lc.prior_id is null or lc.n_before < 1 or lc.n_after < 1 then '[]'::jsonb
        else jsonb_build_array(jsonb_build_object(
          'kind', 'interview_score_change_after_intervention',
          'prior_appointment_id', lc.prior_id, 'prior_date', lc.prior_at, 'prior_type', lc.prior_type,
          'before_mean', lc.before_mean, 'after_mean', lc.after_mean,
          'delta', lc.after_mean - lc.before_mean, 'n_before', lc.n_before, 'n_after', lc.n_after
        )) end from long_calc lc)
  ) into v_result;
  return v_result;
end;
$$;

-- =============================================================================
-- 8. STUDENT-FACING: eki_my_development()  — the caller's OWN data only
-- =============================================================================
create or replace function public.eki_my_development()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c_target constant int := 70;
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  return (
  with traj as (select * from public.jr_student_trajectory_rows(array[uid]::uuid[]) limit 1),
  dnae as (select * from public.jr_student_dna_rows(array[uid]::uuid[])),
  weakest as (select competency from dnae order by latest_score asc limit 1),
  plan as (
    select dp.* from public.development_plans dp
     where dp.student_id = uid and dp.status <> 'archived'
     order by (dp.status = 'completed'), dp.created_at desc limit 1
  )
  select jsonb_build_object(
    'target', c_target,
    'trajectory', (select case when t.student_id is null then jsonb_build_object('classification','insufficient_data')
      else jsonb_build_object('classification', t.trajectory, 'first_score', t.first_score,
        'latest_score', t.latest_score, 'overall_delta', t.overall_delta, 'n_interviews', t.n_interviews,
        'series', (select coalesce(jsonb_agg(round(s.score) order by s.rn), '[]'::jsonb)
           from (select coalesce(ir.overall_score, i.overall_score)::numeric score,
                        row_number() over (order by coalesce(i.completed_at,i.created_at)) rn
                   from public.interviews i left join public.interview_reports ir on ir.interview_id=i.id
                  where i.user_id = uid and i.status='completed' and coalesce(ir.overall_score,i.overall_score) is not null) s))
      end from traj t),
    'dna_evolution', (select case when count(*) = 0 then jsonb_build_object('has_data', false)
      else jsonb_build_object('has_data', true,
        'dimensions', jsonb_agg(jsonb_build_object('key', competency, 'earliest', earliest_score,
          'latest', latest_score, 'delta', (latest_score - earliest_score)) order by (latest_score - earliest_score) desc),
        'strongest_improvement', (select competency from dnae order by (latest_score - earliest_score) desc limit 1),
        'persistent_weakness', (select competency from dnae order by latest_score asc limit 1))
      end from dnae),
    'recommended_resources', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', rs.id, 'title', rs.title, 'description', rs.description, 'type', rs.type,
        'competency', rs.competency, 'duration_minutes', rs.duration_minutes, 'url', rs.url)
        order by rs.institution_id nulls last, rs.difficulty), '[]'::jsonb)
      from public.resources rs
      where rs.active and rs.competency = (select competency from weakest)
        and (rs.institution_id is null or rs.institution_id in (select public.jr_student_institution_ids()))),
    'development_plan', (select case when pl.id is null then null else jsonb_build_object(
        'id', pl.id, 'development_area', pl.development_area, 'title', pl.title, 'description', pl.description,
        'goal_target', pl.goal_target, 'status', pl.status, 'review_date', pl.review_date, 'completed_at', pl.completed_at,
        'items', (select coalesce(jsonb_agg(jsonb_build_object('id', it.id, 'kind', it.kind,
          'label', it.label, 'status', it.status) order by it.sort_order), '[]'::jsonb)
          from public.development_plan_items it where it.plan_id = pl.id))
      end from plan pl)
  ));
end;
$$;

-- =============================================================================
-- 9. WRITES — development plans, follow-up completion, briefing persistence
-- =============================================================================
create or replace function public.save_development_plan(
  p_institution_id uuid, p_student_id uuid, p_title text,
  p_development_area text default null, p_description text default null,
  p_goal_target int default null, p_resource_id uuid default null,
  p_review_date date default null, p_plan_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare uid uuid := (select auth.uid()); v_id uuid;
begin
  if public.jr_inst_role(p_institution_id) is null then
    raise exception 'not authorised for this institution' using errcode = '42501';
  end if;
  if not exists (select 1 from public.cohort_members cm join public.cohorts c on c.id = cm.cohort_id
    where c.institution_id = p_institution_id and cm.student_id = p_student_id and cm.status <> 'removed') then
    raise exception 'student is not in your institution' using errcode = '42501';
  end if;

  if p_plan_id is not null then
    update public.development_plans set
      title = coalesce(nullif(btrim(p_title), ''), title),
      development_area = p_development_area, description = p_description,
      goal_target = p_goal_target, resource_id = p_resource_id, review_date = p_review_date,
      updated_at = now(), updated_by = uid
    where id = p_plan_id and institution_id = p_institution_id
    returning id into v_id;
    if v_id is null then raise exception 'plan not found' using errcode = '42501'; end if;
  else
    insert into public.development_plans (institution_id, student_id, development_area, title, description,
      goal_target, resource_id, review_date, created_by, updated_by)
    values (p_institution_id, p_student_id, p_development_area, nullif(btrim(p_title), ''), p_description,
      p_goal_target, p_resource_id, p_review_date, uid, uid)
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'plan_id', v_id);
end;
$$;

create or replace function public.set_development_plan_status(p_plan_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_inst uuid;
begin
  if p_status not in ('active','in_progress','completed','archived') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;
  select institution_id into v_inst from public.development_plans where id = p_plan_id;
  if v_inst is null or public.jr_inst_role(v_inst) is null then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  update public.development_plans set status = p_status,
    completed_at = case when p_status = 'completed' then now() else null end,
    updated_at = now(), updated_by = (select auth.uid())
  where id = p_plan_id;
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

create or replace function public.upsert_development_plan_item(
  p_plan_id uuid, p_kind text, p_label text, p_item_id uuid default null, p_status text default 'todo'
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_inst uuid; v_id uuid; v_next int;
begin
  select institution_id into v_inst from public.development_plans where id = p_plan_id;
  if v_inst is null or public.jr_inst_role(v_inst) is null then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_kind not in ('resource','practice','goal','action') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_kind');
  end if;
  if p_item_id is not null then
    update public.development_plan_items set kind = p_kind, label = nullif(btrim(p_label), ''),
      status = coalesce(p_status, status), done_at = case when p_status = 'done' then now() else null end
    where id = p_item_id and plan_id = p_plan_id returning id into v_id;
    if v_id is null then raise exception 'item not found' using errcode = '42501'; end if;
  else
    select coalesce(max(sort_order), 0) + 10 into v_next from public.development_plan_items where plan_id = p_plan_id;
    insert into public.development_plan_items (plan_id, kind, label, status, sort_order,
      done_at)
    values (p_plan_id, p_kind, nullif(btrim(p_label), ''), coalesce(p_status,'todo'), v_next,
      case when p_status = 'done' then now() else null end)
    returning id into v_id;
  end if;
  update public.development_plans set updated_at = now(), updated_by = (select auth.uid()) where id = p_plan_id;
  return jsonb_build_object('ok', true, 'item_id', v_id);
end;
$$;

create or replace function public.mark_follow_up_done(p_appointment_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_inst uuid;
begin
  select ap.institution_id into v_inst from public.appointments ap where ap.id = p_appointment_id;
  if v_inst is null or public.jr_inst_role(v_inst) is null then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  update public.appointment_outcomes
     set follow_up_completed_at = now(), follow_up_completed_by = (select auth.uid())
   where appointment_id = p_appointment_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.save_adviser_briefing(
  p_institution_id uuid, p_student_id uuid, p_briefing text,
  p_discussion_points jsonb default '[]'::jsonb, p_generated_by text default 'deterministic',
  p_model text default null, p_appointment_id uuid default null
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := (select auth.uid()); v_id uuid;
begin
  if public.jr_inst_role(p_institution_id) is null then
    raise exception 'not authorised for this institution' using errcode = '42501';
  end if;
  if not exists (select 1 from public.cohort_members cm join public.cohorts c on c.id = cm.cohort_id
    where c.institution_id = p_institution_id and cm.student_id = p_student_id and cm.status <> 'removed') then
    raise exception 'student is not in your institution' using errcode = '42501';
  end if;
  if p_generated_by not in ('deterministic','ai') then p_generated_by := 'deterministic'; end if;

  if p_appointment_id is not null then
    delete from public.adviser_briefings where appointment_id = p_appointment_id;
  end if;
  insert into public.adviser_briefings (institution_id, student_id, appointment_id, briefing_text,
    discussion_points, generated_by, model, created_by)
  values (p_institution_id, p_student_id, p_appointment_id, left(coalesce(p_briefing,''), 8000),
    coalesce(p_discussion_points, '[]'::jsonb), p_generated_by, p_model, uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'briefing_id', v_id);
end;
$$;

-- read a filtered resource list (staff or student of the institution)
create or replace function public.list_resources(
  p_institution_id uuid default null, p_competency text default null, p_career_path text default null
)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'institution_id', r.institution_id, 'title', r.title, 'description', r.description,
    'type', r.type, 'competency', r.competency, 'career_path', r.career_path,
    'difficulty', r.difficulty, 'duration_minutes', r.duration_minutes, 'url', r.url
  ) order by r.institution_id nulls last, r.competency, r.difficulty), '[]'::jsonb)
  from public.resources r
  where r.active
    and (r.institution_id is null
         or public.jr_inst_role(r.institution_id) is not null
         or r.institution_id in (select public.jr_student_institution_ids()))
    and (p_institution_id is null or r.institution_id is null or r.institution_id = p_institution_id)
    and (p_competency is null or r.competency = p_competency)
    and (p_career_path is null or r.career_path = p_career_path);
$$;

-- =============================================================================
-- 11. eki_student_careers_profile — carry the intelligence blocks too, so the
--     appointment-anchored profile and the roster-anchored snapshot are the
--     SAME screen. Adds student.id + trajectory + dna_evolution +
--     recommended_resources + flags + development_plan + last_briefing.
--     (create or replace; every existing block is unchanged.)
-- =============================================================================
create or replace function public.eki_student_careers_profile(p_appointment_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  c_target constant int := 70; c_recent_n constant int := 3; c_window constant interval := interval '120 days';
  v_ap public.appointments; v_student uuid; v_inst uuid;
  v_appt_at timestamptz; v_prev_at timestamptz; v_prev_id uuid; v_result jsonb;
begin
  select * into v_ap from public.appointments where id = p_appointment_id;
  if not found then raise exception 'appointment not found' using errcode = '42501'; end if;
  v_student := v_ap.student_id; v_inst := v_ap.institution_id;
  if public.jr_inst_role(v_inst) is null then
    raise exception 'not authorised for this institution' using errcode = '42501';
  end if;
  if not exists (select 1 from public.cohort_members cm join public.cohorts c on c.id = cm.cohort_id
    where c.institution_id = v_inst and cm.student_id = v_student and cm.status <> 'removed') then
    raise exception 'student is not in your institution' using errcode = '42501';
  end if;

  select coalesce(sl.starts_at, v_ap.booked_at) into v_appt_at
    from public.appointment_slots sl where sl.id = v_ap.slot_id;
  select ap.id, coalesce(sl.starts_at, ap.booked_at) into v_prev_id, v_prev_at
    from public.appointments ap left join public.appointment_slots sl on sl.id = ap.slot_id
   where ap.student_id = v_student and ap.institution_id = v_inst and ap.id <> p_appointment_id
     and coalesce(sl.starts_at, ap.booked_at) < coalesce(v_appt_at, now())
   order by coalesce(sl.starts_at, ap.booked_at) desc limit 1;

  with
  ivs as (
    select i.id, coalesce(ir.overall_score, i.overall_score)::numeric score,
           coalesce(i.completed_at, i.created_at) at,
           row_number() over (order by coalesce(i.completed_at, i.created_at)) rn,
           count(*) over () cnt
      from public.interviews i left join public.interview_reports ir on ir.interview_id = i.id
     where i.user_id = v_student and i.status = 'completed'
  ),
  raw_e as (
    select q.interview_id iv, coalesce(i.completed_at, i.created_at) at,
           e.relevance, e.specificity, e.structure, e.evidence, e.clarity, e.competency_demonstration
      from public.evaluations e join public.answers a on a.id = e.answer_id
      join public.interview_questions q on q.id = a.question_id join public.interviews i on i.id = q.interview_id
     where i.user_id = v_student and i.status = 'completed'
  ),
  ans as (
    select 'relevance' dim, relevance v, iv, at from raw_e where relevance is not null
    union all select 'specificity', specificity, iv, at from raw_e where specificity is not null
    union all select 'structure', structure, iv, at from raw_e where structure is not null
    union all select 'evidence', evidence, iv, at from raw_e where evidence is not null
    union all select 'communication', clarity, iv, at from raw_e where clarity is not null
    union all select 'competency_demonstration', competency_demonstration, iv, at from raw_e where competency_demonstration is not null
  ),
  dim_overall as (select dim, round(avg(v))::int mean, count(*) n_answers from ans group by dim),
  recent_ivs as (select id from ivs order by rn desc limit c_recent_n),
  dim_recent as (select dim, round(avg(v))::int mean, count(distinct iv) n_interviews
      from ans where iv in (select id from recent_ivs) group by dim),
  prev_dim as (select dim, round(avg(v))::int mean from ans where v_prev_at is not null and at <= v_prev_at group by dim),
  cat as (
    select public.jr_canonical_category(q.category) k,
      round(avg((coalesce(e.relevance,0)+coalesce(e.specificity,0)+coalesce(e.structure,0)+coalesce(e.evidence,0)+coalesce(e.clarity,0)+coalesce(e.competency_demonstration,0))::numeric
        / nullif((case when e.relevance is not null then 1 else 0 end)+(case when e.specificity is not null then 1 else 0 end)
                +(case when e.structure is not null then 1 else 0 end)+(case when e.evidence is not null then 1 else 0 end)
                +(case when e.clarity is not null then 1 else 0 end)+(case when e.competency_demonstration is not null then 1 else 0 end),0)))::int mean,
      count(*) n_answers
      from public.evaluations e join public.answers a on a.id = e.answer_id
      join public.interview_questions q on q.id = a.question_id join public.interviews i on i.id = q.interview_id
     where i.user_id = v_student and i.status = 'completed' group by 1
  ),
  hist as (
    select ap.id, coalesce(sl.starts_at, ap.booked_at) at, ap.status, ap.student_comment,
           coalesce(at2.label, 'Careers appointment') type_label,
           nullif(trim(coalesce(stf.first_name,'') || ' ' || coalesce(stf.last_name,'')), '') adviser_name,
           o.discussed, o.actions_agreed, o.next_steps, o.follow_up_required, o.follow_up_notes,
           o.updated_at outcome_updated_at,
           nullif(trim(coalesce(ub.first_name,'') || ' ' || coalesce(ub.last_name,'')), '') outcome_by
      from public.appointments ap
      left join public.appointment_slots sl on sl.id = ap.slot_id
      left join public.appointment_types at2 on at2.id = ap.appointment_type_id
      left join public.profiles stf on stf.id = sl.staff_id
      left join public.appointment_outcomes o on o.appointment_id = ap.id
      left join public.profiles ub on ub.id = o.updated_by
     where ap.student_id = v_student and ap.institution_id = v_inst and ap.id <> p_appointment_id
       and coalesce(sl.starts_at, ap.booked_at) < coalesce(v_appt_at, now())
  ),
  prev_with_outcome as (
    select h.id, h.at, h.type_label, h.actions_agreed from hist h
     where (h.discussed is not null or h.actions_agreed is not null or h.next_steps is not null)
     order by h.at desc limit 1
  ),
  long_calc as (
    select p.id prior_id, p.at prior_at, p.type_label prior_type,
           (select round(avg(score)) from ivs where at >  p.at - c_window and at <= p.at) before_mean,
           (select count(*)          from ivs where at >  p.at - c_window and at <= p.at) n_before,
           (select round(avg(score)) from ivs where at >  p.at) after_mean,
           (select count(*)          from ivs where at >  p.at) n_after
      from prev_with_outcome p
  ),
  traj as (select * from public.jr_student_trajectory_rows(array[v_student]::uuid[]) limit 1),
  dnae as (select * from public.jr_student_dna_rows(array[v_student]::uuid[])),
  plan as (select dp.* from public.development_plans dp
     where dp.student_id = v_student and dp.institution_id = v_inst and dp.status <> 'archived'
     order by (dp.status = 'completed'), dp.created_at desc limit 1)
  select jsonb_build_object(
    'generated_at', now(), 'target', c_target, 'recent_window', c_recent_n,
    'student', jsonb_build_object(
      'id', v_student,
      'name', (select nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), '') from public.profiles where id = v_student),
      'institution_name', (select name from public.institutions where id = v_inst),
      'cohorts', (select coalesce(jsonb_agg(distinct c.name), '[]'::jsonb) from public.cohort_members cm join public.cohorts c on c.id = cm.cohort_id
                   where c.institution_id = v_inst and cm.student_id = v_student and cm.status <> 'removed')),
    'appointment', jsonb_build_object('id', v_ap.id, 'status', v_ap.status,
      'type_label', (select coalesce(label, 'Careers appointment') from public.appointment_types where id = v_ap.appointment_type_id),
      'starts_at', v_appt_at, 'ends_at', (select ends_at from public.appointment_slots where id = v_ap.slot_id),
      'student_comment', v_ap.student_comment),
    'current_outcome', (select case when o.id is null then null else jsonb_build_object(
        'discussed', o.discussed, 'actions_agreed', o.actions_agreed, 'next_steps', o.next_steps,
        'follow_up_required', o.follow_up_required, 'follow_up_notes', o.follow_up_notes,
        'created_at', o.created_at, 'updated_at', o.updated_at,
        'updated_by_name', (select nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), '') from public.profiles where id = o.updated_by)
      ) end from public.appointment_outcomes o where o.appointment_id = p_appointment_id),
    'application', (select case when v_ap.application_id is null then null else jsonb_build_object(
        'company', app.company, 'role', app.role, 'stage', app.interview_stage, 'interview_date', app.interview_date,
        'created_at', app.created_at,
        'practice_interviews', (select count(*) from public.interviews i2 where i2.application_id = app.id and i2.status = 'completed')
      ) end from public.applications app where app.id = v_ap.application_id),
    'interview_dna', jsonb_build_object(
      'n_completed_interviews', (select coalesce(max(cnt), 0) from ivs),
      'has_enough_data', (select coalesce(max(cnt), 0) from ivs) >= 1,
      'overall_mean', (select round(avg(score)) from ivs),
      'dimensions', (select coalesce(jsonb_agg(jsonb_build_object('key', dim, 'mean', mean, 'n_answers', n_answers,
          'band', case when mean >= 75 then 'strong' when mean >= c_target then 'solid' when mean >= c_target - 15 then 'developing' else 'priority' end,
          'below_target', (mean < c_target)) order by mean desc), '[]'::jsonb) from dim_overall),
      'strengths', (select coalesce(jsonb_agg(jsonb_build_object('key', dim, 'mean', mean) order by mean desc), '[]'::jsonb)
                      from (select dim, mean from dim_overall where mean >= c_target order by mean desc limit 3) s),
      'development_areas', (select coalesce(jsonb_agg(jsonb_build_object('key', dim, 'mean', mean) order by mean asc), '[]'::jsonb)
                      from (select dim, mean from dim_overall where mean < c_target order by mean asc limit 3) w)),
    'patterns', jsonb_build_object(
      'repeated_development_area', (select case when d.dim is null then null else jsonb_build_object('key', d.dim, 'overall_mean', o.mean, 'recent_mean', d.mean, 'recent_interviews', d.n_interviews) end
        from dim_recent d join dim_overall o on o.dim = d.dim
        where d.mean < c_target and o.mean < c_target and d.n_interviews >= 2 order by d.mean asc limit 1),
      'performance_trend', (select case when (select coalesce(max(cnt),0) from ivs) < 2 then null else jsonb_build_object(
          'first', (select score from ivs where rn = 1), 'latest', (select score from ivs where rn = (select max(rn) from ivs)),
          'delta', (select score from ivs where rn = (select max(rn) from ivs)) - (select score from ivs where rn = 1),
          'n_interviews', (select max(cnt) from ivs)) end),
      'hardest_question_category', (select jsonb_build_object('key', k, 'mean', mean, 'n_answers', n_answers) from cat where n_answers >= 2 order by mean asc limit 1)),
    'trajectory', coalesce((select jsonb_build_object('classification', t.trajectory, 'n_interviews', t.n_interviews,
        'first_score', t.first_score, 'latest_score', t.latest_score, 'overall_delta', t.overall_delta, 'recent_delta', t.recent_delta,
        'series', (select coalesce(jsonb_agg(round(s.score) order by s.rn), '[]'::jsonb)
           from (select coalesce(ir.overall_score, i.overall_score)::numeric score,
                        row_number() over (order by coalesce(i.completed_at,i.created_at)) rn
                  from public.interviews i left join public.interview_reports ir on ir.interview_id=i.id
                 where i.user_id = v_student and i.status='completed' and coalesce(ir.overall_score,i.overall_score) is not null) s))
      from traj t), jsonb_build_object('classification','insufficient_data')),
    'dna_evolution', (select case when count(*) = 0 then jsonb_build_object('has_data', false)
      else jsonb_build_object('has_data', true,
        'dimensions', jsonb_agg(jsonb_build_object('key', competency, 'earliest', earliest_score, 'latest', latest_score,
          'delta', (latest_score - earliest_score), 'n_points', n_points) order by (latest_score - earliest_score) desc),
        'strongest_improvement', (select competency from dnae order by (latest_score - earliest_score) desc limit 1),
        'persistent_weakness', (select competency from dnae order by latest_score asc limit 1)) end from dnae),
    'recommended_resources', (select coalesce(jsonb_agg(r), '[]'::jsonb) from (
        select jsonb_build_object('id', rs.id, 'title', rs.title, 'description', rs.description, 'type', rs.type,
                 'competency', rs.competency, 'duration_minutes', rs.duration_minutes, 'url', rs.url) r
          from public.resources rs
         where rs.active and (rs.institution_id is null or rs.institution_id = v_inst)
           and rs.competency = (select dim from dim_overall where mean < c_target order by mean asc limit 1)
         order by rs.institution_id nulls last, rs.difficulty limit 3) x),
    'flags', jsonb_build_object(
      'is_stuck', coalesce((select (t.n_interviews >= 3 and t.latest_score < c_target
          and t.trajectory in ('plateauing','stable','declining') and coalesce(t.recent_delta,0) < 3) from traj t), false),
      'no_prior_contact', (not exists (select 1 from public.appointments ap
          where ap.student_id = v_student and ap.institution_id = v_inst and ap.status = 'completed' and ap.id <> p_appointment_id)
        and not exists (select 1 from public.appointment_outcomes o join public.appointments ap on ap.id = o.appointment_id
          where ap.student_id = v_student and ap.institution_id = v_inst and ap.id <> p_appointment_id))),
    'development_plan', (select case when pl.id is null then null else jsonb_build_object(
        'id', pl.id, 'development_area', pl.development_area, 'title', pl.title, 'description', pl.description,
        'goal_target', pl.goal_target, 'status', pl.status, 'review_date', pl.review_date,
        'resource_id', pl.resource_id, 'created_at', pl.created_at, 'completed_at', pl.completed_at,
        'items', (select coalesce(jsonb_agg(jsonb_build_object('id', it.id, 'kind', it.kind, 'label', it.label, 'status', it.status) order by it.sort_order), '[]'::jsonb)
           from public.development_plan_items it where it.plan_id = pl.id)) end from plan pl),
    'last_briefing', (select case when b.id is null then null else jsonb_build_object(
        'briefing_text', b.briefing_text, 'discussion_points', b.discussion_points,
        'generated_by', b.generated_by, 'model', b.model, 'created_at', b.created_at) end
      from public.adviser_briefings b where b.student_id = v_student and b.institution_id = v_inst
      order by b.created_at desc limit 1),
    'previous_support', (select case when v_prev_id is null then null else jsonb_build_object(
        'appointment_id', h.id, 'starts_at', h.at,
        'days_ago', greatest(0, floor(extract(epoch from (now() - h.at)) / 86400))::int,
        'type_label', h.type_label, 'adviser_name', h.adviser_name, 'status', h.status, 'student_comment', h.student_comment,
        'key_development_area', (select dim from prev_dim order by mean asc limit 1),
        'has_outcome', (h.discussed is not null or h.actions_agreed is not null or h.next_steps is not null),
        'actions_agreed', h.actions_agreed, 'next_steps', h.next_steps, 'follow_up_required', coalesce(h.follow_up_required, false)
      ) end from hist h where h.id = v_prev_id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
        'appointment_id', id, 'starts_at', at, 'status', status, 'type_label', type_label,
        'adviser_name', adviser_name, 'student_comment', student_comment,
        'has_outcome', (discussed is not null or actions_agreed is not null or next_steps is not null),
        'discussed', discussed, 'actions_agreed', actions_agreed, 'next_steps', next_steps,
        'follow_up_required', coalesce(follow_up_required, false), 'follow_up_notes', follow_up_notes,
        'outcome_updated_at', outcome_updated_at, 'outcome_by', outcome_by) order by at desc), '[]'::jsonb) from hist),
    'longitudinal', (select case when lc.prior_id is null or lc.n_before < 1 or lc.n_after < 1 then '[]'::jsonb
        else jsonb_build_array(jsonb_build_object('kind', 'interview_score_change_after_intervention',
          'prior_appointment_id', lc.prior_id, 'prior_date', lc.prior_at, 'prior_type', lc.prior_type,
          'before_mean', lc.before_mean, 'after_mean', lc.after_mean,
          'delta', lc.after_mean - lc.before_mean, 'n_before', lc.n_before, 'n_after', lc.n_after)) end from long_calc lc)
  ) into v_result;
  return v_result;
end;
$$;

-- =============================================================================
-- 12. GRANTS
-- =============================================================================
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.jr_classify_trajectory(int,numeric,numeric,numeric,numeric)',
    'public.jr_readiness_group(numeric)',
    'public.jr_student_trajectory_rows(uuid[],timestamptz,timestamptz)',
    'public.jr_student_dna_rows(uuid[])',
    'public.eki_student_intelligence(uuid,uuid[],timestamptz,timestamptz)',
    'public.eki_programme_pulse(uuid,timestamptz,timestamptz)',
    'public.eki_follow_up_queue(uuid,uuid[])',
    'public.eki_student_snapshot(uuid,uuid)',
    'public.eki_my_development()',
    'public.save_development_plan(uuid,uuid,text,text,text,int,uuid,date,uuid)',
    'public.set_development_plan_status(uuid,text)',
    'public.upsert_development_plan_item(uuid,text,text,uuid,text)',
    'public.mark_follow_up_done(uuid)',
    'public.save_adviser_briefing(uuid,uuid,text,jsonb,text,text,uuid)',
    'public.list_resources(uuid,text,text)',
    'public.eki_student_careers_profile(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
