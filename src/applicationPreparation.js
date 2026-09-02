/* ================================================================== *
 * PHASE 37 — APPLICATION PREPARATION INTELLIGENCE (Phase A)
 * ------------------------------------------------------------------
 * Pure, deterministic, offline (no AI, no DB, no React, no timers, never
 * throws). Four small features, all application-scoped:
 *
 *   1. getApplicationPreparationStatus — "Have I prepared enough?"
 *   2. getPreparationGaps             — "You haven't practised this"
 *   3. getNextRecommendedAction       — "What should I do next?"
 *   4. getAutoChecklistItems / getManualChecklistDefinitions / mergeChecklist
 *                                     — the Interview Checklist
 *
 * DATA MODEL (see App.jsx for how these are actually assembled):
 *   - "practised dimensions" = the set of {"technical","behavioural",
 *     "motivational"} this APPLICATION's own interview_questions rows
 *     (via interviews.application_id, the reliable FK) actually cover —
 *     ground truth of what was ASKED, not merely selected in a wizard's
 *     question_mix. Mapped through questionMix.js's own
 *     questionMixTypeForCategory — the SAME partition the scheduler/wizard
 *     already uses, never a second/forked taxonomy.
 *   - "weak area" (Priority 3) is never computed here — it is read
 *     verbatim from applicationIntelligence.js's own
 *     applicationDevelopmentPriorities() output (the existing, already-
 *     approved cross-reference of this application's JD emphasis against
 *     the candidate's global demonstrated competency evidence). This
 *     module only consumes that result; it never re-derives "weakness".
 *
 * APPLICATION ISOLATION: every function here takes already-application-
 * scoped inputs (this application's own interviews/questions/checklist) —
 * there is no global fallback anywhere, by construction. A caller that
 * mixes up which application's data it passes in is a caller bug, not
 * something this module can detect — see applicationPreparation.test.js
 * for the explicit cross-application isolation tests.
 * ================================================================== */
import { QUESTION_MIX_TYPES, QUESTION_MIX_OPTIONS, questionMixTypeForCategory } from "./questionMix.js";

function arr(v) { return Array.isArray(v) ? v : []; }
function num(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }

const DIMENSION_LABEL = Object.fromEntries(QUESTION_MIX_OPTIONS.map((o) => [o.type, o.label]));

/* ==================== shared: practised dimensions ==================== */

/**
 * getPractisedDimensions(questionCategories) -> string[] (subset of QUESTION_MIX_TYPES, in
 * canonical order)
 *
 * questionCategories: string[] — raw `interview_questions.category` values for THIS
 * application's own (already-scoped by the caller) questions. Legacy/unknown categories map
 * through mapLegacyCategory (inside questionMixTypeForCategory) exactly like everywhere else in
 * the app — never silently dropped, never a second taxonomy.
 */
export function getPractisedDimensions(questionCategories) {
  const seen = new Set();
  for (const c of arr(questionCategories)) {
    const type = questionMixTypeForCategory(c);
    if (type) seen.add(type);
  }
  return QUESTION_MIX_TYPES.filter((t) => seen.has(t));
}

/* ==================== FEATURE 2: "You haven't practised this" ==================== */

/**
 * getPreparationGaps({ practisedDimensions }) -> { gaps: [{dimension,label}], allCovered: bool }
 *
 * gaps: the dimensions NOT in practisedDimensions, in canonical order. Always all-or-nothing
 * honest — never invents a gap that isn't real, never hides a real one. allCovered is true only
 * when every one of the three dimensions has been practised (the positive, restrained empty
 * state — see the UI's own copy for the exact wording).
 */
export function getPreparationGaps({ practisedDimensions } = {}) {
  const practised = new Set(arr(practisedDimensions));
  const gaps = QUESTION_MIX_TYPES.filter((t) => !practised.has(t)).map((t) => ({ dimension: t, label: DIMENSION_LABEL[t] }));
  return { gaps, allCovered: gaps.length === 0 };
}

/* ==================== FEATURE 1: "Have I prepared enough?" ==================== */

const READINESS_LEVELS = [
  { level: "just_starting", label: "Just getting started" },
  { level: "building", label: "Building preparation" },
  { level: "good_progress", label: "Making good progress" },
  { level: "well_prepared", label: "Well prepared" },
];

/**
 * getApplicationPreparationStatus({
 *   completedInterviewCount, practisedDimensionCount, totalDimensions,
 *   hasFeedback, hasWeakAreaRemaining, checklistDone, checklistTotal,
 * }) -> { level, label, summary, signals: [{ ok, label }] }
 *
 * A DETERMINISTIC state, not a fabricated percentage — see the module docstring. The level is
 * derived from three simple, real, always-available counts (never AI, never an application-
 * intelligence dependency, so this works identically whether or not the application has been
 * "Analysed"):
 *   0 completed interviews                                -> just_starting
 *   >=1 completed interview, but dimension coverage < half -> building
 *   dimension coverage >= half, but real gaps remain       -> good_progress
 *   full dimension coverage AND no known remaining gap     -> well_prepared
 * (a "remaining gap" is either an unpractised dimension or, when it is reliably known, a
 * demonstrated weak area — checklist completion is surfaced as its own signal, never silently
 * folded into the level, since an unticked "prepared my CV" is not the same kind of gap as an
 * untested question category).
 */
export function getApplicationPreparationStatus({
  completedInterviewCount = 0, practisedDimensionCount = 0, totalDimensions = QUESTION_MIX_TYPES.length,
  hasFeedback = false, hasWeakAreaRemaining = false, checklistDone = 0, checklistTotal = 0,
} = {}) {
  const completed = num(completedInterviewCount, 0);
  const practised = num(practisedDimensionCount, 0);
  const total = Math.max(1, num(totalDimensions, QUESTION_MIX_TYPES.length));
  const fullyCovered = practised >= total;
  const remainingGap = !fullyCovered || hasWeakAreaRemaining;

  let level;
  if (completed <= 0) level = "just_starting";
  else if (practised / total < 0.5) level = "building";
  else if (remainingGap) level = "good_progress";
  else level = "well_prepared";

  const meta = READINESS_LEVELS.find((l) => l.level === level);
  const summary = {
    just_starting: "You haven't started practising for this opportunity yet.",
    building: "You've started practising, but there's a lot left to cover.",
    good_progress: "You've practised for this opportunity, but there are still areas you haven't covered.",
    well_prepared: "You've covered every question type and have no known weak areas outstanding.",
  }[level];

  const signals = [
    { ok: completed > 0, label: completed > 0 ? "Completed mock practice" : "No mock practice completed yet" },
    { ok: hasFeedback, label: hasFeedback ? "Received feedback" : "No interview feedback yet" },
    { ok: fullyCovered, label: fullyCovered ? "Practised every question type" : "Some question areas remain unpractised" },
    ...(hasWeakAreaRemaining ? [{ ok: false, label: "A demonstrated weak area is still outstanding" }] : []),
    ...(checklistTotal > 0 ? [{ ok: checklistDone >= checklistTotal, label: checklistDone >= checklistTotal ? "Interview checklist complete" : "Complete your interview checklist" }] : []),
  ];

  return { level, label: meta.label, summary, signals };
}

/* ==================== FEATURE 3: "What should I do next?" ==================== */

/**
 * getNextRecommendedAction({
 *   completedInterviewCount, gaps, weakAreaRecommendation, incompleteChecklistItems,
 * }) -> { title, subtitle, actionLabel, actionKind, payload }
 *
 * Deterministic priority chain (see module docstring for the sourcing of each input):
 *   1. no completed interview yet             -> start first practice interview
 *   2. an unpractised dimension exists         -> practise that dimension
 *   3. a real, reliably-supported weak area    -> improve that weak area
 *   4. an incomplete checklist item exists     -> do that checklist item
 *   5. everything measurable is complete       -> keep practising
 *
 * actionKind is one of "build_interview" | "open_checklist" | "keep_practising" — App.jsx maps
 * each to its own real navigation, never a placeholder. ZERO AI calls anywhere in this
 * function or its inputs' construction (see applicationPreparation.test.js).
 */
export function getNextRecommendedAction({
  completedInterviewCount = 0, gaps = [], weakAreaRecommendation = null, incompleteChecklistItems = [],
} = {}) {
  if (num(completedInterviewCount, 0) <= 0) {
    return {
      title: "Start your first practice interview",
      subtitle: "You haven't practised for this opportunity yet — a first mock interview is the best place to start.",
      actionLabel: "Start practising", actionKind: "build_interview", payload: null,
    };
  }

  const firstGap = arr(gaps)[0];
  if (firstGap) {
    return {
      title: `Practise ${firstGap.label.toLowerCase()} questions`,
      subtitle: `You haven't practised this question type for this opportunity yet.`,
      actionLabel: "Start practising", actionKind: "build_interview", payload: { dimension: firstGap.dimension },
    };
  }

  if (weakAreaRecommendation && weakAreaRecommendation.label) {
    return {
      title: `Improve your ${String(weakAreaRecommendation.label).toLowerCase()}`,
      subtitle: weakAreaRecommendation.gapSummary || "Your interview answers on this have been weak or inconsistent.",
      actionLabel: "Develop this area", actionKind: "develop_weak_area", payload: { recommendation: weakAreaRecommendation },
    };
  }

  const firstChecklistItem = arr(incompleteChecklistItems)[0];
  if (firstChecklistItem) {
    return {
      title: firstChecklistItem.label,
      subtitle: "The last few preparation basics are worth ticking off before your interview.",
      actionLabel: "Open checklist", actionKind: "open_checklist", payload: { itemId: firstChecklistItem.id },
    };
  }

  return {
    title: "Keep practising",
    subtitle: "Try another mock interview to keep your skills sharp.",
    actionLabel: "Practise again", actionKind: "build_interview", payload: null,
  };
}

/* ==================== FEATURE 4: Interview Checklist ==================== */

/**
 * getAutoChecklistItems({ completedInterviewCount, practisedDimensions, hasFeedback }) -> [{id,label,done}]
 *
 * Every item here is derived from real, already-available activity — never a fabricated
 * signal. "Reviewed progress" (from the brief's own example list) is deliberately NOT included:
 * there is no existing signal for "the candidate looked at the Progress screen", and inventing
 * one would violate the module's own "no fake intelligence" rule.
 */
export function getAutoChecklistItems({ completedInterviewCount = 0, practisedDimensions = [], hasFeedback = false } = {}) {
  const practised = new Set(arr(practisedDimensions));
  return [
    { id: "auto_completed_practice", label: "Completed a practice interview", done: num(completedInterviewCount, 0) > 0 },
    { id: "auto_practised_behavioural", label: "Practised behavioural questions", done: practised.has("behavioural") },
    { id: "auto_practised_technical", label: "Practised technical questions", done: practised.has("technical") },
    { id: "auto_practised_motivational", label: "Practised motivational questions", done: practised.has("motivational") },
    { id: "auto_received_feedback", label: "Received interview feedback", done: !!hasFeedback },
  ];
}

/**
 * getManualChecklistDefinitions({ hasJobDescription }) -> [{id,label}]
 *
 * Only includes items that make sense given what this application actually has. "Researched the
 * company" is always included (company is a required field on every application). "Reviewed the
 * job description" is only included when one has actually been added — per the brief's own
 * example, never create a requirement the application's data can't support.
 */
export function getManualChecklistDefinitions({ hasJobDescription = false } = {}) {
  return [
    { id: "manual_researched_company", label: "Researched the company" },
    ...(hasJobDescription ? [{ id: "manual_reviewed_jd", label: "Reviewed the job description" }] : []),
    { id: "manual_prepared_questions", label: "Prepared questions for the interviewer" },
    { id: "manual_reviewed_cv", label: "Reviewed my CV" },
    { id: "manual_prepared_motivation", label: "Prepared my motivation for applying" },
  ];
}

/**
 * mergeChecklist(autoItems, manualDefs, manualState) -> { items, doneCount, totalCount }
 *
 * manualState: the persisted applications.checklist value — a plain { [itemId]: true } map, or
 * null/undefined for an application that has never touched this feature (every existing
 * application before Phase 37, and every one created after it until the user first ticks
 * something) — treated as "nothing manually ticked", never as an error.
 */
export function mergeChecklist(autoItems, manualDefs, manualState) {
  const state = manualState && typeof manualState === "object" ? manualState : {};
  const items = [
    ...arr(autoItems).map((i) => ({ ...i, kind: "auto" })),
    ...arr(manualDefs).map((d) => ({ id: d.id, label: d.label, kind: "manual", done: state[d.id] === true })),
  ];
  const doneCount = items.filter((i) => i.done).length;
  return { items, doneCount, totalCount: items.length };
}
