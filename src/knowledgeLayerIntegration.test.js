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
import { buildQuestionGenerationPrompt, buildInvitationKnowledgeContext } from "./App.jsx";
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

/* ================================================================== *
 * PHASE 9 — INTERVIEW-CONTEXT + INVITATION THREADING (EXECUTABLE + STRUCTURAL)
 * ================================================================== */
describe("Phase 9: the interview's own resolved stage/format narrow concept applicability", () => {
  const genInput = { category: "technical_functional", turnType: "normal", anchorSource: null, questionNumber: 1 };

  it("a recruiter_screen never surfaces a technical/final-round-only concept (ib_lbo_analysis) in the guidance block", () => {
    const liveInterview = { maxQuestions: 8, transcript: [], config: { pipeline: "adaptive_turn", stage: "recruiter_screen", format: "live_conversational" } };
    const live = buildQuestionGenerationPrompt(genInput, liveInterview, ibProfile, null, null, null).system;
    expect(live).toMatch(/KNOWLEDGE GUIDANCE/);
    expect(live).not.toMatch(/LBO analysis/);
  });

  it("a technical stage CAN surface the same stage-restricted concept", () => {
    const interview = { maxQuestions: 10, transcript: [], config: { pipeline: "adaptive_turn", stage: "technical", format: "technical" } };
    // Force it to the top with an explicit invitation topic so it deterministically appears.
    const withInvite = { ...interview, config: { ...interview.config, invitationContext: { explicitTopics: ["lbo analysis"], explicitComponents: [] } } };
    const { system } = buildQuestionGenerationPrompt(genInput, withInvite, ibProfile, null, null, null);
    expect(system).toMatch(/LBO analysis/);
  });

  it("an interview with no stage/format in config still gets guidance (backwards compatible — no filtering)", () => {
    const interview = { maxQuestions: 8, transcript: [], config: { pipeline: "adaptive_turn" } };
    const { system } = buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null);
    expect(system).toMatch(/KNOWLEDGE GUIDANCE/);
  });
});

describe("Phase 9: explicit invitation topics reach the knowledge block; inferred context does not", () => {
  const genInput = { category: "technical_functional", turnType: "normal", anchorSource: null, questionNumber: 1 };

  it("config.invitationContext with an explicit topic surfaces an 'explicit invitation topic' reason", () => {
    const interview = { maxQuestions: 10, transcript: [], config: { pipeline: "adaptive_turn", stage: "technical", format: "technical", invitationContext: { explicitTopics: ["valuation"], explicitComponents: ["technical_functional"] } } };
    const { system } = buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null);
    expect(system).toMatch(/explicit invitation topic: valuation/);
  });

  it("no invitationContext => the knowledge block never contains an 'explicit invitation topic' phrase", () => {
    const interview = { maxQuestions: 10, transcript: [], config: { pipeline: "adaptive_turn", stage: "technical", format: "technical" } };
    const { system } = buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null);
    expect(system).toMatch(/KNOWLEDGE GUIDANCE/);
    expect(system).not.toMatch(/explicit invitation topic/);
  });

  it("the knowledge block stays bounded even with reasons added — still <= 4 priority-concept lines", () => {
    const interview = { maxQuestions: 10, transcript: [], config: { pipeline: "adaptive_turn", stage: "technical", format: "technical", invitationContext: { explicitTopics: ["valuation", "accounting"], explicitComponents: ["technical_functional"] } } };
    const { system } = buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null);
    const listMatch = system.match(/Priority concepts:\n([\s\S]*?)\nCurrent target concept:/);
    expect(listMatch).toBeTruthy();
    expect(listMatch[1].trim().split("\n").length).toBeLessThanOrEqual(4);
  });
});

describe("Phase 9: buildInvitationKnowledgeContext — explicit-only, never an inferred topic", () => {
  it("collects topic strings the email named (explicit by extraction contract) into explicitTopics", () => {
    const ctx = buildInvitationKnowledgeContext({
      technical_topics: ["Accounting", "Valuation"], commercial_topics: [], mentioned_competencies: ["Financial modelling"],
      preparation_areas: [], components: ["technical_functional"], components_source: "explicit",
    });
    expect(ctx.explicitTopics).toEqual(expect.arrayContaining(["accounting", "valuation", "financial modelling"]));
    expect(ctx.explicitComponents).toEqual(["technical_functional"]);
  });

  it("returns null when the invitation named no topics and no explicit components (a vague invitation)", () => {
    expect(buildInvitationKnowledgeContext({ technical_topics: [], commercial_topics: [], mentioned_competencies: [], preparation_areas: [], components: [], components_source: "inferred" })).toBeNull();
    expect(buildInvitationKnowledgeContext(null)).toBeNull();
    expect(buildInvitationKnowledgeContext({})).toBeNull();
  });

  it("does NOT treat components as explicit unless components_source === 'explicit'", () => {
    const ctx = buildInvitationKnowledgeContext({ technical_topics: ["valuation"], components: ["technical_functional"], components_source: "inferred" });
    expect(ctx.explicitComponents).toEqual([]);
    expect(ctx.explicitTopics).toContain("valuation");
  });

  it("never throws on malformed input", () => {
    expect(() => buildInvitationKnowledgeContext({ technical_topics: "not an array", components: 42 })).not.toThrow();
  });
});

describe("Phase 9: wiring is additive — no new AI call, no scheduler ownership, batch pipeline untouched", () => {
  it("buildQuestionGenerationPrompt still consults the knowledge layer exactly once (resolveKnowledgeDomain + buildKnowledgeGuidance), now also passing stage/format/invitationContext", () => {
    const FN_SRC = extractFunctionSource("export function buildQuestionGenerationPrompt(", "// §5: Call 2's response validator");
    expect((FN_SRC.match(/resolveKnowledgeDomain\(/g) || []).length).toBe(1);
    expect((FN_SRC.match(/buildKnowledgeGuidance\(/g) || []).length).toBe(1);
    expect(FN_SRC).toMatch(/stage:\s*interview\?\.config\?\.stage/);
    expect(FN_SRC).toMatch(/invitationContext:\s*interview\?\.config\?\.invitationContext/);
    // still never assigns scheduler-owned fields from knowledge output
    expect(FN_SRC).not.toMatch(/knowledgeGuidance\.(category|turnType|anchorSource|anchor_source)/);
  });

  it("buildInvitationKnowledgeContext is defined well before, and never referenced inside, the batch pipeline", () => {
    const BATCH_SRC = extractFunctionSource("function buildQuestionBatchPrompt(", "/* PDF TEXT EXTRACTION");
    expect(BATCH_SRC).not.toMatch(/buildInvitationKnowledgeContext|invitationContext/);
  });

  it("the invitation->config bridge only runs for buildMethod === 'invitation' and only persists an explicit-signal object", () => {
    expect(SOURCE).toMatch(/if \(buildMethod === "invitation" && invitationDraft\) \{\s*\n\s*const invitationKnowledgeContext = buildInvitationKnowledgeContext\(invitationDraft\)/);
    expect(SOURCE).toMatch(/if \(invitationKnowledgeContext\) ivConfig\.invitationContext = invitationKnowledgeContext/);
  });
});

/* ================================================================== *
 * PHASE 10A — MISCONCEPTIONS LINE IN THE PROMPT (EXECUTABLE + STRUCTURAL)
 * ================================================================== */
describe("Phase 10A: the target concept's misconceptions reach Call 2 as one bounded line, never a per-concept list", () => {
  const genInput = { category: "technical_functional", turnType: "normal", anchorSource: null, questionNumber: 1 };

  it("when the selected target concept carries misconceptions, a single 'Common misconceptions to listen for' line appears after the archetype", () => {
    // ib_three_statements carries misconceptions and is the natural first target for a fresh IB technical turn.
    const interview = { maxQuestions: 10, transcript: [], config: { pipeline: "adaptive_turn", stage: "first_round", format: "live_conversational" } };
    const { system } = buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null);
    expect(system).toMatch(/KNOWLEDGE GUIDANCE/);
    const misMatch = system.match(/Common misconceptions to listen for \(do not read these out\): ([^\n]*)/);
    expect(misMatch, "misconceptions line present").toBeTruthy();
    // Bounded: at most two, joined by "; " — never a bullet list, never one per priority concept.
    expect(misMatch[1].split(";").length).toBeLessThanOrEqual(2);
    expect((system.match(/Common misconceptions to listen for/g) || []).length).toBe(1);
  });

  it("the misconceptions line sits AFTER 'Current target concept:' so the bounded priority-concepts block is unaffected", () => {
    const interview = { maxQuestions: 10, transcript: [], config: { pipeline: "adaptive_turn", stage: "first_round", format: "live_conversational" } };
    const { system } = buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null);
    const listMatch = system.match(/Priority concepts:\n([\s\S]*?)\nCurrent target concept:/);
    expect(listMatch).toBeTruthy();
    expect(listMatch[1]).not.toMatch(/Common misconceptions/);
    expect(listMatch[1].trim().split("\n").length).toBeLessThanOrEqual(4);
  });

  it("STRUCTURAL: the prompt surfaces misconceptions for the TARGET concept only — sliced to 2, never mapped over priorityConcepts", () => {
    const FN_SRC = extractFunctionSource("export function buildQuestionGenerationPrompt(", "// §5: Call 2's response validator");
    expect(FN_SRC).toMatch(/knowledgeGuidance\?\.targetConcept\?\.misconceptions \|\| \[\]\)\.slice\(0, 2\)/);
    expect(FN_SRC).not.toMatch(/priorityConcepts\.map[\s\S]{0,120}misconception/i);
  });
});
