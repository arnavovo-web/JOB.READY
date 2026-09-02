/* ================================================================== *
 * PHASE 4 — APPLICATIONS, RETURNING-USER CONTINUITY & DETERMINISTIC
 * NEXT-PRACTICE RECOMMENDATIONS TEST SUITE
 * ------------------------------------------------------------------
 * Covers this phase's product push:
 *   (1) "applications" is surfaced properly (Dashboard/Progress) instead of being fetched
 *       and silently discarded down to a company/role lookup table.
 *   (2) interviews carry their stage/format label through to the report, so a candidate can
 *       tell which stage of a job's process a given report was for.
 *   (3) a candidate can resume a draft application or practise again for an existing one,
 *       reusing the SAME application rather than always forking a new one.
 *   (4) a real, pre-existing stale-state bug is fixed: starting a new interview without going
 *       through the Report screen's own reset button used to leave the previous session's
 *       JD/CV text sitting in the wizard.
 *   (5) Dashboard/Progress "what to focus on next" is a thin, deterministic RENDER of
 *       interviewStrategy.js's own priorities/candidateState.js's own category coverage —
 *       never a new intelligence system, never an AI call.
 * STRUCTURAL checks use the same source-text-inspection convention as reportUX.test.js/
 * reportHistory.test.js, since App() is a React closure that can't be invoked directly.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function extractFunctionSource(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found in App.jsx: ${startMarker}`);
  const end = SOURCE.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`end marker not found in App.jsx: ${endMarker}`);
  return SOURCE.slice(start, end);
}

/* ============================== loadFullUserState (STRUCTURAL) ============================== */
describe("loadFullUserState surfaces applications and interview stage/format (STRUCTURAL)", () => {
  const LOAD_SRC = extractFunctionSource("async function loadFullUserState(userId) {", "async function dbCreateApplication");

  it("applications is built from the already-fetched apps rows, not a second query", () => {
    expect(LOAD_SRC).toMatch(/const applications = apps\.map\(/);
    const matches = LOAD_SRC.match(/dbSelect\("applications"/g) || [];
    expect(matches.length).toBe(1);
  });

  it("applications carries jobDescription (for practise-again JD prefill) and status", () => {
    expect(LOAD_SRC).toMatch(/jobDescription: a\.job_description \|\| ""/);
    expect(LOAD_SRC).toMatch(/status: a\.status \|\| "draft"/);
  });

  it("applications is returned from loadFullUserState (not discarded after building appById)", () => {
    const returnIdx = LOAD_SRC.indexOf("return {");
    const returnBlock = LOAD_SRC.slice(returnIdx);
    expect(returnBlock).toMatch(/\bapplications\b/);
  });

  it("interviewList carries stageLabel/formatLabel, guarded so a legacy (pre-Phase-4A) row never displays a stage it was never configured with", () => {
    expect(LOAD_SRC).toMatch(/stageLabel: iv\.stage \? stageByKey\(iv\.stage\)\.label : null/);
    expect(LOAD_SRC).toMatch(/formatLabel: iv\.format \? \(INTERVIEW_FORMATS\[iv\.format\]\?\.label \|\| null\) : null/);
  });
});

/* ============================== ReportBody stage/format context (STRUCTURAL) ============================== */
describe("ReportBody surfaces which interview stage a report was for (STRUCTURAL)", () => {
  const REPORT_BODY_SRC = extractFunctionSource("function ReportBody(", "function AcScorecardBody(");

  it("accepts stageLabel/formatLabel and only renders the stage line when one is actually known", () => {
    expect(REPORT_BODY_SRC).toMatch(/stageLabel, formatLabel/);
    expect(REPORT_BODY_SRC).toMatch(/\{stageLabel && <div/);
  });

  it("both the live and the historical report screens thread stageLabel/formatLabel through", () => {
    const liveScreen = extractFunctionSource('screen === "report" && report && (', 'screen === "report_view" && viewedReport && (');
    const historyScreen = extractFunctionSource('screen === "report_view" && viewedReport && (', '{/* ---------------- PROGRESS');
    expect(liveScreen).toMatch(/stageLabel=\{interview\?\.stageLabel\} formatLabel=\{interview\?\.formatLabel\}/);
    expect(historyScreen).toMatch(/stageLabel=\{viewedReport\.stageLabel\} formatLabel=\{viewedReport\.formatLabel\}/);
  });
});

/* ============================== continueApplication / practiseApplicationAgain (STRUCTURAL) ============================== */
describe("continueApplication (STRUCTURAL)", () => {
  const FN_SRC = extractFunctionSource("async function continueApplication(app) {", "/* ---------------- PHASE 38: PRACTISE AGAIN (frictionless repeat interview) ---------------- */");

  it("reuses the existing application id rather than creating a new draft", () => {
    expect(FN_SRC).toMatch(/setApplicationId\(app\.id\)/);
  });

  it("prefills JD straight from the application row when already persisted, before ever touching the network", () => {
    expect(FN_SRC).toMatch(/setJdText\(app\.jobDescription \|\| ""\)/);
  });

  it("best-effort CV/JD restore from documents never issues an AI call, and never throws out to the caller on failure", () => {
    expect(FN_SRC).not.toMatch(/callClaude/);
    expect(FN_SRC).toMatch(/catch \(e\) \{ \/\* best-effort restore only/);
  });

  it("lands on wizard step 2 (company/role already known, so step 1 is skipped)", () => {
    // Phase 20: an entry-point resume guard sits between setWizardStep and
    // setScreen — step is still 2, screen is still "create" when not resuming.
    expect(FN_SRC).toMatch(/setWizardStep\(2\);/);
    expect(FN_SRC).toMatch(/setScreen\("create"\)/);
  });
});

describe("practiseApplicationAgain (STRUCTURAL)", () => {
  // Phase 38: "Practise again" no longer prefills the wizard and sends the candidate through
  // it — it now just opens the confirmation modal ("Create a new interview using your previous
  // settings?"). All the actual wizard-state prefill + generation moved to startPractiseAgain,
  // invoked only after explicit confirmation (see the "Phase 38 — Practise again" describe
  // block below for that pipeline's own coverage).
  const FN_SRC = extractFunctionSource("function practiseApplicationAgain(app) {", "function cancelPractiseAgain()");

  it("never issues an AI call or a DB read/write — opening the confirmation modal is a pure state change, nothing happens yet", () => {
    expect(FN_SRC).not.toMatch(/callClaude|getSupabase|\.from\(/);
  });

  it("opens the confirmation modal for the clicked application — no wizard step, no screen change, no interview created yet", () => {
    expect(FN_SRC).toMatch(/setPractiseAgainConfirmApp\(app\)/);
    expect(FN_SRC).not.toMatch(/setScreen\(|setWizardStep\(/);
  });
});

/* ============================== Phase 38 — Practise again (frictionless repeat interview) ============================== */
describe("Phase 38 — Practise again reuses the SAME interview-generation pipeline, never a shortcut", () => {
  const START_PRACTISE_AGAIN = extractFunctionSource("async function startPractiseAgain(app) {", "function confirmPractiseAgain()");
  const CONFIG_FOR = extractFunctionSource("function practiseAgainConfigFor(app) {", "async function startPractiseAgain(app) {");

  it("reads the canonical stored config off the application's most recent interview — no second/parallel config source", () => {
    expect(CONFIG_FOR).toMatch(/const latest = \(app\.interviews \|\| \[\]\)\[0\]/);
    expect(CONFIG_FOR).toMatch(/const config = latest\?\.config/);
  });

  it("requires stage, format and a non-empty question mix before treating the config as usable — no fabricated settings", () => {
    expect(CONFIG_FOR).toMatch(/if \(!config \|\| !config\.stage \|\| !config\.format \|\| !arr\(config\.question_mix\)\.length\) return null;/);
  });

  it("on a complete config, it calls analyseAndPlan() directly — the exact same function the wizard's own \"Build my interview\" button calls, never a bypass/shortcut", () => {
    expect(START_PRACTISE_AGAIN).toMatch(/analyseAndPlan\(\);/);
  });

  it("prefills company/role/JD from the application and stage/format/question mix/technical difficulty/length from the stored config", () => {
    expect(START_PRACTISE_AGAIN).toMatch(/setCompany\(app\.company \|\| ""\); setRole\(app\.role \|\| ""\)/);
    expect(START_PRACTISE_AGAIN).toMatch(/setJdText\(app\.jobDescription \|\| ""\)/);
    expect(START_PRACTISE_AGAIN).toMatch(/setInterviewStage\(config\.stage\); setInterviewFormat\(config\.format\)/);
    expect(START_PRACTISE_AGAIN).toMatch(/setQuestionMix\(\{/);
    expect(START_PRACTISE_AGAIN).toMatch(/setTechnicalDifficulty\(/);
    expect(START_PRACTISE_AGAIN).toMatch(/setLength\(/);
  });

  it("falls back to the minimum-necessary wizard entry (never the full from-scratch wizard) when the config can't be recovered, with an honest, non-fabricated message", () => {
    expect(START_PRACTISE_AGAIN).toMatch(/if \(!config\) \{/);
    expect(START_PRACTISE_AGAIN).toMatch(/We need a little more information to create this interview/);
    expect(START_PRACTISE_AGAIN).toMatch(/setWizardStep\(app\.jobDescription \? 3 : 2\)/);
  });

  it("the fallback check runs, and returns, before any generation is kicked off — analyseAndPlan() is only reached on the complete-config path", () => {
    const configCheckAt = START_PRACTISE_AGAIN.indexOf("if (!config) {");
    const generateAt = START_PRACTISE_AGAIN.indexOf("analyseAndPlan();");
    expect(configCheckAt).toBeGreaterThan(-1);
    expect(generateAt).toBeGreaterThan(configCheckAt);
  });

  it("never routes to the full wizard when the config is complete — the normal path has no setScreen(\"create\") call at all", () => {
    const normalPathOnly = START_PRACTISE_AGAIN.slice(0, START_PRACTISE_AGAIN.indexOf("if (!config) {"));
    expect(normalPathOnly).not.toMatch(/setScreen\("create"\)/);
  });

  it("confirmPractiseAgain closes the modal before creating anything, then hands off to startPractiseAgain — Cancel (a separate function) never calls it", () => {
    const CONFIRM_SRC = extractFunctionSource("function confirmPractiseAgain() {", "/* ---------------- PHASE 16A: APPLICATIONS PILLAR");
    expect(CONFIRM_SRC).toMatch(/setPractiseAgainConfirmApp\(null\)/);
    expect(CONFIRM_SRC).toMatch(/startPractiseAgain\(app\)/);
    expect(SOURCE).toMatch(/function cancelPractiseAgain\(\) \{ setPractiseAgainConfirmApp\(null\); \}/);
  });

  it("the confirmation modal reuses the existing ConfirmDialog component, not a new one, with non-destructive (accent) styling", () => {
    const MODAL_SRC = extractFunctionSource("{practiseAgainConfirmApp && (", "{/* ---------------- LANDING");
    expect(MODAL_SRC).toMatch(/<ConfirmDialog/);
    expect(MODAL_SRC).toMatch(/title="Create a new interview\?"/);
    expect(MODAL_SRC).toMatch(/confirmVariant="accent"/);
    expect(MODAL_SRC).toMatch(/onCancel=\{cancelPractiseAgain\}/);
  });
});

/* ============================== stale JD/CV bug fix (STRUCTURAL — regression test) ============================== */
describe("starting a fresh interview always clears the previous session's JD/CV text (STRUCTURAL — regression)", () => {
  it("startCreateFlow clears company/role/jdText/cvText — previously it left them stale, so a candidate who didn't use the Report screen's own \"New interview\" button could silently see the PREVIOUS job's JD/CV on the new wizard", () => {
    const FN_SRC = extractFunctionSource("function startCreateFlow(focusWeak = false) {", "// Phase 4 (returning-user continuity): resume a draft");
    expect(FN_SRC).toMatch(/setCompany\(""\); setRole\(""\); setInterviewDateInput\(""\); setJdText\(""\); setCvText\(""\);/);
  });

  it("startCreateFlow also clears the Phase 36 interview-date field — a stale date from a previous build must never leak into a fresh one", () => {
    const FN_SRC = extractFunctionSource("function startCreateFlow(focusWeak = false) {", "// Phase 4 (returning-user continuity): resume a draft");
    expect(FN_SRC).toMatch(/setInterviewDateInput\(""\)/);
  });

  it("practiseThisWeakness clears jdText/cvText while still prefilling company/role from the topic", () => {
    const FN_SRC = extractFunctionSource("function practiseThisWeakness(topic) {", "function loadDemo() {");
    expect(FN_SRC).toMatch(/setCompany\(topic\.company\); setRole\(topic\.role\);/);
    expect(FN_SRC).toMatch(/setJdText\(""\); setCvText\(""\);/);
  });
});

/* ============================== wizard context line (STRUCTURAL) ============================== */
describe("the create wizard shows which company/role it's for once step 1 is skipped (STRUCTURAL)", () => {
  it("renders a company/role context line from step 2 onward, not just inside step 1's own form", () => {
    const CREATE_SRC = extractFunctionSource('screen === "create" && (', "{screen === \"analyzing\"");
    expect(CREATE_SRC).toMatch(/\{wizardStep > 1 && \(company \|\| role\) && \(/);
  });
});

/* ============================== deterministic recommendations (STRUCTURAL) ============================== */
describe("Dashboard/Progress next-practice recommendations are a thin render of existing engines, never a new one (STRUCTURAL)", () => {
  const DERIVED_SRC = extractFunctionSource("const claimsOverview = [...candidateClaims]", "if (!authChecked) {");

  it("globalCandidateState/globalStrategy are built with buildCandidateState/buildInterviewStrategy — the SAME imports the live interview turn already uses, not a re-implementation", () => {
    expect(DERIVED_SRC).toMatch(/buildCandidateState\(\{ candidateSignals: candidateIntelligence, claims: candidateClaims, questionHistory \}\)/);
    expect(DERIVED_SRC).toMatch(/buildInterviewStrategy\(\{ candidateSignals: globalCandidateState, claims: candidateClaims \}\)/);
  });

  it("defines no new priority/scoring constant of its own (no ad-hoc weights, thresholds, or thereasons besides what interviewStrategy.js already returns)", () => {
    expect(DERIVED_SRC).not.toMatch(/_THRESHOLD|_WEIGHT|_BASE\s*=|_CAP\s*=/);
  });

  it("nextPriorities is gated on having at least one completed interview — never surfaced as five identical zero-evidence \"priorities\" before any real evidence exists", () => {
    expect(DERIVED_SRC).toMatch(/const nextPriorities = \(interviewList\.length > 0 && globalStrategy\?\.priorities\?\.length\)/);
  });

  it("a claim priority resolves to that claim's real text, never a fabricated label — an unresolvable claim id is dropped, not shown blank", () => {
    expect(DERIVED_SRC).toMatch(/candidateClaims\.find\(\(c\) => c\.id === p\.key\)/);
    expect(DERIVED_SRC).toMatch(/\.filter\(Boolean\)/);
  });
});

describe("Progress screen renders the recommendations/coverage sections, gated the same way (STRUCTURAL)", () => {
  const PROGRESS_SRC = extractFunctionSource('screen === "progress" && (', '{/* ---------------- CLASSROOM DASHBOARD');

  it("Recommended next practice and Interview area coverage both require at least one completed interview", () => {
    const occurrences = PROGRESS_SRC.match(/\{interviewList\.length > 0 && \(/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("category coverage is read from candidateState.js's own per-category status, not re-derived here", () => {
    expect(PROGRESS_SRC).toMatch(/Object\.entries\(globalCandidateState\?\.categories \|\| \{\}\)/);
  });
});

/* ============================== Dashboard applications grouping (STRUCTURAL) ============================== */
describe("Dashboard groups interviews by application instead of a flat list (STRUCTURAL)", () => {
  // End marker is the Phase 16A block (inserted between the Dashboard screen and
  // CREATE) so this slice stays the Dashboard's own JSX only.
  const DASHBOARD_SRC = extractFunctionSource('screen === "dashboard" && user && (', 'PHASE 16A — APPLICATIONS PILLAR');

  it("renders applicationsWithInterviews, not the old flat interviewList map", () => {
    expect(DASHBOARD_SRC).toMatch(/applicationsWithInterviews\.map\(\(app\) => \{/);
  });

  it("a draft application (no completed interview) offers Continue setup instead of a score", () => {
    expect(DASHBOARD_SRC).toMatch(/Continue setup/);
    expect(DASHBOARD_SRC).toMatch(/guarded\(\(\) => continueApplication\(app\)\)/);
  });

  it("an application with at least one completed interview offers Practise again, reusing it", () => {
    expect(DASHBOARD_SRC).toMatch(/guarded\(\(\) => practiseApplicationAgain\(app\)\)/);
  });
});

describe("applicationsWithInterviews derivation (STRUCTURAL)", () => {
  const DERIVED_SRC = extractFunctionSource("const applicationsWithInterviews = applications", "let globalCandidateState");

  it("groups by applicationId, matching each interview to its own application only", () => {
    expect(DERIVED_SRC).toMatch(/interviewList\.filter\(\(iv\) => iv\.applicationId === app\.id\)/);
  });

  it("sorts by most recent activity across the application and every one of its interviews/AC attempts, not merely by creation date", () => {
    expect(DERIVED_SRC).toMatch(/Math\.max\(app\.date, \.\.\.interviews\.map\(\(iv\) => iv\.date\), \.\.\.acAttemptsForApp\.map\(\(a\) => a\.date\)\)/);
  });

  it("also groups Assessment Centre attempts genuinely tied to this application (Phase 5)", () => {
    expect(DERIVED_SRC).toMatch(/acAttempts\.filter\(\(a\) => a\.applicationId === app\.id\)/);
  });
});

/* ============================== same-session availability (STRUCTURAL — regression) ============================== */
describe("a just-finished interview groups under its application in the SAME session (STRUCTURAL — regression)", () => {
  it("finishInterview's in-memory summary carries applicationId/stageLabel/formatLabel, not just score/report", () => {
    const FINISH_SRC = extractFunctionSource("async function finishInterview(finalInterview) {", "async function submitAsyncAnswer");
    expect(FINISH_SRC).toMatch(/const summary = \{[^}]*applicationId: finalInterview\.applicationId[^}]*\};/);
  });
});

describe("confirmCompanyRole/analyseAndPlan keep local `applications` state in sync (STRUCTURAL — same-session availability)", () => {
  it("confirmCompanyRole adds a new draft (or updates company/role) to `applications` immediately, not only after a reload", () => {
    const FN_SRC = extractFunctionSource("async function confirmCompanyRole() {", "async function handleFileUpload");
    expect(FN_SRC).toMatch(/setApplications\(\[\{ id: app\.id/);
    expect(FN_SRC).toMatch(/setApplications\(applications\.map\(/);
  });

  it("analyseAndPlan marks the application active (with its JD/stage) in `applications` immediately", () => {
    const FN_SRC = extractFunctionSource("async function analyseAndPlan() {", "// Phase 2D: seed newly-extracted CV claims");
    expect(FN_SRC).toMatch(/setApplications\(\(prev\) => prev\.map\(\(a\) => \(a\.id === applicationId \? \{ \.\.\.a, status: "active"/);
  });
});

/* ============================== ownership / RLS defense-in-depth (STRUCTURAL) ============================== */
describe("dbGetApplicationDocuments filters by user_id in addition to RLS (STRUCTURAL)", () => {
  it("matches every other query in this file's own defense-in-depth convention, rather than relying on RLS alone", () => {
    const FN_SRC = extractFunctionSource("async function dbGetApplicationDocuments(userId, applicationId) {", "async function dbCreateInterview");
    expect(FN_SRC).toMatch(/\.eq\("user_id", userId\)\.eq\("application_id", applicationId\)/);
  });
});

/* ============================== sign-out hygiene (STRUCTURAL) ============================== */
describe("clearAllUserState resets applications on sign-out (STRUCTURAL — ownership hygiene)", () => {
  it("resets applications, same as every other per-user field", () => {
    const CLEAR_SRC = extractFunctionSource("function clearAllUserState(", "async function handleSignUp()");
    expect(CLEAR_SRC).toMatch(/setApplications\(\[\]\)/);
  });
});
