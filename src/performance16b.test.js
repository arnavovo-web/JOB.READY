/* ================================================================== *
 * PHASE 16B — CORE PERFORMANCE & LOADING OPTIMISATION
 * ------------------------------------------------------------------
 * Architectural performance GUARANTEES, not timing thresholds. App()
 * is a React closure that can't be invoked directly, so these inspect
 * the source of the five audited flows (same convention as the rest of
 * the suite). Behavioural coverage of the deterministic Classroom
 * checker lives in writtenQuiz.test.js.
 *
 * What must stay true after Phase 16B:
 *   - existing Development Module reopen  -> 0 AI, 0 blocking DB reads
 *   - existing Application Intelligence   -> 0 AI on open
 *   - Flashcards / Quiz / answer checking -> 0 AI, pure state switches
 *   - interview generation persistence    -> independent writes run in
 *     parallel, required writes still checked + visible on failure
 *   - loading feedback is immediate and staged on REAL milestones
 *     (no timer-driven fake progress in the generating flows)
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { markWrittenQuiz } from "./writtenQuiz.js";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
function slice(a, b) {
  const s = SRC.indexOf(a);
  if (s === -1) throw new Error(`start marker not found: ${a}`);
  const e = SRC.indexOf(b, s + a.length);
  if (e === -1) throw new Error(`end marker not found: ${b}`);
  return SRC.slice(s, e);
}

const OPEN_MODULE = slice("async function openDevelopmentModule(topic) {", "// ---- deterministic sub-activities");
const OPEN_MODULE_FASTPATH = slice("const cachedRow = developmentModules.find((m) => m.topic_id === topic.id);", "// Not in state:");
const ANALYSE_AND_PLAN = slice("async function analyseAndPlan() {", "function beginInterview()");
const ANALYSE_APP_ONLY = slice("async function analyseApplicationOnly(app) {", "function buildInterviewFromApplication(");
const RETRY_SAVE_MODULE = slice("async function retrySaveModule() {", "// BUG FIX (stale state)");
const LOADING_SCREEN = slice("function LoadingScreen({ messages, progress }) {", "function NavBar(");
const GO_TO_DEV_VIEW = slice("function goToDevView(v) {", "function startWrittenQuiz() {");
const START_QUIZ = slice("function startWrittenQuiz() {", "async function saveFlashProgress(");
const SUBMIT_WRITTEN = slice("async function submitWrittenAnswer() {", "// Phase 15A: the \"redo the ORIGINAL");
const SAVE_REDO = slice("async function saveRedoAnswer() {", "// Phase 15A HARD-DURABILITY RETRIES");
const OPEN_APPLICATION = slice("function openApplication(app) {", "function openApplicationForm(");

/* ===================== FLOW 3 — existing Development Module ===================== */
describe("FLOW 3 — reopening an existing module is instant: state-first, 0 AI, 0 blocking DB", () => {
  it("checks React state (developmentModules) BEFORE any DB round-trip", () => {
    // the cached branch appears before the dbGetDevelopmentModule fallback
    const idxCache = OPEN_MODULE.indexOf("developmentModules.find((m) => m.topic_id === topic.id)");
    const idxDbRead = OPEN_MODULE.indexOf("await dbGetDevelopmentModule(topic.id)");
    expect(idxCache).toBeGreaterThan(-1);
    expect(idxDbRead).toBeGreaterThan(idxCache);
  });
  it("the fast path makes NO AI call and NO blocking DB read", () => {
    expect(OPEN_MODULE_FASTPATH).not.toMatch(/callClaude/);
    expect(OPEN_MODULE_FASTPATH).not.toMatch(/await dbGet/);
    // it renders straight from cached state
    expect(OPEN_MODULE_FASTPATH).toMatch(/hydrateDevModuleRow\(cachedRow\)/);
    expect(OPEN_MODULE_FASTPATH).toMatch(/moduleProgress\.find\(\(p\) => p\.module_id === cachedRow\.id\)/);
    expect(OPEN_MODULE_FASTPATH).toMatch(/setScreen\("dev_module"\)/);
  });
  it("only reconciles progress from the DB when state holds NO record for the module, and never blocks on it", () => {
    expect(OPEN_MODULE_FASTPATH).toMatch(/if \(!stateProg\) \{\s*\n?\s*dbGetModuleProgress\(cachedRow\.id, user\.id\)\.then\(/);
    // background call is not awaited
    expect(OPEN_MODULE_FASTPATH).not.toMatch(/await dbGetModuleProgress/);
  });
  it("keeps a correct DB fallback for a legacy session / cross-device module (still 0 AI)", () => {
    const fallback = slice("// Not in state:", "devGenRef.current = true;");
    expect(fallback).toMatch(/await dbGetDevelopmentModule\(topic\.id\)/);
    expect(fallback).not.toMatch(/callClaude/);
  });
});

/* ===================== FLOW 2 — new Development Module ===================== */
describe("FLOW 2 — new module: one AI call, no always-null progress round-trip, staged feedback", () => {
  it("still makes exactly one development_module AI call", () => {
    expect((OPEN_MODULE.match(/await callClaude\(/g) || []).length).toBe(1);
    expect(OPEN_MODULE).toMatch(/requestType: "development_module"/);
  });
  it("a just-created module starts with null progress instead of an always-null DB read", () => {
    const afterSave = slice("Phase 16B: a module that was just created has no progress row", "} catch (e) {");
    expect(afterSave).toMatch(/setDevProgress\(null\)/);
    expect(afterSave).not.toMatch(/dbGetModuleProgress/);
  });
  it("retrySaveModule likewise trusts state and only background-reconciles", () => {
    expect(RETRY_SAVE_MODULE).not.toMatch(/setDevProgress\(await dbGetModuleProgress/);
    expect(RETRY_SAVE_MODULE).toMatch(/moduleProgress\.find\(\(p\) => p\.module_id === saved\.id\)/);
  });
  it("HARD DURABILITY preserved — a failed persist is still surfaced, never a silent fake module", () => {
    expect(OPEN_MODULE).toMatch(/if \(!saved\) \{[\s\S]*?setPendingModuleSave\(\{[\s\S]*?setError\(/);
    expect(OPEN_MODULE).toMatch(/couldn't be saved. Retry from the Classroom/);
  });
  it("duplicate-click protection is intact (devGenRef guard) and the insert still de-dupes on unique topic_id", () => {
    expect(OPEN_MODULE).toMatch(/if \(!topic \|\| !user \|\| devGenRef\.current\) return;/);
    expect(OPEN_MODULE).toMatch(/devGenRef\.current = true;/);
    const insert = slice("async function dbInsertDevelopmentModule(", "async function dbGetModuleProgress(");
    expect(insert).toMatch(/duplicate key\|unique/);
    expect(insert).toMatch(/return dbGetDevelopmentModule\(topicId\)/);
  });
});

/* ===================== FLOW 1 — interview generation ===================== */
describe("FLOW 1 — interview generation: parallel independent writes, overlapped best-effort seed", () => {
  it("still makes exactly one interview_profile AI call on the adaptive path (batch adds its own existing batch call)", () => {
    expect(ANALYSE_AND_PLAN).toMatch(/requestType: "interview_profile"/);
    const profileCalls = (ANALYSE_AND_PLAN.match(/requestType: "interview_profile"/g) || []).length;
    expect(profileCalls).toBe(1);
  });
  it("the applications-row write and the interviews-row insert run concurrently (independent tables)", () => {
    expect(ANALYSE_AND_PLAN).toMatch(/const \[appUpdate, ivRow\] = await Promise\.all\(\[\s*\n?\s*dbUpdateApplication\(applicationId,[\s\S]*?dbCreateInterview\(user\.id, applicationId, ivConfig, methodologyDistribution\),\s*\n?\s*\]\);/);
  });
  it("the required application write is STILL checked and aborts loudly on failure", () => {
    expect(ANALYSE_AND_PLAN).toMatch(/if \(!appUpdate \|\| !appUpdate\.ok\) \{\s*\n?\s*throw new Error\(/);
  });
  it("the best-effort claim seed is overlapped (not a serial round-trip) and uses a functional setState — no stale closure, no race", () => {
    expect(ANALYSE_AND_PLAN).toMatch(/const claimsSeed = \(async \(\) => \{/);
    expect(ANALYSE_AND_PLAN).toMatch(/setCandidateClaims\(\(cur\) => \[\.\.\.cur, \.\.\.inserted\]\)/);
    expect(ANALYSE_AND_PLAN).not.toMatch(/setCandidateClaims\(\[\.\.\.candidateClaims, \.\.\.inserted\]\)/);
  });
  it("both pipeline branches settle the overlapped seed BEFORE switching to the preview screen", () => {
    // adaptive branch: from the opening-question insert to the end of analyseAndPlan
    const adaptiveTail = slice("const q1 = await dbInsertQuestion(ivRow.id, 1, result.opening_question);", "function beginInterview()");
    expect(adaptiveTail).toMatch(/await claimsSeed;[\s\S]*?setScreen\("preview"\)/);
    // batch branch: from its distribution calc to the fall-through adaptive insert
    const batchTail = slice("const batchDistribution = applyQuestionMixToDistribution", "const q1 = await dbInsertQuestion(ivRow.id, 1,");
    expect(batchTail).toMatch(/await claimsSeed;[\s\S]*?setScreen\("preview"\)/);
  });
  it("batch questions are still a single multi-row insert (no N+1) and the adaptive path still inserts only the opening question", () => {
    expect(ANALYSE_AND_PLAN).toMatch(/await dbInsertQuestionBatch\(ivRow\.id, batch\.questions,/);
    expect((ANALYSE_AND_PLAN.match(/await dbInsertQuestion\(/g) || []).length).toBe(1);
  });
});

/* ===================== FLOW 4 — Classroom mode switching ===================== */
describe("FLOW 4 — Learn <-> Flashcards <-> Quiz <-> Redo is pure state: 0 AI, 0 DB, no loading screen", () => {
  it("goToDevView never calls AI, never hits the DB, never shows a loading screen", () => {
    expect(GO_TO_DEV_VIEW).not.toMatch(/callClaude|dbGet|dbInsert|dbUpsert|setScreen\(/);
    expect(GO_TO_DEV_VIEW).toMatch(/setDevView\(/);
  });
  it("startWrittenQuiz is a pure in-memory shuffle of learning_items — no AI, no DB", () => {
    expect(START_QUIZ).not.toMatch(/callClaude|dbGet|dbInsert|await /);
    expect(START_QUIZ).toMatch(/devModule\?\.learning_items/);
  });
  it("written answer checking is deterministic (markWrittenQuiz) — no AI call in the submit path", () => {
    expect(SUBMIT_WRITTEN).not.toMatch(/callClaude/);
    expect(SUBMIT_WRITTEN).toMatch(/markWrittenQuiz\(quizDraft, item\?\.expected_concepts/);
    expect(SAVE_REDO).not.toMatch(/callClaude/);
    expect(SAVE_REDO).toMatch(/markWrittenQuiz\(redoDraft, concepts\)/);
  });
  it("markWrittenQuiz really is a pure deterministic checker (covered / missing, no network)", () => {
    // covered / missing are ordered arrays of concept LABELS (see writtenQuiz.js)
    const r = markWrittenQuiz("a discounted cash flow projects the free cash flows of the business",
      [{ label: "discounted cash flow", accepted_terms: ["dcf"] }, { label: "terminal value", accepted_terms: ["tv"] }]);
    expect(r.covered).toContain("discounted cash flow");
    expect(r.missing).toContain("terminal value");
    expect(r.coverage).toEqual({ n: 1, total: 2 });
  });
});

/* ===================== FLOW 5 — Applications ===================== */
describe("FLOW 5 — opening an application is a pure state switch: 0 AI, 0 DB", () => {
  it("openApplication just sets appView + screen — no fetch, no analysis", () => {
    expect(OPEN_APPLICATION).not.toMatch(/callClaude|await |dbGet|dbSelect/);
    expect(OPEN_APPLICATION).toMatch(/setAppView\(app\.id\); setScreen\("application"\)/);
  });
  it("standalone analysis stays exactly one interview_profile call, explicitly triggered", () => {
    expect((ANALYSE_APP_ONLY.match(/await callClaude\(/g) || []).length).toBe(1);
    expect(ANALYSE_APP_ONLY).toMatch(/requestType: "interview_profile"/);
  });
  it("its claim seed is also overlapped with the required write and uses a functional setState", () => {
    expect(ANALYSE_APP_ONLY).toMatch(/const claimsSeed = \(async \(\) => \{/);
    expect(ANALYSE_APP_ONLY).toMatch(/setCandidateClaims\(\(cur\) => \[\.\.\.cur, \.\.\.inserted\]\)/);
    expect(ANALYSE_APP_ONLY).toMatch(/if \(!upd \|\| upd\.ok === false\) \{[\s\S]*?await claimsSeed;/);
  });
});

/* ===================== Loading UX — immediate + honest ===================== */
describe("Loading UX — feedback is immediate and staged on real milestones, never a fake timer", () => {
  it("LoadingScreen staged mode disables the message timer entirely", () => {
    expect(LOADING_SCREEN).toMatch(/if \(staged \|\| !messages \|\| messages\.length < 2\) return;/);
    // the interval only exists on the legacy (non-staged) branch
    expect((LOADING_SCREEN.match(/setInterval\(/g) || []).length).toBe(1);
  });
  it("staged mode renders a real checklist: done = tick, current = spinner, later = dim", () => {
    expect(LOADING_SCREEN).toMatch(/const done = i < stage, active = i === stage;/);
    expect(LOADING_SCREEN).toMatch(/progress\.steps\.map\(/);
  });
  it("each generating flow sets genProgress BEFORE switching screen — the click is acknowledged instantly", () => {
    expect(ANALYSE_AND_PLAN).toMatch(/setGenProgress\(\{[\s\S]*?\}\);\s*\n?\s*setScreen\("analyzing"\)/);
    expect(OPEN_MODULE).toMatch(/setGenProgress\(\{[\s\S]*?\}\);\s*\n?\s*setScreen\("dev_module_generating"\)/);
    expect(ANALYSE_APP_ONLY).toMatch(/setGenProgress\(\{[\s\S]*?\}\);\s*\n?\s*setScreen\("application_analyzing"\)/);
  });
  it("stages advance ONLY via bumpGenStage tied to a real awaited milestone — no setTimeout choreography", () => {
    // interview: profile call done -> stage 1; batch generated -> stage 2
    expect(ANALYSE_AND_PLAN).toMatch(/bumpGenStage\(1\);/);
    expect(ANALYSE_AND_PLAN).toMatch(/bumpGenStage\(2\); \/\/ batch generated/);
    // module: material generated & validated -> stage 1
    expect(OPEN_MODULE).toMatch(/bumpGenStage\(1\); \/\/ material generated/);
    // application analysis: AI returned -> stage 1
    expect(ANALYSE_APP_ONLY).toMatch(/bumpGenStage\(1\);/);
    // none of the generating flows fake progress with timers
    for (const fn of [ANALYSE_AND_PLAN, OPEN_MODULE, ANALYSE_APP_ONLY]) {
      expect(fn).not.toMatch(/setTimeout\(|setInterval\(/);
    }
  });
  it("genProgress is cleared on every exit (success and error) so a stale checklist never leaks", () => {
    expect((ANALYSE_AND_PLAN.match(/setGenProgress\(null\)/g) || []).length).toBeGreaterThanOrEqual(3);
    expect((OPEN_MODULE.match(/setGenProgress\(null\)/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((ANALYSE_APP_ONLY.match(/setGenProgress\(null\)/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  it("loading context carries what the user is waiting for (company / role / topic)", () => {
    expect(ANALYSE_AND_PLAN).toMatch(/subtitle: \[cleanCompany, cleanRole\]\.filter\(Boolean\)\.join\(" · "\)/);
    expect(OPEN_MODULE).toMatch(/subtitle: topic\.topic \|\| ""/);
    expect(ANALYSE_APP_ONLY).toMatch(/subtitle: \[cleanCompany, cleanRole\]\.filter\(Boolean\)\.join\(" · "\)/);
  });
});

/* ===================== Phase 16A protection ===================== */
describe("Phase 16A guarantees are untouched by the perf work", () => {
  it("no AI call was introduced on application open / render", () => {
    expect(OPEN_APPLICATION).not.toMatch(/callClaude/);
  });
  it("staleness detection + explicit Analyse/Re-analyse still gate the only AI call", () => {
    expect(ANALYSE_APP_ONLY).toMatch(/requestType: "interview_profile"/);
    expect(SRC).toMatch(/applicationIntelligenceIsStale\(intel, hashApplicationSources/);
  });
  it("Question Mix is still reset when building an interview from an application", () => {
    const buildIv = slice("function buildInterviewFromApplication(app) {", "/* ---------------- PHASE 7:");
    expect(buildIv).toMatch(/setQuestionMix\(\{ technical: false, behavioural: false, motivational: false \}\)/);
  });
});
