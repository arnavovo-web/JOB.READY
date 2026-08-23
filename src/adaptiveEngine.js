/* ================================================================== *
 * PHASE 2C.2 — ADAPTIVE ENGINE / ORCHESTRATION (ADAPTER LAYER)
 * ------------------------------------------------------------------
 * Pure, in-memory adapter that connects App.jsx's EXISTING live-interview
 * data shapes (interview.transcript / interview.currentQuestion /
 * interview.config / interview.maxQuestions / candidate_profile) to the
 * Phase 2C.1 deterministic scheduler (./methodology.js). This module:
 *
 *   - makes NO AI calls,
 *   - touches NO database,
 *   - does NOT modify submitAnswer, interview_turn, prompts, or the UI,
 *   - does NOT wire the scheduler into the live interview (that is a
 *     future phase) — it only proves, in-memory and independently
 *     testably, that the wiring WOULD be correct.
 *
 * It is deliberately a separate file from methodology.js: methodology.js
 * stays the pure taxonomy/distribution/scheduler engine (2A/2B/2C.1) with
 * no knowledge of App.jsx's shapes at all; this file is the one place
 * that translates between "what App.jsx's live interview actually looks
 * like today" and "what the scheduler expects". This is the live,
 * turn-by-turn conversational engine's adapter only — it has no import
 * of, reference to, or knowledge of the OTHER (pre-generated, one-way)
 * question-delivery engine Phase 4B built, or of that engine's own
 * pipeline-selection key; the two stay fully isolated (see this file's
 * own isolation test in adaptiveEngine.test.js).
 * ================================================================== */

import {
  mapLegacyCategory,
  normalizeAnchorSource,
  TURN_TYPES,
  MAX_PROBE_DEPTH,
  scheduleNextCategory,
  countTrailingProbeDepth,
  resolveTurnDirective,
} from "./methodology.js";

// ---- 2C.2.1 decision <-> {signal, turn_type} maps ------------------------
// The live interview layer works in terms of a free-text "decision" string
// (follow_up|new_competency|challenge_claim|clarify|next_section — see
// App.jsx's evaluations.decision / legacyDecisionFromTurnType). These two
// maps are the ONLY place that legacy decision string is interpreted; both
// funnel an unrecognized or missing decision to the safe "resume normal
// scheduling" default, same
// defensive shape as every fallback elsewhere in this codebase.
const DECISION_OBSERVED_SIGNAL = {
  follow_up: "strong_signal",
  challenge_claim: "unsupported_claim",
  clarify: "vague_or_incomplete",
  new_competency: "sufficient",
  next_section: "sufficient",
};

const DECISION_TURN_TYPE = {
  follow_up: "follow_up",
  challenge_claim: "challenge_claim",
  clarify: "clarify",
  new_competency: "normal",
  next_section: "normal",
};

/**
 * normalizeEvaluationResult(evaluationResult)
 *
 * evaluationResult: the { evaluation, decision, next_question,
 * interview_should_end } shape the live interview layer works in.
 * next_question is deliberately never read here: 2C's entire point is that
 * the scheduler, not the AI's own next_question guess, decides what comes
 * next.
 *
 * Returns { evaluation, observedSignal, shouldEnd }. The evaluation rubric
 * itself ({relevance, specificity, structure, evidence, clarity,
 * competency_demonstration, strengths, issues}) is passed through
 * unchanged — this function only derives the scheduler-facing
 * observedSignal from "decision", it never reshapes the rubric.
 */
export function normalizeEvaluationResult(evaluationResult) {
  const r = evaluationResult || {};
  const evaluation = r.evaluation && typeof r.evaluation === "object" ? { ...r.evaluation } : {};
  return {
    evaluation,
    observedSignal: DECISION_OBSERVED_SIGNAL[r.decision] || "sufficient",
    shouldEnd: !!r.interview_should_end,
  };
}

/**
 * adaptTranscriptEntry(entry)
 *
 * entry: one live transcript entry — { question: { text, category,
 * competency, anchor_source?, turn_type? }, answer, evaluation, decision? }.
 * `decision` is optional/forward-looking: today's live transcript entries
 * don't persist it (interview_turn discards it once next_question is
 * built), so a legacy entry with neither question.turn_type nor a
 * decision defensively resolves to "normal" — exactly the safe default
 * 2C.1's countTrailingProbeDepth already assumes for turns it can't
 * identify as probing.
 *
 * Returns a scheduler TurnRecord: { category, competency, turn_type,
 * anchor_source, text, previous_answer }. category and turn_type are kept
 * as two independent fields, never merged — same "no compound string"
 * rule 2A.3 already applies to category/competency/anchor_source.
 */
export function adaptTranscriptEntry(entry) {
  const e = entry || {};
  const q = e.question || {};
  const turnType = TURN_TYPES.includes(q.turn_type) ? q.turn_type : (DECISION_TURN_TYPE[e.decision] || "normal");
  return {
    category: mapLegacyCategory(q.category),
    competency: typeof q.competency === "string" ? q.competency : "",
    turn_type: turnType,
    anchor_source: normalizeAnchorSource(q.anchor_source),
    text: typeof q.text === "string" ? q.text : "",
    previous_answer: typeof e.answer === "string" ? e.answer : "",
  };
}

/** adaptTranscript(transcript): maps a live interview.transcript array through adaptTranscriptEntry. */
export function adaptTranscript(transcript) {
  return (Array.isArray(transcript) ? transcript : []).map(adaptTranscriptEntry);
}

/**
 * adaptPotentialProbeAreas(potentialProbeAreas)
 *
 * potentialProbeAreas: candidate_profile.potential_probe_areas —
 * [{ claim, why }], the CV-derived claims worth challenging (same shape
 * validateProfile already produces). Defensively drops any entry without
 * a real claim, same filter validateProfile itself already applies.
 *
 * Returns the scheduler-facing probe representation used to decide
 * whether a challenge_claim turn is CV-evidenced (see
 * runSimulatedAdaptiveTurn) — currently the same { claim, why } shape,
 * kept as its own adapter step (rather than a raw pass-through) so a
 * future richer probe representation doesn't require touching call sites.
 */
export function adaptPotentialProbeAreas(potentialProbeAreas) {
  return (Array.isArray(potentialProbeAreas) ? potentialProbeAreas : [])
    .map((a) => ({ claim: typeof a?.claim === "string" ? a.claim : "", why: typeof a?.why === "string" ? a.why : "" }))
    .filter((a) => a.claim);
}

const VALID_ADAPTIVE_LEVELS = ["none", "moderate", "high"];

/**
 * adaptInterviewConfig(config)
 *
 * config: the live resolveInterviewConfig() output — adaptive_level,
 * followups_enabled, challenge_enabled, stage, format, plus legacy
 * *_weight/question_count fields this adapter deliberately does not
 * read (methodology_distribution already supersedes them — see 2A/2B).
 *
 * Returns { stage, format, adaptiveLevel, followupsEnabled,
 * challengeEnabled }. A legacy or incomplete config (missing
 * adaptive_level/followups_enabled/challenge_enabled entirely) defaults
 * to "moderate"/true/true — the same defaults every format that actually
 * drives a live, turn-by-turn interview already carries today
 * (live_conversational, technical); only the other, one-way delivery
 * format sets these false, and that format is structurally unreachable
 * by this live engine (see submitAnswer's own routing guard in App.jsx).
 */
export function adaptInterviewConfig(config) {
  const c = config || {};
  return {
    stage: typeof c.stage === "string" ? c.stage : "",
    format: typeof c.format === "string" ? c.format : "",
    adaptiveLevel: VALID_ADAPTIVE_LEVELS.includes(c.adaptive_level) ? c.adaptive_level : "moderate",
    followupsEnabled: c.followups_enabled !== false,
    challengeEnabled: c.challenge_enabled !== false,
  };
}

/**
 * buildSchedulerState({ interview, profile, methodologyDistribution })
 *
 * Assembles the full scheduler-facing snapshot of a live interview:
 * { distribution, transcript, questionCount, config, probeAreas }.
 *
 * questionCount is interview.maxQuestions (Short/Standard/Long = 8/12/18,
 * set once at interview-start time — see App.jsx) — deliberately NOT
 * interview.config.question_count, which is a per-format default
 * maxQuestions already supersedes and which would silently reintroduce a
 * second, conflicting target count if read here instead.
 */
export function buildSchedulerState({ interview, profile, methodologyDistribution } = {}) {
  const iv = interview || {};
  return {
    distribution: methodologyDistribution && typeof methodologyDistribution === "object" ? methodologyDistribution : {},
    transcript: adaptTranscript(iv.transcript),
    questionCount: Number(iv.maxQuestions) || 0,
    config: adaptInterviewConfig(iv.config),
    probeAreas: adaptPotentialProbeAreas(profile?.candidate_profile?.potential_probe_areas),
  };
}

// A challenged claim is CV-evidenced when the candidate's own answer
// actually contains (or is contained by) one of the CV's flagged
// potential_probe_areas claims — i.e. the thing being challenged has a
// real, findable basis in what the candidate said, not just a generic
// "are you sure?" probe. Deterministic string matching only — no AI call.
// MIN_EVIDENCE_MATCH_LENGTH guards against a trivial short string (e.g. an
// answer of just "yes") producing a false-positive substring match against
// an unrelated claim — both sides of a match must be a real, substantive
// string, not an accident of length.
const MIN_EVIDENCE_MATCH_LENGTH = 6;

function isClaimEvidencedByCv(transcriptEntry, probeAreas) {
  const answer = (transcriptEntry?.previous_answer || "").toLowerCase().trim();
  if (!answer || !Array.isArray(probeAreas) || !probeAreas.length) return false;
  return probeAreas.some((p) => {
    const claim = (p.claim || "").toLowerCase().trim();
    if (claim.length < MIN_EVIDENCE_MATCH_LENGTH) return false;
    return answer.includes(claim) || (answer.length >= MIN_EVIDENCE_MATCH_LENGTH && claim.includes(answer));
  });
}

/**
 * buildQuestionGenInput(schedulerState, rawDecision)
 *
 * schedulerState: buildSchedulerState()'s output.
 * rawDecision: resolveTurnDirective()'s raw output — { turnType, category,
 * anchorSource } — computed by the caller (runSimulatedAdaptiveTurn) from
 * scheduleNextCategory + resolveTurnDirective, exactly as 2C.1 defines them.
 *
 * Derives the one thing resolveTurnDirective itself never decides:
 * competency. A probing turn (follow_up/challenge_claim/clarify) inherits
 * the EXACT competency of the question it is probing (the most recently
 * answered transcript entry) — the specific thread being followed up on,
 * not just any past question sharing the category. A "normal" turn's
 * competency stays undetermined here: 2C.1 never picks one for "normal",
 * so content-generation supplies it (see stampQuestionFromDecision).
 *
 * Returns { genInput, decision }:
 *   - genInput is the (future) question-generation call's input payload.
 *   - decision is { category, turnType, anchorSource, competency } — the
 *     four scheduler-owned fields stampQuestionFromDecision enforces.
 */
export function buildQuestionGenInput(schedulerState, rawDecision) {
  const state = schedulerState || {};
  const raw = rawDecision || {};
  const transcript = Array.isArray(state.transcript) ? state.transcript : [];
  const lastEntry = transcript.length ? transcript[transcript.length - 1] : null;
  const isProbing = raw.turnType !== "normal";
  const competency = isProbing && lastEntry && lastEntry.competency ? lastEntry.competency : undefined;

  const decision = { category: raw.category, turnType: raw.turnType, anchorSource: raw.anchorSource, competency };

  const genInput = {
    category: decision.category,
    turnType: decision.turnType,
    anchorSource: decision.anchorSource,
    competency: decision.competency,
    stage: state.config?.stage,
    format: state.config?.format,
    questionNumber: transcript.length + 1,
    previousQuestionText: isProbing ? (lastEntry?.text || "") : undefined,
    previousAnswer: isProbing ? (lastEntry?.previous_answer || "") : undefined,
    probeAreas: isProbing && decision.anchorSource === "cv" ? state.probeAreas : undefined,
  };

  return { genInput, decision };
}

/**
 * stampQuestionFromDecision(generatedQuestion, decision)
 *
 * generatedQuestion: whatever the (future/mock) question-generation model
 * returned — untrusted with respect to category/anchor_source/turn type.
 * decision: buildQuestionGenInput's `decision` output.
 *
 * Structural enforcement (2C.2 §7): category and turn_type (the model's
 * "mode") ALWAYS come from `decision` — resolveTurnDirective always
 * determines both, for every turn, so the model's own guesses at these
 * two fields are unconditionally discarded.
 *
 * competency and anchor_source are overridden ONLY when the scheduler
 * actually determined one (decision.competency / decision.anchorSource
 * non-null) — which, by 2C.1's own contract, is every probing turn and
 * never a "normal" turn. For a normal turn, anchor_source/competency are
 * legitimately content-generation's call (JD/CV/company/generic anchor,
 * a specific competency name) exactly as they already are pre-2C; this
 * function only normalizes (never invents) the model's own anchor_source
 * choice in that case.
 */
export function stampQuestionFromDecision(generatedQuestion, decision) {
  const g = generatedQuestion || {};
  const d = decision || {};
  const stamped = {
    ...g,
    text: typeof g.text === "string" ? g.text : "",
    category: d.category,
    turn_type: d.turnType,
  };
  if (d.competency != null && d.competency !== "") stamped.competency = d.competency;
  else stamped.competency = typeof g.competency === "string" ? g.competency : "";
  stamped.anchor_source = d.anchorSource != null ? d.anchorSource : normalizeAnchorSource(g.anchor_source);
  return stamped;
}

/**
 * runSimulatedAdaptiveTurn({ interview, profile, methodologyDistribution,
 *   answerText, evaluationResult, generateQuestion })
 *
 * Demonstrates the complete deterministic chain end to end, in memory,
 * with an injected/mock question generator (a plain function
 * genInput -> generatedQuestion — never an AI call):
 *
 *   evaluation result -> scheduler -> question-gen input -> generated
 *   question -> scheduler decision stamped onto the final question.
 *
 * interview / profile / methodologyDistribution: the live shapes
 * buildSchedulerState already consumes.
 * answerText: the candidate's just-submitted answer (submitAnswer's own
 * `cleanAnswer` — not part of evaluationResult, which only carries the
 * AI's judgement of it).
 * evaluationResult: the { evaluation, decision, ... } shape (see
 * normalizeEvaluationResult above) for the question just answered
 * (interview.currentQuestion).
 * generateQuestion: (genInput) => generatedQuestion — the injected mock.
 *
 * Returns { evaluation, shouldEnd, probeDepth, decision, genInput, question }.
 */
export function runSimulatedAdaptiveTurn({ interview, profile, methodologyDistribution, answerText, evaluationResult, generateQuestion } = {}) {
  const normalized = normalizeEvaluationResult(evaluationResult);
  const schedulerState = buildSchedulerState({ interview, profile, methodologyDistribution });

  // Fold the just-answered turn into the transcript BEFORE scheduling the
  // next one — mirrors submitAnswer's real order (newTranscript =
  // [...interview.transcript, newEntry]) exactly, so deficit/probe-depth
  // accounting reflects the turn that was just answered.
  const justAnsweredEntry = adaptTranscriptEntry({
    question: interview?.currentQuestion,
    answer: answerText,
    decision: evaluationResult?.decision,
  });
  const transcript = [...schedulerState.transcript, justAnsweredEntry];
  const state = { ...schedulerState, transcript };

  const probeDepth = countTrailingProbeDepth(transcript);

  // Circuit-break: a probing thread MAX_PROBE_DEPTH turns deep must return
  // to a normal, scheduler-owned-category turn regardless of what the
  // answer analysis observed (2C.1 exposes MAX_PROBE_DEPTH/
  // countTrailingProbeDepth for exactly this composition).
  let observedSignal = normalized.observedSignal;
  if (probeDepth >= MAX_PROBE_DEPTH) observedSignal = "sufficient";

  // Config gates: a probing turn type this interview's own configuration
  // has switched off is never proposed — the first real use of
  // followups_enabled/challenge_enabled, which Phase 4A declared inert.
  if (observedSignal === "strong_signal" && !state.config.followupsEnabled) observedSignal = "sufficient";
  if (observedSignal === "unsupported_claim" && !state.config.challengeEnabled) observedSignal = "sufficient";

  const normalCandidate = scheduleNextCategory({
    distribution: state.distribution, transcript: state.transcript, questionCount: state.questionCount,
  });
  const priorCategory = state.transcript.length ? state.transcript[state.transcript.length - 1].category : null;
  const challengedClaimEvidenced = observedSignal === "unsupported_claim"
    ? isClaimEvidencedByCv(justAnsweredEntry, state.probeAreas)
    : false;

  const rawDecision = resolveTurnDirective({ observedSignal, priorCategory, normalCandidate, challengedClaimEvidenced });
  const { genInput, decision } = buildQuestionGenInput(state, rawDecision);

  const generated = generateQuestion(genInput) || {};
  const question = stampQuestionFromDecision(generated, decision);

  return { evaluation: normalized.evaluation, shouldEnd: normalized.shouldEnd, probeDepth, decision, genInput, question };
}
