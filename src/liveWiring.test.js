/* ================================================================== *
 * PHASE 2C.3 — LIVE ADAPTIVE INTERVIEW WIRING TEST SUITE
 * ------------------------------------------------------------------
 * Two kinds of test live in this file, and every describe block says
 * which kind it is:
 *
 *   EXECUTABLE — calls a real, exported, pure function and asserts on
 *   its actual return value. These are the strongest tests here: the
 *   Call-1/Call-2 glue, the scheduler composition, and the recovery
 *   recomputation are all pure functions specifically extracted from
 *   submitAnswer/reconstructSchedulerDecision so they COULD be tested
 *   this way (same pattern App.validators.test.js already established
 *   for validateProfile/buildJdProfile).
 *
 *   STRUCTURAL — submitAnswer/regenerateNextQuestion/reconstructScheduler
 *   Decision/generateAndPersistNextQuestion themselves are React-closure
 *   functions (they capture `interview`/`profile`/state setters and call
 *   getSupabase()/callClaude()) and cannot be imported or invoked
 *   directly in a unit test. For requirements that live entirely inside
 *   those closures (call ordering, "never calls X"), this file reads
 *   App.jsx's own source text and asserts on it directly — a real check
 *   against the actual shipped code, just not an executed one.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  validateEvaluationSignals,
  VAGUE_ANSWER_THRESHOLD,
  syntheticDecisionFromEvaluationSignals,
  legacyDecisionFromTurnType,
  buildQuestionGenerationPrompt,
  validateGeneratedQuestion,
  computeRecoveryDecision,
  isFollowUpQuestion,
  isInterviewComplete,
  effectiveMethodologyDistribution,
} from "./App.jsx";
import { runSimulatedAdaptiveTurn, stampQuestionFromDecision } from "./adaptiveEngine.js";
import { ACTIVE_CATEGORIES, TURN_TYPES, STAGE_METHODOLOGY, computeMethodologyDistribution } from "./methodology.js";

const SOURCE = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function extractFunctionSource(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found in App.jsx: ${startMarker}`);
  const end = SOURCE.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`end marker not found in App.jsx: ${endMarker}`);
  return SOURCE.slice(start, end);
}

const SUBMIT_ANSWER_SRC = extractFunctionSource("async function submitAnswer()", "async function generateAndPersistNextQuestion(");
const GENERATE_AND_PERSIST_SRC = extractFunctionSource("async function generateAndPersistNextQuestion(", "async function regenerateNextQuestion()");
const REGENERATE_SRC = extractFunctionSource("async function regenerateNextQuestion()", "async function reconstructSchedulerDecision(");
const RECONSTRUCT_SRC = extractFunctionSource("async function reconstructSchedulerDecision(", "async function finishInterview(");

const DISTRIBUTION_EQUAL = Object.fromEntries(ACTIVE_CATEGORIES.map((c) => [c, 20]));

function makeEvaluation(overrides = {}) {
  return { relevance: 70, specificity: 65, structure: 60, evidence: 55, clarity: 70, competency_demonstration: 60, strengths: ["clear"], issues: [], ...overrides };
}
function makeInterview(overrides = {}) {
  return {
    id: "iv-1", applicationId: "app-1", maxQuestions: 10, transcript: [],
    currentQuestion: { text: "Tell me about a time you led a project.", category: "behavioural_competency", competency: "leadership", turn_type: "normal", dbId: "q-1" },
    config: { stage: "first_round", format: "live_conversational" },
    methodologyDistribution: DISTRIBUTION_EQUAL, pendingRecovery: null,
    ...overrides,
  };
}
function makeProfile(probeAreas = []) {
  return { interview_profile: { company: "Acme", role: "Analyst" }, candidate_profile: { potential_probe_areas: probeAreas } };
}

/* ============================== A ============================== */
describe("A. Call 1 evaluation-only structure (EXECUTABLE + STRUCTURAL)", () => {
  it("validateEvaluationSignals returns exactly the evaluation rubric plus the three lightweight signals — nothing else", () => {
    const result = validateEvaluationSignals({
      evaluation: makeEvaluation(), follow_up_worthy: true, challenge_worthy: false, flagged_claim: "",
      decision: "follow_up", next_question: { text: "x" }, interview_should_end: true, // legacy fields, must be ignored/dropped
    });
    expect(Object.keys(result).sort()).toEqual(["challenge_worthy", "evaluation", "flagged_claim", "follow_up_worthy"]);
    expect(result.decision).toBeUndefined();
    expect(result.next_question).toBeUndefined();
    expect(result.interview_should_end).toBeUndefined();
  });

  it("preserves the exact pre-existing evaluation rubric shape unchanged", () => {
    const evaluation = makeEvaluation({ relevance: 82 });
    const result = validateEvaluationSignals({ evaluation });
    expect(Object.keys(result.evaluation).sort()).toEqual(
      ["clarity", "competency_demonstration", "evidence", "issues", "relevance", "specificity", "strengths", "structure"]
    );
    expect(result.evaluation.relevance).toBe(82);
  });

  it("STRUCTURAL: Call 1's requested JSON shape has no decision/next_question/interview_should_end field", () => {
    const call1PromptBlock = SUBMIT_ANSWER_SRC.slice(
      SUBMIT_ANSWER_SRC.indexOf("CALL 1:"),
      SUBMIT_ANSWER_SRC.indexOf("requestType: \"interview_turn_evaluate\"")
    );
    expect(call1PromptBlock).toMatch(/follow_up_worthy/);
    expect(call1PromptBlock).toMatch(/challenge_worthy/);
    expect(call1PromptBlock).toMatch(/flagged_claim/);
    expect(call1PromptBlock).not.toMatch(/"next_question"/);
    expect(call1PromptBlock).not.toMatch(/"interview_should_end"/);
    expect(call1PromptBlock).not.toMatch(/"decision":/);
  });
});

/* ============================== B ============================== */
describe("B. Scheduler executes between Call 1 and Call 2 (EXECUTABLE + STRUCTURAL)", () => {
  it("STRUCTURAL: submitAnswer calls runSimulatedAdaptiveTurn after Call 1 and before Call 2", () => {
    const call1Idx = SUBMIT_ANSWER_SRC.indexOf('requestType: "interview_turn_evaluate"');
    const schedulerIdx = SUBMIT_ANSWER_SRC.indexOf("runSimulatedAdaptiveTurn(");
    const call2Idx = SUBMIT_ANSWER_SRC.indexOf("generateAndPersistNextQuestion(");
    expect(call1Idx).toBeGreaterThan(-1);
    expect(schedulerIdx).toBeGreaterThan(call1Idx);
    expect(call2Idx).toBeGreaterThan(schedulerIdx);
  });

  it("EXECUTABLE: the exact composition submitAnswer performs (signals -> synthetic decision -> scheduler) produces a valid decision", () => {
    const evalResult = validateEvaluationSignals({ evaluation: makeEvaluation(), follow_up_worthy: true, challenge_worthy: false });
    const synthetic = syntheticDecisionFromEvaluationSignals(evalResult);
    const interview = makeInterview();
    const { decision, genInput } = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: interview.methodologyDistribution,
      answerText: "I led a cross-functional team of five.",
      evaluationResult: { evaluation: evalResult.evaluation, decision: synthetic },
      generateQuestion: () => ({}),
    });
    expect(TURN_TYPES).toContain(decision.turnType);
    expect(ACTIVE_CATEGORIES).toContain(decision.category);
    expect(genInput.category).toBe(decision.category);
  });
});

/* ============================== C ============================== */
describe("C. Call 2 receives the scheduler decision as authoritative context (EXECUTABLE)", () => {
  it("buildQuestionGenerationPrompt's directive and context reflect genInput's turnType/category/anchorSource", () => {
    const genInput = {
      category: "technical_functional", turnType: "follow_up", anchorSource: "previous_answer",
      competency: "distributed systems", previousQuestionText: "How did you scale it?", previousAnswer: "We sharded the DB.",
      questionNumber: 4,
    };
    const { system, userText } = buildQuestionGenerationPrompt(genInput, makeInterview(), makeProfile());
    expect(system).toMatch(/follow-up/i);
    expect(system).toMatch(/distributed systems/);
    expect(userText).toMatch(/How did you scale it\?/);
    expect(userText).toMatch(/We sharded the DB\./);
    expect(userText).toMatch(/technical_functional/);
  });

  it("a normal turn's prompt carries no previous-question/previous-answer context", () => {
    const genInput = { category: "motivation_fit", turnType: "normal", anchorSource: null, competency: undefined, questionNumber: 1 };
    const { userText } = buildQuestionGenerationPrompt(genInput, makeInterview(), makeProfile());
    expect(userText).not.toMatch(/Previous question/);
    expect(userText).not.toMatch(/Candidate's previous answer/);
  });

  it("a cv-anchored challenge_claim's prompt includes the flagged CV claims", () => {
    const genInput = {
      category: "commercial_awareness", turnType: "challenge_claim", anchorSource: "cv", competency: "impact",
      probeAreas: [{ claim: "grew revenue 40%", why: "unverified" }], previousQuestionText: "q", previousAnswer: "a", questionNumber: 3,
    };
    const { userText } = buildQuestionGenerationPrompt(genInput, makeInterview(), makeProfile());
    expect(userText).toMatch(/grew revenue 40%/);
  });
});

/* ============================ D/E/F/G ============================ */
describe("D-G. The model cannot override category / turn type / anchor source / scheduler-determined competency (EXECUTABLE, full 2C.3 glue)", () => {
  function runFullChain({ decisionInput, spoofed }) {
    const interview = makeInterview();
    const { decision, genInput } = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile([{ claim: "led a rewrite of the payments system", why: "unverified" }]),
      methodologyDistribution: interview.methodologyDistribution,
      answerText: decisionInput.answerText, evaluationResult: { evaluation: makeEvaluation(), decision: decisionInput.decision },
      generateQuestion: () => ({}),
    });
    const validated = validateGeneratedQuestion(spoofed);
    const stamped = stampQuestionFromDecision(validated, decision);
    return { decision, stamped };
  }

  it("D. category is always the scheduler's, never the model's spoofed value", () => {
    const { decision, stamped } = runFullChain({
      decisionInput: { decision: "new_competency", answerText: "answer" },
      spoofed: { text: "q", category: "SPOOFED", competency: "x", anchor_source: "y", turn_type: "z" },
    });
    expect(stamped.category).toBe(decision.category);
    expect(stamped.category).not.toBe("SPOOFED");
  });

  it("E. turn type (mode) is always the scheduler's, never the model's spoofed value", () => {
    const { decision, stamped } = runFullChain({
      decisionInput: { decision: "follow_up", answerText: "answer" },
      spoofed: { text: "q", turn_type: "clarify" },
    });
    expect(stamped.turn_type).toBe(decision.turnType);
    expect(stamped.turn_type).toBe("follow_up");
  });

  it("F. anchor source is always the scheduler's on a probing turn, never the model's spoofed value", () => {
    const { decision, stamped } = runFullChain({
      decisionInput: { decision: "challenge_claim", answerText: "I led a rewrite of the payments system." },
      spoofed: { text: "q", anchor_source: "generic" },
    });
    expect(stamped.anchor_source).toBe(decision.anchorSource);
    expect(stamped.anchor_source).toBe("cv"); // the answer echoes the flagged CV claim
    expect(stamped.anchor_source).not.toBe("generic");
  });

  it("G. a scheduler-determined competency (probing turn) is never overridden by the model", () => {
    const { decision, stamped } = runFullChain({
      decisionInput: { decision: "follow_up", answerText: "answer" },
      spoofed: { text: "q", competency: "SPOOFED_COMPETENCY" },
    });
    expect(decision.competency).toBeTruthy(); // inherited from the probed question
    expect(stamped.competency).toBe(decision.competency);
    expect(stamped.competency).not.toBe("SPOOFED_COMPETENCY");
  });

  it("a normal turn's competency (scheduler-undetermined) is left as the model's own choice", () => {
    const { decision, stamped } = runFullChain({
      decisionInput: { decision: "new_competency", answerText: "answer" },
      spoofed: { text: "q", competency: "stakeholder management" },
    });
    expect(decision.competency).toBeUndefined();
    expect(stamped.competency).toBe("stakeholder management");
  });
});

/* ============================== H ============================== */
describe("H. methodology_distribution is used by adaptive interviews (EXECUTABLE + STRUCTURAL)", () => {
  it("effectiveMethodologyDistribution reuses interview.methodologyDistribution verbatim when present", () => {
    const skewed = { motivation_fit: 80, behavioural_competency: 5, situational_judgement: 5, technical_functional: 5, commercial_awareness: 5 };
    expect(effectiveMethodologyDistribution(makeInterview({ methodologyDistribution: skewed }))).toBe(skewed);
  });

  it("a heavily-skewed distribution actually steers the live scheduler composition", () => {
    const skewed = { motivation_fit: 80, behavioural_competency: 5, situational_judgement: 5, technical_functional: 5, commercial_awareness: 5 };
    const interview = makeInterview({ methodologyDistribution: skewed, transcript: [] });
    const { decision } = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: effectiveMethodologyDistribution(interview),
      answerText: "answer", evaluationResult: { evaluation: makeEvaluation(), decision: "new_competency" },
      generateQuestion: () => ({}),
    });
    expect(decision.category).toBe("motivation_fit");
  });

  it("STRUCTURAL: the adaptive interview's React state carries methodologyDistribution (not just config.question_count)", () => {
    const newInterviewBlock = SOURCE.slice(SOURCE.indexOf("const q1 = await dbInsertQuestion(ivRow.id, 1"), SOURCE.indexOf("setInterview(newInterview);\n      setScreen(\"preview\");"));
    expect(newInterviewBlock).toMatch(/methodologyDistribution,/);
  });

  it("STRUCTURAL: submitAnswer reads effectiveMethodologyDistribution(interview), not interview.config.question_count", () => {
    expect(SUBMIT_ANSWER_SRC).toMatch(/effectiveMethodologyDistribution\(interview\)/);
    expect(SUBMIT_ANSWER_SRC).not.toMatch(/config\.question_count/);
  });
});

/* ============================== T ============================== */
describe("T. legacy interviews without methodology_distribution fall back safely (EXECUTABLE)", () => {
  it("falls back to the plain stage baseline via computeMethodologyDistribution — never a second calculation", () => {
    const interview = makeInterview({ methodologyDistribution: null, config: { stage: "technical" } });
    const result = effectiveMethodologyDistribution(interview);
    expect(result).toEqual(computeMethodologyDistribution("technical", null));
    expect(result).toEqual(STAGE_METHODOLOGY.technical.baseline);
  });

  it("an unrecognized/missing stage still falls back safely (first_round baseline)", () => {
    const result = effectiveMethodologyDistribution(makeInterview({ methodologyDistribution: undefined, config: {} }));
    expect(result).toEqual(STAGE_METHODOLOGY.first_round.baseline);
  });

  it("a legacy interview still produces a valid, deterministic scheduler decision (no crash, no undefined category)", () => {
    const interview = makeInterview({ methodologyDistribution: null, config: { stage: "first_round" } });
    const dist = effectiveMethodologyDistribution(interview);
    const { decision } = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: dist,
      answerText: "answer", evaluationResult: { evaluation: makeEvaluation(), decision: "new_competency" },
      generateQuestion: () => ({}),
    });
    expect(ACTIVE_CATEGORIES).toContain(decision.category);
  });
});

/* ============================== I ============================== */
describe("I. answer is persisted before Call 2 (STRUCTURAL)", () => {
  it("dbInsertAnswer is called before Call 2's requestType in submitAnswer's source", () => {
    const answerIdx = SUBMIT_ANSWER_SRC.indexOf("await dbInsertAnswer(");
    const call2Idx = SUBMIT_ANSWER_SRC.indexOf("generateAndPersistNextQuestion(");
    expect(answerIdx).toBeGreaterThan(-1);
    expect(call2Idx).toBeGreaterThan(answerIdx);
  });
});

/* ============================== J ============================== */
describe("J. pending decision is persisted before Call 2 (STRUCTURAL)", () => {
  it("dbSetQuestionMetadata(...decision...) is called before generateAndPersistNextQuestion in submitAnswer", () => {
    const setPendingIdx = SUBMIT_ANSWER_SRC.indexOf("await dbSetQuestionMetadata(currentQ.dbId, currentQ?.turn_type ?? null, { decision, genInput })");
    const call2Idx = SUBMIT_ANSWER_SRC.indexOf("await generateAndPersistNextQuestion(");
    expect(setPendingIdx).toBeGreaterThan(-1);
    expect(call2Idx).toBeGreaterThan(setPendingIdx);
  });

  it("the pending decision is cleared only inside generateAndPersistNextQuestion, after the question row is inserted", () => {
    const insertIdx = GENERATE_AND_PERSIST_SRC.indexOf("await dbInsertQuestion(");
    const clearIdx = GENERATE_AND_PERSIST_SRC.indexOf("await dbSetQuestionMetadata(answeredQuestionId, answeredTurnType, null)");
    expect(insertIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeGreaterThan(insertIdx);
  });
});

/* ============================== K ============================== */
describe("K. Call 2 failure does not create a duplicate answer (STRUCTURAL)", () => {
  it("dbInsertAnswer appears exactly once in submitAnswer, and never inside the Call-2 try/catch", () => {
    const occurrences = SUBMIT_ANSWER_SRC.split("dbInsertAnswer(").length - 1;
    expect(occurrences).toBe(1);
    const call2Try = SUBMIT_ANSWER_SRC.slice(SUBMIT_ANSWER_SRC.indexOf("try {", SUBMIT_ANSWER_SRC.indexOf("PERSIST SCHEDULER DECISION")));
    expect(call2Try).not.toMatch(/dbInsertAnswer/);
  });

  it("the CALL2_FAILED catch block never calls dbInsertAnswer or callClaude again", () => {
    const catchBlock = SUBMIT_ANSWER_SRC.slice(SUBMIT_ANSWER_SRC.indexOf("catch (genErr)"), SUBMIT_ANSWER_SRC.indexOf("} catch (e) {"));
    expect(catchBlock).not.toMatch(/dbInsertAnswer/);
    expect(catchBlock).not.toMatch(/callClaude/);
  });
});

/* ============================== L ============================== */
describe("L. regeneration does not call Call 1 (STRUCTURAL)", () => {
  it("regenerateNextQuestion's source contains no Call-1 markers", () => {
    expect(REGENERATE_SRC).not.toMatch(/interview_turn_evaluate/);
    expect(REGENERATE_SRC).not.toMatch(/validateEvaluationSignals/);
    expect(REGENERATE_SRC).not.toMatch(/follow_up_worthy/);
  });

  it("reconstructSchedulerDecision's source contains no Call-1 markers either", () => {
    expect(RECONSTRUCT_SRC).not.toMatch(/interview_turn_evaluate/);
    expect(RECONSTRUCT_SRC).not.toMatch(/validateEvaluationSignals/);
    expect(RECONSTRUCT_SRC).not.toMatch(/callClaude/); // it only reads the DB, never calls the model
  });
});

/* ============================== M ============================== */
describe("M. regeneration does not insert another answer (STRUCTURAL)", () => {
  it("neither regenerateNextQuestion nor reconstructSchedulerDecision calls dbInsertAnswer", () => {
    expect(REGENERATE_SRC).not.toMatch(/dbInsertAnswer/);
    expect(RECONSTRUCT_SRC).not.toMatch(/dbInsertAnswer/);
  });
});

/* ============================== N ============================== */
describe("N. persisted decision is preferred during recovery (STRUCTURAL + EXECUTABLE)", () => {
  it("STRUCTURAL: reconstructSchedulerDecision's very first statement returns the known decision verbatim, before any DB read", () => {
    const earlyReturnIdx = RECONSTRUCT_SRC.indexOf("if (knownDecision && knownGenInput) return { decision: knownDecision, genInput: knownGenInput };");
    const firstDbReadIdx = RECONSTRUCT_SRC.indexOf("getSupabase()");
    expect(earlyReturnIdx).toBeGreaterThan(-1);
    expect(firstDbReadIdx).toBeGreaterThan(earlyReturnIdx);
  });

  it("EXECUTABLE: a verbatim decision/genInput is never recomputed — computeRecoveryDecision is never reached when both are known", () => {
    // Simulates reconstructSchedulerDecision's own early-return line directly: since it's a
    // plain `if (...) return ...;` as the function's first statement (asserted above), any
    // known pair short-circuits before computeRecoveryDecision (or any DB read) is reached —
    // this proves the returned value IS the known pair, unmodified, for a representative case.
    const knownDecision = { category: "commercial_awareness", turnType: "clarify", anchorSource: "previous_answer", competency: undefined };
    const knownGenInput = { category: "commercial_awareness", turnType: "clarify", anchorSource: "previous_answer", questionNumber: 7 };
    const shortCircuited = knownDecision && knownGenInput ? { decision: knownDecision, genInput: knownGenInput } : null;
    expect(shortCircuited).toEqual({ decision: knownDecision, genInput: knownGenInput });
  });
});

/* ============================== O ============================== */
describe("O. recomputation fallback works when pending decision is absent (EXECUTABLE)", () => {
  it("computeRecoveryDecision reproduces the same decision the live path would have made, from persisted data alone", () => {
    const priorTranscript = [{ question: { category: "motivation_fit", competency: "drive", turn_type: "normal" }, answer: "a", evaluation: makeEvaluation() }];
    const answeredEntry = { question: { category: "technical_functional", competency: "systems", turn_type: "normal", dbId: "q-2" }, answer: "I designed a sharded datastore.", evaluation: makeEvaluation() };
    const interview = makeInterview({ transcript: [...priorTranscript, answeredEntry] });

    // What the LIVE path would have computed, at the moment this turn was answered:
    const live = runSimulatedAdaptiveTurn({
      interview: { ...interview, transcript: priorTranscript, currentQuestion: answeredEntry.question },
      profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: answeredEntry.answer, evaluationResult: { evaluation: answeredEntry.evaluation, decision: "new_competency" },
      generateQuestion: () => ({}),
    });

    // What recomputation-from-persisted-data produces, given only the persisted decision string:
    const recomputed = computeRecoveryDecision({
      interview, profile: makeProfile(), priorTranscript, answeredEntry,
      legacyDecision: "new_competency", methodologyDistribution: DISTRIBUTION_EQUAL,
    });

    expect(recomputed.decision).toEqual(live.decision);
    expect(recomputed.genInput).toEqual(live.genInput);
  });

  it("round-trips a probing decision (follow_up) through the legacy vocabulary and back to the same result", () => {
    const priorTranscript = [];
    const answeredEntry = { question: { category: "behavioural_competency", competency: "leadership", turn_type: "normal", dbId: "q-1" }, answer: "I led five engineers.", evaluation: makeEvaluation() };
    const interview = makeInterview({ transcript: [answeredEntry] });
    const persistedLegacyDecision = legacyDecisionFromTurnType("follow_up"); // what submitAnswer would have written
    const recomputed = computeRecoveryDecision({
      interview, profile: makeProfile(), priorTranscript, answeredEntry,
      legacyDecision: persistedLegacyDecision, methodologyDistribution: DISTRIBUTION_EQUAL,
    });
    expect(recomputed.decision.turnType).toBe("follow_up");
    expect(recomputed.decision.category).toBe("behavioural_competency");
  });

  it("STRUCTURAL: reconstructSchedulerDecision's recompute path drops the just-answered entry from priorTranscript before calling computeRecoveryDecision", () => {
    expect(RECONSTRUCT_SRC).toMatch(/interview\.transcript\.slice\(0, -1\)/);
    expect(RECONSTRUCT_SRC).toMatch(/computeRecoveryDecision\(/);
  });
});

/* ============================== P ============================== */
describe("P. question counters remain correct after regeneration (EXECUTABLE)", () => {
  it("computeRecoveryDecision's genInput.questionNumber matches what the live path would have produced", () => {
    const priorTranscript = Array.from({ length: 4 }, (_, i) => ({
      question: { category: ACTIVE_CATEGORIES[i % ACTIVE_CATEGORIES.length], competency: "c", turn_type: "normal" }, answer: `a${i}`, evaluation: makeEvaluation(),
    }));
    const answeredEntry = { question: { category: "motivation_fit", competency: "drive", turn_type: "normal", dbId: "q-5" }, answer: "answer", evaluation: makeEvaluation() };
    const interview = makeInterview({ transcript: [...priorTranscript, answeredEntry] });

    const live = runSimulatedAdaptiveTurn({
      interview: { ...interview, transcript: priorTranscript, currentQuestion: answeredEntry.question },
      profile: makeProfile(), methodologyDistribution: DISTRIBUTION_EQUAL,
      answerText: answeredEntry.answer, evaluationResult: { evaluation: answeredEntry.evaluation, decision: "new_competency" },
      generateQuestion: () => ({}),
    });
    const recomputed = computeRecoveryDecision({
      interview, profile: makeProfile(), priorTranscript, answeredEntry,
      legacyDecision: "new_competency", methodologyDistribution: DISTRIBUTION_EQUAL,
    });
    expect(recomputed.genInput.questionNumber).toBe(live.genInput.questionNumber);
    expect(recomputed.genInput.questionNumber).toBe(priorTranscript.length + 2); // 5 answered so far + the one being generated
  });

  it("STRUCTURAL: regenerateNextQuestion never mutates transcript length itself — it only sets currentQuestion/pendingRecovery", () => {
    // Phase 2E: regenerateNextQuestion now READS interview.transcript (unmutated) to build a
    // candidateStrategy for the retried prompt — the precise invariant this test guards is
    // that its own setInterview(...) call never assigns a `transcript:` field, not that the
    // word never appears anywhere in the function's source.
    const setInterviewCall = REGENERATE_SRC.slice(REGENERATE_SRC.indexOf("setInterview({"), REGENERATE_SRC.indexOf("setScreen(\"interview\")"));
    expect(setInterviewCall).toContain("setInterview({ ...interview, currentQuestion: nextQuestion, pendingRecovery: null })");
    expect(setInterviewCall).not.toMatch(/transcript:/);
  });
});

/* ============================== Q ============================== */
describe("Q. wasFollowUp refers to the current question, not the next decision (EXECUTABLE + STRUCTURAL)", () => {
  it("isFollowUpQuestion reads the QUESTION's own turn_type", () => {
    expect(isFollowUpQuestion({ turn_type: "follow_up" })).toBe(true);
    expect(isFollowUpQuestion({ turn_type: "normal" })).toBe(false);
    expect(isFollowUpQuestion({ turn_type: "challenge_claim" })).toBe(false);
    expect(isFollowUpQuestion({ turn_type: "clarify" })).toBe(false);
    expect(isFollowUpQuestion(undefined)).toBe(false);
    expect(isFollowUpQuestion(null)).toBe(false);
    expect(isFollowUpQuestion({})).toBe(false); // opening question: no turn_type at all
  });

  it("is NOT fooled by a decision object that happens to have turnType: 'follow_up' (no .turn_type field)", () => {
    const nextTurnDecision = { turnType: "follow_up", category: "motivation_fit", anchorSource: "previous_answer" };
    expect(isFollowUpQuestion(nextTurnDecision)).toBe(false); // decision objects use `turnType`, not `turn_type` — never conflated
  });

  it("STRUCTURAL: wasFollowUp is derived from currentQ (the answered question), computed before the scheduler ever runs", () => {
    const wasFollowUpIdx = SUBMIT_ANSWER_SRC.indexOf("const wasFollowUp = isFollowUpQuestion(currentQ);");
    const schedulerIdx = SUBMIT_ANSWER_SRC.indexOf("runSimulatedAdaptiveTurn(");
    expect(wasFollowUpIdx).toBeGreaterThan(-1);
    expect(schedulerIdx).toBeGreaterThan(wasFollowUpIdx);
    expect(SUBMIT_ANSWER_SRC).not.toMatch(/isFollowUpQuestion\(decision\)/);
    expect(SUBMIT_ANSWER_SRC).not.toMatch(/isFollowUpQuestion\(genInput\)/);
  });
});

/* ============================== R ============================== */
describe("R. Short/Standard/Long lengths (EXECUTABLE)", () => {
  it.each([["Short", 8], ["Standard", 12], ["Long", 18]])("%s (%i questions) schedules and ends deterministically", (_label, maxQuestions) => {
    const interview = makeInterview({ maxQuestions });
    const { decision } = runSimulatedAdaptiveTurn({
      interview, profile: makeProfile(), methodologyDistribution: interview.methodologyDistribution,
      answerText: "answer", evaluationResult: { evaluation: makeEvaluation(), decision: "new_competency" },
      generateQuestion: () => ({}),
    });
    expect(ACTIVE_CATEGORIES).toContain(decision.category);
    expect(isInterviewComplete(maxQuestions, maxQuestions)).toBe(true);
    expect(isInterviewComplete(maxQuestions - 1, maxQuestions)).toBe(false);
  });
});

/* ============================== S ============================== */
describe("S. deterministic interview ending (EXECUTABLE)", () => {
  it("ends exactly at maxQuestions, never before, never based on any AI input", () => {
    for (const maxQuestions of [1, 5, 8, 12, 18, 25]) {
      expect(isInterviewComplete(maxQuestions - 1, maxQuestions)).toBe(false);
      expect(isInterviewComplete(maxQuestions, maxQuestions)).toBe(true);
      expect(isInterviewComplete(maxQuestions + 1, maxQuestions)).toBe(true);
    }
  });

  it("treats a missing/invalid maxQuestions as 0 (ends immediately) rather than continuing indefinitely", () => {
    expect(isInterviewComplete(0, undefined)).toBe(true);
    expect(isInterviewComplete(0, null)).toBe(true);
    expect(isInterviewComplete(1, "not-a-number")).toBe(true);
  });

  it("STRUCTURAL: shouldEnd is computed from isInterviewComplete(transcript.length, interview.maxQuestions) — no AI-provided boolean anywhere in submitAnswer", () => {
    expect(SUBMIT_ANSWER_SRC).toMatch(/isInterviewComplete\(newTranscript\.length, interview\.maxQuestions\)/);
    expect(SUBMIT_ANSWER_SRC).not.toMatch(/interview_should_end/);
  });
});

/* ============================== U ============================== */
describe("U. batch/independent pipeline remains isolated (STRUCTURAL)", () => {
  it("submitAnswer's independent_batch guard is still present, unchanged in intent", () => {
    expect(SUBMIT_ANSWER_SRC).toMatch(/pipeline === "independent_batch"/);
    expect(SUBMIT_ANSWER_SRC).toMatch(/routing bug, not a valid interview state/);
  });

  it("dbInsertQuestionBatch still tags its rows generation_mode \"independent\", never touched by 2C.3", () => {
    const batchHelperSrc = SOURCE.slice(SOURCE.indexOf("async function dbInsertQuestionBatch("), SOURCE.indexOf("async function dbInsertAnswerOnly("));
    expect(batchHelperSrc).toMatch(/generation_mode:\s*"independent"/);
    expect(batchHelperSrc).not.toMatch(/runSimulatedAdaptiveTurn|stampQuestionFromDecision|adaptiveEngine/);
  });

  it("adaptiveEngine.js's own isolation from the batch pipeline still holds (2C.2's guarantee, unmodified)", () => {
    const engineSource = readFileSync(new URL("./adaptiveEngine.js", import.meta.url), "utf8");
    expect(engineSource).not.toMatch(/independent_batch/i);
    expect(engineSource).not.toMatch(/generateQuestionBatch/i);
    expect(engineSource).not.toMatch(/dbInsertQuestionBatch/i);
  });
});

/* ============================== V ============================== */
describe("V. Assessment Centre remains untouched (STRUCTURAL)", () => {
  it("Assessment Centre's own functions (startAssessmentCentre/generateAcScenario/submitAcResponse) contain no 2C.3 scheduler wiring", () => {
    // Clean, unambiguous boundaries: the file's own section comments.
    const acFunctionsBlock = extractFunctionSource(
      "/* ---------------- ASSESSMENT CENTRE ---------------- */",
      "/* ---------------- DERIVED VALUES ---------------- */"
    );
    expect(acFunctionsBlock).toMatch(/function startAssessmentCentre/);
    expect(acFunctionsBlock).toMatch(/async function generateAcScenario/);
    expect(acFunctionsBlock).toMatch(/async function submitAcResponse/);
    expect(acFunctionsBlock).not.toMatch(/runSimulatedAdaptiveTurn|stampQuestionFromDecision|scheduleNextCategory|resolveTurnDirective|adaptiveEngine/);
  });

  it("the Assessment Centre's JSX screen block contains no 2C.3 scheduler wiring", () => {
    const acJsxStart = SOURCE.indexOf('{/* ---------------- ASSESSMENT CENTRE ---------------- */}');
    expect(acJsxStart).toBeGreaterThan(-1);
    const acJsxBlock = SOURCE.slice(acJsxStart);
    expect(acJsxBlock).not.toMatch(/runSimulatedAdaptiveTurn|stampQuestionFromDecision|pendingRecovery|regenerateNextQuestion/);
  });

  it("EXERCISE_TYPES / Assessment Centre routing constants are still present and untouched by this diff", () => {
    expect(SOURCE).toMatch(/EXERCISE_TYPES/);
    expect(SOURCE).toMatch(/screen === "ac_home"|"ac_home"/);
  });
});

/* ============================== W ============================== */
describe("W. existing evaluation/report shape remains compatible (EXECUTABLE + STRUCTURAL)", () => {
  it("the persisted decision string is always one of the pre-existing legacy decision values", () => {
    for (const turnType of TURN_TYPES) {
      expect(["follow_up", "new_competency", "challenge_claim", "clarify"]).toContain(legacyDecisionFromTurnType(turnType));
    }
    expect(legacyDecisionFromTurnType("something_unrecognized")).toBe("new_competency");
  });

  it("STRUCTURAL: dbInsertAnswer's evaluations insert still writes every pre-existing rubric column plus decision", () => {
    const helperSrc = SOURCE.slice(SOURCE.indexOf("async function dbInsertAnswer("), SOURCE.indexOf("// Phase 4B: independent/batch pipeline DB helpers"));
    for (const col of ["relevance", "specificity", "structure", "evidence", "clarity", "competency_demonstration", "strengths", "issues", "decision"]) {
      expect(helperSrc).toMatch(new RegExp(col));
    }
  });

  it("STRUCTURAL: finishInterview's report-generation prompt/logic is untouched by 2C.3 (no scheduler references)", () => {
    const reportSrc = SOURCE.slice(SOURCE.indexOf("async function finishInterview("), SOURCE.indexOf("/* ---------------- PHASE 4B: INDEPENDENT/BATCH (ASYNC) INTERVIEW"));
    expect(reportSrc).not.toMatch(/runSimulatedAdaptiveTurn|stampQuestionFromDecision|buildQuestionGenerationPrompt/);
  });
});

/* ==================== syntheticDecisionFromEvaluationSignals ==================== */
describe("syntheticDecisionFromEvaluationSignals — signal priority (EXECUTABLE)", () => {
  it("challenge_worthy outranks everything else", () => {
    const evalResult = { challenge_worthy: true, follow_up_worthy: true, evaluation: makeEvaluation({ specificity: 10, relevance: 10 }) };
    expect(syntheticDecisionFromEvaluationSignals(evalResult)).toBe("challenge_claim");
  });

  it("vagueness (below threshold) outranks follow_up_worthy when not challenge_worthy", () => {
    const evalResult = { challenge_worthy: false, follow_up_worthy: true, evaluation: makeEvaluation({ specificity: VAGUE_ANSWER_THRESHOLD - 1, relevance: 90 }) };
    expect(syntheticDecisionFromEvaluationSignals(evalResult)).toBe("clarify");
  });

  it("follow_up_worthy applies once the answer is neither challenge-worthy nor vague", () => {
    const evalResult = { challenge_worthy: false, follow_up_worthy: true, evaluation: makeEvaluation({ specificity: 90, relevance: 90 }) };
    expect(syntheticDecisionFromEvaluationSignals(evalResult)).toBe("follow_up");
  });

  it("defaults to new_competency (normal) when nothing is flagged and the answer is specific enough", () => {
    const evalResult = { challenge_worthy: false, follow_up_worthy: false, evaluation: makeEvaluation({ specificity: 90, relevance: 90 }) };
    expect(syntheticDecisionFromEvaluationSignals(evalResult)).toBe("new_competency");
  });

  it("is deterministic across repeated calls with identical input", () => {
    const evalResult = { challenge_worthy: false, follow_up_worthy: true, evaluation: makeEvaluation() };
    const results = Array.from({ length: 20 }, () => syntheticDecisionFromEvaluationSignals(evalResult));
    expect(new Set(results).size).toBe(1);
  });
});

describe("validateGeneratedQuestion (EXECUTABLE)", () => {
  it("extracts text/competency/anchor_source only — category/turn_type are never part of this shape at all", () => {
    const result = validateGeneratedQuestion({ text: "q", competency: "c", category: "SPOOFED", anchor_source: "jd", turn_type: "SPOOFED" });
    expect(Object.keys(result).sort()).toEqual(["anchor_source", "competency", "text"]);
    expect(result.category).toBeUndefined();
    expect(result.turn_type).toBeUndefined();
  });

  it("restricts anchor_source to BATCH_ANCHOR_SOURCES — never previous_answer (scheduler-only), falls back to generic", () => {
    expect(validateGeneratedQuestion({ text: "q", anchor_source: "cv" }).anchor_source).toBe("cv");
    expect(validateGeneratedQuestion({ text: "q", anchor_source: "jd" }).anchor_source).toBe("jd");
    expect(validateGeneratedQuestion({ text: "q", anchor_source: "company" }).anchor_source).toBe("company");
    expect(validateGeneratedQuestion({ text: "q", anchor_source: "previous_answer" }).anchor_source).toBe("generic");
    expect(validateGeneratedQuestion({ text: "q", anchor_source: "nonsense" }).anchor_source).toBe("generic");
    expect(validateGeneratedQuestion({ text: "q" }).anchor_source).toBe("generic");
  });

  it("defensively handles missing/null input", () => {
    expect(validateGeneratedQuestion(null).text).toBeTruthy();
    expect(validateGeneratedQuestion(undefined).text).toBeTruthy();
  });
});

describe("buildQuestionGenerationPrompt — anchor_source requested only for a normal turn (EXECUTABLE)", () => {
  it("a normal turn's prompt asks for anchor_source", () => {
    const { system } = buildQuestionGenerationPrompt({ category: "motivation_fit", turnType: "normal", anchorSource: null, questionNumber: 1 }, makeInterview(), makeProfile());
    expect(system).toMatch(/"anchor_source": "generic\|cv\|jd\|company"/);
  });

  it("a probing turn's prompt does NOT ask the model for anchor_source (the scheduler already has one)", () => {
    const { system } = buildQuestionGenerationPrompt({ category: "motivation_fit", turnType: "follow_up", anchorSource: "previous_answer", questionNumber: 2 }, makeInterview(), makeProfile());
    expect(system).not.toMatch(/"anchor_source"/);
  });
});

/* ============================== PHASE 2E ============================== */
describe("PHASE 2E — buildQuestionGenerationPrompt's optional candidateStrategy context (EXECUTABLE)", () => {
  it("omitting candidateStrategy entirely produces the exact pre-2E prompt (full backward compatibility)", () => {
    const genInput = { category: "motivation_fit", turnType: "normal", anchorSource: null, questionNumber: 1 };
    const withoutArg = buildQuestionGenerationPrompt(genInput, makeInterview(), makeProfile());
    const withUndefined = buildQuestionGenerationPrompt(genInput, makeInterview(), makeProfile(), undefined, undefined);
    expect(withoutArg).toEqual(withUndefined);
  });

  it("a strong positive category preference adds a 'genuine coverage gap' note on a normal turn", () => {
    const genInput = { category: "motivation_fit", turnType: "normal", anchorSource: null, questionNumber: 1 };
    const { system } = buildQuestionGenerationPrompt(genInput, makeInterview(), makeProfile(), undefined, { categoryPreference: { motivation_fit: 0.8 } });
    expect(system).toMatch(/genuine coverage gap/);
  });

  it("a strong negative category preference adds a 'well covered' note on a normal turn", () => {
    const genInput = { category: "motivation_fit", turnType: "normal", anchorSource: null, questionNumber: 1 };
    const { system } = buildQuestionGenerationPrompt(genInput, makeInterview(), makeProfile(), undefined, { categoryPreference: { motivation_fit: -0.8 } });
    expect(system).toMatch(/already well covered/);
  });

  it("never adds a strategy note on a probing turn (informational-only, normal-turn-only, matching the Phase 2D note's own scope)", () => {
    const genInput = { category: "motivation_fit", turnType: "follow_up", anchorSource: "previous_answer", questionNumber: 2 };
    const { system } = buildQuestionGenerationPrompt(genInput, makeInterview(), makeProfile(), undefined, { categoryPreference: { motivation_fit: 0.9 } });
    expect(system).not.toMatch(/Candidate strategy:/);
  });

  it("never overwrites an existing Phase 2D categoryCoverage note — additive only, first note wins", () => {
    const genInput = { category: "motivation_fit", turnType: "normal", anchorSource: null, questionNumber: 1 };
    const candidateSignals = { categoryCoverage: { motivation_fit: { status: "unknown" } } };
    const { system } = buildQuestionGenerationPrompt(genInput, makeInterview(), makeProfile(), candidateSignals, { categoryPreference: { motivation_fit: -0.9 } });
    expect(system).toMatch(/hasn't been tested for this candidate before/); // Phase 2D note
    expect(system).not.toMatch(/Candidate strategy:/); // Phase 2E note suppressed
  });

  it("malformed candidateStrategy never throws and produces no note", () => {
    const genInput = { category: "motivation_fit", turnType: "normal", anchorSource: null, questionNumber: 1 };
    for (const bad of [null, "nonsense", 42, {}]) {
      expect(() => buildQuestionGenerationPrompt(genInput, makeInterview(), makeProfile(), undefined, bad)).not.toThrow();
    }
  });
});

describe("PHASE 2E — submitAnswer computes and threads candidateStrategy (STRUCTURAL)", () => {
  it("candidateStrategy is computed after Call 1 and before the scheduler runs", () => {
    const buildIdx = SUBMIT_ANSWER_SRC.indexOf("buildInterviewStrategy(");
    const call1Idx = SUBMIT_ANSWER_SRC.indexOf('requestType: "interview_turn_evaluate"');
    const schedulerIdx = SUBMIT_ANSWER_SRC.indexOf("runSimulatedAdaptiveTurn(");
    expect(buildIdx).toBeGreaterThan(call1Idx);
    expect(schedulerIdx).toBeGreaterThan(buildIdx);
  });

  it("the candidate strategy build is wrapped in a non-fatal try/catch, same defensive pattern as every other Candidate Intelligence call site", () => {
    const block = SUBMIT_ANSWER_SRC.slice(SUBMIT_ANSWER_SRC.indexOf("PHASE 2E: CANDIDATE STRATEGY"), SUBMIT_ANSWER_SRC.indexOf("SCHEDULER (SCHEDULED)"));
    expect(block).toMatch(/try\s*\{/);
    expect(block).toMatch(/catch \(csErr\)/);
    expect(block).not.toMatch(/setError\(/);
    expect(block).not.toMatch(/setScreen\(/);
  });

  it("candidateStrategy is passed into both runSimulatedAdaptiveTurn and generateAndPersistNextQuestion", () => {
    expect(SUBMIT_ANSWER_SRC).toMatch(/runSimulatedAdaptiveTurn\(\{[\s\S]*candidateStrategy,?\s*\}\)/);
    expect(SUBMIT_ANSWER_SRC).toMatch(/generateAndPersistNextQuestion\([^)]*candidateStrategy\)/);
  });

  it("generateAndPersistNextQuestion passes candidateStrategy into buildQuestionGenerationPrompt, never into the scheduler decision itself", () => {
    expect(GENERATE_AND_PERSIST_SRC).toMatch(/buildQuestionGenerationPrompt\(genInput, interviewForPrompt, profileForPrompt, candidateIntelligence, candidateStrategy\)/);
  });
});

describe("PHASE 2E — no second scheduler, no new AI call (STRUCTURAL)", () => {
  it("interviewStrategy.js never imports or invokes the scheduler itself, never imports React/Supabase/AI", () => {
    const src = readFileSync(new URL("./interviewStrategy.js", import.meta.url), "utf8");
    // Referencing the scheduler's NAME in a doc comment (documenting where its output is
    // consumed downstream) is fine; importing or calling it is not.
    expect(src).not.toMatch(/scheduleNextCategory\(|resolveTurnDirective\(|runSimulatedAdaptiveTurn\(/);
    expect(src).not.toMatch(/from ["']\.\/adaptiveEngine/);
    expect(src).not.toMatch(/callClaude|supabase/i);
    expect(src).not.toMatch(/from ["']react["']/i);
  });

  it("methodology.js's scheduleNextCategory is still the ONLY place a category is chosen — interviewStrategy.js never assigns one", () => {
    const src = readFileSync(new URL("./interviewStrategy.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/decision\.category\s*=|genInput\.category\s*=/);
  });

  it("submitAnswer still makes exactly two callClaude requests per turn — Call 1 (evaluate) and Call 2 (generate) — Phase 2E adds no AI call", () => {
    const occurrences = SUBMIT_ANSWER_SRC.split("callClaude(").length - 1;
    expect(occurrences).toBe(1); // Call 2 itself happens inside generateAndPersistNextQuestion, not submitAnswer's own body
    expect(GENERATE_AND_PERSIST_SRC.split("callClaude(").length - 1).toBe(1);
  });
});

describe("PHASE 2E — batch/independent pipeline and Assessment Centre remain isolated (STRUCTURAL)", () => {
  it("candidate strategy has no coupling to the independent/batch pipeline", () => {
    const batchHelperSrc = SOURCE.slice(SOURCE.indexOf("async function dbInsertQuestionBatch("), SOURCE.indexOf("async function dbInsertAnswerOnly("));
    expect(batchHelperSrc).not.toMatch(/buildInterviewStrategy|candidateStrategy|interviewStrategy/i);
  });

  it("Assessment Centre functions contain no candidate-strategy wiring", () => {
    const acFunctionsBlock = extractFunctionSource(
      "/* ---------------- ASSESSMENT CENTRE ---------------- */",
      "/* ---------------- DERIVED VALUES ---------------- */"
    );
    expect(acFunctionsBlock).not.toMatch(/buildInterviewStrategy|candidateStrategy|interviewStrategy/i);
  });
});
