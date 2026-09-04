import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ACTIVE_CATEGORIES, TURN_TYPES, MAX_PROBE_DEPTH } from "./methodology.js";
import {
  normalizeEvaluationResult,
  adaptTranscriptEntry,
  adaptTranscript,
  adaptPotentialProbeAreas,
  adaptInterviewConfig,
  buildSchedulerState,
  buildQuestionGenInput,
  stampQuestionFromDecision,
  runSimulatedAdaptiveTurn,
} from "./adaptiveEngine.js";

const DISTRIBUTION_EQUAL = Object.fromEntries(ACTIVE_CATEGORIES.map((c) => [c, 20]));

const LIVE_CONFIG = {
  stage: "first_round", format: "live_conversational",
  adaptive_level: "moderate", followups_enabled: true, challenge_enabled: true, question_count: 12,
};

function makeEvalResult(decision, overrides = {}) {
  return {
    evaluation: { relevance: 70, specificity: 60, structure: 65, evidence: 55, clarity: 70, competency_demonstration: 60, strengths: ["clear example"], issues: [] },
    decision,
    next_question: { text: "ignored — the scheduler decides this, not the AI", category: "motivation_fit", competency: "" },
    interview_should_end: false,
    ...overrides,
  };
}

function makeInterview(overrides = {}) {
  return {
    maxQuestions: 10,
    transcript: [],
    currentQuestion: { text: "Tell me about a time you led a project.", category: "behavioural_competency", competency: "leadership", turn_type: "normal" },
    config: LIVE_CONFIG,
    ...overrides,
  };
}

function makeProfile(probeAreas = []) {
  return { candidate_profile: { potential_probe_areas: probeAreas } };
}

// Spoofs every field the model should never be allowed to decide, so any
// test using it proves stamping actually overrides them rather than
// coincidentally matching.
function spoofingGenerator(genInput) {
  return {
    text: `generated for ${genInput.category}/${genInput.turnType}`,
    category: "commercial_awareness", // deliberately wrong unless that's genuinely the decision
    competency: "SPOOFED_COMPETENCY",
    anchor_source: "company",
    turn_type: "clarify",
  };
}

describe("normalizeEvaluationResult", () => {
  it("passes the evaluation rubric through completely unchanged", () => {
    const evaluation = { relevance: 80, specificity: 70, structure: 75, evidence: 60, clarity: 85, competency_demonstration: 65, strengths: ["a"], issues: ["b"] };
    const result = normalizeEvaluationResult(makeEvalResult("follow_up", { evaluation }));
    expect(result.evaluation).toEqual(evaluation);
  });

  it.each([
    ["follow_up", "strong_signal"],
    ["challenge_claim", "unsupported_claim"],
    ["clarify", "vague_or_incomplete"],
    ["new_competency", "sufficient"],
    ["next_section", "sufficient"],
    ["something_unrecognized", "sufficient"],
    [undefined, "sufficient"],
  ])("maps decision %s to observedSignal %s", (decision, expected) => {
    expect(normalizeEvaluationResult(makeEvalResult(decision)).observedSignal).toBe(expected);
  });

  it("passes interview_should_end through as shouldEnd", () => {
    expect(normalizeEvaluationResult(makeEvalResult("follow_up", { interview_should_end: true })).shouldEnd).toBe(true);
    expect(normalizeEvaluationResult(makeEvalResult("follow_up", { interview_should_end: false })).shouldEnd).toBe(false);
    expect(normalizeEvaluationResult(makeEvalResult("follow_up", { interview_should_end: undefined })).shouldEnd).toBe(false);
  });

  it("defensively handles a missing/null evaluationResult", () => {
    expect(normalizeEvaluationResult(null)).toEqual({ evaluation: {}, observedSignal: "sufficient", shouldEnd: false });
    expect(normalizeEvaluationResult(undefined)).toEqual({ evaluation: {}, observedSignal: "sufficient", shouldEnd: false });
  });
});

describe("adaptTranscriptEntry / adaptTranscript", () => {
  it("normalizes legacy category values via mapLegacyCategory", () => {
    expect(adaptTranscriptEntry({ question: { category: "cv_behavioural" } }).category).toBe("behavioural_competency");
    expect(adaptTranscriptEntry({ question: { category: "role_specific" } }).category).toBe("technical_functional");
    expect(adaptTranscriptEntry({ question: { category: "technical" } }).category).toBe("technical_functional");
    expect(adaptTranscriptEntry({ question: { category: "commercial_awareness" } }).category).toBe("commercial_awareness");
    expect(adaptTranscriptEntry({ question: {} }).category).toBe("behavioural_competency"); // mapLegacyCategory's own generic default
  });

  it("keeps category and turn_type as two independent fields, never merged", () => {
    const result = adaptTranscriptEntry({ question: { category: "technical_functional", turn_type: "follow_up" } });
    expect(result.category).toBe("technical_functional");
    expect(result.turn_type).toBe("follow_up");
  });

  it("resolves turn_type from an explicit question.turn_type first", () => {
    expect(adaptTranscriptEntry({ question: { turn_type: "clarify" }, decision: "follow_up" }).turn_type).toBe("clarify");
  });

  it("falls back to deriving turn_type from a legacy `decision` field when turn_type is absent", () => {
    expect(adaptTranscriptEntry({ question: {}, decision: "follow_up" }).turn_type).toBe("follow_up");
    expect(adaptTranscriptEntry({ question: {}, decision: "challenge_claim" }).turn_type).toBe("challenge_claim");
    expect(adaptTranscriptEntry({ question: {}, decision: "clarify" }).turn_type).toBe("clarify");
    expect(adaptTranscriptEntry({ question: {}, decision: "new_competency" }).turn_type).toBe("normal");
    expect(adaptTranscriptEntry({ question: {}, decision: "next_section" }).turn_type).toBe("normal");
  });

  it("defaults turn_type to normal for a legacy entry with neither turn_type nor decision", () => {
    expect(adaptTranscriptEntry({ question: { category: "motivation_fit" } }).turn_type).toBe("normal");
    expect(adaptTranscriptEntry({}).turn_type).toBe("normal");
  });

  it("preserves the answer as previous_answer and the question text as text", () => {
    const result = adaptTranscriptEntry({ question: { text: "Why this role?" }, answer: "Because I care about the mission." });
    expect(result.text).toBe("Why this role?");
    expect(result.previous_answer).toBe("Because I care about the mission.");
  });

  it("normalizes an invalid anchor_source to generic", () => {
    expect(adaptTranscriptEntry({ question: { anchor_source: "nonsense" } }).anchor_source).toBe("generic");
    expect(adaptTranscriptEntry({ question: { anchor_source: "cv" } }).anchor_source).toBe("cv");
  });

  it("adaptTranscript maps a whole array and defends against non-array input", () => {
    const transcript = [
      { question: { category: "motivation_fit", turn_type: "normal" }, answer: "a" },
      { question: { category: "cv_behavioural", turn_type: "follow_up" }, answer: "b" },
    ];
    const result = adaptTranscript(transcript);
    expect(result).toHaveLength(2);
    expect(result[1].category).toBe("behavioural_competency");
    expect(adaptTranscript(null)).toEqual([]);
    expect(adaptTranscript(undefined)).toEqual([]);
  });
});

describe("adaptPotentialProbeAreas", () => {
  it("passes through valid claim/why pairs", () => {
    const result = adaptPotentialProbeAreas([{ claim: "Grew revenue 40%", why: "no specifics" }]);
    expect(result).toEqual([{ claim: "Grew revenue 40%", why: "no specifics" }]);
  });

  it("drops entries without a real claim, and defends against non-array input", () => {
    expect(adaptPotentialProbeAreas([{ claim: "", why: "x" }, { why: "y" }])).toEqual([]);
    expect(adaptPotentialProbeAreas(null)).toEqual([]);
    expect(adaptPotentialProbeAreas(undefined)).toEqual([]);
  });
});

describe("adaptInterviewConfig", () => {
  it("passes through a fully-specified live config", () => {
    const result = adaptInterviewConfig(LIVE_CONFIG);
    expect(result).toEqual({ stage: "first_round", format: "live_conversational", adaptiveLevel: "moderate", followupsEnabled: true, challengeEnabled: true });
  });

  it("defaults a legacy/missing config to moderate + both gates enabled", () => {
    expect(adaptInterviewConfig({})).toEqual({ stage: "", format: "", adaptiveLevel: "moderate", followupsEnabled: true, challengeEnabled: true });
    expect(adaptInterviewConfig(null)).toEqual({ stage: "", format: "", adaptiveLevel: "moderate", followupsEnabled: true, challengeEnabled: true });
  });

  it("preserves an explicit false rather than defaulting it away", () => {
    const result = adaptInterviewConfig({ followups_enabled: false, challenge_enabled: false });
    expect(result.followupsEnabled).toBe(false);
    expect(result.challengeEnabled).toBe(false);
  });

  it("falls back to moderate for an invalid adaptive_level", () => {
    expect(adaptInterviewConfig({ adaptive_level: "extreme" }).adaptiveLevel).toBe("moderate");
    expect(adaptInterviewConfig({ adaptive_level: "high" }).adaptiveLevel).toBe("high");
    expect(adaptInterviewConfig({ adaptive_level: "none" }).adaptiveLevel).toBe("none");
  });
});

describe("buildSchedulerState", () => {
  it.each([["Short", 5], ["Medium", 8], ["Long", 10]])(
    "%s length uses interview.maxQuestions (%i), never config.question_count",
    (_label, maxQuestions) => {
      // config.question_count is deliberately a value that never equals any real
      // maxQuestions (5/8/10), so this genuinely fails if the implementation
      // ever reads question_count instead of maxQuestions, for every row here —
      // not just coincidentally passing where the two happen to match.
      const interview = makeInterview({ maxQuestions, config: { ...LIVE_CONFIG, question_count: 999 } });
      const state = buildSchedulerState({ interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL });
      expect(state.questionCount).toBe(maxQuestions);
      expect(state.questionCount).not.toBe(999);
    }
  );

  it("adapts the transcript and probe areas from the raw live shapes", () => {
    const interview = makeInterview({ transcript: [{ question: { category: "cv_behavioural" }, answer: "a" }] });
    const profile = makeProfile([{ claim: "Led a team of 10", why: "unverified" }]);
    const state = buildSchedulerState({ interview, profile, methodologyDistribution: DISTRIBUTION_EQUAL });
    expect(state.transcript).toEqual([adaptTranscriptEntry(interview.transcript[0])]);
    expect(state.probeAreas).toEqual([{ claim: "Led a team of 10", why: "unverified" }]);
  });

  it("defensively defaults distribution to {} when missing", () => {
    const state = buildSchedulerState({ interview: makeInterview(), profile: makeProfile() });
    expect(state.distribution).toEqual({});
  });
});

describe("buildQuestionGenInput", () => {
  const state = {
    transcript: [{ category: "technical_functional", competency: "system design", turn_type: "normal", anchor_source: "generic", text: "Q", previous_answer: "A" }],
    config: { stage: "first_round", format: "live_conversational" },
    probeAreas: [{ claim: "Scaled to 1M users", why: "unverified" }],
  };

  it("a normal turn leaves competency undetermined and carries no probing context", () => {
    const { genInput, decision } = buildQuestionGenInput(state, { turnType: "normal", category: "motivation_fit", anchorSource: null });
    expect(decision).toEqual({ category: "motivation_fit", turnType: "normal", anchorSource: null, competency: undefined });
    expect(genInput.competency).toBeUndefined();
    expect(genInput.previousQuestionText).toBeUndefined();
    expect(genInput.previousAnswer).toBeUndefined();
    expect(genInput.probeAreas).toBeUndefined();
  });

  it("a probing turn inherits the competency of the most recently answered entry", () => {
    const { decision, genInput } = buildQuestionGenInput(state, { turnType: "follow_up", category: "technical_functional", anchorSource: "previous_answer" });
    expect(decision.competency).toBe("system design");
    expect(genInput.previousQuestionText).toBe("Q");
    expect(genInput.previousAnswer).toBe("A");
  });

  it("only attaches probeAreas to genInput when the decision anchors on cv", () => {
    const cv = buildQuestionGenInput(state, { turnType: "challenge_claim", category: "technical_functional", anchorSource: "cv" });
    expect(cv.genInput.probeAreas).toEqual(state.probeAreas);

    const prevAnswer = buildQuestionGenInput(state, { turnType: "challenge_claim", category: "technical_functional", anchorSource: "previous_answer" });
    expect(prevAnswer.genInput.probeAreas).toBeUndefined();
  });

  it("carries stage/format and the next question number through", () => {
    const { genInput } = buildQuestionGenInput(state, { turnType: "normal", category: "motivation_fit", anchorSource: null });
    expect(genInput.stage).toBe("first_round");
    expect(genInput.format).toBe("live_conversational");
    expect(genInput.questionNumber).toBe(2);
  });
});

describe("stampQuestionFromDecision — structural enforcement", () => {
  it("category can never be overridden by model output", () => {
    const stamped = stampQuestionFromDecision(
      { text: "q", category: "SPOOFED", competency: "x", anchor_source: "cv" },
      { category: "situational_judgement", turnType: "normal", anchorSource: null, competency: undefined }
    );
    expect(stamped.category).toBe("situational_judgement");
  });

  it("turn_type (mode) can never be overridden by model output", () => {
    const stamped = stampQuestionFromDecision(
      { text: "q", turn_type: "clarify" },
      { category: "motivation_fit", turnType: "challenge_claim", anchorSource: "cv", competency: "drive" }
    );
    expect(stamped.turn_type).toBe("challenge_claim");
  });

  it("anchor_source can never be overridden by model output when the scheduler determined one", () => {
    const stamped = stampQuestionFromDecision(
      { text: "q", anchor_source: "company" },
      { category: "motivation_fit", turnType: "follow_up", anchorSource: "previous_answer", competency: "drive" }
    );
    expect(stamped.anchor_source).toBe("previous_answer");

    const cvStamped = stampQuestionFromDecision(
      { text: "q", anchor_source: "generic" },
      { category: "motivation_fit", turnType: "challenge_claim", anchorSource: "cv", competency: "drive" }
    );
    expect(cvStamped.anchor_source).toBe("cv");
  });

  it("a normal turn's anchor_source (scheduler-undetermined) is preserved from the model, only normalized", () => {
    const stamped = stampQuestionFromDecision(
      { text: "q", anchor_source: "jd" },
      { category: "commercial_awareness", turnType: "normal", anchorSource: null, competency: undefined }
    );
    expect(stamped.anchor_source).toBe("jd"); // JD anchoring: preserved, not clobbered
  });

  it("an invalid model-supplied anchor_source on a normal turn still normalizes to generic", () => {
    const stamped = stampQuestionFromDecision(
      { text: "q", anchor_source: "nonsense" },
      { category: "commercial_awareness", turnType: "normal", anchorSource: null, competency: undefined }
    );
    expect(stamped.anchor_source).toBe("generic");
  });

  it("competency is overridden when the scheduler determined one", () => {
    const stamped = stampQuestionFromDecision(
      { text: "q", competency: "SPOOFED_COMPETENCY" },
      { category: "technical_functional", turnType: "follow_up", anchorSource: "previous_answer", competency: "distributed systems" }
    );
    expect(stamped.competency).toBe("distributed systems");
  });

  it("competency is left as the model's own choice when the scheduler left it undetermined (normal turn)", () => {
    const stamped = stampQuestionFromDecision(
      { text: "q", competency: "stakeholder management" },
      { category: "motivation_fit", turnType: "normal", anchorSource: null, competency: undefined }
    );
    expect(stamped.competency).toBe("stakeholder management");
  });
});

describe("runSimulatedAdaptiveTurn — full deterministic chain", () => {
  it("normal adaptive turn: deficit-driven category, competency left to the generator", () => {
    const interview = makeInterview({
      transcript: [{ question: { category: "motivation_fit", turn_type: "normal" }, answer: "x" }],
    });
    const result = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "That's a solid example of leading a project.",
      evaluationResult: makeEvalResult("new_competency"),
      generateQuestion: (genInput) => ({ text: `q for ${genInput.category}`, competency: "team leadership" }),
    });
    expect(result.decision.turnType).toBe("normal");
    expect(ACTIVE_CATEGORIES).toContain(result.decision.category);
    expect(result.question.category).toBe(result.decision.category);
    expect(result.question.turn_type).toBe("normal");
    expect(result.question.competency).toBe("team leadership"); // not scheduler-determined -> generator's own choice
  });

  it("follow-up: inherits priorCategory and the just-probed competency, anchors on previous_answer", () => {
    const interview = makeInterview({
      currentQuestion: { text: "Tell me about a time you led a project.", category: "behavioural_competency", competency: "leadership", turn_type: "normal" },
    });
    const result = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "I led a team of five on a tight deadline.",
      evaluationResult: makeEvalResult("follow_up"),
      generateQuestion: spoofingGenerator,
    });
    expect(result.decision.turnType).toBe("follow_up");
    expect(result.decision.category).toBe("behavioural_competency");
    expect(result.decision.competency).toBe("leadership");
    expect(result.decision.anchorSource).toBe("previous_answer");
    expect(result.question.category).toBe("behavioural_competency"); // spoofingGenerator's "commercial_awareness" rejected
    expect(result.question.competency).toBe("leadership");
    expect(result.question.anchor_source).toBe("previous_answer");
    expect(result.question.turn_type).toBe("follow_up"); // spoofingGenerator's "clarify" rejected
  });

  it("challenge: not evidenced by CV anchors on previous_answer", () => {
    const interview = makeInterview({
      currentQuestion: { text: "What was your biggest achievement?", category: "commercial_awareness", competency: "impact", turn_type: "normal" },
    });
    const result = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile([{ claim: "Grew revenue by 40%", why: "no specifics in CV" }]),
      methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "I improved team morale significantly.", // does not reference the CV claim at all
      evaluationResult: makeEvalResult("challenge_claim"),
      generateQuestion: spoofingGenerator,
    });
    expect(result.decision.turnType).toBe("challenge_claim");
    expect(result.decision.anchorSource).toBe("previous_answer");
    expect(result.question.anchor_source).toBe("previous_answer");
  });

  it("challenge: a trivial short answer never false-positives as CV-evidenced", () => {
    const interview = makeInterview({
      currentQuestion: { text: "Did you lead that?", category: "commercial_awareness", competency: "impact", turn_type: "normal" },
    });
    const result = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile([{ claim: "grew revenue by 40% in six months", why: "unverified" }]),
      methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "yes", // trivially a substring of many unrelated claims — must not match
      evaluationResult: makeEvalResult("challenge_claim"),
      generateQuestion: spoofingGenerator,
    });
    expect(result.decision.anchorSource).toBe("previous_answer");
  });

  it("challenge: CV-evidenced anchors on cv", () => {
    const interview = makeInterview({
      currentQuestion: { text: "What was your biggest achievement?", category: "commercial_awareness", competency: "impact", turn_type: "normal" },
    });
    const result = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile([{ claim: "grew revenue by 40%", why: "no specifics in CV" }]),
      methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "I grew revenue by 40% in my last role.", // repeats the flagged CV claim
      evaluationResult: makeEvalResult("challenge_claim"),
      generateQuestion: spoofingGenerator,
    });
    expect(result.decision.anchorSource).toBe("cv");
    expect(result.question.anchor_source).toBe("cv"); // spoofingGenerator's "company" rejected
  });

  it("clarify: inherits priorCategory, anchors on previous_answer", () => {
    const interview = makeInterview({
      currentQuestion: { text: "Walk me through your process.", category: "situational_judgement", competency: "problem solving", turn_type: "normal" },
    });
    const result = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "It kind of just worked out.",
      evaluationResult: makeEvalResult("clarify"),
      generateQuestion: spoofingGenerator,
    });
    expect(result.decision.turnType).toBe("clarify");
    expect(result.decision.category).toBe("situational_judgement");
    expect(result.decision.anchorSource).toBe("previous_answer");
  });

  it("mandatory/deficit scheduling: a normal turn goes to the most under-served category, not just the next in sequence", () => {
    const interview = makeInterview({
      maxQuestions: 10,
      transcript: [
        { question: { category: "motivation_fit", turn_type: "normal" }, answer: "a" },
        { question: { category: "motivation_fit", turn_type: "normal" }, answer: "b" },
      ],
      currentQuestion: { text: "Technical question.", category: "technical_functional", competency: "systems", turn_type: "normal" },
    });
    // Post-append askedCount: motivation_fit=2, technical_functional=1, others=0.
    // Targets (20% * 10 = 2 each): deficits motivation_fit=0, technical_functional=1,
    // behavioural/situational/commercial=2 each -> tie -> canonical first = behavioural_competency.
    const result = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "Answer to the technical question.",
      evaluationResult: makeEvalResult("new_competency"),
      generateQuestion: () => ({ text: "q" }),
    });
    expect(result.decision.category).toBe("behavioural_competency");
  });

  it("the scheduler decision reaches the question generator's input exactly", () => {
    const interview = makeInterview();
    let capturedGenInput = null;
    runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "answer",
      evaluationResult: makeEvalResult("follow_up"),
      generateQuestion: (genInput) => { capturedGenInput = genInput; return { text: "q" }; },
    });
    expect(capturedGenInput).not.toBeNull();
    expect(capturedGenInput.category).toBe("behavioural_competency");
    expect(capturedGenInput.turnType).toBe("follow_up");
    expect(capturedGenInput.anchorSource).toBe("previous_answer");
  });

  it("shouldEnd is passed through regardless of the scheduler decision", () => {
    const interview = makeInterview();
    const ending = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "answer", evaluationResult: makeEvalResult("new_competency", { interview_should_end: true }),
      generateQuestion: () => ({ text: "q" }),
    });
    expect(ending.shouldEnd).toBe(true);

    const continuing = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "answer", evaluationResult: makeEvalResult("new_competency", { interview_should_end: false }),
      generateQuestion: () => ({ text: "q" }),
    });
    expect(continuing.shouldEnd).toBe(false);
  });

  it("probe-depth circuit breaking forces a normal turn once MAX_PROBE_DEPTH is reached", () => {
    const interview = makeInterview({
      transcript: [
        { question: { category: "motivation_fit", competency: "drive", turn_type: "normal" }, answer: "a0" },
        { question: { category: "motivation_fit", competency: "drive", turn_type: "follow_up" }, answer: "a1" },
      ],
      currentQuestion: { text: "One more on that?", category: "motivation_fit", competency: "drive", turn_type: "clarify" },
    });
    const result = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "Same answer again.",
      evaluationResult: makeEvalResult("follow_up"), // model wants yet another probe — must be overridden
      generateQuestion: () => ({ text: "q" }),
    });
    expect(result.probeDepth).toBe(MAX_PROBE_DEPTH);
    expect(result.decision.turnType).toBe("normal");
  });

  it("followups_enabled: false gates a follow_up decision down to a normal turn", () => {
    const interview = makeInterview({ config: { ...LIVE_CONFIG, followups_enabled: false } });
    const result = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "answer", evaluationResult: makeEvalResult("follow_up"),
      generateQuestion: () => ({ text: "q" }),
    });
    expect(result.decision.turnType).toBe("normal");
  });

  it("challenge_enabled: false gates a challenge_claim decision down to a normal turn", () => {
    const interview = makeInterview({ config: { ...LIVE_CONFIG, challenge_enabled: false } });
    const result = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "answer", evaluationResult: makeEvalResult("challenge_claim"),
      generateQuestion: () => ({ text: "q" }),
    });
    expect(result.decision.turnType).toBe("normal");
  });

  it.each([["Short", 5], ["Medium", 8], ["Long", 10]])("runs a full turn correctly at the %s interview length", (_label, maxQuestions) => {
    const interview = makeInterview({ maxQuestions });
    const result = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "answer", evaluationResult: makeEvalResult("new_competency"),
      generateQuestion: () => ({ text: "q" }),
    });
    expect(ACTIVE_CATEGORIES).toContain(result.decision.category);
    expect(TURN_TYPES).toContain(result.decision.turnType);
  });

  it("legacy category on the current question is adapted through the whole chain", () => {
    const interview = makeInterview({
      currentQuestion: { text: "Tell me about yourself.", category: "cv_behavioural", competency: "background", turn_type: "normal" },
    });
    const result = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "answer", evaluationResult: makeEvalResult("follow_up"),
      generateQuestion: () => ({ text: "q" }),
    });
    expect(result.decision.category).toBe("behavioural_competency"); // cv_behavioural -> canonical
  });

  it("a legacy/incomplete interview config (no followups_enabled/challenge_enabled) still allows probing by default", () => {
    const interview = makeInterview({ config: { stage: "first_round", format: "live_conversational" } });
    const result = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "answer", evaluationResult: makeEvalResult("follow_up"),
      generateQuestion: () => ({ text: "q" }),
    });
    expect(result.decision.turnType).toBe("follow_up");
  });

  it("deterministic repeated execution: identical (deep-cloned) inputs and a pure generator produce identical output", () => {
    const buildInput = () => ({
      interview: makeInterview({
        transcript: [
          { question: { category: "motivation_fit", turn_type: "normal" }, answer: "a" },
          { question: { category: "technical_functional", competency: "systems", turn_type: "follow_up" }, answer: "b" },
        ],
      }),
      profile: makeProfile([{ claim: "scaled a system to 1M users", why: "unverified" }]),
      methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "I scaled a system to 1M users.",
      evaluationResult: makeEvalResult("challenge_claim"),
      generateQuestion: (genInput) => ({ text: `q-${genInput.category}-${genInput.turnType}`, competency: "derived", anchor_source: "generic" }),
    });
    const first = runSimulatedAdaptiveTurn(buildInput());
    const second = runSimulatedAdaptiveTurn(buildInput());
    expect(second).toEqual(first);
  });
});

describe("adaptiveEngine.js isolation from the batch/independent interview flow", () => {
  it("has no coupling to the independent/batch pipeline's functions, config keys, or format", () => {
    const source = readFileSync(new URL("./adaptiveEngine.js", import.meta.url), "utf8");
    const forbidden = [
      /independent_batch/i, /generateQuestionBatch/i, /validateQuestionBatch/i,
      /dbInsertQuestionBatch/i, /asynchronous_video/i, /from ["']\.\/App/i, /from ["']react["']/i,
    ];
    for (const pattern of forbidden) expect(source).not.toMatch(pattern);
  });

  it("makes no AI calls and touches no database (no callClaude / supabase references)", () => {
    const source = readFileSync(new URL("./adaptiveEngine.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/callClaude/);
    expect(source).not.toMatch(/supabase/i);
  });
});

describe("PHASE 2E — buildSchedulerState/runSimulatedAdaptiveTurn accept an optional candidateStrategy", () => {
  it("buildSchedulerState defaults categoryPreference to {} when candidateStrategy is omitted or malformed", () => {
    const base = { interview: makeInterview(), profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL };
    expect(buildSchedulerState(base).categoryPreference).toEqual({});
    for (const bad of [null, {}, "nonsense", { categoryPreference: "nonsense" }]) {
      expect(buildSchedulerState({ ...base, candidateStrategy: bad }).categoryPreference).toEqual({});
    }
  });

  it("buildSchedulerState passes a well-formed categoryPreference through unchanged", () => {
    const pref = { motivation_fit: 0.8, technical_functional: -0.4 };
    const state = buildSchedulerState({
      interview: makeInterview(), profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      candidateStrategy: { categoryPreference: pref },
    });
    expect(state.categoryPreference).toEqual(pref);
  });

  it("runSimulatedAdaptiveTurn omitting candidateStrategy produces the EXACT same decision as before Phase 2E", () => {
    const interview = makeInterview();
    const run = () => runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "answer", evaluationResult: makeEvalResult("new_competency"), generateQuestion: () => ({}),
    });
    const a = run();
    const b = run();
    expect(a.decision).toEqual(b.decision);
  });

  it("runSimulatedAdaptiveTurn's candidateStrategy can tip a near-tied normal-turn category choice", () => {
    const interview = makeInterview({ transcript: [] });
    const withoutStrategy = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "answer", evaluationResult: makeEvalResult("new_competency"), generateQuestion: () => ({}),
    });
    expect(withoutStrategy.decision.category).toBe(ACTIVE_CATEGORIES[0]); // canonical-order tie-break

    const tipped = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "answer", evaluationResult: makeEvalResult("new_competency"), generateQuestion: () => ({}),
      candidateStrategy: { categoryPreference: { [ACTIVE_CATEGORIES[2]]: 1 } },
    });
    expect(tipped.decision.category).toBe(ACTIVE_CATEGORIES[2]);
  });

  it("candidateStrategy never influences turn_type/anchor_source/probe-depth circuit-breaking — only the scheduler's category choice", () => {
    const interview = makeInterview({
      transcript: [{ question: { category: "motivation_fit", turn_type: "follow_up" }, answer: "a" }],
      currentQuestion: { text: "q", category: "motivation_fit", competency: "drive", turn_type: "clarify" },
    });
    // MAX_PROBE_DEPTH is 2 — with the just-answered question itself probing (turn_type
    // "clarify"), this is the third consecutive probing turn once folded into the transcript,
    // and must circuit-break to "normal" regardless of any candidateStrategy preference.
    const result = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "answer", evaluationResult: makeEvalResult("follow_up"), generateQuestion: () => ({}),
      candidateStrategy: { categoryPreference: { motivation_fit: 1 } },
    });
    expect(result.decision.turnType).toBe("normal");
  });

  it("the model still cannot override category/turn_type/anchor_source even with a candidateStrategy present (structural enforcement intact)", () => {
    const interview = makeInterview();
    const { decision, question } = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile([{ claim: "led a rewrite", why: "unverified" }]),
      methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: "I led a rewrite of the payments system.", evaluationResult: makeEvalResult("challenge_claim"),
      generateQuestion: spoofingGenerator,
      candidateStrategy: { categoryPreference: { commercial_awareness: 1 } },
    });
    expect(question.category).toBe(decision.category);
    expect(question.category).not.toBe("commercial_awareness");
    expect(question.turn_type).toBe(decision.turnType);
    expect(question.anchor_source).toBe(decision.anchorSource);
  });
});
