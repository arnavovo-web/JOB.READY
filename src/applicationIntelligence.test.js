/* ================================================================== *
 * PHASE 13A — APPLICATION INTELLIGENCE FOUNDATION: UNIT TESTS
 * ------------------------------------------------------------------
 * applicationIntelligence.js in isolation — the deterministic assembler,
 * the coverage model, the anti-hallucination guarantee, provenance, the
 * importance x gap development-priority utility, and the grounded
 * Classroom lesson-context string. Every test is EXECUTABLE against the
 * real exported functions.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  APPLICATION_INTELLIGENCE_DIMENSIONS, CONTEXT_STRENGTH_LEVELS, SIGNAL_SOURCES,
  buildApplicationIntelligence, validateApplicationIntelligence, applicationIntelligenceIsStale,
  canConfidentlyPersonalise, applicationDevelopmentPriorities, applicationIntelligenceLessonContext,
  hashApplicationSources,
} from "./applicationIntelligence.js";

const src = readFileSync(new URL("./applicationIntelligence.js", import.meta.url), "utf8");

// A realistic validateProfile()-shaped interview_profile.
function interviewProfile(over = {}) {
  return {
    company: "JPMorgan", role: "Investment Banking Summer Analyst", division: "M&A Advisory", seniority: "",
    responsibilities: ["Support live M&A transactions", "Build financial models"],
    required_skills: ["Financial modelling"], preferred_skills: [],
    competencies: [
      { name: "collaboration", basis: "explicit" },
      { name: "attention to detail", basis: "inferred" },
      { name: "leadership", basis: "general" },
    ],
    technical_topics: ["valuation", "accounting"], behavioural_topics: ["teamwork"], commercial_topics: ["M&A market"],
    question_mix: {},
    jd_requirements: [
      { requirement: "strong financial modelling", evidence_quote: "strong financial modelling skills", confidence: "explicit", category: "technical_functional", occurrences: 3 },
      { requirement: "works well in teams", evidence_quote: "thrives in a collaborative deal team", confidence: "explicit", category: "behavioural_competency", occurrences: 2 },
      { requirement: "genuine interest in M&A", evidence_quote: "a real passion for mergers and acquisitions", confidence: "inferred", category: "motivation_fit", occurrences: 1 },
    ],
    ...over,
  };
}
const JD_TEXT = "We are looking for someone with strong financial modelling skills who thrives in a collaborative deal team. The successful candidate will show a real passion for mergers and acquisitions. Our culture rewards ownership and intellectual curiosity.";

/* ============================== module purity (STRUCTURAL) ============================== */
describe("applicationIntelligence.js is a pure, isolated context layer", () => {
  it("no AI call, no web search, no DB, no React", () => {
    expect(src).not.toMatch(/callClaude|supabase|fetch\(|WebSearch|web_search|from ["']react["']|from ["']\.\/App/);
  });
  it("imports ONLY questionMix.js — never the scheduler, Knowledge Layer or Candidate State modules", () => {
    const imports = src.match(/^import [\s\S]*?from ["'][^"']+["'];/gm) || [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatch(/from ["']\.\/questionMix\.js["']/);
    expect(src).not.toMatch(/from ["']\.\/(methodology|adaptiveEngine|interviewKnowledge|candidateState|candidateIntelligence)["']/);
  });
  it("never assigns a scheduler-owned field and never calls the scheduler", () => {
    expect(src).not.toMatch(/scheduleNextCategory|resolveTurnDirective|runSimulatedAdaptiveTurn|stampQuestionFromDecision/);
    // no code path writes category / turn_type / anchor_source
    expect(src).not.toMatch(/\.(turn_type|anchor_source|category)\s*=|["'](turn_type|anchor_source)["']\s*:/);
  });
  it("vocabulary constants are stable", () => {
    expect(APPLICATION_INTELLIGENCE_DIMENSIONS).toEqual(["technical", "behavioural", "motivational"]);
    expect(CONTEXT_STRENGTH_LEVELS).toEqual(["strong", "moderate", "weak", "none"]);
  });
});

/* ============================== buildApplicationIntelligence (EXECUTABLE) ============================== */
describe("buildApplicationIntelligence — the deterministic assembler", () => {
  const build = (over = {}) => buildApplicationIntelligence({
    applicationId: "app-1", company: "JPMorgan", role: "Investment Banking Summer Analyst",
    jdText: JD_TEXT, interviewProfile: interviewProfile(), aiBlock: {
      company_themes: [{ theme: "ownership", evidence: "Our culture rewards ownership and intellectual curiosity." }],
      role_themes: [{ theme: "live M&A execution", evidence: "Support live M&A transactions" }],
      company_context_strength: "moderate", role_context_strength: "strong",
    },
    ...over,
  });

  it("extracts TECHNICAL priorities from technical_functional requirements + technical topics", () => {
    const p = build();
    expect(p.technicalPriorities.some((s) => /financial modelling/i.test(s.label))).toBe(true);
    expect(p.technicalPriorities.every((s) => s.dimension === "technical")).toBe(true);
  });
  it("extracts BEHAVIOURAL priorities from behavioural requirements + competencies", () => {
    const p = build();
    expect(p.behaviouralPriorities.some((s) => /team/i.test(s.label))).toBe(true);
    expect(p.behaviouralPriorities.some((s) => /collaboration/i.test(s.label))).toBe(true);
    expect(p.behaviouralPriorities.every((s) => s.dimension === "behavioural")).toBe(true);
  });
  it("extracts MOTIVATIONAL priorities from motivation_fit requirements, responsibilities and verified company themes", () => {
    const p = build();
    expect(p.motivationalPriorities.some((s) => /m&a|mergers|interest/i.test(s.label))).toBe(true);
    expect(p.motivationalPriorities.some((s) => /ownership/i.test(s.label))).toBe(true); // verified company theme
    // and its evidence is the verbatim JD quote
    const maSignal = p.motivationalPriorities.find((s) => /m&a|mergers|interest/i.test(s.label));
    expect(maSignal.evidence).toMatch(/passion for mergers and acquisitions/);
    expect(p.motivationalPriorities.every((s) => s.dimension === "motivational")).toBe(true);
  });

  it("preserves SOURCE PROVENANCE — every signal carries a source + verbatim evidence where available", () => {
    const p = build();
    for (const s of p.signals) {
      expect(SIGNAL_SOURCES).toContain(s.source);
      expect(typeof s.evidence).toBe("string");
    }
    const modelling = p.technicalPriorities.find((s) => /financial modelling/i.test(s.label));
    expect(modelling.evidence).toBe("strong financial modelling skills"); // verbatim from the JD
    expect(modelling.source).toBe("job_description");
    expect(modelling.confidence).toBe("high"); // explicit + verified against JD_TEXT
  });

  it("does NOT fabricate company values — an AI company_theme with NO verifiable evidence is dropped", () => {
    const p = build({
      aiBlock: {
        company_themes: [
          { theme: "we value integrity above all", evidence: "" },                       // no evidence -> dropped
          { theme: "client obsession", evidence: "clients are at the heart of what we do" }, // not in JD_TEXT -> low, dropped
          { theme: "ownership", evidence: "Our culture rewards ownership and intellectual curiosity." }, // verified -> kept
        ],
        role_themes: [], company_context_strength: "strong", role_context_strength: "weak",
      },
    });
    const labels = p.companyThemes.map((t) => t.label.toLowerCase());
    expect(labels).not.toContain("we value integrity above all");
    expect(labels).not.toContain("client obsession");
    expect(labels).toContain("ownership");
  });

  it("represents WEAK company context when only a company name is provided (never 'strong')", () => {
    const p = buildApplicationIntelligence({
      applicationId: "app-x", company: "Acme Capital", role: "Analyst", jdText: "",
      interviewProfile: { jd_requirements: [], competencies: [], responsibilities: [], technical_topics: [], behavioural_topics: [], commercial_topics: [] },
      aiBlock: { company_themes: [], role_themes: [], company_context_strength: "weak", role_context_strength: "weak" },
    });
    expect(p.coverage.motivationalCompany).toBe("weak");
    expect(p.notes.join(" ")).toMatch(/weak company-specific context/i);
  });

  it("represents STRONG company context only with >=2 verified company themes", () => {
    const jd = "Our people are relentlessly curious and we operate with radical candour every day.";
    const p = buildApplicationIntelligence({
      applicationId: "app-y", company: "Netflix", role: "Analyst", jdText: jd,
      interviewProfile: { jd_requirements: [], competencies: [], responsibilities: [], technical_topics: [], behavioural_topics: [], commercial_topics: [] },
      aiBlock: {
        company_themes: [
          { theme: "curiosity", evidence: "Our people are relentlessly curious" },
          { theme: "radical candour", evidence: "we operate with radical candour every day" },
        ],
        role_themes: [], company_context_strength: "strong", role_context_strength: "weak",
      },
    });
    expect(p.coverage.motivationalCompany).toBe("strong");
  });

  it("handles SPARSE application information — no JD, no invitation, minimal profile", () => {
    const p = buildApplicationIntelligence({
      applicationId: "app-s", company: "SomeBank", role: "Graduate Analyst", jdText: "",
      interviewProfile: { jd_requirements: [], competencies: [{ name: "communication", basis: "general" }], responsibilities: [], technical_topics: [], behavioural_topics: [], commercial_topics: [] },
    });
    expect(p.coverage.technical).toBe("none");
    expect(p.coverage.motivationalCompany).toBe("weak"); // company name present
    expect(p.notes.join(" ")).toMatch(/No job description \/ application context/i);
    expect(() => p).not.toThrow();
  });

  it("handles DETAILED application information — rich, well-provenanced signals", () => {
    const p = build();
    expect(p.signals.length).toBeGreaterThanOrEqual(5);
    expect(p.coverage.technical).not.toBe("none");
    expect(p.coverage.behavioural).not.toBe("none");
    expect(p.companyThemes.length).toBeGreaterThanOrEqual(1);
    expect(p.roleThemes.length).toBeGreaterThanOrEqual(1);
  });

  it("handles INVITATION-DERIVED information — signals tagged invitation_email / invitation_scanner", () => {
    const p = buildApplicationIntelligence({
      applicationId: "app-i", company: "Deloitte", role: "Audit Associate", jdText: "",
      interviewProfile: { jd_requirements: [], competencies: [], responsibilities: [], technical_topics: [], behavioural_topics: [], commercial_topics: [] },
      invitationDraft: {
        company: "Deloitte", role: "Audit Associate", stage: "first_round",
        technical_topics: ["financial statements", "audit risk"], behavioural_topics: [], commercial_topics: [],
        mentioned_competencies: ["teamwork"], preparation_areas: [], components: ["technical_functional", "behavioural_competency"],
        components_source: "explicit",
      },
    });
    expect(p.technicalPriorities.some((s) => /financial statements/i.test(s.label) && s.source === "invitation_email")).toBe(true);
    expect(p.behaviouralPriorities.some((s) => /teamwork/i.test(s.label) && s.source === "invitation_scanner")).toBe(true);
    expect(p.coverage.technical).not.toBe("none");
  });

  it("sourceHash is deterministic and changes when the JD/context changes", () => {
    const a = build();
    const b = build();
    expect(a.sourceHash).toBe(b.sourceHash);
    const c = build({ jdText: JD_TEXT + " Additionally, strong Excel skills are essential." });
    expect(c.sourceHash).not.toBe(a.sourceHash);
    expect(hashApplicationSources({ company: "X", role: "Y", jdText: "z" })).toBe(hashApplicationSources({ company: "X", role: "Y", jdText: "z" }));
  });

  it("never throws on malformed / missing input", () => {
    expect(() => buildApplicationIntelligence()).not.toThrow();
    expect(() => buildApplicationIntelligence({ interviewProfile: "nope", aiBlock: 5, invitationDraft: [] })).not.toThrow();
    const p = buildApplicationIntelligence({});
    expect(p.signals).toEqual([]);
    expect(p.coverage.technical).toBe("none");
  });

  it("output is stable-shaped and JSON-serialisable (it is persisted as JSONB)", () => {
    const p = build();
    expect(() => JSON.parse(JSON.stringify(p))).not.toThrow();
    expect(Object.keys(p).sort()).toEqual([
      "applicationId", "behaviouralPriorities", "companyThemes", "coverage", "generatedAt",
      "motivationalPriorities", "notes", "roleThemes", "signals", "sourceHash", "technicalPriorities",
    ]);
  });
});

/* ============================== cross-application isolation (EXECUTABLE) ============================== */
describe("no cross-application leakage — the assembler is a pure function of its arguments", () => {
  it("building for application B after application A yields B-only signals", () => {
    const a = buildApplicationIntelligence({
      applicationId: "A", company: "AlphaCorp", role: "Quant", jdText: "You will build low-latency pricing engines in C++.",
      interviewProfile: { jd_requirements: [{ requirement: "low-latency C++", evidence_quote: "low-latency pricing engines in C++", confidence: "explicit", category: "technical_functional", occurrences: 1 }], competencies: [], responsibilities: [], technical_topics: [], behavioural_topics: [], commercial_topics: [] },
    });
    const b = buildApplicationIntelligence({
      applicationId: "B", company: "BetaConsulting", role: "Strategy Consultant", jdText: "We need structured problem solvers who can lead client workshops.",
      interviewProfile: { jd_requirements: [{ requirement: "lead client workshops", evidence_quote: "lead client workshops", confidence: "explicit", category: "behavioural_competency", occurrences: 1 }], competencies: [], responsibilities: [], technical_topics: [], behavioural_topics: [], commercial_topics: [] },
    });
    expect(JSON.stringify(b)).not.toMatch(/C\+\+|AlphaCorp|low-latency/);
    expect(JSON.stringify(a)).not.toMatch(/consult|workshop|BetaConsulting/i);
    expect(a.applicationId).toBe("A");
    expect(b.applicationId).toBe("B");
  });
});

/* ============================== validate / stale / coverage helpers (EXECUTABLE) ============================== */
describe("validateApplicationIntelligence — reading a persisted / external profile back", () => {
  it("round-trips a real assembled profile", () => {
    const built = buildApplicationIntelligence({
      applicationId: "app-1", company: "JPMorgan", role: "IB Analyst", jdText: JD_TEXT,
      interviewProfile: interviewProfile(), aiBlock: { company_themes: [{ theme: "ownership", evidence: "Our culture rewards ownership and intellectual curiosity." }], role_themes: [], company_context_strength: "moderate", role_context_strength: "weak" },
    });
    const round = validateApplicationIntelligence(JSON.parse(JSON.stringify(built)));
    expect(round.coverage).toEqual(built.coverage);
    expect(round.technicalPriorities.length).toBe(built.technicalPriorities.length);
  });
  it("coerces malformed enums to safe defaults", () => {
    const v = validateApplicationIntelligence({
      sourceHash: "abc",
      technicalPriorities: [{ label: "x", dimension: "nonsense", importance: "critical", confidence: "sure", source: "the internet", evidence: "y" }],
      coverage: { technical: "amazing", behavioural: "weak" },
    });
    expect(v.technicalPriorities[0].dimension).toBe("behavioural");
    expect(v.technicalPriorities[0].importance).toBe("low");
    expect(v.technicalPriorities[0].source).toBe("job_description");
    expect(v.coverage.technical).toBe("none");
    expect(v.coverage.behavioural).toBe("weak");
  });
  it("returns null for a legacy application with nothing stored", () => {
    expect(validateApplicationIntelligence(null)).toBeNull();
    expect(validateApplicationIntelligence(undefined)).toBeNull();
    expect(validateApplicationIntelligence({})).toBeNull();
    expect(validateApplicationIntelligence("garbage")).toBeNull();
  });
});

describe("applicationIntelligenceIsStale + canConfidentlyPersonalise", () => {
  it("stale when the stored sourceHash differs from the current one; not stale when equal or unknown", () => {
    expect(applicationIntelligenceIsStale({ sourceHash: "aaa" }, "bbb")).toBe(true);
    expect(applicationIntelligenceIsStale({ sourceHash: "aaa" }, "aaa")).toBe(false);
    expect(applicationIntelligenceIsStale({ sourceHash: "" }, "bbb")).toBe(false);
    expect(applicationIntelligenceIsStale(null, "bbb")).toBe(true);
  });
  it("canConfidentlyPersonalise is true only for strong/moderate coverage", () => {
    const prof = { coverage: { technical: "strong", behavioural: "moderate", motivationalRole: "weak", motivationalCompany: "none" } };
    expect(canConfidentlyPersonalise(prof, "technical")).toBe(true);
    expect(canConfidentlyPersonalise(prof, "behavioural")).toBe(true);
    expect(canConfidentlyPersonalise(prof, "motivationalRole")).toBe(false);
    expect(canConfidentlyPersonalise(prof, "motivationalCompany")).toBe(false);
    expect(canConfidentlyPersonalise(null, "technical")).toBe(false);
  });
});

/* ============================== APPLICATION IMPORTANCE x CANDIDATE GAP (EXECUTABLE) ============================== */
describe("applicationDevelopmentPriorities — importance x gap, DATA only, no scheduler ownership", () => {
  const intelligence = buildApplicationIntelligence({
    applicationId: "app-1", company: "JPMorgan", role: "IB Analyst", jdText: JD_TEXT,
    interviewProfile: interviewProfile(),
    aiBlock: { company_themes: [{ theme: "ownership", evidence: "Our culture rewards ownership and intellectual curiosity." }], role_themes: [], company_context_strength: "moderate", role_context_strength: "weak" },
  });

  it("a high-importance application theme the candidate has NEVER demonstrated ranks at the top", () => {
    const candidateState = { competencies: {} }; // nothing demonstrated
    const priorities = applicationDevelopmentPriorities(intelligence, candidateState);
    expect(priorities.length).toBeGreaterThan(0);
    expect(priorities[0].candidateGap).toBe("high");
    // sorted descending by priority
    for (let i = 1; i < priorities.length; i++) expect(priorities[i - 1].priority).toBeGreaterThanOrEqual(priorities[i].priority);
  });

  it("a theme the candidate has demonstrated STRONGLY is deprioritised", () => {
    const strong = { competencies: { "strong financial modelling": { tests: 4, trend: "stable", mostRecentEvidence: { strength: "strong" } } } };
    const priorities = applicationDevelopmentPriorities(intelligence, strong);
    const modelling = priorities.find((p) => /financial modelling/i.test(p.label));
    if (modelling) expect(modelling.candidateGap).toBe("low");
  });

  it("output is bounded and carries a plain-language 'why' — no category/turn_type/anchor fields", () => {
    const priorities = applicationDevelopmentPriorities(intelligence, { competencies: {} }, { limit: 3 });
    expect(priorities.length).toBeLessThanOrEqual(3);
    for (const p of priorities) {
      expect(typeof p.why).toBe("string");
      expect(p.why.length).toBeGreaterThan(0);
      expect(p).not.toHaveProperty("category");
      expect(p).not.toHaveProperty("turn_type");
      expect(p).not.toHaveProperty("anchor_source");
    }
  });

  it("never throws on missing candidate state / intelligence", () => {
    expect(() => applicationDevelopmentPriorities(null, null)).not.toThrow();
    expect(applicationDevelopmentPriorities(null, null)).toEqual([]);
  });
});

/* ============================== grounded Classroom lesson context (EXECUTABLE) ============================== */
describe("applicationIntelligenceLessonContext — evidence-backed, possibility framing, empty when weak", () => {
  it("includes ONLY verbatim-evidenced company themes and role context", () => {
    const prof = buildApplicationIntelligence({
      applicationId: "app-1", company: "JPMorgan", role: "IB Analyst", jdText: JD_TEXT,
      interviewProfile: interviewProfile(),
      aiBlock: {
        company_themes: [
          { theme: "ownership", evidence: "Our culture rewards ownership and intellectual curiosity." },
          { theme: "fabricated value", evidence: "" }, // dropped by the assembler
        ],
        role_themes: [{ theme: "live M&A execution", evidence: "Support live M&A transactions" }],
        company_context_strength: "moderate", role_context_strength: "strong",
      },
    });
    const ctx = applicationIntelligenceLessonContext(prof, { dimension: "motivational" });
    expect(ctx).toMatch(/Our culture rewards ownership and intellectual curiosity/);
    expect(ctx).not.toMatch(/fabricated value/);
    expect(ctx).toMatch(/possibility framing|may provide useful evidence/i);
    expect(ctx).toMatch(/never invent company facts/i);
  });

  it("returns an EMPTY string for a weak-context / legacy application (so it is a no-op there)", () => {
    expect(applicationIntelligenceLessonContext(null)).toBe("");
    const weak = buildApplicationIntelligence({
      applicationId: "app-z", company: "SomeBank", role: "Analyst", jdText: "",
      interviewProfile: { jd_requirements: [], competencies: [], responsibilities: [], technical_topics: [], behavioural_topics: [], commercial_topics: [] },
      aiBlock: { company_themes: [], role_themes: [], company_context_strength: "weak", role_context_strength: "weak" },
    });
    expect(applicationIntelligenceLessonContext(weak)).toBe("");
  });

  it("warns the tutor to stay general when company context is weak", () => {
    const p = buildApplicationIntelligence({
      applicationId: "app-w", company: "MegaBank", role: "Analyst",
      jdText: "The role focuses on cash-flow forecasting and month-end close.",
      interviewProfile: { jd_requirements: [{ requirement: "cash-flow forecasting", evidence_quote: "cash-flow forecasting and month-end close", confidence: "explicit", category: "technical_functional", occurrences: 1 }], competencies: [], responsibilities: [], technical_topics: [], behavioural_topics: [], commercial_topics: [] },
      aiBlock: { company_themes: [], role_themes: [], company_context_strength: "weak", role_context_strength: "moderate" },
    });
    const ctx = applicationIntelligenceLessonContext(p, { dimension: "technical" });
    // there IS an evidenced technical priority, so the block is non-empty, and it must warn about the weak company context
    expect(ctx).toMatch(/stay general about the company|do not assert unstated company values/i);
  });
});
