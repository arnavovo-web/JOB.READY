-- =============================================================================
-- INSTITUTIONAL INSIGHTS — MILESTONE 1: FOUNDATION
-- -----------------------------------------------------------------------------
-- Adds the institutional (B2B) data model that lets universities and student
-- organisations see AGGREGATED employability intelligence derived from the
-- EXISTING JOB.READY student data. It creates NO parallel student / application
-- / interview store — the existing `profiles` / `applications` / `interviews` /
-- `interview_reports` / `evaluations` / `competency_history` tables remain the
-- sole source of truth. This migration only adds the org structure that maps a
-- set of existing student accounts to an institution + cohort, plus the staff
-- access model.
--
--   Institution  ──<  Organisation / Society  ──<  Cohort  ──<  Cohort member ──→ profiles(id)
--        └──<  Institution staff  ──→ profiles(id)   (role: owner | admin | analyst | viewer)
--
-- SECURITY MODEL
--   * All five tables have RLS enabled.
--   * `jr_inst_role(institution_id)` — SECURITY DEFINER, pinned search_path.
--     Returns the caller's role at that institution, or NULL. Reading
--     institution_staff from inside a SECURITY DEFINER function bypasses RLS, so
--     the institution_staff SELECT policy can call it without infinite policy
--     recursion.
--   * Config rows (institutions / organisations / cohorts / cohort_members) are
--     readable by ANY staff member of the owning institution and writable only
--     by role owner|admin. A student may read their OWN cohort_members rows
--     (so the student platform could later show "you're part of {cohort}") but
--     never anyone else's, and never any other institutional table.
--   * NOTHING here grants institution staff access to raw student
--     interview/answer/evaluation rows. All institutional analytics are served
--     by separate SECURITY DEFINER `inst_*` RPCs (Milestone 2) that return only
--     k-anonymised aggregates. This migration adds one such RPC,
--     `inst_reconcile_cohort_members`, plus the read helper `get_my_institutions`.
--
-- IDEMPOTENT: every statement is `create table if not exists`, `create index if
-- not exists`, `create or replace function`, or `drop policy if exists` +
-- recreate. Purely additive — no existing object is altered or dropped, the
-- student-critical `handle_new_user()` trigger is NOT touched.
--
-- Timestamped after 20260903150000_pricing_model_v2.sql so the repo apply order
-- stays monotonic.
-- =============================================================================

-- gen_random_uuid() is core Postgres (>= 13); this project is PG17. No extension.

-- =============================================================================
-- TABLES
-- =============================================================================

-- One row per client institution (a university, or a standalone student org).
create table if not exists public.institutions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 200),
  slug        text unique check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  type        text not null default 'university'
                check (type in ('university', 'student_org')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- A sub-unit inside an institution: a society, a department, a careers service,
-- a specific programme. Optional tier — a small client can put every cohort
-- directly under the institution (organisation_id null on the cohort).
create table if not exists public.institution_organisations (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 200),
  kind           text not null default 'other'
                   check (kind in ('society', 'department', 'careers_service', 'programme', 'other')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists institution_organisations_institution_id_idx
  on public.institution_organisations (institution_id);

-- A cohort: the unit institutional analytics aggregates over. e.g.
-- "BSc Economics 2026", "Investment Banking Society — 2025/26".
create table if not exists public.cohorts (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  organisation_id uuid references public.institution_organisations(id) on delete set null,
  name            text not null check (char_length(name) between 1 and 200),
  academic_year   text check (academic_year is null or academic_year ~ '^[0-9]{4}(/[0-9]{2,4})?$'),
  graduation_year integer check (graduation_year is null or graduation_year between 2000 and 2100),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists cohorts_institution_id_idx  on public.cohorts (institution_id);
create index if not exists cohorts_organisation_id_idx  on public.cohorts (organisation_id);

-- Membership: maps an existing JOB.READY student account to a cohort. A member
-- can be added by email BEFORE that person has a JOB.READY account
-- (student_id null, invited_email set); inst_reconcile_cohort_members() links
-- student_id once a matching profile exists. The same student may belong to
-- several cohorts / organisations / institutions — every (cohort, student) pair
-- is its own row, unique together.
create table if not exists public.cohort_members (
  id            uuid primary key default gen_random_uuid(),
  cohort_id     uuid not null references public.cohorts(id) on delete cascade,
  student_id    uuid references public.profiles(id) on delete set null,
  invited_email text check (invited_email is null or char_length(invited_email) between 3 and 320),
  status        text not null default 'active'
                  check (status in ('active', 'invited', 'removed')),
  joined_at     timestamptz not null default now(),
  added_by      uuid references public.profiles(id) on delete set null,
  -- at least one way to identify the member
  constraint cohort_members_identified_chk
    check (student_id is not null or invited_email is not null)
);
-- One membership row per (cohort, student) and per (cohort, invited_email).
create unique index if not exists cohort_members_cohort_student_uidx
  on public.cohort_members (cohort_id, student_id) where student_id is not null;
create unique index if not exists cohort_members_cohort_email_uidx
  on public.cohort_members (cohort_id, lower(invited_email)) where invited_email is not null;
create index if not exists cohort_members_cohort_id_idx  on public.cohort_members (cohort_id);
create index if not exists cohort_members_student_id_idx  on public.cohort_members (student_id);

-- Staff: which JOB.READY accounts may access an institution's dashboard, and
-- with what privileges. owner/admin can manage config + staff; analyst/viewer
-- are read-only (identical for now — analyst is reserved for future
-- export/raw-drilldown rights).
create table if not exists public.institution_staff (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  role           text not null default 'viewer'
                   check (role in ('owner', 'admin', 'analyst', 'viewer')),
  created_at     timestamptz not null default now(),
  constraint institution_staff_institution_user_unique unique (institution_id, user_id)
);
create index if not exists institution_staff_institution_id_idx on public.institution_staff (institution_id);
create index if not exists institution_staff_user_id_idx        on public.institution_staff (user_id);

-- =============================================================================
-- ROLE HELPER — SECURITY DEFINER so RLS policies can call it without recursion
-- =============================================================================
create or replace function public.jr_inst_role(p_institution_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.role
    from public.institution_staff s
   where s.institution_id = p_institution_id
     and s.user_id = (select auth.uid())
   limit 1;
$$;

-- Convenience: does the caller have owner/admin rights at an institution?
-- coalesce(...) so a non-staff caller gets a hard `false`, never NULL — a NULL
-- would make `if not jr_inst_can_manage(...) then raise` fall through in the
-- RPCs below (NULL is not truthy). RLS already treats a NULL USING as deny, but
-- the RPC guards need a real boolean.
create or replace function public.jr_inst_can_manage(p_institution_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(public.jr_inst_role(p_institution_id) in ('owner', 'admin'), false);
$$;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
alter table public.institutions               enable row level security;
alter table public.institution_organisations  enable row level security;
alter table public.cohorts                    enable row level security;
alter table public.cohort_members             enable row level security;
alter table public.institution_staff          enable row level security;

-- ---- institutions ----------------------------------------------------------
drop policy if exists institutions_staff_read on public.institutions;
create policy institutions_staff_read on public.institutions
  for select using (public.jr_inst_role(id) is not null);

drop policy if exists institutions_manage on public.institutions;
create policy institutions_manage on public.institutions
  for update using (public.jr_inst_can_manage(id)) with check (public.jr_inst_can_manage(id));
-- No INSERT/DELETE policy: a new institution + its first owner are provisioned
-- out of band (service role / a future onboarding RPC), never by the browser.

-- ---- institution_organisations -------------------------------------------
drop policy if exists inst_orgs_staff_read on public.institution_organisations;
create policy inst_orgs_staff_read on public.institution_organisations
  for select using (public.jr_inst_role(institution_id) is not null);

drop policy if exists inst_orgs_manage on public.institution_organisations;
create policy inst_orgs_manage on public.institution_organisations
  for all using (public.jr_inst_can_manage(institution_id))
  with check (public.jr_inst_can_manage(institution_id));

-- ---- cohorts -------------------------------------------------------------
drop policy if exists cohorts_staff_read on public.cohorts;
create policy cohorts_staff_read on public.cohorts
  for select using (public.jr_inst_role(institution_id) is not null);

drop policy if exists cohorts_manage on public.cohorts;
create policy cohorts_manage on public.cohorts
  for all using (public.jr_inst_can_manage(institution_id))
  with check (public.jr_inst_can_manage(institution_id));

-- ---- cohort_members ----------------------------------------------------
-- Staff of the owning institution may read every membership row; a student may
-- read only their own membership rows.
drop policy if exists cohort_members_staff_read on public.cohort_members;
create policy cohort_members_staff_read on public.cohort_members
  for select using (
    public.jr_inst_role(
      (select c.institution_id from public.cohorts c where c.id = cohort_members.cohort_id)
    ) is not null
  );

drop policy if exists cohort_members_student_read_self on public.cohort_members;
create policy cohort_members_student_read_self on public.cohort_members
  for select using (student_id = (select auth.uid()));

drop policy if exists cohort_members_manage on public.cohort_members;
create policy cohort_members_manage on public.cohort_members
  for all using (
    public.jr_inst_can_manage(
      (select c.institution_id from public.cohorts c where c.id = cohort_members.cohort_id)
    )
  ) with check (
    public.jr_inst_can_manage(
      (select c.institution_id from public.cohorts c where c.id = cohort_members.cohort_id)
    )
  );

-- ---- institution_staff -----------------------------------------------
-- Any staff member may see the roster of institutions they belong to (via the
-- SECURITY DEFINER helper — no policy recursion). owner/admin may manage it.
drop policy if exists institution_staff_read on public.institution_staff;
create policy institution_staff_read on public.institution_staff
  for select using (public.jr_inst_role(institution_id) is not null);

drop policy if exists institution_staff_manage on public.institution_staff;
create policy institution_staff_manage on public.institution_staff
  for all using (public.jr_inst_can_manage(institution_id))
  with check (public.jr_inst_can_manage(institution_id));

-- =============================================================================
-- READ RPC — the institutions + role the caller can see
-- =============================================================================
create or replace function public.get_my_institutions()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(row order by row->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
             'institution_id', i.id,
             'name', i.name,
             'slug', i.slug,
             'type', i.type,
             'role', s.role
           ) as row
      from public.institution_staff s
      join public.institutions i on i.id = s.institution_id
     where s.user_id = (select auth.uid())
  ) t;
$$;

-- =============================================================================
-- RECONCILE RPC — link invited_email memberships to real accounts
-- -----------------------------------------------------------------------------
-- Staff (owner/admin) call this for their institution. For every cohort_members
-- row in that institution that still has a null student_id but an invited_email,
-- if a public.profiles row now exists with that email (case-insensitive) and it
-- is not already a member of the same cohort, set student_id and flip status
-- 'invited' -> 'active'. Returns the number of rows linked. Never deletes,
-- never touches another institution, never exposes a profile id to the caller
-- except by writing it onto a membership row they already manage.
-- =============================================================================
create or replace function public.inst_reconcile_cohort_members(p_institution_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_linked integer := 0;
begin
  if not public.jr_inst_can_manage(p_institution_id) then
    raise exception 'not authorised for this institution' using errcode = '42501';
  end if;

  with candidates as (
    select cm.id as member_id, p.id as profile_id, cm.cohort_id
      from public.cohort_members cm
      join public.cohorts c on c.id = cm.cohort_id and c.institution_id = p_institution_id
      join public.profiles p on lower(p.email) = lower(cm.invited_email)
     where cm.student_id is null
       and cm.invited_email is not null
       and cm.status <> 'removed'
       -- don't create a duplicate (cohort, student) membership
       and not exists (
         select 1 from public.cohort_members x
          where x.cohort_id = cm.cohort_id and x.student_id = p.id
       )
  ), linked as (
    update public.cohort_members cm
       set student_id = cand.profile_id,
           status = case when cm.status = 'invited' then 'active' else cm.status end,
           joined_at = case when cm.status = 'invited' then now() else cm.joined_at end
      from candidates cand
     where cm.id = cand.member_id
     returning 1
  )
  select count(*) into v_linked from linked;

  return jsonb_build_object('ok', true, 'linked', v_linked);
end;
$$;

-- =============================================================================
-- GRANTS — authenticated end users only (a staff member is a normal signed-in
-- user; the RPCs themselves enforce the institution-staff check).
-- =============================================================================
revoke all on function public.jr_inst_role(uuid)                       from public, anon;
revoke all on function public.jr_inst_can_manage(uuid)                 from public, anon;
revoke all on function public.get_my_institutions()                    from public, anon;
revoke all on function public.inst_reconcile_cohort_members(uuid)      from public, anon;

grant execute on function public.jr_inst_role(uuid)                    to authenticated;
grant execute on function public.jr_inst_can_manage(uuid)              to authenticated;
grant execute on function public.get_my_institutions()                 to authenticated;
grant execute on function public.inst_reconcile_cohort_members(uuid)   to authenticated;
