/* ================================================================== *
 * PHASE 37 — APPLICATION PREPARATION INTELLIGENCE (Phase A)
 * ------------------------------------------------------------------
 * applicationPreparation.js is pure/offline, so most of this file is real
 * BEHAVIOURAL testing against the actual implementation (not string
 * matching). A smaller STRUCTURAL section (same source-text-inspection
 * convention as reportUX.test.js / applications16aIntegration.test.js)
 * covers how App.jsx actually wires these functions into the existing
 * Application Overview screen, since App() is a React closure this
 * node-environment suite can't render directly.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  getPractisedDimensions, getPreparationGaps, getApplicationPreparationStatus,
  getNextRecommendedAction, getAutoChecklistItems, getManualChecklistDefinitions, mergeChecklist,
} from "./applicationPreparation.js";

const SOURCE = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
function slice(startMarker, endMarker) {
  const s = SOURCE.indexOf(startMarker);
  if (s === -1) throw new Error(`marker not found in App.jsx: ${startMarker}`);
  const e = SOURCE.indexOf(endMarker, s + startMarker.length);
  if (e === -1) throw new Error(`end marker not found in App.jsx: ${endMarker}`);
  return SOURCE.slice(s, e);
}
const APP_SCREEN = slice('{/* ---------------- APPLICATION OVERVIEW (workspace) ---------------- */}', '{/* ---------------- PHASE 18: RESUME-OR-START-NEW CHOICE ---------------- */}');

/* ============================== purity ============================== */
describe("applicationPreparation.js is pure & offline", () => {
  it("no AI / DB / network / timers / React", () => {
    const src = readFileSync(new URL("./applicationPreparation.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/callClaude|supabase|fetch\(|setTimeout|setInterval|from ["']react["']/);
  });
});

/* ============================== application isolation ============================== */
describe("application-specific isolation — Application A's data never leaks into Application B's", () => {
  it("getPractisedDimensions only reflects the categories it was actually given", () => {
    // Application A: only technical categories asked. Application B: only motivational.
    const dimsA = getPractisedDimensions(["technical_functional", "technical_functional"]);
    const dimsB = getPractisedDimensions(["motivation_fit"]);
    expect(dimsA).toEqual(["technical"]);
    expect(dimsB).toEqual(["motivational"]);
    // practising for A never shows up when computing B's gaps
    const gapsB = getPreparationGaps({ practisedDimensions: dimsB });
    expect(gapsB.gaps.map((g) => g.dimension)).not.toContain("motivational");
    expect(gapsB.gaps.map((g) => g.dimension)).toEqual(expect.arrayContaining(["technical", "behavioural"]));
  });

  it("getNextRecommendedAction for two applications with different histories never cross-contaminates", () => {
    const goldman = getNextRecommendedAction({ completedInterviewCount: 2, gaps: [{ dimension: "technical", label: "Technical Knowledge" }] });
    const deloitte = getNextRecommendedAction({ completedInterviewCount: 0, gaps: [] });
    expect(goldman.actionKind).toBe("build_interview");
    expect(goldman.title).toMatch(/technical knowledge/i);
    expect(deloitte.title).toBe("Start your first practice interview");
  });

  it("mergeChecklist reads only the manualState object it is given — one application's ticks never appear on another's", () => {
    const auto = getAutoChecklistItems({ completedInterviewCount: 0, practisedDimensions: [], hasFeedback: false });
    const manualDefs = getManualChecklistDefinitions({ hasJobDescription: false });
    const appAState = { manual_researched_company: true };
    const appBState = {};
    const mergedA = mergeChecklist(auto, manualDefs, appAState);
    const mergedB = mergeChecklist(auto, manualDefs, appBState);
    expect(mergedA.items.find((i) => i.id === "manual_researched_company").done).toBe(true);
    expect(mergedB.items.find((i) => i.id === "manual_researched_company").done).toBe(false);
  });
});

/* ============================== FEATURE 1: "Have I prepared enough?" ============================== */
describe("getApplicationPreparationStatus — real signals only, never a fabricated percentage", () => {
  it("no practice at all -> just_starting", () => {
    const s = getApplicationPreparationStatus({ completedInterviewCount: 0, practisedDimensionCount: 0, totalDimensions: 3 });
    expect(s.level).toBe("just_starting");
    expect(s.summary).toMatch(/haven't started/i);
  });
  it("some practice, coverage below half -> building", () => {
    const s = getApplicationPreparationStatus({ completedInterviewCount: 1, practisedDimensionCount: 1, totalDimensions: 3 });
    expect(s.level).toBe("building");
  });
  it("coverage at/above half but a real gap remains -> good_progress", () => {
    const s = getApplicationPreparationStatus({ completedInterviewCount: 2, practisedDimensionCount: 2, totalDimensions: 3, hasFeedback: true });
    expect(s.level).toBe("good_progress");
    expect(s.summary).toMatch(/still areas you haven't covered/i);
  });
  it("full coverage, no known weak area -> well_prepared", () => {
    const s = getApplicationPreparationStatus({ completedInterviewCount: 3, practisedDimensionCount: 3, totalDimensions: 3, hasFeedback: true, hasWeakAreaRemaining: false });
    expect(s.level).toBe("well_prepared");
  });
  it("full coverage but a demonstrated weak area still counts as a remaining gap (never a fabricated 'well prepared')", () => {
    const s = getApplicationPreparationStatus({ completedInterviewCount: 3, practisedDimensionCount: 3, totalDimensions: 3, hasFeedback: true, hasWeakAreaRemaining: true });
    expect(s.level).toBe("good_progress");
  });
  it("no reliably linked historical data (all zero/false inputs) -> the honest just_starting state, never an invented number", () => {
    const s = getApplicationPreparationStatus({});
    expect(s.level).toBe("just_starting");
    expect(typeof s.summary).toBe("string");
    expect(s.summary).not.toMatch(/%|percent/i);
  });
  it("signals are plain-text ok/label pairs, never a numeric score presented as ground truth", () => {
    const s = getApplicationPreparationStatus({ completedInterviewCount: 1, practisedDimensionCount: 1, totalDimensions: 3, hasFeedback: true });
    expect(Array.isArray(s.signals)).toBe(true);
    for (const sig of s.signals) { expect(typeof sig.ok).toBe("boolean"); expect(typeof sig.label).toBe("string"); }
  });
  it("checklist signal only appears when a checklist actually exists (checklistTotal > 0)", () => {
    const withChecklist = getApplicationPreparationStatus({ completedInterviewCount: 1, practisedDimensionCount: 1, totalDimensions: 3, checklistDone: 2, checklistTotal: 5 });
    const withoutChecklist = getApplicationPreparationStatus({ completedInterviewCount: 1, practisedDimensionCount: 1, totalDimensions: 3 });
    expect(withChecklist.signals.some((s) => /checklist/i.test(s.label))).toBe(true);
    expect(withoutChecklist.signals.some((s) => /checklist/i.test(s.label))).toBe(false);
  });
});

/* ============================== FEATURE 2: "You haven't practised this" ============================== */
describe("getPreparationGaps — honest, neutral, never overstating", () => {
  it("no categories practised -> all three are gaps", () => {
    const { gaps, allCovered } = getPreparationGaps({ practisedDimensions: [] });
    expect(gaps.map((g) => g.dimension)).toEqual(["technical", "behavioural", "motivational"]);
    expect(allCovered).toBe(false);
  });
  it("one category practised -> the other two are gaps, in canonical order", () => {
    const { gaps } = getPreparationGaps({ practisedDimensions: ["behavioural"] });
    expect(gaps.map((g) => g.dimension)).toEqual(["technical", "motivational"]);
  });
  it("two categories practised -> exactly one gap", () => {
    const { gaps } = getPreparationGaps({ practisedDimensions: ["technical", "motivational"] });
    expect(gaps.map((g) => g.dimension)).toEqual(["behavioural"]);
  });
  it("all three practised -> allCovered true, zero gaps (the positive, restrained empty state)", () => {
    const { gaps, allCovered } = getPreparationGaps({ practisedDimensions: ["technical", "behavioural", "motivational"] });
    expect(gaps).toEqual([]);
    expect(allCovered).toBe(true);
  });
  it("missing/legacy input (undefined, not an array) never throws and is treated as zero practice", () => {
    expect(() => getPreparationGaps({})).not.toThrow();
    expect(() => getPreparationGaps({ practisedDimensions: undefined })).not.toThrow();
    expect(getPreparationGaps({}).gaps.length).toBe(3);
  });
  it("getPractisedDimensions maps legacy/canonical categories through the SAME questionMix.js partition the scheduler uses — never a forked taxonomy", () => {
    // situational_judgement and behavioural_competency are both "behavioural"; commercial_awareness is "technical"
    expect(getPractisedDimensions(["situational_judgement"])).toEqual(["behavioural"]);
    expect(getPractisedDimensions(["commercial_awareness"])).toEqual(["technical"]);
    expect(getPractisedDimensions(["motivation_fit"])).toEqual(["motivational"]);
    // An unrecognised category falls through mapLegacyCategory's OWN existing default
    // (behavioural_competency) — the same fallback every other caller in the app already
    // gets; this module deliberately does not add a second, different unknown-category rule.
    expect(getPractisedDimensions(["not_a_real_category"])).toEqual(["behavioural"]);
  });
});

/* ============================== FEATURE 3: "What should I do next?" ============================== */
describe("getNextRecommendedAction — deterministic priority chain, ZERO AI calls", () => {
  it("Priority 1: no completed interview -> start first practice, regardless of any other input", () => {
    const a = getNextRecommendedAction({ completedInterviewCount: 0, gaps: [{ dimension: "technical", label: "Technical Knowledge" }], weakAreaRecommendation: { label: "DCF" }, incompleteChecklistItems: [{ id: "x", label: "y" }] });
    expect(a.title).toBe("Start your first practice interview");
    expect(a.actionKind).toBe("build_interview");
  });
  it("Priority 2: an unpractised category exists -> practise that category (the FIRST gap, deterministically)", () => {
    const a = getNextRecommendedAction({ completedInterviewCount: 1, gaps: [{ dimension: "behavioural", label: "Behavioural / Competency" }, { dimension: "motivational", label: "Motivational" }] });
    expect(a.title).toMatch(/behavioural/i);
    expect(a.actionKind).toBe("build_interview");
  });
  it("Priority 3: a real weak area exists (once no gaps remain) -> improve that weak area", () => {
    const a = getNextRecommendedAction({ completedInterviewCount: 1, gaps: [], weakAreaRecommendation: { label: "Commercial awareness", gapSummary: "Your answers on this have been weak." } });
    expect(a.title).toMatch(/commercial awareness/i);
    expect(a.actionKind).toBe("develop_weak_area");
    expect(a.subtitle).toMatch(/weak/i);
  });
  it("Priority 4: checklist incomplete (once no gaps and no weak area) -> the relevant checklist item", () => {
    const a = getNextRecommendedAction({ completedInterviewCount: 1, gaps: [], weakAreaRecommendation: null, incompleteChecklistItems: [{ id: "manual_reviewed_cv", label: "Reviewed my CV" }] });
    expect(a.title).toBe("Reviewed my CV");
    expect(a.actionKind).toBe("open_checklist");
  });
  it("Priority 5: everything measurable complete -> keep practising", () => {
    const a = getNextRecommendedAction({ completedInterviewCount: 3, gaps: [], weakAreaRecommendation: null, incompleteChecklistItems: [] });
    expect(a.title).toBe("Keep practising");
    expect(a.actionKind).toBe("build_interview");
  });
  it("no default arguments crash it — missing input degrades to Priority 1, never throws", () => {
    expect(() => getNextRecommendedAction()).not.toThrow();
    expect(getNextRecommendedAction().title).toBe("Start your first practice interview");
  });
  it("introduces ZERO callClaude calls / new AI request types anywhere in its own source or its module", () => {
    const src = readFileSync(new URL("./applicationPreparation.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/callClaude|requestType/);
  });
});

/* ============================== FEATURE 4: Interview Checklist ============================== */
describe("Interview Checklist — auto + manual, application-specific persistence", () => {
  it("auto items complete automatically from real activity, and ONLY from real activity", () => {
    const items = getAutoChecklistItems({ completedInterviewCount: 1, practisedDimensions: ["technical", "motivational"], hasFeedback: true });
    expect(items.find((i) => i.id === "auto_completed_practice").done).toBe(true);
    expect(items.find((i) => i.id === "auto_practised_technical").done).toBe(true);
    expect(items.find((i) => i.id === "auto_practised_motivational").done).toBe(true);
    expect(items.find((i) => i.id === "auto_practised_behavioural").done).toBe(false);
    expect(items.find((i) => i.id === "auto_received_feedback").done).toBe(true);
  });
  it("manual items are only definitions (not-done) until a manual state says otherwise", () => {
    const defs = getManualChecklistDefinitions({ hasJobDescription: true });
    expect(defs.every((d) => !("done" in d))).toBe(true);
  });
  it("'Reviewed the job description' is only included when a JD actually exists — never a requirement the application's data can't support", () => {
    const withJd = getManualChecklistDefinitions({ hasJobDescription: true });
    const withoutJd = getManualChecklistDefinitions({ hasJobDescription: false });
    expect(withJd.some((d) => d.id === "manual_reviewed_jd")).toBe(true);
    expect(withoutJd.some((d) => d.id === "manual_reviewed_jd")).toBe(false);
  });
  it("manual completion persists via the merge — ticking one item does not affect the others", () => {
    const auto = getAutoChecklistItems({ completedInterviewCount: 0, practisedDimensions: [], hasFeedback: false });
    const defs = getManualChecklistDefinitions({ hasJobDescription: true });
    const merged = mergeChecklist(auto, defs, { manual_reviewed_cv: true });
    expect(merged.items.find((i) => i.id === "manual_reviewed_cv").done).toBe(true);
    expect(merged.items.find((i) => i.id === "manual_researched_company").done).toBe(false);
    expect(merged.doneCount).toBe(1);
  });
  it("legacy/pre-Phase-37 applications (manualState null/undefined) are handled gracefully — never an error, never everything falsely marked done", () => {
    const auto = getAutoChecklistItems({ completedInterviewCount: 0, practisedDimensions: [], hasFeedback: false });
    const defs = getManualChecklistDefinitions({ hasJobDescription: false });
    expect(() => mergeChecklist(auto, defs, null)).not.toThrow();
    expect(() => mergeChecklist(auto, defs, undefined)).not.toThrow();
    const merged = mergeChecklist(auto, defs, null);
    expect(merged.items.filter((i) => i.kind === "manual").every((i) => !i.done)).toBe(true);
  });
  it("progress count reflects the true fraction of the actual item set", () => {
    const auto = getAutoChecklistItems({ completedInterviewCount: 1, practisedDimensions: ["technical"], hasFeedback: false }); // 2 of 5 auto done
    const defs = getManualChecklistDefinitions({ hasJobDescription: true }); // 5 manual defs
    const merged = mergeChecklist(auto, defs, { manual_researched_company: true, manual_reviewed_jd: true }); // +2 manual done
    expect(merged.totalCount).toBe(10);
    expect(merged.doneCount).toBe(4);
  });
});

/* ============================== NO REGRESSIONS ============================== */
describe("no regressions — existing Application screen structure and other systems are intact", () => {
  it("the Application Overview screen still renders the existing 'Interviews', 'Application details' and 'Progress' sections", () => {
    expect(APP_SCREEN).toContain(">Interviews<");
    expect(APP_SCREEN).toContain(">Application details<");
    expect(APP_SCREEN).toContain(">Progress<");
  });
  it("'Build interview' and 'Edit application details' actions are still present and wired to the existing functions", () => {
    expect(APP_SCREEN).toMatch(/onClick=\{\(\) => buildInterviewFromApplication\(app\)\}/);
    expect(APP_SCREEN).toMatch(/onClick=\{\(\) => openApplicationForm\(app\)\}/);
  });
  it("the Phase 36 interview-date countdown pill is untouched", () => {
    expect(APP_SCREEN).toMatch(/const cd = interviewCountdown\(app\.interviewDate\);/);
    expect(APP_SCREEN).toMatch(/\{cd\.status !== "none" && \(/);
  });
  it("Phase 37's own new sections are present in the Application screen, each with its own heading", () => {
    expect(APP_SCREEN).toContain("What should you do next?");
    expect(APP_SCREEN).toContain("Preparation status");
    expect(APP_SCREEN).toContain("Are you ready?");
    expect(APP_SCREEN).toContain("You haven't practised this");
    expect(APP_SCREEN).toContain("Interview Checklist");
  });
  it("no new screen / route / hub was introduced for this phase", () => {
    expect(SOURCE).not.toMatch(/screen === "preparation_hub"|screen === "application_preparation"/);
  });
});
