# JOB.READY — Project State

**Last updated:** 2026-08 (Phase 15A)

For the system shape, ownership map and persisted-state table see
`docs/ARCHITECTURE.md`. This file is a short status snapshot.

## What the product does today

JOB.READY takes a user from an interview opportunity to measurable improvement:

1. **Build an interview** — manually (company/role, JD & context, CV, interview
   round, and a mandatory **Question Mix**: Technical / Behavioural / Motivational),
   or by pasting an **offer/invitation email** which is AI-extracted, reviewed and
   completed by the user, then converges into the same wizard.
2. **Analyse & plan** — one AI call extracts the interview profile, builds
   **Application Intelligence** ("what matters for this application", from
   user-provided info only — no web search), and computes the scheduler's
   methodology distribution, clamped to the chosen Question Mix.
3. **Practice** — an adaptive interview (deterministic scheduler owns category /
   turn type / anchor; AI only evaluates an answer and phrases the next question),
   or an independent/batch "HireVue-style" interview (isolated pipeline).
4. **Diagnosis** — one AI call produces the report: per-question feedback,
   weakest areas, and `classroom_topics` (diagnosed development needs). Candidate
   DNA and Candidate State are updated.
5. **Classroom** — per-application **recommendations** (Application Intelligence ×
   Candidate State), each clearly a *demonstrated weakness* or an *area to
   prepare*; plus interview-diagnosed topics.
6. **Development Module** — generated **once** per topic (one AI call), then
   reused with **zero** further AI calls to power:
   - 📚 **Learn** (structured learning guide),
   - 🗂️ **Flashcards** (from persisted items),
   - ✍️ **Written Quiz** (free-response, marked **deterministically** by concept
     coverage — no AI; feedback shows covered ✓ / still-to-include ○ / review /
     try again; never says "wrong"),
   - 🎤 **Redo the original interview question** (also deterministically marked),
   - **What Next** hub — the student is never forced back to the start.
7. **Improvement** — retaking updates scores / Candidate State and the Dashboard
   **"Continue preparing"** card (deterministic: in-progress module > demonstrated
   need not yet developed > high-priority preparation recommendation).

## Recently done

- **Phase 13A/B** — Application Intelligence + per-application Classroom
  recommendations, with the demonstrated-vs-prepare distinction.
- **Phase 14 / 14.1** — Development Modules (learning guide + flashcards + written
  quiz + deterministic marking); recommendations with no pre-existing topic can
  materialise one (no AI) and enter the same module.
- **Migration baseline** — `supabase/migrations/` established; the previously
  ad-hoc schema is now a tracked idempotent baseline plus incrementals.
- **Phase 15 audit** — full end-to-end integration audit.
- **Phase 15A** — critical integration fixes:
  - interview report and Development Module persistence made **hard durability
    boundaries** — a failed save is now visible with a persist-only retry (never
    re-runs the AI evaluation / generation);
  - classroom-topic de-duplication is **application-scoped** (no cross-application
    contamination);
  - Dashboard **"Continue preparing"** re-entry into the learning loop;
  - the "redo original question" exercise now gives real deterministic
    concept-coverage feedback instead of a silent save.

## Known deferred (not in Phase 15A)

- **Standalone application creation** — you still add an application only via the
  interview wizard; a "prepare for a role without a mock interview" journey is
  deferred for separate design.
- **Legacy MCQ lesson subsystem** (`openLesson`, `classroom_lessons`,
  `classroom_quiz_results`) — unreachable from the UI; removal is its own phase.
- **`interview_profile` regeneration** — "Practise again" with an unchanged JD
  re-runs the extraction; a hash-keyed reuse is a future cost optimisation.
- **AI-scored original-vs-retry comparison** for the redo answer.

## Invariants (must not regress)

Question Mix ownership · scheduler / methodology ownership · Technical Knowledge
Layer gating (Technical selected only) · HireVue/batch isolation · Candidate State
semantics · application isolation · demonstrated weakness vs area to prepare ·
"AI creates knowledge once, the app transforms it deterministically" · no web
search · tracked migrations only (never an untracked live-only schema change).
