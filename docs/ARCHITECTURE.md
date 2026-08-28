# JOB.READY — Architecture

*Describes the current product. Updated Phase 15A (2026-08).*

## System shape

```text
Browser / JOB.READY frontend  (src/App.jsx + pure logic modules)
        |
        +--> Supabase Auth ............ canonical identity (auth.uid())
        |
        +--> Supabase Database (RLS per user) — see "Persisted state" below
        |
        +--> private Supabase Storage — bucket "documents" (CVs / JDs), user-foldered
        |
        +--> authenticated Supabase Edge Function "ai-generate"
                    |
                    +--> Anthropic API   (the ONLY place the API key exists)
```

The frontend is a single React app. All domain logic that can be deterministic
lives in small pure modules imported by `App.jsx` (no AI, no DB, no React):
`methodology.js`, `adaptiveEngine.js`, `questionMix.js`, `interviewKnowledge.js`
(+ `knowledgeCatalogue.js`), `candidateState.js`, `candidateIntelligence.js`,
`interviewStrategy.js`, `applicationIntelligence.js`, `invitationScannerResolve.js`
(+ `invitationScannerEvaluation.js`), `writtenQuiz.js`, `continuePreparing.js`.

## The product loop

```text
APPLICATION / INTERVIEW OPPORTUNITY
        |
        +-- manual: Build Interview wizard (company/role -> JD & context -> CV ->
        |           round + QUESTION MIX) -> "Build my interview"
        +-- offer email: paste invitation -> AI extraction -> review/complete ->
                    converges into the SAME wizard at the final step
        v
ANALYSE & PLAN  (one AI call: interview_profile)
   -> jd_profile + jd_profile_hash               (applications)
   -> Application Intelligence                    (applications.application_intelligence)
   -> methodology distribution (scheduler-owned), clamped to the Question Mix
        v
PRACTICE
   adaptive pipeline: per-turn evaluate (Call 1) -> deterministic scheduler
        (methodology.js + adaptiveEngine.js own category / turn type / anchor)
        -> per-turn generate (Call 2)
   independent_batch (HireVue-style): question set generated up front, answers
        captured independently, one batch evaluation. Fully isolated from the
        adaptive pipeline; the Knowledge Layer never applies to it.
        v
DIAGNOSIS  (one AI call: interview_report)
   -> per-question feedback, weakest areas, next practice focus
   -> classroom_topics[]  -> pushClassroomTopics -> classroom_topics rows
        (identity = normalised topic name + application; a weakness for one
         application never merges into another's — Phase 15A)
   -> candidate_dna (perf.weaknesses / strengths / style notes)
        v
CLASSROOM
   "Recommended for your application"  — per selected application, from its
        Application Intelligence x Candidate State (applicationDevelopmentPriorities).
        Each item is a DEMONSTRATED weakness or an AREA TO PREPARE (never blurred).
        "Start learning" opens a Development Module for a matching classroom_topic,
        or MATERIALISES one from the recommendation (no AI) then opens it.
   "From your interviews"  — interview/AC-diagnosed topics with real evidence.
        v
DEVELOPMENT MODULE   (one AI call: development_module — generated ONCE per topic,
                      then reused forever; a persisted module = ZERO AI calls)
   |-- 📚 Learn        : learning guide (core explanation, per-concept, frameworks,
   |                     examples, common mistakes, application context)
   |-- 🗂️ Flashcards   : one card at a time from learning_items[]  (no AI)
   |-- ✍️ Written Quiz : free-response; marked DETERMINISTICALLY by concept
   |                     coverage against learning_items[].expected_concepts
   |                     (writtenQuiz.js — no AI). Feedback = Your answer /
   |                     Key points covered ✓ / Still to include ○ / Review /
   |                     Try again. Never "wrong". Retakes reshuffle the pool.
   |-- 🎤 Redo the original interview question : answer marked deterministically
   |                     against the module's concept union (no AI). Or hand off
   |                     to the existing full targeted-interview flow.
   +-- WHAT NEXT?      : Review guide / Practise flashcards / Take another quiz /
                         Try the question again — the student is never forced back
                         to the start.
        v
IMPROVEMENT
   Retaking an interview / quiz updates scores, Candidate State and the Dashboard
   "Continue preparing" pick. A per-answer original-vs-retry AI comparison is
   intentionally NOT built (deferred).
```

## Demonstrated weakness vs area to prepare

Two distinct states, kept separate at every surface:

- **Demonstrated weakness** — the candidate was assessed on it in an interview
  and the evidence was weak / contradictory / declining. Framed as
  *"Based on your interview performance."* Carries `last_interview_id` /
  `source_interview_id`; has interview scores.
- **Area to prepare** — important for the application, but the candidate has not
  been tested on it. Framed as *"Important to prepare for this application. You
  have not been tested on this yet."* No interview reference; `scores` is `[]`
  (rendered as neutral "To start", never red "Needs work").

`applicationDevelopmentPriorities` marks each recommendation `gapKind:
"demonstrated" | "preparation" | "developing" | "mixed"`. Development Module
generation is told which framing to use. `pickContinuePreparing` never collapses
a preparation area into a "weakness".

## Ownership (do not duplicate)

| Concern | Sole owner |
|---|---|
| Interview category / turn type / anchor source | `methodology.js` + `adaptiveEngine.js` |
| Which question types are allowed in an interview | user's **Question Mix** (`questionMix.js`), a hard permission boundary |
| Whether the Technical Knowledge Layer may operate | `isTechnicalMixEnabled(config.question_mix)` — only when Technical is selected |
| Canonical concept taxonomy (what to test) | `knowledgeCatalogue.js` (no teaching prose) |
| "What matters for this application" | `applicationIntelligence.js` |
| Application-specific development priority | `applicationDevelopmentPriorities` (one engine; Classroom + "Continue preparing" both consume it) |
| Diagnosed development need | `classroom_topics` (from interview/AC report only) |
| Reusable learning content | `development_modules` (one per `classroom_topics` row) |
| Written-quiz marking | `writtenQuiz.js` — deterministic, no AI |
| Candidate evidence / trend | `candidateState.js` |

## Persisted state (Supabase, RLS per user)

| Data | Table(s) | Durability |
|---|---|---|
| Applications | `applications` | hard |
| Application Intelligence | `applications.application_intelligence` (jsonb) | hard (checked write) |
| JD profile | `applications.jd_profile`, `jd_profile_hash` | hard (checked write) |
| Interviews / questions / answers / evaluations | `interviews`, `interview_questions`, `answers`, `evaluations` | hard (throw) |
| Interview report (feedback + diagnosis) | `interview_reports` | **hard** — `dbCompleteInterview` reports `{ok}`, failure is surfaced with a persist-only retry (Phase 15A) |
| Candidate DNA / competency history | `candidate_dna`, `competency_history` | best-effort |
| Candidate claims | `candidate_claims` | best-effort |
| Interview Memory | `interview_memory`, `memory_comparisons` | best-effort |
| Classroom topics | `classroom_topics` | best-effort |
| Development Modules | `development_modules` | **hard** — `dbInsertDevelopmentModule` failure never fakes an `id:null` module and never auto-regenerates; persist-only retry (Phase 15A) |
| Development progress (flashcards, quiz attempts, redo answers) | `development_module_progress` | best-effort |
| Assessment Centre attempts | `assessment_attempts` | best-effort |
| Documents (metadata) | `documents`; files in Storage bucket `documents` | best-effort |
| Server-side AI usage / rate limit | `ai_usage`, `api_usage_limits` (written by the Edge Function) | n/a (client-read only) |

Legacy MCQ lesson tables (`classroom_lessons`, `classroom_quiz_results`) exist but
are no longer written by the UI — scheduled for a separate cleanup phase.

## AI calls (all via `callClaude` -> `ai-generate` Edge Function)

`interview_profile`, `interview_question_batch`, `interview_turn_evaluate`,
`interview_turn_generate`, `interview_batch_evaluation`, `interview_report`,
`invitation_extraction`, `development_module`, `assessment_centre_scenario`,
`assessment_centre`, `classroom_lesson` (legacy, unreachable).

**AI generates knowledge once; the app then transforms it deterministically.**
Learn, Flashcards, Written Quiz, quiz marking, quiz retakes, "redo" marking and
the "Continue preparing" pick make **no AI call**. No web search anywhere.

## Migrations

`supabase/migrations/` — `20260828120000_baseline_schema.sql` (full idempotent
snapshot) then timestamped incrementals (`20260828135856_development_modules.sql`).
New schema changes get a new tracked migration; the baseline is never edited.
