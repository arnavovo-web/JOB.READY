/* ================================================================== *
 * PHASE 20 — INTERVIEW STATE INTEGRITY & PROGRESS ACCURACY
 * ------------------------------------------------------------------
 * Regression coverage for three QA-confirmed issues:
 *  1. an existing in-progress interview is now surfaced at the ENTRY
 *     POINT (before the wizard), for every application-level "Build
 *     interview" path — with the analyseAndPlan guard kept as backstop.
 *  2. the resume-progress denominator uses the CONFIGURED interview
 *     target, never "questions generated so far".
 *  3. an application can never show "Interview in progress" AND
 *     "No interviews for this application yet" at the same time.
 *
 * Behavioural where a pure helper allows (resumeInterview.js), structural
 * for the App() wiring.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resumableTarget, resumableProgressLabel, summariseResumable } from "./resumeInterview.js";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
function slice(a, b) {
  const s = SRC.indexOf(a);
  if (s === -1) throw new Error(`start marker not found: ${a}`);
  const e = SRC.indexOf(b, s + a.length);
  if (e === -1) throw new Error(`end marker not found: ${b}`);
  return SRC.slice(s, e);
}
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ===================== ISSUE 2 — denominator (behavioural) ===================== */
describe("resumableTarget — configured target, never the generated count", () => {
  it("adaptive: config.max_questions wins (the wizard Length); approximate", () => {
    // QA repro: Standard=12, 4 questions generated, 3 answered
    expect(resumableTarget({ max_questions: 12, question_count: 15 }, "adaptive_turn", 4))
      .toEqual({ target: 12, approximate: true });
  });
  it("adaptive: no max_questions -> falls back to config.question_count (legacy row); still approximate", () => {
    expect(resumableTarget({ question_count: 10 }, "adaptive_turn", 3))
      .toEqual({ target: 10, approximate: true });
  });
  it("adaptive: neither configured -> generated count is the LAST resort only", () => {
    expect(resumableTarget({}, "adaptive_turn", 5)).toEqual({ target: 5, approximate: true });
    expect(resumableTarget(null, "adaptive_turn", 0)).toEqual({ target: 0, approximate: true });
  });
  it("batch: config.question_count is the EXACT target; not approximate", () => {
    expect(resumableTarget({ question_count: 8, max_questions: 12 }, "independent_batch", 8))
      .toEqual({ target: 8, approximate: false });
  });
  it("batch: no question_count -> generated count fallback, still exact", () => {
    expect(resumableTarget({}, "independent_batch", 5)).toEqual({ target: 5, approximate: false });
  });
  it("never throws on garbage", () => {
    expect(() => resumableTarget("x", 5, "y")).not.toThrow();
    expect(resumableTarget("x", 5, "y")).toEqual({ target: 0, approximate: true });
  });
});

describe("resumableProgressLabel — one shared sentence, config target, ~ only for adaptive", () => {
  it('adaptive -> "3 of ~12 questions answered"', () => {
    expect(resumableProgressLabel({ answeredCount: 3, targetQuestions: 12, targetApproximate: true }))
      .toBe("3 of ~12 questions answered");
  });
  it('batch -> "3 of 12 questions answered" (no tilde)', () => {
    expect(resumableProgressLabel({ answeredCount: 3, targetQuestions: 12, targetApproximate: false }))
      .toBe("3 of 12 questions answered");
  });
  it('unknown target -> "3 of ? questions answered", never the generated count', () => {
    expect(resumableProgressLabel({ answeredCount: 3, targetQuestions: 0 }))
      .toBe("3 of ? questions answered");
  });
  it('singular "1 question"', () => {
    expect(resumableProgressLabel({ answeredCount: 0, targetQuestions: 1, targetApproximate: true }))
      .toBe("0 of ~1 question answered");
  });
  it("garbage-safe", () => {
    expect(() => resumableProgressLabel(null)).not.toThrow();
    expect(resumableProgressLabel(null)).toBe("0 of ? questions answered");
  });
});

describe("summariseResumable now carries the configured target, decoupled from generated count", () => {
  const row = (config) => ({ id: "iv1", application_id: "app1", stage: "first_round", created_at: "2026-08-30T00:00:00Z", config });
  it("QA repro: max_questions 12, 4 generated, 3 answered -> targetQuestions 12 (approx), totalQuestions 4", () => {
    const s = summariseResumable(
      row({ pipeline: "adaptive_turn", max_questions: 12, question_count: 15, profile: { interview_profile: {} } }),
      { total: 4, answered: 3 },
      { company: "Morgan Stanley", role: "IBD Analyst" },
    );
    expect(s.answeredCount).toBe(3);
    expect(s.totalQuestions).toBe(4);        // raw generated count preserved for other consumers
    expect(s.targetQuestions).toBe(12);      // the DISPLAY denominator
    expect(s.targetApproximate).toBe(true);
    expect(resumableProgressLabel(s)).toBe("3 of ~12 questions answered");
  });
  it("batch: targetQuestions = question_count, exact", () => {
    const s = summariseResumable(
      row({ pipeline: "independent_batch", question_count: 8, profile: { interview_profile: {} } }),
      { total: 8, answered: 2 }, { company: "C", role: "R" },
    );
    expect(s.targetQuestions).toBe(8);
    expect(s.targetApproximate).toBe(false);
    expect(resumableProgressLabel(s)).toBe("2 of 8 questions answered");
  });
  it("legacy row (no config target at all): last-resort generated count, still not crashing", () => {
    const s = summariseResumable(row({ pipeline: "adaptive_turn" }), { total: 2, answered: 1 }, { company: "C", role: "R" });
    expect(s.targetQuestions).toBe(2);
    expect(s.hasProfile).toBe(false);
  });
});

describe("resumeInterview.js: interview_length is NOT part of the target chain", () => {
  it("applications.interview_length is deliberately not consulted (shared, last-write-wins)", () => {
    const fn = readFileSync(new URL("./resumeInterview.js", import.meta.url), "utf8");
    const target = fn.slice(fn.indexOf("export function resumableTarget"), fn.indexOf("export function resumableProgressLabel"));
    expect(target).not.toMatch(/interview_length/);
  });
});

/* ===================== ISSUE 1 — entry-point guard (structural) ===================== */
const MAYBE = slice("function maybeOfferResume(appId, next) {", "function buildInterviewFromApplication(app) {");
const BIFF = slice("function buildInterviewFromApplication(app) {", "/* ---------------- PHASE 18: RESUME AN UNFINISHED INTERVIEW");
// Phase 38 integration: practiseApplicationAgain's own body is now tightly scoped to just
// opening the confirmation modal — the marker ends at cancelPractiseAgain (the very next
// declaration), not the much later PHASE 16A comment, so this slice can never silently sweep
// in startPractiseAgain/practiseAgainConfigFor/confirmPractiseAgain as if they were still part
// of practiseApplicationAgain itself.
const AGAIN = slice("function practiseApplicationAgain(app) {", "function cancelPractiseAgain()");
// The Phase 38 fallback path (startPractiseAgain, reached only for a genuinely incomplete
// legacy config) is where maybeOfferResume now actually lives for this entry point.
const START_AGAIN = slice("async function startPractiseAgain(app) {", "function confirmPractiseAgain()");
const CONT = slice("async function continueApplication(app) {", "/* ---------------- PHASE 38: PRACTISE AGAIN (frictionless repeat interview) ---------------- */");
const ANALYSE_HEAD = slice("async function analyseAndPlan() {", "const cleanCompany = sanitizeText(company)");

describe("ISSUE 1 — resume is surfaced at the entry point, for every application build path", () => {
  it("maybeOfferResume: in-memory check only — no AI, no DB, routes to resume_choice", () => {
    expect(codeOnly(MAYBE)).not.toMatch(/callClaude|ai-generate|getSupabase|dbSelect|\.from\(/);
    expect(MAYBE).toMatch(/resumableInterviews\.find\(\(r\) => r\.applicationId === appId && r\.hasProfile\)/);
    expect(MAYBE).toMatch(/setResumeChoice\(\{ \.\.\.existing, next \}\)/);
    expect(MAYBE).toMatch(/setScreen\("resume_choice"\)/);
    expect(MAYBE).toMatch(/return true;/);
  });
  it("buildInterviewFromApplication (both application 'Build interview' CTAs) guards before the wizard", () => {
    expect(BIFF).toMatch(/if \(!maybeOfferResume\(app\.id, "wizard"\)\) setScreen\("create"\)/);
    // the wizard state is still fully set up first (so 'Start New' lands configured)
    expect(BIFF).toMatch(/setApplicationId\(app\.id\)/);
    expect(BIFF).toMatch(/setQuestionMix\(\{ technical: false, behavioural: false, motivational: false \}\)/);
  });
  it("Phase 38 integration: practiseApplicationAgain itself no longer routes to the wizard at all — it only opens the 'Create a new interview?' confirmation modal (no AI/DB call, no maybeOfferResume of its own)", () => {
    expect(AGAIN).toMatch(/setPractiseAgainConfirmApp\(app\)/);
    expect(AGAIN).not.toMatch(/setScreen\(|maybeOfferResume/);
  });
  it("the ORIGINAL guarantee (an in-progress interview is surfaced before spending an AI call) still holds for this entry point: startPractiseAgain's legacy-config fallback still guards via maybeOfferResume, and its normal (complete-config) path reaches analyseAndPlan's own built-in Phase 18 guard directly", () => {
    expect(START_AGAIN).toMatch(/if \(!maybeOfferResume\(app\.id, "wizard"\)\) setScreen\("create"\)/);
    expect(START_AGAIN).toMatch(/analyseAndPlan\(\);/);
  });
  it("continueApplication guards too (early-return before the doc prefetch)", () => {
    expect(CONT).toMatch(/if \(maybeOfferResume\(app\.id, "wizard"\)\) return;/);
    expect(CONT.indexOf('maybeOfferResume(app.id, "wizard")')).toBeLessThan(CONT.indexOf('setScreen("create")'));
  });
  it("BACKSTOP retained: analyseAndPlan still guards at the creation boundary, before callClaude", () => {
    expect(ANALYSE_HEAD).toMatch(/if \(!forceNewRef\.current\) \{[\s\S]*?resumableInterviews\.find\(\(r\) => r\.applicationId === applicationId && r\.hasProfile\)[\s\S]*?setResumeChoice\(\{ \.\.\.existing, next: "generate" \}\); setScreen\("resume_choice"\); return;/);
  });
  it("dbCreateInterview still has exactly ONE caller in the normal interview-creation flow (analyseAndPlan)", () => {
    // Phase B added a second, deliberate caller — startChallengeMe (Challenge Me creates its
    // own tiny single-question `interviews` row, reusing this SAME existing function rather
    // than a parallel one). This assertion is scoped to what Phase 20 actually claims: the
    // NORMAL interview-creation flow (analyseAndPlan) still has exactly one call.
    const analyseFull = slice("async function analyseAndPlan() {", "function beginInterview()");
    expect((analyseFull.match(/\bdbCreateInterview\(/g) || []).length).toBe(1);
  });
  it("Phase B's startChallengeMe is a second, deliberate dbCreateInterview caller — not an accidental duplicate creation path", () => {
    const challengeFn = slice("async function startChallengeMe(app) {", "async function submitChallengeAnswer() {");
    expect((challengeFn.match(/\bdbCreateInterview\(/g) || []).length).toBe(1);
    const totalCallers = (SRC.match(/\bdbCreateInterview\(/g) || []).length - 1; // minus the definition itself
    expect(totalCallers).toBe(2); // analyseAndPlan + startChallengeMe, no others
  });
  it("NO database uniqueness constraint / migration was added FOR THIS PHASE (deliberate: a second interview is allowed, just confirmed)", () => {
    // Phase 37 later added its own, unrelated migration (applications.checklist) — this
    // assertion is about Phase 20 specifically, so it checks that file's ABSENCE rather than
    // an exact/exhaustive migration list (which would make this test fail every time any
    // later, unrelated phase adds its own migration).
    const { readdirSync } = require("node:fs");
    const migs = readdirSync(new URL("../supabase/migrations", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
    expect(migs).not.toEqual(expect.arrayContaining([expect.stringMatching(/interview.*unique|unique.*interview/i)]));
    expect(migs).toEqual(expect.arrayContaining(["20260828120000_baseline_schema.sql", "20260828135856_development_modules.sql"]));
  });
  it("Start New never deletes/mutates the existing interview", () => {
    const choice = slice('screen === "resume_choice" && resumeChoice && (', "{/* ---------------- CREATE (progressive wizard) ---------------- */}");
    expect(codeOnly(choice)).not.toMatch(/\.delete\(\)|dbDelete|removeInterview|\.update\(\{[^}]*status/);
    expect(choice).toMatch(/forceNewRef\.current = true;/);        // one-shot bypass, not a mutation
  });
});

/* ===================== ISSUE 2 — render sites use the shared helper ===================== */
describe("ISSUE 2 — every progress surface renders the configured target", () => {
  it("Dashboard card, Application card, and resume_choice all call resumableProgressLabel", () => {
    const dash = slice('screen === "dashboard" && user && (', "PHASE 16A — APPLICATIONS PILLAR");
    const appscreen = slice("{/* ---------------- APPLICATION OVERVIEW (workspace) ---------------- */}", "{/* ---------------- PHASE 18: RESUME-OR-START-NEW CHOICE ---------------- */}");
    const choice = slice('screen === "resume_choice" && resumeChoice && (', "{/* ---------------- CREATE (progressive wizard) ---------------- */}");
    expect(dash).toMatch(/\{resumableProgressLabel\(r\)\}/);
    expect(appscreen).toMatch(/\{resumableProgressLabel\(r\)\}/);
    expect(choice).toMatch(/\{resumableProgressLabel\(resumeChoice\)\}/);
    // the old generated-count denominator is gone from all three
    expect(dash + appscreen + choice).not.toMatch(/of \{r\.totalQuestions \|\| "\?"\}/);
  });
});

/* ===================== ISSUE 3 — mutually consistent application panels ===================== */
describe("ISSUE 3 — application never shows 'in progress' AND 'no interviews yet'", () => {
  const APPSCREEN = slice("{/* ---------------- APPLICATION OVERVIEW (workspace) ---------------- */}", "{/* ---------------- PHASE 18: RESUME-OR-START-NEW CHOICE ---------------- */}");
  it("one derived application-level view: appResumable computed from the in-progress list", () => {
    expect(APPSCREEN).toMatch(/const appResumable = resumableInterviews\.filter\(\(r\) => r\.applicationId === app\.id\)/);
  });
  it("the 'No interviews yet' empty state requires BOTH no completed AND no in-progress", () => {
    expect(APPSCREEN).toMatch(/\{appInterviews\.length === 0 && appResumable\.length === 0 \? \(/);
    expect(APPSCREEN).toMatch(/No interviews for this application yet/);
  });
  it("in-progress-only apps get an honest middle state instead of the contradiction", () => {
    expect(APPSCREEN).toMatch(/\) : appInterviews\.length === 0 \? \(/);
    expect(APPSCREEN).toMatch(/No completed interviews yet — your in-progress one is above\./);
  });
  it("not a CSS-only hack — it is a state-level condition on the render branch", () => {
    // the empty-state text is only reachable when both counts are 0
    const emptyIdx = APPSCREEN.indexOf("No interviews for this application yet");
    const condIdx = APPSCREEN.indexOf("appInterviews.length === 0 && appResumable.length === 0");
    expect(condIdx).toBeGreaterThan(-1);
    expect(condIdx).toBeLessThan(emptyIdx);
    expect(APPSCREEN).not.toMatch(/display:\s*["']?none|visibility:\s*hidden/);
  });
});

/* ===================== regression: no new AI, resume unchanged ===================== */
describe("regression — no new AI calls, resume path untouched", () => {
  it("Phase 20 helpers make no AI call", () => {
    const resumeSrc = readFileSync(new URL("./resumeInterview.js", import.meta.url), "utf8");
    expect(codeOnly(MAYBE)).not.toMatch(/callClaude|ai-generate|functions\.invoke/);
    expect(codeOnly(resumeSrc)).not.toMatch(/callClaude|ai-generate|functions\.invoke|\bfetch\s*\(|\.from\s*\(/);
  });
  it("resumeInterviewById is unchanged in substance (still 0-AI deterministic reconstruction)", () => {
    const resume = slice("async function resumeInterviewById(interviewId) {", "/* ---------------- PHASE 7: INTERVIEW INVITATION SCANNER");
    expect(codeOnly(resume)).not.toMatch(/callClaude|ai-generate|generateAndPersistNextQuestion|generateQuestionBatch/);
    expect(resume).toMatch(/reconstructInterviewState\(\{ interviewRow: row, questions, meta \}\)/);
  });
  it("loadFullUserState still loads in_progress interviews as metadata only", () => {
    const load = slice("async function loadFullUserState(userId) {", "async function dbCreateApplication(");
    expect(load).toMatch(/\.eq\("status", "in_progress"\)/);
    expect(load).toMatch(/summariseResumable\(row, countsByIv\.get\(row\.id\)/);
  });
});
