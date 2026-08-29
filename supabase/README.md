# Supabase — database schema tracking

Until 2026‑08, JOB.READY's Supabase schema lived only in the live project — columns
were added ad hoc with `ALTER TABLE`, and `docs/*` said "use migrations" without a
mechanism existing. This directory is that mechanism.

## Layout

```
supabase/
  config.toml                       CLI project attachment (remote-only; no local stack)
  migrations/
    20260828120000_baseline_schema.sql   full current-schema snapshot (idempotent)
```

## The baseline migration

`20260828120000_baseline_schema.sql` is a complete, **idempotent** snapshot of every
database object the application code depends on: all 19 tables, their columns,
constraints, indexes, RLS + policies, `handle_new_user()` and its `auth.users`
trigger, and the `documents` storage bucket + policies.

* **Against the existing live project** it is a verified no-op — every statement is
  `... if not exists`, `create or replace`, or `drop policy if exists` + recreate.
  Nothing is dropped, no row is touched.
* **Against a fresh project** it reproduces a schema compatible with the current code.

It is *not* a historical change log. It establishes repository-tracked state for a
project that previously had none. New schema changes from here on get their own
timestamped migration file in `migrations/`.

## Adding a migration

```bash
supabase migration new short_description
# edit supabase/migrations/<timestamp>_short_description.sql
supabase db push          # applies pending migrations to the linked project
```

Keep each migration idempotent where practical (`add column if not exists`, etc.)
so re-running against a partially-migrated environment is safe.

## Known artifacts NOT in these migrations

| Artifact | Why it's out | Where it lives |
|---|---|---|
| `ai-generate` Edge Function | separate deploy unit; owns server-side AI calls + `ai_usage` / `api_usage_limits` writes + JWT verification | source now captured at `supabase/functions/ai-generate/` (verbatim mirror of live v5); deploy with `supabase functions deploy ai-generate` — see `supabase/functions/README.md` |
| `rls_auto_enable` event trigger | superuser-owned Supabase hardening; can't be created from a normal migration. The baseline enables RLS explicitly on every table, so a fresh project is still fully protected. | live project only |
| `job-ready-documents` storage bucket | legacy; no current code path reads or writes it. `documents` is the bucket in use. | live project only |

The `ai-generate` function source is now under `supabase/functions/ai-generate/`
(captured 2026-08-30 from live v5, verbatim). `supabase/functions/README.md` is
its deploy + secrets + recovery runbook.
