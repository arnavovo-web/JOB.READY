/* ================================================================== *
 * PHASE 16A — APPLICATIONS AS A FIRST-CLASS PRODUCT PILLAR
 * ------------------------------------------------------------------
 * The Applications workspace must be CONNECTIVE TISSUE over existing
 * systems, never a parallel engine:
 *   - ordering / countdown  -> applicationSchedule.js (pure, already
 *     covered behaviourally in applicationSchedule.test.js)
 *   - recommendations       -> applicationIntelligence.js
 *     (classroomRecommendationGroups) + continuePreparing.js
 *     (pickContinuePreparing)
 *   - learning              -> the Phase 14 / 14.1 Development Module path
 *   - persistence           -> the SAME `applications` row
 *
 * HARD COST RULE: Create Application, add/edit the interview date, open
 * the Applications list, and open an Application make ZERO AI calls.
 * Only an explicit "Analyse" / "Re-analyse" click may call AI, and only
 * via the EXISTING interview_profile request type.
 *
 * App() is a React closure that can't be invoked directly, so the wiring
 * checks are STRUCTURAL (same convention as the rest of the suite);
 * the date maths is exercised behaviourally in applicationSchedule.test.js.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function slice(startMarker, endMarker) {
  const s = SOURCE.indexOf(startMarker);
  if (s === -1) throw new Error(`marker not found in App.jsx: ${startMarker}`);
  const e = SOURCE.indexOf(endMarker, s + startMarker.length);
  if (e === -1) throw new Error(`end marker not found in App.jsx: ${endMarker}`);
  return SOURCE.slice(s, e);
}

const SAVE_FORM_SRC = slice("async function saveApplicationForm() {", "// EXPLICIT, user-triggered Application Intelligence analysis.");
const ANALYSE_ONLY_SRC = slice("async function analyseApplicationOnly(app) {", "function buildInterviewFromApplication(");
const BUILD_IV_SRC = slice("function buildInterviewFromApplication(app) {", "/* ---------------- PHASE 7: INTERVIEW INVITATION SCANNER");
const OPEN_HELPERS_SRC = slice("/* ---------------- PHASE 16A: APPLICATIONS PILLAR ---------------- */", "async function saveApplicationForm() {");
const APP_SCREEN_SRC = slice("{/* ---------------- APPLICATION OVERVIEW (workspace) ---------------- */}", "{/* ---------------- CREATE (progressive wizard) ---------------- */}");
const LIST_SCREEN_SRC = slice("{/* ---------------- APPLICATIONS LIST ---------------- */}", "{/* ---------------- ADD / EDIT APPLICATION (no AI) ---------------- */}");
const FORM_SCREEN_SRC = slice("{/* ---------------- ADD / EDIT APPLICATION (no AI) ---------------- */}", "{/* ---------------- APPLICATION OVERVIEW (workspace) ---------------- */}");

/* ============================== navigation ============================== */
describe("Applications is a top-level destination, existing sections untouched", () => {
  it("NavBar exposes an 'Applications' link, and does NOT rename Dashboard / Classroom", () => {
    const nav = slice("const links = user", "return (");
    expect(nav).toMatch(/\{ label: "Applications", to: "applications" \}/);
    expect(nav).toMatch(/\{ label: "Dashboard", to: "dashboard" \}/);
    expect(nav).toMatch(/\{ label: "Classroom", to: "classroom" \}/);
  });
  it("showNav renders the chrome for the new screens (but NOT the full-screen analyse loader)", () => {
    const showNav = slice("const showNav = [", "].includes(screen);");
    expect(showNav).toMatch(/"applications"/);
    expect(showNav).toMatch(/"application"/);
    expect(showNav).toMatch(/"application_form"/);
    expect(showNav).not.toMatch(/"application_analyzing"/);
  });
});

/* ============================== create / edit = ZERO AI ============================== */
describe("Creating an Application and editing its date never calls AI", () => {
  it("saveApplicationForm does no AI and no analysis work — persistence only", () => {
    expect(SAVE_FORM_SRC).not.toMatch(/callClaude|buildApplicationIntelligence|buildJdProfile|validateProfile/);
  });
  it("create -> dbCreateApplication, edit -> dbUpdateApplication, both pass interview_date through", () => {
    expect(SAVE_FORM_SRC).toMatch(/dbCreateApplication\(user\.id, \{[^}]*interview_date: dateIso/s);
    expect(SAVE_FORM_SRC).toMatch(/dbUpdateApplication\(f\.id, \{[^}]*interview_date: dateIso/s);
  });
  it("company + role are required before anything is written", () => {
    expect(SAVE_FORM_SRC).toMatch(/if \(!company \|\| !role\) \{ setError/);
  });
  it("the interview date is optional and nullable (empty -> null, never a fabricated value)", () => {
    expect(SAVE_FORM_SRC).toMatch(/const dateIso = f\.date \? `\$\{f\.date\}T12:00:00Z` : null;/);
  });
  it("a required edit write is checked for failure and surfaced, not silently dropped", () => {
    expect(SAVE_FORM_SRC).toMatch(/if \(r && r\.ok === false\) \{ setError/);
  });
  it("the add/edit form screen shows the intentional helper text verbatim", () => {
    expect(FORM_SCREEN_SRC).toContain("Include as much detail as possible about the company, role and requirements. This helps JOB.READY personalise your interview questions and development recommendations.");
  });
  it("the add/edit form screen has an optional date input and states there are no reminders", () => {
    expect(FORM_SCREEN_SRC).toMatch(/type="date"/);
    expect(FORM_SCREEN_SRC).toMatch(/\(optional\)/);
    expect(FORM_SCREEN_SRC).toMatch(/does not send reminders/);
  });
});

/* ============================== opening screens = ZERO AI ============================== */
describe("Opening the list / an application makes no AI call", () => {
  it("openApplicationsList / openApplication / openApplicationForm are pure screen switches", () => {
    expect(OPEN_HELPERS_SRC).not.toMatch(/callClaude/);
    expect(OPEN_HELPERS_SRC).toMatch(/function openApplication\(app\) \{[^}]*setScreen\("application"\)/s);
  });
  it("the Application overview screen never calls AI on render — it only reads app.applicationIntelligence", () => {
    // the ONLY AI entry point on this screen is an explicit onClick -> analyseApplicationOnly
    expect(APP_SCREEN_SRC).not.toMatch(/callClaude/);
    const analyseClicks = APP_SCREEN_SRC.match(/analyseApplicationOnly\(app\)/g) || [];
    expect(analyseClicks.length).toBeGreaterThan(0);
    APP_SCREEN_SRC.split("analyseApplicationOnly(app)").slice(0, -1).forEach((before) => {
      expect(before.endsWith("guarded(() => ")).toBe(true); // always behind an explicit guarded onClick
    });
  });
});

/* ============================== analyse lifecycle ============================== */
describe("Explicit analysis reuses the existing pipeline and persists for reuse", () => {
  it("analyseApplicationOnly makes exactly one callClaude, of the EXISTING interview_profile type", () => {
    expect((ANALYSE_ONLY_SRC.match(/await callClaude\(/g) || []).length).toBe(1);
    expect(ANALYSE_ONLY_SRC).toMatch(/requestType: "interview_profile", applicationId: app\.id/);
  });
  it("it reuses the hoisted INTERVIEW_PROFILE_SYSTEM prompt — not a parallel prompt", () => {
    expect(ANALYSE_ONLY_SRC).toMatch(/callClaude\(INTERVIEW_PROFILE_SYSTEM,/);
    expect(SOURCE).toMatch(/const INTERVIEW_PROFILE_SYSTEM = `You are an expert interview coach/);
    // and analyseAndPlan uses the same const rather than an inline copy
    expect(slice("async function analyseAndPlan() {", "function beginInterview()")).toMatch(/const system = INTERVIEW_PROFILE_SYSTEM;/);
  });
  it("it reuses buildApplicationIntelligence + buildJdProfile (shared systems)", () => {
    expect(ANALYSE_ONLY_SRC).toMatch(/buildApplicationIntelligence\(\{/);
    expect(ANALYSE_ONLY_SRC).toMatch(/buildJdProfile\(/);
  });
  it("it persists jd_profile_hash + application_intelligence so a reopen reuses them (0 AI)", () => {
    expect(ANALYSE_ONLY_SRC).toMatch(/dbUpdateApplication\(app\.id, \{[\s\S]*jd_profile_hash: hashText\(cleanJd\)[\s\S]*application_intelligence: applicationIntelligence/);
  });
  it("a failed required persist is surfaced and NOT silently treated as success", () => {
    expect(ANALYSE_ONLY_SRC).toMatch(/if \(!upd \|\| upd\.ok === false\) \{/);
    expect(ANALYSE_ONLY_SRC).toMatch(/won't be re-charged/i);
  });
  it("creating / editing an Application does NOT itself invalidate or regenerate — staleness is DETECTED on the overview via the existing hash logic", () => {
    expect(SAVE_FORM_SRC).not.toMatch(/application_intelligence|jd_profile_hash/);
    expect(APP_SCREEN_SRC).toMatch(/applicationIntelligenceIsStale\(intel, hashApplicationSources\(\{ company: app\.company, role: app\.role, jdText: app\.jobDescription/);
  });
  it("the overview only offers 'Analyse' when there is no intelligence, and 'Re-analyse' only when stale — never regenerates silently on reopen", () => {
    expect(APP_SCREEN_SRC).toMatch(/\{!intel && jdLen >= 40 && \(/);          // State B: Analyse
    expect(APP_SCREEN_SRC).toMatch(/Analyse this application/);
    expect(APP_SCREEN_SRC).toMatch(/\{intel && stale && \(/);                  // State D: Re-analyse
    expect(APP_SCREEN_SRC).toMatch(/Re-analyse application/);
    expect(APP_SCREEN_SRC).toMatch(/Your application details have changed\./);
  });
});

/* ============================== preparation uses the existing engine, not a new one ============================== */
describe("Your Preparation is the existing Application Intelligence + priority architecture", () => {
  it("the overview builds recommendations via classroomRecommendationGroups (the shared regroup), not a bespoke ranker", () => {
    expect(APP_SCREEN_SRC).toMatch(/classroomRecommendationGroups\(intel, globalCandidateState, \{ limit: 9 \}\)/);
    expect(APP_SCREEN_SRC).not.toMatch(/applicationDevelopmentPriorities\(/); // goes through the wrapper, same as Classroom
  });
  it("'Continue preparing' is pickContinuePreparing scoped to THIS application's own topics/modules", () => {
    expect(APP_SCREEN_SRC).toMatch(/pickContinuePreparing\(\{ developmentModules: appModules, moduleProgress: appProgress, classroomTopics: appTopics, applications: \[app\]/);
    expect(APP_SCREEN_SRC).toMatch(/classroom\.filter\(\(t\) => t\.applicationId === app\.id\)/);
  });
  it("a preparation recommendation is NEVER labelled a weakness", () => {
    const prep = slice("{/* (B) Recommended preparation", "{/* (C) From your interviews");
    expect(prep).toContain("not a demonstrated weakness");
    expect(prep).not.toMatch(/weak at|weakness detected|you are weak/i);
    expect(prep).toMatch(/Important to prepare for this role\./);
  });
  it("'From your interviews' is kept semantically distinct — demonstrated evidence only", () => {
    // preparation vs demonstrated is the SAME split the engine already makes:
    // `tested` true  -> real interview evidence -> "From your interviews"
    // `tested` false -> no evidence yet        -> "Prepare for this application"
    expect(APP_SCREEN_SRC).toMatch(/const interviewRecs = recs\.all\.filter\(\(r\) => r\.tested\)/);
    expect(APP_SCREEN_SRC).toMatch(/const preparationRecs = recs\.all\.filter\(\(r\) => !r\.tested\)/);
    const dem = slice("{/* (C) From your interviews", "{!appContinue && !recs.hasAny");
    expect(dem).toMatch(/Based on your interview performance\./);
    expect(dem).toMatch(/Develop this area/);
    expect(dem).not.toMatch(/not a demonstrated weakness/); // that line belongs to the preparation block only
  });
  it("recommendation -> Development Module reuses the Phase 14.1 path (match ? open : startLearningFromRecommendation)", () => {
    expect(APP_SCREEN_SRC).toMatch(/match \? openDevelopmentModule\(match\) : startLearningFromRecommendation\(r, app\)/);
    // no duplicated module generation / flashcard / quiz code on this screen
    expect(APP_SCREEN_SRC).not.toMatch(/callClaude|dbInsertDevelopmentModule|learning_items/);
  });
  it("cross-application isolation: a topic belonging to another application is never reused", () => {
    expect(APP_SCREEN_SRC).toMatch(/if \(t\.applicationId && t\.applicationId !== app\.id\) return false;/);
  });
});

/* ============================== interviews from an application ============================== */
describe("Building an interview from an Application carries context but NOT the question mix", () => {
  it("carries application id / company / role / JD so the user doesn't re-enter them", () => {
    expect(BUILD_IV_SRC).toMatch(/setApplicationId\(app\.id\)/);
    expect(BUILD_IV_SRC).toMatch(/setCompany\(app\.company \|\| ""\)/);
    expect(BUILD_IV_SRC).toMatch(/setRole\(app\.role \|\| ""\)/);
    expect(BUILD_IV_SRC).toMatch(/setJdText\(app\.jobDescription \|\| ""\)/);
  });
  it("RESETS the Question Mix to all-false — it stays a manual choice at wizard step 4", () => {
    expect(BUILD_IV_SRC).toMatch(/setQuestionMix\(\{ technical: false, behavioural: false, motivational: false \}\)/);
  });
  it("makes no AI call itself — it only pre-fills the existing wizard", () => {
    expect(BUILD_IV_SRC).not.toMatch(/callClaude/);
    expect(BUILD_IV_SRC).toMatch(/setScreen\("create"\)/);
  });
  it("the overview lists only this application's interviews and offers a context-carrying '+ Build interview'", () => {
    expect(APP_SCREEN_SRC).toMatch(/const appInterviews = app\.interviews \|\| \[\]/);
    expect(APP_SCREEN_SRC).toMatch(/buildInterviewFromApplication\(app\)/);
  });
});

/* ============================== application details + progress ============================== */
describe("Application Details + lightweight Progress use only real data", () => {
  it("Details edits go through the SAME persistence (openApplicationForm -> saveApplicationForm), no second model", () => {
    expect(APP_SCREEN_SRC).toMatch(/Edit application details/);
    expect(APP_SCREEN_SRC).toMatch(/onClick=\{\(\) => openApplicationForm\(app\)\}/);
  });
  it("Progress is three counts derived from persisted rows — no invented scores or analytics", () => {
    expect(APP_SCREEN_SRC).toMatch(/interviewsCompleted: appInterviews\.filter/);
    expect(APP_SCREEN_SRC).toMatch(/areasStarted: appTopics\.length/);
    expect(APP_SCREEN_SRC).toMatch(/modulesCompleted: appProgress\.filter\(\(p\) => num\(p\.best_coverage, 0\) >= 0\.85\)/);
    expect(APP_SCREEN_SRC).toMatch(/Interviews completed/);
    expect(APP_SCREEN_SRC).toMatch(/Development areas started/);
    expect(APP_SCREEN_SRC).toMatch(/Modules completed/);
  });
});

/* ============================== ordering + countdown wiring ============================== */
describe("Ordering + countdown come from applicationSchedule.js, past dates are not 'upcoming'", () => {
  it("the list screen partitions with partitionApplications and shows an explicit-text countdown", () => {
    expect(SOURCE).toMatch(/const \{ upcoming: applicationsUpcoming, other: applicationsOther \} = partitionApplications\(applicationsWithInterviews\)/);
    expect(LIST_SCREEN_SRC).toMatch(/interviewCountdown\(app\.interviewDate\)/);
    expect(LIST_SCREEN_SRC).toMatch(/\{cd\.label\}/);
    expect(LIST_SCREEN_SRC).toMatch(/Upcoming interviews/);
    expect(LIST_SCREEN_SRC).toMatch(/Other applications/);
  });
  it("the client maps applications[].interviewDate off the existing (previously unused) column — no migration", () => {
    expect(SOURCE).toMatch(/interviewDate: a\.interview_date \|\| null,/);
    // nothing in this phase adds a migration for it
    expect(SOURCE).not.toMatch(/ALTER TABLE applications ADD COLUMN interview_date/i);
  });
});

/* ============================== legacy / null safety ============================== */
describe("Legacy + null-safe: nothing crashes without intelligence, interviews, or a date", () => {
  it("the overview tolerates a missing application row", () => {
    expect(APP_SCREEN_SRC).toMatch(/const app = applicationsWithInterviews\.find\(\(a\) => a\.id === appView\)/);
    expect(APP_SCREEN_SRC).toMatch(/if \(!app\) \{/);
  });
  it("staleness + scoped pick are wrapped so a malformed blob can't throw the render", () => {
    expect(APP_SCREEN_SRC).toMatch(/try \{\s*stale = !!intel && applicationIntelligenceIsStale/);
    expect(APP_SCREEN_SRC).toMatch(/catch \(e\) \{ stale = false; \}/);
    expect(APP_SCREEN_SRC).toMatch(/try \{\s*appContinue = pickContinuePreparing/);
  });
  it("State A covers a legacy / thin application (no intelligence, < 40 chars of JD)", () => {
    expect(APP_SCREEN_SRC).toMatch(/\{!intel && jdLen < 40 && \(/);
    expect(APP_SCREEN_SRC).toContain("Add more information about the role and requirements to help JOB.READY personalise your preparation.");
  });
  it("clearAllUserState resets the Applications-pillar view state on sign-out", () => {
    const clear = slice("setDevelopmentModules([]); setModuleProgress([]); setPendingReportSave(null); setPendingModuleSave(null);", "// Phase 7: same ownership-hygiene");
    expect(clear).toMatch(/setAppView\(null\); setAppForm\(null\);/);
  });
});
