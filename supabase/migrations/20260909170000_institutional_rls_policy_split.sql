-- =============================================================================
-- INSTITUTIONAL INSIGHTS — MILESTONE 4: RLS policy split (perf)
-- -----------------------------------------------------------------------------
-- The foundation migration gave institution_organisations / cohorts /
-- cohort_members / institution_staff a `<t>_manage` policy that is `FOR ALL`,
-- alongside a dedicated `<t>_staff_read` (and, for cohort_members, a
-- `<t>_student_read_self`) SELECT policy. Because `FOR ALL` also covers SELECT,
-- Postgres evaluates BOTH the read policy AND the manage policy's USING clause
-- on every row of every staff SELECT — each an extra jr_inst_role() call.
-- (Supabase advisor: multiple_permissive_policies.)
--
-- This migration replaces each `FOR ALL` manage policy with three
-- command-scoped write policies (INSERT / UPDATE / DELETE). SELECT is then
-- served by exactly one policy again. Behaviour is identical — owner/admin
-- may still do every write, everyone else may only read what they could before.
--
-- Idempotent: drop policy if exists + recreate. No table/column/data change.
-- Timestamped after 20260909160000_institutional_analytics_indexes.sql.
-- Also adds the FK-covering index the advisor flags on cohort_members.added_by.
-- =============================================================================

create index if not exists cohort_members_added_by_idx on public.cohort_members (added_by);

-- ---- institution_organisations -----------------------------------------
drop policy if exists inst_orgs_manage on public.institution_organisations;
drop policy if exists inst_orgs_insert on public.institution_organisations;
drop policy if exists inst_orgs_update on public.institution_organisations;
drop policy if exists inst_orgs_delete on public.institution_organisations;
create policy inst_orgs_insert on public.institution_organisations
  for insert with check (public.jr_inst_can_manage(institution_id));
create policy inst_orgs_update on public.institution_organisations
  for update using (public.jr_inst_can_manage(institution_id)) with check (public.jr_inst_can_manage(institution_id));
create policy inst_orgs_delete on public.institution_organisations
  for delete using (public.jr_inst_can_manage(institution_id));

-- ---- cohorts ---------------------------------------------------------
drop policy if exists cohorts_manage on public.cohorts;
drop policy if exists cohorts_insert on public.cohorts;
drop policy if exists cohorts_update on public.cohorts;
drop policy if exists cohorts_delete on public.cohorts;
create policy cohorts_insert on public.cohorts
  for insert with check (public.jr_inst_can_manage(institution_id));
create policy cohorts_update on public.cohorts
  for update using (public.jr_inst_can_manage(institution_id)) with check (public.jr_inst_can_manage(institution_id));
create policy cohorts_delete on public.cohorts
  for delete using (public.jr_inst_can_manage(institution_id));

-- ---- cohort_members -----------------------------------------------
-- Also merge the two SELECT policies (staff-read + student-read-own) into one
-- OR'd policy so a staff SELECT evaluates a single predicate.
drop policy if exists cohort_members_staff_read on public.cohort_members;
drop policy if exists cohort_members_student_read_self on public.cohort_members;
drop policy if exists cohort_members_read on public.cohort_members;
create policy cohort_members_read on public.cohort_members
  for select using (
    student_id = (select auth.uid())
    or public.jr_inst_role(
      (select c.institution_id from public.cohorts c where c.id = cohort_members.cohort_id)
    ) is not null
  );

drop policy if exists cohort_members_manage on public.cohort_members;
drop policy if exists cohort_members_insert on public.cohort_members;
drop policy if exists cohort_members_update on public.cohort_members;
drop policy if exists cohort_members_delete on public.cohort_members;
create policy cohort_members_insert on public.cohort_members
  for insert with check (public.jr_inst_can_manage(
    (select c.institution_id from public.cohorts c where c.id = cohort_members.cohort_id)));
create policy cohort_members_update on public.cohort_members
  for update using (public.jr_inst_can_manage(
    (select c.institution_id from public.cohorts c where c.id = cohort_members.cohort_id)))
  with check (public.jr_inst_can_manage(
    (select c.institution_id from public.cohorts c where c.id = cohort_members.cohort_id)));
create policy cohort_members_delete on public.cohort_members
  for delete using (public.jr_inst_can_manage(
    (select c.institution_id from public.cohorts c where c.id = cohort_members.cohort_id)));

-- ---- institution_staff -------------------------------------------
drop policy if exists institution_staff_manage on public.institution_staff;
drop policy if exists institution_staff_insert on public.institution_staff;
drop policy if exists institution_staff_update on public.institution_staff;
drop policy if exists institution_staff_delete on public.institution_staff;
create policy institution_staff_insert on public.institution_staff
  for insert with check (public.jr_inst_can_manage(institution_id));
create policy institution_staff_update on public.institution_staff
  for update using (public.jr_inst_can_manage(institution_id)) with check (public.jr_inst_can_manage(institution_id));
create policy institution_staff_delete on public.institution_staff
  for delete using (public.jr_inst_can_manage(institution_id));
