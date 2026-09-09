-- =============================================================================
-- EKI² — CAREERS APPOINTMENTS
-- -----------------------------------------------------------------------------
-- Connects the normal JOB.READY student platform to the institutional (EKI²)
-- careers team: a student books a slot with their university careers team; the
-- adviser sees it in the EKI² schedule and opens a FOCUSED student intelligence
-- briefing — strengths / development areas / patterns / the relevant
-- application — derived from EXISTING JOB.READY interview data. No student
-- transcript is exposed; no parallel student identity is created; appointments
-- reference `profiles` / `applications` by FK.
--
--   appointment_types    global defaults (institution_id null) + per-institution
--   appointment_slots    a careers staff member's availability window
--   appointments         one booked slot ↔ one student (+ optional application)
--
-- SECURITY
--   * All three tables have RLS.
--   * A student may READ open future slots + their institution's active
--     appointment types, and their OWN appointments. A student never writes any
--     of these tables directly — booking / cancelling go through SECURITY
--     DEFINER RPCs that validate the student↔institution link, the slot state
--     and (if given) application ownership, atomically.
--   * Careers staff (any institution_staff row) READ their institution's slots +
--     appointments and MANAGE their own slots. Appointment state changes go
--     through a staff RPC.
--   * `eki_student_briefing(appointment_id)` is the only path to individual
--     student intelligence. It double-gates: the caller must be staff of the
--     appointment's institution AND the appointment's student must be a current
--     linked cohort member of that institution. It returns aggregates +
--     the student's own appointment comment — never a raw answer or transcript.
--   * `btree_gist` + an exclusion constraint stop a staff member having two
--     overlapping open/booked slots; `appointments.slot_id` is UNIQUE so a slot
--     can be booked once.
--
-- Idempotent (create ... if not exists / create or replace / drop policy if
-- exists + recreate). Additive — the only pre-existing objects touched are FK
-- references into profiles / applications / institutions / cohorts. No student
-- table is altered; no existing policy or function is weakened.
-- Timestamped after 20260909170000_institutional_rls_policy_split.sql.
-- =============================================================================

-- btree_gist powers the appointment_slots no-overlap exclusion constraint.
-- Installed into `extensions` (Supabase convention), not `public`.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- =============================================================================
-- TABLES
-- =============================================================================

create table if not exists public.appointment_types (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id) on delete cascade,  -- null = global default
  key            text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  label          text not null check (char_length(label) between 1 and 80),
  description    text check (description is null or char_length(description) <= 400),
  sort_order     integer not null default 100,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
-- one key per institution (and one per global set)
create unique index if not exists appointment_types_global_key_uidx
  on public.appointment_types (key) where institution_id is null;
create unique index if not exists appointment_types_institution_key_uidx
  on public.appointment_types (institution_id, key) where institution_id is not null;
create index if not exists appointment_types_institution_id_idx on public.appointment_types (institution_id);

create table if not exists public.appointment_slots (
  id                  uuid primary key default gen_random_uuid(),
  institution_id      uuid not null references public.institutions(id) on delete cascade,
  staff_id            uuid not null references public.profiles(id) on delete cascade,
  appointment_type_id uuid references public.appointment_types(id) on delete set null, -- null = staff takes any type
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  status              text not null default 'open'
                        check (status in ('open', 'booked', 'blocked', 'cancelled')),
  note                text check (note is null or char_length(note) <= 400),
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint appointment_slots_time_order_chk check (ends_at > starts_at),
  constraint appointment_slots_no_overlap
    exclude using gist (staff_id with =, tstzrange(starts_at, ends_at) with &&)
    where (status in ('open', 'booked'))
);
create index if not exists appointment_slots_institution_starts_idx on public.appointment_slots (institution_id, starts_at);
create index if not exists appointment_slots_staff_starts_idx       on public.appointment_slots (staff_id, starts_at);
create index if not exists appointment_slots_open_idx               on public.appointment_slots (institution_id, starts_at) where status = 'open';

create table if not exists public.appointments (
  id                  uuid primary key default gen_random_uuid(),
  slot_id             uuid not null unique references public.appointment_slots(id) on delete cascade,
  institution_id      uuid not null references public.institutions(id) on delete cascade,
  student_id          uuid not null references public.profiles(id) on delete cascade,
  appointment_type_id uuid references public.appointment_types(id) on delete set null,
  application_id      uuid references public.applications(id) on delete set null,
  student_comment     text check (student_comment is null or char_length(student_comment) <= 2000),
  status              text not null default 'booked'
                        check (status in ('booked', 'cancelled', 'completed', 'no_show')),
  booked_at           timestamptz not null default now(),
  cancelled_at        timestamptz,
  cancelled_by        uuid references public.profiles(id) on delete set null,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists appointments_institution_status_idx on public.appointments (institution_id, status);
create index if not exists appointments_student_id_idx         on public.appointments (student_id);
create index if not exists appointments_application_id_idx     on public.appointments (application_id);

-- =============================================================================
-- SEED — global default appointment types (institution_id null)
-- =============================================================================
insert into public.appointment_types (institution_id, key, label, description, sort_order) values
  (null, 'interview_prep',     'Interview preparation', 'Practice and feedback for an upcoming interview', 10),
  (null, 'application_review', 'Application review',    'A second pair of eyes on an application before you submit', 20),
  (null, 'cv_review',          'CV review',             'Feedback on your CV / resume', 30),
  (null, 'career_guidance',    'Career guidance',       'Direction, options and next steps', 40),
  (null, 'general_support',    'General careers support','Anything else', 50)
on conflict do nothing;

-- =============================================================================
-- HELPER — institutions the caller is a linked student of
-- =============================================================================
create or replace function public.jr_student_institution_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select distinct c.institution_id
    from public.cohort_members cm
    join public.cohorts c on c.id = cm.cohort_id
   where cm.student_id = (select auth.uid())
     and cm.status <> 'removed';
$$;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
alter table public.appointment_types enable row level security;
alter table public.appointment_slots enable row level security;
alter table public.appointments      enable row level security;

-- ---- appointment_types --------------------------------------------------
drop policy if exists appointment_types_read on public.appointment_types;
create policy appointment_types_read on public.appointment_types
  for select using (
    institution_id is null
    or public.jr_inst_role(institution_id) is not null
    or institution_id in (select public.jr_student_institution_ids())
  );
drop policy if exists appointment_types_write on public.appointment_types;
create policy appointment_types_write on public.appointment_types
  for all using (institution_id is not null and public.jr_inst_can_manage(institution_id))
  with check (institution_id is not null and public.jr_inst_can_manage(institution_id));

-- ---- appointment_slots ------------------------------------------------
drop policy if exists appointment_slots_staff_read on public.appointment_slots;
create policy appointment_slots_staff_read on public.appointment_slots
  for select using (public.jr_inst_role(institution_id) is not null);

-- a student sees OPEN future slots for their institution(s), plus any slot tied
-- to one of their own appointments (so "my booking" can show the time).
drop policy if exists appointment_slots_student_read on public.appointment_slots;
create policy appointment_slots_student_read on public.appointment_slots
  for select using (
    (status = 'open' and starts_at > now()
      and institution_id in (select public.jr_student_institution_ids()))
    or id in (select a.slot_id from public.appointments a where a.student_id = (select auth.uid()))
  );

-- staff manage their OWN slots; an owner/admin manages any in their institution.
drop policy if exists appointment_slots_manage on public.appointment_slots;
create policy appointment_slots_manage on public.appointment_slots
  for all using (
    public.jr_inst_role(institution_id) is not null
    and (staff_id = (select auth.uid()) or public.jr_inst_can_manage(institution_id))
  ) with check (
    public.jr_inst_role(institution_id) is not null
    and (staff_id = (select auth.uid()) or public.jr_inst_can_manage(institution_id))
  );

-- ---- appointments ------------------------------------------------------
-- READ only. All writes go through the SECURITY DEFINER RPCs below.
drop policy if exists appointments_student_read on public.appointments;
create policy appointments_student_read on public.appointments
  for select using (student_id = (select auth.uid()));
drop policy if exists appointments_staff_read on public.appointments;
create policy appointments_staff_read on public.appointments
  for select using (public.jr_inst_role(institution_id) is not null);

-- =============================================================================
-- RPCs — reads
-- =============================================================================

-- Global + the caller's institutions' active appointment types.
create or replace function public.list_appointment_types(p_institution_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(t order by t->>'sort_order', t->>'label'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', at.id, 'key', at.key, 'label', at.label, 'description', at.description,
      'institution_id', at.institution_id, 'sort_order', at.sort_order
    ) t
    from public.appointment_types at
    where at.active
      and (
        at.institution_id is null
        or at.institution_id = p_institution_id
        or (p_institution_id is null and (
             at.institution_id in (select public.jr_student_institution_ids())
             or public.jr_inst_role(at.institution_id) is not null))
      )
  ) q;
$$;

-- Open, future availability for a student — across their institution(s), or one.
create or replace function public.list_careers_availability(p_institution_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  uid uuid := (select auth.uid());
  v_inst uuid[];
begin
  select array_agg(x) into v_inst from public.jr_student_institution_ids() x;
  v_inst := coalesce(v_inst, '{}');
  if p_institution_id is not null then
    if not (p_institution_id = any(v_inst)) then
      return '[]'::jsonb;
    end if;
    v_inst := array[p_institution_id];
  end if;

  return (
    select coalesce(jsonb_agg(s order by s->>'starts_at'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'slot_id', sl.id,
        'institution_id', sl.institution_id,
        'institution_name', i.name,
        'staff_name', nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''),
        'type_id', at.id,
        'type_key', at.key,
        'type_label', at.label,
        'starts_at', sl.starts_at,
        'ends_at', sl.ends_at
      ) s
      from public.appointment_slots sl
      join public.institutions i on i.id = sl.institution_id
      left join public.profiles p on p.id = sl.staff_id
      left join public.appointment_types at on at.id = sl.appointment_type_id
      where sl.status = 'open'
        and sl.starts_at > now()
        and sl.institution_id = any(v_inst)
    ) q
  );
end;
$$;

-- The caller's own appointments (upcoming + past), joined for display.
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
    left join public.applications app on app.id = ap.application_id
    where ap.student_id = (select auth.uid())
  ) q;
$$;

-- A careers team member's schedule for their institution, in a window.
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
        'comment_preview', left(coalesce(ap.student_comment, ''), 140),
        'booked_at', ap.booked_at
      ) a
      from public.appointments ap
      join public.appointment_slots sl on sl.id = ap.slot_id
      left join public.profiles stu on stu.id = ap.student_id
      left join public.profiles stf on stf.id = sl.staff_id
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
-- RPCs — writes (student + staff)
-- =============================================================================

-- Book an open slot. Atomic: locks the slot, re-checks it is open + future,
-- validates the student↔institution link and (if given) application ownership,
-- flips the slot to 'booked' and inserts the appointment.
create or replace function public.book_appointment(
  p_slot_id uuid,
  p_appointment_type_id uuid default null,
  p_application_id uuid default null,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := (select auth.uid());
  v_slot public.appointment_slots;
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
  if v_slot.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'slot_taken');
  end if;
  if v_slot.starts_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'slot_past');
  end if;
  if not (v_slot.institution_id in (select public.jr_student_institution_ids())) then
    raise exception 'not a member of this institution' using errcode = '42501';
  end if;

  -- resolve the appointment type: the slot's fixed type wins; else the caller's choice
  v_type_id := coalesce(v_slot.appointment_type_id, p_appointment_type_id);
  if v_type_id is not null and not exists (
    select 1 from public.appointment_types at
    where at.id = v_type_id and at.active
      and (at.institution_id is null or at.institution_id = v_slot.institution_id)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_type');
  end if;

  if p_application_id is not null and not exists (
    select 1 from public.applications a where a.id = p_application_id and a.user_id = uid
  ) then
    raise exception 'application not found' using errcode = '42501';
  end if;

  update public.appointment_slots set status = 'booked', updated_at = now() where id = p_slot_id;

  insert into public.appointments (
    slot_id, institution_id, student_id, appointment_type_id, application_id, student_comment, status
  ) values (
    p_slot_id, v_slot.institution_id, uid, v_type_id, p_application_id,
    nullif(btrim(coalesce(p_comment, '')), ''), 'booked'
  )
  returning id into v_appt_id;

  return jsonb_build_object('ok', true, 'appointment_id', v_appt_id, 'institution_id', v_slot.institution_id);
end;
$$;

-- Cancel. The student who booked it, or any staff of its institution.
create or replace function public.cancel_appointment(p_appointment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := (select auth.uid());
  v_ap public.appointments;
  v_starts timestamptz;
begin
  select * into v_ap from public.appointments where id = p_appointment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not (v_ap.student_id = uid or public.jr_inst_role(v_ap.institution_id) is not null) then
    raise exception 'not authorised for this appointment' using errcode = '42501';
  end if;
  if v_ap.status <> 'booked' then
    return jsonb_build_object('ok', true, 'already', v_ap.status);
  end if;

  update public.appointments
     set status = 'cancelled', cancelled_at = now(), cancelled_by = uid, updated_at = now()
   where id = p_appointment_id;

  select starts_at into v_starts from public.appointment_slots where id = v_ap.slot_id;
  update public.appointment_slots
     set status = case when v_starts > now() then 'open' else 'blocked' end, updated_at = now()
   where id = v_ap.slot_id;

  return jsonb_build_object('ok', true, 'status', 'cancelled');
end;
$$;

-- Staff-only: mark an appointment completed / no_show / cancelled.
create or replace function public.set_appointment_status(p_appointment_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ap public.appointments;
begin
  if p_status not in ('completed', 'no_show', 'cancelled', 'booked') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;
  select * into v_ap from public.appointments where id = p_appointment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if public.jr_inst_role(v_ap.institution_id) is null then
    raise exception 'not authorised for this institution' using errcode = '42501';
  end if;

  update public.appointments set
    status = p_status,
    completed_at = case when p_status = 'completed' then now() else completed_at end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
    cancelled_by = case when p_status = 'cancelled' then (select auth.uid()) else cancelled_by end,
    updated_at = now()
  where id = p_appointment_id;

  if p_status in ('cancelled') then
    update public.appointment_slots
       set status = case when starts_at > now() then 'open' else 'blocked' end, updated_at = now()
     where id = v_ap.slot_id;
  end if;

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- =============================================================================
-- THE KEY RPC — a focused student intelligence briefing for one appointment
-- -----------------------------------------------------------------------------
-- DOUBLE-GATED: the caller must be staff of the appointment's institution AND
-- the appointment's student must be a current linked cohort member of that
-- institution. Returns ONLY: the student's name + cohort(s) in this institution,
-- the appointment details + the student's own comment, a concise application
-- overview (if one is linked), and interview-DNA aggregates over the student's
-- completed interviews (the six controlled evaluation dimensions, patterns,
-- trend). No raw answer, no transcript, nothing from other institutions.
-- Individual data, authorised context => no k-anonymity suppression, but the
-- surface is deliberately minimal.
-- =============================================================================
create or replace function public.eki_student_briefing(p_appointment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c_target      constant int := 70;
  c_recent_n    constant int := 3;   -- "recent interviews" window for pattern statements
  v_ap          public.appointments;
  v_student     uuid;
  v_inst        uuid;
  v_result      jsonb;
begin
  select * into v_ap from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'appointment not found' using errcode = '42501';
  end if;
  v_student := v_ap.student_id;
  v_inst := v_ap.institution_id;

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
  ans as (
    select 'relevance' dim, e.relevance v, q.interview_id from public.evaluations e
      join public.answers a on a.id = e.answer_id
      join public.interview_questions q on q.id = a.question_id
      join public.interviews i on i.id = q.interview_id
     where i.user_id = v_student and i.status = 'completed' and e.relevance is not null
    union all select 'specificity', e.specificity, q.interview_id from public.evaluations e
      join public.answers a on a.id = e.answer_id join public.interview_questions q on q.id = a.question_id
      join public.interviews i on i.id = q.interview_id where i.user_id = v_student and i.status='completed' and e.specificity is not null
    union all select 'structure', e.structure, q.interview_id from public.evaluations e
      join public.answers a on a.id = e.answer_id join public.interview_questions q on q.id = a.question_id
      join public.interviews i on i.id = q.interview_id where i.user_id = v_student and i.status='completed' and e.structure is not null
    union all select 'evidence', e.evidence, q.interview_id from public.evaluations e
      join public.answers a on a.id = e.answer_id join public.interview_questions q on q.id = a.question_id
      join public.interviews i on i.id = q.interview_id where i.user_id = v_student and i.status='completed' and e.evidence is not null
    union all select 'communication', e.clarity, q.interview_id from public.evaluations e
      join public.answers a on a.id = e.answer_id join public.interview_questions q on q.id = a.question_id
      join public.interviews i on i.id = q.interview_id where i.user_id = v_student and i.status='completed' and e.clarity is not null
    union all select 'competency_demonstration', e.competency_demonstration, q.interview_id from public.evaluations e
      join public.answers a on a.id = e.answer_id join public.interview_questions q on q.id = a.question_id
      join public.interviews i on i.id = q.interview_id where i.user_id = v_student and i.status='completed' and e.competency_demonstration is not null
  ),
  dim_overall as (
    select dim, round(avg(v))::int mean, count(*) n_answers, count(distinct interview_id) n_interviews
      from ans group by dim
  ),
  recent_ivs as (
    select id from ivs order by rn desc limit c_recent_n
  ),
  dim_recent as (
    select dim, round(avg(v))::int mean, count(distinct interview_id) n_interviews
      from ans where interview_id in (select id from recent_ivs) group by dim
  ),
  cat as (
    select public.jr_canonical_category(q.category) k,
           round(avg((coalesce(e.relevance,0)+coalesce(e.specificity,0)+coalesce(e.structure,0)
                     +coalesce(e.evidence,0)+coalesce(e.clarity,0)+coalesce(e.competency_demonstration,0))::numeric
             / nullif((case when e.relevance is not null then 1 else 0 end)
                     +(case when e.specificity is not null then 1 else 0 end)
                     +(case when e.structure is not null then 1 else 0 end)
                     +(case when e.evidence is not null then 1 else 0 end)
                     +(case when e.clarity is not null then 1 else 0 end)
                     +(case when e.competency_demonstration is not null then 1 else 0 end), 0)))::int mean,
           count(*) n_answers
      from public.evaluations e
      join public.answers a on a.id = e.answer_id
      join public.interview_questions q on q.id = a.question_id
      join public.interviews i on i.id = q.interview_id
     where i.user_id = v_student and i.status = 'completed'
     group by 1
  )
  select jsonb_build_object(
    'generated_at', now(),
    'target', c_target,
    'recent_window', c_recent_n,
    'student', jsonb_build_object(
      'name', (select nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), '') from public.profiles where id = v_student),
      'institution_name', (select name from public.institutions where id = v_inst),
      'cohorts', (select coalesce(jsonb_agg(distinct c.name), '[]'::jsonb)
                    from public.cohort_members cm join public.cohorts c on c.id = cm.cohort_id
                   where c.institution_id = v_inst and cm.student_id = v_student and cm.status <> 'removed')
    ),
    'appointment', jsonb_build_object(
      'id', v_ap.id, 'status', v_ap.status,
      'type_label', (select coalesce(label, 'Careers appointment') from public.appointment_types where id = v_ap.appointment_type_id),
      'starts_at', (select starts_at from public.appointment_slots where id = v_ap.slot_id),
      'ends_at', (select ends_at from public.appointment_slots where id = v_ap.slot_id),
      'student_comment', v_ap.student_comment
    ),
    'application', (
      select case when v_ap.application_id is null then null else jsonb_build_object(
        'company', app.company, 'role', app.role,
        'stage', app.interview_stage, 'interview_date', app.interview_date,
        'created_at', app.created_at,
        'practice_interviews', (select count(*) from public.interviews i2
                                 where i2.application_id = app.id and i2.status = 'completed')
      ) end
      from public.applications app where app.id = v_ap.application_id
    ),
    'interview_dna', jsonb_build_object(
      'n_completed_interviews', (select coalesce(max(cnt), 0) from ivs),
      'has_enough_data', (select coalesce(max(cnt), 0) from ivs) >= 1,
      'overall_mean', (select round(avg(score)) from ivs),
      'dimensions', (select coalesce(jsonb_agg(jsonb_build_object(
          'key', dim, 'mean', mean, 'n_answers', n_answers,
          'band', case when mean >= 75 then 'strong' when mean >= c_target then 'solid'
                       when mean >= c_target - 15 then 'developing' else 'priority' end,
          'below_target', (mean < c_target)
        ) order by mean desc), '[]'::jsonb) from dim_overall),
      'strengths', (select coalesce(jsonb_agg(jsonb_build_object('key', dim, 'mean', mean) order by mean desc), '[]'::jsonb)
                      from (select dim, mean from dim_overall where mean >= c_target order by mean desc limit 3) s),
      'development_areas', (select coalesce(jsonb_agg(jsonb_build_object('key', dim, 'mean', mean) order by mean asc), '[]'::jsonb)
                      from (select dim, mean from dim_overall where mean < c_target order by mean asc limit 3) w)
    ),
    'patterns', jsonb_build_object(
      -- a repeated development area: below target BOTH overall AND across the recent window,
      -- and the recent window actually spans >= 2 interviews.
      'repeated_development_area', (
        select case when d.dim is null then null else jsonb_build_object(
          'key', d.dim, 'overall_mean', o.mean, 'recent_mean', d.mean, 'recent_interviews', d.n_interviews
        ) end
        from dim_recent d
        join dim_overall o on o.dim = d.dim
        where d.mean < c_target and o.mean < c_target and d.n_interviews >= 2
        order by d.mean asc limit 1
      ),
      'performance_trend', (
        select case when (select coalesce(max(cnt),0) from ivs) < 2 then null else jsonb_build_object(
          'first', (select score from ivs where rn = 1),
          'latest', (select score from ivs where rn = (select max(rn) from ivs)),
          'delta', (select score from ivs where rn = (select max(rn) from ivs)) - (select score from ivs where rn = 1),
          'n_interviews', (select max(cnt) from ivs)
        ) end
      ),
      'hardest_question_category', (
        select jsonb_build_object('key', k, 'mean', mean, 'n_answers', n_answers)
        from cat where n_answers >= 2 order by mean asc limit 1
      )
    )
  ) into v_result;

  return v_result;
end;
$$;

-- =============================================================================
-- GRANTS — authenticated end users; each write / briefing RPC self-enforces.
-- =============================================================================
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.jr_student_institution_ids()',
    'public.list_appointment_types(uuid)',
    'public.list_careers_availability(uuid)',
    'public.list_my_appointments()',
    'public.list_institution_appointments(uuid,timestamptz,timestamptz,text[])',
    'public.book_appointment(uuid,uuid,uuid,text)',
    'public.cancel_appointment(uuid)',
    'public.set_appointment_status(uuid,text)',
    'public.eki_student_briefing(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
