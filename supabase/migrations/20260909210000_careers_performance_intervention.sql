-- =============================================================================
-- EKI² — PERFORMANCE → INTERVENTION → STUDENT COMMUNICATION
-- -----------------------------------------------------------------------------
-- Turns the Performance page from a single cohort-wide verdict into an
-- intervention workflow:
--
--   readiness distribution  ->  drill into a readiness group  ->  authorised
--   student roster  ->  open the Student Careers Profile / arrange an
--   appointment / message the student  ->  the student sees it in JOB.READY
--   Careers Support  ->  the student responds  ->  appointment + outcome +
--   careers journey (existing infrastructure).
--
-- THREE INFORMATION TYPES, kept strictly separate (unchanged principle):
--   A. institutional intelligence  — aggregate analytics, k-anonymised
--   B. internal careers records     — appointment_outcomes (staff-only, RPC-write)
--   C. student-facing communication — appointments.invite_message + careers_messages
--
-- WHAT THIS MIGRATION ADDS
--   1. appointments: 'invited' / 'declined' statuses + staff-invite columns
--      (invited_by, invited_at, invite_message [student-visible], responded_at).
--   2. careers_messages: a lightweight, institution-scoped staff -> student
--      message. Student reads ONLY their own; staff read their institution's;
--      no client insert/update — RPC only.
--   3. eki_readiness_roster()  — authorised, institution-scoped, per-student
--      readiness classification for the careers-team drill-in. NOT k-anonymised
--      (it is the authorised individual-identification workflow, gated exactly
--      like eki_student_briefing), but it flags `suppressed` on the AGGREGATE
--      distribution when fewer than MIN_COHORT_N (5) students are assessed, so
--      the analytics page still respects k-anonymity.
--   4. eki_student_snapshot()  — the Student Careers Profile for a student who
--      has no appointment yet (opened from the roster). Same shape family as
--      eki_student_careers_profile, double-gated, no transcript.
--   5. eki_invite_to_appointment() / respond_to_appointment_invitation()  —
--      the staff-side entry point into, and the student-side response to, the
--      EXISTING appointment system. No second appointment model.
--   6. send_careers_message() / list_my_careers_messages() /
--      mark_careers_message_read() / eki_list_student_messages().
--   7. list_institution_appointments() re-created to surface invite context.
--
-- Idempotent, additive. No student-domain table is dropped or truncated; no
-- existing policy or function is weakened. Timestamped after
-- 20260909200000_careers_relationship_history.sql.
-- =============================================================================

-- =============================================================================
-- 1. APPOINTMENTS — staff-initiated invitations
-- =============================================================================
alter table public.appointments
  add column if not exists invited_by     uuid references public.profiles(id) on delete set null,
  add column if not exists invited_at     timestamptz,
  add column if not exists invite_message text check (invite_message is null or char_length(invite_message) <= 2000),
  add column if not exists responded_at   timestamptz;

-- widen the status domain: 'invited' (staff sent it, awaiting the student) and
-- 'declined' (student said no). 'booked' now also means "invitation accepted".
do $$
begin
  alter table public.appointments drop constraint if exists appointments_status_check;
  alter table public.appointments add constraint appointments_status_check
    check (status in ('invited', 'booked', 'cancelled', 'completed', 'no_show', 'declined'));
end $$;

create index if not exists appointments_invited_idx
  on public.appointments (institution_id) where status = 'invited';

-- The existing appointments_read policy (student = own row, OR staff of the
-- institution) already covers 'invited' rows — student_id is set on invite.
-- No RLS change required; writes stay RPC-only.

-- =============================================================================
-- 2. CAREERS MESSAGES — deliberate staff -> student communication (type C)
-- =============================================================================
create table if not exists public.careers_messages (
  id                     uuid primary key default gen_random_uuid(),
  institution_id         uuid not null references public.institutions(id) on delete cascade,
  student_id             uuid not null references public.profiles(id) on delete cascade,
  sender_staff_id        uuid references public.profiles(id) on delete set null,
  body                   text not null check (char_length(body) between 1 and 4000),
  related_appointment_id uuid references public.appointments(id) on delete set null,
  created_at             timestamptz not null default now(),
  read_at                timestamptz
);
create index if not exists careers_messages_student_idx     on public.careers_messages (student_id, created_at desc);
create index if not exists careers_messages_institution_idx  on public.careers_messages (institution_id, created_at desc);
create index if not exists careers_messages_unread_idx       on public.careers_messages (student_id) where read_at is null;

alter table public.careers_messages enable row level security;

-- A student reads ONLY their own messages. They never see adviser notes,
-- analytics, or another student's messages.
drop policy if exists careers_messages_student_read on public.careers_messages;
create policy careers_messages_student_read on public.careers_messages
  for select using (student_id = (select auth.uid()));

-- Careers staff read their own institution's messages (so the profile can show
-- what has been sent). Institution-scoped — never another institution's.
drop policy if exists careers_messages_staff_read on public.careers_messages;
create policy careers_messages_staff_read on public.careers_messages
  for select using (public.jr_inst_role(institution_id) is not null);

-- No INSERT / UPDATE / DELETE policy. send_careers_message() and
-- mark_careers_message_read() (SECURITY DEFINER) are the only write paths.

-- =============================================================================
-- 3. READINESS ROSTER  — the careers-team drill-in
-- -----------------------------------------------------------------------------
-- Authorised, institution-scoped, respects the selected cohort(s) + date range.
-- jr_inst_scope_student_ids() already raises 42501 for a non-staff caller and
-- for a caller who is not staff of THIS institution — same gate the aggregate
-- analytics use. Individual identification here is the authorised careers-team
-- workflow (cf. eki_student_briefing); the AGGREGATE distribution still carries
-- `suppressed` when assessed < MIN_COHORT_N so the analytics page hides it.
-- No transcript, no free-text competency, nothing cross-institution.
-- =============================================================================
create or replace function public.eki_readiness_roster(
  p_institution_id uuid,
  p_cohort_ids uuid[] default null,
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c_min_n         constant int := 5;   -- k-anonymity threshold for the aggregate
  c_target        constant int := 70;  -- interview-ready
  c_support_floor constant int := 55;  -- c_target - 15 (matches eki_student_briefing's priority cutoff)
  v_students uuid[];
  v_result  jsonb;
begin
  -- staff-gate + scope (raises 42501 if the caller is not staff of this institution)
  select array_agg(s) into v_students
    from public.jr_inst_scope_student_ids(p_institution_id, p_cohort_ids) s;
  v_students := coalesce(v_students, '{}');

  return (
  with iv as (
    select i.id, i.user_id,
           coalesce(ir.overall_score, i.overall_score)::numeric as score,
           coalesce(i.completed_at, i.created_at) as at
      from public.interviews i
      left join public.interview_reports ir on ir.interview_id = i.id
     where i.user_id = any(v_students) and i.status = 'completed'
       and coalesce(ir.overall_score, i.overall_score) is not null
       and (p_from is null or coalesce(i.completed_at, i.created_at) >= p_from)
       and (p_to   is null or coalesce(i.completed_at, i.created_at) <= p_to)
  ),
  per_student as (
    select user_id, avg(score) ms, count(*) n_iv, max(at) last_at
      from iv group by user_id
  ),
  latest as (
    select distinct on (user_id) user_id, score latest_score
      from iv order by user_id, at desc
  ),
  dim_ans as (
    select i.user_id, d.dim, d.v::numeric v
      from public.evaluations e
      join public.answers a on a.id = e.answer_id
      join public.interview_questions q on q.id = a.question_id
      join public.interviews i on i.id = q.interview_id
      cross join lateral (values
        ('relevance', e.relevance), ('specificity', e.specificity), ('structure', e.structure),
        ('evidence', e.evidence), ('communication', e.clarity), ('competency_demonstration', e.competency_demonstration)
      ) d(dim, v)
     where i.user_id = any(v_students) and i.status = 'completed'
       and (p_from is null or coalesce(i.completed_at, i.created_at) >= p_from)
       and (p_to   is null or coalesce(i.completed_at, i.created_at) <= p_to)
  ),
  dim_mean as (
    select user_id, dim, avg(v) m from dim_ans where v is not null group by user_id, dim
  ),
  weakest as (
    select distinct on (user_id) user_id, dim weakest_dim
      from dim_mean order by user_id, m asc
  ),
  classified as (
    select ps.user_id, round(ps.ms) mean_score, ps.n_iv, la.latest_score, w.weakest_dim,
           case when ps.ms >= c_target then 'ready'
                when ps.ms >= c_support_floor then 'developing'
                else 'needs_support' end as readiness
      from per_student ps
      left join latest la on la.user_id = ps.user_id
      left join weakest w on w.user_id = ps.user_id
  ),
  assessed as (select count(*) n from classified),
  groups as (
    select g.key,
           coalesce((select count(*) from classified c where c.readiness = g.key), 0) cnt
      from (values ('ready'), ('developing'), ('needs_support')) g(key)
  )
  select jsonb_build_object(
    'supported', true,
    'min_n', c_min_n,
    'readiness_target', c_target,
    'support_floor', c_support_floor,
    'generated_at', now(),
    'scope', jsonb_build_object(
      'institution_id', p_institution_id,
      'cohort_ids', to_jsonb(p_cohort_ids),
      'from', p_from, 'to', p_to,
      'students_in_scope', coalesce(array_length(v_students, 1), 0),
      'students_assessed', (select n from assessed)
    ),
    'distribution', jsonb_build_object(
      'assessed', (select n from assessed),
      'suppressed', ((select n from assessed) < c_min_n),
      'groups', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'key', key,
          'count', cnt,
          'pct', case when (select n from assessed) > 0
                      then round(100.0 * cnt / (select n from assessed))::int
                      else 0 end
        ) order by array_position(array['ready','developing','needs_support'], key)), '[]'::jsonb)
        from groups
      )
    ),
    -- the authorised per-student roster (careers-team workflow only)
    'students', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', c.user_id,
        'name', (select nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '')
                   from public.profiles p where p.id = c.user_id),
        'readiness', c.readiness,
        'mean_score', c.mean_score,
        'latest_score', c.latest_score,
        'n_interviews', c.n_iv,
        'main_development_area', c.weakest_dim
      ) order by c.mean_score asc), '[]'::jsonb)
      from classified c
    )
  ));
end;
$$;

-- =============================================================================
-- 4. STUDENT SNAPSHOT  — the Student Careers Profile without an appointment
-- -----------------------------------------------------------------------------
-- Opened from the readiness roster. Same double-gate as eki_student_briefing /
-- eki_student_careers_profile (staff of the institution AND the student is a
-- current linked cohort member of it). Returns the same shape family the
-- frontend already shapes: student / interview_dna / patterns / previous_support
-- / history[] / longitudinal[]. No appointment / current_outcome block, no
-- transcript, nothing cross-institution.
-- =============================================================================
create or replace function public.eki_student_snapshot(
  p_institution_id uuid,
  p_student_id uuid
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
    select 1 from public.cohort_members cm
    join public.cohorts c on c.id = cm.cohort_id
    where c.institution_id = v_inst and cm.student_id = v_student and cm.status <> 'removed'
  ) then
    raise exception 'student is not in your institution' using errcode = '42501';
  end if;

  -- most recent appointment for this student at THIS institution
  select ap.id, coalesce(sl.starts_at, ap.booked_at)
    into v_prev_id, v_prev_at
    from public.appointments ap
    left join public.appointment_slots sl on sl.id = ap.slot_id
   where ap.student_id = v_student and ap.institution_id = v_inst
   order by coalesce(sl.starts_at, ap.booked_at) desc
   limit 1;

  with
  ivs as (
    select i.id, coalesce(ir.overall_score, i.overall_score)::numeric score,
           coalesce(i.completed_at, i.created_at) at,
           row_number() over (order by coalesce(i.completed_at, i.created_at)) rn,
           count(*) over () cnt
      from public.interviews i
      left join public.interview_reports ir on ir.interview_id = i.id
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
    select dim, round(avg(v))::int mean
      from ans where v_prev_at is not null and at <= v_prev_at group by dim
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
    select h.id, h.at, h.type_label, h.actions_agreed
      from hist h
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
  )
  select jsonb_build_object(
    'generated_at', v_now, 'target', c_target, 'recent_window', c_recent_n,
    'student', jsonb_build_object(
      'name', (select nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), '') from public.profiles where id = v_student),
      'institution_name', (select name from public.institutions where id = v_inst),
      'cohorts', (select coalesce(jsonb_agg(distinct c.name), '[]'::jsonb) from public.cohort_members cm join public.cohorts c on c.id = cm.cohort_id
                   where c.institution_id = v_inst and cm.student_id = v_student and cm.status <> 'removed')),
    'appointment', null,
    'current_outcome', null,
    'application', null,
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
      ) end
      from hist h where h.id = v_prev_id),
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'appointment_id', id, 'starts_at', at, 'status', status, 'type_label', type_label,
        'adviser_name', adviser_name, 'student_comment', student_comment,
        'has_outcome', (discussed is not null or actions_agreed is not null or next_steps is not null),
        'discussed', discussed, 'actions_agreed', actions_agreed, 'next_steps', next_steps,
        'follow_up_required', coalesce(follow_up_required, false), 'follow_up_notes', follow_up_notes,
        'outcome_updated_at', outcome_updated_at, 'outcome_by', outcome_by
      ) order by at desc), '[]'::jsonb)
      from hist),
    'longitudinal', (
      select case when lc.prior_id is null or lc.n_before < 1 or lc.n_after < 1 then '[]'::jsonb
        else jsonb_build_array(jsonb_build_object(
          'kind', 'interview_score_change_after_intervention',
          'prior_appointment_id', lc.prior_id, 'prior_date', lc.prior_at, 'prior_type', lc.prior_type,
          'before_mean', lc.before_mean, 'after_mean', lc.after_mean,
          'delta', lc.after_mean - lc.before_mean, 'n_before', lc.n_before, 'n_after', lc.n_after
        )) end
      from long_calc lc)
  ) into v_result;

  return v_result;
end;
$$;

-- =============================================================================
-- 5. STAFF-INITIATED APPOINTMENT INVITATION (into the existing appointment model)
-- =============================================================================
create or replace function public.eki_invite_to_appointment(
  p_slot_id uuid,
  p_student_id uuid,
  p_appointment_type_id uuid default null,
  p_message text default null,
  p_application_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid       uuid := (select auth.uid());
  v_slot    public.appointment_slots;
  v_type_id uuid;
  v_appt_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_slot from public.appointment_slots where id = p_slot_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'slot_not_found');
  end if;

  -- caller must be staff of the slot's institution
  if public.jr_inst_role(v_slot.institution_id) is null then
    raise exception 'not authorised for this institution' using errcode = '42501';
  end if;
  -- the invited student must be a CURRENT linked cohort member of that institution
  if not exists (
    select 1 from public.cohort_members cm
    join public.cohorts c on c.id = cm.cohort_id
    where c.institution_id = v_slot.institution_id and cm.student_id = p_student_id and cm.status <> 'removed'
  ) then
    raise exception 'student is not in your institution' using errcode = '42501';
  end if;

  if v_slot.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'slot_taken');
  end if;
  if v_slot.starts_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'slot_past');
  end if;

  v_type_id := coalesce(v_slot.appointment_type_id, p_appointment_type_id);
  if v_type_id is not null and not exists (
    select 1 from public.appointment_types at
    where at.id = v_type_id and at.active
      and (at.institution_id is null or at.institution_id = v_slot.institution_id)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_type');
  end if;

  -- an application context, if given, must belong to the invited student
  if p_application_id is not null and not exists (
    select 1 from public.applications a where a.id = p_application_id and a.user_id = p_student_id
  ) then
    raise exception 'application not found' using errcode = '42501';
  end if;

  update public.appointment_slots set status = 'booked', updated_at = now() where id = p_slot_id;

  insert into public.appointments (
    slot_id, institution_id, student_id, appointment_type_id, application_id,
    status, invited_by, invited_at, invite_message
  ) values (
    p_slot_id, v_slot.institution_id, p_student_id, v_type_id, p_application_id,
    'invited', uid, now(), nullif(btrim(coalesce(p_message, '')), '')
  )
  returning id into v_appt_id;

  return jsonb_build_object('ok', true, 'appointment_id', v_appt_id, 'institution_id', v_slot.institution_id);
end;
$$;

-- The student accepts or declines a staff invitation.
create or replace function public.respond_to_appointment_invitation(
  p_appointment_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid     uuid := (select auth.uid());
  v_ap    public.appointments;
  v_starts timestamptz;
begin
  select * into v_ap from public.appointments where id = p_appointment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_ap.student_id <> uid then
    raise exception 'not your invitation' using errcode = '42501';
  end if;
  if v_ap.status <> 'invited' then
    return jsonb_build_object('ok', true, 'already', v_ap.status);
  end if;

  if p_accept then
    update public.appointments
       set status = 'booked', responded_at = now(), updated_at = now()
     where id = p_appointment_id;
    return jsonb_build_object('ok', true, 'status', 'booked');
  else
    update public.appointments
       set status = 'declined', responded_at = now(),
           cancelled_at = now(), cancelled_by = uid, updated_at = now()
     where id = p_appointment_id;
    select starts_at into v_starts from public.appointment_slots where id = v_ap.slot_id;
    update public.appointment_slots
       set status = case when v_starts > now() then 'open' else 'blocked' end, updated_at = now()
     where id = v_ap.slot_id;
    return jsonb_build_object('ok', true, 'status', 'declined');
  end if;
end;
$$;

-- =============================================================================
-- 6. CAREERS MESSAGES — send / list / mark read
-- =============================================================================
create or replace function public.send_careers_message(
  p_institution_id uuid,
  p_student_id uuid,
  p_body text,
  p_related_appointment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid   uuid := (select auth.uid());
  v_msg uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.jr_inst_role(p_institution_id) is null then
    raise exception 'not authorised for this institution' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.cohort_members cm
    join public.cohorts c on c.id = cm.cohort_id
    where c.institution_id = p_institution_id and cm.student_id = p_student_id and cm.status <> 'removed'
  ) then
    raise exception 'student is not in your institution' using errcode = '42501';
  end if;
  if v_body = '' or char_length(v_body) > 4000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_body');
  end if;
  -- a related appointment, if given, must belong to this student + institution
  if p_related_appointment_id is not null and not exists (
    select 1 from public.appointments a
    where a.id = p_related_appointment_id and a.student_id = p_student_id and a.institution_id = p_institution_id
  ) then
    raise exception 'appointment not found' using errcode = '42501';
  end if;

  insert into public.careers_messages (institution_id, student_id, sender_staff_id, body, related_appointment_id)
  values (p_institution_id, p_student_id, uid, v_body, p_related_appointment_id)
  returning id into v_msg;

  return jsonb_build_object('ok', true, 'message_id', v_msg);
end;
$$;

-- The signed-in student's own careers messages (newest first).
create or replace function public.list_my_careers_messages()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(m order by m->>'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', cm.id,
      'institution_name', i.name,
      'sender_name', nullif(trim(coalesce(sp.first_name,'') || ' ' || coalesce(sp.last_name,'')), ''),
      'body', cm.body,
      'created_at', cm.created_at,
      'read_at', cm.read_at,
      'related_appointment', case when cm.related_appointment_id is null then null else
        jsonb_build_object(
          'id', ap.id, 'status', ap.status,
          'starts_at', (select starts_at from public.appointment_slots where id = ap.slot_id),
          'type_label', coalesce(at.label, 'Careers appointment')
        ) end
    ) m
    from public.careers_messages cm
    join public.institutions i on i.id = cm.institution_id
    left join public.profiles sp on sp.id = cm.sender_staff_id
    left join public.appointments ap on ap.id = cm.related_appointment_id
    left join public.appointment_types at on at.id = ap.appointment_type_id
    where cm.student_id = (select auth.uid())
  ) q;
$$;

-- The student marks one of their own messages read.
create or replace function public.mark_careers_message_read(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.careers_messages;
begin
  select * into v_row from public.careers_messages where id = p_message_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.student_id <> (select auth.uid()) then
    raise exception 'not your message' using errcode = '42501';
  end if;
  update public.careers_messages set read_at = coalesce(read_at, now()) where id = p_message_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Staff-side: the messages sent to one student at one institution (for the
-- Student Careers Profile). Double-gated. Institution-scoped.
create or replace function public.eki_list_student_messages(
  p_institution_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if public.jr_inst_role(p_institution_id) is null then
    raise exception 'not authorised for this institution' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.cohort_members cm
    join public.cohorts c on c.id = cm.cohort_id
    where c.institution_id = p_institution_id and cm.student_id = p_student_id and cm.status <> 'removed'
  ) then
    raise exception 'student is not in your institution' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(m order by m->>'created_at' desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', cm.id,
        'body', cm.body,
        'created_at', cm.created_at,
        'read_at', cm.read_at,
        'sender_name', nullif(trim(coalesce(sp.first_name,'') || ' ' || coalesce(sp.last_name,'')), ''),
        'related_appointment_id', cm.related_appointment_id
      ) m
      from public.careers_messages cm
      left join public.profiles sp on sp.id = cm.sender_staff_id
      where cm.institution_id = p_institution_id and cm.student_id = p_student_id
    ) q
  );
end;
$$;

-- =============================================================================
-- 7a. list_my_appointments — surface the staff invitation to the student
-- -----------------------------------------------------------------------------
-- Re-created (create or replace) so a student sees a staff-sent invitation with
-- its reason (invite_message) and who sent it. Still the caller's own rows only.
-- =============================================================================
create or replace function public.list_my_appointments()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(a order by a->>'starts_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', ap.id,
      'status', ap.status,
      'starts_at', sl.starts_at,
      'ends_at', sl.ends_at,
      'institution_id', ap.institution_id,
      'institution_name', i.name,
      'type_label', coalesce(at.label, 'Careers appointment'),
      'type_key', at.key,
      'staff_name', nullif(trim(coalesce(sp.first_name,'') || ' ' || coalesce(sp.last_name,'')), ''),
      'student_comment', ap.student_comment,
      'is_invite', (ap.status = 'invited'),
      'invite_message', ap.invite_message,
      'invited_by_name', nullif(trim(coalesce(inv.first_name,'') || ' ' || coalesce(inv.last_name,'')), ''),
      'application', case when ap.application_id is null then null else
        jsonb_build_object('id', app.id, 'company', app.company, 'role', app.role) end,
      'booked_at', ap.booked_at,
      'cancelled_at', ap.cancelled_at
    ) a
    from public.appointments ap
    join public.appointment_slots sl on sl.id = ap.slot_id
    join public.institutions i on i.id = ap.institution_id
    left join public.appointment_types at on at.id = ap.appointment_type_id
    left join public.profiles sp on sp.id = sl.staff_id
    left join public.profiles inv on inv.id = ap.invited_by
    left join public.applications app on app.id = ap.application_id
    where ap.student_id = (select auth.uid())
  ) q;
$$;

-- =============================================================================
-- 7b. list_institution_appointments — surface invite context in the schedule
-- -----------------------------------------------------------------------------
-- Re-created (create or replace) with the invite fields. Still staff-gated,
-- still returns only display aggregates + the student's own comment / the
-- staff's own invite message. No transcript.
-- =============================================================================
create or replace function public.list_institution_appointments(
  p_institution_id uuid,
  p_from timestamptz default null,
  p_to   timestamptz default null,
  p_statuses text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if public.jr_inst_role(p_institution_id) is null then
    raise exception 'not authorised for this institution' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(a order by a->>'starts_at'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', ap.id,
        'status', ap.status,
        'starts_at', sl.starts_at,
        'ends_at', sl.ends_at,
        'student_name', nullif(trim(coalesce(stu.first_name,'') || ' ' || coalesce(stu.last_name,'')), ''),
        'staff_name', nullif(trim(coalesce(stf.first_name,'') || ' ' || coalesce(stf.last_name,'')), ''),
        'staff_id', sl.staff_id,
        'type_label', coalesce(at.label, 'Careers appointment'),
        'type_key', at.key,
        'has_application', (ap.application_id is not null),
        'is_invite', (ap.status = 'invited'),
        'comment_preview', left(coalesce(nullif(btrim(ap.student_comment), ''), ap.invite_message, ''), 140),
        'invited_by_name', nullif(trim(coalesce(inv.first_name,'') || ' ' || coalesce(inv.last_name,'')), ''),
        'booked_at', ap.booked_at
      ) a
      from public.appointments ap
      join public.appointment_slots sl on sl.id = ap.slot_id
      left join public.profiles stu on stu.id = ap.student_id
      left join public.profiles stf on stf.id = sl.staff_id
      left join public.profiles inv on inv.id = ap.invited_by
      left join public.appointment_types at on at.id = ap.appointment_type_id
      where ap.institution_id = p_institution_id
        and (p_from is null or sl.starts_at >= p_from)
        and (p_to   is null or sl.starts_at <= p_to)
        and (p_statuses is null or ap.status = any(p_statuses))
    ) q
  );
end;
$$;

-- =============================================================================
-- 8. GRANTS — authenticated end users; every RPC self-enforces authorisation.
-- =============================================================================
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.eki_readiness_roster(uuid,uuid[],timestamptz,timestamptz)',
    'public.eki_student_snapshot(uuid,uuid)',
    'public.eki_invite_to_appointment(uuid,uuid,uuid,text,uuid)',
    'public.respond_to_appointment_invitation(uuid,boolean)',
    'public.send_careers_message(uuid,uuid,text,uuid)',
    'public.list_my_careers_messages()',
    'public.mark_careers_message_read(uuid)',
    'public.eki_list_student_messages(uuid,uuid)',
    'public.list_my_appointments()',
    'public.list_institution_appointments(uuid,timestamptz,timestamptz,text[])'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
