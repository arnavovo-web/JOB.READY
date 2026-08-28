/* ================================================================== *
 * PHASE 13A — APPLICATION INTELLIGENCE: INTEGRATION & ISOLATION TESTS
 * ------------------------------------------------------------------
 * EXECUTABLE where the pipe is a pure exported function
 * (validateProfile -> buildApplicationIntelligence, and the Knowledge
 * Layer gate); STRUCTURAL for the App() closures (analyseAndPlan /
 * loadFullUserState / openLesson) — same convention the rest of the
 * suite uses.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateProfile, buildQuestionGenerationPrompt } from "./App.jsx";
import { buildApplicationIntelligence, validateApplicationIntelligence } from "./applicationIntelligence.js";

const SOURCE = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
function fn(startMarker, endMarker) {
  const s = SOURCE.indexOf(startMarker);
  if (s === -1) throw new Error(`marker not found: ${startMarker}`);
  const e = SOURCE.indexOf(endMarker, s + startMarker.length);
  if (e === -1) throw new Error(`end marker not found: ${endMarker}`);
  return SOURCE.slice(s, e);
}
const ANALYSE_SRC = fn("async function analyseAndPlan() {", "function beginInterview()");
// Phase 16A: the SECOND — and only other — explicit, user-triggered call site.
// Standalone "Analyse this application" reuses the exact same interview_profile
// call + buildApplicationIntelligence + buildJdProfile, but builds NO interview.
const ANALYSE_APP_ONLY_SRC = fn("async function analyseApplicationOnly(app) {", "function buildInterviewFromApplication(");
const OPEN_LESSON_SRC = fn("async function openLesson(topic) {", "async function recordQuizAnswer(");
const LOAD_STATE_SRC = fn("async function loadFullUserState(userId) {", "async function dbCreateApplication(");

/* ============================== validateProfile schema addition (EXECUTABLE) ============================== */
describe("validateProfile now coerces the additive application_intelligence block", () => {
  it("returns a well-formed application_intelligence block even when the AI omits it", () => {
    const v = validateProfile({ interview_profile: {} });
    expect(v.application_intelligence).toEqual({
      company_themes: [], role_themes: [],
      company_context_strength: "weak", role_context_strength: "weak",
    });
  });
  it("keeps company/role themes with their verbatim evidence, clamps the strength enum, caps the arrays", () => {
    const v = validateProfile({
      interview_profile: {},
      application_intelligence: {
        company_themes: [{ theme: "ownership", evidence: "we reward ownership" }, { theme: "", evidence: "x" }],
        role_themes: Array.from({ length: 30 }, (_, i) => ({ theme: `t${i}`, evidence: `e${i}` })),
        company_context_strength: "amazing", role_context_strength: "moderate",
      },
    });
    expect(v.application_intelligence.company_themes).toEqual([{ theme: "ownership", evidence: "we reward ownership" }]);
    expect(v.application_intelligence.role_themes.length).toBeLessThanOrEqual(12);
    expect(v.application_intelligence.company_context_strength).toBe("weak"); // invalid -> weak
    expect(v.application_intelligence.role_context_strength).toBe("moderate");
  });
  it("existing validateProfile output is otherwise unchanged (jd_requirements/candidate_profile/opening_question still present)", () => {
    const v = validateProfile({ interview_profile: { jd_requirements: [{ requirement: "x", evidence_quote: "x", category: "technical_functional" }] } });
    expect(v.interview_profile.jd_requirements).toHaveLength(1);
    expect(v.candidate_profile).toBeTruthy();
    expect(v.opening_question).toBeTruthy();
  });
});

/* ============================== analyseAndPlan wiring (STRUCTURAL) ============================== */
describe("analyseAndPlan assembles + persists Application Intelligence with NO new AI call", () => {
  it("builds it from the SAME interview_profile result (no second callClaude)", () => {
    expect(ANALYSE_SRC).toMatch(/buildApplicationIntelligence\(\{[\s\S]*?interviewProfile: result\.interview_profile,[\s\S]*?aiBlock: result\.application_intelligence,/);
    // exactly ONE callClaude in analyseAndPlan (the existing interview_profile call)
    expect((ANALYSE_SRC.match(/await callClaude\(/g) || []).length).toBe(1);
    expect(ANALYSE_SRC).toMatch(/requestType: "interview_profile"/);
  });
  it("persists it onto the application row via the existing dbUpdateApplication call (additive JSONB, no migration in code)", () => {
    expect(ANALYSE_SRC).toMatch(/dbUpdateApplication\(applicationId, \{[\s\S]*?application_intelligence: applicationIntelligence,/);
    expect(SOURCE).not.toMatch(/\balter table\b|\bcreate table\b|\badd column\b/i);
  });
  it("mirrors it onto local applications state so it survives without a reload", () => {
    expect(ANALYSE_SRC).toMatch(/setApplications\(\(prev\) => prev\.map\(\(a\) => \(a\.id === applicationId \? \{ \.\.\.a,[\s\S]*?applicationIntelligence \} : a\)\)\)/);
  });
  it("the build is wrapped in try/catch — a failure never blocks interview creation", () => {
    expect(ANALYSE_SRC).toMatch(/try \{\s*\n\s*applicationIntelligence = buildApplicationIntelligence\([\s\S]*?\} catch \(aiErr\) \{ console\.error/);
  });
  it("it is invoked AFTER validateProfile and does not feed the scheduler / methodology distribution", () => {
    const idxProfile = ANALYSE_SRC.indexOf("validateProfile(await callClaude");
    const idxIntel = ANALYSE_SRC.indexOf("buildApplicationIntelligence(");
    expect(idxProfile).toBeGreaterThan(-1);
    expect(idxIntel).toBeGreaterThan(idxProfile);
    // methodologyDistribution / effectiveMethodologyDistribution never read applicationIntelligence
    expect(SOURCE).not.toMatch(/computeMethodologyDistribution\([^)]*applicationIntelligence/);
    expect(SOURCE).not.toMatch(/scheduleNextCategory\([^)]*applicationIntelligence/);
  });
});

/* ============================== isolation from scheduler & Knowledge Layer (STRUCTURAL) ============================== */
describe("Application Intelligence is context/priorities only — it owns nothing downstream", () => {
  it("applicationIntelligence.js is never imported by methodology.js / adaptiveEngine.js / interviewKnowledge.js", () => {
    for (const mod of ["methodology.js", "adaptiveEngine.js", "interviewKnowledge.js"]) {
      const s = readFileSync(new URL(`./${mod}`, import.meta.url), "utf8");
      expect(s, mod).not.toMatch(/applicationIntelligence/);
    }
  });
  it("buildQuestionGenerationPrompt does not consume Application Intelligence (the KL gate stays Question-Mix-only)", () => {
    const FN = fn("export function buildQuestionGenerationPrompt(", "// §5: Call 2's response validator");
    expect(FN).not.toMatch(/applicationIntelligence|buildApplicationIntelligence|applicationDevelopmentPriorities|technicalPriorities/);
    // still gates on isTechnicalMixEnabled(config.question_mix), unchanged from Phase 11
    expect(FN).toMatch(/technicalMixEnabled: isTechnicalMixEnabled\(interview\?\.config\?\.question_mix\)/);
  });
  it("the adaptive turn engine (runSimulatedAdaptiveTurn call site) never receives Application Intelligence", () => {
    const submit = SOURCE.slice(SOURCE.indexOf("async function submitAnswer()"), SOURCE.indexOf("async function generateAndPersistNextQuestion("));
    expect(submit).not.toMatch(/applicationIntelligence/);
  });
});

/* ============================== EXECUTABLE: full pipe + Question Mix gating survives ============================== */
describe("EXECUTABLE — validateProfile -> buildApplicationIntelligence, and technical priorities never leak into a non-technical interview", () => {
  const rawAiResponse = {
    interview_profile: {
      company: "JPMorgan", role: "Investment Banking Summer Analyst", division: "M&A",
      responsibilities: ["Support live M&A transactions"], required_skills: ["Financial modelling"],
      competencies: [{ name: "collaboration", basis: "explicit" }],
      technical_topics: ["valuation"], behavioural_topics: ["teamwork"], commercial_topics: [],
      jd_requirements: [
        { requirement: "financial modelling", evidence_quote: "strong financial modelling", confidence: "explicit", category: "technical_functional", occurrences: 2 },
        { requirement: "teamwork", evidence_quote: "collaborative deal team", confidence: "explicit", category: "behavioural_competency", occurrences: 1 },
      ],
    },
    application_intelligence: {
      company_themes: [{ theme: "ownership", evidence: "rewards ownership" }],
      role_themes: [{ theme: "M&A execution", evidence: "Support live M&A transactions" }],
      company_context_strength: "moderate", role_context_strength: "strong",
    },
    opening_question: { text: "", category: "motivation_fit", competency: "" },
  };
  const jdText = "We want strong financial modelling in a collaborative deal team. Our culture rewards ownership.";

  it("assembles a provenance-rich, coverage-aware profile from the validated response", () => {
    const v = validateProfile(rawAiResponse);
    const intel = buildApplicationIntelligence({
      applicationId: "app-42", company: "JPMorgan", role: "Investment Banking Summer Analyst", jdText,
      interviewProfile: v.interview_profile, aiBlock: v.application_intelligence, invitationDraft: null,
    });
    expect(intel.technicalPriorities.some((s) => /financial modelling/i.test(s.label))).toBe(true);
    expect(intel.behaviouralPriorities.some((s) => /teamwork/i.test(s.label))).toBe(true);
    expect(intel.companyThemes.map((t) => t.label)).toContain("ownership");
    expect(intel.coverage.technical).not.toBe("none");
    expect(validateApplicationIntelligence(JSON.parse(JSON.stringify(intel)))).toBeTruthy(); // persist/reload round-trip
  });

  it("an application with rich TECHNICAL priorities does NOT make the Knowledge Layer fire on a Behavioural-only interview", () => {
    const ibProfile = {
      interview_profile: {
        role: "Investment Banking Summer Analyst", division: "M&A", responsibilities: [], required_skills: ["DCF"],
        preferred_skills: [], competencies: [], technical_topics: ["DCF"], behavioural_topics: [], commercial_topics: [],
        question_mix: {}, jd_requirements: [],
      },
      candidate_profile: {},
    };
    // Behavioural + Motivational mix only — Technical NOT selected.
    const interview = { maxQuestions: 10, transcript: [], config: { pipeline: "adaptive_turn", stage: "first_round", format: "live_conversational", question_mix: ["behavioural", "motivational"] } };
    for (const category of ["behavioural_competency", "motivation_fit", "situational_judgement"]) {
      const genInput = { category, turnType: "normal", anchorSource: null, questionNumber: 2 };
      const { system } = buildQuestionGenerationPrompt(genInput, interview, ibProfile, null, null, null);
      expect(system, category).not.toMatch(/KNOWLEDGE GUIDANCE/);
    }
  });
});

/* ============================== persistence / legacy (STRUCTURAL) ============================== */
describe("persistence survives reload and is legacy-safe", () => {
  it("loadFullUserState maps applications[].applicationIntelligence through validateApplicationIntelligence", () => {
    expect(LOAD_STATE_SRC).toMatch(/applicationIntelligence: validateApplicationIntelligence\(a\.application_intelligence\)/);
  });
  it("a legacy application (no application_intelligence column/value) yields null, not a crash", () => {
    expect(validateApplicationIntelligence(undefined)).toBeNull();
    expect(validateApplicationIntelligence(null)).toBeNull();
  });
  it("nothing re-runs the analysis on render — buildApplicationIntelligence is only called inside the two explicit analyse handlers", () => {
    // Phase 16A: exactly TWO call sites now — analyseAndPlan (interview creation)
    // and analyseApplicationOnly (standalone "Analyse this application"). Both are
    // explicit async user-triggered handlers; neither is a render path or a
    // question generator. Any third occurrence would be the regression this guards.
    const calls = (SOURCE.match(/buildApplicationIntelligence\(/g) || []).length;
    expect(calls).toBe(2);
    expect(ANALYSE_SRC).toMatch(/buildApplicationIntelligence\(/);
    expect(ANALYSE_APP_ONLY_SRC).toMatch(/buildApplicationIntelligence\(/);
    // analyseApplicationOnly is a genuine handler, not something that runs on render
    expect(SOURCE).toMatch(/async function analyseApplicationOnly\(app\) \{/);
    // it makes exactly one AI call, and it is the existing interview_profile type
    expect((ANALYSE_APP_ONLY_SRC.match(/await callClaude\(/g) || []).length).toBe(1);
    expect(ANALYSE_APP_ONLY_SRC).toMatch(/requestType: "interview_profile"/);
  });
});

/* ============================== minimal Classroom integration (STRUCTURAL) ============================== */
describe("Classroom lesson generation gets read-only grounded context, nothing else changes", () => {
  it("openLesson appends applicationIntelligenceLessonContext to the EXISTING lesson prompt userText", () => {
    expect(OPEN_LESSON_SRC).toMatch(/applicationIntelligenceLessonContext\(lessonAppIntel, \{ dimension: lessonDimension \}\)/);
    expect(OPEN_LESSON_SRC).toMatch(/const userText = `Weakness topic:[\s\S]*?\$\{appIntelContext\}/);
  });
  it("does NOT add a new AI call, change the lesson JSON schema, or alter the wantsWeb branch", () => {
    expect((OPEN_LESSON_SRC.match(/await callClaude\(/g) || []).length).toBe(1);
    expect(OPEN_LESSON_SRC).toMatch(/requestType: "classroom_lesson"/);
    expect(OPEN_LESSON_SRC).toMatch(/const wantsWeb = topic\.category === "company_knowledge" \|\| topic\.category === "commercial_awareness"/);
    // the grounded context is read from already-loaded state, not fetched
    expect(OPEN_LESSON_SRC).toMatch(/applications\.find\(\(a\) => a\.id === topic\.applicationId\)\?\.applicationIntelligence/);
  });
});

/* ============================== JD field UI (STRUCTURAL) ============================== */
describe("Part 2 — Job Description & Application Context field", () => {
  it("the field is labelled 'Job Description & Application Context'", () => {
    expect(SOURCE).toMatch(/Job Description &amp; Application Context/);
  });
  it("displays the exact helper text", () => {
    expect(SOURCE).toContain("Include as much detail as possible about the company, role and requirements. This helps JOB.READY personalise your interview questions and development recommendations.");
  });
  it("uses the broadened placeholder and an accessible label/description association", () => {
    expect(SOURCE).toMatch(/placeholder="Paste the job description and any other relevant information about the company, role, programme or requirements\.\.\."/);
    expect(SOURCE).toMatch(/aria-describedby="jd-context-help"/);
    expect(SOURCE).toMatch(/htmlFor="jd-context-input"/);
  });
});
