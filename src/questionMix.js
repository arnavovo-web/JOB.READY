/* ================================================================== *
 * PHASE 11 — USER-CONTROLLED INTERVIEW QUESTION MIX
 * ------------------------------------------------------------------
 * A pure, deterministic constraint layer (same shape as methodology.js /
 * interviewKnowledge.js — no AI call, no web search, no database, never
 * throws). It answers ONE question: "given the question types the user
 * explicitly chose on the Build Interview screen, which canonical scheduler
 * categories is the interview allowed to contain?"
 *
 * The user's Question Mix is a HARD PERMISSION BOUNDARY:
 *
 *   USER SELECTS QUESTION MIX
 *          |  (this module)
 *          v
 *   ALLOWED CANONICAL CATEGORIES
 *          |
 *          v
 *   EXISTING SCHEDULER (methodology.js + adaptiveEngine.js, UNTOUCHED)
 *   decides what comes next *within* the allowed categories
 *          |
 *          v
 *   TECHNICAL KNOWLEDGE LAYER activates ONLY when the user selected
 *   Technical Knowledge (isTechnicalMixEnabled) — see interviewKnowledge.js
 *
 * This module is NOT a second scheduler. It never picks a category, a turn
 * type, an anchor source, a competency, or a specific question. It only:
 *   - maps the 3 user-facing types to canonical categories (a partition of
 *     methodology.js's CATEGORIES — never a forked taxonomy),
 *   - zeroes-out disallowed categories in an existing methodology
 *     distribution (which the existing scheduler already consumes),
 *   - reports whether Technical Knowledge is in the user's selection.
 *
 * LEGACY / BACKWARDS COMPATIBILITY: an interview with no stored question_mix
 * (every interview created before Phase 11) has `normalizeQuestionMix`
 * return null. null is treated everywhere as "no explicit selection" ->
 * every category allowed, Knowledge Layer behaves exactly as it did in
 * Phase 6/9/10A. It is NEVER treated as if the user made a choice.
 * ================================================================== */

import {
  CATEGORIES, ACTIVE_CATEGORIES, mapLegacyCategory, scheduleNextCategory,
} from "./methodology.js";

// ---- 11.1 user-facing question types --------------------------------
export const QUESTION_MIX_TYPES = ["technical", "behavioural", "motivational"];

// ---- 11.2 type -> canonical category mapping ------------------------
// A strict PARTITION of methodology.js's CATEGORIES: every canonical
// category belongs to exactly one user-facing type; the union is all six
// categories; the sets are pairwise disjoint. (Asserted in questionMix.test.js
// against the live CATEGORIES export so it can never silently drift.)
//
//   technical    <- technical_functional  (role-specific technical/functional)
//                   commercial_awareness  (market/industry/commercial knowledge — role knowledge)
//                   case_problem_solving  (case/technical exercises; never emitted by the
//                                          live interview scheduler today, grouped here so the
//                                          mapping stays a total partition and is future-proof
//                                          for Assessment-Centre-style technical exercises)
//   behavioural  <- behavioural_competency (past-experience "tell me about a time...")
//                   situational_judgement  ("what would you do if..." — competency assessment
//                                           via hypotheticals)
//   motivational <- motivation_fit         (why this role/company/industry/career)
export const QUESTION_MIX_CATEGORY_MAP = {
  technical: ["technical_functional", "commercial_awareness", "case_problem_solving"],
  behavioural: ["behavioural_competency", "situational_judgement"],
  motivational: ["motivation_fit"],
};

// ---- 11.3 UI copy (single source of truth) --------------------------
// The Build Interview screen renders exactly these three, always, in this
// order, never pre-selected, never hidden.
export const QUESTION_MIX_OPTIONS = [
  {
    type: "technical",
    label: "Technical Knowledge",
    description: "Role-specific technical and functional questions.",
    example: "e.g. three financial statements, DCF, enterprise value; algorithms, system design; accounting standards.",
  },
  {
    type: "behavioural",
    label: "Behavioural / Competency",
    description: "Experience-based questions — for example, “Tell me about a time…”",
    example: "e.g. led a team, handled conflict, failed at something, worked under pressure.",
  },
  {
    type: "motivational",
    label: "Motivational",
    description: "Why this role, company, industry or career path?",
    example: "e.g. Why this industry? Why this firm? Why this role? Why should we hire you?",
  },
];

export function isQuestionMixType(v) {
  return QUESTION_MIX_TYPES.includes(v);
}

// ---- 11.4 normalisation --------------------------------------------
/**
 * normalizeQuestionMix(raw) -> string[] (valid, de-duped, canonical order) | null
 *
 * Accepts an array of type strings, or an object map { technical: true, ... }.
 * Drops anything that isn't one of QUESTION_MIX_TYPES. Returns null for a
 * missing / empty / wholly-invalid value — null means "no explicit user
 * selection" (legacy interview), NEVER an implied choice.
 */
export function normalizeQuestionMix(raw) {
  let requested = [];
  if (Array.isArray(raw)) requested = raw;
  else if (raw && typeof raw === "object") requested = Object.keys(raw).filter((k) => raw[k] === true);
  else return null;
  const clean = QUESTION_MIX_TYPES.filter((t) => requested.includes(t));
  return clean.length ? clean : null;
}

/** questionMixIsValid(raw) -> true iff it normalises to a real 1-3 type selection. */
export function questionMixIsValid(raw) {
  return normalizeQuestionMix(raw) !== null;
}

/** questionMixRestricts(raw) -> true iff a valid selection OMITS at least one type. */
export function questionMixRestricts(raw) {
  const mix = normalizeQuestionMix(raw);
  return !!mix && mix.length < QUESTION_MIX_TYPES.length;
}

// ---- 11.5 the permission boundary --------------------------------
/**
 * isTechnicalMixEnabled(raw) -> boolean
 *
 * The single gate the Technical Knowledge Layer consults. true unless a
 * VALID selection explicitly excludes "technical". A missing/invalid
 * selection (legacy interview) -> true: the Knowledge Layer keeps its
 * pre-Phase-11 behaviour for interviews that predate this feature.
 */
export function isTechnicalMixEnabled(raw) {
  const mix = normalizeQuestionMix(raw);
  if (!mix) return true;
  return mix.includes("technical");
}

/**
 * resolveAllowedCategories(raw) -> Set<canonicalCategory>
 *
 * The canonical categories the scheduler is permitted to use. Legacy / no
 * selection -> every category in methodology.js's CATEGORIES.
 */
export function resolveAllowedCategories(raw) {
  const mix = normalizeQuestionMix(raw);
  if (!mix) return new Set(CATEGORIES);
  const out = new Set();
  for (const type of mix) {
    for (const category of QUESTION_MIX_CATEGORY_MAP[type] || []) out.add(category);
  }
  return out;
}

/** questionMixTypeForCategory(category) -> the user-facing type a canonical category belongs to, or null. */
export function questionMixTypeForCategory(category) {
  const canonical = mapLegacyCategory(category);
  for (const type of QUESTION_MIX_TYPES) {
    if ((QUESTION_MIX_CATEGORY_MAP[type] || []).includes(canonical)) return type;
  }
  return null;
}

/** isCategoryAllowedByMix(category, raw) -> boolean. Legacy/no selection -> true. */
export function isCategoryAllowedByMix(category, raw) {
  return resolveAllowedCategories(raw).has(mapLegacyCategory(category));
}

// ---- 11.6 distribution filter (fed to the EXISTING scheduler) -------
/**
 * applyQuestionMixToDistribution(distribution, raw) -> distribution object
 *
 * Zeroes every disallowed category and renormalises the allowed weights to
 * sum to exactly 100 (relative proportions preserved). This is the ONLY
 * change that reaches the scheduler: methodology.js's scheduleNextCategory
 * then naturally never selects a zero-weight category (its deficit can only
 * be <= 0), so the Question Mix acts as a hard filter without any change to
 * the scheduler itself.
 *
 * Identity fast-path: a missing/invalid selection, or a selection that
 * permits all three types, returns the SAME object reference — so every
 * existing caller/test that passes no question_mix is byte-for-byte
 * unaffected. Never throws; a degenerate all-zero allowed set falls back to
 * an even split across the allowed ACTIVE categories.
 */
export function applyQuestionMixToDistribution(distribution, raw) {
  const mix = normalizeQuestionMix(raw);
  if (!mix || mix.length === QUESTION_MIX_TYPES.length) return distribution; // no restriction -> identity

  const dist = distribution && typeof distribution === "object" ? distribution : {};
  const allowed = resolveAllowedCategories(mix);
  const allowedSum = CATEGORIES.reduce((s, k) => s + (allowed.has(k) ? Math.max(0, Number(dist[k]) || 0) : 0), 0);

  const out = {};
  for (const k of CATEGORIES) out[k] = 0;

  if (allowedSum > 0) {
    for (const k of CATEGORIES) {
      if (allowed.has(k)) out[k] = Math.round((Math.max(0, Number(dist[k]) || 0) / allowedSum) * 100);
    }
  } else {
    // No weight anywhere in the allowed set (degenerate input) -> even split
    // across allowed ACTIVE categories (case_problem_solving is never live).
    const allowedActive = ACTIVE_CATEGORIES.filter((k) => allowed.has(k));
    const each = allowedActive.length ? Math.floor(100 / allowedActive.length) : 0;
    allowedActive.forEach((k, i) => { out[k] = each; if (i === 0) out[k] += 100 - each * allowedActive.length; });
  }

  // Correct any rounding drift onto the largest allowed weight so the sum is exactly 100.
  const sum = CATEGORIES.reduce((s, k) => s + out[k], 0);
  if (sum !== 100) {
    const target = CATEGORIES
      .filter((k) => allowed.has(k) && ACTIVE_CATEGORIES.includes(k))
      .sort((a, b) => out[b] - out[a])[0];
    if (target != null) out[target] += 100 - sum;
  }
  out.case_problem_solving = 0; // matches computeMethodologyDistribution: never emitted live
  return out;
}

/**
 * resolveOpeningCategory(distribution, raw, questionCount) -> canonical category | null
 *
 * The opening question is produced by the interview_profile AI call, which
 * can pick any category. When the Question Mix RESTRICTS the interview, this
 * returns the scheduler's OWN deterministic first-turn choice given the
 * mix-filtered distribution (reusing scheduleNextCategory — never a bespoke
 * pick), so App.jsx can clamp the opening question onto an allowed category.
 * Returns null when the mix does not restrict (AI keeps its free choice,
 * exactly as before Phase 11).
 */
export function resolveOpeningCategory(distribution, raw, questionCount) {
  if (!questionMixRestricts(raw)) return null;
  const filtered = applyQuestionMixToDistribution(distribution, raw);
  return scheduleNextCategory({ distribution: filtered, transcript: [], questionCount: Number(questionCount) || 0 });
}
