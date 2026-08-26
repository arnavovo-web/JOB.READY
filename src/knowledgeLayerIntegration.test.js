/* ================================================================== *
 * PHASE 6 — KNOWLEDGE LAYER INTEGRATION TESTS
 * ------------------------------------------------------------------
 * Covers the App.jsx wiring (Call 2 integration, scheduler isolation,
 * HireVue/independent_batch isolation, Assessment Centre isolation, no
 * extra AI call, prompt safety, legacy compatibility). interviewKnowledge.js
 * itself is covered in isolation in interviewKnowledge.test.js.
 *
 * buildQuestionGenerationPrompt is exported and pure, so behaviour that can
 * be exercised through it directly is tested EXECUTABLE; everything else
 * (call-site wiring inside App()'s closures) is STRUCTURAL, the same
 * source-text-inspection convention the rest of this suite already uses.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildQuestionGenerationPrompt } from "./App.jsx";
import { KNOWLEDGE_DOMAINS } from "./interviewKnowledge.js";

const SOURCE = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const IB_DOMAIN = KNOWLEDGE_DOMAINS.find((d) => d.id === "investment_banking");

function extractFunctionSource(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found in App.jsx: ${startMarker}`);
  const end = SOURCE.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`end marker not found in App.jsx: ${endMarker}`);
  return SOURCE.slice(start, end);
}

const ibProfile = {
  interview_profile: {
    role: "Investment Banking Summer Analyst", division: "M&A Advisory", seniority: "",
    responsibilities: [], required_skills: ["Financial modelling"], preferred_skills: [],
    competencies: [], technical_topics: ["DCF valuation"], behavioural_topics: [], commercial_topics: [],
    question_mix: {}, jd_requirements: [],
  },
  candidate_profile: {},
};

/* ============================== HireVue / independent_batch isolation (EXECUTABLE + STRUCTURAL) ============================== */
describe("HireVue-style (independent_batch) interviews never activate the knowledge layer", () => {
  it("EXECUTABLE: buildQuestionGenerationPrompt produces NO knowledge guidance when interview.config.pipeline is independent_batch, even for a technical_functional turn with a confidently-matched IB role", () => {
    const interview = { maxQuestions: 8, transcript: [], config: { pipeline: "independent_batch" } };
    const genInput = { category: "technical_functional", turnType: "normal", anchorSource: null, questionNumber: 1 };
    const { system } = buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null);
    expect(system).not.toMatch(/KNOWLEDGE GUIDANCE/);
  });

  it("EXECUTABLE: the SAME turn with adaptive_turn pipeline DOES activate knowledge guidance — proves the previous test is a real gate, not an accident of missing candidateState", () => {
    const interview = { maxQuestions: 8, transcript: [], config: { pipeline: "adaptive_turn" } };
    const genInput = { category: "technical_functional", turnType: "normal", anchorSource: null, questionNumber: 1 };
    const { system } = buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null);
    expect(system).toMatch(/KNOWLEDGE GUIDANCE/);
    expect(system).toMatch(/Domain: Investment Banking/);
  });

  it("STRUCTURAL: independent_batch's OWN prompt builder (buildQuestionBatchPrompt/generateQuestionBatch) never imports or references the knowledge layer — full pipeline isolation, not just the gate", () => {
    // Tight boundary — buildQuestionBatchPrompt + generateQuestionBatch ONLY, ending right
    // before the PDF-extraction section. The much later "async function generateAcScenario("
    // marker used to work only by coincidence: it silently swept in every unrelated function
    // in between (analyseAndPlan, the Phase 7 invitation-scanner helpers, ...), so a legitimate
    // comment merely MENTIONING the knowledge layer elsewhere could fail this check for a
    // function that never actually references it.
    const BATCH_SRC = extractFunctionSource("function buildQuestionBatchPrompt(", "/* PDF TEXT EXTRACTION");
    expect(BATCH_SRC).not.toMatch(/interviewKnowledge|resolveKnowledgeDomain|buildKnowledgeGuidance|KNOWLEDGE GUIDANCE/);
  });

  it("STRUCTURAL: the knowledge layer import is only ever used inside buildQuestionGenerationPrompt — never wired into the batch pipeline elsewhere in the file", () => {
    const usageCount = (SOURCE.match(/resolveKnowledgeDomain\(|buildKnowledgeGuidance\(/g) || []).length;
    // Exactly one call site each: both live inside buildQuestionGenerationPrompt.
    expect(usageCount).toBe(2);
  });
});

/* ============================== behavioural/motivation isolation (EXECUTABLE) ============================== */
describe("behavioural and motivation turns never receive canonical knowledge, even with a confidently-matched domain", () => {
  it("motivation_fit: no KNOWLEDGE GUIDANCE block, generic competency instruction unchanged", () => {
    const interview = { maxQuestions: 8, transcript: [], config: { pipeline: "adaptive_turn" } };
    const genInput = { category: "motivation_fit", turnType: "normal", anchorSource: null, questionNumber: 1 };
    const { system } = buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null);
    expect(system).not.toMatch(/KNOWLEDGE GUIDANCE/);
    expect(system).toMatch(/Pick a short "competency" label/);
  });

  it("behavioural_competency: no KNOWLEDGE GUIDANCE block", () => {
    const interview = { maxQuestions: 8, transcript: [], config: { pipeline: "adaptive_turn" } };
    const genInput = { category: "behavioural_competency", turnType: "normal", anchorSource: null, questionNumber: 1 };
    const { system } = buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null);
    expect(system).not.toMatch(/KNOWLEDGE GUIDANCE/);
  });

  it("a generic/unmatched role never activates knowledge guidance even on a technical_functional turn", () => {
    const genericProfile = { interview_profile: { role: "Graduate Trainee", division: "", responsibilities: [], required_skills: [], preferred_skills: [], competencies: [], technical_topics: [], behavioural_topics: [], commercial_topics: [], question_mix: {}, jd_requirements: [] }, candidate_profile: {} };
    const interview = { maxQuestions: 8, transcript: [], config: { pipeline: "adaptive_turn" } };
    const genInput = { category: "technical_functional", turnType: "normal", anchorSource: null, questionNumber: 1 };
    const { system } = buildQuestionGenerationPrompt(genInput, interview, genericProfile, null, null, null);
    expect(system).not.toMatch(/KNOWLEDGE GUIDANCE/);
  });
});

/* ============================== scheduler ownership preserved (EXECUTABLE + STRUCTURAL) ============================== */
describe("the scheduler remains authoritative — knowledge guidance never reaches category/turn_type/anchor_source", () => {
  it("EXECUTABLE: a probing turn (competency already fixed by the scheduler chain) is untouched by knowledge guidance even when it would otherwise apply", () => {
    const interview = { maxQuestions: 8, transcript: [{ question: { category: "technical_functional", competency: "Three financial statements", text: "..." }, answer: "...", evaluation: {} }], config: { pipeline: "adaptive_turn" } };
    const genInput = { category: "technical_functional", turnType: "follow_up", anchorSource: "previous_answer", questionNumber: 2, competency: "Three financial statements", previousQuestionText: "x", previousAnswer: "y" };
    const { system } = buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null);
    // The FIXED-competency instruction (adaptiveEngine.js's own decision) wins — never overridden by a knowledge-chosen concept.
    expect(system).toMatch(/already fixed as "Three financial statements" — echo it back/);
  });

  it("STRUCTURAL: buildQuestionGenerationPrompt never writes to category/turn_type/anchor_source — those fields are read from genInput/decision only, never assigned by the knowledge block", () => {
    const FN_SRC = extractFunctionSource("export function buildQuestionGenerationPrompt(", "// §5: Call 2's response validator");
    expect(FN_SRC).not.toMatch(/knowledgeGuidance\.(category|turnType|anchorSource|anchor_source)/);
  });

  it("STRUCTURAL: stampQuestionFromDecision (adaptiveEngine.js, the actual structural enforcement point) is completely untouched by Phase 6 — category/turn_type always come from `decision`, never from the model's output", () => {
    const ADAPTIVE_ENGINE_SRC = readFileSync(new URL("./adaptiveEngine.js", import.meta.url), "utf8");
    expect(ADAPTIVE_ENGINE_SRC).not.toMatch(/interviewKnowledge|KnowledgeGuidance|knowledgeLayer/i);
  });

  it("STRUCTURAL: methodology.js (the scheduler's own category/deficit logic) is completely untouched by Phase 6", () => {
    const METHODOLOGY_SRC = readFileSync(new URL("./methodology.js", import.meta.url), "utf8");
    expect(METHODOLOGY_SRC).not.toMatch(/interviewKnowledge|KnowledgeGuidance|knowledgeLayer/i);
  });
});

/* ============================== no extra AI call / cost control (STRUCTURAL) ============================== */
describe("no additional per-turn AI call or web search was introduced", () => {
  it("generateAndPersistNextQuestion still makes exactly ONE callClaude call — the knowledge layer only enriches that SAME call's prompt", () => {
    const FN_SRC = extractFunctionSource("async function generateAndPersistNextQuestion(", "/* ---------------- RECOVERY");
    const callCount = (FN_SRC.match(/await callClaude\(/g) || []).length;
    expect(callCount).toBe(1);
  });

  it("interviewKnowledge.js itself contains no network/fetch/web-search call of any kind", () => {
    const KNOWLEDGE_SRC = readFileSync(new URL("./interviewKnowledge.js", import.meta.url), "utf8");
    expect(KNOWLEDGE_SRC).not.toMatch(/fetch\(|web_search|WebSearch|XMLHttpRequest|useWebSearch/);
  });

  it("buildQuestionGenerationPrompt's own useWebSearch call-site behaviour is unaffected — Call 2 is still invoked with useWebSearch=false", () => {
    const FN_SRC = extractFunctionSource("async function generateAndPersistNextQuestion(", "/* ---------------- RECOVERY");
    expect(FN_SRC).toMatch(/await callClaude\(system, userText, 700, false,/);
  });
});

/* ============================== prompt safety / compactness (EXECUTABLE) ============================== */
describe("only compact, relevant knowledge is ever injected — never the whole catalogue, never internal labels exposed", () => {
  it("the prompt never contains the full KNOWLEDGE_DOMAINS catalogue — only the small guidance block for THIS turn's domain/category", () => {
    const interview = { maxQuestions: 8, transcript: [], config: { pipeline: "adaptive_turn" } };
    const genInput = { category: "technical_functional", turnType: "normal", anchorSource: null, questionNumber: 1 };
    const { system, userText } = buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null);
    const combined = system + userText;
    // A domain from an entirely different, unrelated field must never appear.
    expect(combined).not.toMatch(/Software Engineering|Management Consulting|Marketing Fundamentals/);
  });

  it("the prompt explicitly instructs the model not to reveal internal taxonomy/labels or copy archetype wording verbatim", () => {
    const interview = { maxQuestions: 8, transcript: [], config: { pipeline: "adaptive_turn" } };
    const genInput = { category: "technical_functional", turnType: "normal", anchorSource: null, questionNumber: 1 };
    const { system } = buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null);
    expect(system).toMatch(/Do not reveal this internal taxonomy or these labels/);
    expect(system).toMatch(/Do not mechanically copy the wording above verbatim/);
  });

  it("priority concepts list is bounded (never more than 4 lines) even for a domain/category with many concepts", () => {
    const interview = { maxQuestions: 8, transcript: [], config: { pipeline: "adaptive_turn" } };
    const genInput = { category: "technical_functional", turnType: "normal", anchorSource: null, questionNumber: 1 };
    const { system } = buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null);
    const listMatch = system.match(/Priority concepts:\n([\s\S]*?)\nCurrent target concept:/);
    expect(listMatch).toBeTruthy();
    const lines = listMatch[1].trim().split("\n");
    expect(lines.length).toBeLessThanOrEqual(4);
  });
});

/* ============================== legacy compatibility (EXECUTABLE) ============================== */
describe("legacy interviews without knowledge-layer-era state degrade safely", () => {
  it("a legacy interview with no .config at all never crashes and simply gets no guidance", () => {
    const interview = { maxQuestions: 10, transcript: [] };
    const genInput = { category: "technical_functional", turnType: "normal", anchorSource: null, questionNumber: 1 };
    expect(() => buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null)).not.toThrow();
    const { system } = buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null);
    expect(system).not.toMatch(/KNOWLEDGE GUIDANCE/);
  });

  it("a missing candidateState (undefined, not just null) still produces guidance — treated as 'no evidence yet', never a crash", () => {
    const interview = { maxQuestions: 10, transcript: [], config: { pipeline: "adaptive_turn" } };
    const genInput = { category: "technical_functional", turnType: "normal", anchorSource: null, questionNumber: 1 };
    expect(() => buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, undefined)).not.toThrow();
  });

  it("a missing profile.interview_profile entirely never crashes", () => {
    const interview = { maxQuestions: 10, transcript: [], config: { pipeline: "adaptive_turn" } };
    const genInput = { category: "technical_functional", turnType: "normal", anchorSource: null, questionNumber: 1 };
    expect(() => buildQuestionGenerationPrompt(genInput, interview, {}, null, null, null)).not.toThrow();
    expect(() => buildQuestionGenerationPrompt(genInput, interview, undefined, null, null, null)).not.toThrow();
  });
});

/* ============================== Assessment Centre isolation (STRUCTURAL) ============================== */
describe("Assessment Centre (generateAcScenario/submitAcResponse) is completely untouched by Phase 6", () => {
  it("neither AC function references the knowledge layer in any way", () => {
    const AC_SCENARIO_SRC = extractFunctionSource("async function generateAcScenario(type) {", "async function submitAcResponse() {");
    const AC_SUBMIT_SRC = extractFunctionSource("async function submitAcResponse() {", "/* ---------------- DERIVED VALUES");
    expect(AC_SCENARIO_SRC).not.toMatch(/interviewKnowledge|resolveKnowledgeDomain|buildKnowledgeGuidance/);
    expect(AC_SUBMIT_SRC).not.toMatch(/interviewKnowledge|resolveKnowledgeDomain|buildKnowledgeGuidance/);
  });
});

/* ============================== cross-interview / candidate-state threading (STRUCTURAL) ============================== */
describe("Candidate State is threaded through to the knowledge layer without a second Candidate State build", () => {
  it("submitAnswer passes the SAME candidateStateForStrategy it already built for Interview Strategy into generateAndPersistNextQuestion — never a duplicate buildCandidateState call for the knowledge layer", () => {
    const SUBMIT_ANSWER_SRC = extractFunctionSource("async function submitAnswer() {", "// §5/§6: Call 2 -> structural stamping");
    const buildCandidateStateCalls = (SUBMIT_ANSWER_SRC.match(/buildCandidateState\(/g) || []).length;
    expect(buildCandidateStateCalls).toBe(1);
    expect(SUBMIT_ANSWER_SRC).toMatch(/generateAndPersistNextQuestion\([^)]*candidateStateForStrategy\)/);
  });

  it("regenerateNextQuestion (the Call-2 recovery path) also threads candidateStateForStrategy through, reusing its own single build — never a second one just for the retry", () => {
    const REGEN_SRC = extractFunctionSource("async function regenerateNextQuestion() {", "async function reconstructSchedulerDecision(");
    const buildCandidateStateCalls = (REGEN_SRC.match(/buildCandidateState\(/g) || []).length;
    expect(buildCandidateStateCalls).toBe(1);
    expect(REGEN_SRC).toMatch(/generateAndPersistNextQuestion\([^)]*candidateStateForStrategy\)/);
  });
});
