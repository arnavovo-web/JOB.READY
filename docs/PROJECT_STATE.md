# JOB.READY — Project State

**Last updated:** 2026-08-20

## Current phase

**Phase 1 — Stabilisation:** completed in the Claude development pass, subject to the remaining browser/live-service limitations documented below.

**Phase 2B — Productionisation:** next major engineering phase. Supabase is connected to the project and the existing application is being migrated from demo/local persistence to real authentication, database persistence, private document storage, and secure server-side AI access.

## Product currently present

- Landing page
- Authentication/demo login flow (being replaced by Supabase Auth)
- Dashboard
- Interview setup and generation
- CV/JD document input
- TXT/DOCX/PDF processing
- Interview simulation
- AI answer evaluation
- Interview reports
- Classroom lessons and quizzes
- Candidate DNA
- Interview Memory
- Progress
- Assessment Centre section
- Responsive/mobile UI
- AI-output validation
- Duplicate-submit protection
- Persistent Classroom quiz state in the current implementation

## Phase 1 stabilisation work reported by Claude

- Removed dead import.
- Added AI-output validation/coercion.
- Added duplicate-submission protection.
- Added Classroom quiz persistence.
- Added PDF extraction wiring through pdf.js.
- Added mobile navigation/hamburger behaviour.
- Converted grids/button rows to mobile-friendly layouts.
- Improved Interview Memory matching.
- Fixed raw upstream error leakage.
- Restored landing-page sections lost during an earlier rewrite.
- Test harnesses reported passing core and edge-case logic tests.

### Phase 1 limitations

Claude reported that it could not perform full real-browser rendering, live Anthropic API testing, or real PDF/DOCX browser tests in its environment. A subsequent manual test found that file uploads were not working in the live application, so file upload remains a confirmed item to verify/fix before productionisation is considered complete.

## Current architecture direction

```text
JOB.READY frontend
        |
        +--> Supabase Auth
        |
        +--> Supabase Database
        |
        +--> private Supabase Storage
        |
        +--> authenticated Supabase Edge Function
                    |
                    +--> Anthropic API
```

## Source of truth rules

- Supabase Auth is the canonical user identity.
- Persistent business data belongs in Supabase, not localStorage.
- RLS must enforce per-user data isolation.
- CVs/JDs/documents must remain private.
- Anthropic credentials must remain server-side.
- Database changes use migrations.

## Current development priorities

1. Verify the current repository contains the latest stable JOB.READY code.
2. Complete/fix real TXT/DOCX/PDF upload behaviour in the live browser environment.
3. Execute Phase 2B Supabase frontend/backend integration.
4. Establish real sign-up/sign-in/session/logout/password reset.
5. Migrate persistent application/interview/report/Classroom/DNA/Memory data to Supabase.
6. Move Anthropic calls behind an authenticated Supabase Edge Function.
7. Verify RLS and cross-account isolation.
8. Regression test the entire product.

## Deferred

Assessment Centre expansion, including multiplayer/group mock assessments, is deliberately on hold until the rest of the product is solid.

Voice/audio answering is also deferred for now.
