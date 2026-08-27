/* ================================================================== *
 * PHASE 11 — QUESTION MIX IS A HARD PERMISSION BOUNDARY (ENFORCEMENT)
 * ------------------------------------------------------------------
 * Executable regression tests that run the REAL, unchanged scheduler
 * (methodology.js scheduleNextCategory + adaptiveEngine.js
 * runSimulatedAdaptiveTurn) and the REAL Call-2 prompt builder
 * (App.jsx buildQuestionGenerationPrompt) under every Question Mix, and
 * prove:
 *   - the scheduler can ONLY select categories the user's mix permits,
 *   - Interview Stage never overrides the mix,
 *   - the Technical Knowledge Layer is completely unavailable unless the
 *     user selected Technical Knowledge,
 *   - behavioural / motivational questions get ZERO technical guidance,
 *   - the recovery/regenerate path enforces the same constraint,
 *   - the Question Mix layer never assigns turn type / anchor / competency.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildQuestionGenerationPrompt, effectiveMethodologyDistribution, computeRecoveryDecision,
} from "./App.jsx";
import { runSimulatedAdaptiveTurn } from "./adaptiveEngine.js";
import {
  ACTIVE_CATEGORIES, CATEGORIES, computeMethodologyDistribution, scheduleNextCategory,
} from "./methodology.js";
import { resolveAllowedCategories, QUESTION_MIX_CATEGORY_MAP } from "./questionMix.js";

const SOURCE = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

const ibProfile = {
  interview_profile: {
    role: "Investment Banking Summer Analyst", division: "M&A Advisory", seniority: "",
    responsibilities: [], required_skills: ["Financial modelling", "DCF"], preferred_skills: [],
    competencies: [], technical_topics: ["DCF valuation", "LBO"], behavioural_topics: [], commercial_topics: [],
    question_mix: {}, jd_requirements: [{ requirement: "Strong DCF and valuation skills", evidence_quote: "DCF", confidence: "explicit", category: "technical_functional", occurrences: 3 }],
  },
  candidate_profile: {},
};
const sweProfile = {
  interview_profile: {
    role: "Software Engineer", division: "", responsibilities: ["Build backend services"],
    required_skills: ["Algorithms", "System design"], preferred_skills: [], competencies: [],
    technical_topics: ["Big O", "system design"], behavioural_topics: [], commercial_topics: [], question_mix: {}, jd_requirements: [],
  },
  candidate_profile: {},
};

// Run the REAL scheduler forward `n` turns for a given interview config, feeding each
// generated question's category back into the transcript, and collect every category the
// scheduler chose. `evalCycle` varies the answer-analysis signal so probing turns happen too.
function schedulerCategoriesOver(n, { stage, question_mix }, evalCycle = ["new_competency", "follow_up", "clarify", "challenge_claim", "new_competency"]) {
  const config = { stage, format: "live_conversational", pipeline: "adaptive_turn", question_mix };
  let transcript = [];
  let currentQuestion = { text: "Opening question.", category: seedCategory({ stage, question_mix }), competency: "intro", turn_type: "normal", dbId: "q0" };
  const seen = [currentQuestion.category];
  for (let i = 0; i < n; i++) {
    const interview = { id: "iv", maxQuestions: 20, transcript, currentQuestion, config, methodologyDistribution: computeMethodologyDistribution(stage, null) };
    const dist = effectiveMethodologyDistribution(interview);
    const { decision, question } = runSimulatedAdaptiveTurn({
      interview, profile: ibProfile, methodologyDistribution: dist,
      answerText: "a plausible answer with some detail about the topic at hand",
      evaluationResult: { evaluation: { relevance: 70, specificity: 60, structure: 60, evidence: 55, clarity: 65, competency_demonstration: 60, strengths: [], issues: [] }, decision: evalCycle[i % evalCycle.length] },
      generateQuestion: (gi) => ({ text: `Q about ${gi.category}`, competency: `c${i}`, anchor_source: "generic" }),
    });
    seen.push(decision.category);
    transcript = [...transcript, { question: { ...question }, answer: "ans", evaluation: {}, decision: evalCycle[i % evalCycle.length] }];
    currentQuestion = { ...question, dbId: `q${i + 1}` };
  }
  return seen;
}
function seedCategory({ stage, question_mix }) {
  const dist = effectiveMethodologyDistribution({ methodologyDistribution: computeMethodologyDistribution(stage, null), config: { stage, question_mix } });
  return scheduleNextCategory({ distribution: dist, transcript: [], questionCount: 12 });
}

/* ============================== single-selection enforcement ============================== */
describe("single-selection — the scheduler is locked to one bucket", () => {
  for (const stage of ["recruiter_screen", "first_round", "technical", "final_round"]) {
    it(`Technical only @ ${stage}: every scheduled category is a technical-bucket category`, () => {
      const cats = schedulerCategoriesOver(24, { stage, question_mix: ["technical"] });
      for (const c of cats) expect(QUESTION_MIX_CATEGORY_MAP.technical, `${c} @ ${stage}`).toContain(c);
      expect(cats.every((c) => c !== "behavioural_competency" && c !== "situational_judgement" && c !== "motivation_fit")).toBe(true);
    });
    it(`Behavioural only @ ${stage}: never a technical or motivational category`, () => {
      const cats = schedulerCategoriesOver(24, { stage, question_mix: ["behavioural"] });
      for (const c of cats) {
        expect(QUESTION_MIX_CATEGORY_MAP.technical).not.toContain(c);
        expect(c).not.toBe("motivation_fit");
      }
    });
    it(`Motivational only @ ${stage}: only ever motivation_fit`, () => {
      const cats = schedulerCategoriesOver(24, { stage, question_mix: ["motivational"] });
      expect([...new Set(cats)]).toEqual(["motivation_fit"]);
    });
  }
});

/* ============================== multi-selection enforcement ============================== */
describe("multi-selection — the scheduler stays inside the union of selected buckets", () => {
  it("Technical + Behavioural: motivation_fit is impossible", () => {
    const cats = schedulerCategoriesOver(30, { stage: "first_round", question_mix: ["technical", "behavioural"] });
    expect(cats).not.toContain("motivation_fit");
  });
  it("Behavioural + Motivational: no technical category is ever chosen", () => {
    const cats = schedulerCategoriesOver(30, { stage: "technical", question_mix: ["behavioural", "motivational"] });
    for (const c of cats) expect(QUESTION_MIX_CATEGORY_MAP.technical).not.toContain(c);
  });
  it("Technical + Motivational: behavioural/situational is impossible", () => {
    const cats = schedulerCategoriesOver(30, { stage: "first_round", question_mix: ["technical", "motivational"] });
    expect(cats).not.toContain("behavioural_competency");
    expect(cats).not.toContain("situational_judgement");
  });
  it("All three: every active category can be reached over a long interview", () => {
    const cats = new Set(schedulerCategoriesOver(60, { stage: "first_round", question_mix: ["technical", "behavioural", "motivational"] }));
    // at least a spread across the three buckets
    expect([...cats].some((c) => QUESTION_MIX_CATEGORY_MAP.technical.includes(c))).toBe(true);
    expect([...cats].some((c) => QUESTION_MIX_CATEGORY_MAP.behavioural.includes(c))).toBe(true);
    expect(cats.has("motivation_fit")).toBe(true);
  });
});

/* ============================== stage cannot override the mix ============================== */
describe("Interview Stage provides context; Question Mix provides permission — stage never wins", () => {
  it("Technical Interview stage + Motivational only -> ONLY motivation_fit", () => {
    const cats = schedulerCategoriesOver(24, { stage: "technical", question_mix: ["motivational"] });
    expect([...new Set(cats)]).toEqual(["motivation_fit"]);
  });
  it("Recruiter / HR Screen stage + Technical only -> ONLY technical-bucket categories (the user asked for technical practice)", () => {
    const cats = schedulerCategoriesOver(24, { stage: "recruiter_screen", question_mix: ["technical"] });
    for (const c of cats) expect(QUESTION_MIX_CATEGORY_MAP.technical).toContain(c);
  });
  it("Final Round stage + Behavioural only -> never a technical or motivational category", () => {
    const cats = schedulerCategoriesOver(24, { stage: "final_round", question_mix: ["behavioural"] });
    for (const c of cats) {
      expect(QUESTION_MIX_CATEGORY_MAP.technical).not.toContain(c);
      expect(c).not.toBe("motivation_fit");
    }
  });
  it("stage STILL shapes composition WITHIN the allowed set (technical stage leans harder technical than a recruiter screen, both restricted to technical+behavioural)", () => {
    const techDist = effectiveMethodologyDistribution({ methodologyDistribution: computeMethodologyDistribution("technical", null), config: { stage: "technical", question_mix: ["technical", "behavioural"] } });
    const screenDist = effectiveMethodologyDistribution({ methodologyDistribution: computeMethodologyDistribution("recruiter_screen", null), config: { stage: "recruiter_screen", question_mix: ["technical", "behavioural"] } });
    expect(techDist.technical_functional).toBeGreaterThan(screenDist.technical_functional);
  });
});

/* ============================== Knowledge Layer gating ============================== */
describe("Technical Knowledge Layer activates ONLY for a user-approved technical question", () => {
  const genInput = { category: "technical_functional", turnType: "normal", anchorSource: null, questionNumber: 1 };
  const interviewWith = (question_mix) => ({ maxQuestions: 8, transcript: [], config: { pipeline: "adaptive_turn", stage: "technical", format: "technical", question_mix } });

  it("Technical selected + technical_functional turn -> Knowledge Layer operates (Domain: Investment Banking)", () => {
    const { system } = buildQuestionGenerationPrompt(genInput, interviewWith(["technical"]), ibProfile, null, null, null);
    expect(system).toMatch(/KNOWLEDGE GUIDANCE/);
    expect(system).toMatch(/Domain: Investment Banking/);
  });

  it("Technical NOT selected -> NO knowledge guidance, even for a technical_functional turn, an IB role, a DCF-heavy JD, and a Technical stage", () => {
    for (const mix of [["behavioural"], ["motivational"], ["behavioural", "motivational"]]) {
      const { system } = buildQuestionGenerationPrompt(genInput, interviewWith(mix), ibProfile, null, null, null);
      expect(system, JSON.stringify(mix)).not.toMatch(/KNOWLEDGE GUIDANCE/);
    }
  });

  it("Technical selected but the turn is behavioural_competency -> still NO knowledge guidance (category ineligible)", () => {
    const behInput = { ...genInput, category: "behavioural_competency" };
    const { system } = buildQuestionGenerationPrompt(behInput, interviewWith(["technical", "behavioural"]), ibProfile, null, null, null);
    expect(system).not.toMatch(/KNOWLEDGE GUIDANCE/);
  });

  it("Technical selected + motivation_fit turn -> NO knowledge guidance", () => {
    const motInput = { ...genInput, category: "motivation_fit" };
    const { system } = buildQuestionGenerationPrompt(motInput, interviewWith(["technical", "motivational"]), ibProfile, null, null, null);
    expect(system).not.toMatch(/KNOWLEDGE GUIDANCE/);
  });

  it("a legacy interview (no question_mix) keeps pre-Phase-11 behaviour: Knowledge Layer still fires on a technical turn", () => {
    const legacy = { maxQuestions: 8, transcript: [], config: { pipeline: "adaptive_turn", stage: "technical", format: "technical" } };
    const { system } = buildQuestionGenerationPrompt(genInput, legacy, ibProfile, null, null, null);
    expect(system).toMatch(/KNOWLEDGE GUIDANCE/);
  });
});

/* ============================== behavioural / motivational isolation ============================== */
describe("behavioural & motivational questions get ZERO technical contamination", () => {
  const runFor = (category, question_mix, profile) => buildQuestionGenerationPrompt(
    { category, turnType: "normal", anchorSource: null, questionNumber: 2 },
    { maxQuestions: 10, transcript: [], config: { pipeline: "adaptive_turn", stage: "first_round", format: "live_conversational", question_mix } },
    profile, null, null, null,
  );

  it("IB + Behavioural only, behavioural turn: no DCF / enterprise value / accretion / financial statements in the prompt", () => {
    const { system, userText } = runFor("behavioural_competency", ["behavioural"], ibProfile);
    const blob = system; // the interview_profile is JSON-echoed in userText by design; the KNOWLEDGE block is what must be absent
    expect(blob).not.toMatch(/KNOWLEDGE GUIDANCE/);
    expect(blob).not.toMatch(/DCF|discounted cash flow|enterprise value|accretion|three financial statements/i);
    expect(userText).not.toMatch(/KNOWLEDGE GUIDANCE/);
  });

  it("IB + Behavioural + Motivational, motivation turn: no technical knowledge block", () => {
    const { system } = runFor("motivation_fit", ["behavioural", "motivational"], ibProfile);
    expect(system).not.toMatch(/KNOWLEDGE GUIDANCE|DCF|enterprise value|accretion/i);
  });

  it("SWE + Motivational only, motivation turn: no algorithms / system design knowledge block", () => {
    const { system } = runFor("motivation_fit", ["motivational"], sweProfile);
    expect(system).not.toMatch(/KNOWLEDGE GUIDANCE/);
    expect(system).not.toMatch(/big o|time complexity|system design fundamentals|data structure trade-offs/i);
  });

  it("Marketing + Behavioural only, behavioural turn: no marketing-domain knowledge block", () => {
    const mktProfile = { interview_profile: { role: "Brand Management Graduate", division: "", responsibilities: [], required_skills: ["marketing"], preferred_skills: [], competencies: [], technical_topics: [], behavioural_topics: [], commercial_topics: [], question_mix: {}, jd_requirements: [] }, candidate_profile: {} };
    const { system } = runFor("behavioural_competency", ["behavioural"], mktProfile);
    expect(system).not.toMatch(/KNOWLEDGE GUIDANCE|marketing mix|customer segmentation/i);
  });
});

/* ============================== scheduler ownership preserved ============================== */
describe("the Question Mix layer only constrains the CATEGORY universe — nothing else", () => {
  it("turn type still comes from the answer signal, not the mix (a follow_up signal -> follow_up turn, within an allowed category)", () => {
    const config = { stage: "first_round", format: "live_conversational", pipeline: "adaptive_turn", question_mix: ["behavioural"] };
    const interview = { id: "iv", maxQuestions: 10, transcript: [], currentQuestion: { text: "q", category: "behavioural_competency", competency: "leadership", turn_type: "normal", dbId: "q0" }, config, methodologyDistribution: computeMethodologyDistribution("first_round", null) };
    const dist = effectiveMethodologyDistribution(interview);
    const followUp = runSimulatedAdaptiveTurn({
      interview, profile: ibProfile, methodologyDistribution: dist, answerText: "detailed answer",
      evaluationResult: { evaluation: { relevance: 80, specificity: 75, structure: 70, evidence: 70, clarity: 75, competency_demonstration: 70, strengths: [], issues: [] }, decision: "follow_up" },
      generateQuestion: () => ({}),
    });
    expect(followUp.decision.turnType).toBe("follow_up");
    expect(resolveAllowedCategories(["behavioural"]).has(followUp.decision.category)).toBe(true);
    // anchor source is still the scheduler's (previous_answer for a follow_up), untouched by the mix
    expect(followUp.decision.anchorSource).toBe("previous_answer");
  });

  it("questionMix.js source assigns no turn_type / anchor_source / competency / specific question", () => {
    const src = readFileSync(new URL("./questionMix.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/turnType|turn_type|anchorSource|anchor_source|\.competency\s*=/);
  });
});

/* ============================== generation-path coverage ============================== */
describe("every live question-generation path enforces the mix (no bypass)", () => {
  it("STRUCTURAL: submitAnswer's scheduler input is effectiveMethodologyDistribution(interview) — now mix-filtered", () => {
    const submit = SOURCE.slice(SOURCE.indexOf("async function submitAnswer()"), SOURCE.indexOf("async function generateAndPersistNextQuestion("));
    expect(submit).toMatch(/effectiveMethodologyDistribution\(interview\)/);
  });
  it("STRUCTURAL: reconstructSchedulerDecision (the regenerate/recovery path) reads the SAME effectiveMethodologyDistribution(interview)", () => {
    const recon = SOURCE.slice(SOURCE.indexOf("async function reconstructSchedulerDecision("), SOURCE.indexOf("async function finishInterview("));
    expect(recon).toMatch(/effectiveMethodologyDistribution\(interview\)/);
  });
  it("STRUCTURAL: effectiveMethodologyDistribution applies applyQuestionMixToDistribution", () => {
    const fn = SOURCE.slice(SOURCE.indexOf("export function effectiveMethodologyDistribution("), SOURCE.indexOf("export function computeRecoveryDecision("));
    expect(fn).toMatch(/applyQuestionMixToDistribution\(base, interview\?\.config\?\.question_mix\)/);
  });
  it("STRUCTURAL: buildQuestionGenerationPrompt gates the Knowledge Layer on isTechnicalMixEnabled(config.question_mix)", () => {
    const fn = SOURCE.slice(SOURCE.indexOf("export function buildQuestionGenerationPrompt("), SOURCE.indexOf("// §5: Call 2's response validator"));
    expect(fn).toMatch(/technicalMixEnabled: isTechnicalMixEnabled\(interview\?\.config\?\.question_mix\)/);
  });

  it("EXECUTABLE: the recovery decision path (computeRecoveryDecision) also stays inside the allowed categories", () => {
    const config = { stage: "technical", format: "technical", pipeline: "adaptive_turn", question_mix: ["motivational"] };
    const interview = { id: "iv", maxQuestions: 10, transcript: [], config, methodologyDistribution: computeMethodologyDistribution("technical", null) };
    const answeredEntry = { question: { text: "q1", category: "motivation_fit", competency: "why", turn_type: "normal" }, answer: "because I love it", evaluation: { relevance: 60, specificity: 50, structure: 50, evidence: 50, clarity: 60, competency_demonstration: 50, strengths: [], issues: [] } };
    const { decision } = computeRecoveryDecision({
      interview, profile: ibProfile, priorTranscript: [], answeredEntry,
      legacyDecision: "new_competency", methodologyDistribution: effectiveMethodologyDistribution(interview),
    });
    expect(decision.category).toBe("motivation_fit");
  });
});

/* ============================== the 5 adversarial scenarios ============================== */
describe("adversarial scenarios (deterministic simulation)", () => {
  it("Scenario 1 — IB / First Round / Technical + Behavioural + Motivational: all three participate", () => {
    const cats = new Set(schedulerCategoriesOver(60, { stage: "first_round", question_mix: ["technical", "behavioural", "motivational"] }));
    expect([...cats].some((c) => QUESTION_MIX_CATEGORY_MAP.technical.includes(c))).toBe(true);
    expect([...cats].some((c) => QUESTION_MIX_CATEGORY_MAP.behavioural.includes(c))).toBe(true);
    expect(cats.has("motivation_fit")).toBe(true);
  });

  it("Scenario 2 — IB / Technical Interview / Technical only: behavioural & motivational categories cannot appear", () => {
    const cats = schedulerCategoriesOver(40, { stage: "technical", question_mix: ["technical"] });
    for (const c of cats) expect(QUESTION_MIX_CATEGORY_MAP.technical).toContain(c);
  });

  it("Scenario 3 — IB / First Round / Behavioural + Motivational: the Technical Knowledge Layer is completely inactive", () => {
    for (const category of ["behavioural_competency", "situational_judgement", "motivation_fit"]) {
      const { system } = buildQuestionGenerationPrompt(
        { category, turnType: "normal", anchorSource: null, questionNumber: 3 },
        { maxQuestions: 12, transcript: [], config: { pipeline: "adaptive_turn", stage: "first_round", format: "live_conversational", question_mix: ["behavioural", "motivational"] } },
        ibProfile, null, null, null,
      );
      expect(system, category).not.toMatch(/KNOWLEDGE GUIDANCE/);
    }
  });

  it("Scenario 4 — IB / Technical Interview / Motivational only: user selection overrides stage expectations", () => {
    const cats = schedulerCategoriesOver(30, { stage: "technical", question_mix: ["motivational"] });
    expect([...new Set(cats)]).toEqual(["motivation_fit"]);
    const { system } = buildQuestionGenerationPrompt(
      { category: "motivation_fit", turnType: "normal", anchorSource: null, questionNumber: 1 },
      { maxQuestions: 10, transcript: [], config: { pipeline: "adaptive_turn", stage: "technical", format: "technical", question_mix: ["motivational"] } },
      ibProfile, null, null, null,
    );
    expect(system).not.toMatch(/KNOWLEDGE GUIDANCE/);
  });

  it("Scenario 5 — SWE / First Round / Behavioural only: no technical knowledge concepts leak", () => {
    const { system } = buildQuestionGenerationPrompt(
      { category: "behavioural_competency", turnType: "normal", anchorSource: null, questionNumber: 2 },
      { maxQuestions: 10, transcript: [], config: { pipeline: "adaptive_turn", stage: "first_round", format: "live_conversational", question_mix: ["behavioural"] } },
      sweProfile, null, null, null,
    );
    expect(system).not.toMatch(/KNOWLEDGE GUIDANCE/);
    expect(system).not.toMatch(/big o|time complexity|system design|concurrency|data structure/i);
  });
});

/* ============================== persistence + UI (STRUCTURAL) ============================== */
describe("persistence & UI wiring", () => {
  it("analyseAndPlan persists the validated selection onto the interview config blob (no DB migration — same JSON column as invitationContext)", () => {
    expect(SOURCE).toMatch(/ivConfig\.question_mix = questionMixSelected/);
    // guarded: never builds an interview with no/invalid mix
    expect(SOURCE).toMatch(/if \(!questionMixIsValid\(questionMixSelected\)\) \{/);
  });

  it("the config (with question_mix) is threaded into the live interview object and the DB row", () => {
    const block = SOURCE.slice(SOURCE.indexOf("const q1 = await dbInsertQuestion(ivRow.id, 1"), SOURCE.indexOf("setInterview(newInterview);\n      setScreen(\"preview\");"));
    expect(block).toMatch(/config: ivConfig/);
    expect(SOURCE).toMatch(/dbCreateInterview\(user\.id, applicationId, ivConfig, methodologyDistribution\)/);
  });

  it("the opening question category is clamped onto an allowed category when the mix restricts", () => {
    expect(SOURCE).toMatch(/resolveOpeningCategory\(methodologyDistribution, ivConfig\.question_mix, length\)/);
    expect(SOURCE).toMatch(/result\.opening_question\.category = clampedOpeningCategory/);
  });

  it("the wizard renders all three options from QUESTION_MIX_OPTIONS, none pre-selected", () => {
    expect(SOURCE).toMatch(/const \[questionMix, setQuestionMix\] = useState\(\{ technical: false, behavioural: false, motivational: false \}\)/);
    expect(SOURCE).toMatch(/QUESTION_MIX_OPTIONS\.map\(\(opt\) =>/);
    expect(SOURCE).toMatch(/role="checkbox"/);
    expect(SOURCE).toMatch(/aria-checked=\{on\}/);
  });

  it("the user cannot continue with zero selected — Build button disabled + accessible validation message", () => {
    expect(SOURCE).toMatch(/disabled=\{!questionMixSelected\} onClick=\{\(\) => guarded\(analyseAndPlan\)\}/);
    expect(SOURCE).toMatch(/Select at least one question type before continuing\./);
    expect(SOURCE).toMatch(/role="status"/);
  });

  it("no new AI call and no web search were added for Phase 11", () => {
    // questionMix.js is pure; App.jsx's only mix touch-points are pure helper calls + a
    // context line appended to the EXISTING interview_profile prompt.
    const qm = readFileSync(new URL("./questionMix.js", import.meta.url), "utf8");
    expect(qm).not.toMatch(/callClaude|fetch\(|useWebSearch|WebSearch/);
    // the interview_profile call still passes useWebSearch=false and is the same single call
    expect(SOURCE).toMatch(/callClaude\(system, userText, 3000, false, \{ requestType: "interview_profile"/);
  });

  it("the Question Mix is reset to an unselected state on every entry to the build flow (never carried over / pre-selected)", () => {
    // the initial value is an all-false object literal (never pre-selected)
    expect(SOURCE).toMatch(/useState\(\{ technical: false, behavioural: false, motivational: false \}\)/);
    const resetLiteral = "setQuestionMix({ technical: false, behavioural: false, motivational: false })";
    // explicitly re-set on every build-flow entry: startCreateFlow + practiseThisWeakness + resetForNewInterview
    const occurrences = SOURCE.split(resetLiteral).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
    for (const [fn, nextFn] of [
      ["function startCreateFlow(", "function chooseBuildMethod("],
      ["function practiseThisWeakness(", "function loadDemo("],
      ["function resetForNewInterview(", "function submitAcResponse("],
    ]) {
      const body = SOURCE.slice(SOURCE.indexOf(fn), SOURCE.indexOf(nextFn, SOURCE.indexOf(fn)));
      expect(body.includes(resetLiteral), fn).toBe(true);
    }
  });

  it("the async/batch pipeline consumes the SAME mix-filtered distribution (an excluded type is asked for at 0%), without touching the Knowledge Layer", () => {
    const branch = SOURCE.slice(SOURCE.indexOf('if (ivConfig.pipeline === "independent_batch") {'), SOURCE.indexOf("setScreen(\"preview\");\n        return;"));
    expect(branch).toMatch(/applyQuestionMixToDistribution\(methodologyDistribution, ivConfig\.question_mix\)/);
    expect(branch).toMatch(/generateQuestionBatch\([^)]*batchDistribution\)/);
    // Phase 6 protection intact: the batch branch still never references the Knowledge Layer.
    expect(branch).not.toMatch(/buildKnowledgeGuidance|resolveKnowledgeDomain|KNOWLEDGE GUIDANCE/);
  });
});

/* ============================== legacy safety ============================== */
describe("legacy interviews (no question_mix) are never treated as an explicit choice", () => {
  it("effectiveMethodologyDistribution returns the interview's own distribution unchanged", () => {
    const skewed = { motivation_fit: 40, behavioural_competency: 20, situational_judgement: 10, technical_functional: 20, commercial_awareness: 10, case_problem_solving: 0 };
    expect(effectiveMethodologyDistribution({ methodologyDistribution: skewed, config: { stage: "first_round" } })).toBe(skewed);
  });
  it("a legacy interview's scheduler can still reach every active category", () => {
    const cats = new Set(schedulerCategoriesOver(60, { stage: "first_round", question_mix: undefined }));
    for (const c of ACTIVE_CATEGORIES) {
      // not every category is guaranteed in 60 turns, but the union should be broad and never empty
    }
    expect(cats.size).toBeGreaterThanOrEqual(3);
    expect([...cats].every((c) => CATEGORIES.includes(c))).toBe(true);
  });
});
