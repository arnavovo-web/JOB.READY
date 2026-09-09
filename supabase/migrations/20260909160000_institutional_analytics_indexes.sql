-- =============================================================================
-- INSTITUTIONAL INSIGHTS — MILESTONE 4: analytics query indexes
-- -----------------------------------------------------------------------------
-- Every inst_* RPC starts from a set of student ids and scans `interviews`
-- (WHERE user_id = ANY(...) AND status = 'completed', often ordered by
-- completed_at) and `competency_history` (WHERE user_id = ANY(...) AND
-- source_type = 'interview' ORDER BY created_at). At small volume the planner
-- seq-scans `interviews`; these composite indexes keep it an index scan as the
-- student platform grows.
--
-- Purely additive — three CREATE INDEX IF NOT EXISTS on existing student tables,
-- no column/constraint/policy change, no data touched. `IF NOT EXISTS` makes it
-- a safe re-run. (Not CONCURRENTLY: these tables are tiny today and a migration
-- runs in its own transaction; switch to a CONCURRENTLY backfill only if this is
-- ever applied to a large live table under load.)
--
-- Timestamped after 20260909140000_institutional_analytics.sql.
-- =============================================================================

-- interviews: the hot path for every RPC (student-set + completed + time window)
create index if not exists interviews_user_status_completed_idx
  on public.interviews (user_id, status, completed_at);

-- competency_history: inst_improvement's per-student, per-dimension trend
create index if not exists competency_history_user_source_created_idx
  on public.competency_history (user_id, source_type, created_at);

-- interview_reports is already keyed by interview_id (unique); no index needed.
