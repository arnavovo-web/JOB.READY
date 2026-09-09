-- =============================================================================
-- EKI² — Careers Appointments: RLS policy consolidation (perf)
-- -----------------------------------------------------------------------------
-- Same treatment as 20260909170000_institutional_rls_policy_split: collapse the
-- per-table pair of SELECT policies into one OR'd policy, and replace the
-- `appointment_types` FOR ALL write policy with command-scoped policies, so a
-- SELECT evaluates exactly one policy (clears the Supabase
-- multiple_permissive_policies advisor). Behaviour is unchanged — the OR of the
-- two predicates is identical to two permissive policies.
--
-- Idempotent (drop policy if exists + recreate). No table/column/data change.
-- =============================================================================

-- ---- appointment_slots: staff-read OR student-read -> one policy; and the
--      FOR ALL manage policy -> command-scoped so a SELECT hits one policy -----
drop policy if exists appointment_slots_staff_read on public.appointment_slots;
drop policy if exists appointment_slots_student_read on public.appointment_slots;
drop policy if exists appointment_slots_read on public.appointment_slots;
create policy appointment_slots_read on public.appointment_slots
  for select using (
    public.jr_inst_role(institution_id) is not null
    or (status = 'open' and starts_at > now()
        and institution_id in (select public.jr_student_institution_ids()))
    or id in (select a.slot_id from public.appointments a where a.student_id = (select auth.uid()))
  );

drop policy if exists appointment_slots_manage on public.appointment_slots;
drop policy if exists appointment_slots_insert on public.appointment_slots;
drop policy if exists appointment_slots_update on public.appointment_slots;
drop policy if exists appointment_slots_delete on public.appointment_slots;
create policy appointment_slots_insert on public.appointment_slots
  for insert with check (
    public.jr_inst_role(institution_id) is not null
    and (staff_id = (select auth.uid()) or public.jr_inst_can_manage(institution_id))
  );
create policy appointment_slots_update on public.appointment_slots
  for update using (
    public.jr_inst_role(institution_id) is not null
    and (staff_id = (select auth.uid()) or public.jr_inst_can_manage(institution_id))
  ) with check (
    public.jr_inst_role(institution_id) is not null
    and (staff_id = (select auth.uid()) or public.jr_inst_can_manage(institution_id))
  );
create policy appointment_slots_delete on public.appointment_slots
  for delete using (
    public.jr_inst_role(institution_id) is not null
    and (staff_id = (select auth.uid()) or public.jr_inst_can_manage(institution_id))
  );

-- ---- appointments: student-read OR staff-read -> one policy --------------
drop policy if exists appointments_student_read on public.appointments;
drop policy if exists appointments_staff_read on public.appointments;
drop policy if exists appointments_read on public.appointments;
create policy appointments_read on public.appointments
  for select using (
    student_id = (select auth.uid())
    or public.jr_inst_role(institution_id) is not null
  );

-- ---- appointment_types: FOR ALL -> command-scoped writes ---------------
drop policy if exists appointment_types_write on public.appointment_types;
drop policy if exists appointment_types_insert on public.appointment_types;
drop policy if exists appointment_types_update on public.appointment_types;
drop policy if exists appointment_types_delete on public.appointment_types;
create policy appointment_types_insert on public.appointment_types
  for insert with check (institution_id is not null and public.jr_inst_can_manage(institution_id));
create policy appointment_types_update on public.appointment_types
  for update using (institution_id is not null and public.jr_inst_can_manage(institution_id))
  with check (institution_id is not null and public.jr_inst_can_manage(institution_id));
create policy appointment_types_delete on public.appointment_types
  for delete using (institution_id is not null and public.jr_inst_can_manage(institution_id));
