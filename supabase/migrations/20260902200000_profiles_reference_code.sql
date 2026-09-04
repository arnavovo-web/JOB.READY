-- =============================================================================
-- REFERENCE CODE — infrastructure only, no affiliate logic
-- -----------------------------------------------------------------------------
-- Purely additive: one nullable text column on the existing `profiles` row,
-- same pattern as the `applications.checklist` migration before it. Captures
-- the optional "Reference code" a new candidate can enter on sign-up (see
-- src/App.jsx handleSignUp) so it's available for a later phase to build
-- partner-crediting on top of — no checking, crediting, or reward logic is
-- implemented by this migration or by the code that writes to this column.
-- It is set once, at signup, and never overwritten afterward.
--
-- Backward compatible by construction: every existing profile row already has
-- this column as null (Postgres ADD COLUMN default), which every reader
-- treats as "no reference code provided" — never an error, never a
-- missing-data problem. RLS is inherited automatically from the existing
-- profiles row-level policy — no new policy needed.
-- =============================================================================

alter table public.profiles add column if not exists reference_code text;
