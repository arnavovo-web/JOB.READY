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
| `api.js` | the only DB module: config CRUD + the `inst_*` analytics surface |
| `ui.jsx` / `charts.jsx` | presentational primitives + inline-SVG visualisations (no chart lib) |
| `InstitutionalApp.jsx` | auth gate + shell + the six section views + Cohorts & students setup |

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

## Deployment

**No new environment variables. No new Edge Functions.** Only database migrations and
the front-end bundle.

1. **Apply the migrations** (repo files under `supabase/migrations/`, or via the
   Supabase MCP `apply_migration`). Repo files, in order:
   * `20260909120000_institutional_foundation.sql` — tables, RLS, helper + reconcile RPCs
   * `20260909140000_institutional_analytics.sql` — the seven `inst_*` RPCs + taxonomy helpers
   * `20260909160000_institutional_analytics_indexes.sql` — analytics join indexes
   * `20260909170000_institutional_rls_policy_split.sql` — command-scoped write policies + merged read
   * `20260909180000_careers_appointments.sql` — appointment tables, RLS, 9 RPCs incl. `eki_student_briefing`
   * `20260909190000_careers_appointments_policy_merge.sql` — one SELECT policy per appointment table (perf)
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
with two booked appointments so EKI² → Appointments and the student booking flow are
populated (removed by the same student delete below).

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
consistent with the rest of the repo): `taxonomy`, `analytics`, `insights`,
`insightsNoFabrication`, `appointments`, `chartsRender` (react-dom/server),
`appStructure`, `foundationMigration`, `analyticsMigration`, `hardeningMigrations`,
`careersMigration`, `careersAppointmentsCore`, `careersAppointmentsWiring`. Plus the
live SQL batteries (RLS/permission matrix, appointment isolation + privacy matrix,
calculation spot-checks vs hand computation, `EXPLAIN`, query timing).
