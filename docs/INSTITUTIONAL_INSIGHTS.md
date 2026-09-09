# JOB.READY — EKI² (Employability Knowledge Intelligence Interface)

**EKI²** ("EKI squared") is the institutional-facing product: the *Employability
Knowledge Intelligence Interface* for university careers and employability teams,
powered by JOB.READY student data. It gives them **aggregated, k-anonymised
employability intelligence** derived from the existing JOB.READY interview
practice, plus a **Careers Appointments** workflow that turns that intelligence
into targeted 1:1 support.

It is a *separate front-end tree* mounted at `/institutional`; it shares the
Supabase project and the design language with the student app and **nothing
else**. It creates **no parallel student / application / interview store** — every
number is computed from the existing tables. The normal student-facing JOB.READY
branding is unchanged.

`DATA → INSIGHT → HUMAN INTERVENTION` — JOB.READY collects the practice data, EKI²
finds the patterns, the careers team acts on them; Appointments connects the two.

## Shape

```
Browser  /institutional/*  ──►  src/institutional/InstitutionalApp.jsx
   │                              (own Supabase client, own .ii-* stylesheet)
   │
   ├─ config reads/writes ──►  institutions ▸ institution_organisations ▸ cohorts
   │                           ▸ cohort_members (→ profiles.id) ▸ institution_staff
   │                           (plain RLS; owner/admin write, any staff read)
   │
   └─ analytics reads ──────►  SECURITY DEFINER  inst_*(institution, cohort_ids[], from, to)
                               → verify institution_staff → join existing student
                                 tables → return ONLY aggregates, any group with
                                 < 5 contributing students withheld
```

`src/main.jsx` gates the route: `location.pathname` starting `/institutional` lazy-loads
`InstitutionalApp`; every other path is the unchanged student `<App/>` (plain static import).

### Modules (`src/institutional/`)

| File | Responsibility |
|---|---|
| `supabaseClient.js` | thin CDN-UMD Supabase client (same project + anon key) |
| `theme.js` | self-contained `.ii-*` stylesheet (JOB.READY tokens, isolated namespace) |
| `taxonomy.js` | canonical vocabularies + `MIN_COHORT_N` (k-anonymity = 5) |
| `analytics.js` | pure shaping (cohort summaries, k-anon suppression, filter state) |
| `insights.js` | **pure** derivation of plain-English findings from RPC envelopes — no invented values |
| `present.js` | **pure** presentation layer — turns a finding into `{ lead, why, figure }` careers-team language + a deterministic `suggestedAction`; builds the four Overview cards and the Performance/Competencies verdict line. Never adds a number or a causal claim. |
| `disclosure.jsx` | insight-first presentational blocks: `InsightPanel` (insight → why → figure → suggested action → *Show the evidence*), `OverviewCard`, `VerdictHeader`, `Disclosure`, `QuietStat`, `JourneyEntry`, `FocusList` |
| `api.js` | the only DB module: config CRUD + the `inst_*` analytics surface |
| `ui.jsx` / `charts.jsx` | presentational primitives + inline-SVG visualisations (no chart lib) |
| `InstitutionalApp.jsx` | auth gate + shell + the six section views + Cohorts & students setup |

### UX model (insight-first)

Every analytical screen answers **one question** and follows the same four levels of
progressive disclosure, so a director can read it in ~30 seconds:

1. **What matters** — a plain sentence (`present.humanize().lead`) and, on Performance /
   Competencies, one calm verdict word (`Developing`, `Solid`, …).
2. **Why it matters** — one supporting clause + at most one figure. A number that does
   not inform a decision is not shown by default.
3. **What to do** — a deterministic **Suggested action** where an insight leads to an
   intervention, with a CTA (`Review appointments →`). Never "view affected students"
   (k-anonymity / institution isolation forbid re-identification).
4. **Evidence** — the original charts (`ScoreBars`, `DistributionBar`, …) live inside a
   `Disclosure` ("Show the evidence"), never removed, just demoted.

The **Student Careers Profile** is ordered for an adviser: name → *Why they're here*
(booking reason) → *What to focus on* (numbered) + *What they're already good at* →
*Careers journey* (continuous, oldest-first, collapsible entries) → outcome form →
*Interview performance* (DNA / competency detail, behind a disclosure) → mark status.
The **Appointments** schedule row is `Time · Student · Type · Reason · Status`, and a row
opens that profile directly. The suppression, empty-state and "not enough data" handling
from `insights.js` is unchanged — `present.js` produces no action and no figure for a
suppressed finding.

## Data model & RLS

New tables (all RLS-enabled): `institutions`, `institution_organisations`, `cohorts`,
`cohort_members`, `institution_staff` (`role ∈ owner | admin | analyst | viewer`).

* `jr_inst_role(institution_id)` — SECURITY DEFINER helper; returns the caller's role
  or NULL. Reading `institution_staff` inside a definer function breaks the policy
  recursion, so `<t>_staff_read` policies can call it.
* `jr_inst_can_manage(institution_id)` — `coalesce(role in ('owner','admin'), false)`.
* Config **reads**: any staff of the owning institution. `cohort_members` also readable
  by a student for **their own** rows only (one merged OR'd SELECT policy).
* Config **writes**: `owner`/`admin` only — command-scoped `_insert` / `_update` /
  `_delete` policies (no `FOR ALL`, so a SELECT evaluates exactly one policy).
* **Analytics**: institution staff never get a broad SELECT on student tables. Every
  `inst_*` RPC is SECURITY DEFINER, pinned `search_path`, `revoke`d from `public`/`anon`,
  `grant`ed to `authenticated`, and self-enforces the staff check via
  `jr_inst_scope_student_ids()` (raises `42501` for a non-member). It returns only
  aggregates and applies `c_min_n = 5` suppression to every group.

RLS was verified with a 24-case role-simulated matrix (owner / admin / analyst /
viewer / cross-institution outsider / plain student × read / write / analytics /
reconcile / empty institution / cohort filter / date range) — all pass.

## Analytics — what each RPC answers

`inst_overview` · `inst_performance` · `inst_competencies` · `inst_career_insights` ·
`inst_question_performance` · `inst_improvement` · `inst_development_areas`.

Documented aggregation rules (baked into the SQL, echoed in each envelope):

* overall interview score = `coalesce(interview_reports.overall_score, interviews.overall_score)`, `status = 'completed'` only.
* a competency dimension's cohort value = **mean over students of that student's own
  mean** for the dimension — every student weighted equally.
* `READINESS_TARGET = 70` (the "interview ready" band floor). "Below target" / gaps are measured against it.
* `MATERIAL_GAP = 4` points below the six-dimension average ⇒ "materially below".
* **Improvement is per-student first**: a student's delta = (score of last completed
  interview in range) − (score of first); requires ≥ 2 interviews. Cohort figures are
  the mean / median of those per-student deltas. Never a comparison of two arbitrary interviews.
* Career-path family = a **documented keyword heuristic** over free-text
  `applications.role` / `company` (`jr_role_family` / `taxonomy.classifyRole`, kept in
  sync). Unmatched ⇒ `unclassified`.
* The free-text `interview_questions.competency` label is AI output and is **not**
  aggregated; the competency axis is the six fixed evaluation dimensions.

`insights.js` turns the aggregates into ranked findings. A suppressed or empty section
yields a single neutral *"not enough data"* finding — asserted by
`insightsNoFabrication.test.js` across every deriver and every broken-envelope shape.

## Careers Appointments

Students book time with their university careers team **from the normal JOB.READY
app** (`Careers support` in the student nav → `screen === "careers"`,
`src/careersAppointments.jsx`). The adviser sees the booking in **EKI² →
Appointments** and opens a focused **student intelligence briefing**.

```
appointment_types   global defaults (institution_id null) + per-institution custom
appointment_slots   a careers staff member's bookable window (staff_id → profiles)
                    · no-overlap: EXCLUDE gist(staff_id, tstzrange(starts_at,ends_at))
appointments        one booked slot ↔ one student (slot_id UNIQUE) + optional application_id
```

* **Booking** is a SECURITY DEFINER RPC `book_appointment(slot, type, application, comment)`:
  it locks the slot, re-checks `open` + future, verifies the caller is a linked
  student of the slot's institution and (if given) owns the application, then flips
  the slot to `booked` and inserts the appointment — atomically. `cancel_appointment`
  (student or staff) reopens a future slot; `set_appointment_status` (staff) marks
  completed / no_show / cancelled.
* **RLS**: students read only open future slots for institutions they belong to and
  **only their own** appointments; staff read their institution's slots + appointments
  and manage their own slots. `appointments` has **no write policy** at all — every
  state change is an RPC.
* **`eki_student_briefing(appointment_id)`** — the key RPC. **Double-gated**: the
  caller must be staff of the appointment's institution **and** the student must be a
  current linked cohort member of it. Returns: the student's name + cohort(s) *in
  that institution only*, the appointment + the student's own comment, a concise
  application overview (company / role / stage / date / practice count — never
  `jd_profile` or `application_intelligence`), and an **Interview DNA** built from
  the six controlled evaluation dimensions over that student's completed interviews
  (strengths / development areas / a repeated-development-area pattern only when
  ≥2 recent interviews support it / first-vs-last trend / hardest question category).
  No answer text, no transcript. `src/institutional/appointments.js` shapes it and
  derives the top-of-page briefing sentences — all literal restatements of the data.
* Verified by a 15-case live isolation/permission matrix (institution isolation,
  comment privacy, application-ownership, "student can't call the briefing", cancel
  reopens the slot) and a functional smoke (book / double-book `slot_taken` /
  overlap `23P01` / cancel).

### Careers Relationship History

Each appointment can carry **one adviser outcome** (`appointment_outcomes`, keyed
`UNIQUE(appointment_id)`): *what was discussed / actions agreed / recommended next
steps / follow-up required + notes*, plus `created_at / updated_at / created_by /
updated_by`. A later appointment never overwrites an earlier one; updating an
outcome overwrites only that appointment's record (v1 keeps the latest version —
no per-field revision history).

* `appointment_outcomes` RLS = **one policy**: staff SELECT for the row's
  institution. **No student policy, no write policy** — the only write path is
  `save_appointment_outcome(...)` (SECURITY DEFINER, staff-gated, stamps
  `created_by` on insert / `updated_by` on every write).
* **`eki_student_careers_profile(appointment_id)`** replaces the briefing in the
  detail view. Superset of `eki_student_briefing` (same student / appointment /
  application / interview_dna / patterns), plus:
  - `current_outcome` — this appointment's own outcome (prefills the adviser form).
  - `previous_support` — the immediately-previous appointment at *this institution*:
    days-ago, focus (type), the agreed action, follow-up flag, and the student's
    **key development area as of that date** (weakest dimension over interviews
    completed on/before it). `null` → the UI shows "No previous careers appointments".
  - `history[]` — every prior appointment at this institution, **reverse-chronological**,
    each with its recorded outcome (or `has_outcome: false`). Collapsed by default in the UI.
  - `longitudinal[]` — a **factual, non-causal** statement only when a prior
    appointment has a recorded outcome AND there is ≥1 completed interview on each
    side of it: *"Interview performance increased by N points following the previous
    recorded intervention (mean X across A interviews before, Y across B after)."*
    Never *"the appointment caused …"*.
* Double-gated exactly like the briefing; institution-scoped throughout (a
  multi-institution student never sees institution B's cohort, history or notes in
  institution A's profile). No transcript, no `jd_profile`.
* Verified by a 25-case live matrix: outcome create/update (audit columns, one row,
  no cross-appointment overwrite), multi-appointment chronological history,
  `previous_support` correctness, longitudinal factual entry, cross-institution
  isolation (staff-B → 42501 on profile + outcome write, sees 0 outcome rows),
  student can't read outcomes / call the profile / write outcomes, cancel keeps the
  outcome, empty-history first appointment.

## Performance → intervention → student communication

The Performance page is an **intervention workflow**, not a single cohort-wide verdict.

**Readiness distribution (aggregate, k-anonymised).** Each student's mean practice
score places them in one of three supportive groups — thresholds are the ones already
used end-to-end: `ready` (`ms ≥ 70`, interview-ready), `developing` (`55 ≤ ms < 70`),
`needs_support` (`ms < 55` — `70 − 15`, the same per-dimension "priority" cutoff
`eki_student_briefing` uses). The distribution is shown only when **≥ 5 students are
assessed** (`distribution.suppressed`); below that the page shows the honest
insufficient-data state. `taxonomy.readinessGroup` / `present.readinessRecommendation`
mirror the SQL; language is deliberately non-judgemental (this is *practice*
performance, never a prediction of employment outcomes).

**`eki_readiness_roster(institution, cohort_ids[], from, to)`** — the authorised
drill-in. Staff-gated + scope-gated through `jr_inst_scope_student_ids` (raises `42501`
for a non-staff or wrong-institution caller). It returns the aggregate `distribution`
**and** a per-student `students[]` roster (name, readiness group, mean + latest score,
main development area). Individual identification here is the authorised careers-team
workflow — exactly the gate `eki_student_briefing` uses — and is only reachable by a
deliberate group drill-in; the aggregate k-anonymity on analytics surfaces is
unchanged. No transcript, no free-text competency, nothing cross-institution.

**`eki_student_snapshot(institution, student)`** — the Student Careers Profile for a
student **with no appointment yet** (opened from the roster). Double-gated like the
briefing; same shape family the frontend already shapes (`shapeCareersProfile`), minus
the appointment / outcome blocks. Reuses the existing profile view — no duplicate
student model.

**Acting on the roster** (`src/institutional/intervention.jsx`):
* **Arrange support** → `eki_invite_to_appointment(slot, student, type, message, application)`
  creates an `appointments` row with `status = 'invited'` in one of the *staff member's
  own* open slots (the slot flips to `booked` so it can't be double-taken). One
  student at a time — it needs a specific slot. Widens the `appointments.status` domain
  with `invited` / `declined` and adds `invited_by` / `invited_at` / `invite_message`
  (student-visible) / `responded_at`. **No second appointment model.**
* **Message students** → `send_careers_message(institution, student, body, related?)`
  writes one `careers_messages` row per selected student. `careers_messages` is a
  minimal, institution-scoped model: student reads **only their own**
  (`student_id = auth.uid()`), staff read their institution's, **no client
  insert/update** — `send_careers_message` / `mark_careers_message_read` (SECURITY
  DEFINER) are the only write paths.

**The student side** (`src/careersAppointments.jsx`, unchanged branding). `Careers
support` becomes the communication hub: **Action needed** (a pending invitation with
the careers-team reason + Accept / Decline → `respond_to_appointment_invitation`;
decline reopens a future slot), **Messages** (`list_my_careers_messages`, unread dot,
`mark_careers_message_read` on view), **Upcoming appointments**, **Previous support**.
No institutional terminology, no analytics, no adviser notes — only what a staff
member deliberately sent.

**Three information types stay separate**: (A) institutional intelligence — the
k-anonymised analytics; (B) internal careers records — `appointment_outcomes`
(staff-only, RPC-write); (C) student-facing communication — `appointments.invite_message`
+ `careers_messages`. A student can retrieve only (C).

Verified by a live role-simulated battery (staff roster + distribution math; non-staff
→ 42501; cross-institution staff-B → 42501 on roster / snapshot / message / invite;
invite → `invited` row + `booked` slot; student accept → `booked`; student decline →
`declined` + slot reopened; another student can't accept or read the messages;
distribution `suppressed` when assessed < 5) plus source-inspection guards
(`careersPerformanceInterventionMigration.test.js`, `readiness.test.js`,
`interventionWiring.test.js`).

## Intelligence platform (deterministic engine + one optional AI feature)

One deterministic per-student engine feeds ten connected capabilities. **No LLM is
called from SQL or the client for any figure** — the only AI is the adviser briefing,
an isolated, optional Edge Function.

**Shared engine.** `jr_classify_trajectory(n, first, last, recent_delta, last3_span)`
is the single trajectory definition — mirrored exactly in `trajectory.classifyTrajectory`
so the DB and UI never disagree. Thresholds (documented in both): `improving` = gained
≥ 6 overall **and** still rising (recent ≥ +2); `declining` = lost ≥ 6 **or** a sharp
recent drop (≤ −4); `plateauing` = ≥ 4 attempts, flat recently (|recent| < 3) **and**
last-3 span < 4 (the `42 → 51 → 58 → 58 → 59` case); `stable` otherwise;
`insufficient_data` < 3. `jr_student_trajectory_rows` / `jr_student_dna_rows` are the
reusable per-student series (overall from `interviews`, per-competency from
`competency_history`).

| Feature | Where it lives | Source |
|---|---|---|
| **No Contact Yet** / **Stuck Students** | Performance → drill-in queues | `eki_student_intelligence` (staff-authorised, per-student; NOT k-anon — same gate as `eki_student_briefing`). Rules: no-contact = ≥ 3 interviews, ≥ 5 pts below target, no completed appointment/outcome; stuck = ≥ 3 interviews, below target, trajectory ∈ {plateauing, stable, declining}, recent change < 3, still practising after/without support. Prioritised by gap × ln(interviews). |
| **Student Trajectory** | Student Careers Profile (prominent) + Improvement (institutional movement) + student's Careers Support | shared engine; `trajectory` block on the snapshot / profile / `eki_my_development` |
| **Interview DNA Evolution** | Profile (behind "Show Interview DNA + how it has changed") + student's Careers Support | `jr_student_dna_rows` → `dna_evolution` (earliest vs latest per dimension, strongest improvement, persistent weakness). The six controlled dimensions only. |
| **Programme Employability Pulse** + **Programme-Level Intelligence** | Career Insights + Overview "what needs attention" | `eki_programme_pulse` — programme = cohort (documented heuristic; the only membership-backed grouping). **k-anonymised**: any programme with < 5 assessed students → `{ suppressed: true }`; per-competency figures also require ≥ 5. `programmes.programmeIntelligence()` synthesises the "so what?" list deterministically (no employment-outcome language). |
| **Resource Recommendation Layer** | Profile + Development Areas + student's Careers Support | `resources` (14 seeded global rows; `institution_id` nullable for university-specific). Matched deterministically to the weakest below-target dimension. `list_resources` / snapshot `recommended_resources`. |
| **Personalised Development Plans** | Profile (`DevelopmentPlanCard`, adviser-editable) + student's Careers Support (read-only) | `development_plans` + `development_plan_items`. RLS: student reads **own**, staff read their institution's, **no client write**. `save_development_plan` / `set_development_plan_status` / `upsert_development_plan_item` (SECURITY DEFINER, double-gated). `developmentPlan.suggestPlan()` is the deterministic default. |
| **Follow-up Automation** | Appointments → Follow-ups tab | `eki_follow_up_queue` — **derived**, no duplicated state: outcome flagged `follow_up_required` (+ new `follow_up_due` / `follow_up_completed_at` columns), development-plan review date passed, or still below target after support. `mark_follow_up_done` clears an outcome follow-up. |
| **AI Careers Adviser Briefing** | Profile — "Brief me" | `briefing.deterministicBriefing()` runs instantly with **no AI** and is what the button shows. "Use AI synthesis" calls the `eki-adviser-briefing` Edge Function, which re-authorises via `eki_student_snapshot` (the RPC's own gate), sends a **compact fact set only** (no transcript, no adviser notes), and applies a strict hallucination-resistant prompt (only supplied facts, no diagnosis, no causality, no employment prediction). If `ANTHROPIC_API_KEY` is unset or the model fails, it returns `{ ok:false }` and the client keeps the deterministic briefing — **EKI² never depends on it**. `adviser_briefings` persists the last briefing (staff-only) to avoid re-cost. |

**Three information types, still strictly separated**: (A) institutional aggregate
analytics — k-anonymised; (B) internal careers records — `appointment_outcomes`,
`adviser_briefings` (staff-only, RPC-write); (C) student-facing —
`appointments.invite_message`, `careers_messages`, `development_plans`,
`resources`, `eki_my_development`. A student retrieves only (C), and only their own.

**AI cost.** One ~600-token request **only** when an adviser clicks "Use AI synthesis"
and no briefing is cached; model defaults to a small, cheap model
(`EKI_BRIEFING_MODEL`, default `claude-haiku-4-5`). With no key configured the cost is
exactly zero and every feature still works.

## Deployment

**One optional Edge Function** (`eki-adviser-briefing`) — needs `ANTHROPIC_API_KEY`
(and optionally `EKI_BRIEFING_MODEL`) to do AI synthesis; without it, it degrades
cleanly and EKI² is unaffected. Otherwise: database migrations and the front-end
bundle only.

1. **Apply the migrations** (repo files under `supabase/migrations/`, or via the
   Supabase MCP `apply_migration`). Repo files, in order:
   * `20260909120000_institutional_foundation.sql` — tables, RLS, helper + reconcile RPCs
   * `20260909140000_institutional_analytics.sql` — the seven `inst_*` RPCs + taxonomy helpers
   * `20260909160000_institutional_analytics_indexes.sql` — analytics join indexes
   * `20260909170000_institutional_rls_policy_split.sql` — command-scoped write policies + merged read
   * `20260909180000_careers_appointments.sql` — appointment tables, RLS, 9 RPCs incl. `eki_student_briefing`
   * `20260909190000_careers_appointments_policy_merge.sql` — one SELECT policy per appointment table (perf)
   * `20260909200000_careers_relationship_history.sql` — `appointment_outcomes` + `save_appointment_outcome` + `eki_student_careers_profile`
   * `20260909210000_careers_performance_intervention.sql` — `invited`/`declined` appointment statuses + invite columns, `careers_messages` (+RLS), `eki_readiness_roster`, `eki_student_snapshot`, `eki_invite_to_appointment`, `respond_to_appointment_invitation`, `send_careers_message` + list/mark-read, re-created `list_my_appointments` / `list_institution_appointments` for invite context
   * `20260909220000_careers_intelligence_platform.sql` — `resources`, `development_plans`, `development_plan_items`, `adviser_briefings` (+RLS); `appointment_outcomes` follow-up columns; the shared trajectory/DNA helpers; `eki_student_intelligence`, `eki_programme_pulse`, `eki_follow_up_queue`, `eki_my_development`, `list_resources`; `save_development_plan` / `set_development_plan_status` / `upsert_development_plan_item` / `mark_follow_up_done` / `save_adviser_briefing`; `eki_student_snapshot` + `eki_student_careers_profile` extended with trajectory / DNA evolution / resources / flags / plan / last briefing
   All are idempotent (`create ... if not exists`, `create or replace`, `drop policy if
   exists` + recreate) and additive. The live project also carries a few folded-in
   hot-fix migrations in its ledger (`..._can_manage_bool`, `..._pin_helper_search_path`,
   `..._overview_readiness_n_fix`, `..._merge_select_policies`); a fresh database
   reaches the same final state from the four repo files alone.
2. **Ship the front-end** — no config; `main.jsx` routes `/institutional` automatically.
   `vercel.json` already rewrites all paths to `index.html`.

### Onboarding an institution (no self-serve yet)

There is deliberately no browser flow to create an institution or its first owner —
that is a provisioning step (service role / Supabase SQL editor):

```sql
with i as (
  insert into public.institutions (name, slug, type)
  values ('<University name>', '<slug>', 'university')  -- or 'student_org'
  returning id
)
insert into public.institution_staff (institution_id, user_id, role)
select i.id, '<the staff member''s auth.users id>', 'owner' from i;
```

The owner then signs in at `/institutional` with their normal JOB.READY account and
uses **Cohorts & students** to add cohorts and students by email. Emails that already
match a JOB.READY profile link immediately; the rest link automatically when that
person signs up (or on the owner's "Link new sign-ups" click →
`inst_reconcile_cohort_members`). No email is sent from the institutional app.

## Demo data (development only)

The live project has a demo institution **"Northgate University (demo)"**
(`slug = northgate-demo`, owner `arnav.ovo@gmail.com`) with two cohorts and **18
synthetic students** (`profiles.email like '%@northgate-demo.example'`, ~36 interviews
/ 144 evaluations) so the dashboard is populated above the k=5 threshold end to end.
It also has ~12 demo careers-appointment slots (`appointment_slots.note = 'demo-seed'`)
with two booked appointments, and two past completed appointments with recorded
outcomes for *Demo Student 1-4* (`appointment_slots.note = 'demo-hist'`) so EKI² →
Appointments, the Student Careers Profile (previous support + history + a
longitudinal statement) and the student booking flow are all populated (removed by
the same student delete below).

Remove it entirely with:

```sql
delete from auth.users where email like '%@northgate-demo.example';   -- cascades to profiles + all practice data + memberships
delete from public.institutions where slug = 'northgate-demo';
```

## Known limitations

* **Career-path grouping** is a keyword heuristic, not a definitive taxonomy; the SQL
  and JS copies must be kept in sync (a live parity check is not yet automated).
* **No time-decay / recency weighting** — all completed interviews in the window are
  weighted equally per student.
* **`inst_improvement` per-dimension** needs ≥ 5 students with ≥ 2 datapoints *per
  dimension* to report that row.
* **No per-viewer UI persistence** (last section, filters reset on reload).
* Filter changes re-fetch every section; fine at current scale, revisit with caching
  if institutions grow large.
* The authenticated dashboard has been verified by render tests + the full RLS/analytics
  battery, but a human visual pass on the assembled screens is still worthwhile.
* **Appointments v1**: careers staff = any `institution_staff` row (no dedicated
  careers-adviser role yet); appointment types are seeded globally and can be extended
  per institution only via SQL (no admin UI yet); no reminders / calendar sync; a slot
  is a single window (no recurring availability). Architected for all of these.

## Test surface

`src/institutional/*.test.js` + `src/careersAppointments*.test.js` (node env, no DOM —
consistent with the rest of the repo): `taxonomy`, `readiness` (3-group thresholds +
`readinessRecommendation` — supportive, non-judgemental, null when suppressed),
`analytics`, `insights`, `insightsNoFabrication`, `present` (humanize / suggestedAction
/ overviewCards / verdictFor — no fabricated number, no causal language), `appointments`,
`chartsRender` (react-dom/server), `appStructure` (route gate, isolation, insight-first
UX ordering, adviser-first profile, readiness-first Performance),
`interventionWiring` (distribution → roster → profile → arrange/message; student hub),
`trajectory` (the one classifier + DNA-evolution shaping),
`programmes` (programme intelligence synthesis, suppression respected, no employment claims),
`developmentPlan` (deterministic plan generation + shaping),
`briefing` (deterministic briefing — no fabricated fact, evidence vs suggestion, AI rules),
`adviserBriefingFunction` (Edge Function: re-auth, minimal payload, safe fallback),
`foundationMigration`, `analyticsMigration`, `hardeningMigrations`, `careersMigration`,
`careersHistoryMigration`, `careersPerformanceInterventionMigration`,
`careersIntelligenceMigration` (k-anon on programme pulse, double gates, RLS, no LLM in SQL),
`careersAppointmentsCore`, `careersAppointmentsWiring`. Plus the live SQL batteries
(RLS/permission matrix, appointment isolation + privacy matrix, readiness-roster + intelligence
role-simulated matrix, cross-institution / student-isolation checks, programme k-anon
suppression, calculation spot-checks vs hand computation, `EXPLAIN`, query timing).
