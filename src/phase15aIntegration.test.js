/* ================================================================== *
 * PHASE 15A — CRITICAL INTEGRATION FIXES (STRUCTURAL, App.jsx source)
 * ------------------------------------------------------------------
 * Pairs with the behavioural coverage in continuePreparing.test.js and
 * learningLoopE2E.test.js. Verifies the App.jsx wiring for:
 *   1  interview-report hard durability (fail visible, persist-only retry)
 *   2  Development Module hard durability (no fake id:null, persist-only retry)
 *   3  application-scoped classroom-topic dedup
 *   4  the returning-user "Continue preparing" surface
 *   5  the "redo original question" deterministic-marking reframe
 * and that Phase 15A adds ZERO new AI call types / additional AI calls.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const fn = (start, end) => {
  const s = SRC.indexOf(start);
  if (s === -1) throw new Error(`marker not found: ${start}`);
  const e = SRC.indexOf(end, s + start.length);
  if (e === -1) throw new Error(`end marker not found: ${end}`);
  return SRC.slice(s, e);
};

/* ============================== 1. interview report durability ============================== */
describe("interview report is a hard durability boundary", () => {
  // end marker is whatever function immediately follows dbCompleteInterview — kept
  // tight to dbCompleteInterview's own body (dbSaveInterviewProgress, added later
  // for Save & exit, sits between it and dbInsertMemory and DOES throw by design).
  const DBC = fn("async function dbCompleteInterview(interviewId, report)", "async function dbSaveInterviewProgress(");
  const FINISH = fn("async function finishInterview(finalInterview)", "/* ---------------- PHASE 4B");
  const RETRY = fn("async function retrySaveReport()", "async function retrySaveModule()");

  it("dbCompleteInterview is NON-throwing and returns a { ok } result covering BOTH writes", () => {
    expect(DBC).toMatch(/return \{ ok: !updErr && !repErr, updateOk: !updErr, reportOk: !repErr/);
    expect(DBC).not.toMatch(/throw new Error/);
  });
  it("the report write is an idempotent upsert on interview_id (safe to retry)", () => {
    expect(DBC).toMatch(/from\("interview_reports"\)\.upsert\(\{[\s\S]*?\}, \{ onConflict: "interview_id" \}\)/);
    expect(DBC).not.toMatch(/from\("interview_reports"\)\.insert\(/);
  });
  it("finishInterview checks the result and flags a failed persist without hiding it", () => {
    expect(FINISH).toMatch(/const reportSave = await dbCompleteInterview\(finalInterview\.id, result\)/);
    expect(FINISH).toMatch(/if \(!reportSave\.ok\) \{[\s\S]*?setPendingReportSave\(\{ interviewId: finalInterview\.id, result \}\)/);
    // the report is still shown this session (already in memory)
    expect(FINISH).toMatch(/setScreen\("report"\)/);
  });
  it("retrySaveReport re-runs persistence ONLY — never the AI evaluation", () => {
    expect(RETRY).toMatch(/dbCompleteInterview\(pendingReportSave\.interviewId, pendingReportSave\.result\)/);
    expect(RETRY).not.toMatch(/callClaude|validateReport|interview_report|requestType/);
  });
  it("the report screen shows an inline error + retry when the persist failed", () => {
    const REPORT_SCREEN = fn('{screen === "report" && report && (', '{/* ---------------- PAST INTERVIEW REPORT');
    expect(REPORT_SCREEN).toMatch(/pendingReportSave &&/);
    expect(REPORT_SCREEN).toMatch(/Your report couldn't be saved/);
    expect(REPORT_SCREEN).toMatch(/guarded\(retrySaveReport\)/);
  });
});

/* ============================== 2. Development Module durability ============================== */
describe("Development Module persistence is a hard durability boundary", () => {
  const OPEN = fn("async function openDevelopmentModule(topic, opts = {})", "// ---- deterministic sub-activities");
  const RETRY = fn("async function retrySaveModule()", "// BUG FIX (stale state)");

  it("a failed persist never fakes an id:null module and never auto-regenerates", () => {
    expect(OPEN).toMatch(/if \(!saved\) \{[\s\S]*?setPendingModuleSave\(\{ topicId: topic\.id[\s\S]*?setScreen\("classroom"\);\s*\n?\s*return;\s*\n?\s*\}/);
    expect(OPEN).not.toMatch(/hydrateDevModuleRow\(saved \|\| \{/);
    expect(OPEN).not.toMatch(/id: null, dimension/);
  });
  it("the generated content is kept for a persist-only retry", () => {
    expect(OPEN).toMatch(/const moduleFields = \{/);
    expect(OPEN).toMatch(/setPendingModuleSave\(\{ topicId: topic\.id, topic: topic\.topic, fields: moduleFields \}\)/);
  });
  it("retrySaveModule re-inserts the SAME fields — never callClaude", () => {
    expect(RETRY).toMatch(/dbInsertDevelopmentModule\(pendingModuleSave\.topicId, user\.id, pendingModuleSave\.fields\)/);
    expect(RETRY).not.toMatch(/callClaude|requestType/);
  });
  it("a persisted module is still reused with no generation (cost invariant intact)", () => {
    expect(OPEN).toMatch(/COST INVARIANT/);
    const reuseIdx = OPEN.indexOf("if (existing) {");
    const genIdx = OPEN.indexOf("callClaude(");
    expect(reuseIdx).toBeGreaterThan(-1);
    expect(reuseIdx).toBeLessThan(genIdx);
    expect(OPEN).toMatch(/if \(existing\) \{[\s\S]*?setScreen\("dev_module"\);\s*\n?\s*return;/);
    const calls = OPEN.match(/callClaude\(/g) || [];
    expect(calls.length).toBe(1);
  });
  it("the Classroom shows an inline error + retry when a module couldn't be saved", () => {
    const CLASS = fn('{screen === "classroom" && (', "Recommended for your application");
    expect(CLASS).toMatch(/pendingModuleSave &&/);
    expect(CLASS).toMatch(/was generated but not saved/);
    expect(CLASS).toMatch(/guarded\(retrySaveModule\)/);
  });
});

/* ============================== 3. application-scoped topic dedup ============================== */
describe("classroom-topic identity is application-scoped", () => {
  const PUSH = fn("async function pushClassroomTopics(topics, ctx)", "// Interview DNA:");
  it("uses classroomTopicMatch with the diagnosis's own application id", () => {
    expect(PUSH).toMatch(/const effectiveAppId = ctx\.applicationId \|\| applicationId \|\| null/);
    expect(PUSH).toMatch(/const existing = classroomTopicMatch\(list, t\.topic, effectiveAppId\)/);
    expect(PUSH).not.toMatch(/list\.find\(\(x\) => \{\s*\n?\s*const xn = normalizeTopic/); // old global-by-name dedup gone
  });
  it("a newly-created client topic carries its application id (so it isolates on the next render too)", () => {
    expect(PUSH).toMatch(/list\.push\(\{[\s\S]*?applicationId: effectiveAppId \}\)/);
  });
  it("the interview-diagnosis DB helper still appends an initial_score (unchanged)", () => {
    const UPSERT = fn("async function dbUpsertClassroomTopic(userId", "async function dbInsertClassroomLesson");
    expect(UPSERT).toMatch(/\.\.\.\(\(current && current\.scores\) \|\| \[\]\), topic\.initial_score \|\| 0/);
  });
});

/* ============================== 4. returning-user "Continue preparing" ============================== */
describe("returning-user Continue preparing surface", () => {
  it("loadFullUserState prefetches development modules + progress (best-effort)", () => {
    const LOAD = fn("async function loadFullUserState(userId)", "async function dbCreateApplication");
    expect(LOAD).toMatch(/dbSelect\("development_modules", \(q\) => q\.eq\("user_id", userId\)\.order\("id"/);
    expect(LOAD).toMatch(/dbSelect\("development_module_progress", \(q\) => q\.eq\("user_id", userId\)\.order\("id"/);
    expect(LOAD).toMatch(/developmentModules: Array\.isArray\(devModulesRaw\)/);
    expect(LOAD).toMatch(/moduleProgress: Array\.isArray\(moduleProgressRaw\)/);
  });
  it("the Dashboard item is the deterministic pickContinuePreparing output — no new engine, no AI", () => {
    expect(SRC).toMatch(/import \{ classroomTopicMatch, pickContinuePreparing, redoConceptUnion \} from "\.\/continuePreparing"/);
    const DERIVED = fn("const continuePreparing = (() => {", "const classroomApps = applicationsWithInterviews");
    expect(DERIVED).toMatch(/pickContinuePreparing\(\{[\s\S]*?developmentModules, moduleProgress[\s\S]*?candidateState: globalCandidateState/);
    expect(DERIVED).not.toMatch(/callClaude/);
  });
  it("the card keeps demonstrated vs preparation distinct and routes through the EXISTING open paths", () => {
    const CARD = fn("{/* Phase 15A: returning-user re-entry", "{perf?.weaknesses?.length > 0 && (");
    // Phase 28: the demonstrated-vs-preparation distinction is now carried by a
    // lucide icon (AlertCircle / BookOpen) instead of a 🔴 / 📚 emoji prefix —
    // the branching contract is unchanged.
    expect(CARD).toMatch(/continuePreparing\.evidenceType === "demonstrated"[\s\S]*?AlertCircle[\s\S]*?BookOpen/);
    expect(CARD).toMatch(/\{continuePreparing\.sublabel\}/);
    expect(CARD).toMatch(/startLearningFromRecommendation\(continuePreparing\.recommendation/);
    expect(CARD).toMatch(/openDevelopmentModule\(t\)/);
    // "Continue learning" only for a resume; "Start learning" otherwise
    expect(CARD).toMatch(/continuePreparing\.kind === "resume_module" \? "Continue learning" : "Start learning"/);
  });
  it("sign-out clears the new state", () => {
    const CLEAR = fn("function clearAllUserState(", "async function handleSignUp");
    expect(CLEAR).toMatch(/setDevelopmentModules\(\[\]\); setModuleProgress\(\[\]\); setPendingReportSave\(null\); setPendingModuleSave\(null\)/);
  });
});

/* ============================== 5. redo original question — honest deterministic marking ============================== */
describe("redo original question is deterministically marked, not a silent save", () => {
  const REDO_FN = fn("async function saveRedoAnswer()", "// Phase 15A HARD-DURABILITY RETRIES");
  it("marks the answer via markWrittenQuiz over redoConceptUnion — no AI", () => {
    expect(REDO_FN).toMatch(/const concepts = redoConceptUnion\(devModule\)/);
    expect(REDO_FN).toMatch(/markWrittenQuiz\(redoDraft, concepts\)/);
    expect(REDO_FN).not.toMatch(/callClaude/);
  });
  it("stores the coverage on the retry answer and shows a review, not a blank hub return", () => {
    expect(REDO_FN).toMatch(/covered: mark\.covered, missing: mark\.missing, coverage: mark\.coverage/);
    expect(REDO_FN).toMatch(/setRedoResult\(entry\)/);
    const REDO_VIEW = fn('{devView === "redo" && (', '{/* ---------------- LESSON ---------------- */}');
    expect(REDO_VIEW).toMatch(/redoResult \?/);
    expect(REDO_VIEW).toMatch(/Key points covered/);
    expect(REDO_VIEW).toMatch(/Still to include/);
    // the misleading "it is not scored here" copy is gone
    expect(REDO_VIEW).not.toMatch(/it is not scored here/);
  });
});

/* ============================== AI-cost invariant ============================== */
describe("Phase 15A adds no AI", () => {
  it("no new callClaude requestType strings", () => {
    const types = [...SRC.matchAll(/requestType:\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    const expected = [
      "assessment_centre", "assessment_centre_scenario", "classroom_lesson", "development_module",
      "interview_batch_evaluation", "interview_profile", "interview_question_batch", "interview_report",
      "interview_turn_evaluate", "interview_turn_generate", "invitation_extraction",
    ].sort();
    expect([...new Set(types)]).toEqual(expected);
  });
  it("continuePreparing.js and the redo/retry paths never reference callClaude", () => {
    expect(readFileSync(new URL("./continuePreparing.js", import.meta.url), "utf8")).not.toMatch(/callClaude/);
  });
});
