/* ================================================================== *
 * PHASE 2E — CANDIDATE STRATEGY (CANDIDATE INTELLIGENCE -> INTERVIEW
 * STRATEGY)
 * ------------------------------------------------------------------
 * A pure, deterministic module (same pattern as methodology.js /
 * adaptiveEngine.js / candidateIntelligence.js) that turns Phase 2D's
 * candidateSignals (candidateIntelligence.js's buildCandidateSignals
 * output) plus already-persisted candidate_claims rows into a compact,
 * deterministic priority signal the Phase 2C scheduler and Call 2
 * (question generation) prompt may consume:
 *
 *   Raw candidate/interview evidence
 *           |
 *           v
 *   Candidate Intelligence (candidateIntelligence.js, untouched here)
 *           |
 *           v
 *   Candidate Strategy (this module)
 *           |
 *           v
 *   Phase 2C adaptive scheduler (methodology.js / adaptiveEngine.js) —
 *   consumes categoryPreference as a small, BOUNDED nudge only; the
 *   scheduler's own deficit/envelope logic remains authoritative.
 *
 * This module makes NO AI calls, touches NO database, has no React or
 * browser dependency, and NEVER throws on malformed/missing input —
 * every function defensively degrades to a safe, inert result (an
 * empty candidateStrategy whose categoryPreference is `{}` reproduces
 * the pre-2E scheduler exactly). Candidate Strategy answers "given what
 * we know about this candidate, what should we try to test?" — it never
 * decides category, turn type, or anchor source itself; those remain
 * entirely the scheduler's (see methodology.js's scheduleNextCategory /
 * resolveTurnDirective, neither of which is touched here beyond the
 * scheduler's own additive categoryPreference parameter).
 * ================================================================== */

import { ACTIVE_CATEGORIES, mapLegacyCategory } from "./methodology.js";
import { isCandidateIntelligenceUsable } from "./candidateIntelligence.js";

// ---- 2E.1 deterministic scoring constants -------------------------------
// All "priority" scores are on the same 0-100 scale evaluation rubrics
// already use elsewhere in this codebase — no new scale invented.

// Category priority base score, keyed by candidateIntelligence.js's own
// CATEGORY_STATUSES (unknown/insufficient/demonstrated). A category never
// tested at all is the strongest candidate-specific signal to prioritise;
// one already demonstrated is the strongest signal to deprioritise.
const CATEGORY_STATUS_BASE = { unknown: 80, insufficient: 55, demonstrated: 25 };

// Within THIS interview, each additional time a category has already been
// asked dampens its strategic priority further — the repetition-control
// signal (Phase 2E §9). Bounded so a long interview can't push a category's
// priority below 0 purely from in-session repetition.
const IN_SESSION_ASK_PENALTY = 12;
const MAX_IN_SESSION_PENALTY = 40;

// Claim priority base score, keyed by candidateIntelligence.js's own
// CLAIM_STATUSES. "contradicted" is deliberately as high-priority as
// "unverified" — the spec's own instruction (§5): contradictory or weak
// evidence favours revisiting the claim, not ignoring it. This module
// never invents contradiction detection; it only reacts to a status that
// classifyClaimStatus (or manual/future data) may already carry.
const CLAIM_STATUS_BASE = { unverified: 88, contradicted: 82, partially_supported: 62, supported: 15 };
// Evidence accumulated within a status band trims priority a little
// further (a supported claim with 6 data points is even less worth
// retesting than one with 3) — bounded to at most 30% of the base score
// so status always dominates evidence count, never the reverse.
const CLAIM_EVIDENCE_DECAY_PER_POINT = 6;
// Same evidence-count normalisation candidateIntelligence.js already uses
// for "demonstrated" (MIN_EVIDENCE_FOR_DEMONSTRATED) — reused here as the
// denominator for a 0-1 evidence_strength score, not re-derived differently.
const EVIDENCE_STRENGTH_DENOMINATOR = 3;

// Competency priority bases. A competency the JD explicitly requires but
// that has never appeared in this candidate's competencyCoverage at all
// is the strongest "important to the role, insufficiently tested" signal
// (§6). One already evidenced with a solid score is deprioritised.
const REQUIRED_UNTESTED_BASE = 75;
const INSUFFICIENT_COMPETENCY_BASE = 55;
const WELL_COVERED_COMPETENCY_BASE = 20;
// A competency needs at least this many evidence points, with an average
// score at/above this bar, before it's treated as "well covered" rather
// than merely "insufficiently tested" — same bar candidateIntelligence.js
// uses for category-level "demonstrated" (MIN_EVIDENCE_FOR_DEMONSTRATED /
// DEMONSTRATED_SCORE_BAR), reused here for consistency, not re-derived.
const COMPETENCY_EVIDENCE_BAR = 3;
const COMPETENCY_SCORE_BAR = 60;

// A priority/depriority score at or above/below this threshold surfaces
// in the respective output list. Scores between the two thresholds are
// still reflected in categoryPreference/coverage but aren't noisy enough
// to call out as an explicit priority or depriority.
const PRIORITY_THRESHOLD = 60;
const DEPRIORITY_THRESHOLD = 35;

// Bounded output size — same "don't let the prompt/context grow
// unbounded" rationale as candidateIntelligence.js's MAX_RECOMMENDED_PROBES
// / MAX_MERGED_PROBE_AREAS.
const MAX_PRIORITIES = 8;
const MAX_DEPRIORITIES = 8;

// Coverage bucket thresholds (§8: untouched / lightly tested / adequately
// tested / over-tested) — applied identically to categories and
// competencies, purely a different bucketing of the SAME evidenceCount
// candidateIntelligence.js already computes. No new storage.
const LIGHT_COVERAGE_MAX = 2;   // 1-2 evidence points
const ADEQUATE_COVERAGE_MAX = 5; // 3-5 evidence points; 6+ is over-tested

// Deterministic tie-break order for priorities/depriorities: claims before
// competencies before categories, then ascending key. Arbitrary but fixed,
// so identical input always produces identical output order.
const TYPE_ORDER = { claim: 0, competency: 1, category: 2 };

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function str(v, fallback = "") {
  return typeof v === "string" ? v : fallback;
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function normalizeLabel(v) {
  return str(v).toLowerCase().trim();
}

/**
 * countAskedThisInterview(transcript)
 *
 * transcript: this interview's own turns so far — accepts either the live
 *   App.jsx shape ([{ question: { category }, ... }]) or adaptiveEngine's
 *   adapted TurnRecord shape ([{ category, ... }]) so callers never need
 *   to pre-adapt it just for this module. Legacy category strings are
 *   normalized via mapLegacyCategory, same rule every other call site uses.
 *
 * Returns { [category]: count } for every ACTIVE_CATEGORY (0 when absent).
 */
function countAskedThisInterview(transcript) {
  const counts = Object.fromEntries(ACTIVE_CATEGORIES.map((c) => [c, 0]));
  for (const turn of arr(transcript)) {
    const raw = turn && (turn.category != null ? turn.category : turn.question?.category);
    const category = mapLegacyCategory(raw);
    if (counts[category] != null) counts[category] += 1;
  }
  return counts;
}

function coverageBucket(evidenceCount) {
  const n = num(evidenceCount, 0);
  if (n === 0) return "untouched";
  if (n <= LIGHT_COVERAGE_MAX) return "lightly_tested";
  if (n <= ADEQUATE_COVERAGE_MAX) return "adequately_tested";
  return "over_tested";
}

function evidenceStrength(evidenceCount) {
  return clamp(num(evidenceCount, 0) / EVIDENCE_STRENGTH_DENOMINATOR, 0, 1);
}

/**
 * buildCategoryPriorities(categoryCoverage, transcript)
 *
 * categoryCoverage: candidateSignals.categoryCoverage (candidateIntelligence
 *   .js's buildCategoryCoverage output) — keyed by every ACTIVE_CATEGORY.
 * transcript: this interview's own turns so far (see countAskedThisInterview).
 *
 * Returns one entry per ACTIVE_CATEGORY: { type: "category", key, priority,
 * reason, evidence_strength }. Always returns all 5 active categories,
 * even ones with no evidence at all — never silently omitted, same
 * completeness contract candidateIntelligence.js's own coverage builders
 * already guarantee.
 */
export function buildCategoryPriorities(categoryCoverage, transcript) {
  const coverage = categoryCoverage && typeof categoryCoverage === "object" ? categoryCoverage : {};
  const askedThisInterview = countAskedThisInterview(transcript);

  return ACTIVE_CATEGORIES.map((category) => {
    const cov = coverage[category] || { status: "unknown", evidenceCount: 0, recentlyTested: false };
    const base = CATEGORY_STATUS_BASE[cov.status] ?? CATEGORY_STATUS_BASE.insufficient;
    const inSessionPenalty = Math.min(MAX_IN_SESSION_PENALTY, askedThisInterview[category] * IN_SESSION_ASK_PENALTY);
    const priority = clamp(base - inSessionPenalty, 0, 100);

    let reason;
    if (askedThisInterview[category] > 0 && inSessionPenalty > 0) {
      reason = `already asked ${askedThisInterview[category]} time(s) this interview — reduce repetition`;
    } else if (cov.status === "unknown") {
      reason = "never tested for this candidate — no evidence yet";
    } else if (cov.status === "insufficient") {
      reason = "tested but not yet enough evidence to call it demonstrated";
    } else {
      reason = cov.recentlyTested
        ? "already well-evidenced and recently tested — favour other areas"
        : "already well-evidenced from prior interviews";
    }

    return { type: "category", key: category, priority, reason, evidence_strength: evidenceStrength(cov.evidenceCount) };
  });
}

/**
 * buildCompetencyPriorities(competencyCoverage, requiredCompetencies)
 *
 * competencyCoverage: candidateSignals.competencyCoverage — keyed by
 *   free-text competency label, only labels actually seen in evidence.
 * requiredCompetencies: profile.interview_profile.competencies —
 *   [{ name, basis }] (validateProfile's own shape) — used ONLY to detect
 *   a role-important competency that has NEVER been tested at all; no new
 *   competency taxonomy, matched by case-insensitive label equality
 *   against competencyCoverage's own free-text keys (§6: reuse the
 *   canonical methodology/competency representations already present,
 *   don't invent a second one).
 *
 * Returns one entry per competency that has either been tested at least
 * once OR is required by the role but never tested. A well-covered,
 * never-required competency is included (deprioritised) rather than
 * omitted — but an untested, non-required one is simply absent (there is
 * no bounded, fixed competency enum to pad out, same contract
 * candidateIntelligence.js's own buildCompetencyCoverage already has).
 */
export function buildCompetencyPriorities(competencyCoverage, requiredCompetencies) {
  const coverage = competencyCoverage && typeof competencyCoverage === "object" ? competencyCoverage : {};
  const entries = [];
  const seenLabels = new Set();

  for (const [competency, cov] of Object.entries(coverage)) {
    seenLabels.add(normalizeLabel(competency));
    const evidenceCount = num(cov?.evidenceCount, 0);
    const averageScore = cov?.averageScore;
    const wellCovered = evidenceCount >= COMPETENCY_EVIDENCE_BAR && averageScore != null && averageScore >= COMPETENCY_SCORE_BAR;
    const base = wellCovered ? WELL_COVERED_COMPETENCY_BASE : INSUFFICIENT_COMPETENCY_BASE;
    const reason = wellCovered
      ? "already demonstrated with a solid score across enough evidence"
      : evidenceCount === 0
        ? "not yet tested"
        : "tested but not yet enough evidence or score to call it demonstrated";
    entries.push({ type: "competency", key: competency, priority: clamp(base, 0, 100), reason, evidence_strength: evidenceStrength(evidenceCount) });
  }

  for (const req of arr(requiredCompetencies)) {
    const name = str(req?.name);
    if (!name) continue;
    if (seenLabels.has(normalizeLabel(name))) continue; // already covered above
    seenLabels.add(normalizeLabel(name));
    entries.push({
      type: "competency", key: name, priority: REQUIRED_UNTESTED_BASE,
      reason: "required by the role and never tested for this candidate", evidence_strength: 0,
    });
  }

  return entries;
}

/**
 * buildClaimPriorities(claims)
 *
 * claims: raw candidate_claims rows for this user (any status) —
 *   [{ id, claim_text, status, confidence, evidence_count, category, ... }],
 *   the SAME shape App.jsx already loads via dbSelect("candidate_claims").
 *   Deliberately takes the raw rows (not just candidateSignals
 *   .unresolvedClaims, which excludes supported/contradicted claims) so a
 *   well-evidenced claim can be surfaced as a genuine DEPRIORITY, not just
 *   omitted — cross-interview intelligence (§10) requires knowing about
 *   already-resolved claims too, not only unresolved ones.
 *
 * Returns one entry per claim: { type: "claim", key: claimId, priority,
 * reason, evidence_strength, category }. category (nullable) lets a
 * caller cross-reference which methodology category this claim's
 * evidence belongs to, without this module choosing anything structural
 * itself.
 */
export function buildClaimPriorities(claims) {
  return arr(claims)
    .filter((c) => c && c.id != null)
    .map((c) => {
      const status = c.status && CLAIM_STATUS_BASE[c.status] != null ? c.status : "unverified";
      const base = CLAIM_STATUS_BASE[status];
      const evidenceCount = num(c.evidence_count, 0);
      const decay = Math.min(base * 0.3, evidenceCount * CLAIM_EVIDENCE_DECAY_PER_POINT);
      const priority = clamp(base - decay, 0, 100);

      const reason = {
        unverified: "not yet tested in any interview",
        contradicted: "evidence has contradicted this claim — worth revisiting",
        partially_supported: "previously only partially substantiated — worth a deeper follow-up",
        supported: "already strongly evidenced — lower priority to retest",
      }[status];

      return {
        type: "claim", key: c.id, priority, reason,
        evidence_strength: evidenceStrength(evidenceCount),
        category: c.category ? mapLegacyCategory(c.category) : null,
      };
    });
}

/**
 * buildCoverageSummary(categoryCoverage, competencyCoverage)
 *
 * §8: candidate-specific coverage buckets — untouched / lightly_tested /
 * adequately_tested / over_tested — at both category and competency
 * granularity, purely derived from evidenceCount already computed by
 * candidateIntelligence.js. No new storage, no new aggregation source.
 */
export function buildCoverageSummary(categoryCoverage, competencyCoverage) {
  const catCov = categoryCoverage && typeof categoryCoverage === "object" ? categoryCoverage : {};
  const compCov = competencyCoverage && typeof competencyCoverage === "object" ? competencyCoverage : {};

  const categories = {};
  for (const category of ACTIVE_CATEGORIES) {
    const cov = catCov[category] || { evidenceCount: 0, status: "unknown", recentlyTested: false };
    categories[category] = { bucket: coverageBucket(cov.evidenceCount), evidenceCount: num(cov.evidenceCount, 0), status: cov.status || "unknown", recentlyTested: !!cov.recentlyTested };
  }

  const competencies = {};
  for (const [competency, cov] of Object.entries(compCov)) {
    competencies[competency] = {
      bucket: coverageBucket(cov?.evidenceCount),
      evidenceCount: num(cov?.evidenceCount, 0),
      averageScore: cov?.averageScore ?? null,
      recentlyTested: !!cov?.recentlyTested,
    };
  }

  return { categories, competencies };
}

/**
 * buildCategoryPreference(categoryPriorities)
 *
 * Maps each category priority (0-100) onto the bounded [-1, 1] scale
 * methodology.js's scheduleNextCategory accepts as an OPTIONAL nudge
 * (categoryPreference) — 50 (neutral) maps to 0, 100 (highest candidate-
 * specific priority) maps to +1, 0 maps to -1. methodology.js itself caps
 * how much this can ever move a scheduling decision (STRATEGY_NUDGE_CAP);
 * this module only supplies the direction/magnitude of the preference,
 * never the cap.
 */
export function buildCategoryPreference(categoryPriorities) {
  const preference = {};
  for (const entry of arr(categoryPriorities)) {
    if (entry?.type !== "category" || !ACTIVE_CATEGORIES.includes(entry.key)) continue;
    preference[entry.key] = clamp((num(entry.priority, 50) - 50) / 50, -1, 1);
  }
  return preference;
}

function sortDeterministic(entries) {
  return entries.slice().sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const typeDelta = (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99);
    if (typeDelta !== 0) return typeDelta;
    return String(a.key) < String(b.key) ? -1 : String(a.key) > String(b.key) ? 1 : 0;
  });
}

// The empty/inert strategy every legacy-data or malformed-input path
// degrades to. categoryPreference: {} means methodology.js's optional
// nudge is 0 for every category — the scheduler behaves EXACTLY as it did
// before Phase 2E (§16 legacy compatibility).
function emptyStrategy() {
  return { priorities: [], depriorities: [], coverage: { categories: {}, competencies: {} }, categoryPreference: {} };
}

/**
 * buildInterviewStrategy({ candidateSignals, claims, requiredCompetencies, transcript })
 *
 * The single structured output this module exists to produce.
 *
 * candidateSignals: candidateIntelligence.js's buildCandidateSignals()
 *   output (App.jsx's `candidateIntelligence` state) — reused verbatim,
 *   never recomputed from raw rows here (no duplicate aggregation, no
 *   extra DB read — §17 performance).
 * claims: raw candidate_claims rows (App.jsx's `candidateClaims` state).
 * requiredCompetencies: profile.interview_profile.competencies, optional.
 * transcript: this interview's own turns so far, optional.
 *
 * Always returns a complete, well-shaped object, even with
 * empty/missing/unusable inputs (never null/undefined fields a caller
 * would need to guard against separately) — see emptyStrategy() above.
 * Deterministic: identical input always produces identical output,
 * including list ordering (see sortDeterministic).
 */
export function buildInterviewStrategy({ candidateSignals, claims, requiredCompetencies, transcript } = {}) {
  if (!isCandidateIntelligenceUsable(candidateSignals)) return emptyStrategy();

  const categoryEntries = buildCategoryPriorities(candidateSignals.categoryCoverage, transcript);
  const competencyEntries = buildCompetencyPriorities(candidateSignals.competencyCoverage, requiredCompetencies);
  const claimEntries = buildClaimPriorities(claims);

  const all = [...claimEntries, ...competencyEntries, ...categoryEntries];
  const priorities = sortDeterministic(all.filter((e) => e.priority >= PRIORITY_THRESHOLD)).slice(0, MAX_PRIORITIES);
  const depriorities = sortDeterministic(all.filter((e) => e.priority <= DEPRIORITY_THRESHOLD))
    .reverse() // lowest priority (most deprioritised) first
    .slice(0, MAX_DEPRIORITIES);

  return {
    priorities,
    depriorities,
    coverage: buildCoverageSummary(candidateSignals.categoryCoverage, candidateSignals.competencyCoverage),
    categoryPreference: buildCategoryPreference(categoryEntries),
  };
}

/**
 * isInterviewStrategyUsable(strategy): defensive shape check, same gate
 * pattern as candidateIntelligence.js's isCandidateIntelligenceUsable —
 * the single check a caller needs before trusting strategy.categoryPreference
 * is a real (possibly empty) object rather than a malformed value.
 */
export function isInterviewStrategyUsable(strategy) {
  return !!strategy && typeof strategy === "object" && !!strategy.categoryPreference && typeof strategy.categoryPreference === "object";
}
