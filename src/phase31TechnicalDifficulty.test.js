/* ================================================================== *
 * PHASE 31 — TECHNICAL DIFFICULTY CONTROL + SMART INVITATION RECOMMENDATIONS
 * ------------------------------------------------------------------
 * Focused regression tests for Phase 31 (spec §13). They prove:
 *
 *  - the pure technicalDifficulty.js layer: canonical vocabulary, safe
 *    normalisation, EXPLICIT per-level generation guidance + the universal
 *    realism guard, and the deterministic invitation-derived suggestion
 *    (weak evidence never yields a confident Advanced);
 *  - the conditional UI: the control is revealed only for a technical
 *    interview, defaults to Intermediate, is keyboard-accessible, and its
 *    selected state is not conveyed by colour alone;
 *  - generation wiring: the chosen value reaches BOTH generation paths
 *    (adaptive per-turn + independent batch) and materially changes the
 *    instructions — and behavioural / motivational questions get none of it;
 *  - the invitation scan produces an editable suggestion the user is never
 *    silently locked into, and the user's final choice is what generation uses;
 *  - resume preserves the chosen difficulty and it still reaches generation;
 *  - the technical Assessment Centre exercises expose the control and the
 *    chosen level reaches scenario generation; non-technical ones are untouched;
 *  - no new AI request types, and the shared interview_profile prompt is intact.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  TECHNICAL_DIFFICULTY_LEVELS, DEFAULT_TECHNICAL_DIFFICULTY, TECHNICAL_DIFFICULTY_META,
  normalizeTechnicalDifficulty, resolveTechnicalDifficulty, buildTechnicalDifficultyGuidance,
  technicalDifficultyLevelGuidance, TECHNICAL_REALISM_GUARD, deriveTechnicalDifficultySignal,
} from "./technicalDifficulty.js";
import { buildQuestionGenerationPrompt } from "./App.jsx";
import { reconstructInterviewState } from "./resumeInterview.js";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
function fnSrc(startMarker, endMarker) {
  const s = SRC.indexOf(startMarker);
  if (s === -1) throw new Error(`marker not found: ${startMarker}`);
  const e = SRC.indexOf(endMarker, s + startMarker.length);
  return SRC.slice(s, e === -1 ? SRC.length : e);
}

const miniProfile = {
  interview_profile: {
    company: "Acme", role: "Data Analyst", division: "", seniority: "",
    responsibilities: [], required_skills: ["SQL"], preferred_skills: [], competencies: [],
    technical_topics: ["SQL joins"], behavioural_topics: [], commercial_topics: [],
    question_mix: {}, jd_requirements: [],
  },
  candidate_profile: {},
};
const genInput = (category) => ({ category, turnType: "normal", anchorSource: null, questionNumber: 2 });
const ivWith = (question_mix, technical_difficulty) => ({
  maxQuestions: 8, transcript: [],
  config: { pipeline: "adaptive_turn", stage: "technical", format: "technical", question_mix, technical_difficulty },
});
const DIFF_RE = /TECHNICAL DIFFICULTY: (BEGINNER|INTERMEDIATE|ADVANCED)/;

/* ============================== 1. pure module ============================== */
describe("technicalDifficulty.js — canonical vocabulary & normalisation", () => {
  it("exposes exactly beginner / intermediate / advanced and defaults to intermediate", () => {
    expect(TECHNICAL_DIFFICULTY_LEVELS).toEqual(["beginner", "intermediate", "advanced"]);
    expect(DEFAULT_TECHNICAL_DIFFICULTY).toBe("intermediate");
    for (const l of TECHNICAL_DIFFICULTY_LEVELS) {
      expect(TECHNICAL_DIFFICULTY_META[l].label).toBeTruthy();
      expect(TECHNICAL_DIFFICULTY_META[l].description.length).toBeGreaterThan(20);
    }
  });
  it("normalize returns null for junk; resolve falls back to the Intermediate default", () => {
    expect(normalizeTechnicalDifficulty("advanced")).toBe("advanced");
    expect(normalizeTechnicalDifficulty("expert")).toBeNull();
    expect(normalizeTechnicalDifficulty(undefined)).toBeNull();
    expect(resolveTechnicalDifficulty("expert")).toBe("intermediate");
    expect(resolveTechnicalDifficulty(null)).toBe("intermediate");
    expect(resolveTechnicalDifficulty("beginner")).toBe("beginner");
  });
});

describe("technicalDifficulty.js — EXPLICIT per-level generation guidance (§4) + realism guard (§5)", () => {
  it("each level has distinct, explicit guidance the model is not left to infer", () => {
    const b = technicalDifficultyLevelGuidance("beginner");
    const i = technicalDifficultyLevelGuidance("intermediate");
    const a = technicalDifficultyLevelGuidance("advanced");
    expect(b).toMatch(/TECHNICAL DIFFICULTY: BEGINNER/);
    expect(b).toMatch(/fundamentals|core concepts|entry-level/i);
    expect(b).toMatch(/little or no hands-on professional experience/i);
    expect(i).toMatch(/TECHNICAL DIFFICULTY: INTERMEDIATE/);
    expect(i).toMatch(/graduate and early-career/i);
    expect(i).toMatch(/do not artificially increase complexity/i);
    expect(a).toMatch(/TECHNICAL DIFFICULTY: ADVANCED/);
    expect(a).toMatch(/multi-step reasoning/i);
    expect(a).toMatch(/do not generate obscure academic or examination questions/i);
    expect(new Set([b, i, a]).size).toBe(3);
  });
  it("the realism guard targets REALISTIC difficulty, never MAXIMUM technical complexity", () => {
    expect(TECHNICAL_REALISM_GUARD).toMatch(/REALISTIC INTERVIEW DIFFICULTY/);
    expect(TECHNICAL_REALISM_GUARD).toMatch(/not maximum technical complexity/i);
    expect(TECHNICAL_REALISM_GUARD).toMatch(/avoid academic, obscure/i);
  });
  it("buildTechnicalDifficultyGuidance always appends the realism guard, for every level and for junk", () => {
    for (const l of [...TECHNICAL_DIFFICULTY_LEVELS, "expert", undefined]) {
      const g = buildTechnicalDifficultyGuidance(l);
      expect(g).toMatch(DIFF_RE);
      expect(g).toMatch(/REALISTIC INTERVIEW DIFFICULTY/);
    }
    expect(buildTechnicalDifficultyGuidance("expert")).toMatch(/TECHNICAL DIFFICULTY: INTERMEDIATE/);
  });
});

/* ============================== 2. invitation-derived suggestion (§6–§8) ============================== */
describe("deriveTechnicalDifficultySignal — evidence-based, never falsely confident", () => {
  it("an internship / Spring Week invitation → Beginner, with evidence and a rationale", () => {
    const sig = deriveTechnicalDifficultySignal({
      extraction: { role: "Spring Week Insight Intern", stage: "first_round", technical_topics: [], mentioned_competencies: [] },
      invitationText: "We are delighted to invite you to our Spring Week insight programme. No prior experience is required.",
      roleTitle: "Spring Week Insight Intern",
    });
    expect(sig.level).toBe("beginner");
    expect(sig.evidence.length).toBeGreaterThan(0);
    expect(sig.confidence).not.toBe("weak");
    expect(sig.rationale).toMatch(/early-career|entry-level/i);
  });

  it("a senior / specialist invitation with an explicit advanced technical assessment → Advanced", () => {
    const sig = deriveTechnicalDifficultySignal({
      extraction: { role: "Senior Quantitative Researcher", stage: "technical", technical_topics: ["stochastic calculus"], mentioned_competencies: [] },
      invitationText: "This is an advanced technical interview involving complex modelling and a system design discussion for a senior specialist hire.",
      roleTitle: "Senior Quantitative Researcher",
    });
    expect(sig.level).toBe("advanced");
    expect(sig.evidence.length).toBeGreaterThan(0);
  });

  it("no usable signal → Intermediate with LOW confidence, never a confident Advanced (§8)", () => {
    const sig = deriveTechnicalDifficultySignal({
      extraction: { role: "Team Member", stage: "first_round", technical_topics: [], mentioned_competencies: [] },
      invitationText: "We would like to invite you to an interview for the role. It will last about 45 minutes.",
      roleTitle: "Team Member",
    });
    expect(sig.level).toBe("intermediate");
    expect(sig.confidence).toBe("weak");
  });

  it("a bare 'graduate analyst' reads as Intermediate (never Advanced), a supporting-signal read", () => {
    const sig = deriveTechnicalDifficultySignal({
      extraction: { role: "Graduate Analyst", stage: "first_round" },
      invitationText: "Interview for our Graduate Analyst programme — a standard technical interview.",
      roleTitle: "Graduate Analyst",
    });
    expect(sig.level).toBe("intermediate");
    expect(sig.confidence).not.toBe("weak");
  });

  it("a lone 'senior' mention is Advanced but never 'strong' — the UI must not over-claim", () => {
    const sig = deriveTechnicalDifficultySignal({
      extraction: { role: "Senior Associate", stage: "first_round" },
      invitationText: "Interview for the Senior Associate position.",
      roleTitle: "Senior Associate",
    });
    expect(sig.level).toBe("advanced");
    expect(sig.confidence).not.toBe("strong");
  });

  it("empty / malformed input never throws and resolves to Intermediate", () => {
    for (const bad of [undefined, null, {}, { extraction: null }, "nope"]) {
      const sig = deriveTechnicalDifficultySignal(bad);
      expect(sig.level).toBe("intermediate");
      expect(TECHNICAL_DIFFICULTY_LEVELS).toContain(sig.level);
    }
  });
});

/* ============================== 3. conditional UI (§2/§3/§11) ============================== */
describe("Phase 31 UI — the control is revealed only for a technical interview", () => {
  it("technicalDifficulty state exists and defaults to the Intermediate constant", () => {
    expect(SRC).toMatch(/const \[technicalDifficulty, setTechnicalDifficulty\] = useState\(DEFAULT_TECHNICAL_DIFFICULTY\)/);
  });
  it("the wizard renders <TechnicalDifficultyPicker> gated on questionMix.technical — hidden otherwise", () => {
    expect(SRC).toMatch(/\{questionMix\.technical && \(\s*<div style=\{\{ marginBottom: 16 \}\}>[\s\S]{0,400}<TechnicalDifficultyPicker value=\{technicalDifficulty\} onChange=\{setTechnicalDifficulty\} \/>/);
  });
  it("the picker is keyboard-accessible (real buttons + aria-pressed) and does not rely on colour alone", () => {
    const picker = fnSrc("function TechnicalDifficultyPicker(", "\n}\n");
    expect(picker).toMatch(/<button\b/);
    expect(picker).toMatch(/aria-pressed=\{on\}/);
    expect(picker).toMatch(/role="group"/);
    // selected state also carries a check glyph + bold weight + a thicker border,
    // not only a colour swap
    expect(picker).toMatch(/\{on \? "✓ " : ""\}\{meta\.label\}/);
    expect(picker).toMatch(/fontWeight: on \? 800 : 600/);
    expect(picker).toMatch(/border: on \? "2px solid var\(--blue\)" : "1\.5px solid var\(--border\)"/);
  });
  it("starting a fresh interview resets the difficulty to the Intermediate default", () => {
    const reset = fnSrc("function resetForNewInterview()", "\n  }\n");
    expect(reset).toMatch(/setTechnicalDifficulty\(DEFAULT_TECHNICAL_DIFFICULTY\)/);
    expect(reset).toMatch(/setScanTechnicalDifficulty\(DEFAULT_TECHNICAL_DIFFICULTY\)/);
  });
});

/* ============================== 4. generation wiring — adaptive per-turn ============================== */
describe("Phase 31 — the chosen difficulty reaches the adaptive per-turn generation prompt (§4)", () => {
  it("technical mix + technical turn + level 'beginner' → BEGINNER guidance + realism guard in the system prompt", () => {
    const { system } = buildQuestionGenerationPrompt(genInput("technical_functional"), ivWith(["technical"], "beginner"), miniProfile, null, null, null);
    expect(system).toMatch(/TECHNICAL DIFFICULTY: BEGINNER/);
    expect(system).toMatch(/REALISTIC INTERVIEW DIFFICULTY/);
  });
  it("level 'advanced' → ADVANCED guidance; the two prompts genuinely differ", () => {
    const beg = buildQuestionGenerationPrompt(genInput("technical_functional"), ivWith(["technical"], "beginner"), miniProfile, null, null, null).system;
    const adv = buildQuestionGenerationPrompt(genInput("technical_functional"), ivWith(["technical"], "advanced"), miniProfile, null, null, null).system;
    expect(adv).toMatch(/TECHNICAL DIFFICULTY: ADVANCED/);
    expect(beg).not.toMatch(/TECHNICAL DIFFICULTY: ADVANCED/);
    expect(beg).not.toEqual(adv);
  });
  it("a legacy technical interview with no stored level still gets guidance, at the Intermediate default", () => {
    const { system } = buildQuestionGenerationPrompt(genInput("technical_functional"), ivWith(["technical"], undefined), miniProfile, null, null, null);
    expect(system).toMatch(/TECHNICAL DIFFICULTY: INTERMEDIATE/);
  });
  it("behavioural and motivational turns get ZERO technical-difficulty instructions", () => {
    for (const cat of ["behavioural_competency", "situational_judgement", "motivation_fit"]) {
      const { system } = buildQuestionGenerationPrompt(genInput(cat), ivWith(["technical", "behavioural", "motivational"], "advanced"), miniProfile, null, null, null);
      expect(system, cat).not.toMatch(DIFF_RE);
    }
  });
  it("a technical-category turn whose interview EXCLUDED technical from the mix gets no difficulty block (same gate as the Knowledge Layer)", () => {
    for (const mix of [["behavioural"], ["motivational"], ["behavioural", "motivational"]]) {
      const { system } = buildQuestionGenerationPrompt(genInput("technical_functional"), ivWith(mix, "advanced"), miniProfile, null, null, null);
      expect(system, JSON.stringify(mix)).not.toMatch(DIFF_RE);
    }
  });
});

/* ============================== 4b. generation wiring — independent batch ============================== */
describe("Phase 31 — the chosen difficulty reaches the independent/batch generation prompt (§4)", () => {
  const BATCH = fnSrc("function buildQuestionBatchPrompt(", "async function generateQuestionBatch(");
  it("buildQuestionBatchPrompt injects the level guidance, scoped to is_technical questions, gated on the technical mix", () => {
    expect(BATCH).toMatch(/isTechnicalMixEnabled\(config\.question_mix\)/);
    expect(BATCH).toMatch(/buildTechnicalDifficultyGuidance\(config\.technical_difficulty\)/);
    expect(BATCH).toMatch(/"is_technical": true[^\n]*ONLY those/);
  });
  it("analyseAndPlan persists technical_difficulty on the interview config, only when the mix includes technical (§10)", () => {
    const plan = fnSrc("async function analyseAndPlan()", "async function beginInterview()");
    expect(plan).toMatch(/if \(questionMixSelected\.includes\("technical"\)\) \{\s*\n\s*ivConfig\.technical_difficulty = resolveTechnicalDifficulty\(technicalDifficulty\)/);
  });
});

/* ============================== 5. invitation scan integration (§6/§10) ============================== */
describe("Phase 31 — invitation scan suggests, the user is never locked in", () => {
  it("analyseInvitation derives the suggestion deterministically (no extra AI call) and stores it", () => {
    const scan = fnSrc("async function analyseInvitation()", "async function confirmInvitationAndBuild()");
    expect(scan).toMatch(/deriveTechnicalDifficultySignal\(\{/);
    expect(scan).toMatch(/setScanTechnicalDifficulty\(diffSignal\.level\)/);
    // exactly one callClaude in analyseInvitation, unchanged
    expect((scan.match(/callClaude\(/g) || []).length).toBe(1);
  });
  it("the review screen shows the suggestion as an EDITABLE pill group with a 'you can change this' note", () => {
    const review = fnSrc('screen === "invitation_review"', 'screen === "analyzing"');
    expect(review).toMatch(/<TechnicalDifficultyPicker value=\{scanTechnicalDifficulty\} onChange=\{setScanTechnicalDifficulty\} \/>/);
    expect(review).toMatch(/Recommended based on your invitation/);
    expect(review).toMatch(/you can change this before continuing/i);
  });
  it("the user's chosen difficulty (not merely the AI suggestion) is carried into the wizard before generation", () => {
    const confirm = fnSrc("async function confirmInvitationAndBuild()", "async function analyseAndPlan()");
    expect(confirm).toMatch(/setTechnicalDifficulty\(resolveTechnicalDifficulty\(scanTechnicalDifficulty\)\)/);
  });
});

/* ============================== 6. resume / persistence (§10) ============================== */
describe("Phase 31 — a resumed technical interview keeps its chosen difficulty and it still reaches generation", () => {
  const row = {
    id: "iv1", application_id: "app1", status: "in_progress", stage: "technical", format: "technical",
    created_at: "2026-08-01T00:00:00Z", started_at: "2026-08-01T00:00:00Z",
    config: {
      pipeline: "adaptive_turn", stage: "technical", format: "technical",
      question_mix: ["technical"], technical_difficulty: "advanced", max_questions: 8,
      profile: { interview_profile: miniProfile.interview_profile, candidate_profile: {}, opening_question: { text: "Q1", category: "technical", competency: "sql" } },
    },
  };
  const questions = [
    { id: "q1", question_number: 1, question_text: "Q1", category: "technical_functional", competency: "sql", metadata: {}, answered: true, answer_text: "ans", evaluation: {} },
    { id: "q2", question_number: 2, question_text: "Q2", category: "technical_functional", competency: "joins", metadata: {}, answered: false },
  ];

  it("reconstructInterviewState carries config.technical_difficulty through unchanged", () => {
    const out = reconstructInterviewState({ interviewRow: row, questions, meta: { company: "Acme", role: "Data Analyst", stageLabel: "Technical", formatLabel: "Technical" } });
    expect(out.resumable).toBe(true);
    expect(out.interview.config.technical_difficulty).toBe("advanced");
  });

  it("feeding the reconstructed interview into buildQuestionGenerationPrompt still yields ADVANCED guidance", () => {
    const out = reconstructInterviewState({ interviewRow: row, questions, meta: { company: "Acme", role: "Data Analyst", stageLabel: "Technical", formatLabel: "Technical" } });
    const { system } = buildQuestionGenerationPrompt(genInput("technical_functional"), out.interview, { interview_profile: row.config.profile.interview_profile, candidate_profile: {} }, null, null, null);
    expect(system).toMatch(/TECHNICAL DIFFICULTY: ADVANCED/);
  });
});

/* ============================== 7. Assessment Centre (§9) ============================== */
describe("Phase 31 — technical Assessment Centre exercises expose the control; non-technical are untouched", () => {
  it("only the case study and written exercise are treated as technical", () => {
    expect(SRC).toMatch(/const AC_TECHNICAL_EXERCISES = new Set\(\["case", "written"\]\)/);
  });
  it("generateAcScenario passes the chosen level into scenario generation for those exercises only", () => {
    const gen = fnSrc("async function generateAcScenario(type)", "async function submitAcResponse()");
    expect(gen).toMatch(/AC_TECHNICAL_EXERCISES\.has\(type\)/);
    expect(gen).toMatch(/buildTechnicalDifficultyGuidance\(acLevel\)/);
    expect(gen).toMatch(/result\.technical_difficulty = acLevel/);
    // untouched for non-technical: the block is "" unless acIsTechnical
    expect(gen).toMatch(/acIsTechnical\s*\?\s*\n?\s*`\\n\$\{buildTechnicalDifficultyGuidance/);
  });
  it("the AC home screen shows a compact difficulty step before a technical exercise, defaulting to Intermediate", () => {
    const ac = fnSrc('screen === "ac_home"', 'screen === "ac_generating"');
    expect(ac).toMatch(/AC_TECHNICAL_EXERCISES\.has\(t\.key\)\s*\n?\s*\?\s*\(\) => \{ setError\(""\); setAcPendingExercise\(t\.key\); \}/);
    expect(ac).toMatch(/\{acPendingExercise && \(/);
    expect(ac).toMatch(/<TechnicalDifficultyPicker value=\{acTechnicalDifficulty\} onChange=\{setAcTechnicalDifficulty\} \/>/);
    expect(ac).toMatch(/startAssessmentCentre\(acPendingExercise\)/);
  });
  it("acTechnicalDifficulty state defaults to the Intermediate constant", () => {
    expect(SRC).toMatch(/const \[acTechnicalDifficulty, setAcTechnicalDifficulty\] = useState\(DEFAULT_TECHNICAL_DIFFICULTY\)/);
  });
});

/* ============================== 8. protected systems / no regression (§12) ============================== */
describe("Phase 31 adds no new AI surface and leaves shared prompts intact", () => {
  it("introduces no new callClaude requestType strings", () => {
    const types = [...new Set([...SRC.matchAll(/requestType:\s*"([a-z_]+)"/g)].map((m) => m[1]))].sort();
    expect(types).toEqual([
      "assessment_centre", "assessment_centre_scenario", "classroom_lesson", "development_module",
      "interview_batch_evaluation", "interview_profile", "interview_question_batch", "interview_report",
      "interview_turn_evaluate", "interview_turn_generate", "invitation_extraction",
    ].sort());
  });
  it("the shared INTERVIEW_PROFILE_SYSTEM prompt opening is unchanged", () => {
    expect(SRC).toMatch(/const INTERVIEW_PROFILE_SYSTEM = `You are an expert interview coach and recruiter\./);
  });
  it("technicalDifficulty.js is a pure module — no AI / DB / React / network imports", () => {
    const mod = readFileSync(new URL("./technicalDifficulty.js", import.meta.url), "utf8");
    expect(mod).not.toMatch(/\bimport\b/);
    expect(mod).not.toMatch(/callClaude|supabase|createClient|fetch\(|from ["']react["']/);
  });
});
