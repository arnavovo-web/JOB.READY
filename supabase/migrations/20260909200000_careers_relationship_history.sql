-- =============================================================================
-- EKI² — CAREERS RELATIONSHIP HISTORY
-- -----------------------------------------------------------------------------
-- Extends Careers Appointments into a persistent, INSTITUTION-SPECIFIC student
-- careers-support record: each appointment can carry one adviser outcome
-- (what was discussed / actions agreed / next steps / follow-up), and the
-- adviser opening a new appointment sees the chronological history plus the
-- previous session's context.
--
--   appointments ──1:1── appointment_outcomes   (the adviser's record for that appointment)
--   student ──*── appointments ──*── appointment_outcomes   =>  careers history
--
-- SECURITY
--   * appointment_outcomes is STAFF-ONLY. RLS: SELECT for staff of the row's
--     institution; NO student policy at all — a student can never read internal
--     adviser notes. NO client insert/update/delete policy — the only write path
--     is save_appointment_outcome() (SECURITY DEFINER), which validates staff
--     membership and stamps created_by / updated_by.
--   * One outcome row per appointment (unique appointment_id). Updating an
--     outcome overwrites THAT appointment's record only — a later appointment
--     never overwrites an earlier one. v1 keeps the latest version (no per-field
--     revision history — see the docs note).
--   * eki_student_careers_profile() is double-gated exactly like
--     eki_student_briefing (staff of the institution AND the student is a current
--     linked cohort member of it) and never returns another institution's
--     appointments / outcomes / history, nor any interview transcript.
--
-- Idempotent, additive. No existing table/policy/function is weakened.
-- Timestamped after 20260909190000_careers_appointments_policy_merge.sql.
-- =============================================================================

-- =============================================================================
-- TABLE
-- =============================================================================
create table if not exists public.appointment_outcomes (
  id                 uuid primary key default gen_random_uuid(),
  appointment_id     uuid not null unique references public.appointments(id) on delete cascade,
  institution_id     uuid not null references public.institutions(id) on delete cascade,  -- denormalised for RLS
  discussed          text check (discussed          is null or char_length(discussed)          <= 8000),
  actions_agreed     text check (actions_agreed     is null or char_length(actions_agreed)     <= 8000),
  next_steps         text check (next_steps         is null or char_length(next_steps)         <= 8000),
  follow_up_required boolean not null default false,
  follow_up_notes    text check (follow_up_notes    is null or char_length(follow_up_notes)    <= 8000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id) on delete set null,
  updated_by         uuid references public.profiles(id) on delete set null
);
create index if not exists appointment_outcomes_institution_idx on public.appointment_outcomes (institution_id);
create index if not exists appointment_outcomes_follow_up_idx    on public.appointment_outcomes (institution_id) where follow_up_required;

-- =============================================================================
-- RLS — staff read only; every write goes through the RPC
-- =============================================================================
alter table public.appointment_outcomes enable row level security;

drop policy if exists appointment_outcomes_staff_read on public.appointment_outcomes;
create policy appointment_outcomes_staff_read on public.appointment_outcomes
  for select using (public.jr_inst_role(institution_id) is not null);
-- No student policy. No insert/update/delete policy — save_appointment_outcome() only.

-- =============================================================================
-- RPC — save (create or update) an appointment's outcome record
-- =============================================================================
create or replace function public.save_appointment_outcome(
  p_appointment_id uuid,
  p_discussed text default null,
  p_actions_agreed text default null,
  p_next_steps text default null,
  p_follow_up_required boolean default false,
  p_follow_up_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid   uuid := (select auth.uid());
  v_ap  public.appointments;
  v_out public.appointment_outcomes;
  v_new boolean;
begin
  select * into v_ap from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'appointment not found' using errcode = '42501';
  end if;
  if public.jr_inst_role(v_ap.institution_id) is null then
    raise exception 'not authorised for this institution' using errcode = '42501';
  end if;

  select * into v_out from public.appointment_outcomes where appointment_id = p_appointment_id for update;
  v_new := not found;

  if v_new then
    insert into public.appointment_outcomes (
      appointment_id, institution_id, discussed, actions_agreed, next_steps,
      follow_up_required, follow_up_notes, created_by, updated_by
    ) values (
      p_appointment_id, v_ap.institution_id,
      nullif(btrim(coalesce(p_discussed, '')), ''),
      nullif(btrim(coalesce(p_actions_agreed, '')), ''),
      nullif(btrim(coalesce(p_next_steps, '')), ''),
      coalesce(p_follow_up_required, false),
      nullif(btrim(coalesce(p_follow_up_notes, '')), ''),
      uid, uid
    )
    returning * into v_out;
  else
    update public.appointment_outcomes set
      discussed          = nullif(btrim(coalesce(p_discussed, '')), ''),
      actions_agreed     = nullif(btrim(coalesce(p_actions_agreed, '')), ''),
      next_steps         = nullif(btrim(coalesce(p_next_steps, '')), ''),
      follow_up_required = coalesce(p_follow_up_required, false),
      follow_up_notes    = nullif(btrim(coalesce(p_follow_up_notes, '')), ''),
      updated_by         = uid,
      updated_at         = now()
    where appointment_id = p_appointment_id
    returning * into v_out;
  end if;

  return jsonb_build_object(
    'ok', true, 'is_new', v_new, 'outcome_id', v_out.id,
    'created_at', v_out.created_at, 'updated_at', v_out.updated_at
  );
end;
$$;

-- =============================================================================
-- RPC — the Student Careers Profile (evolved briefing)
-- -----------------------------------------------------------------------------
-- Superset of eki_student_briefing: same student / appointment / application /
-- interview_dna / patterns blocks, PLUS previous_support, history[] and
-- longitudinal[]. Double-gated. No transcript. Institution-scoped throughout.
-- =============================================================================
create or replace function public.eki_student_careers_profile(p_appointment_id uuid)
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
  v_ap       public.appointments;
  v_student  uuid;
  v_inst     uuid;
  v_appt_at  timestamptz;
  v_prev_at  timestamptz;
  v_prev_id  uuid;
  v_result   jsonb;
begin
  select * into v_ap from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'appointment not found' using errcode = '42501';
  end if;
  v_student := v_ap.student_id;
  v_inst    := v_ap.institution_id;

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

  select coalesce(sl.starts_at, v_ap.booked_at) into v_appt_at
    from public.appointment_slots sl where sl.id = v_ap.slot_id;

  -- the immediately-previous appointment for this student at THIS institution
  select ap.id, coalesce(sl.starts_at, ap.booked_at)
    into v_prev_id, v_prev_at
    from public.appointments ap
    left join public.appointment_slots sl on sl.id = ap.slot_id
   where ap.student_id = v_student and ap.institution_id = v_inst
     and ap.id <> p_appointment_id
     and coalesce(sl.starts_at, ap.booked_at) < coalesce(v_appt_at, now())
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
  -- key development area AS OF the previous appointment: weakest dimension over
  -- answers from interviews completed on or before that appointment's date
  prev_dim as (
    select dim, round(avg(v))::int mean
      from ans where v_prev_at is not null and at <= v_prev_at
     group by dim
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
       and ap.id <> p_appointment_id
       and coalesce(sl.starts_at, ap.booked_at) < coalesce(v_appt_at, now())
  ),
  -- longitudinal: interview-score change around the previous appointment that
  -- HAS a recorded outcome. Factual only — before-window vs after-window means.
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
    'generated_at', now(), 'target', c_target, 'recent_window', c_recent_n,
    'student', jsonb_build_object(
      'name', (select nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), '') from public.profiles where id = v_student),
      'institution_name', (select name from public.institutions where id = v_inst),
      'cohorts', (select coalesce(jsonb_agg(distinct c.name), '[]'::jsonb) from public.cohort_members cm join public.cohorts c on c.id = cm.cohort_id
                   where c.institution_id = v_inst and cm.student_id = v_student and cm.status <> 'removed')),
    'appointment', jsonb_build_object(
      'id', v_ap.id, 'status', v_ap.status,
      'type_label', (select coalesce(label, 'Careers appointment') from public.appointment_types where id = v_ap.appointment_type_id),
      'starts_at', v_appt_at,
      'ends_at', (select ends_at from public.appointment_slots where id = v_ap.slot_id),
      'student_comment', v_ap.student_comment),
    -- the outcome record for THIS appointment (for the adviser's editable form)
    'current_outcome', (
      select case when o.id is null then null else jsonb_build_object(
        'discussed', o.discussed, 'actions_agreed', o.actions_agreed, 'next_steps', o.next_steps,
        'follow_up_required', o.follow_up_required, 'follow_up_notes', o.follow_up_notes,
        'created_at', o.created_at, 'updated_at', o.updated_at,
        'updated_by_name', (select nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), '') from public.profiles where id = o.updated_by)
      ) end
      from public.appointment_outcomes o where o.appointment_id = p_appointment_id),
    'application', (
      select case when v_ap.application_id is null then null else jsonb_build_object(
        'company', app.company, 'role', app.role, 'stage', app.interview_stage, 'interview_date', app.interview_date,
        'created_at', app.created_at,
        'practice_interviews', (select count(*) from public.interviews i2 where i2.application_id = app.id and i2.status = 'completed')
      ) end from public.applications app where app.id = v_ap.application_id),
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
        'appointment_id', h.id,
        'starts_at', h.at,
        'days_ago', greatest(0, floor(extract(epoch from (now() - h.at)) / 86400))::int,
        'type_label', h.type_label,
        'adviser_name', h.adviser_name,
        'status', h.status,
        'student_comment', h.student_comment,
        'key_development_area', (select dim from prev_dim order by mean asc limit 1),
        'has_outcome', (h.discussed is not null or h.actions_agreed is not null or h.next_steps is not null),
        'actions_agreed', h.actions_agreed,
        'next_steps', h.next_steps,
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
          'prior_appointment_id', lc.prior_id,
          'prior_date', lc.prior_at,
          'prior_type', lc.prior_type,
          'before_mean', lc.before_mean,
          'after_mean', lc.after_mean,
          'delta', lc.after_mean - lc.before_mean,
          'n_before', lc.n_before,
          'n_after', lc.n_after
        )) end
      from long_calc lc)
  ) into v_result;

  return v_result;
end;
$$;

-- =============================================================================
-- GRANTS
-- =============================================================================
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.save_appointment_outcome(uuid,text,text,text,boolean,text)',
    'public.eki_student_careers_profile(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
