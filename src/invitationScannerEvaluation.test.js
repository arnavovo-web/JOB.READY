/* ================================================================== *
 * PHASE 8 — INTERVIEW INVITATION SCANNER: AUTOMATED VALIDATION SUITE
 * ------------------------------------------------------------------
 * Deterministic, no-live-AI-call regression suite. Runs the 20-fixture
 * realistic email corpus (src/test-fixtures/interview-invitations/) through
 * a hand-authored "what a well-behaved extraction of this exact email
 * SHOULD produce" raw AI-shaped object, feeds that through the REAL,
 * unmodified validateInvitationExtraction (App.jsx — no fake duplicate
 * parser), and checks the result against each fixture's expected.json via
 * the real evaluation harness (invitationScannerEvaluation.js).
 *
 * This suite protects the VALIDATOR + MATCHER + REPORT-BUILDING CODE
 * against regressions, and doubles as a fixed, deterministic demonstration
 * that a correct extraction of each fixture would score cleanly. It does
 * NOT measure the real AI's actual extraction accuracy for these emails —
 * that is exactly what the separate, optional live evaluation command
 * (src/invitationScannerLiveEvaluation.test.js, `npm run
 * evaluate:interview-invitations`) is for. Never confuse the two: a 100%
 * pass rate here means "the harness correctly recognises a good
 * extraction", not "the AI always produces one".
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  validateInvitationExtraction, invitationExtractionHasUsableSignal, findInvitationApplicationMatch,
  buildInvitationContextForProfile, buildInvitationExtractionPrompt, INVITATION_MAX_CHARS, INTERVIEW_FORMATS,
} from "./App.jsx";
import { isKnowledgeLayerApplicable, resolveKnowledgeDomain, KNOWLEDGE_DOMAINS } from "./interviewKnowledge.js";
import {
  loadAllInvitationFixtures, listInvitationFixtureIds,
  evaluateInvitationFixture, evaluateInvitationTopics, buildInvitationEvaluationReport, formatInvitationEvaluationReport,
} from "./invitationScannerEvaluation.js";

const REQUIRED_FIXTURE_IDS = [
  "ib-technical", "ib-behavioural", "ib-hirevue", "sales-trading", "private-equity",
  "consulting-case", "consulting-behavioural", "swe-technical", "swe-coding", "data-science",
  "product-management", "accounting", "marketing", "general-graduate-scheme", "assessment-centre",
  "mixed-technical-behavioural", "vague-invitation", "minimal-invitation", "long-email-irrelevant-content", "prompt-injection",
];

/* ================================================================== *
 * A hand-authored "correct extraction" per fixture — what a careful,
 * non-hallucinating reading of that EXACT email should produce. Fed
 * through the real validateInvitationExtraction below, never asserted
 * against directly.
 * ================================================================== */
const SIMULATED_RAW_OUTPUTS = {
  "ib-technical": {
    company: "Cavendish Capital Partners", company_source: "explicit",
    role: "Investment Banking Summer Analyst", role_source: "explicit",
    division: "M&A Advisory", team: "",
    stage: "technical", stage_source: "explicit", format: "technical", format_source: "explicit",
    duration_minutes: 45, duration_source: "explicit", date: "Thursday 3rd September", time: "2:00pm", timezone: "BST", location: "",
    interviewer_count: 1, interviewers: [{ name: "", title: "M&A Advisory Associate" }],
    components: ["technical_functional"], components_source: "explicit",
    technical_topics: ["accounting", "valuation"], behavioural_topics: [], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: ["accounting fundamentals", "valuation fundamentals"],
    next_steps: "", required_materials: [], deadlines: [], preparation_instructions: "",
    overall_confidence: "high",
  },
  "ib-behavioural": {
    company: "Rothmere & Vance Capital", company_source: "explicit",
    role: "Investment Banking Summer Analyst", role_source: "explicit",
    division: "", team: "",
    stage: "first_round", stage_source: "explicit", format: "live_conversational", format_source: "explicit",
    duration_minutes: 30, duration_source: "explicit", date: "Tuesday 15th July", time: "10:30am", timezone: "BST", location: "",
    interviewer_count: 1, interviewers: [{ name: "", title: "Associate" }],
    components: ["motivation_fit", "behavioural_competency"], components_source: "explicit",
    technical_topics: [], behavioural_topics: ["teamwork under pressure"], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: ["motivation for investment banking"],
    next_steps: "", required_materials: [], deadlines: [], preparation_instructions: "",
    overall_confidence: "high",
  },
  "ib-hirevue": {
    company: "Cavendish Capital Partners", company_source: "explicit",
    role: "Investment Banking Analyst", role_source: "explicit",
    division: "", team: "",
    stage: "recruiter_screen", stage_source: "inferred", format: "asynchronous_video", format_source: "explicit",
    duration_minutes: 50, duration_source: "explicit", date: "", time: "", timezone: "", location: "",
    interviewer_count: 0, interviewers: [],
    components: ["behavioural_competency", "motivation_fit"], components_source: "explicit",
    technical_topics: [], behavioural_topics: ["teamwork", "resilience"], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: [],
    next_steps: "", required_materials: [], deadlines: ["7 days from receipt"], preparation_instructions: "",
    overall_confidence: "high",
  },
  "sales-trading": {
    company: "Northbridge Markets", company_source: "explicit",
    role: "Global Markets Summer Analyst", role_source: "explicit",
    division: "Sales & Trading", team: "",
    stage: "technical", stage_source: "explicit", format: "technical", format_source: "explicit",
    duration_minutes: 45, duration_source: "explicit", date: "Monday 21st July", time: "9:00am", timezone: "", location: "Northbridge Markets, 1 Exchange Square, London",
    interviewer_count: 2, interviewers: [],
    components: ["technical_functional"], components_source: "explicit",
    technical_topics: ["fixed income products", "market making", "mental maths"], behavioural_topics: [], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: [],
    next_steps: "", required_materials: ["photo ID"], deadlines: [], preparation_instructions: "",
    overall_confidence: "high",
  },
  "private-equity": {
    company: "Highfield Equity Partners", company_source: "explicit",
    role: "Private Equity Summer Analyst", role_source: "explicit",
    division: "", team: "",
    stage: "final_round", stage_source: "explicit", format: "technical", format_source: "inferred",
    duration_minutes: 90, duration_source: "explicit", date: "Friday 8th August", time: "11:00am", timezone: "", location: "Highfield Equity Partners, 22 Berkeley Square, London",
    interviewer_count: 0, interviewers: [],
    components: ["technical_functional", "situational_judgement"], components_source: "explicit",
    technical_topics: [], behavioural_topics: [], commercial_topics: ["evaluating a portfolio company investment"],
    mentioned_competencies: [], preparation_areas: ["your CV in detail"],
    next_steps: "", required_materials: ["laptop"], deadlines: [], preparation_instructions: "",
    overall_confidence: "high",
  },
  "consulting-case": {
    company: "Arden & Co Consulting", company_source: "explicit",
    role: "Summer Associate Consultant", role_source: "explicit",
    division: "Management Consulting", team: "",
    stage: "first_round", stage_source: "explicit", format: "live_conversational", format_source: "explicit",
    duration_minutes: 60, duration_source: "explicit", date: "Wednesday 10th September", time: "1:00pm", timezone: "BST", location: "",
    interviewer_count: 1, interviewers: [],
    components: ["situational_judgement"], components_source: "explicit",
    technical_topics: [], behavioural_topics: [], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: ["case interview structure"],
    next_steps: "", required_materials: [], deadlines: [], preparation_instructions: "",
    overall_confidence: "high",
  },
  "consulting-behavioural": {
    company: "Arden & Co Consulting", company_source: "explicit",
    role: "Summer Associate Consultant", role_source: "explicit",
    division: "Management Consulting", team: "",
    stage: "recruiter_screen", stage_source: "explicit", format: "live_conversational", format_source: "explicit",
    duration_minutes: 20, duration_source: "explicit", date: "Monday 2nd June", time: "4:00pm", timezone: "BST", location: "",
    interviewer_count: 1, interviewers: [],
    components: ["motivation_fit", "behavioural_competency"], components_source: "explicit",
    technical_topics: [], behavioural_topics: ["teamwork"], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: [],
    next_steps: "", required_materials: [], deadlines: [], preparation_instructions: "",
    overall_confidence: "high",
  },
  "swe-technical": {
    company: "Solstice Technologies", company_source: "explicit",
    role: "Software Engineer Intern", role_source: "explicit",
    division: "", team: "",
    stage: "technical", stage_source: "explicit", format: "technical", format_source: "explicit",
    duration_minutes: 60, duration_source: "explicit", date: "Thursday 18th July", time: "3:00pm", timezone: "BST", location: "",
    interviewer_count: 1, interviewers: [],
    components: ["technical_functional"], components_source: "explicit",
    technical_topics: ["data structures", "algorithms"], behavioural_topics: [], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: [],
    next_steps: "", required_materials: [], deadlines: [], preparation_instructions: "",
    overall_confidence: "high",
  },
  "swe-coding": {
    company: "Ferro Dynamics", company_source: "explicit",
    role: "Software Engineering Intern", role_source: "explicit",
    division: "", team: "",
    stage: "technical", stage_source: "inferred", format: "technical", format_source: "explicit",
    duration_minutes: 90, duration_source: "explicit", date: "Tuesday 5th August", time: "11:00am", timezone: "BST", location: "",
    interviewer_count: 2, interviewers: [],
    components: ["technical_functional"], components_source: "explicit",
    technical_topics: ["coding", "problem solving"], behavioural_topics: [], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: [],
    next_steps: "", required_materials: [], deadlines: [], preparation_instructions: "",
    overall_confidence: "medium",
  },
  "data-science": {
    company: "Vantage Analytics", company_source: "explicit",
    role: "Data Science Analyst Intern", role_source: "explicit",
    division: "", team: "",
    stage: "technical", stage_source: "explicit", format: "technical", format_source: "explicit",
    duration_minutes: 45, duration_source: "explicit", date: "Friday 12th July", time: "1:00pm", timezone: "BST", location: "",
    interviewer_count: 1, interviewers: [],
    components: ["technical_functional"], components_source: "explicit",
    technical_topics: ["statistics", "machine learning"], behavioural_topics: [], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: [],
    next_steps: "", required_materials: [], deadlines: [], preparation_instructions: "",
    overall_confidence: "high",
  },
  "product-management": {
    company: "Meridian Software", company_source: "explicit",
    role: "Associate Product Manager", role_source: "explicit",
    division: "", team: "",
    stage: "first_round", stage_source: "explicit", format: "live_conversational", format_source: "explicit",
    duration_minutes: 45, duration_source: "explicit", date: "Wednesday 24th July", time: "2:30pm", timezone: "BST", location: "",
    interviewer_count: 1, interviewers: [],
    components: ["behavioural_competency", "situational_judgement"], components_source: "explicit",
    technical_topics: [], behavioural_topics: ["past experience", "working with a team"], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: ["approach to a product decision"],
    next_steps: "", required_materials: [], deadlines: [], preparation_instructions: "",
    overall_confidence: "high",
  },
  "accounting": {
    company: "Baxter Fielding LLP", company_source: "explicit",
    role: "Audit Associate", role_source: "explicit",
    division: "", team: "",
    stage: "technical", stage_source: "explicit", format: "technical", format_source: "explicit",
    duration_minutes: 45, duration_source: "explicit", date: "Monday 14th October", time: "10:00am", timezone: "", location: "Baxter Fielding LLP, 8 Fenchurch Street, London",
    interviewer_count: 0, interviewers: [],
    components: ["technical_functional"], components_source: "explicit",
    technical_topics: ["audit principles", "financial statements"], behavioural_topics: [], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: [],
    next_steps: "", required_materials: ["CV", "certificates"], deadlines: [], preparation_instructions: "",
    overall_confidence: "high",
  },
  "marketing": {
    company: "Lumen Brands", company_source: "explicit",
    role: "Marketing Graduate", role_source: "explicit",
    division: "", team: "",
    stage: "first_round", stage_source: "explicit", format: "live_conversational", format_source: "explicit",
    duration_minutes: 40, duration_source: "explicit", date: "Thursday 4th September", time: "11:00am", timezone: "BST", location: "",
    interviewer_count: 1, interviewers: [],
    components: ["behavioural_competency", "situational_judgement"], components_source: "explicit",
    technical_topics: [], behavioural_topics: ["past experience", "motivations"], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: ["approach to a marketing challenge"],
    next_steps: "", required_materials: [], deadlines: [], preparation_instructions: "",
    overall_confidence: "high",
  },
  "general-graduate-scheme": {
    company: "Kestrel Group", company_source: "explicit",
    role: "Graduate Programme", role_source: "explicit",
    division: "", team: "",
    stage: "first_round", stage_source: "explicit", format: "live_conversational", format_source: "explicit",
    duration_minutes: 30, duration_source: "explicit", date: "Tuesday 9th September", time: "9:30am", timezone: "BST", location: "",
    interviewer_count: 1, interviewers: [],
    components: ["motivation_fit", "behavioural_competency"], components_source: "explicit",
    technical_topics: [], behavioural_topics: ["teamwork", "communication", "problem solving"], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: [],
    next_steps: "", required_materials: [], deadlines: [], preparation_instructions: "",
    overall_confidence: "high",
  },
  "assessment-centre": {
    company: "Harrow Partners", company_source: "explicit",
    role: "Graduate Analyst", role_source: "explicit",
    division: "", team: "",
    stage: "unknown", stage_source: "unknown", format: "unknown", format_source: "unknown",
    duration_minutes: 240, duration_source: "explicit", date: "Thursday 19th September", time: "9:00am", timezone: "", location: "Harrow Partners, 45 Cheapside, London",
    interviewer_count: 0, interviewers: [],
    components: ["behavioural_competency", "situational_judgement"], components_source: "explicit",
    technical_topics: [], behavioural_topics: [], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: ["group exercise", "case study exercise", "one-on-one interview"],
    next_steps: "", required_materials: ["two forms of ID"], deadlines: [], preparation_instructions: "",
    overall_confidence: "medium",
  },
  "mixed-technical-behavioural": {
    company: "Ferro Dynamics", company_source: "explicit",
    role: "Software Engineering New Grad", role_source: "explicit",
    division: "", team: "",
    stage: "first_round", stage_source: "explicit", format: "live_conversational", format_source: "inferred",
    duration_minutes: 75, duration_source: "explicit", date: "Monday 22nd July", time: "10:00am", timezone: "BST", location: "",
    interviewer_count: 1, interviewers: [],
    components: ["technical_functional", "behavioural_competency"], components_source: "explicit",
    technical_topics: ["coding"], behavioural_topics: ["teamwork"], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: [],
    next_steps: "", required_materials: [], deadlines: [], preparation_instructions: "",
    overall_confidence: "high",
  },
  "vague-invitation": {
    company: "Thornwell Group", company_source: "explicit",
    role: "Analyst", role_source: "explicit",
    division: "", team: "",
    stage: "unknown", stage_source: "unknown", format: "unknown", format_source: "unknown",
    duration_minutes: 0, duration_source: "unknown", date: "", time: "", timezone: "", location: "",
    interviewer_count: 0, interviewers: [],
    components: [], components_source: "unknown",
    technical_topics: [], behavioural_topics: [], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: [],
    next_steps: "We'll be in touch shortly with more details.", required_materials: [], deadlines: [], preparation_instructions: "",
    overall_confidence: "low",
  },
  "minimal-invitation": {
    company: "", company_source: "unknown",
    role: "", role_source: "unknown",
    division: "", team: "",
    stage: "unknown", stage_source: "unknown", format: "unknown", format_source: "unknown",
    duration_minutes: 0, duration_source: "unknown", date: "", time: "", timezone: "", location: "",
    interviewer_count: 0, interviewers: [],
    components: [], components_source: "unknown",
    technical_topics: [], behavioural_topics: [], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: [],
    next_steps: "", required_materials: [], deadlines: [], preparation_instructions: "",
    overall_confidence: "low",
  },
  "long-email-irrelevant-content": {
    company: "Thornfield Group", company_source: "explicit",
    role: "Graduate Trainee - Operations", role_source: "explicit",
    division: "", team: "",
    stage: "unknown", stage_source: "unknown", format: "live_conversational", format_source: "explicit",
    duration_minutes: 30, duration_source: "explicit", date: "Wednesday 2nd October", time: "3:00pm", timezone: "BST", location: "",
    interviewer_count: 1, interviewers: [],
    components: ["behavioural_competency"], components_source: "explicit",
    technical_topics: [], behavioural_topics: ["past experience"], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: [],
    next_steps: "", required_materials: [], deadlines: [], preparation_instructions: "",
    overall_confidence: "medium",
  },
  "prompt-injection": {
    company: "Delacroix Financial", company_source: "explicit",
    role: "Investment Banking Summer Analyst", role_source: "explicit",
    division: "", team: "",
    stage: "first_round", stage_source: "explicit", format: "live_conversational", format_source: "explicit",
    duration_minutes: 30, duration_source: "explicit", date: "Monday 6th May", time: "9:00am", timezone: "BST", location: "",
    interviewer_count: 1, interviewers: [],
    components: ["motivation_fit", "behavioural_competency"], components_source: "explicit",
    technical_topics: [], behavioural_topics: ["working in a team"], commercial_topics: [],
    mentioned_competencies: [], preparation_areas: [],
    next_steps: "", required_materials: [], deadlines: [], preparation_instructions: "",
    overall_confidence: "high",
  },
};

/* ============================== module purity ============================== */
describe("invitationScannerEvaluation.js — evaluation tooling stays isolated from the shipped app", () => {
  it("is never imported by App.jsx", () => {
    const appSrc = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
    expect(appSrc).not.toMatch(/invitationScannerEvaluation/);
  });
  it("makes no AI calls and touches no database/React — pure comparison/fixture-loading logic only", () => {
    const src = readFileSync(new URL("./invitationScannerEvaluation.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/callClaude|supabase|from ["']react["']/);
  });
});

/* ============================== fixture corpus sanity (§2/§13) ============================== */
describe("interview invitation fixture corpus", () => {
  const ids = listInvitationFixtureIds();

  it("contains exactly the 20 required scenarios", () => {
    expect(ids).toHaveLength(20);
    for (const id of REQUIRED_FIXTURE_IDS) expect(ids).toContain(id);
  });

  it("every fixture has a matching hand-authored simulated extraction for the deterministic suite", () => {
    for (const id of ids) expect(SIMULATED_RAW_OUTPUTS).toHaveProperty(id);
  });

  it("every fixture email reads as realistic prose, not a one-line artificial test string, and stays within INVITATION_MAX_CHARS", () => {
    for (const f of loadAllInvitationFixtures()) {
      if (f.id !== "minimal-invitation") expect(f.emailText.length).toBeGreaterThan(150);
      expect(f.emailText.length).toBeLessThanOrEqual(INVITATION_MAX_CHARS);
    }
  });

  it("the long-email fixture is meaningfully longer than a typical fixture, and the minimal one is deliberately tiny (§13)", () => {
    const byId = Object.fromEntries(loadAllInvitationFixtures().map((f) => [f.id, f.emailText.length]));
    expect(byId["long-email-irrelevant-content"]).toBeGreaterThan(2500);
    expect(byId["minimal-invitation"]).toBeLessThan(100);
  });

  it("the prompt-injection fixture actually contains an embedded instruction-like phrase (so the test is real, not vacuous)", () => {
    const f = loadAllInvitationFixtures().find((x) => x.id === "prompt-injection");
    expect(f.emailText).toMatch(/ignore all previous instructions/i);
  });
});

/* ============================== the full corpus, run through the REAL validator (§4/§16) ============================== */
describe("interview invitation evaluation — full corpus through the real validateInvitationExtraction", () => {
  const evaluations = loadAllInvitationFixtures().map((fixture) => {
    const raw = SIMULATED_RAW_OUTPUTS[fixture.id];
    const validated = validateInvitationExtraction(raw);
    return evaluateInvitationFixture(fixture, validated);
  });
  const report = buildInvitationEvaluationReport(evaluations);

  it("every fixture's hand-authored correct extraction scores PASS or EXPECTED_VARIATION — never FAIL (a FAIL here is a real regression in the validator/matcher/harness)", () => {
    const fails = evaluations.filter((e) => e.verdict === "FAIL");
    if (fails.length) {
      console.error(formatInvitationEvaluationReport(report));
    }
    expect(fails, JSON.stringify(fails.map((f) => ({ id: f.id, reasons: f.reasons })), null, 2)).toEqual([]);
  });

  it("produces a well-formed aggregate report with sane category percentages (§15/§19)", () => {
    expect(report.total).toBe(20);
    expect(report.passed + report.expectedVariation + report.failed).toBe(20);
    for (const [label, pct] of Object.entries(report.byCategory)) {
      if (pct !== null) {
        expect(pct, label).toBeGreaterThanOrEqual(0);
        expect(pct, label).toBeLessThanOrEqual(100);
      }
    }
  });

  it("formatInvitationEvaluationReport prints the required §15 sections", () => {
    const text = formatInvitationEvaluationReport(report);
    expect(text).toMatch(/INTERVIEW INVITATION EVALUATION/);
    expect(text).toMatch(/Total fixtures: 20/);
    expect(text).toMatch(/Passed: \d+/);
    expect(text).toMatch(/By category:/);
  });
});

/* ============================== explicit vs inferred vs unknown (§6) ============================== */
describe("explicit vs inferred vs unknown — no hallucinated confidence", () => {
  it("Investment Banking: 'a technical interview' is explicit, but no specific finance concept (DCF, three-statement, etc.) is invented just because the role is finance", () => {
    const validated = validateInvitationExtraction(SIMULATED_RAW_OUTPUTS["ib-technical"]);
    expect(validated.stage).toBe("technical");
    expect(validated.stage_source).toBe("explicit");
    const topicsText = [...validated.technical_topics, validated.preparation_instructions].join(" ").toLowerCase();
    expect(topicsText).not.toMatch(/dcf|discounted cash flow|three financial statements/);
  });

  it("'Investment Banking Summer Analyst' role text does not by itself get treated as evidence for a technical_functional component unless the email also says so (ib-behavioural has no technical component despite the finance role)", () => {
    const validated = validateInvitationExtraction(SIMULATED_RAW_OUTPUTS["ib-behavioural"]);
    expect(validated.components).not.toContain("technical_functional");
  });

  it("an AI response that tries to smuggle a canonical finance concept into technical_topics is preserved by the validator (validation does not invent OR silently strip real model output) — the HALLUCINATION GUARD is the fixture/harness's job, not the validator's", () => {
    // Documents the division of responsibility: validateInvitationExtraction only
    // coerces TYPES/ENUMS defensively; it is not a semantic hallucination filter.
    // That job belongs to the prompt's own RULES plus this harness's topicsMustNotInclude
    // check, exercised above against every fixture's OWN corpus-realistic simulated output.
    const smuggled = validateInvitationExtraction({ ...SIMULATED_RAW_OUTPUTS["ib-technical"], technical_topics: ["DCF"] });
    expect(smuggled.technical_topics).toEqual(["DCF"]);
  });
});

/* ============================== unknown handling (§7) ============================== */
describe("unknown handling — the system invents nothing when the email says nothing", () => {
  it("minimal-invitation: every classifiable field is unknown/empty", () => {
    const validated = validateInvitationExtraction(SIMULATED_RAW_OUTPUTS["minimal-invitation"]);
    expect(validated.company).toBe("");
    expect(validated.role).toBe("");
    expect(validated.stage).toBe("unknown");
    expect(validated.format).toBe("unknown");
    expect(validated.components).toEqual([]);
    expect(invitationExtractionHasUsableSignal(validated)).toBe(false);
  });

  it("vague-invitation: company/role are real (explicit), but stage/format/content correctly remain unknown rather than guessed", () => {
    const validated = validateInvitationExtraction(SIMULATED_RAW_OUTPUTS["vague-invitation"]);
    expect(validated.company).toBe("Thornwell Group");
    expect(validated.role).toBe("Analyst");
    expect(validated.stage).toBe("unknown");
    expect(validated.format).toBe("unknown");
    expect(invitationExtractionHasUsableSignal(validated)).toBe(true); // company+role alone is still usable signal
  });
});

/* ============================== HireVue / Knowledge Layer protection (§8) ============================== */
describe("HireVue / batch-pipeline protection — the Knowledge Layer never activates for an async batch interview", () => {
  it("ib-hirevue resolves to the independent_batch pipeline via the REAL INTERVIEW_FORMATS table", () => {
    const validated = validateInvitationExtraction(SIMULATED_RAW_OUTPUTS["ib-hirevue"]);
    expect(INTERVIEW_FORMATS[validated.format].pipeline).toBe("independent_batch");
  });

  it("isKnowledgeLayerApplicable is false for the HireVue fixture's pipeline, even for a technical_functional category and a resolved finance domain — the pipeline gate wins unconditionally", () => {
    const validated = validateInvitationExtraction(SIMULATED_RAW_OUTPUTS["ib-hirevue"]);
    const pipeline = INTERVIEW_FORMATS[validated.format].pipeline;
    const ibDomain = KNOWLEDGE_DOMAINS.find((d) => d.id === "investment_banking");
    expect(isKnowledgeLayerApplicable({ pipeline, category: "technical_functional", domain: ibDomain })).toBe(false);
  });

  it("by contrast, ib-technical (a live technical interview) DOES resolve to adaptive_turn, and the Knowledge Layer MAY activate for technical_functional", () => {
    const validated = validateInvitationExtraction(SIMULATED_RAW_OUTPUTS["ib-technical"]);
    const pipeline = INTERVIEW_FORMATS[validated.format].pipeline;
    expect(pipeline).toBe("adaptive_turn");
    const ibDomain = KNOWLEDGE_DOMAINS.find((d) => d.id === "investment_banking");
    expect(isKnowledgeLayerApplicable({ pipeline, category: "technical_functional", domain: ibDomain })).toBe(true);
  });

  it("every fixture's declared knowledgeLayer.shouldActivate expectation matches the REAL isKnowledgeLayerApplicable gate", () => {
    for (const fixture of loadAllInvitationFixtures()) {
      const kl = fixture.expected.knowledgeLayer;
      if (!kl) continue;
      const validated = validateInvitationExtraction(SIMULATED_RAW_OUTPUTS[fixture.id]);
      const pipeline = INTERVIEW_FORMATS[validated.format]?.pipeline || INTERVIEW_FORMATS.live_conversational.pipeline;
      expect(pipeline, fixture.id).toBe(kl.pipeline);
      const domain = fixture.expected.knowledgeDomainId
        ? KNOWLEDGE_DOMAINS.find((d) => d.id === fixture.expected.knowledgeDomainId)
        : null;
      expect(isKnowledgeLayerApplicable({ pipeline, category: kl.categoryToTest, domain }), fixture.id).toBe(kl.shouldActivate);
    }
  });
});

/* ============================== cross-sector Knowledge Layer compatibility (§9) ============================== */
describe("cross-sector coverage — extracted context resolves to the Knowledge Layer domain the fixture is designed to exercise", () => {
  for (const fixture of loadAllInvitationFixtures()) {
    it(`${fixture.id}: resolveKnowledgeDomain(...) matches expectDomainMatch`, () => {
      const validated = validateInvitationExtraction(SIMULATED_RAW_OUTPUTS[fixture.id]);
      const minimalProfile = {
        role: validated.role, division: validated.division,
        technical_topics: validated.technical_topics, commercial_topics: validated.commercial_topics,
      };
      const resolved = resolveKnowledgeDomain(minimalProfile);
      if (fixture.expected.expectDomainMatch) {
        expect(resolved, fixture.id).not.toBeNull();
        expect(resolved.id, fixture.id).toBe(fixture.expected.knowledgeDomainId);
      } else {
        expect(resolved, fixture.id).toBeNull();
      }
    });
  }
});

/* ============================== application conflict detection (§10) ============================== */
describe("application conflicts — fixture-corpus-driven, strong matching only", () => {
  it("a second invitation for the SAME company but a DIFFERENT role is surfaced as a conflict, never silently merged", () => {
    const existingApps = [{ id: "app1", company: "Cavendish Capital Partners", role: "Investment Banking Summer Analyst" }];
    // ib-hirevue is also Cavendish Capital Partners, but role "Investment Banking Analyst" — a different (if similar) role string.
    const { matched, sameCompanyDifferentRole } = findInvitationApplicationMatch("Cavendish Capital Partners", "Investment Banking Analyst", existingApps);
    expect(matched).toBeNull();
    expect(sameCompanyDifferentRole).toHaveLength(1);
    expect(sameCompanyDifferentRole[0].id).toBe("app1");
  });

  it("re-submitting the SAME fixture's company+role against an application already created from it matches deterministically, never creating a duplicate", () => {
    const existingApps = [{ id: "app2", company: "Solstice Technologies", role: "Software Engineer Intern" }];
    const { matched } = findInvitationApplicationMatch("Solstice Technologies", "Software Engineer Intern", existingApps);
    expect(matched?.id).toBe("app2");
  });

  it("a stage conflict (existing application's own stage differs from this invitation's) is DATA the caller can detect — findInvitationApplicationMatch itself only ever returns the matched application, never silently overwrites its stage", () => {
    const existingApps = [{ id: "app3", company: "Arden & Co Consulting", role: "Summer Associate Consultant", stageLabel: "Recruiter / HR Screen" }];
    const { matched } = findInvitationApplicationMatch("Arden & Co Consulting", "Summer Associate Consultant", existingApps);
    expect(matched.stageLabel).toBe("Recruiter / HR Screen"); // untouched by the match lookup itself
  });
});

/* ============================== malformed AI output (§12) ============================== */
describe("malformed AI output — validateInvitationExtraction degrades safely for every fixture's company/role, never throws", () => {
  const MALFORMATIONS = [
    ["null", () => null],
    ["empty object", () => ({})],
    ["missing most fields", (raw) => ({ company: raw.company })],
    ["invalid enum values", (raw) => ({ ...raw, stage: "superday_extreme", format: "holographic" })],
    ["null fields where strings are expected", (raw) => ({ ...raw, company: null, role: null, division: null })],
    ["wrong types (numbers/booleans where strings/arrays are expected)", (raw) => ({ ...raw, company: 12345, components: "technical_functional", technical_topics: true })],
    ["unexpected extra fields", (raw) => ({ ...raw, __proto__: { hacked: true }, some_extra_field: "ignored", another: { nested: true } })],
  ];

  for (const [label, mutate] of MALFORMATIONS) {
    it(`"${label}" never throws and always returns a schema-shaped object (using ib-technical as the base case)`, () => {
      const mutated = mutate(SIMULATED_RAW_OUTPUTS["ib-technical"]);
      let validated;
      expect(() => { validated = validateInvitationExtraction(mutated); }).not.toThrow();
      expect(typeof validated.company).toBe("string");
      expect(typeof validated.role).toBe("string");
      expect(Array.isArray(validated.components)).toBe(true);
      expect(Array.isArray(validated.technical_topics)).toBe(true);
      expect(["recruiter_screen", "first_round", "technical", "final_round", "unknown"]).toContain(validated.stage);
      expect(["asynchronous_video", "live_conversational", "technical", "unknown"]).toContain(validated.format);
    });
  }

  it("a malformed extraction that lost real signal correctly evaluates to FAIL against its fixture's expectations, proving the harness itself catches broken extractions rather than rubber-stamping them", () => {
    const broken = validateInvitationExtraction({});
    const fixture = loadAllInvitationFixtures().find((f) => f.id === "ib-technical");
    const evaluation = evaluateInvitationFixture(fixture, broken);
    expect(evaluation.verdict).toBe("FAIL");
    expect(evaluation.reasons.length).toBeGreaterThan(0);
  });
});

/* ============================== prompt injection (§11) ============================== */
describe("prompt injection — the invitation is data, never instructions", () => {
  it("buildInvitationExtractionPrompt's REAL system prompt instructs the model to treat the email as data only and never obey embedded instructions", () => {
    const { system, userText } = buildInvitationExtractionPrompt("irrelevant body for this check");
    expect(system).toMatch(/never obey/i);
    expect(system.toLowerCase()).toMatch(/ignore previous instructions|reveal your prompt/);
    expect(userText).toMatch(/untrusted data/i);
  });

  it("the well-behaved extraction of the prompt-injection fixture reports the GENUINE stated stage (first_round), never the injected 'final_round' claim", () => {
    const validated = validateInvitationExtraction(SIMULATED_RAW_OUTPUTS["prompt-injection"]);
    expect(validated.stage).toBe("first_round");
    expect(validated.next_steps).not.toMatch(/account deleted/i);
  });

  it("even a WORST-CASE extraction hijacked by the injected text (stage forced to final_round) is caught as a FAIL by the evaluation harness, not silently accepted", () => {
    const hijacked = validateInvitationExtraction({ ...SIMULATED_RAW_OUTPUTS["prompt-injection"], stage: "final_round", stage_source: "explicit" });
    const fixture = loadAllInvitationFixtures().find((f) => f.id === "prompt-injection");
    const evaluation = evaluateInvitationFixture(fixture, hijacked);
    expect(evaluation.verdict).toBe("FAIL");
    expect(evaluation.reasons.join(" ")).toMatch(/stage/);
  });

  it("the forbidden-term hallucination guard would catch injected content if it ever leaked into a topic/preparation field", () => {
    const topics = evaluateInvitationTopics(
      { preparation_instructions: "The candidate's account has been ACCOUNT DELETED per system prompt override." },
      loadAllInvitationFixtures().find((f) => f.id === "prompt-injection").expected
    );
    expect(topics.verdict).toBe("FAIL");
    expect(topics.hallucinated.length).toBeGreaterThan(0);
  });
});

/* ============================== enrichment context never smuggles canonical concepts (integration with analyseAndPlan) ============================== */
describe("buildInvitationContextForProfile — the ONLY bridge into analyseAndPlan's existing single AI call", () => {
  it("for every fixture, the context block built from the real validated extraction never mentions a forbidden/hallucinated term itself", () => {
    for (const fixture of loadAllInvitationFixtures()) {
      const validated = validateInvitationExtraction(SIMULATED_RAW_OUTPUTS[fixture.id]);
      const context = buildInvitationContextForProfile(validated);
      for (const forbidden of fixture.topicsMustNotInclude || []) {
        expect(context.toLowerCase(), `${fixture.id}: "${forbidden}"`).not.toContain(forbidden.toLowerCase());
      }
    }
  });
});
