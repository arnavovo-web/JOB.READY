/* ================================================================== *
 * PHASE 13B — APPLICATION-SPECIFIC DEVELOPMENT & CLASSROOM RECOMMENDATIONS
 * ------------------------------------------------------------------
 * Covers this phase's product push:
 *   (1) applicationDevelopmentPriorities is the ONE source of truth — it is
 *       EXTENDED (gapKind / level / gapSummary / nextStep), never forked. Every
 *       Phase 13A key it already returned is still returned unchanged.
 *   (2) The critical distinction: a "demonstrated gap" (Case A — assessed and
 *       weak) is never confused with an "area to prepare" (Case B — no evidence
 *       yet). Case B language never says the candidate is weak.
 *   (3) Priority levels are conveyed by TEXT as well as an icon (accessibility).
 *   (4) classroomRecommendationGroups is a pure regroup by question-type
 *       dimension — Technical / Behavioural / Motivational stay separated.
 *   (5) Cross-application isolation: two applications with different intelligence
 *       produce independent recommendation sets from the SAME candidate state.
 *   (6) experiencesToExplore is cautious — Fact and Suggestion are separate,
 *       possibility framing only, and it stays silent when there is no CV data.
 *   (7) Legacy applications (no Phase 13A intelligence) degrade gracefully.
 *   (8) The Classroom screen makes NO AI call on render and never touches the
 *       scheduler (STRUCTURAL, App.jsx source inspection).
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildApplicationIntelligence, applicationDevelopmentPriorities,
  classroomRecommendationGroups, experiencesToExplore,
} from "./applicationIntelligence.js";

const APP_SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

/* ---- shared fixtures (same shapes as applicationIntelligence.test.js) ---- */
function interviewProfile(over = {}) {
  return {
    company: "JPMorgan", role: "Investment Banking Summer Analyst", division: "M&A Advisory",
    responsibilities: ["Support live M&A transactions", "Build financial models"],
    required_skills: ["Financial modelling"], preferred_skills: [],
    competencies: [
      { name: "collaboration", basis: "explicit" },
      { name: "attention to detail", basis: "inferred" },
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

const jpmIntel = () => buildApplicationIntelligence({
  applicationId: "app-jpm", company: "JPMorgan", role: "Investment Banking Summer Analyst",
  jdText: JD_TEXT, interviewProfile: interviewProfile(),
  aiBlock: { company_themes: [{ theme: "ownership", evidence: "Our culture rewards ownership and intellectual curiosity." }], role_themes: [] },
});

/* ============================== extension keeps the Phase 13A contract ============================== */
describe("applicationDevelopmentPriorities — still the single source of truth", () => {
  it("keeps every Phase 13A output key and adds the 13B ones", () => {
    const recs = applicationDevelopmentPriorities(jpmIntel(), { competencies: {} });
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      // 13A keys, unchanged
      expect(r).toHaveProperty("label");
      expect(r).toHaveProperty("dimension");
      expect(r).toHaveProperty("applicationImportance");
      expect(["high", "moderate", "low"]).toContain(r.candidateGap);
      expect(typeof r.priority).toBe("number");
      expect(typeof r.why).toBe("string");
      // 13B additions
      expect(typeof r.tested).toBe("boolean");
      expect(["demonstrated", "preparation", "developing", "mixed"]).toContain(r.gapKind);
      expect(typeof r.gapSummary).toBe("string");
      expect(["high", "recommended", "strength", "low"]).toContain(r.level);
      expect(typeof r.levelLabel).toBe("string");
      expect(r.levelLabel.length).toBeGreaterThan(0);
      expect(typeof r.nextStep).toBe("string");
      // never a scheduler-owned field
      expect(r).not.toHaveProperty("category");
      expect(r).not.toHaveProperty("turn_type");
      expect(r).not.toHaveProperty("anchor_source");
    }
  });

  it("is bounded and sorted by priority descending", () => {
    const recs = applicationDevelopmentPriorities(jpmIntel(), { competencies: {} }, { limit: 2 });
    expect(recs.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < recs.length; i++) expect(recs[i - 1].priority).toBeGreaterThanOrEqual(recs[i].priority);
  });

  it("never throws and returns [] on null intelligence / null state (legacy-safe)", () => {
    expect(() => applicationDevelopmentPriorities(null, null)).not.toThrow();
    expect(applicationDevelopmentPriorities(null, null)).toEqual([]);
    expect(applicationDevelopmentPriorities(undefined, { competencies: {} })).toEqual([]);
  });
});

/* ============================== Case A vs Case B — the critical distinction ============================== */
describe("demonstrated gap (Case A) is never confused with area to prepare (Case B)", () => {
  it("no evidence at all -> gapKind 'preparation', tested false, framed as preparation not accusation", () => {
    const recs = applicationDevelopmentPriorities(jpmIntel(), { competencies: {} });
    for (const r of recs) {
      expect(r.gapKind).toBe("preparation");
      expect(r.tested).toBe(false);
      // explicitly reassuring framing
      expect(r.gapSummary).toMatch(/not a demonstrated weakness/i);
      expect(r.gapSummary).toMatch(/area to prepare/i);
      // never actually accuses the candidate of being weak / poor
      expect(r.gapSummary).not.toMatch(/you (are|have been|were|seem|look)\s+\w*\s*(weak|poor|lacking|bad|deficient)/i);
      expect(r.why).not.toMatch(/you (are|have been|were)\s+\w*\s*(weak|poor)/i);
    }
  });

  it("assessed and weak -> gapKind 'demonstrated', tested true, and it DOES name the gap", () => {
    const state = { competencies: { "strong financial modelling": { tests: 3, trend: "stable", mostRecentEvidence: { strength: "weak" } } } };
    const recs = applicationDevelopmentPriorities(jpmIntel(), state);
    const modelling = recs.find((r) => /financial modelling/i.test(r.label));
    expect(modelling).toBeTruthy();
    expect(modelling.gapKind).toBe("demonstrated");
    expect(modelling.tested).toBe(true);
    expect(modelling.gapSummary).toMatch(/demonstrated gap|weak or inconsistent/i);
    expect(modelling.candidateGap).toBe("high");
  });

  it("assessed and strong -> gapKind 'developing', level 'strength', label 'Developing well'", () => {
    const state = { competencies: { "strong financial modelling": { tests: 4, trend: "improving", mostRecentEvidence: { strength: "strong" } } } };
    // wide limit: a well-developed strength is correctly pushed down the ranking,
    // so ask for enough items to still see it.
    const recs = applicationDevelopmentPriorities(jpmIntel(), state, { limit: 30 });
    const modelling = recs.find((r) => /financial modelling/i.test(r.label));
    expect(modelling).toBeTruthy();
    expect(modelling.gapKind).toBe("developing");
    expect(modelling.level).toBe("strength");
    expect(modelling.levelLabel).toBe("Developing well");
    expect(modelling.candidateGap).toBe("low");
  });

  it("an untested item is never labelled 'Developing well' just because its priority is low", () => {
    // low-importance untested theme -> low priority, but it is still a preparation area
    const recs = applicationDevelopmentPriorities(jpmIntel(), { competencies: {} });
    for (const r of recs) {
      if (r.levelLabel === "Developing well") expect(r.gapKind).toBe("developing");
    }
  });
});

/* ============================== priority levels carry text, not colour only ============================== */
describe("priority levels are accessible (icon + text label)", () => {
  it("high-priority item exposes an icon AND a distinct text label", () => {
    const recs = applicationDevelopmentPriorities(jpmIntel(), { competencies: {} });
    const top = recs[0];
    expect(top.levelIcon).toBeTruthy();
    expect(top.levelIcon).not.toBe(top.levelLabel);
    expect(["High priority", "Recommended", "Lower priority for now"]).toContain(top.levelLabel);
  });
});

/* ============================== question-type separation ============================== */
describe("classroomRecommendationGroups — Technical / Behavioural / Motivational stay separated", () => {
  it("groups every recommendation under its own dimension, nothing lost or duplicated", () => {
    const g = classroomRecommendationGroups(jpmIntel(), { competencies: {} });
    const regrouped = [...g.technical, ...g.behavioural, ...g.motivational];
    expect(regrouped.length).toBe(g.all.length);
    for (const r of g.technical) expect(r.dimension).toBe("technical");
    for (const r of g.behavioural) expect(r.dimension).toBe("behavioural");
    for (const r of g.motivational) expect(r.dimension).toBe("motivational");
  });

  it("a behavioural-only application produces no technical recommendations", () => {
    const behaviouralOnly = buildApplicationIntelligence({
      applicationId: "app-b", company: "Acme", role: "Graduate Scheme",
      jdText: "We want someone who thrives in a collaborative deal team and communicates clearly.",
      interviewProfile: interviewProfile({
        technical_topics: [], commercial_topics: [], jd_requirements: [
          { requirement: "works well in teams", evidence_quote: "thrives in a collaborative deal team", confidence: "explicit", category: "behavioural_competency" },
        ],
      }),
      aiBlock: {},
    });
    const g = classroomRecommendationGroups(behaviouralOnly, { competencies: {} });
    expect(g.technical.length).toBe(0);
    expect(g.behavioural.length).toBeGreaterThan(0);
  });

  it("hasAny is false and limitedContext is true for null intelligence (legacy application)", () => {
    const g = classroomRecommendationGroups(null, { competencies: {} });
    expect(g.hasAny).toBe(false);
    expect(g.limitedContext).toBe(true);
    expect(g.technical).toEqual([]);
    expect(g.behavioural).toEqual([]);
    expect(g.motivational).toEqual([]);
  });

  it("limitedContext is true when the application's own coverage model is thin", () => {
    const thin = buildApplicationIntelligence({
      applicationId: "app-thin", company: "MysteryCo", role: "Analyst",
      jdText: "", interviewProfile: { competencies: [], jd_requirements: [] }, aiBlock: {},
    });
    const g = classroomRecommendationGroups(thin, { competencies: {} });
    expect(g.limitedContext).toBe(true);
  });
});

/* ============================== cross-application isolation ============================== */
describe("recommendations for one application never leak into another", () => {
  const consulting = buildApplicationIntelligence({
    applicationId: "app-consult", company: "BizStrat", role: "Strategy Consultant",
    jdText: "You will structure ambiguous client problems, build hypotheses and present recommendations to senior stakeholders.",
    interviewProfile: interviewProfile({
      division: "", responsibilities: ["Structure client problems", "Present to stakeholders"],
      technical_topics: [], commercial_topics: ["market sizing"],
      competencies: [{ name: "structured problem solving", basis: "explicit" }, { name: "stakeholder communication", basis: "explicit" }],
      jd_requirements: [
        { requirement: "structure ambiguous problems", evidence_quote: "structure ambiguous client problems", confidence: "explicit", category: "technical_functional" },
        { requirement: "present to senior stakeholders", evidence_quote: "present recommendations to senior stakeholders", confidence: "explicit", category: "behavioural_competency" },
      ],
    }),
    aiBlock: {},
  });

  it("the same candidate state yields different, application-specific recommendation labels", () => {
    const state = { competencies: {} };
    const jpm = classroomRecommendationGroups(jpmIntel(), state).all.map((r) => r.label.toLowerCase());
    const con = classroomRecommendationGroups(consulting, state).all.map((r) => r.label.toLowerCase());
    // JPMorgan surfaces financial modelling / M&A; consulting surfaces problem structuring
    expect(jpm.some((l) => /financial modelling|m&a|mergers/.test(l))).toBe(true);
    expect(jpm.some((l) => /structure ambiguous|senior stakeholders/.test(l))).toBe(false);
    expect(con.some((l) => /structure ambiguous|stakeholder/.test(l))).toBe(true);
    expect(con.some((l) => /financial modelling|mergers and acquisitions/.test(l))).toBe(false);
  });

  it("a competency the candidate has shown well is deprioritised for BOTH applications consistently", () => {
    const strong = { competencies: {
      "strong financial modelling": { tests: 3, trend: "stable", mostRecentEvidence: { strength: "strong" } },
      "structure ambiguous problems": { tests: 3, trend: "stable", mostRecentEvidence: { strength: "strong" } },
    } };
    const jpm = classroomRecommendationGroups(jpmIntel(), strong).all.find((r) => /financial modelling/i.test(r.label));
    const con = classroomRecommendationGroups(consulting, strong).all.find((r) => /structure ambiguous/i.test(r.label));
    if (jpm) expect(jpm.gapKind).toBe("developing");
    if (con) expect(con.gapKind).toBe("developing");
  });
});

/* ============================== cautious CV suggestion layer ============================== */
describe("experiencesToExplore — Fact vs Suggestion, possibility framing, silent without data", () => {
  const recs = [
    { label: "strong financial modelling", dimension: "technical", evidence: "strong financial modelling skills" },
    { label: "works well in teams", dimension: "behavioural", evidence: "thrives in a collaborative deal team" },
  ];

  it("returns [] when there is no CV or claim material (never says 'you have no experience')", () => {
    expect(experiencesToExplore({}, recs)).toEqual([]);
    expect(experiencesToExplore({ candidateProfile: { experience: [] }, claims: [] }, recs)).toEqual([]);
  });

  it("matches on shared vocabulary and separates Fact from Suggestion", () => {
    const out = experiencesToExplore({
      candidateProfile: { experience: ["Built a three-statement financial modelling deck for a mock LBO"] },
      claims: [],
    }, recs);
    expect(out.length).toBeGreaterThan(0);
    const hit = out[0];
    expect(hit.fact.startsWith('Your CV mentions: "')).toBe(true);
    expect(hit.suggestion.startsWith("Consider whether")).toBe(true);
    expect(hit.recommendationLabel).toBe("strong financial modelling");
    expect(hit.sourceKind).toBe("experience");
  });

  it("never emits assertion language", () => {
    const out = experiencesToExplore({
      candidateProfile: {
        experience: ["Led a collaborative deal team project across three universities"],
        achievements: ["Won a financial modelling competition"],
      },
      claims: [{ claim_text: "Ran teamwork workshops for a student society" }],
    }, recs, { limit: 5 });
    for (const h of out) {
      const blob = `${h.fact} ${h.suggestion}`.toLowerCase();
      expect(blob).not.toMatch(/this proves|demonstrates that you|you are strong|shows you have|confirms you/);
    }
  });

  it("each CV entry is used at most once across recommendations", () => {
    const out = experiencesToExplore({
      candidateProfile: { experience: ["Financial modelling and teamwork on a joint project"] },
      claims: [],
    }, recs, { limit: 5 });
    const facts = out.map((h) => h.fact);
    expect(new Set(facts).size).toBe(facts.length);
  });
});

/* ============================== STRUCTURAL — Classroom render is cheap & safe ============================== */
describe("Classroom screen (App.jsx) — no AI call on render, no scheduler contact", () => {
  const start = APP_SRC.indexOf('{screen === "classroom" && (');
  const end = APP_SRC.indexOf('{screen === "classroom_generating"', start);
  const CLASSROOM_SRC = APP_SRC.slice(start, end);

  it("the classroom screen block was found", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it("renders recommendations from persisted intelligence, not a fresh extraction", () => {
    expect(CLASSROOM_SRC).toMatch(/classroomRecs|classroomRecommendationGroups/);
    expect(CLASSROOM_SRC).not.toMatch(/callClaude|analyseAndPlan|buildApplicationIntelligence\(/);
  });

  it("never assigns a scheduler-owned field in the classroom render path", () => {
    expect(CLASSROOM_SRC).not.toMatch(/\.(turn_type|anchor_source|category)\s*=|["'](turn_type|anchor_source)["']\s*:/);
  });

  it("the recommendation build in the derived block reuses globalCandidateState (no second candidate-state build)", () => {
    const derivedStart = APP_SRC.indexOf("const classroomApps = applicationsWithInterviews.filter");
    expect(derivedStart).toBeGreaterThan(-1);
    const derived = APP_SRC.slice(derivedStart, derivedStart + 900);
    expect(derived).toMatch(/classroomRecommendationGroups\([^)]*globalCandidateState/);
    expect(derived).not.toMatch(/buildCandidateState\(/);
  });

  it("the application selector is a real <select> with an aria-label", () => {
    expect(CLASSROOM_SRC).toMatch(/<select[\s\S]*?aria-label=/);
    expect(CLASSROOM_SRC).toMatch(/setClassroomAppId/);
  });
});
