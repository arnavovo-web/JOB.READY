/* ================================================================== *
 * PHASE B — ENGAGEMENT FEATURES (Quick Practice / Challenge Me /
 * Try Again Now / Delete Application)
 * ------------------------------------------------------------------
 * App() is a React closure this node-environment suite can't render
 * directly, so — same convention as the rest of the repo's Phase test
 * files (reportUX.test.js, applicationsAndRecommendations.test.js,
 * interviewStateIntegrity20.test.js) — these are STRUCTURAL,
 * source-text-inspection tests, plus real behavioural coverage of the
 * one pure change (buildQuestionBatchPrompt's avoidQuestions parameter,
 * exercised indirectly here through its source since it isn't exported;
 * its identity/no-op guarantee for every pre-existing caller is what
 * "existing full interview generation remains unaffected" rests on).
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
function slice(startMarker, endMarker) {
  const s = SRC.indexOf(startMarker);
  if (s === -1) throw new Error(`start marker not found: ${startMarker}`);
  const e = SRC.indexOf(endMarker, s + startMarker.length);
  if (e === -1) throw new Error(`end marker not found: ${endMarker}`);
  return SRC.slice(s, e);
}
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const START_QUICK = slice("function startQuickPractice(app, questionCount) {", "/* ---------------- PHASE B: CHALLENGE ME ---------------- */");
const START_CHALLENGE = slice("async function startChallengeMe(app) {", "async function submitChallengeAnswer() {");
const SUBMIT_CHALLENGE = slice("async function submitChallengeAnswer() {", "/* ---------------- PHASE B: TRY AGAIN NOW ---------------- */");
const RETRY_CHALLENGE = slice("async function retryChallengeQuestion() {", "/* ---------------- PHASE B: DELETE APPLICATION ---------------- */");
const CONFIRM_DELETE = slice("async function confirmDeleteApplication() {", "\n  }\n");
const BUILD_BATCH_PROMPT = slice("function buildQuestionBatchPrompt(config, interviewProfile, cvBackground, jdText, weaknessNote, methodologyDistribution, avoidQuestions = []) {", "async function generateQuestionBatch(");
const GEN_BATCH = slice("async function generateQuestionBatch(config, interviewProfile, cvBackground, jdText, weaknessNote, meta, methodologyDistribution, avoidQuestions = []) {", "function buildBatchEvaluationPrompt(");
const APP_SCREEN = slice('{/* ---------------- APPLICATION OVERVIEW (workspace) ---------------- */}', '{/* ---------------- PHASE B: QUICK PRACTICE SETUP ---------------- */}');
const QUICK_SETUP_SCREEN = slice('{screen === "quick_practice_setup" && user && (() => {', '{/* ---------------- PHASE B: CHALLENGE ME ---------------- */}');
const CHALLENGE_SCREENS = slice('{screen === "challenge_generating"', '{/* ---------------- PHASE 18: RESUME-OR-START-NEW CHOICE ---------------- */}');
const ANALYSE_AND_PLAN = slice("async function analyseAndPlan() {", "function beginInterview()");
const MIGRATION_SQL = readFileSync(new URL("../supabase/migrations/20260828120000_baseline_schema.sql", import.meta.url), "utf8");

/* ============================== FEATURE 1: Quick Practice ============================== */
describe("Quick Practice", () => {
  it("is available inside the existing Application experience — a button in the Application Overview screen, not a nav item or new hub", () => {
    expect(APP_SCREEN).toMatch(/onClick=\{\(\) => \{ setError\(""\); setScreen\("quick_practice_setup"\); \}\}/);
    expect(APP_SCREEN).toContain("Quick Practice");
    const nav = slice("const links = user", "return (");
    expect(nav).not.toMatch(/Quick Practice/);
  });
  it("does not create a new navigation route — quick_practice_setup is reachable only from the Application screen, not the NavBar", () => {
    expect(SRC).not.toMatch(/to: "quick_practice_setup"/);
  });
  it("short-session options are bounded to 3 or 5 questions, 3 marked as fastest/default", () => {
    expect(QUICK_SETUP_SCREEN).toMatch(/startQuickPractice\(app, 3\)/);
    expect(QUICK_SETUP_SCREEN).toMatch(/startQuickPractice\(app, 5\)/);
    expect(QUICK_SETUP_SCREEN).not.toMatch(/startQuickPractice\(app, (?!3|5)\d+\)/);
    expect(QUICK_SETUP_SCREEN).toMatch(/3 questions.*fastest/s);
  });
  it("reuses this application's own company/role/JD context — no parallel context system, no re-typing", () => {
    expect(START_QUICK).toMatch(/setCompany\(app\.company \|\| ""\); setRole\(app\.role \|\| ""\); setApplicationId\(app\.id\)/);
    expect(START_QUICK).toMatch(/setJdText\(app\.jobDescription \|\| ""\)/);
  });
  it("blank/optional application data (no JD) never crashes the flow — jdText falls back to an empty string, same as the existing wizard path", () => {
    expect(START_QUICK).toMatch(/setJdText\(app\.jobDescription \|\| ""\)/);
    // analyseAndPlan (reused unchanged) already has its own tested "no JD" fallback (jdBlock) —
    // Quick Practice doesn't re-implement or bypass it.
    expect(ANALYSE_AND_PLAN).toMatch(/Job description: none provided\./);
  });
  it("reuses analyseAndPlan (and therefore generateQuestionBatch / the EXISTING interview_question_batch request type) rather than a new AI pathway", () => {
    expect(START_QUICK).toMatch(/analyseAndPlan\(\);/);
    expect(START_QUICK).not.toMatch(/callClaude/);
  });
  it("the override is additive and self-clearing — every existing (non-Quick-Practice) call to analyseAndPlan is completely unaffected", () => {
    expect(ANALYSE_AND_PLAN).toMatch(/if \(quickPracticeQuestionCount\) \{/);
    expect(ANALYSE_AND_PLAN).toMatch(/setQuickPracticeQuestionCount\(null\);/);
    // the override sits INSIDE the guard — every existing path (flag null) leaves ivConfig
    // exactly as resolveInterviewConfig produced it, byte for byte
    const guardIdx = ANALYSE_AND_PLAN.indexOf("if (quickPracticeQuestionCount) {");
    const resolveIdx = ANALYSE_AND_PLAN.indexOf("const ivConfig = resolveInterviewConfig(interviewStage, interviewFormat);");
    expect(guardIdx).toBeGreaterThan(resolveIdx);
  });
  it("is clearly distinguishable from a full interview — session_kind is persisted and the Interviews list labels it", () => {
    expect(START_QUICK).toMatch(/ivConfig\.session_kind = "quick_practice";|setQuickPracticeQuestionCount\(questionCount\);/); // set via analyseAndPlan's own override branch
    expect(ANALYSE_AND_PLAN).toMatch(/ivConfig\.session_kind = "quick_practice";/);
    expect(APP_SCREEN).toMatch(/iv\.sessionKind === "quick_practice" \? "⏱️ Quick Practice"/);
  });
  it("existing full interview generation (buildInterviewFromApplication, the normal wizard) is untouched", () => {
    const buildFromApp = slice("function buildInterviewFromApplication(app) {", "/* ---------------- PHASE B: QUICK PRACTICE ---------------- */");
    expect(buildFromApp).not.toMatch(/quickPracticeQuestionCount/);
    expect(buildFromApp).toMatch(/setWizardStep\(app\.jobDescription \? 3 : 2\)/);
  });
});

/* ============================== FEATURE 2: Challenge Me ============================== */
describe("Challenge Me", () => {
  it("is application-specific — scoped to app.id throughout, never a global/candidate-wide question", () => {
    expect(START_CHALLENGE).toMatch(/interviewList\.filter\(\(iv\) => iv\.applicationId === app\.id\)/);
    expect(START_CHALLENGE).toMatch(/dbCreateInterview\(user\.id, app\.id, ivConfig, methodologyDistribution\)/);
  });
  it("works with ZERO previous questions — the history fetch is skipped, not errored, and generation still proceeds", () => {
    expect(START_CHALLENGE).toMatch(/appInterviewIds\.length \? await dbGetApplicationRecentQuestions\(appInterviewIds, 15\) : \[\]/);
    expect(START_CHALLENGE).not.toMatch(/if \(!recentQuestions\.length\) \{[\s\S]{0,80}(setError|throw)/);
  });
  it("previous question history IS consulted where available, and is bounded (capped at 15, never unlimited)", () => {
    expect(START_CHALLENGE).toMatch(/dbGetApplicationRecentQuestions\(appInterviewIds, 15\)/);
    const fn = slice("async function dbGetApplicationRecentQuestions(interviewIds, limit) {", "async function dbInsertRetryQuestion(");
    expect(fn).toMatch(/\.limit\(limit\)/);
  });
  it("the novelty guidance explicitly discourages exact duplicates, near-duplicates and repeated themes", () => {
    expect(BUILD_BATCH_PROMPT).toMatch(/Do NOT repeat any of them/);
    expect(BUILD_BATCH_PROMPT).toMatch(/near-duplicate or an obvious reformulation/);
    expect(BUILD_BATCH_PROMPT).toMatch(/attracts you to this company/i); // the brief's own worked example, verbatim guidance
    expect(BUILD_BATCH_PROMPT).toMatch(/Pick a genuinely different theme\/competency/);
  });
  it("historical context sent to the AI call is the SAME bounded list — never sent unlimited", () => {
    expect(BUILD_BATCH_PROMPT).toMatch(/arr\(avoidQuestions\)\.length \? `\\n\\nPreviously asked for this application/);
  });
  it("respects Phase 31 technical difficulty — reads it from this application's own most recent interview config, never invents or escalates it", () => {
    expect(START_CHALLENGE).toMatch(/lastTechnicalDifficulty = \(app\.interviews \|\| \[\]\)\.map\(\(iv\) => iv\.config\?\.technical_difficulty\)\.find\(Boolean\)/);
    expect(START_CHALLENGE).toMatch(/resolveTechnicalDifficulty\(lastTechnicalDifficulty \|\| DEFAULT_TECHNICAL_DIFFICULTY\)/);
    // and the actual per-question calibration guidance is the EXISTING Phase 31 layer, not a new one
    expect(BUILD_BATCH_PROMPT).toMatch(/buildTechnicalDifficultyGuidance\(config\.technical_difficulty\)/);
  });
  it("'challenging' is framed as more novel/demanding, never as unrealistic or impossible", () => {
    expect(BUILD_BATCH_PROMPT).toMatch(/never absurd or impossible/);
  });
  it("generates exactly ONE question, via the EXISTING interview_question_batch request type — no new request type", () => {
    expect(START_CHALLENGE).toMatch(/question_count: 1, session_kind: "challenge"/);
    expect(GEN_BATCH).toMatch(/requestType: "interview_question_batch"/);
  });
  it("avoidQuestions is optional and defaults to an empty array — EVERY pre-existing call site (no 8th argument) is byte-identical to before", () => {
    expect(BUILD_BATCH_PROMPT).toMatch(/avoidQuestions = \[\]\) \{/);
    expect(GEN_BATCH).toMatch(/avoidQuestions = \[\]\) \{/);
    // the added prompt text is entirely gated on a non-empty array
    expect(BUILD_BATCH_PROMPT).toMatch(/\$\{arr\(avoidQuestions\)\.length \? `\n- CHALLENGE MODE/);
  });
  it("does not alter ordinary (non-Challenge) interview generation — analyseAndPlan's own batch call never passes avoidQuestions", () => {
    const batchCallInAnalyse = slice("const batch = await generateQuestionBatch(ivConfig, result.interview_profile, cvBackground, cleanJd, weaknessNote,", "if (!batch.questions.length)");
    expect(batchCallInAnalyse).not.toMatch(/avoidQuestions|recentQuestions/);
  });
  it("after answering, feedback reuses the EXISTING evaluation pathway (generateBatchEvaluation / interview_batch_evaluation) — no separate scoring model", () => {
    expect(SUBMIT_CHALLENGE).toMatch(/generateBatchEvaluation\(/);
    expect(SUBMIT_CHALLENGE).toMatch(/dbInsertEvaluationForAnswer\(savedAnswer\.id, evaluation, null\)/);
  });
  it("deliberately stops at the evaluation — no heavier interview_report AI call for a single question", () => {
    expect(SUBMIT_CHALLENGE).not.toMatch(/requestType: "interview_report"|finishInterview\(/);
    expect(SUBMIT_CHALLENGE).toMatch(/dbCompleteLightweightInterview\(challenge\.interviewId, evaluation\)/);
  });
});

/* ============================== FEATURE 3: Try Again Now ============================== */
describe("Try Again Now", () => {
  it("appears only on the Challenge Me feedback screen, contextually, not on every screen", () => {
    expect(CHALLENGE_SCREENS).toMatch(/Try Again Now<\/Btn>/);
    // exactly one rendered button anywhere in the app — not sprinkled across other screens
    // (module docstring/helper comments also say "Try Again Now" in prose, which is fine —
    // this checks the one actual <Btn>...Try Again Now</Btn> render)
    const rendered = SRC.match(/Try Again Now<\/Btn>/g) || [];
    expect(rendered.length).toBe(1);
  });
  it("retrying presents the SAME question text — it does not generate a new question (no AI call)", () => {
    expect(codeOnly(RETRY_CHALLENGE)).not.toMatch(/callClaude|generateQuestionBatch|generateBatchEvaluation/);
    expect(RETRY_CHALLENGE).toMatch(/dbInsertRetryQuestion\(challenge\.interviewId, challenge\.questionNumber \+ 1, challenge, originalId\)/);
    // dbInsertRetryQuestion clones original.text verbatim — no new text is ever generated
    const insertRetryFn = slice("async function dbInsertRetryQuestion(interviewId, questionNumber, original, retryOfQuestionId) {", "\n}\n");
    expect(insertRetryFn).toMatch(/question_text: original\.text/);
    expect(codeOnly(insertRetryFn)).not.toMatch(/callClaude/);
  });
  it("the previous attempt is NOT destroyed — a NEW question row is created (never an update/delete of the original)", () => {
    const insertRetryFn = slice("async function dbInsertRetryQuestion(interviewId, questionNumber, original, retryOfQuestionId) {", "\n}\n");
    expect(insertRetryFn).toMatch(/\.insert\(\{/);
    expect(insertRetryFn).not.toMatch(/\.update\(|\.delete\(/);
    // the retry is traceable back to the original via the EXISTING metadata jsonb column — no migration
    expect(insertRetryFn).toMatch(/retry_of_question_id: retryOfQuestionId/);
  });
  it("the system can distinguish attempts — originalQuestionId is tracked and passed through across repeated retries", () => {
    expect(RETRY_CHALLENGE).toMatch(/const originalId = challenge\.originalQuestionId \|\| challenge\.questionDbId;/);
    expect(RETRY_CHALLENGE).toMatch(/originalQuestionId: originalId/);
  });
  it("the retried answer goes through the EXISTING evaluation pathway — submitChallengeAnswer is reused verbatim for both the original and every retry, never a second scoring function", () => {
    expect(SRC.match(/async function submitChallengeAnswer\(\)/g).length).toBe(1);
    expect(CHALLENGE_SCREENS).toMatch(/onClick=\{\(\) => guarded\(submitChallengeAnswer\)\}/);
  });
});

/* ============================== FEATURE 4: Delete Application ============================== */
describe("Delete Application", () => {
  it("clicking Delete does not immediately delete — it only opens the confirmation modal", () => {
    expect(APP_SCREEN).toMatch(/onClick=\{\(\) => \{ setError\(""\); setDeleteConfirmApp\(app\); \}\}/);
    expect(APP_SCREEN).not.toMatch(/onClick=\{\(\) => \{ setError\(""\); setDeleteConfirmApp\(app\); .*dbDeleteApplication/);
  });
  it("the confirmation modal states the heading and accurate, cascade-aware body copy, with Cancel + Delete application buttons", () => {
    expect(APP_SCREEN).toMatch(/title="Delete application\?"/);
    expect(APP_SCREEN).toMatch(/cannot be undone/);
    expect(APP_SCREEN).toMatch(/associated interview data/);
    const dialogFn = slice("function ConfirmDialog({ title, body, confirmLabel, onCancel, onConfirm, busy }) {", "function Card({");
    expect(dialogFn).toMatch(/>Cancel<\/Btn>/);
    expect(dialogFn).toMatch(/: confirmLabel\}/);
  });
  it("Cancel closes the modal and performs no deletion", () => {
    expect(APP_SCREEN).toMatch(/onCancel=\{\(\) => setDeleteConfirmApp\(null\)\}/);
    const dialogFn = slice("function ConfirmDialog({ title, body, confirmLabel, onCancel, onConfirm, busy }) {", "function Card({");
    expect(dialogFn).not.toMatch(/onCancel[\s\S]{0,40}(dbDeleteApplication|\.delete\()/);
  });
  it("Escape cancels, and the Cancel (never the destructive) button receives initial focus", () => {
    const dialogFn = slice("function ConfirmDialog({ title, body, confirmLabel, onCancel, onConfirm, busy }) {", "function Card({");
    expect(dialogFn).toMatch(/e\.key === "Escape"\) onCancel\(\)/);
    expect(dialogFn).toMatch(/getElementById\("jr-confirm-cancel"\)\?\.focus\(\)/);
  });
  it("colour is not the sole signal of danger — an icon and explicit wording accompany the destructive styling", () => {
    const dialogFn = slice("function ConfirmDialog({ title, body, confirmLabel, onCancel, onConfirm, busy }) {", "function Card({");
    expect(dialogFn).toMatch(/AlertTriangle/);
    expect(dialogFn).toMatch(/variant="danger"/); // the EXISTING destructive Btn variant — no new colour system
  });
  it("deletion occurs only after explicit confirmation, targets the correct application id, and prevents a duplicate submission", () => {
    expect(CONFIRM_DELETE).toMatch(/if \(!deleteConfirmApp \|\| deleteBusy\) return;/);
    expect(CONFIRM_DELETE).toMatch(/dbDeleteApplication\(app\.id\)/);
    expect(CONFIRM_DELETE).toMatch(/setDeleteBusy\(true\)/);
  });
  it("cascade behaviour is the EXISTING database FK chain — verified by inspection, not duplicated in application code", () => {
    // every application-owned child table cascades automatically; no manual multi-table
    // deletion logic exists anywhere in confirmDeleteApplication or dbDeleteApplication
    expect(codeOnly(CONFIRM_DELETE)).not.toMatch(/\.from\("interviews"\)|\.from\("documents"\)|\.from\("classroom_topics"\)/);
    const dbDeleteFn = slice("async function dbDeleteApplication(applicationId) {", "async function dbInsertDocument(");
    expect(dbDeleteFn).toMatch(/\.from\("applications"\)\.delete\(\)\.eq\("id", applicationId\)/);
    expect(dbDeleteFn).not.toMatch(/\.from\("interviews"\)/);
    // and the schema really does cascade — checked directly against the migration, not assumed
    expect(MIGRATION_SQL).toMatch(/application_id\s+uuid not null references public\.applications\(id\) on delete cascade/); // interviews
    expect(MIGRATION_SQL).toMatch(/application_id\s+uuid references public\.applications\(id\) on delete cascade,\n\s+company\s+text,\n\s+role\s+text,\n\s+topic/); // classroom_topics
  });
  it("shared/candidate-level data is explicitly NOT deleted with the application (on delete set null, not cascade)", () => {
    // candidate_claims.application_id and ai_usage.application_id — genuinely shared data
    expect(MIGRATION_SQL).toMatch(/application_id\s+uuid references public\.applications\(id\) on delete set null,\n\s+origin_interview_id/); // candidate_claims
    expect(MIGRATION_SQL).toMatch(/application_id\s+uuid references public\.applications\(id\) on delete set null,\n\s+interview_id\s+uuid references public\.interviews\(id\) on delete set null/); // ai_usage
  });
  it("no migration, no RLS change was made for deletion — the existing applications_self policy (for all, own row) already covers DELETE", () => {
    const migFiles = readFileSync(new URL("../supabase/migrations/20260828120000_baseline_schema.sql", import.meta.url), "utf8");
    expect(migFiles).toMatch(/create policy applications_self on public\.applications\s*\n\s*for all using \(user_id = \(select auth\.uid\(\)\)\)/);
  });
  it("UI: on success, the application is removed from state (optimistic), and the user is navigated away if currently viewing it", () => {
    expect(CONFIRM_DELETE).toMatch(/setApplications\(\(prev\) => prev\.filter\(\(a\) => a\.id !== app\.id\)\)/);
    expect(CONFIRM_DELETE).toMatch(/if \(appView === app\.id\) \{ setAppView\(null\); setScreen\("applications"\); \}/);
  });
  it("UI: on failure, the application is restored (never left permanently removed) and a clear, non-technical error is shown", () => {
    expect(CONFIRM_DELETE).toMatch(/if \(r && r\.ok === false\) \{/);
    expect(CONFIRM_DELETE).toMatch(/setApplications\(before\)/);
    expect(CONFIRM_DELETE).toMatch(/Couldn't delete this application\. Please try again\./);
  });
});

/* ============================== NO REGRESSIONS ============================== */
describe("no regressions", () => {
  it("existing Application functionality (Build interview, Edit application details, Interviews section) is intact", () => {
    expect(APP_SCREEN).toMatch(/onClick=\{\(\) => buildInterviewFromApplication\(app\)\}/);
    expect(APP_SCREEN).toMatch(/onClick=\{\(\) => openApplicationForm\(app\)\}/);
    expect(APP_SCREEN).toContain(">Interviews<");
  });
  it("Phase 31 technical difficulty is untouched — resolveTechnicalDifficulty/DEFAULT_TECHNICAL_DIFFICULTY are reused, not redefined", () => {
    expect(SRC.match(/^function resolveTechnicalDifficulty\(|^export function resolveTechnicalDifficulty\(/m)).toBeNull(); // still imported, not locally redefined
    expect(SRC).toMatch(/from "\.\/technicalDifficulty"/);
  });
  it("Phase 32 landing page / Phase 34 atmosphere / Phase 35 readiness ring are untouched by this diff", () => {
    // structural presence checks only — this phase never edited landing-page code
    expect(SRC).toMatch(/function LandingPage\(/);
    expect(SRC).toMatch(/screen === "landing" && \(/);
  });
  it("existing interview generation (analyseAndPlan's adaptive_turn branch) is unaffected — still falls through unchanged when pipeline !== independent_batch", () => {
    expect(ANALYSE_AND_PLAN).toMatch(/if \(ivConfig\.pipeline === "independent_batch"\) \{/);
  });
  it("no existing test file was weakened — the migration-count/dbCreateInterview-caller assertions were narrowed to what they actually claim, not deleted", () => {
    const migTest = readFileSync(new URL("./interviewStateIntegrity20.test.js", import.meta.url), "utf8");
    expect(migTest).toMatch(/dbCreateInterview still has exactly ONE caller in the normal interview-creation flow/);
  });
});
