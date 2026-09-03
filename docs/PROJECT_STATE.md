# JOB.READY — Project State

**Last updated:** 2026-08 (Phase 16B)

For the system shape, ownership map and persisted-state table see
`docs/ARCHITECTURE.md`. This file is a short status snapshot.

## What the product does today

JOB.READY takes a user from an interview opportunity to measurable improvement:

0. **Applications pillar** (Phase 16A) — "Applications" is a top-level nav
   destination. **My Applications** lists each opportunity as a concise card
   (company, role, plain-text interview countdown, one best next action),
   ordered by nearest future interview first (a past date is **not** "upcoming"
   and never marks an application complete). **+ Add Application** takes
   company + role (required), an optional job-description/context field, and an
   optional interview date — **and makes zero AI calls**. Each application opens
   a persistent **workspace**: Your Preparation (Continue preparing / Prepare
   for this application / From your interviews), Interviews, Application Details,
   and a lightweight Progress count. The interview date is stored on the
   existing `applications.interview_date` column and drives ordering + the
   countdown **only — JOB.READY sends no reminders** (there is no notification
   mechanism).
1. **Build an interview** — manually (company/role, JD & context, CV, interview
   round, and a mandatory **Question Mix**: Technical / Behavioural / Motivational),
   or by pasting an **offer/invitation email** which is AI-extracted, reviewed and
   completed by the user, then converges into the same wizard. From an
   application workspace, **+ Build interview** pre-fills company / role / JD but
   deliberately **resets the Question Mix** so it stays a manual choice.
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

- **Phase 40** — **pricing, payments & paywall**. A **Pricing** page (public nav)
  showing the four plans: Free (£0, 1 unlock — **explicit confirm, never
  auto-spent**), Last-Minute Saver (£2.99, +1 credit), Student Pack (£4.99, +5
  credits), Job Search Pass (£7.99/mo, unlimited *while the subscription is
  genuinely active*). Applications stay **always creatable/saveable** — access is
  checked only when a *preparation resource* for an application is opened.
  - **Free-unlock — explicit confirmation, never auto-spent.** First access to a
    locked application with the free unlock available opens `FreeUnlockDialog`
    ("You're about to unlock your application at {Company}" / *1 free application
    unlock remaining* / **Not now** · **Unlock & start preparing**). The
    `consume_free_unlock` RPC is called from exactly one place — the dialog's
    confirm handler. Not now / Escape / backdrop / navigating away spend nothing.
    Otherwise a paywall offers a credit spend + the four plans.
  - **Entitlement model.** One unlock permanently unlocks one specific
    application (an `application_unlocks` row); that application then has
    unlimited access to every application-scoped resource. Student Pack's 5
    credits unlock 5 different applications, one at a time; the credit spend is
    `SELECT … FOR UPDATE` row-locked so a credit can't be double-spent. An active
    subscription grants access **only while active** — `has_active_subscription`
    is checked live and **no permanent unlock row is written for a subscriber**
    (so subscription access cannot be converted into a permanent unlock, even via
    a direct RPC call).
  - New migration `20260903090000_pricing_entitlements.sql` (timestamped after
    the reference-code migration; additive/idempotent): tables `user_entitlements`,
    `application_unlocks`, `payments`, `subscriptions` (RLS = SELECT-own only,
    **no write policy**); `SECURITY DEFINER` RPCs (search_path pinned)
    `consume_free_unlock` / `consume_unlock_credit` (authenticated),
    `has_application_access` (authenticated), `has_active_subscription` (internal,
    **fails closed** — needs a concrete, still-valid `current_period_end`),
    `apply_purchase_credits` (**service_role only**); `handle_new_user` seed; a
    one-shot grandfather backfill so every application existing at migration time
    stays unlocked (future applications are not grandfathered).
  - New Edge Functions `create-checkout` (authed; builds a Stripe Checkout
    Session with inline `price_data`) and `stripe-webhook` (`--no-verify-jwt`;
    Stripe-signature verified; service-role). `stripe-webhook` grants one-time
    credits via **`apply_purchase_credits`**, which claims the checkout session
    (`payments.provider_checkout_id` UNIQUE) **and** increments
    `unlock_credits = unlock_credits + n` in **one atomic transaction** — a
    redelivery is a no-op, two concurrent purchases both accumulate with no lost
    update, and a mid-transaction failure can never leave a payment marked
    processed without its credits. Subscriptions upsert on
    `stripe_subscription_id`. `ai-generate` also refuses application-scoped AI for
    a locked application (HTTP 402 `application_locked`) via `has_application_access`
    — its Phase 36/37 provider abstraction / hybrid routing / usage logging are
    untouched.
  - **Checkout-return UX.** On returning with `?checkout=success` the browser
    never claims the purchase landed until a fresh entitlement snapshot actually
    shows the new entitlement (webhook + DB are the sole source of truth). It
    shows a truthful "Payment received — we're confirming your purchase…" banner
    and polls `refreshEntitlements()` with a short increasing backoff (~13s over
    6 checks). On confirmation → a success banner; on timeout → "Your payment was
    received and may still be processing. Refresh your account in a moment to
    check your unlocks." with a **Refresh** button that only re-reads/reconciles.
  - New pure module `src/entitlements.js`. Tests: `entitlements.test.js` (44),
    `phase40PricingPaywall.test.js` (42), `phase40WebhookIdempotency.test.js`
    (21), `phase40CheckoutReturn.test.js` (17),
    `phase40SubscriptionUnlockSecurity.test.js` (13). Added `.gitattributes`
    (`text=auto eol=lf`) so the structural test suite is deterministic on fresh
    checkouts. No new npm dependency, no new `callAI`/`callClaude` request type.
  - **Pending manual steps:** apply the migration, set `STRIPE_SECRET_KEY` /
    `STRIPE_WEBHOOK_SECRET` (+ optional `PUBLIC_SITE_URL`), deploy the three Edge
    Functions, register the Stripe webhook endpoint. See `docs/PRICING.md` and
    `supabase/functions/README.md`.

- **Phase 16B** — **core performance & loading optimisation** (no feature
  change, no new AI call — still 17 `callClaude` sites, same 11 request types):
  - **Reopening an existing Development Module is instant** — served straight
    from the `developmentModules` / `moduleProgress` React state that
    `loadFullUserState` already prefetches (module content is immutable). No
    `dbGetDevelopmentModule`, no blocking `dbGetModuleProgress`, no loading
    screen. A DB fallback stays for a legacy/cross-device miss; a fill-in-only
    background progress read runs (non-blocking) when local state has no record.
  - **Interview generation** — the `applications`-row write and the new
    `interviews`-row insert (independent tables) now run via `Promise.all`
    instead of two serial round-trips; the best-effort CV-claim seed is
    overlapped with the required opening-question insert / batch generation
    instead of being its own serial step. The required application write is
    still checked and still aborts loudly on failure.
  - **New Development Module** — dropped an always-null `dbGetModuleProgress`
    round-trip for a module that was just created (same in `retrySaveModule`).
  - **Honest staged loading** — `LoadingScreen` gained a staged mode: a real
    checklist whose steps advance only when an awaited milestone completes (no
    timer-driven fake progress), with the company/role/topic shown so the user
    knows what they are waiting for. Wired into the interview / development
    module / application-analysis loaders. The legacy rotating-message mode is
    unchanged for the other loaders (out of scope).
  - Flashcards / Written Quiz / answer checking / Learn↔Flashcards↔Quiz
    switching were already 0-AI, 0-DB pure state — verified and locked in.
- **Phase 16A** — **Applications as a first-class product pillar**. New
  `applications` / `application` / `application_form` screens + an
  `application_analyzing` loader, all connective tissue over existing systems:
  - ordering + countdown = new pure module `src/applicationSchedule.js` (no AI,
    no DB, no timers, never throws; status only — **no reminders**);
  - "Analyse this application" is a standalone, **explicitly user-triggered**
    reuse of the *same* `interview_profile` call + `buildApplicationIntelligence`
    + `buildJdProfile` + persistence as `analyseAndPlan` (the system prompt is
    now the hoisted `INTERVIEW_PROFILE_SYSTEM` const, shared by both) — it
    builds **no interview**;
  - staleness after an edit is **detected** with the existing
    `hashApplicationSources` / `applicationIntelligenceIsStale`; editing never
    silently regenerates;
  - recommendations reuse `classroomRecommendationGroups` +
    `pickContinuePreparing` (scoped to the one application); "Start learning"
    reuses the Phase 14.1 Development Module path verbatim;
  - **cost:** Create / edit / date / open list / open application /
    reopen analysed application = **0 AI calls**; only Analyse / Re-analyse
    spends the one existing call, then persists for reuse.
  - No migration: `applications.interview_date` already existed in the baseline
    and was simply unused by the client.
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

## Known deferred (not in Phase 16A)

- **Interview-date reminders / notifications** — deliberately **not built**.
  There is no cron / push / email infrastructure, so the date only orders
  applications and shows a countdown. Any "we'll remind you" language is out of
  scope until a real delivery mechanism exists.
- **Dashboard "upcoming interview" surfacing** — `nearestUpcomingApplication` is
  computed but the Dashboard was left unchanged (the existing "what next" card
  is cross-application by design; adding a per-application countdown there would
  duplicate the Applications list). Revisit if wanted.
- **Legacy MCQ lesson subsystem** (`openLesson`, `classroom_lessons`,
  `classroom_quiz_results`) — unreachable from the UI; removal is its own phase.
- **`interview_profile` regeneration** — "Practise again" with an unchanged JD
  re-runs the extraction; a hash-keyed reuse is a future cost optimisation.
  (Application *Analyse* already reuses on reopen via the stored hash.)
- **AI-scored original-vs-retry comparison** for the redo answer.
- **Email scanner → application binding** — the invitation scanner still creates
  its application through the wizard; it was not re-pointed at the new Add
  Application flow. Existing dedupe/matching is unchanged; nothing auto-merges.

## Invariants (must not regress)

Question Mix ownership (incl. reset — never pre-selected — when building an
interview from an application) · scheduler / methodology ownership · Technical
Knowledge Layer gating (Technical selected only) · HireVue/batch isolation ·
Candidate State semantics · application isolation (per-application topic /
module / recommendation scoping) · demonstrated weakness vs area to prepare
(a preparation recommendation is never called a weakness) · "AI creates
knowledge once, the app transforms it deterministically" · Applications
create / edit / date / open = 0 AI calls; only explicit Analyse / Re-analyse
spends the one existing `interview_profile` call · the interview date implies
**no reminder** · no web search · tracked migrations only (never an untracked
live-only schema change).
