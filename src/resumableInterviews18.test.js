/* ================================================================== *
 * PHASE 18 — RESUMABLE IN-PROGRESS INTERVIEWS (App.jsx wiring)
 * ------------------------------------------------------------------
 * Behavioural coverage of the reconstruction maths lives in
 * resumeInterview.test.js. This file is STRUCTURAL — App() is a React
 * closure — and asserts the wiring guarantees:
 *   - resuming makes ZERO AI calls (no callClaude / ai-generate / question
 *     or profile regeneration in the resume path)
 *   - the persistence change is config.profile + config.max_questions on the
 *     EXISTING interviews.config jsonb — NO migration
 *   - startup loads unfinished interviews as METADATA ONLY (no eager
 *     transcript reconstruction; count queries guarded by "any exist")
 *   - Dashboard + Application surfaces expose Continue; cross-application
 *     isolation holds
 *   - duplicate generation is intercepted with a Continue / Start New choice
 *     that never deletes or overwrites the existing interview
 *   - completed interviews still load exactly as before
 *   - legacy rows with no persisted profile are surfaced honestly, never
 *     crash, never falsely offered a Continue button
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
function slice(a, b) {
  const s = SRC.indexOf(a);
  if (s === -1) throw new Error(`start marker not found: ${a}`);
  const e = SRC.indexOf(b, s + a.length);
  if (e === -1) throw new Error(`end marker not found: ${b}`);
  return SRC.slice(s, e);
}
// strip block + line comments so a "no callClaude" assertion isn't tripped by prose
function codeOnly(s) { return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); }

const RESUME_FN = slice("async function resumeInterviewById(interviewId) {", "/* ---------------- PHASE 7: INTERVIEW INVITATION SCANNER");
const RESUME_CODE = codeOnly(RESUME_FN);
const ANALYSE = slice("async function analyseAndPlan() {", "function beginInterview()");
const LOAD_STATE = slice("async function loadFullUserState(userId) {", "async function dbCreateApplication(");

/* ===================== persistence change — no migration ===================== */
describe("persistence: everything needed to reconstruct is written to the existing config jsonb", () => {
  it("analyseAndPlan persists the profile + completion target onto ivConfig before dbCreateInterview", () => {
    expect(ANALYSE).toMatch(/ivConfig\.profile = \{\s*[\s\S]*?interview_profile: result\.interview_profile,\s*[\s\S]*?candidate_profile: result\.candidate_profile,\s*[\s\S]*?opening_question: result\.opening_question,\s*\}/);
    expect(ANALYSE).toMatch(/ivConfig\.max_questions = length;/);
    // and it is written via the SAME existing dbCreateInterview(config) path
    const idxProfile = ANALYSE.indexOf("ivConfig.profile =");
    const idxCreate = ANALYSE.indexOf("dbCreateInterview(user.id, applicationId, ivConfig");
    expect(idxProfile).toBeGreaterThan(-1);
    expect(idxCreate).toBeGreaterThan(idxProfile);
  });
  it("still exactly the two pre-Phase-18 migration files — NO migration added", () => {
    const files = readdirSync(new URL("../supabase/migrations", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
    expect(files).toEqual(["20260828120000_baseline_schema.sql", "20260828135856_development_modules.sql"]);
  });
});

/* ===================== resume = zero AI ===================== */
describe("resuming an interview makes ZERO AI calls", () => {
  it("resumeInterviewById contains no callClaude / ai-generate / question or profile generation", () => {
    expect(RESUME_CODE).not.toMatch(/callClaude|ai-generate|functions\.invoke/);
    expect(RESUME_CODE).not.toMatch(/generateAndPersistNextQuestion|generateQuestionBatch|generateBatchEvaluation\(|dbInsertQuestion\(|dbInsertQuestionBatch\(/);
    expect(RESUME_CODE).not.toMatch(/INTERVIEW_PROFILE_SYSTEM|validateProfile\(|buildApplicationIntelligence\(/);
  });
  it("it reconstructs deterministically from persisted rows via the pure layer", () => {
    expect(RESUME_CODE).toMatch(/reconstructInterviewState\(\{ interviewRow: row, questions, meta \}\)/);
    expect(RESUME_CODE).toMatch(/setProfile\(recon\.profile\)/);
    expect(RESUME_CODE).toMatch(/setInterview\(iv\)/);
    expect(RESUME_CODE).toMatch(/setScreen\(recon\.screen\)/);
  });
  it("the full transcript read happens HERE (on Continue), not at startup", () => {
    expect(RESUME_CODE).toMatch(/from\("interview_questions"\)[\s\S]*?answers\(id, answer_text, time_expired, evaluations\(/);
    expect(RESUME_CODE).toMatch(/\.eq\("interview_id", interviewId\)/);
  });
  it("a not-resumable result is surfaced as a message, never a crash, never a false promise", () => {
    expect(RESUME_CODE).toMatch(/if \(!recon\.resumable\) \{/);
    expect(RESUME_FN).toMatch(/saved before resume support/);
  });
  it("needsFinish routes to the EXISTING completion path (finishing != resuming)", () => {
    expect(RESUME_CODE).toMatch(/if \(recon\.needsFinish\) \{[\s\S]*?finishAsyncInterview\(iv\)[\s\S]*?finishInterview\(iv\)/);
  });
  it("double-click Continue is single-flighted", () => {
    expect(RESUME_CODE).toMatch(/if \(!interviewId \|\| !user \|\| resumeRef\.current\) return;\s*\n?\s*resumeRef\.current = true;/);
    expect(RESUME_CODE).toMatch(/finally \{\s*\n?\s*resumeRef\.current = false;/);
  });
});

/* ===================== startup load — metadata only ===================== */
describe("startup loads unfinished interviews as metadata only (no eager reconstruction)", () => {
  it("loadFullUserState adds one in_progress query alongside the existing completed one", () => {
    expect(LOAD_STATE).toMatch(/dbSelect\("interviews", \(q\) => q\.eq\("user_id", userId\)\.eq\("status", "completed"\)/);
    expect(LOAD_STATE).toMatch(/dbSelect\("interviews", \(q\) => q\.eq\("user_id", userId\)\.eq\("status", "in_progress"\)/);
  });
  it("the per-interview counts are two BULK reads (ids + question_number only), guarded by 'any exist', never N+1", () => {
    expect(LOAD_STATE).toMatch(/if \(Array\.isArray\(inProgressRaw\) && inProgressRaw\.length\) \{/);
    expect(LOAD_STATE).toMatch(/from\("interview_questions"\)\.select\("id, interview_id, question_number"\)\.in\("interview_id", ipIds\)/);
    expect(LOAD_STATE).toMatch(/from\("answers"\)\.select\("question_id"\)\.in\("question_id", qIds\)/);
    // no transcript / answer_text / evaluation load at startup
    expect(LOAD_STATE).not.toMatch(/answer_text[\s\S]{0,120}in\("interview_id"/);
    expect(LOAD_STATE).not.toMatch(/reconstructInterviewState/);
  });
  it("it returns resumableInterviews built by the pure summariser", () => {
    expect(LOAD_STATE).toMatch(/summariseResumable\(row, countsByIv\.get\(row\.id\) \|\| \{ total: 0, answered: 0 \}, apps\.find/);
    expect(LOAD_STATE).toMatch(/resumableInterviews,\s*\};/);
  });
  it("onAuthed / clearAllUserState keep the resume state in sync", () => {
    expect(SRC).toMatch(/setResumableInterviews\(state\.resumableInterviews \|\| \[\]\)/);
    expect(SRC).toMatch(/setResumableInterviews\(\[\]\); setResumeChoice\(null\)/);
  });
});

/* ===================== Dashboard surface ===================== */
describe("Dashboard surfaces an unfinished interview clearly", () => {
  const DASH = slice('screen === "dashboard" && user && (', 'PHASE 16A — APPLICATIONS PILLAR');
  it("shows a 'Continue your interview' card with company/role and progress, above 'Continue preparing'", () => {
    expect(DASH).toMatch(/Continue your interview/);
    expect(DASH).toMatch(/\{r\.answeredCount\} of \{r\.totalQuestions \|\| "\?"\} question/);
    expect(DASH.indexOf("Continue your interview")).toBeLessThan(DASH.indexOf("{continuePreparing &&"));
  });
  it("Continue calls resumeInterviewById (deterministic, 0 AI); the card is driven by the sorted, profile-backed list", () => {
    expect(DASH).toMatch(/onClick=\{\(\) => guarded\(\(\) => resumeInterviewById\(r\.id\)\)\}/);
    expect(SRC).toMatch(/const resumableReady = sortResumableInterviews\(resumableInterviews\.filter\(\(r\) => r\.hasProfile\)\)/);
  });
  it("legacy rows (no persisted profile) are shown honestly with NO Continue button", () => {
    expect(SRC).toMatch(/const resumableLegacy = resumableInterviews\.filter\(\(r\) => !r\.hasProfile\)/);
    expect(DASH).toMatch(/couldn't be saved for resuming/);
  });
});

/* ===================== Application page surface + isolation ===================== */
describe("Application overview surfaces ITS OWN unfinished interview only", () => {
  const APPSCREEN = slice("{/* ---------------- APPLICATION OVERVIEW (workspace) ---------------- */}", "{/* ---------------- PHASE 18: RESUME-OR-START-NEW CHOICE ---------------- */}");
  it("filters the resumable list by this application's id — no cross-application leak", () => {
    expect(APPSCREEN).toMatch(/resumableInterviews\.filter\(\(r\) => r\.applicationId === app\.id\)\.map\(/);
    expect(APPSCREEN).toMatch(/Interview in progress/);
    expect(APPSCREEN).toMatch(/resumeInterviewById\(r\.id\)/);
  });
  it("a legacy (no-profile) in-progress interview on the application page is not offered Continue", () => {
    expect(APPSCREEN).toMatch(/r\.hasProfile \? \(\s*\n?\s*<Btn[\s\S]*?resumeInterviewById\(r\.id\)[\s\S]*?\) : \(/);
  });
});

/* ===================== duplicate-generation protection ===================== */
describe("duplicate generation is intercepted, non-destructively", () => {
  it("analyseAndPlan checks for an existing resumable interview for this application BEFORE any AI call", () => {
    const head = ANALYSE.slice(0, ANALYSE.indexOf("const cleanCompany = sanitizeText(company)"));
    expect(head).toMatch(/if \(!forceNewRef\.current\) \{[\s\S]*?resumableInterviews\.find\(\(r\) => r\.applicationId === applicationId && r\.hasProfile\)[\s\S]*?setResumeChoice\(existing\); setScreen\("resume_choice"\); return;/);
    expect(head).toMatch(/forceNewRef\.current = false;/);
    // the check sits before the AI call
    expect(ANALYSE.indexOf("setResumeChoice(existing)")).toBeLessThan(ANALYSE.indexOf("await callClaude("));
  });
  it("the resume_choice screen offers Continue (primary) and Start New (secondary)", () => {
    const CHOICE = slice('screen === "resume_choice" && resumeChoice && (', "{/* ---------------- CREATE (progressive wizard) ---------------- */}");
    expect(CHOICE).toMatch(/You have an interview in progress/);
    expect(CHOICE).toMatch(/resumeInterviewById\(resumeChoice\.id\)/);
    expect(CHOICE).toMatch(/forceNewRef\.current = true; setResumeChoice\(null\); guarded\(analyseAndPlan\)/);
  });
  it("Start New never deletes / overwrites / mutates the existing interview (no such calls in the choice screen or the bypass)", () => {
    const CHOICE = slice('screen === "resume_choice" && resumeChoice && (', "{/* ---------------- CREATE (progressive wizard) ---------------- */}");
    expect(codeOnly(CHOICE)).not.toMatch(/\.delete\(\)|\.update\(\{[\s\S]*?status|dbDelete|removeInterview/);
  });
  it("showNav includes resume_choice so the user can always back out", () => {
    expect(SRC).toMatch(/"create_choose", "resume_choice"/);
  });
});

/* ===================== completed-interview regression ===================== */
describe("completed interviews are unaffected", () => {
  it("interviewList is still built ONLY from status='completed' interviews", () => {
    expect(LOAD_STATE).toMatch(/\.eq\("status", "completed"\)\.order\("completed_at"/);
  });
  it("finishing an interview removes it from the resumable set (card stops offering it)", () => {
    expect(SRC).toMatch(/setResumableInterviews\(\(prev\) => prev\.filter\(\(r\) => r\.id !== finalInterview\.id\)\)/);
  });
  it("the report / results / retry path (dbCompleteInterview, pendingReportSave) is untouched by Phase 18", () => {
    const FIN = slice("async function finishInterview(finalInterview) {", "async function submitAsyncAnswer(");
    expect(FIN).toMatch(/dbCompleteInterview\(finalInterview\.id, result\)/);
    expect(FIN).toMatch(/setPendingReportSave\(\{ interviewId: finalInterview\.id, result \}\)/);
  });
});

/* ===================== Phase 16B performance guarantees hold ===================== */
describe("Phase 16B performance constraints do not regress", () => {
  it("startup does NOT eagerly reconstruct every unfinished interview", () => {
    expect(LOAD_STATE).not.toMatch(/reconstructInterviewState/);
  });
  it("existing Development Module reopen is still state-first (Phase 16B fast path intact)", () => {
    const OPEN_MODULE = slice("async function openDevelopmentModule(topic) {", "// ---- deterministic sub-activities");
    expect(OPEN_MODULE).toMatch(/const cachedRow = developmentModules\.find\(\(m\) => m\.topic_id === topic\.id\)/);
    expect(OPEN_MODULE.indexOf("developmentModules.find")).toBeLessThan(OPEN_MODULE.indexOf("await dbGetDevelopmentModule(topic.id)"));
  });
  it("no fake-progress timer is introduced by the resume path", () => {
    expect(RESUME_CODE).not.toMatch(/setTimeout\(|setInterval\(/);
  });
});
