/* ================================================================== *
 * PHASE 2F — CANDIDATE STATE & EVIDENCE ENGINE
 * ------------------------------------------------------------------
 * A pure, deterministic module (same pattern as methodology.js /
 * adaptiveEngine.js / candidateIntelligence.js / interviewStrategy.js)
 * that closes the feedback loop between the existing AI evaluation
 * (Call 1's structured rubric — relevance/specificity/structure/
 * evidence/clarity/competency_demonstration) and Phase 2E's Interview
 * Strategy:
 *
 *   Existing AI evaluation (Call 1, untouched)
 *           |
 *           v
 *   Evidence Engine (this module) — deterministically classifies HOW
 *   STRONG a piece of evidence is from the rubric already produced
 *           |
 *           v
 *   Candidate State (this module) — the structured, explainable record
 *   of what the candidate has actually demonstrated: per-claim and
 *   per-competency evidence history, confidence, trend
 *           |
 *           v
 *   Interview Strategy (interviewStrategy.js, untouched) — consumes
 *   Candidate State as a drop-in superset of candidateIntelligence.js's
 *   candidateSignals (same categoryCoverage/competencyCoverage shape,
 *   plus additive claims/competencies/categories detail)
 *           |
 *           v
 *   Phase 2C scheduler (methodology.js/adaptiveEngine.js) — untouched,
 *   still the only place category/turn-type/anchor is decided
 *
 * This module makes NO AI calls, touches NO database, has no React or
 * browser dependency, and NEVER throws on malformed/missing input —
 * every function defensively degrades to a safe, empty result, same
 * contract as every other pure module in this codebase.
 *
 * It does NOT recompute categoryCoverage/competencyCoverage from raw
 * rows (candidateIntelligence.js already owns that aggregation) — it
 * REUSES that output and only adds the evidence-event/trend/confidence
 * layer on top, so there is exactly one place category/competency
 * coverage is aggregated from interview_memory, not two.
 * ================================================================== */

import { ACTIVE_CATEGORIES, mapLegacyCategory } from "./methodology.js";

// ---- 2F.1 evidence strength model -----------------------------------
// Deliberately five buckets, no more — "do not create fake precision".
// "insufficient" means the evidence engine had nothing reliable to judge
// (no evaluation data at all, or a near-empty/off-topic answer) — it is
// NOT the same as "weak" (an evaluation exists and it's genuinely weak).
export const EVIDENCE_STRENGTHS = ["strong", "moderate", "weak", "contradictory", "insufficient"];

// Same 0-100 rubric scale every evaluation in this codebase already
// uses. STRENGTH_HIGH/STRENGTH_MID mirror candidateIntelligence.js's own
// CLAIM_TEST_HIGH/CLAIM_TEST_LOW bars (70/25) for consistency — not
// re-derived independently — with one additional floor
// (STRENGTH_FLOOR) below which there's too little signal to call even
// "weak" a reliable read.
const STRENGTH_HIGH = 70;
const STRENGTH_MID = 45;
const STRENGTH_FLOOR = 15;

// Bounded-influence window: confidence and trend are read off at most the
// last N evidence events, never the single latest one and never an
// unbounded full history — "a single strong answer should not permanently
// eliminate an important competency" / "a single weak answer should not
// consume the interview".
const CONFIDENCE_WINDOW = 3;
const STRENGTH_SCORE = { strong: 2, moderate: 1, weak: 0, contradictory: -1 };

// A trend/inconsistency read needs at least this many real (non-
// insufficient) data points — "do not overreact to a single answer".
const MIN_EVENTS_FOR_TREND = 3;
// Average movement (0-100 scale) between the first and second half of the
// evidence history required to call it a real improving/declining trend
// rather than noise.
const TREND_BAND = 8;
// A single consecutive-event swing this large counts toward "inconsistent".
const INCONSISTENCY_SWING = 30;
const INCONSISTENCY_STRENGTH_SWING = 2; // e.g. strong (2) -> contradictory (-1)

// Coverage buckets — same bucket NAMES interviewStrategy.js's own
// (unexported) coverageBucket() already uses, applied here at the
// claim/competency/category evidence-event level. Not a new taxonomy,
// just the same four-way bucketing reused where this module needs it.
const LIGHT_COVERAGE_MAX = 2;
const ADEQUATE_COVERAGE_MAX = 5;

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v, fallback = "") {
  return typeof v === "string" ? v : fallback;
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}
function coverageBucketFor(n) {
  const count = num(n, 0);
  if (count === 0) return "untouched";
  if (count <= LIGHT_COVERAGE_MAX) return "lightly_tested";
  if (count <= ADEQUATE_COVERAGE_MAX) return "adequately_tested";
  return "over_tested";
}

/**
 * evaluateEvidence({ evaluation, priorStatus })
 *
 * The Evidence Engine's core classification step. evaluation: the SAME
 * structured rubric Call 1 already produces ({ specificity, evidence,
 * ... } — see App.jsx's evaluation schema); no new AI call, no new
 * scoring system. priorStatus: OPTIONAL — the claim/competency's status
 * BEFORE this test (candidateIntelligence.js's CLAIM_STATUSES, e.g.
 * "supported"), used only to distinguish "weak" from "contradictory"
 * (see below).
 *
 * score is (specificity + evidence) / 2 — the exact same formula
 * candidateIntelligence.js's classifyClaimStatus already uses, so a
 * detailed answer with a personal contribution, a measurable outcome and
 * consistent follow-up (which the rubric itself already rewards on
 * those two axes) naturally lands "strong", while a vague assertion
 * lands "weak" — no new heuristic invented for this module.
 *
 * "contradictory" is deliberately NOT a semantic contradiction detector
 * (no NLP, no AI call). It is a purely numeric pattern: new evidence
 * that scores weak-or-below, arriving for a claim/competency the
 * evidence history had ALREADY classified as "supported" — i.e. this
 * specific test's result directly conflicts with a prior strong result,
 * which is exactly the observable pattern the Phase 2F worked example
 * describes (strong, then a later weak result pulls confidence back
 * down). Without a priorStatus of "supported", a low score is simply
 * "weak" (or "insufficient" below the floor) — an untested or already-
 * shaky claim doesn't get "contradicted" the first time it scores low.
 *
 * Returns { strength, score } — score is null when there was no
 * evaluation data at all (distinct from a genuine 0).
 */
export function evaluateEvidence({ evaluation, priorStatus } = {}) {
  const e = evaluation && typeof evaluation === "object" ? evaluation : {};
  const specificity = numOrNull(e.specificity);
  const evidence = numOrNull(e.evidence);
  if (specificity === null && evidence === null) return { strength: "insufficient", score: null };

  const score = ((specificity ?? 0) + (evidence ?? 0)) / 2;
  let band;
  if (score >= STRENGTH_HIGH) band = "strong";
  else if (score >= STRENGTH_MID) band = "moderate";
  else if (score >= STRENGTH_FLOOR) band = "weak";
  else band = "insufficient";

  if ((band === "weak" || band === "insufficient") && priorStatus === "supported") band = "contradictory";
  return { strength: band, score: Math.round(score) };
}

/**
 * buildEvidenceEvent({ interviewId, questionId, claimId, category,
 *   competency, evaluation, answerExcerpt, priorStatus, timestamp })
 *
 * Assembles one structured, explainable evidence-event record — the
 * atomic unit Candidate State is built from. Reuses existing database
 * identifiers (interview_id/question_id/claim_id — the same IDs already
 * persisted elsewhere, e.g. candidate_claims.last_tested_interview_id)
 * rather than inventing new ones. answerExcerpt is truncated the same
 * way the pre-2F claim-evidence quote already was (300 chars) — no new
 * storage shape, just a formalised version of it.
 */
export function buildEvidenceEvent({ interviewId, questionId, claimId, category, competency, evaluation, answerExcerpt, priorStatus, timestamp } = {}) {
  const { strength, score } = evaluateEvidence({ evaluation, priorStatus });
  return {
    source: "interview",
    interview_id: interviewId ?? null,
    question_id: questionId ?? null,
    claim_id: claimId ?? null,
    category: category ? mapLegacyCategory(category) : null,
    competency: competency || null,
    strength,
    score,
    quote: typeof answerExcerpt === "string" ? answerExcerpt.slice(0, 300) : "",
    created_at: timestamp || new Date().toISOString(),
  };
}

/**
 * calculateConfidence(events)
 *
 * Bounded-influence confidence read: only the last CONFIDENCE_WINDOW
 * REAL (non-"insufficient") events ever contribute, so neither a single
 * strong result nor a single weak/contradictory one can single-handedly
 * swing confidence from one extreme to the other — "a single weak
 * answer should not consume the interview; a single strong answer
 * should not permanently eliminate an important competency" (§ bounded
 * influence). Returns one of candidateIntelligence.js's own
 * CONFIDENCE_LEVELS ("low"/"medium"/"high") — no new scale.
 */
export function calculateConfidence(events) {
  const valid = arr(events).filter((e) => e && e.strength && e.strength !== "insufficient");
  if (!valid.length) return "low";
  const recent = valid.slice(-CONFIDENCE_WINDOW);
  const avg = recent.reduce((s, e) => s + (STRENGTH_SCORE[e.strength] ?? 0), 0) / recent.length;
  if (avg >= 1.5) return "high";
  if (avg >= 0.5) return "medium";
  return "low";
}

/**
 * detectInconsistency(events)
 *
 * Deterministic, numeric-only inconsistency flag — NOT semantic
 * contradiction detection. True when at least half of the consecutive
 * event-to-event transitions (and at least 2) are big swings in
 * strength (e.g. strong -> contradictory, or a >=30-point score jump).
 * Needs at least MIN_EVENTS_FOR_TREND real events — a single flip
 * between two data points is not "inconsistent", it's just two data
 * points.
 */
export function detectInconsistency(events) {
  const valid = arr(events).filter((e) => e && e.strength && e.strength !== "insufficient");
  if (valid.length < MIN_EVENTS_FOR_TREND) return false;
  let swings = 0;
  for (let i = 1; i < valid.length; i++) {
    const strengthDelta = Math.abs((STRENGTH_SCORE[valid[i].strength] ?? 0) - (STRENGTH_SCORE[valid[i - 1].strength] ?? 0));
    const scoreDelta = Math.abs(num(valid[i].score, 0) - num(valid[i - 1].score, 0));
    if (strengthDelta >= INCONSISTENCY_STRENGTH_SWING || scoreDelta >= INCONSISTENCY_SWING) swings++;
  }
  const transitions = valid.length - 1;
  return swings >= 2 && swings >= Math.ceil(transitions / 2);
}

/**
 * computeTrend(events)
 *
 * Simple, deterministic, no ML/statistical forecasting: compares the
 * average score of the first half of the (chronologically sorted)
 * evidence history to the second half. A real, sustained movement
 * (>= TREND_BAND) either way is "improving"/"declining"; otherwise
 * "stable". A volatile history (see detectInconsistency's own swing
 * rule) is reported as "inconsistent" instead of averaged over, since
 * an average would hide the volatility. Fewer than MIN_EVENTS_FOR_TREND
 * real data points is "insufficient_data" — never guessed at.
 */
export function computeTrend(events) {
  const valid = arr(events)
    .filter((e) => e && numOrNull(e.score) !== null)
    .slice()
    .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
  if (valid.length < MIN_EVENTS_FOR_TREND) return "insufficient_data";

  const scores = valid.map((e) => num(e.score, 0));

  // Volatility check, purely on the raw scores this function already has (deliberately NOT
  // delegating to detectInconsistency, which reads `.strength` — computeTrend must work off
  // score history alone, since callers may not have classified every event). A big swing
  // between consecutive answers, on at least half the transitions, means an average would
  // hide the volatility rather than describe it.
  let swings = 0;
  for (let i = 1; i < scores.length; i++) if (Math.abs(scores[i] - scores[i - 1]) >= INCONSISTENCY_SWING) swings++;
  const transitions = scores.length - 1;
  if (swings >= 2 && swings >= Math.ceil(transitions / 2)) return "inconsistent";

  const mid = Math.floor(scores.length / 2);
  const firstHalf = scores.slice(0, mid);
  const secondHalf = scores.slice(scores.length - mid);
  const avg = (list) => list.reduce((s, v) => s + v, 0) / list.length;
  const delta = avg(secondHalf) - avg(firstHalf);

  if (delta >= TREND_BAND) return "improving";
  if (delta <= -TREND_BAND) return "declining";
  return "stable";
}

// ---- 2F.2 claim evidence --------------------------------------------

/**
 * updateClaimEvidence(claim, event)
 *
 * The Evidence Engine's claim-side update. `claim` accepts EITHER the
 * raw candidate_claims DB row shape ({ status, confidence, evidence: [],
 * evidence_count, ... } — App.jsx's own shape) or this module's own
 * claim-state shape ({ status, confidence, events: [], ... },
 * buildClaimState's output) — both are read defensively via `.evidence`
 * falling back to `.events`, so a caller never needs to convert between
 * them. Returns the SAME shape family back (both `evidence` and
 * `events` set to the new list) so callers on either side can keep
 * using whichever field name they already read.
 *
 * Deterministic transition table, reusing candidateIntelligence.js's own
 * CLAIM_STATUSES/CONFIDENCE_LEVELS enum (never a new one):
 *   strong        -> supported          (confidence via calculateConfidence)
 *   moderate      -> partially_supported
 *   weak          -> unverified claim stays unverified; an already-
 *                    engaged claim softens to partially_supported
 *                    (same rule candidateIntelligence.js's own
 *                    classifyClaimStatus already documents)
 *   contradictory -> contradicted
 *   insufficient  -> no reliable signal; the event is still appended
 *                    (for audit/explainability) but status/confidence/
 *                    evidence_count are left untouched — "if existing
 *                    data does not support a reliable inference, do not
 *                    invent one".
 *
 * A missing `event` is a no-op (returns `claim` unchanged) — defensive,
 * never throws.
 */
export function updateClaimEvidence(claim, event) {
  const c = claim && typeof claim === "object" ? claim : {};
  if (!event) return c;
  const priorEvents = arr(c.evidence).length ? arr(c.evidence) : arr(c.events);
  const nextEvents = [...priorEvents, event];

  if (event.strength === "insufficient") {
    return { ...c, evidence: nextEvents, events: nextEvents };
  }

  const currentStatus = c.status;
  let status;
  if (event.strength === "strong") status = "supported";
  else if (event.strength === "moderate") status = "partially_supported";
  else if (event.strength === "contradictory") status = "contradicted";
  else status = currentStatus === "unverified" || !currentStatus ? "unverified" : "partially_supported"; // weak

  const confidence = calculateConfidence(nextEvents);
  const evidenceCount = nextEvents.filter((e) => e && e.strength && e.strength !== "insufficient").length;

  return {
    ...c,
    status,
    confidence,
    evidence: nextEvents,
    events: nextEvents,
    evidence_count: evidenceCount,
    last_tested_interview_id: event.interview_id ?? c.last_tested_interview_id ?? null,
    last_tested_at: event.created_at || new Date().toISOString(),
  };
}

/**
 * buildClaimState(claimRow)
 *
 * Read-model only — trusts the persisted candidate_claims row's own
 * status/confidence/evidence_count as the source of truth (no
 * recomputation/replay of history here; see updateClaimEvidence for the
 * function that actually advances those fields when new evidence
 * arrives). Adds read-only, additive insight on top: a per-strength
 * event breakdown and an inconsistency flag, both computed ONLY from
 * evidence entries that actually carry a `strength` (2F-native events —
 * a legacy claim whose evidence array predates Phase 2F simply has an
 * all-zero breakdown, never a fabricated one).
 */
export function buildClaimState(claimRow) {
  const c = claimRow && typeof claimRow === "object" ? claimRow : {};
  const events = arr(c.evidence).length ? arr(c.evidence) : arr(c.events);
  const classified = events.filter((e) => e && EVIDENCE_STRENGTHS.includes(e.strength) && e.strength !== "insufficient");
  const strengthCounts = { strong: 0, moderate: 0, weak: 0, contradictory: 0 };
  for (const e of classified) strengthCounts[e.strength]++;

  return {
    claimId: c.id ?? c.claimId ?? null,
    claim: str(c.claim_text ?? c.claim),
    status: str(c.status, "unverified"),
    confidence: str(c.confidence, "low"),
    tests: num(c.evidence_count, classified.length),
    evidenceStrength: classified.length ? classified[classified.length - 1].strength : "insufficient",
    strengthCounts,
    inconsistent: detectInconsistency(classified),
    lastTestedInterviewId: c.last_tested_interview_id ?? c.lastTestedInterviewId ?? null,
    lastTestedAt: c.last_tested_at ?? c.lastTestedAt ?? null,
    category: c.category ? mapLegacyCategory(c.category) : null,
    events,
  };
}

// ---- 2F.3 competency evidence ----------------------------------------

/**
 * updateCompetencyEvidence(competencyState, event)
 *
 * competencyState: this module's own per-competency state shape (see
 * summarizeCompetencyEvents below) or undefined/null for a competency
 * seen for the first time. event: OPTIONAL — omitting it just
 * re-summarises the existing event list unchanged (defensive no-op).
 */
export function updateCompetencyEvidence(competencyState, event) {
  const priorEvents = arr(competencyState?.events);
  const events = event ? [...priorEvents, event] : priorEvents;
  return summarizeCompetencyEvents(events);
}

function summarizeCompetencyEvents(events) {
  const valid = arr(events).filter(Boolean);
  const classified = valid.filter((e) => e.strength && e.strength !== "insufficient");
  const strengthCounts = { strong: 0, moderate: 0, weak: 0, contradictory: 0 };
  for (const e of classified) if (strengthCounts[e.strength] != null) strengthCounts[e.strength]++;
  return {
    events: valid,
    tests: classified.length,
    strengthCounts,
    coverage: coverageBucketFor(classified.length),
    trend: computeTrend(valid),
    confidence: calculateConfidence(valid),
    inconsistent: detectInconsistency(valid),
    mostRecentEvidence: valid.length ? valid[valid.length - 1] : null,
  };
}

/**
 * strengthFromScore(score)
 *
 * interview_memory rows (the durable, cross-interview competency
 * evidence log this module reuses — see buildCandidateState) only carry
 * a single blended `score` per answered question, not the full Call-1
 * rubric object evaluateEvidence() reads. This applies the SAME
 * STRENGTH_HIGH/STRENGTH_MID/STRENGTH_FLOOR bars to that single score,
 * documented as intentionally the same bars, not a second scoring
 * system.
 */
function strengthFromScore(score) {
  const s = numOrNull(score);
  if (s === null) return "insufficient";
  if (s >= STRENGTH_HIGH) return "strong";
  if (s >= STRENGTH_MID) return "moderate";
  if (s >= STRENGTH_FLOOR) return "weak";
  return "insufficient";
}

/**
 * buildCompetencyStates(questionHistory)
 *
 * questionHistory: App.jsx's own already-hydrated state — one entry per
 * interview_memory row ({ competency, category, score, date, ... }), no
 * second data source. Groups by competency (free-text label, same
 * convention candidateIntelligence.js's buildCompetencyCoverage already
 * uses — no new taxonomy), sorts chronologically, and folds every row
 * into an evidence event via strengthFromScore.
 */
export function buildCompetencyStates(questionHistory) {
  const rows = arr(questionHistory).filter((r) => r && str(r.competency));
  const byCompetency = {};
  for (const r of rows) (byCompetency[r.competency] = byCompetency[r.competency] || []).push(r);

  const result = {};
  for (const [competency, rowsForC] of Object.entries(byCompetency)) {
    const sorted = rowsForC
      .slice()
      .sort((a, b) => new Date(a.date || a.created_at || 0).getTime() - new Date(b.date || b.created_at || 0).getTime());
    const events = sorted.map((r) => ({
      source: "interview_memory",
      interview_id: r.interviewId ?? r.interview_id ?? null,
      category: r.category ? mapLegacyCategory(r.category) : null,
      competency,
      strength: strengthFromScore(r.score),
      score: numOrNull(r.score),
      created_at: r.date ? new Date(r.date).toISOString() : (r.created_at || null),
    }));
    result[competency] = summarizeCompetencyEvents(events);
  }
  return result;
}

// ---- 2F.4 category evidence -------------------------------------------

/**
 * buildCategoryStates(categoryCoverage)
 *
 * categoryCoverage: candidateIntelligence.js's own buildCategoryCoverage
 * output (candidateSignals.categoryCoverage) — reused verbatim, no
 * second aggregation. Adds the over-testing/under-testing framing the
 * spec asks for (§ categories) purely as a different bucketing of the
 * SAME evidenceCount candidateIntelligence.js already computed.
 */
export function buildCategoryStates(categoryCoverage) {
  const coverage = categoryCoverage && typeof categoryCoverage === "object" ? categoryCoverage : {};
  const result = {};
  for (const category of ACTIVE_CATEGORIES) {
    const cov = coverage[category] || { evidenceCount: 0, status: "unknown", recentlyTested: false };
    const n = num(cov.evidenceCount, 0);
    result[category] = {
      testedCount: n,
      coverage: coverageBucketFor(n),
      overTesting: n > ADEQUATE_COVERAGE_MAX,
      underTesting: n === 0,
      status: cov.status || "unknown",
      recentlyTested: !!cov.recentlyTested,
    };
  }
  return result;
}

// ---- 2F.5 candidate state assembly -------------------------------------

/**
 * buildCandidateState({ candidateSignals, claims, questionHistory })
 *
 * The single structured output this module exists to produce. Returns a
 * SUPERSET of candidateSignals (candidateIntelligence.js's
 * buildCandidateSignals output — every field it already exposes,
 * strengths/developmentAreas/categoryCoverage/competencyCoverage/
 * untestedCompetencies/recentlyTested/unresolvedClaims/recommendedProbes,
 * copied through unchanged) plus three additive, read-only fields:
 *
 *   claims:       array, one entry per candidate_claims row (buildClaimState)
 *   competencies: object keyed by competency label (buildCompetencyStates)
 *   categories:   object keyed by ACTIVE_CATEGORY (buildCategoryStates)
 *
 * Being a strict superset means this object is a safe drop-in
 * replacement anywhere candidateSignals itself is already consumed
 * (interviewStrategy.buildInterviewStrategy's own isCandidateIntelligence
 * Usable() gate only ever reads .categoryCoverage) — Interview Strategy
 * genuinely consumes Candidate State (Phase 2F's own integration
 * requirement) without interviewStrategy.js needing to change at all.
 *
 * No AI call, no DB read of its own — claims/questionHistory are the
 * SAME already-hydrated React state App.jsx already holds (candidateClaims/
 * questionHistory, loaded once at session hydration — see loadFullUserState).
 * Never throws: malformed/missing input degrades to candidateSignals
 * (or `{}`) with empty claims/competencies/categories.
 */
export function buildCandidateState({ candidateSignals, claims, questionHistory } = {}) {
  const base = candidateSignals && typeof candidateSignals === "object" ? candidateSignals : {};
  const claimStates = arr(claims)
    .filter((c) => c && c.id != null)
    .map((c) => buildClaimState(c));
  const competencyStates = buildCompetencyStates(questionHistory);
  const categoryStates = buildCategoryStates(base.categoryCoverage);

  return { ...base, claims: claimStates, competencies: competencyStates, categories: categoryStates };
}

/**
 * updateCandidateState(state, event)
 *
 * The CURRENT-INTERVIEW live-update path: folds one freshly-computed
 * evidence event (buildEvidenceEvent's output) into an already-built
 * candidateState IN MEMORY, with no DB re-read and no re-aggregation of
 * the rest of the candidate's history — "hydrate once, maintain in
 * memory, update after each answer" (§ performance). `state`: buildCandidateState's
 * output (or `{}`/candidateSignals — degrades gracefully either way).
 * A missing/malformed event is a no-op.
 *
 * Only touches the ONE claim (event.claimId), the ONE competency
 * (event.competency) and the ONE category (event.category) the event is
 * actually about — every other entry in state is passed through
 * unchanged, so one answer can never cascade into altering unrelated
 * claims/competencies/categories ("bounded influence").
 */
export function updateCandidateState(state, event) {
  const s = state && typeof state === "object" ? state : {};
  if (!event || typeof event !== "object") return s;
  const next = { ...s };

  if (event.claim_id != null) {
    const claims = Array.isArray(s.claims) ? s.claims.slice() : [];
    const idx = claims.findIndex((c) => c.claimId === event.claim_id);
    const priorState = idx >= 0 ? claims[idx] : { claimId: event.claim_id, claim: "", status: "unverified", confidence: "low", events: [] };
    const updatedRow = updateClaimEvidence(priorState, event);
    const updatedState = buildClaimState({ ...updatedRow, id: event.claim_id });
    if (idx >= 0) claims[idx] = updatedState;
    else claims.push(updatedState);
    next.claims = claims;
  }

  if (event.competency) {
    const competencies = { ...(s.competencies || {}) };
    competencies[event.competency] = updateCompetencyEvidence(competencies[event.competency], event);
    next.competencies = competencies;
  }

  if (event.category) {
    const category = mapLegacyCategory(event.category);
    const categories = { ...(s.categories || {}) };
    const prior = categories[category] || { testedCount: 0, coverage: "untouched", overTesting: false, underTesting: true, status: "unknown", recentlyTested: false };
    const testedCount = prior.testedCount + (event.strength !== "insufficient" ? 1 : 0);
    categories[category] = {
      ...prior,
      testedCount,
      coverage: coverageBucketFor(testedCount),
      overTesting: testedCount > ADEQUATE_COVERAGE_MAX,
      underTesting: testedCount === 0,
      recentlyTested: true,
    };
    next.categories = categories;
  }

  return next;
}

/**
 * isCandidateStateUsable(state): defensive shape check, same gate
 * pattern as candidateIntelligence.js's isCandidateIntelligenceUsable /
 * interviewStrategy.js's isInterviewStrategyUsable.
 */
export function isCandidateStateUsable(state) {
  return !!state && typeof state === "object" && Array.isArray(state.claims) && !!state.competencies && !!state.categories;
}
