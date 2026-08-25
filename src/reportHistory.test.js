/* ================================================================== *
 * PHASE 3 — INTERVIEW / ASSESSMENT CENTRE HISTORY TEST SUITE
 * ------------------------------------------------------------------
 * Covers the Phase 3 fix: interview_reports and assessment_attempts rows
 * were already being fetched in full by loadFullUserState, but only a
 * reduced summary (breakdown / overall_score) ever survived into
 * interviewList/acAttempts — the rest was read from the DB and silently
 * discarded, so a candidate could never revisit a past interview's full
 * report or a past Assessment Centre attempt's scorecard after leaving
 * it once. This suite checks (STRUCTURAL — same source-text-inspection
 * convention as reportUX.test.js/liveWiring.test.js, since App() is a
 * React closure that can't be invoked directly in a unit test):
 *
 *   (1) the full report/attempt rows now survive into React state,
 *   (2) opening a past report/attempt never issues a new DB read or a
 *       new AI call — both are pure reads of already-hydrated state,
 *   (3) the live and historical screens render from the SAME extracted
 *       body component (ReportBody / AcScorecardBody), so they can never
 *       silently drift into two different report layouts,
 *   (4) the new screens are wired into navigation/sign-out cleanup.
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
describe("loadFullUserState keeps the full, already-fetched report/attempt data (STRUCTURAL)", () => {
  const LOAD_SRC = extractFunctionSource("async function loadFullUserState(userId) {", "async function dbCreateApplication");

  it("interviewList carries the full interview_reports row, not just breakdown", () => {
    expect(LOAD_SRC).toMatch(/report:\s*reportsByInterview\.get\(iv\.id\)\s*\|\|\s*null/);
  });

  it("never issues a second query to get that report — reuses the SAME reportsByInterview map breakdown already reads from", () => {
    // Only one .from("interview_reports") call should exist in this function.
    const matches = LOAD_SRC.match(/\.from\("interview_reports"\)/g) || [];
    expect(matches.length).toBe(1);
  });

  it("memoryLog carries interview_id (as interviewId) so a past report can find its own comparisons client-side", () => {
    expect(LOAD_SRC).toMatch(/interviewId:\s*c\.interview_id\s*\|\|\s*null/);
  });

  it("acAttempts carries scenario/submission/result, not just the scored summary", () => {
    expect(LOAD_SRC).toMatch(/scenario:\s*a\.scenario\s*\|\|\s*null/);
    expect(LOAD_SRC).toMatch(/submission:\s*a\.submission\s*\|\|\s*""/);
    expect(LOAD_SRC).toMatch(/result:\s*a\.result\s*\|\|\s*null/);
  });

  it("never issues a second query for assessment_attempts either", () => {
    const matches = LOAD_SRC.match(/\.from\("assessment_attempts"\)/g) || [];
    expect(matches.length).toBe(0); // this table is read via dbSelect(), not a literal .from() in this function
    expect(LOAD_SRC).toMatch(/dbSelect\("assessment_attempts"/);
  });
});

/* ============================== same-session availability (STRUCTURAL) ============================== *
 * A history entry that only carries its full data after the NEXT reload (rather than right
 * when it's created) is a dead click hiding in plain sight: it appears in the Dashboard/
 * Progress/Assessment-Centre list immediately, but opening it does nothing until a reload
 * re-fetches it from the DB. These checks pin the fix in place.
 */
describe("a just-finished interview's summary is openable in the SAME session, before any reload (STRUCTURAL)", () => {
  it("finishInterview's in-memory summary carries the full report, not just the score/breakdown", () => {
    const FINISH_SRC = extractFunctionSource("async function finishInterview(finalInterview) {", "async function submitAsyncAnswer");
    expect(FINISH_SRC).toMatch(/const summary = \{[^}]*report: result[^}]*\};/);
  });
});

describe("a just-submitted Assessment Centre attempt is openable in the SAME session, before any reload (STRUCTURAL)", () => {
  it("submitAcResponse's in-memory attempt carries scenario/submission/result, not just the score/breakdown", () => {
    const SUBMIT_SRC = extractFunctionSource("async function submitAcResponse() {", "/* ---------------- DERIVED VALUES");
    expect(SUBMIT_SRC).toMatch(/const attempt = \{[^}]*scenario: acScenario, submission: clean, result[^}]*\};/);
  });
});

/* ============================== openInterviewReport / openAcAttempt (STRUCTURAL) ============================== */
describe("openInterviewReport (STRUCTURAL)", () => {
  const FN_SRC = extractFunctionSource("function openInterviewReport(iv, backScreen) {", "/* ---------------- ASSESSMENT CENTRE");

  it("guards on a missing report — never opens a history view with nothing to show", () => {
    expect(FN_SRC).toMatch(/if \(!iv\?\.report\) return;/);
  });

  it("never issues an AI call or a new DB read — pure read of already-hydrated state", () => {
    expect(FN_SRC).not.toMatch(/callClaude|getSupabase|\.from\(/);
  });

  it("routes to the dedicated report_view screen, remembering where to go back to", () => {
    expect(FN_SRC).toMatch(/setScreen\("report_view"\)/);
    expect(FN_SRC).toMatch(/setHistoryBackScreen\(backScreen\)/);
  });

  it("derives comparisons from the already-loaded memoryLog, filtered by this interview's id", () => {
    expect(FN_SRC).toMatch(/memoryLog\.filter\(\(m\) => m\.interviewId === iv\.id\)/);
  });
});

describe("openAcAttempt (STRUCTURAL)", () => {
  const FN_SRC = extractFunctionSource("function openAcAttempt(attempt, backScreen) {", "async function generateAcScenario(type)");

  it("guards on a missing result — never opens a history view with nothing to show", () => {
    expect(FN_SRC).toMatch(/if \(!attempt\?\.result\) return;/);
  });

  it("never issues an AI call or a new DB read — pure read of already-hydrated state", () => {
    expect(FN_SRC).not.toMatch(/callClaude|getSupabase|\.from\(/);
  });

  it("routes to the dedicated ac_attempt_view screen, remembering where to go back to", () => {
    expect(FN_SRC).toMatch(/setScreen\("ac_attempt_view"\)/);
    expect(FN_SRC).toMatch(/setHistoryBackScreen\(backScreen\)/);
  });
});

/* ============================== shared render bodies (STRUCTURAL) ============================== */
describe("live and historical screens render from the SAME body component — never a second layout (STRUCTURAL)", () => {
  it("the just-finished report screen and the past-report screen both render <ReportBody", () => {
    const liveScreen = extractFunctionSource('screen === "report" && report && (', 'screen === "report_view" && viewedReport && (');
    const historyScreen = extractFunctionSource('screen === "report_view" && viewedReport && (', '{/* ---------------- PROGRESS');
    expect(liveScreen).toMatch(/<ReportBody/);
    expect(historyScreen).toMatch(/<ReportBody/);
  });

  it("the just-finished AC scorecard and the past-attempt screen both render <AcScorecardBody", () => {
    const liveScreen = extractFunctionSource('screen === "ac_scorecard" && acResult && (', 'screen === "ac_attempt_view" && viewedAcAttempt && (');
    const historyScreen = extractFunctionSource('screen === "ac_attempt_view" && viewedAcAttempt && (', "export default function AppRoot");
    expect(liveScreen).toMatch(/<AcScorecardBody/);
    expect(historyScreen).toMatch(/<AcScorecardBody/);
  });

  it("a historical report never claims to show claims tested this interview — that linkage was never persisted", () => {
    const historyScreen = extractFunctionSource('screen === "report_view" && viewedReport && (', '{/* ---------------- PROGRESS');
    expect(historyScreen).not.toMatch(/claimsTested=/);
  });
});

/* ============================== navigation wiring (STRUCTURAL) ============================== */
describe("dashboard/progress/ac_home wire clicks to the history views (STRUCTURAL)", () => {
  it("dashboard's Recent interviews cards open the report view — only marked interactive when there's a report to show", () => {
    const dashboardSrc = extractFunctionSource('screen === "dashboard" && user && (', '{/* ---------------- CREATE');
    expect(dashboardSrc).toMatch(/onClick=\{iv\.report \? \(\) => openInterviewReport\(iv, "dashboard"\) : undefined\}/);
  });

  it("progress's Score-over-time bars open the report view", () => {
    const progressSrc = extractFunctionSource('screen === "progress" && (', '{/* ---------------- CLASSROOM DASHBOARD');
    expect(progressSrc).toMatch(/onClick=\{\(\) => openInterviewReport\(iv, "progress"\)\}/);
  });

  it("ac_home's Recent attempts list opens the attempt view", () => {
    const acHomeSrc = extractFunctionSource('screen === "ac_home" && (', 'screen === "ac_generating"');
    expect(acHomeSrc).toMatch(/onClick=\{\(\) => openAcAttempt\(a, "ac_home"\)\}/);
  });
});

describe("navigation/sign-out hygiene (STRUCTURAL)", () => {
  it("showNav includes the two new history screens, same nav treatment as every other post-auth screen", () => {
    const idx = SOURCE.indexOf("const showNav = [");
    const line = SOURCE.slice(idx, SOURCE.indexOf("\n", idx));
    expect(line).toMatch(/"report_view"/);
    expect(line).toMatch(/"ac_attempt_view"/);
  });

  it("clearAllUserState resets the history-view state on sign-out (ownership hygiene)", () => {
    const CLEAR_SRC = extractFunctionSource("function clearAllUserState()", "async function handleSignUp()");
    expect(CLEAR_SRC).toMatch(/setViewedReport\(null\)/);
    expect(CLEAR_SRC).toMatch(/setViewedReportComparisons\(\[\]\)/);
    expect(CLEAR_SRC).toMatch(/setViewedAcAttempt\(null\)/);
  });
});
