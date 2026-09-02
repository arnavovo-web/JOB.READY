/* ================================================================== *
 * PHASE 38 — FIX "PRACTISE AGAIN" FLOW + CLASSROOM LOAD-TIME PERFORMANCE
 * ------------------------------------------------------------------
 * PART A: "Practise again" / "Try again now" no longer sends the candidate
 *   back into the interview-generation wizard. It now shows a confirmation
 *   ("Create a new interview using your previous settings?"), and on
 *   confirm calls the EXACT SAME analyseAndPlan() pipeline every other
 *   interview goes through — just pre-filled from the application's most
 *   recent interview.config (the canonical, already-persisted source),
 *   never a second/shortcut creation path. A genuinely incomplete legacy
 *   config falls back to the minimum-necessary wizard entry, never
 *   fabricated settings.
 * PART B: "Start learning" in the Classroom no longer leaves the screen
 *   completely unresponsive while a (possibly redundant) network round-trip
 *   resolves before the AI generation even starts. The click now produces
 *   an immediate screen transition, and one wholly redundant existence
 *   check is skipped when the caller already knows the topic is brand new.
 * PART C: an audit of every "repeat this application's interview" button —
 *   confirms both existing "Practise again" call sites share the ONE new
 *   implementation, and confirms the features that are NOT the same
 *   operation (Phase B's Challenge Me "Try Again Now", and the deliberate
 *   "Build interview" wizard entry) were correctly left untouched.
 * App() is a React closure that can't be invoked directly — STRUCTURAL,
 * source-text-inspection convention, same as the rest of this suite.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function slice(a, b) {
  const s = SRC.indexOf(a);
  if (s === -1) throw new Error(`start marker not found: ${a}`);
  const e = SRC.indexOf(b, s + a.length);
  if (e === -1) throw new Error(`end marker not found: ${b}`);
  return SRC.slice(s, e);
}
// strip block + line comments so a "no X call" assertion isn't tripped by prose
function codeOnly(s) { return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); }

const PRACTISE_AGAIN_OPEN = slice("function practiseApplicationAgain(app) {", "function cancelPractiseAgain()");
const CONFIG_FOR = slice("function practiseAgainConfigFor(app) {", "async function startPractiseAgain(app) {");
const START_PRACTISE_AGAIN = slice("async function startPractiseAgain(app) {", "function confirmPractiseAgain()");
const CONFIRM_PRACTISE_AGAIN = slice("function confirmPractiseAgain() {", "/* ---------------- PHASE 16A: APPLICATIONS PILLAR");
const MODAL_JSX = slice("{practiseAgainConfirmApp && (", "{/* ---------------- LANDING");
const DASHBOARD_SRC = slice('screen === "dashboard" && user && (', "PHASE 16A — APPLICATIONS PILLAR");
const APP_INTERVIEWS_LIST = slice("{/* ---- INTERVIEWS ---- */}", "{/* ---- APPLICATION DETAILS ---- */}");
const DB_CREATE_INTERVIEW = slice("async function dbCreateInterview(userId, applicationId, config, methodologyDistribution) {", "async function dbInsertQuestion(");
const OPEN_MODULE = slice("async function openDevelopmentModule(topic, opts = {}) {", "// ---- deterministic sub-activities");
const START_LEARNING_FROM_REC = slice("async function startLearningFromRecommendation(rec, app) {", "// The ONE AI call for Phase 14.");

/* ================================================================== *
 * PART A — "Practise again" / repeat interview
 * ================================================================== */
describe("Phase 38 Part A — Practise again: normal flow", () => {
  it("1. clicking Practise again does not route directly to the interview wizard", () => {
    expect(PRACTISE_AGAIN_OPEN).not.toMatch(/setScreen\("create"\)/);
    expect(codeOnly(PRACTISE_AGAIN_OPEN)).not.toMatch(/setWizardStep\(/);
  });
  it("2. a confirmation dialog appears — practiseApplicationAgain sets the confirm-app state, and a ConfirmDialog is rendered for it", () => {
    expect(PRACTISE_AGAIN_OPEN).toMatch(/setPractiseAgainConfirmApp\(app\)/);
    expect(MODAL_JSX).toMatch(/<ConfirmDialog/);
    expect(MODAL_JSX).toMatch(/title="Create a new interview\?"/);
    expect(MODAL_JSX).toMatch(/confirmLabel="Create new interview"/);
  });
  it("3. Cancel closes the dialog and creates nothing — cancelPractiseAgain is a pure state clear, no DB/AI call anywhere in its body", () => {
    expect(SRC).toMatch(/function cancelPractiseAgain\(\) \{ setPractiseAgainConfirmApp\(null\); \}/);
    expect(MODAL_JSX).toMatch(/onCancel=\{cancelPractiseAgain\}/);
  });
  it("4. Confirm creates a new interview — confirmPractiseAgain hands off to startPractiseAgain, which reaches analyseAndPlan (the SAME pipeline as every other interview)", () => {
    expect(CONFIRM_PRACTISE_AGAIN).toMatch(/startPractiseAgain\(app\)/);
    expect(START_PRACTISE_AGAIN).toMatch(/analyseAndPlan\(\);/);
  });
  it("5. the original interview is never mutated — startPractiseAgain/confirmPractiseAgain issue no interviews UPDATE/DELETE of their own", () => {
    expect(codeOnly(START_PRACTISE_AGAIN)).not.toMatch(/\.from\("interviews"\)\.update\(|\.from\("interviews"\)\.delete\(/);
    expect(codeOnly(CONFIRM_PRACTISE_AGAIN)).not.toMatch(/\.from\("interviews"\)/);
  });
  it("6. the new interview receives a distinct id — dbCreateInterview always INSERTs a fresh row, never reuses/passes an existing interview id", () => {
    expect(DB_CREATE_INTERVIEW).toMatch(/\.from\("interviews"\)\.insert\(\{/);
    expect(DB_CREATE_INTERVIEW).not.toMatch(/\.eq\("id"/);
  });
  it("7. the new interview stays correctly linked to the SAME application — startPractiseAgain sets applicationId from the clicked app, never creates a new application row", () => {
    expect(START_PRACTISE_AGAIN).toMatch(/setApplicationId\(app\.id\)/);
    expect(codeOnly(START_PRACTISE_AGAIN)).not.toMatch(/dbCreateApplication/);
  });
  it("9. (found during visual QA) the click gets an immediate loading response BEFORE the best-effort CV-restore network round-trip, not after — the same immediate-feedback principle applied to Classroom in Part B", () => {
    const idxScreen = START_PRACTISE_AGAIN.indexOf('setScreen("analyzing")');
    const idxCvFetch = START_PRACTISE_AGAIN.indexOf("await dbGetApplicationDocuments(user.id, app.id)");
    expect(idxScreen).toBeGreaterThan(-1);
    expect(idxCvFetch).toBeGreaterThan(idxScreen);
  });
  it("8. the prior interview's configuration is reused, not re-collected from the candidate", () => {
    expect(START_PRACTISE_AGAIN).toMatch(/setInterviewStage\(config\.stage\); setInterviewFormat\(config\.format\)/);
    expect(START_PRACTISE_AGAIN).toMatch(/setQuestionMix\(\{/);
    expect(START_PRACTISE_AGAIN).toMatch(/setTechnicalDifficulty\(/);
    expect(START_PRACTISE_AGAIN).toMatch(/setLength\(/);
  });
});

describe("Phase 38 Part A — configuration preservation (source: the application's most recent interview.config, discovered during the audit)", () => {
  it("reads config off app.interviews[0] (interviewList is sorted newest-first — see applicationsWithInterviews)", () => {
    expect(CONFIG_FOR).toMatch(/const latest = \(app\.interviews \|\| \[\]\)\[0\];/);
    expect(CONFIG_FOR).toMatch(/const config = latest\?\.config;/);
  });
  it("interviewList actually carries the full config (not just sessionKind) back from loadFullUserState — the canonical source, no parallel one", () => {
    const mapping = slice("stageLabel: iv.stage ? stageByKey(iv.stage).label", "};\n  });");
    expect(mapping).toMatch(/config: iv\.config \|\| null,/);
  });
  it("company/role/job description are read from the application row itself — the SAME canonical source practiseApplicationAgain always used", () => {
    expect(START_PRACTISE_AGAIN).toMatch(/setCompany\(app\.company \|\| ""\); setRole\(app\.role \|\| ""\)/);
    expect(START_PRACTISE_AGAIN).toMatch(/setJdText\(app\.jobDescription \|\| ""\)/);
  });
  it("CV text is best-effort restored from a previously uploaded document — the SAME existing restore continueApplication already uses, not a new mechanism", () => {
    expect(START_PRACTISE_AGAIN).toMatch(/dbGetApplicationDocuments\(user\.id, app\.id\)/);
    expect(START_PRACTISE_AGAIN).toMatch(/d\.document_type === "cv" && d\.extracted_text/);
  });
});

describe("Phase 38 Part A — duplicate submission is prevented", () => {
  it("the modal's Confirm button is wrapped in the app-wide guarded() single-flight helper, same as every other confirm/generate action", () => {
    expect(MODAL_JSX).toMatch(/onConfirm=\{\(\) => guarded\(confirmPractiseAgain\)\}/);
  });
  it("analyseAndPlan (the actual generation step) has its OWN Phase 18 duplicate-generation guard, reused unchanged — not a second one", () => {
    const analyse = slice("async function analyseAndPlan() {", "function beginInterview()");
    expect(analyse).toMatch(/resumableInterviews\.find\(\(r\) => r\.applicationId === applicationId && r\.hasProfile\)/);
  });
});

describe("Phase 38 Part A — missing/incomplete legacy configuration falls back safely", () => {
  it("requires stage + format + a non-empty question mix before treating a config as usable — a genuinely legacy row (no config at all) returns null, no fabricated settings", () => {
    expect(CONFIG_FOR).toMatch(/if \(!config \|\| !config\.stage \|\| !config\.format \|\| !arr\(config\.question_mix\)\.length\) return null;/);
  });
  it("the fallback routes to the MINIMUM-necessary wizard entry (company/role/JD prefilled, question mix reset) rather than the full from-scratch wizard, with an honest message — never analyseAndPlan called blind", () => {
    expect(START_PRACTISE_AGAIN).toMatch(/if \(!config\) \{/);
    expect(START_PRACTISE_AGAIN).toMatch(/We need a little more information to create this interview/);
    expect(START_PRACTISE_AGAIN).toMatch(/setQuestionMix\(\{ technical: false, behavioural: false, motivational: false \}\)/);
    expect(START_PRACTISE_AGAIN).toMatch(/setWizardStep\(app\.jobDescription \? 3 : 2\)/);
  });
});

/* ================================================================== *
 * PART A — regression protection
 * ================================================================== */
describe("Phase 38 Part A — regression protection", () => {
  it("interview generation's own AI call/persistence shape is untouched (still one interview_profile call, still Promise.all for the two independent writes)", () => {
    const analyse = slice("async function analyseAndPlan() {", "function beginInterview()");
    expect((analyse.match(/requestType: "interview_profile"/g) || []).length).toBe(1);
    expect(analyse).toMatch(/const \[appUpdate, ivRow\] = await Promise\.all\(\[/);
  });
  it("technical difficulty resolution (Phase 31) is untouched — startPractiseAgain reuses the SAME resolveTechnicalDifficulty/DEFAULT_TECHNICAL_DIFFICULTY, no new levels", () => {
    expect(START_PRACTISE_AGAIN).toMatch(/resolveTechnicalDifficulty\(config\.technical_difficulty\)/);
    expect(SRC).toMatch(/TECHNICAL_DIFFICULTY_LEVELS, DEFAULT_TECHNICAL_DIFFICULTY, TECHNICAL_DIFFICULTY_META/);
  });
  it("scoring/report generation functions are untouched (still present, unchanged names)", () => {
    expect(SRC).toMatch(/async function generateBatchEvaluation\(/);
    expect(SRC).toMatch(/async function finishInterview\(/);
  });
  it("application linkage (applicationsWithInterviews grouping) is untouched", () => {
    expect(SRC).toMatch(/const applicationsWithInterviews = applications/);
    expect(SRC).toMatch(/interviewList\.filter\(\(iv\) => iv\.applicationId === app\.id\)/);
  });
  it("Phase 36 interview-date countdown is untouched", () => {
    expect(SRC).toMatch(/interviewCountdown/);
    expect(SRC).toMatch(/sortApplicationsByUpcoming/);
  });
  it("Phase 37 application preparation intelligence is untouched (buildApplicationIntelligence still called, unchanged, from analyseAndPlan)", () => {
    const analyse = slice("async function analyseAndPlan() {", "function beginInterview()");
    expect(analyse).toMatch(/buildApplicationIntelligence\(\{/);
  });
  it("Phase B engagement features (Quick Practice, Challenge Me, Delete Application) are untouched", () => {
    expect(SRC).toMatch(/function startQuickPractice\(app, questionCount\) \{/);
    expect(SRC).toMatch(/async function startChallengeMe\(app\) \{/);
    expect(SRC).toMatch(/async function confirmDeleteApplication\(\) \{/);
  });
});

/* ================================================================== *
 * PART B — Classroom "Start learning" performance
 * ================================================================== */
describe("Phase 38 Part B — Classroom: immediate response to the click", () => {
  it("openDevelopmentModule moves the screen to the loading state BEFORE the (possibly redundant) existence check, not after it resolves", () => {
    const idxScreen = OPEN_MODULE.indexOf('setScreen("dev_module_generating")');
    const idxDbCheck = OPEN_MODULE.indexOf("opts.knownNew ? null : await dbGetDevelopmentModule(topic.id)");
    expect(idxScreen).toBeGreaterThan(-1);
    expect(idxDbCheck).toBeGreaterThan(idxScreen);
  });
  it("that immediate loading state uses the SAME staged LoadingScreen system (real milestones, no timers) — not a new/fake one", () => {
    const preCheck = slice('setGenProgress({ title: "Opening this lesson"', "const existing = opts.knownNew");
    expect(preCheck).not.toMatch(/setTimeout\(|setInterval\(/);
  });
  it("startLearningFromRecommendation likewise responds immediately, before its own topic-creation write", () => {
    const idxScreen = START_LEARNING_FROM_REC.indexOf('setScreen("dev_module_generating")');
    const idxCreate = START_LEARNING_FROM_REC.indexOf("await dbCreateRecommendationTopic(");
    expect(idxScreen).toBeGreaterThan(-1);
    expect(idxCreate).toBeGreaterThan(idxScreen);
  });
  it("the fast (already-cached) path is completely unaffected — still returns before ever touching the new loading state", () => {
    const fastPath = slice("const cachedRow = developmentModules.find((m) => m.topic_id === topic.id);", "if (cachedRow) {").length; // sanity: marker exists
    expect(fastPath).toBeGreaterThan(0);
    const cachedBranch = slice("if (cachedRow) {\n      const mod = hydrateDevModuleRow(cachedRow);", "// Phase 38 — PERFORMANCE: respond to the click immediately.");
    expect(cachedBranch).toMatch(/setScreen\("dev_module"\)/);
    expect(cachedBranch).not.toMatch(/dev_module_generating/);
  });
});

describe("Phase 38 Part B — Classroom: avoiding a wholly redundant fetch", () => {
  it("openDevelopmentModule accepts a knownNew option that skips its own existence check entirely", () => {
    expect(OPEN_MODULE).toMatch(/async function openDevelopmentModule\(topic, opts = \{\}\) \{/);
    expect(OPEN_MODULE).toMatch(/const existing = opts\.knownNew \? null : await dbGetDevelopmentModule\(topic\.id\);/);
  });
  it("startLearningFromRecommendation passes knownNew:true for the topic it JUST inserted — a development_modules row cannot exist yet for that id, so the check is provably redundant, not merely assumed", () => {
    expect(START_LEARNING_FROM_REC).toMatch(/const row = await dbCreateRecommendationTopic\(/);
    expect(START_LEARNING_FROM_REC).toMatch(/await openDevelopmentModule\(clientTopic, \{ knownNew: true \}\)/);
    // the insert happens strictly before the knownNew call — never assumed out of order
    const idxInsert = START_LEARNING_FROM_REC.indexOf("dbCreateRecommendationTopic(");
    const idxOpen = START_LEARNING_FROM_REC.indexOf("openDevelopmentModule(clientTopic");
    expect(idxOpen).toBeGreaterThan(idxInsert);
  });
  it("every OTHER caller of openDevelopmentModule omits the option (unaffected, still gets the real existence check)", () => {
    const callSites = [...SRC.matchAll(/openDevelopmentModule\(([^)]*)\)/g)].map((m) => m[1].trim());
    const withKnownNew = callSites.filter((args) => args.includes("knownNew"));
    expect(withKnownNew.length).toBe(1); // only the freshly-materialised-topic call site
    expect(callSites.length).toBeGreaterThan(withKnownNew.length);
  });
});

describe("Phase 38 Part B — Classroom: no functionality regression", () => {
  it("still makes exactly one development_module AI call, only when genuinely generating", () => {
    expect((OPEN_MODULE.match(/await callClaude\(/g) || []).length).toBe(1);
    expect(OPEN_MODULE).toMatch(/requestType: "development_module"/);
  });
  it("duplicate-click protection (devGenRef) is intact", () => {
    expect(OPEN_MODULE).toMatch(/if \(!topic \|\| !user \|\| devGenRef\.current\) return;/);
    expect(OPEN_MODULE).toMatch(/devGenRef\.current = true;/);
  });
  it("no fabricated/placeholder learning content was introduced — the prompt/validation pipeline is unchanged", () => {
    expect(OPEN_MODULE).toMatch(/validateDevelopmentModule\(raw\)/);
    expect(codeOnly(OPEN_MODULE)).not.toMatch(/placeholder|lorem ipsum/i);
  });
  it("progress is still only ever cleared, never left stale, across the new immediate-feedback branch", () => {
    expect((OPEN_MODULE.match(/setGenProgress\(null\)/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

/* ================================================================== *
 * PART C — related-button audit
 * ================================================================== */
describe("Phase 38 Part C — repeat-practice buttons use ONE consistent implementation", () => {
  it("both existing 'Practise again' call sites (Dashboard card, Application Interviews list) invoke the SAME practiseApplicationAgain — no second implementation", () => {
    const dashboardCall = (DASHBOARD_SRC.match(/guarded\(\(\) => practiseApplicationAgain\(app\)\)/g) || []).length;
    const appScreenCall = (APP_INTERVIEWS_LIST.match(/guarded\(\(\) => practiseApplicationAgain\(app\)\)/g) || []).length;
    expect(dashboardCall).toBe(1);
    expect(appScreenCall).toBe(1);
  });
  it("neither call site bypasses the confirmation modal with its own inline logic", () => {
    expect(DASHBOARD_SRC).not.toMatch(/setScreen\("create"\)/);
    expect(APP_INTERVIEWS_LIST).not.toMatch(/setScreen\("create"\)/);
  });
});

describe("Phase 38 Part C — features that are NOT the same operation were deliberately left untouched", () => {
  it("Phase B's Challenge Me 'Try Again Now' retries a single question in-place — it does not create a new interview, so it correctly still calls retryChallengeQuestion, never startPractiseAgain/analyseAndPlan", () => {
    expect(SRC).toMatch(/onClick=\{\(\) => guarded\(retryChallengeQuestion\)\}><RotateCcw size=\{15\} \/> Try Again Now<\/Btn>/);
    const retryFn = slice("async function retryChallengeQuestion() {", "async function confirmDeleteApplication() {");
    expect(codeOnly(retryFn)).not.toMatch(/analyseAndPlan|startPractiseAgain|dbCreateInterview/);
  });
  it("'Build interview' is a deliberate, user-chosen fresh wizard entry (e.g. a different stage/format) — a genuinely different intent from repeating the last interview, so it correctly still opens the wizard", () => {
    const buildFn = slice("function buildInterviewFromApplication(app) {", "/* ---------------- PHASE B: QUICK PRACTICE");
    expect(buildFn).toMatch(/setScreen\("create"\)/);
  });
  it("'Continue setup' (a draft application with no interview yet) is a first-time setup, not a repeat — correctly still enters the wizard", () => {
    const contFn = slice("async function continueApplication(app) {", "/* ---------------- PHASE 38: PRACTISE AGAIN (frictionless repeat interview) ---------------- */");
    expect(contFn).toMatch(/setScreen\("create"\)/);
  });
});
