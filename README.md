# JOB.READY

AI-powered interview and graduate recruitment preparation.

## Project status

**Current phase:** Phase 1 complete; Phase 2B productionisation in progress.

## Deployment

Deployed to Vercel (Preview) from the `development` branch. Production URL: TBD pending full live-validation pass.


JOB.READY currently includes interview preparation, AI-generated interview questions, answer evaluation, reports, Classroom, Candidate DNA, Interview Memory, Progress, Assessment Centre preparation, and document input for TXT/DOCX/PDF.

## Development workflow

- `main` — stable/release branch
- `development` — active integration branch
- `feature/*` — isolated feature work

Do not commit secrets. Never commit `.env`, API keys, Supabase service-role keys, or Anthropic credentials.

## Architecture target

```text
JOB.READY frontend
        |
        +--> Supabase Auth
        |
        +--> Supabase Database / Storage
        |
        +--> authenticated Supabase Edge Function
                    |
                    +--> Anthropic API
```

## Important rules

1. Preserve existing product functionality unless a change is explicitly requested.
2. Use Supabase Auth as the canonical user identity.
3. Enforce user data isolation with database-level RLS.
4. Keep Anthropic credentials server-side.
5. Use migrations for database changes; do not rebuild or casually drop existing tables.
6. Do not claim tests passed unless they were actually run.
7. Keep `main` stable and use `development`/feature branches for active work.

## Documentation

- `docs/PROJECT_STATE.md` — current product and engineering state
- `docs/ARCHITECTURE.md` — system architecture and boundaries
- `docs/DEVELOPMENT_WORKFLOW.md` — Git/GitHub workflow for Claude and ChatGPT collaboration
