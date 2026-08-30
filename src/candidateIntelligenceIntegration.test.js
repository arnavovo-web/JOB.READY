/* ================================================================== *
 * PHASE 2D — App.jsx / Phase 2C INTEGRATION TEST SUITE
 * ------------------------------------------------------------------
 * candidateIntelligence.test.js covers the pure module in isolation.
 * This file covers the App.jsx GLUE that wires Candidate Intelligence
 * into analyseAndPlan/submitAnswer — the "2D tells 2C what it should
 * know, 2C still decides" boundary, and the failure/isolation
 * guarantees the spec calls out explicitly.
 *
 * Same convention as liveWiring.test.js: EXECUTABLE tests call a real
 * exported pure function; STRUCTURAL tests read App.jsx's own source
 * text, because analyseAndPlan/submitAnswer/generateAndPersistNextQuestion
 * are React-closure functions that cannot be imported and invoked
 * directly in a unit test.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ACTIVE_CATEGORIES } from "./methodology.js";
import { buildQuestionGenerationPrompt, validateGeneratedQuestion } from "./App.jsx";
import { buildCandidateSignals, mergeProbeAreasForInterview } from "./candidateIntelligence.js";

const SOURCE = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function extractFunctionSource(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found in App.jsx: ${startMarker}`);
  const end = SOURCE.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`end marker not found in App.jsx: ${endMarker}`);
  return SOURCE.slice(start, end);
}

const ANALYSE_AND_PLAN_SRC = extractFunctionSource("async function analyseAndPlan()", "function beginInterview()");
const SUBMIT_ANSWER_SRC = extractFunctionSource("async function submitAnswer()", "async function generateAndPersistNextQuestion(");

/* ============================== Adaptive integration ============================== */
describe("Candidate Intelligence cannot override the scheduler (STRUCTURAL)", () => {
  it("the scheduler call in submitAnswer takes no candidate-intelligence argument at all", () => {
    const schedulerCallIdx = SUBMIT_ANSWER_SRC.indexOf("runSimulatedAdaptiveTurn({");
    expect(schedulerCallIdx).toBeGreaterThan(-1);
    const schedulerCall = SUBMIT_ANSWER_SRC.slice(schedulerCallIdx, SUBMIT_ANSWER_SRC.indexOf("});", schedulerCallIdx));
    // Only the pre-existing 2C.3 args — interview, profile, methodologyDistribution,
    // answerText, evaluationResult, generateQuestion. No candidateIntelligence/claims field.
    expect(schedulerCall).not.toMatch(/candidateIntelligence|candidateClaims|candidateSignals/);
  });

  it("candidate-intelligence merging happens only on profile.candidate_profile.potential_probe_areas — the existing 2C.2 input shape, never a new scheduler parameter", () => {
    expect(ANALYSE_AND_PLAN_SRC).toMatch(/result\.candidate_profile\.potential_probe_areas\s*=\s*mergeProbeAreasForInterview/);
  });

  it("the merge is skipped entirely for the independent_batch pipeline", () => {
    const mergeBlock = ANALYSE_AND_PLAN_SRC.slice(
      ANALYSE_AND_PLAN_SRC.indexOf("if (ivConfig.pipeline !== \"independent_batch\")"),
      ANALYSE_AND_PLAN_SRC.indexOf("setProfile(result);")
    );
    expect(mergeBlock).toMatch(/mergeProbeAreasForInterview/);
  });

  it("mergeProbeAreasForInterview's own output can never carry a category/turnType/anchorSource field (EXECUTABLE, re-confirms the 2C.2 contract at the integration boundary)", () => {
    const merged = mergeProbeAreasForInterview(
      [{ claim: "Built an automated valuation model", why: "cv" }],
      [{ claim: "Led a team of 10", why: "unresolved", category: "behavioural_competency", claimId: "c1" }]
    );
    // Phase 21: output carries provenance ({ source, evidence_quote }) end to end,
    // but still NEVER a scheduler-owned field.
    for (const p of merged) {
      expect(Object.keys(p).sort()).toEqual(["claim", "evidence_quote", "source", "why"]);
      expect(p).not.toHaveProperty("category");
      expect(p).not.toHaveProperty("turnType");
      expect(p).not.toHaveProperty("anchorSource");
      expect(p).not.toHaveProperty("claimId");
    }
    // provenance defaults to "unverified" when the input probe area carries none
    for (const p of merged) expect(p.source).toBe("unverified");
  });
});

describe("scheduler remains deterministic — candidateIntelligence.js makes no AI calls (STRUCTURAL)", () => {
  it("the module never calls callClaude or touches Supabase", () => {
    const source = readFileSync(new URL("./candidateIntelligence.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/callClaude/);
    expect(source).not.toMatch(/supabase/i);
  });
});

describe("candidate signals affect generation context only where intended (EXECUTABLE)", () => {
  const genInputNormal = { category: "commercial_awareness", turnType: "normal", anchorSource: null, questionNumber: 3 };
  const genInputProbing = { category: "commercial_awareness", turnType: "follow_up", anchorSource: "previous_answer", questionNumber: 4 };

  it("a demonstrated + recently-tested category gets a 'vary the angle' note on a normal turn", () => {
    const signals = buildCandidateSignals({
      memoryRows: [
        { category: "commercial_awareness", competency: "market sizing", score: 80, interview_id: "iv-1", created_at: new Date().toISOString() },
        { category: "commercial_awareness", competency: "market sizing", score: 85, interview_id: "iv-2", created_at: new Date().toISOString() },
        { category: "commercial_awareness", competency: "market sizing", score: 78, interview_id: "iv-3", created_at: new Date().toISOString() },
      ],
    });
    const { system } = buildQuestionGenerationPrompt(genInputNormal, { maxQuestions: 10 }, {}, signals);
    expect(system).toMatch(/already well-evidenced/);
  });

  it("an untested category gets a 'first data point' note on a normal turn", () => {
    const signals = buildCandidateSignals({});
    const { system } = buildQuestionGenerationPrompt(genInputNormal, { maxQuestions: 10 }, {}, signals);
    expect(system).toMatch(/hasn't been tested for this candidate before/);
  });

  it("no candidate note is added to a probing turn (follow_up/challenge_claim/clarify) — only normal turns get this context", () => {
    const signals = buildCandidateSignals({});
    const { system } = buildQuestionGenerationPrompt(genInputProbing, { maxQuestions: 10 }, {}, signals);
    expect(system).not.toMatch(/Candidate intelligence:/);
  });

  it("the candidate note is informational only — the requested response schema never grows a category/competency-override field because of it", () => {
    const signals = buildCandidateSignals({});
    const { system } = buildQuestionGenerationPrompt(genInputNormal, { maxQuestions: 10 }, {}, signals);
    expect(system).toMatch(/\{ "text": "", "competency": "", "anchor_source": "generic\|cv\|jd\|company" \}/);
  });
});

describe("missing/malformed Candidate Intelligence falls back cleanly (EXECUTABLE)", () => {
  const genInputNormal = { category: "motivation_fit", turnType: "normal", anchorSource: null, questionNumber: 1 };

  it("buildQuestionGenerationPrompt works identically with candidateSignals omitted, null, or malformed", () => {
    const withoutArg = buildQuestionGenerationPrompt(genInputNormal, { maxQuestions: 5 }, {});
    const withNull = buildQuestionGenerationPrompt(genInputNormal, { maxQuestions: 5 }, {}, null);
    const withGarbage = buildQuestionGenerationPrompt(genInputNormal, { maxQuestions: 5 }, {}, "not an object");
    expect(withoutArg.system).not.toMatch(/Candidate intelligence:/);
    expect(withNull.system).toBe(withoutArg.system);
    expect(withGarbage.system).toBe(withoutArg.system);
  });

  it("a fully empty candidate (buildCandidateSignals({})) never crashes prompt building for any turn type", () => {
    const signals = buildCandidateSignals({});
    for (const turnType of ["normal", "follow_up", "challenge_claim", "clarify"]) {
      expect(() => buildQuestionGenerationPrompt({ category: "motivation_fit", turnType, anchorSource: turnType === "normal" ? null : "previous_answer", questionNumber: 1 }, { maxQuestions: 5 }, {}, signals)).not.toThrow();
    }
  });

  it("STRUCTURAL: every Candidate Intelligence call site in analyseAndPlan/submitAnswer is wrapped in a non-fatal try/catch", () => {
    const seedingBlock = ANALYSE_AND_PLAN_SRC.slice(ANALYSE_AND_PLAN_SRC.indexOf("Phase 2D: seed newly-extracted CV claims"), ANALYSE_AND_PLAN_SRC.indexOf("Phase 2D: for the adaptive"));
    expect(seedingBlock).toMatch(/try\s*\{/);
    expect(seedingBlock).toMatch(/catch \(ciErr\)/);

    const mergeBlock = ANALYSE_AND_PLAN_SRC.slice(ANALYSE_AND_PLAN_SRC.indexOf("Phase 2D: for the adaptive"), ANALYSE_AND_PLAN_SRC.indexOf("setProfile(result);"));
    expect(mergeBlock).toMatch(/try\s*\{/);
    expect(mergeBlock).toMatch(/catch \(ciErr\)/);

    const matchBlock = SUBMIT_ANSWER_SRC.slice(SUBMIT_ANSWER_SRC.indexOf("Phase 2D: if this turn is a challenge_claim"), SUBMIT_ANSWER_SRC.indexOf("PERSIST ANSWER"));
    expect(matchBlock).toMatch(/try\s*\{/);
    expect(matchBlock).toMatch(/catch \(ciErr\)/);

    const updateBlock = SUBMIT_ANSWER_SRC.slice(SUBMIT_ANSWER_SRC.indexOf("Phase 2D: if the question just answered"), SUBMIT_ANSWER_SRC.indexOf("const newTranscript"));
    expect(updateBlock).toMatch(/try\s*\{/);
    expect(updateBlock).toMatch(/catch \(ciErr\)/);
  });

  it("STRUCTURAL: a Candidate Intelligence failure never touches setError/setScreen — it only console.errors and continues", () => {
    const seedingBlock = ANALYSE_AND_PLAN_SRC.slice(ANALYSE_AND_PLAN_SRC.indexOf("Phase 2D: seed newly-extracted CV claims"), ANALYSE_AND_PLAN_SRC.indexOf("setProfile(result);"));
    expect(seedingBlock).not.toMatch(/setError\(/);
    expect(seedingBlock).not.toMatch(/setScreen\(/);
  });
});

/* ============================== Isolation ============================== */
describe("existing batch pipeline and Assessment Centre remain unaffected (STRUCTURAL)", () => {
  it("dbInsertQuestionBatch / generateQuestionBatch / buildQuestionBatchPrompt contain no candidate-intelligence references", () => {
    const batchStart = SOURCE.indexOf("async function dbInsertQuestionBatch(");
    const batchEnd = SOURCE.indexOf("async function dbInsertAnswerOnly(");
    const batchBlock = SOURCE.slice(batchStart, batchEnd);
    expect(batchBlock).not.toMatch(/candidateIntelligence|candidateClaims|mergeProbeAreasForInterview|dedupeNewClaims/i);
  });

  it("Assessment Centre's functions contain no candidate-intelligence references", () => {
    const acBlock = SOURCE.slice(
      SOURCE.indexOf("/* ---------------- ASSESSMENT CENTRE ---------------- */"),
      SOURCE.indexOf("/* ---------------- DERIVED VALUES ---------------- */")
    );
    expect(acBlock).not.toMatch(/candidateIntelligence|candidateClaims|mergeProbeAreasForInterview|dedupeNewClaims/i);
  });

  it("candidateIntelligence.js itself has no coupling to the batch pipeline or Assessment Centre", () => {
    const source = readFileSync(new URL("./candidateIntelligence.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/independent_batch|generateQuestionBatch|assessment|EXERCISE_TYPES/i);
  });
});

/* ============================== Cross-interview / persistence wiring ============================== */
describe("cross-interview wiring (STRUCTURAL + EXECUTABLE)", () => {
  it("STRUCTURAL: loadFullUserState fetches candidate_claims and builds candidateIntelligence from already-loaded memoryRows/dna — no second data source", () => {
    const loadBlock = extractFunctionSource("async function loadFullUserState(userId) {", "async function ");
    expect(loadBlock).toMatch(/dbSelect\("candidate_claims"/);
    expect(loadBlock).toMatch(/buildCandidateSignals\(\{ dna, memoryRows, claims: claimRows \}\)/);
  });

  it("STRUCTURAL: claim seeding is deduped against existing candidateClaims before insert — never blindly re-inserts", () => {
    // Phase 21: only CV-verified probe areas are seeded as candidate_claims, so
    // the dedupe input is now the filtered `cvVerifiedProbes` list rather than
    // the raw potential_probe_areas — still deduped against candidateClaims.
    expect(ANALYSE_AND_PLAN_SRC).toMatch(/const cvVerifiedProbes = arr\(result\.candidate_profile\.potential_probe_areas\)\s*\n?\s*\.filter\(\(p\) => p\?\.source === "cv" && p\?\.evidence_quote\)/);
    expect(ANALYSE_AND_PLAN_SRC).toMatch(/dedupeNewClaims\(candidateClaims, cvVerifiedProbes\)/);
  });

  it("EXECUTABLE: buildCandidateSignals over multiple interviews' worth of memory rows reflects accumulated evidence (what a later interview would consume)", () => {
    const signals = buildCandidateSignals({
      memoryRows: [
        { category: "behavioural_competency", competency: "leadership", score: 85, interview_id: "iv-1", created_at: "2026-01-01T00:00:00Z" },
        { category: "behavioural_competency", competency: "leadership", score: 80, interview_id: "iv-2", created_at: "2026-01-10T00:00:00Z" },
        { category: "behavioural_competency", competency: "leadership", score: 88, interview_id: "iv-3", created_at: "2026-01-20T00:00:00Z" },
      ],
    });
    expect(signals.categoryCoverage.behavioural_competency.status).toBe("demonstrated");
    expect(signals.categoryCoverage.behavioural_competency.interviewCount).toBe(3);
    // Not contaminated: a category never touched stays "unknown", not inferred from unrelated evidence.
    expect(signals.categoryCoverage.commercial_awareness.status).toBe("unknown");
  });
});
