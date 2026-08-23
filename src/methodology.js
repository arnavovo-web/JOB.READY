/* ================================================================== *
 * PHASE 2A — UNIVERSAL INTERVIEW METHODOLOGY ENGINE
 * ------------------------------------------------------------------
 * Canonical six-category taxonomy, legacy category normalization,
 * anchor-source separation, and the bounded stage-methodology /
 * JD-adjustment calculation.
 *
 * This module is a COMPANION to the existing Phase 4A configuration
 * system in App.jsx (INTERVIEW_STAGES / INTERVIEW_FORMATS /
 * resolveInterviewConfig). It is keyed by the same stage keys that
 * catalog already defines, but it never reads, writes, or duplicates
 * that catalog — resolveInterviewConfig remains the sole source of
 * truth for delivery mechanics (pipeline, timing, adaptive controls,
 * question_count, etc). This module answers a different question:
 * "what category envelope does this stage imply?" — nothing here
 * decides stage/format/pipeline.
 *
 * The same methodology algorithm is used for every role. There is no
 * career-specific branching (no IB/PE/S&T/consulting/tech engine) —
 * all domain variation comes from JD signals layered on a shared
 * baseline, never from a company-name or industry conditional.
 * ================================================================== */

// ---- 2A.1 Canonical six-category taxonomy -------------------------------
// case_problem_solving is reserved for future Assessment Centre / case-study
// work. It is never emitted by interview methodology in Phase 2A-2C.3: its
// weight is always 0, the scheduler must never select it, and batch
// methodology generation must not emit it. It stays part of this exported
// list for future extensibility — do not remove it, do not weight it.
export const CATEGORIES = [
  "motivation_fit",
  "behavioural_competency",
  "situational_judgement",
  "technical_functional",
  "commercial_awareness",
  "case_problem_solving",
];

// Categories the interview methodology is actually allowed to weight.
// case_problem_solving is deliberately excluded — see above.
export const ACTIVE_CATEGORIES = CATEGORIES.filter((c) => c !== "case_problem_solving");

// ---- 2A.2 Legacy -> canonical category mapping ---------------------------
// One-directional only (legacy -> canonical). Nothing ever maps canonical
// back to legacy. situational_judgement has no legacy source: it only
// appears in newly generated content going forward, never backfilled onto
// historical rows (see App.jsx normalization call sites, and Phase 2A/2I
// legacy-compatibility rules: read-time normalization only, no rewrite of
// historical data).
const LEGACY_CATEGORY_MAP = {
  motivation_fit: "motivation_fit",
  cv_behavioural: "behavioural_competency",
  role_specific: "technical_functional",
  technical: "technical_functional",
  commercial_awareness: "commercial_awareness",
};

/**
 * Normalizes a category string (legacy or already-canonical) to the
 * canonical taxonomy. Unrecognized/missing values fall back to
 * "behavioural_competency" — a safe default that never drops a question,
 * never silently returns an invalid/reserved category.
 */
export function mapLegacyCategory(category) {
  if (CATEGORIES.includes(category)) return category;
  return LEGACY_CATEGORY_MAP[category] || "behavioural_competency";
}

function isKnownCategory(category) {
  return CATEGORIES.includes(category) || Object.prototype.hasOwnProperty.call(LEGACY_CATEGORY_MAP, category);
}

/**
 * Same as mapLegacyCategory, but an unrecognized/invalid input resolves
 * through a caller-specified legacy alias instead of the generic
 * behavioural_competency default — for call sites that need to preserve a
 * specific pre-2A fallback rather than adopt the general one.
 *
 * Concretely: independent/batch question generation historically defaulted
 * an invalid/unrecognized category to the literal legacy string
 * "role_specific" (see validateQuestionBatch in App.jsx). Under the
 * canonical taxonomy, "role_specific" itself maps to technical_functional
 * (2A.2) — so calling mapCategoryWithLegacyFallback(category,
 * "role_specific") reproduces that exact pre-2A end result
 * (unknown -> role_specific -> technical_functional) through the same
 * mapping table every other normalization call site uses, rather than
 * re-hardcoding a legacy category enum at the call site.
 */
export function mapCategoryWithLegacyFallback(category, legacyFallbackKey) {
  return mapLegacyCategory(isKnownCategory(category) ? category : legacyFallbackKey);
}

// ---- 2A.3 Anchor source -----------------------------------------------
// category, competency, and anchor_source are three independent fields —
// never a compound string, never derived from one another. Bare string
// values only (no nested object wrapper), per approved product decision.
//
// "previous_answer" is scheduler-local (Phase 2C.1) — it is never used at
// batch-question-creation time, since a batch question is generated before
// any answer exists. It is included here for completeness/type-checking
// convenience, but methodology.js's own output never produces it.
export const ANCHOR_SOURCES = ["generic", "cv", "jd", "company", "previous_answer"];

// Anchor sources methodology.js / batch generation may legitimately use.
export const BATCH_ANCHOR_SOURCES = ANCHOR_SOURCES.filter((a) => a !== "previous_answer");

export function normalizeAnchorSource(anchorSource) {
  return ANCHOR_SOURCES.includes(anchorSource) ? anchorSource : "generic";
}

/**
 * Normalizes a legacy-or-canonical {category: percentage} map (the shape
 * of AI-generated interview_profile.question_mix) into canonical
 * categories. Where multiple legacy keys collapse onto the same canonical
 * category (e.g. "role_specific" and "technical" both ->
 * technical_functional), their values are summed rather than one
 * overwriting the other, so no signal from the AI's original mix is
 * silently dropped.
 */
export function normalizeCategoryMix(mix) {
  const result = {};
  for (const [key, value] of Object.entries(mix || {})) {
    const canonical = mapLegacyCategory(key);
    result[canonical] = (result[canonical] || 0) + (Number(value) || 0);
  }
  return result;
}

// ---- 2A.5/2A.6 Stage methodology: baselines + envelopes -----------------
// Keyed by the exact INTERVIEW_STAGES keys already defined in App.jsx
// (recruiter_screen | first_round | technical | final_round) — a companion
// lookup, not a second stage catalog. Every baseline sums to 100 across
// the 5 active categories; case_problem_solving is always 0 with an
// envelope of 0 (structurally excluded, not just prompted against).
//
// envelope[category] = { plus, minus } — the maximum positive/negative
// adjustment computeMethodologyDistribution may apply to that category
// for this stage, i.e. the enforced invariant is:
//   baseline[c] - envelope[c].minus  <=  result[c]  <=  baseline[c] + envelope[c].plus
//
// first_round's baseline is back-derived from the worked methodology
// example (the "generic graduate" row — the JD with the weakest signal,
// closest to raw baseline). recruiter_screen and final_round baselines
// were revised against this repo's own live (if dormant) Phase 4A
// INTERVIEW_STAGES/INTERVIEW_FORMATS weight overrides. technical's
// baseline converged with that same evidence almost exactly on the first
// proposal. All four are final, approved product decisions.
function envelope(plus, minus = plus) {
  return { plus, minus };
}

export const STAGE_METHODOLOGY = {
  recruiter_screen: {
    baseline: {
      motivation_fit: 38,
      behavioural_competency: 20,
      situational_judgement: 12,
      technical_functional: 8,
      commercial_awareness: 22,
      case_problem_solving: 0,
    },
    envelope: {
      motivation_fit: envelope(8),
      behavioural_competency: envelope(8),
      situational_judgement: envelope(8),
      // Structural enforcement of "a recruiter/HR screen should very
      // rarely, if ever, include a technical question" (the instruction
      // already live in App.jsx's buildQuestionBatchPrompt) — a tighter
      // positive ceiling than the stage's other categories.
      technical_functional: envelope(5, 8),
      commercial_awareness: envelope(8),
      case_problem_solving: envelope(0, 0),
    },
  },
  first_round: {
    baseline: {
      motivation_fit: 19,
      behavioural_competency: 28,
      situational_judgement: 15,
      technical_functional: 22,
      commercial_awareness: 16,
      case_problem_solving: 0,
    },
    envelope: {
      // Uniform +/-10 for every active category, including
      // technical_functional. Explicit product decision: do NOT widen
      // technical_functional past +/-10 even though the worked example's
      // Google SWE case reached +9 — that case demonstrates +/-10 already
      // accommodates the observed evidence, not that it needs widening.
      motivation_fit: envelope(10),
      behavioural_competency: envelope(10),
      situational_judgement: envelope(10),
      technical_functional: envelope(10),
      commercial_awareness: envelope(10),
      case_problem_solving: envelope(0, 0),
    },
  },
  technical: {
    baseline: {
      motivation_fit: 8,
      behavioural_competency: 12,
      situational_judgement: 15,
      technical_functional: 55,
      commercial_awareness: 10,
      case_problem_solving: 0,
    },
    envelope: {
      motivation_fit: envelope(12),
      behavioural_competency: envelope(12),
      situational_judgement: envelope(12),
      // Retained asymmetric bound: a technical stage can lean harder
      // technical (+10) but has more room to fall back toward a
      // behavioural-heavy technical round (-15) than it has to exceed 65.
      technical_functional: envelope(10, 15),
      commercial_awareness: envelope(12),
      case_problem_solving: envelope(0, 0),
    },
  },
  final_round: {
    baseline: {
      motivation_fit: 12,
      behavioural_competency: 20,
      situational_judgement: 18,
      technical_functional: 35,
      commercial_awareness: 15,
      case_problem_solving: 0,
    },
    envelope: {
      // Explicit product decision: +/-10 for now, not the +/-12/13 this
      // module's design draft considered — that was inference, not
      // evidence. Revisit only after real JD/test evidence demonstrates
      // +/-10 is insufficient.
      motivation_fit: envelope(10),
      behavioural_competency: envelope(10),
      situational_judgement: envelope(10),
      technical_functional: envelope(10),
      commercial_awareness: envelope(10),
      case_problem_solving: envelope(0, 0),
    },
  },
};

function stageMethodology(stage) {
  return STAGE_METHODOLOGY[stage] || STAGE_METHODOLOGY.first_round;
}

// ---- 2A.4/2A.5 JD structured signal model + bounded adjustment ----------
// Confidence reuses the EXISTING explicit|inferred|general enum already
// live in App.jsx's interview_profile.competencies[].basis — not a new
// enum invented for this module.
const CONFIDENCE_MAGNITUDE = { explicit: 8, inferred: 5, general: 0 };
const SATURATION_CAP_OCCURRENCES = 3;
const SATURATION_STEP = 0.15; // each occurrence beyond the first adds +15%, not a linear multiple
const TOP_SIGNAL_COUNT = 3;

function effectiveMagnitude(signal) {
  const base = CONFIDENCE_MAGNITUDE[signal.confidence] ?? 0;
  const occurrences = Math.min(Math.max(1, Number(signal.occurrences) || 1), SATURATION_CAP_OCCURRENCES);
  return base * (1 + SATURATION_STEP * (occurrences - 1));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * computeMethodologyDistribution(stage, jdProfile)
 *
 * stage: one of the INTERVIEW_STAGES keys (falls back to "first_round" if
 *   unrecognized — same legacy-fallback behavior the scheduler will reuse
 *   for interviews with no persisted methodology_distribution at all).
 * jdProfile: { signals: [{ requirement, evidence_quote, confidence,
 *   category, occurrences, direction }] } | null
 *
 * Returns a plain object with all 6 CATEGORIES as keys, integer values,
 * summing to exactly 100, case_problem_solving always 0. Never mutates
 * STAGE_METHODOLOGY or the jdProfile argument.
 */
export function computeMethodologyDistribution(stage, jdProfile) {
  const { baseline, envelope: bounds } = stageMethodology(stage);

  // 2A.15 No-JD fallback: nothing to adjust, return the stage baseline as-is.
  const signals = jdProfile && Array.isArray(jdProfile.signals) ? jdProfile.signals : [];
  if (signals.length === 0) {
    return { ...baseline };
  }

  // 2A.10 Evidence quote requirement: a signal with no real evidence quote
  // never influences the distribution.
  const evidenced = signals.filter(
    (s) => s && typeof s.evidence_quote === "string" && s.evidence_quote.trim().length > 0
  );
  if (evidenced.length === 0) {
    return { ...baseline };
  }

  // 2A.13 Top-3 signal cap: only the strongest signals by effective
  // magnitude ever move category weights, regardless of total signal count.
  const ranked = evidenced
    .map((s) => ({ ...s, _magnitude: effectiveMagnitude(s) }))
    .filter((s) => ACTIVE_CATEGORIES.includes(s.category) && s._magnitude > 0)
    .sort((a, b) => b._magnitude - a._magnitude)
    .slice(0, TOP_SIGNAL_COUNT);

  if (ranked.length === 0) {
    return { ...baseline };
  }

  // Raw deltas per category, signed by direction.
  const rawDelta = Object.fromEntries(ACTIVE_CATEGORIES.map((c) => [c, 0]));
  for (const s of ranked) {
    const sign = Number(s.direction) < 0 ? -1 : 1;
    rawDelta[s.category] += s._magnitude * sign;
  }

  // Clamp each category's raw delta to its stage envelope BEFORE
  // redistribution — the step that prevents ever temporarily pushing a
  // category outside its permitted envelope while correcting the total.
  const delta = {};
  for (const c of ACTIVE_CATEGORIES) {
    const b = bounds[c];
    delta[c] = clamp(rawDelta[c], -b.minus, b.plus);
  }

  // Redistribute any residual so deltas sum to exactly 0 — a delta applied
  // to one category must come from somewhere. Spread proportionally across
  // categories that still have headroom in the residual's direction,
  // re-clamp, repeat. Any residual that can't be placed because no
  // category has headroom left is dropped, never forced through past an
  // envelope bound.
  let residual = -ACTIVE_CATEGORIES.reduce((sum, c) => sum + delta[c], 0);
  for (let iterations = 0; Math.abs(residual) > 1e-9 && iterations < 8; iterations++) {
    const direction = residual > 0 ? 1 : -1;
    const headroomFor = (c) => {
      const b = bounds[c];
      return direction > 0 ? b.plus - delta[c] : b.minus + delta[c];
    };
    const withHeadroom = ACTIVE_CATEGORIES.filter((c) => headroomFor(c) > 1e-9);
    if (withHeadroom.length === 0) break; // nothing left to absorb the residual — drop it
    const totalHeadroom = withHeadroom.reduce((sum, c) => sum + headroomFor(c), 0);
    let applied = 0;
    for (const c of withHeadroom) {
      const share = (headroomFor(c) / totalHeadroom) * residual;
      const before = delta[c];
      const b = bounds[c];
      delta[c] = clamp(delta[c] + share, -b.minus, b.plus);
      applied += delta[c] - before;
    }
    residual -= applied;
  }

  // Apply to baseline.
  const raw = {};
  for (const c of ACTIVE_CATEGORIES) raw[c] = baseline[c] + delta[c];

  // Round to integers summing to exactly 100 by adjusting the category
  // with the most remaining headroom — never the category that just hit
  // its bound — so the envelope invariant holds even after rounding.
  const rounded = Object.fromEntries(ACTIVE_CATEGORIES.map((c) => [c, Math.round(raw[c])]));
  let sumDiff = 100 - ACTIVE_CATEGORIES.reduce((sum, c) => sum + rounded[c], 0);
  if (sumDiff !== 0) {
    const direction = sumDiff > 0 ? 1 : -1;
    const headroomFor = (c) => {
      const b = bounds[c];
      const current = rounded[c] - baseline[c];
      return direction > 0 ? b.plus - current : b.minus + current;
    };
    const target = ACTIVE_CATEGORIES.slice().sort((a, b2) => headroomFor(b2) - headroomFor(a))[0];
    rounded[target] += sumDiff;
  }

  return { ...rounded, case_problem_solving: 0 };
}

/* ================================================================== *
 * PHASE 2C.1 — DETERMINISTIC ADAPTIVE INTERVIEW SCHEDULER
 * ------------------------------------------------------------------
 * Pure, deterministic, career/company-agnostic building blocks for
 * deciding "what category/turn-type should the next question be" during
 * a live (turn-by-turn) interview. This module answers that question
 * only — it does not call the AI, does not read/write the database, and
 * is not wired into submitAnswer/interview_turn/analyseAndPlan yet
 * (that wiring is Phase 2C.3). Nothing here branches on company, role,
 * or industry — the same three functions run for every interview.
 * ================================================================== */

// ---- 2C.1 Turn types ----------------------------------------------------
// "normal" is a fresh, scheduler-selected-category question. The other
// three are probing turns that stay anchored to the category/answer they
// are probing rather than jumping to a new category.
export const TURN_TYPES = ["normal", "follow_up", "challenge_claim", "clarify"];

const PROBING_TURN_TYPES = ["follow_up", "challenge_claim", "clarify"];

// A probing thread (follow_up/challenge_claim/clarify chained back-to-back)
// may run at most this many turns deep before the caller must circuit-break
// back to a "normal" (scheduler-owned category) turn. No prior design
// fixes a different value for this repo, so this is the first approved
// number for it.
export const MAX_PROBE_DEPTH = 2;

// The finite set of signals an upstream answer-analysis step may observe
// about the candidate's latest answer. This is the ONLY input
// resolveTurnDirective takes that isn't already scheduler-owned state —
// the AI (or whatever produces observedSignal) reports what it saw in the
// answer, it never reports or chooses a category or turn type itself.
export const ADAPTIVE_SIGNALS = [
  "vague_or_incomplete", // answer lacked concrete detail -> clarify
  "unsupported_claim",   // answer asserted something without evidence -> challenge_claim
  "strong_signal",       // answer surfaced something worth probing deeper -> follow_up
  "sufficient",          // answer was complete -> normal, move to the next scheduled category
];

const SIGNAL_TURN_TYPE = {
  vague_or_incomplete: "clarify",
  unsupported_claim: "challenge_claim",
  strong_signal: "follow_up",
  sufficient: "normal",
};

// Float deficit/weight comparisons use this tolerance, matching the
// residual-redistribution epsilon already used above in this file.
const SCHEDULER_EPSILON = 1e-9;

/**
 * countTrailingProbeDepth(transcript)
 *
 * transcript: array of past turns, each shaped like { turn_type, ... }
 *   (only turn_type is read here). Newest turn last.
 *
 * Counts only the CONSECUTIVE probing turns (follow_up | challenge_claim |
 * clarify) at the end of the transcript. Any other value — "normal", a
 * missing/null/undefined turn_type (the opening interview question has
 * none), or an unrecognized string — resets the count to zero rather than
 * counting as a probing turn, so a single normal turn always clears the
 * probe thread.
 */
export function countTrailingProbeDepth(transcript) {
  const turns = Array.isArray(transcript) ? transcript : [];
  let depth = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turnType = turns[i] && turns[i].turn_type;
    if (!PROBING_TURN_TYPES.includes(turnType)) break;
    depth++;
  }
  return depth;
}

/**
 * scheduleNextCategory({ distribution, transcript, questionCount })
 *
 * distribution: a methodology distribution ({category: percentage},
 *   0-100 summing to 100 — the output of computeMethodologyDistribution).
 * transcript: array of past turns, each shaped like { category, ... }.
 *   EVERY turn counts toward its category's coverage regardless of
 *   turn_type (normal/follow_up/challenge_claim/clarify) — there is no
 *   separate probing counter to drift out of sync with the real count.
 * questionCount: the interview's planned total question count.
 *
 * For each active category: deficit = targetCount - askedCount, where
 * targetCount = (distribution[category] / 100) * questionCount. Returns
 * the category with the greatest positive deficit. Ties break, in order:
 *   1. larger deficit (already the primary sort)
 *   2. larger methodology weight (distribution[category])
 *   3. canonical ACTIVE_CATEGORIES order (first-wins)
 * If no category has a positive deficit (methodology exhausted), falls
 * back to the category with the greatest methodology weight, using the
 * same weight/canonical-order tie-break.
 */
export function scheduleNextCategory({ distribution, transcript, questionCount } = {}) {
  const dist = distribution || {};
  const turns = Array.isArray(transcript) ? transcript : [];
  const total = Number(questionCount) || 0;

  const askedCount = Object.fromEntries(ACTIVE_CATEGORIES.map((c) => [c, 0]));
  for (const turn of turns) {
    const category = mapLegacyCategory(turn && turn.category);
    if (ACTIVE_CATEGORIES.includes(category)) askedCount[category] += 1;
  }

  const weightOf = (c) => Number(dist[c]) || 0;
  const deficitOf = (c) => (weightOf(c) / 100) * total - askedCount[c];

  // ACTIVE_CATEGORIES is already in canonical order, so iterating it in
  // order and only replacing `best` on a STRICT improvement gives
  // first-wins canonical-order tie-break for free at every tier.
  let best = ACTIVE_CATEGORIES[0];
  for (const c of ACTIVE_CATEGORIES.slice(1)) {
    const deficitDelta = deficitOf(c) - deficitOf(best);
    if (deficitDelta > SCHEDULER_EPSILON) {
      best = c;
    } else if (Math.abs(deficitDelta) <= SCHEDULER_EPSILON && weightOf(c) - weightOf(best) > SCHEDULER_EPSILON) {
      best = c;
    }
  }

  if (deficitOf(best) > SCHEDULER_EPSILON) return best;

  // Exhaustion fallback: greatest methodology weight, same tie-break shape.
  let heaviest = ACTIVE_CATEGORIES[0];
  for (const c of ACTIVE_CATEGORIES.slice(1)) {
    if (weightOf(c) - weightOf(heaviest) > SCHEDULER_EPSILON) heaviest = c;
  }
  return heaviest;
}

/**
 * resolveTurnDirective({ observedSignal, priorCategory, normalCandidate, challengedClaimEvidenced })
 *
 * observedSignal: one of ADAPTIVE_SIGNALS (unrecognized/missing -> "normal",
 *   the safe default, same defensive shape as mapLegacyCategory's fallback).
 * priorCategory: the category of the turn being probed (only meaningful
 *   for a probing turn type).
 * normalCandidate: the category scheduleNextCategory produced for a fresh
 *   "normal" turn.
 * challengedClaimEvidenced: true when the claim being challenged is
 *   directly backed by something in the candidate's CV.
 *
 * Deterministically returns { turnType, category, anchorSource }. The
 * caller (an AI answer-analysis step) supplies observedSignal; it never
 * supplies or chooses category or anchorSource — those are scheduler-owned.
 */
export function resolveTurnDirective({ observedSignal, priorCategory, normalCandidate, challengedClaimEvidenced }) {
  const turnType = SIGNAL_TURN_TYPE[observedSignal] || "normal";

  if (turnType === "normal") {
    // anchorSource for a fresh normal-turn question is decided by the
    // question-content step (JD/CV-anchored generation), not the
    // scheduler — mirrors BATCH_ANCHOR_SOURCES already being a
    // content-generation concern, not a scheduling one.
    return { turnType, category: normalCandidate, anchorSource: null };
  }

  // follow_up / challenge_claim / clarify all stay anchored to the
  // category being probed. Only defensively fall back to normalCandidate
  // if priorCategory isn't a valid active category (e.g. missing on the
  // very first turn, which has no prior category to inherit).
  const category = ACTIVE_CATEGORIES.includes(priorCategory) ? priorCategory : normalCandidate;

  if (turnType === "challenge_claim") {
    return { turnType, category, anchorSource: challengedClaimEvidenced === true ? "cv" : "previous_answer" };
  }

  // follow_up / clarify: previous-answer/probing concepts, per 2C.1 scope.
  return { turnType, category, anchorSource: "previous_answer" };
}
