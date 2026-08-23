/* ================================================================== *
 * PHASE 2D — CANDIDATE INTELLIGENCE
 * ------------------------------------------------------------------
 * A pure, deterministic module (same pattern as methodology.js /
 * adaptiveEngine.js) that turns already-persisted raw evidence —
 * interview_memory rows, candidate_dna, and candidate_claims — into the
 * structured candidateSignals the live adaptive interview (Phase 2C,
 * untouched here) can consume.
 *
 *   Raw candidate/interview evidence
 *           |
 *           v
 *   Candidate Intelligence (this module)
 *           |
 *           v
 *   structured candidate signals
 *           |
 *           v
 *   Phase 2C adaptive scheduler (methodology.js / adaptiveEngine.js —
 *   NEVER called or modified from here)
 *
 * This module makes NO AI calls, touches NO database, and NEVER throws
 * on malformed/missing input — every function defensively degrades to a
 * safe empty result, because Candidate Intelligence must never break an
 * interview (see App.jsx's try/catch wrapping at every call site).
 *
 * category coverage / competency coverage are computed from
 * interview_memory (already persisted, one row per answered question,
 * across every interview) — no duplicate storage of raw interview data.
 * Only claims (candidate-specific assertions that accumulate evidence
 * across interviews) get their own table (candidate_claims) — everything
 * else here is a pure aggregation over data that already exists.
 * ================================================================== */

import { ACTIVE_CATEGORIES, mapLegacyCategory } from "./methodology.js";

// ---- 2D.1 enums -----------------------------------------------------
export const CLAIM_SOURCES = ["cv", "interview", "candidate_input"];
export const CLAIM_STATUSES = ["unverified", "partially_supported", "supported", "contradicted"];
export const CONFIDENCE_LEVELS = ["low", "medium", "high"];
// "unknown" is deliberately distinct from "insufficient": zero evidence is not
// the same as weak evidence — see buildCategoryCoverage below.
export const CATEGORY_STATUSES = ["unknown", "insufficient", "demonstrated"];

// ---- 2D.2 thresholds (documented, deterministic, no AI) --------------
// A category needs at least this many evidence points before it can be
// considered "demonstrated" rather than merely "insufficient" — a single
// good answer isn't enough to call a whole category demonstrated.
const MIN_EVIDENCE_FOR_DEMONSTRATED = 3;
// ...and the average competency_demonstration score across that evidence
// must clear this bar too. Matches the 0-100 evaluation rubric scale
// already used everywhere else in this codebase.
const DEMONSTRATED_SCORE_BAR = 60;

// Claim status thresholds, applied to (specificity + evidence) / 2 from the
// SAME evaluation rubric Call 1 already produces (2C.3) — no new scoring
// system. Mirrors the worked example in the Phase 2D spec: a vague answer
// moves an unverified claim to partially_supported (not stuck at
// unverified forever), a detailed, evidenced answer reaches supported.
// A later WEAK retest of an already-supported claim pulls it back down to
// partially_supported — contradictory/weak evidence reduces confidence,
// it never gets silently ignored.
const CLAIM_TEST_LOW = 25;
const CLAIM_TEST_HIGH = 70;

// A claim/category tested within this many days counts as "recently
// tested" — the simple last_tested/evidence_count staleness model the
// spec explicitly asks for, not an elaborate decay curve.
const RECENTLY_TESTED_WINDOW_DAYS = 21;

// How many unresolved claims to actively recommend probing, and how many
// total probe areas (fresh CV claims + recommended persistent ones) to
// hand to the scheduler for one interview — bounded so the prompt/context
// never grows unbounded as claims accumulate across many interviews.
const MAX_RECOMMENDED_PROBES = 3;
const MAX_MERGED_PROBE_AREAS = 5;

// Below this length a claim/answer excerpt is too short to safely
// substring-match against another string without false positives — same
// defensive shape as adaptiveEngine.js's MIN_EVIDENCE_MATCH_LENGTH.
const MIN_CLAIM_MATCH_LENGTH = 8;

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

/** normalizeClaimText(text): lowercase, trimmed, whitespace-collapsed — the basis for all claim matching/dedup below. */
export function normalizeClaimText(text) {
  return str(text).toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * claimsAreDuplicate(a, b): deterministic similarity check used when
 * seeding freshly-extracted CV claims against already-persisted ones, so
 * the same underlying claim is never persisted twice across interviews/
 * applications. Exact match after normalization, or one is a genuine
 * substring of the other (both sides must clear MIN_CLAIM_MATCH_LENGTH so
 * two short, unrelated strings never accidentally "match").
 */
export function claimsAreDuplicate(a, b) {
  const na = normalizeClaimText(a);
  const nb = normalizeClaimText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length < MIN_CLAIM_MATCH_LENGTH || nb.length < MIN_CLAIM_MATCH_LENGTH) return false;
  return na.includes(nb) || nb.includes(na);
}

/**
 * dedupeNewClaims(existingClaims, candidateProbeAreas)
 *
 * existingClaims: candidate_claims rows already persisted for this user
 *   (any status) — [{ claim_text, ... }].
 * candidateProbeAreas: this interview's freshly-extracted CV claims —
 *   [{ claim, why }] (validateProfile's candidate_profile.potential_probe_areas shape).
 *
 * Returns only the probe areas that are genuinely new (no existing claim
 * matches), so the same CV claim is never inserted twice just because the
 * candidate re-uploaded the same CV for a second application.
 */
export function dedupeNewClaims(existingClaims, candidateProbeAreas) {
  const existing = arr(existingClaims);
  return arr(candidateProbeAreas).filter((p) => {
    const claim = str(p?.claim);
    if (!claim) return false;
    return !existing.some((e) => claimsAreDuplicate(e.claim_text, claim));
  });
}

/**
 * classifyClaimStatus({ currentStatus, currentConfidence, evaluation })
 *
 * Deterministic status/confidence transition for a claim that was just
 * tested (a challenge_claim or follow_up turn anchored on it), from the
 * SAME evaluation rubric Call 1 (2C.3) already produces — no new AI call.
 * Weak evidence never single-handedly promotes a claim to "supported";
 * a weak retest of an already-supported claim pulls it back to
 * "partially_supported" (confidence can go down, never just up).
 */
export function classifyClaimStatus({ currentStatus, evaluation }) {
  const e = evaluation || {};
  const testScore = (num(e.specificity) + num(e.evidence)) / 2;
  if (testScore >= CLAIM_TEST_HIGH) return { status: "supported", confidence: "high" };
  if (testScore >= CLAIM_TEST_LOW) return { status: "partially_supported", confidence: "medium" };
  // A weak test result: an already-engaged claim (partially_supported/supported) softens
  // back to partially_supported rather than snapping to "contradicted" — this module never
  // auto-detects logical contradiction (that needs semantic judgement, out of scope for
  // deterministic processing); a genuinely untouched claim simply stays unverified.
  const status = currentStatus === "unverified" ? "unverified" : "partially_supported";
  return { status, confidence: "low" };
}

function daysBetween(a, b) {
  return Math.abs(a - b) / (1000 * 60 * 60 * 24);
}

/**
 * buildCategoryCoverage(memoryRows, now)
 *
 * memoryRows: interview_memory rows for this user — [{ category, score,
 *   interview_id, created_at, ... }], already persisted by the existing
 *   finishInterview flow, one row per answered adaptive-turn question.
 *
 * Returns { [category]: { evidenceCount, interviewCount, lastTestedAt,
 *   averageScore, status, recentlyTested } } for EVERY ACTIVE_CATEGORY
 *   (methodology.js's canonical taxonomy) — including zero-evidence ones,
 *   status "unknown", never silently omitted. Legacy category strings are
 *   normalized via mapLegacyCategory (same rule every other call site uses).
 */
export function buildCategoryCoverage(memoryRows, now = Date.now()) {
  const rows = arr(memoryRows);
  const byCategory = {};
  for (const c of ACTIVE_CATEGORIES) byCategory[c] = [];
  for (const r of rows) {
    const category = mapLegacyCategory(r?.category);
    if (byCategory[category]) byCategory[category].push(r);
  }

  const coverage = {};
  for (const category of ACTIVE_CATEGORIES) {
    const evidence = byCategory[category];
    const evidenceCount = evidence.length;
    const interviewCount = new Set(evidence.map((e) => e.interview_id).filter(Boolean)).size;
    const scores = evidence.map((e) => num(e.score, null)).filter((s) => s !== null);
    const averageScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const timestamps = evidence.map((e) => (e.created_at ? new Date(e.created_at).getTime() : null)).filter(Boolean);
    const lastTestedAt = timestamps.length ? Math.max(...timestamps) : null;

    let status;
    if (evidenceCount === 0) status = "unknown";
    else if (evidenceCount >= MIN_EVIDENCE_FOR_DEMONSTRATED && averageScore !== null && averageScore >= DEMONSTRATED_SCORE_BAR) status = "demonstrated";
    else status = "insufficient";

    coverage[category] = {
      evidenceCount, interviewCount, averageScore, lastTestedAt,
      status,
      recentlyTested: lastTestedAt !== null && daysBetween(now, lastTestedAt) <= RECENTLY_TESTED_WINDOW_DAYS,
    };
  }
  return coverage;
}

/**
 * buildCompetencyCoverage(memoryRows, now)
 *
 * Same aggregation as buildCategoryCoverage, but keyed by the free-text
 * `competency` label (e.g. "leadership") instead of the fixed canonical
 * category enum — a secondary, more granular signal. Only competencies
 * that actually appear in the evidence are included (there is no fixed
 * enum to pad out with "unknown" entries here, unlike category coverage).
 */
export function buildCompetencyCoverage(memoryRows, now = Date.now()) {
  const rows = arr(memoryRows).filter((r) => str(r?.competency));
  const byCompetency = {};
  for (const r of rows) (byCompetency[r.competency] = byCompetency[r.competency] || []).push(r);

  const coverage = {};
  for (const [competency, evidence] of Object.entries(byCompetency)) {
    const evidenceCount = evidence.length;
    const interviewCount = new Set(evidence.map((e) => e.interview_id).filter(Boolean)).size;
    const scores = evidence.map((e) => num(e.score, null)).filter((s) => s !== null);
    const averageScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const timestamps = evidence.map((e) => (e.created_at ? new Date(e.created_at).getTime() : null)).filter(Boolean);
    const lastTestedAt = timestamps.length ? Math.max(...timestamps) : null;
    coverage[competency] = {
      evidenceCount, interviewCount, averageScore, lastTestedAt,
      recentlyTested: lastTestedAt !== null && daysBetween(now, lastTestedAt) <= RECENTLY_TESTED_WINDOW_DAYS,
    };
  }
  return coverage;
}

/**
 * buildUnresolvedClaims(claims): persisted claims still worth probing —
 * unverified or only partially supported — sorted deterministically:
 * least-evidenced first, then oldest first, so the same claim set always
 * produces the same priority order.
 */
export function buildUnresolvedClaims(claims) {
  return arr(claims)
    .filter((c) => c && (c.status === "unverified" || c.status === "partially_supported"))
    .slice()
    .sort((a, b) => {
      const byEvidence = num(a.evidence_count) - num(b.evidence_count);
      if (byEvidence !== 0) return byEvidence;
      return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
    });
}

/**
 * buildRecommendedProbes(unresolvedClaims, max = MAX_RECOMMENDED_PROBES)
 *
 * Maps the top N unresolved claims into the {claim, why, category,
 * claimId} probe shape — "why" is deterministic (derived from status),
 * never AI-generated, so this stays a pure function.
 */
export function buildRecommendedProbes(unresolvedClaims, max = MAX_RECOMMENDED_PROBES) {
  return arr(unresolvedClaims)
    .slice(0, Math.max(0, max))
    .map((c) => ({
      claim: c.claim_text,
      why: c.status === "partially_supported" ? "previously only partially substantiated — worth a deeper follow-up" : "not yet tested in any interview",
      category: c.category || null,
      claimId: c.id,
    }));
}

/**
 * mergeProbeAreasForInterview(freshProbeAreas, recommendedProbes, max)
 *
 * freshProbeAreas: this interview's own newly-extracted CV claims —
 *   [{ claim, why }] (validateProfile's own output for THIS application).
 * recommendedProbes: buildRecommendedProbes()'s output — persistent,
 *   cross-interview unresolved claims.
 *
 * Returns the single merged, deduped, bounded {claim, why}[] array meant
 * to be substituted into profile.candidate_profile.potential_probe_areas
 * before it reaches the Phase 2C scheduler — the ONLY integration point
 * with adaptiveEngine.js, which already accepts this exact shape
 * unmodified (adaptPotentialProbeAreas). category selection, turn type,
 * and anchor source remain entirely the scheduler's — this only widens
 * the pool of candidate-specific claims the scheduler may choose to
 * anchor a challenge_claim turn on.
 */
export function mergeProbeAreasForInterview(freshProbeAreas, recommendedProbes, max = MAX_MERGED_PROBE_AREAS) {
  const merged = [];
  const seen = [];
  for (const p of [...arr(freshProbeAreas), ...arr(recommendedProbes)]) {
    const claim = str(p?.claim);
    if (!claim) continue;
    if (seen.some((s) => claimsAreDuplicate(s, claim))) continue;
    seen.push(claim);
    merged.push({ claim, why: str(p?.why) });
    if (merged.length >= max) break;
  }
  return merged;
}

/**
 * matchClaimIdForProbeArea(claims, text)
 *
 * Finds which persisted claim a given piece of text corresponds to, via
 * the same symmetric substring match claimsAreDuplicate already defines.
 * Two call shapes, same function: (1) given a probe-area claim string
 * from a challenge_claim decision's genInput, identify the persisted
 * claim it came from; (2) given the candidate's own answer text that
 * just triggered challenge_worthy, identify which persisted claim that
 * answer is actually about — the claim a resulting challenge_claim
 * question will target, before it's even generated. Either way, the
 * matched claim's status can be updated once the resulting question is
 * answered. Returns null when nothing matches (e.g. the claim came from
 * this interview's fresh CV extraction and hasn't been persisted yet) —
 * callers must handle a null match without erroring.
 */
export function matchClaimIdForProbeArea(claims, text) {
  const found = arr(claims).find((c) => claimsAreDuplicate(c.claim_text, text));
  return found ? found.id : null;
}

/**
 * buildCandidateSignals({ dna, memoryRows, claims, now })
 *
 * The single structured output this module exists to produce — assembled
 * entirely from already-persisted data, no AI call. Always returns a
 * complete, well-shaped object, even with empty/missing inputs (an empty
 * candidate produces empty arrays and "unknown" category coverage, never
 * null/undefined fields a caller would need to guard against separately).
 */
export function buildCandidateSignals({ dna, memoryRows, claims, now = Date.now() } = {}) {
  const categoryCoverage = buildCategoryCoverage(memoryRows, now);
  const competencyCoverage = buildCompetencyCoverage(memoryRows, now);
  const unresolvedClaims = buildUnresolvedClaims(claims);
  const untestedCompetencies = ACTIVE_CATEGORIES.filter((c) => categoryCoverage[c].status === "unknown");
  const recentlyTested = ACTIVE_CATEGORIES.filter((c) => categoryCoverage[c].recentlyTested);

  return {
    strengths: arr(dna?.strengths),
    developmentAreas: arr(dna?.weaknesses),
    categoryCoverage,
    competencyCoverage,
    untestedCompetencies,
    recentlyTested,
    unresolvedClaims: unresolvedClaims.map((c) => ({
      claimId: c.id, claim: c.claim_text, status: c.status, confidence: c.confidence,
      evidenceCount: num(c.evidence_count), category: c.category || null,
    })),
    recommendedProbes: buildRecommendedProbes(unresolvedClaims),
  };
}

/**
 * isCandidateIntelligenceUsable(signals): defensive shape check — the
 * single gate App.jsx's call sites use to decide "do I have real
 * candidate intelligence to use, or should I fall back to Phase 2C's
 * existing behaviour untouched". A missing/malformed/empty result is
 * always a safe, silent fallback, never a thrown error.
 */
export function isCandidateIntelligenceUsable(signals) {
  return !!signals && typeof signals === "object" && !!signals.categoryCoverage;
}
