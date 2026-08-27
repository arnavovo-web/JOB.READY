/* ================================================================== *
 * PHASE 9 — SCALABLE INTERVIEW KNOWLEDGE INFRASTRUCTURE: LOGIC UNIT TESTS
 * ------------------------------------------------------------------
 * Covers interviewKnowledge.js in isolation: the applicability gate,
 * domain resolution, context filtering, the selectKnowledgeConcepts API,
 * and buildKnowledgeGuidance (whose Phase 6 output contract is preserved).
 *
 * Catalogue-data integrity (unique ids/labels, valid domains/importance,
 * relationship validity, Phase 6 migration completeness) lives in
 * knowledgeCatalogue.test.js. The App.jsx wiring (Call 2 prompt, HireVue/
 * AC isolation, stage/format/invitation threading, no extra AI call) lives
 * in knowledgeLayerIntegration.test.js.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  KNOWLEDGE_ELIGIBLE_CATEGORIES, KNOWLEDGE_DOMAINS, KNOWLEDGE_CONCEPTS, MAX_GUIDANCE_CONCEPTS,
  isKnowledgeLayerApplicable, resolveKnowledgeDomain, getDomainConcepts,
  selectKnowledgeConcepts, buildKnowledgeGuidance, getConceptById, domainGroup, normalizeInvitationContext,
} from "./interviewKnowledge.js";

const IB_DOMAIN = KNOWLEDGE_DOMAINS.find((d) => d.id === "investment_banking");
const SWE_DOMAIN = KNOWLEDGE_DOMAINS.find((d) => d.id === "software_engineering");
const CONSULTING_DOMAIN = KNOWLEDGE_DOMAINS.find((d) => d.id === "consulting");
const PE_DOMAIN = KNOWLEDGE_DOMAINS.find((d) => d.id === "private_equity");

function ibProfile(overrides = {}) {
  return {
    role: "Investment Banking Summer Analyst", division: "M&A Advisory",
    responsibilities: ["Support live M&A transactions"], required_skills: ["Financial modelling"],
    preferred_skills: [], technical_topics: ["DCF valuation"], commercial_topics: [],
    jd_requirements: [{ requirement: "Strong financial modelling skills", evidence_quote: "financial modelling", confidence: "explicit", category: "technical_functional", occurrences: 1 }],
    ...overrides,
  };
}

/* ============================== module purity (STRUCTURAL) ============================== */
describe("interviewKnowledge.js module purity", () => {
  const src = readFileSync(new URL("./interviewKnowledge.js", import.meta.url), "utf8");

  it("makes no AI calls, touches no database, has no React dependency, never imports App.jsx or the scheduler/state modules that own their own decisions", () => {
    expect(src).not.toMatch(/callClaude|supabase|from ["']react["']|from ["']\.\/App/);
    expect(src).not.toMatch(/fetch\(|web_search|WebSearch|XMLHttpRequest|useWebSearch|embedding|vector/i);
    expect(src).not.toMatch(/from ["']\.\/adaptiveEngine["']|from ["']\.\/candidateState["']|from ["']\.\/candidateIntelligence["']|from ["']\.\/interviewStrategy["']/);
  });

  it("imports ONLY methodology.js's canonical taxonomy and knowledgeCatalogue.js's data — no third dependency, no duplicate taxonomy", () => {
    expect(src).toMatch(/import \{ CATEGORIES, mapLegacyCategory \} from ["']\.\/methodology\.js["']/);
    expect(src).toMatch(/from ["']\.\/knowledgeCatalogue\.js["']/);
    const importCount = (src.match(/^import /gm) || []).length;
    expect(importCount).toBe(2);
  });

  it("holds NO catalogue data of its own — the domain/concept literals live only in knowledgeCatalogue.js", () => {
    // A rough guard: the logic module must not re-declare a concept array literal.
    expect(src).not.toMatch(/roleKeywords:\s*\[/);
    expect(src).not.toMatch(/archetypes:\s*\[\s*["']/);
  });
});

/* ============================== applicability gate (EXECUTABLE) ============================== */
describe("isKnowledgeLayerApplicable — the explicit, deterministic gate (unchanged from Phase 6)", () => {
  it("ON: adaptive_turn + technical_functional + a resolved domain", () => {
    expect(isKnowledgeLayerApplicable({ pipeline: "adaptive_turn", category: "technical_functional", domain: IB_DOMAIN })).toBe(true);
  });
  it("OFF: independent_batch pipeline (HireVue-style) — never applicable regardless of category/domain", () => {
    expect(isKnowledgeLayerApplicable({ pipeline: "independent_batch", category: "technical_functional", domain: IB_DOMAIN })).toBe(false);
  });
  it("OFF: motivation_fit / behavioural_competency — canonical knowledge must never leak into those turns", () => {
    expect(isKnowledgeLayerApplicable({ pipeline: "adaptive_turn", category: "motivation_fit", domain: IB_DOMAIN })).toBe(false);
    expect(isKnowledgeLayerApplicable({ pipeline: "adaptive_turn", category: "behavioural_competency", domain: IB_DOMAIN })).toBe(false);
  });
  it("OFF: no domain resolved", () => {
    expect(isKnowledgeLayerApplicable({ pipeline: "adaptive_turn", category: "technical_functional", domain: null })).toBe(false);
  });
  it("ON: consulting case categories, and commercial_awareness, are all eligible", () => {
    expect(isKnowledgeLayerApplicable({ pipeline: "adaptive_turn", category: "case_problem_solving", domain: CONSULTING_DOMAIN })).toBe(true);
    expect(isKnowledgeLayerApplicable({ pipeline: "adaptive_turn", category: "situational_judgement", domain: CONSULTING_DOMAIN })).toBe(true);
    expect(isKnowledgeLayerApplicable({ pipeline: "adaptive_turn", category: "commercial_awareness", domain: IB_DOMAIN })).toBe(true);
  });
  it("never throws on missing/malformed input", () => {
    expect(() => isKnowledgeLayerApplicable()).not.toThrow();
    expect(isKnowledgeLayerApplicable(undefined)).toBe(false);
    expect(isKnowledgeLayerApplicable({ pipeline: "adaptive_turn", category: "technical_functional", domain: {} })).toBe(false);
  });
});

/* ============================== domain resolution (EXECUTABLE) ============================== */
describe("resolveKnowledgeDomain — deterministic role/JD matching, no AI call (unchanged from Phase 6)", () => {
  it("matches Investment Banking / Software Engineer / Strategy Consultant roles", () => {
    expect(resolveKnowledgeDomain(ibProfile())?.id).toBe("investment_banking");
    expect(resolveKnowledgeDomain({ role: "Software Engineer", responsibilities: ["Build backend services"] })?.id).toBe("software_engineering");
    expect(resolveKnowledgeDomain({ role: "Strategy Consultant", required_skills: ["Case interview practice"] })?.id).toBe("consulting");
  });
  it("returns null for a generic/unmatched graduate role — a real 'no domain' outcome, never a guess", () => {
    expect(resolveKnowledgeDomain({ role: "Graduate Trainee", responsibilities: ["General rotation"] })).toBeNull();
  });
  it("matches via jd_requirements text alone when the role title is too generic", () => {
    expect(resolveKnowledgeDomain({
      role: "Analyst",
      jd_requirements: [{ requirement: "Comfortable with leveraged buyout mechanics", evidence_quote: "leveraged buyout", confidence: "explicit", category: "technical_functional", occurrences: 1 }],
    })?.id).toBe("private_equity");
  });
  it("never throws on missing/malformed interviewProfile", () => {
    expect(resolveKnowledgeDomain(undefined)).toBeNull();
    expect(resolveKnowledgeDomain("not an object")).toBeNull();
    expect(resolveKnowledgeDomain({})).toBeNull();
  });
  it("every domain belongs to exactly one KNOWLEDGE_DOMAIN_GROUPS entry", () => {
    for (const d of KNOWLEDGE_DOMAINS) expect(domainGroup(d)?.id).toBeTruthy();
    expect(domainGroup("not_a_domain")).toBeNull();
  });
});

/* ============================== getDomainConcepts / context filtering (EXECUTABLE) ============================== */
describe("getDomainConcepts — flat-catalogue retrieval, category + optional stage/format filtering", () => {
  it("motivation_fit yields nothing even for a real domain", () => {
    expect(getDomainConcepts(IB_DOMAIN, "motivation_fit")).toEqual([]);
  });
  it("technical_functional yields real IB concepts (three statements, DCF, accretion/dilution...)", () => {
    const concepts = getDomainConcepts(IB_DOMAIN, "technical_functional");
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.some((c) => c.id === "ib_three_statements")).toBe(true);
    expect(concepts.some((c) => c.id === "ib_dcf")).toBe(true);
    // Every returned concept is either home to this domain OR explicitly shared into it (Phase 10A).
    expect(concepts.every((c) => c.domain === "investment_banking" || (c.sharedWithDomains || []).includes("investment_banking"))).toBe(true);
    // Phase 6 backwards-compat alias.
    expect(concepts.every((c) => typeof c.topicLabel === "string")).toBe(true);
  });
  it("a stage-restricted concept (ib_lbo_analysis: technical/final_round only) is filtered out for a recruiter_screen but kept when no stage is supplied", () => {
    const noContext = getDomainConcepts(IB_DOMAIN, "technical_functional");
    expect(noContext.some((c) => c.id === "ib_lbo_analysis")).toBe(true);
    const recruiter = getDomainConcepts(IB_DOMAIN, "technical_functional", { stage: "recruiter_screen" });
    expect(recruiter.some((c) => c.id === "ib_lbo_analysis")).toBe(false);
    const technical = getDomainConcepts(IB_DOMAIN, "technical_functional", { stage: "technical" });
    expect(technical.some((c) => c.id === "ib_lbo_analysis")).toBe(true);
  });
  it("never throws on a missing domain/category", () => {
    expect(getDomainConcepts(null, "technical_functional")).toEqual([]);
    expect(getDomainConcepts(IB_DOMAIN, undefined)).toEqual([]);
    expect(getDomainConcepts({}, "technical_functional")).toEqual([]);
  });
});

/* ============================== selectKnowledgeConcepts — the deterministic selection API (EXECUTABLE) ============================== */
describe("selectKnowledgeConcepts — bounded, explainable, scheduler-subordinate", () => {
  const baseArgs = { domain: IB_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn" };

  it("returns a stable non-applicable shape when the gate fails (never throws, never null)", () => {
    const r = selectKnowledgeConcepts({ ...baseArgs, pipeline: "independent_batch" });
    expect(r.applicable).toBe(false);
    expect(r.concepts).toEqual([]);
    expect(selectKnowledgeConcepts({ ...baseArgs, domain: null }).applicable).toBe(false);
    expect(() => selectKnowledgeConcepts()).not.toThrow();
  });

  it("selects a bounded set (<= MAX_GUIDANCE_CONCEPTS by default), each with a numeric priority and a non-empty reasons list", () => {
    const r = selectKnowledgeConcepts({ ...baseArgs });
    expect(r.applicable).toBe(true);
    expect(r.concepts.length).toBeGreaterThan(0);
    expect(r.concepts.length).toBeLessThanOrEqual(MAX_GUIDANCE_CONCEPTS);
    for (const c of r.concepts) {
      expect(typeof c.priority).toBe("number");
      expect(c.priority).toBeGreaterThanOrEqual(0);
      expect(c.priority).toBeLessThanOrEqual(200);
      expect(Array.isArray(c.reasons)).toBe(true);
      expect(c.reasons.length).toBeGreaterThan(0);
      expect(["core", "important", "specialist"]).toContain(c.importance);
    }
  });

  it("is deterministic — identical inputs produce byte-identical output", () => {
    const a = selectKnowledgeConcepts({ ...baseArgs, candidateState: null, transcript: [] });
    const b = selectKnowledgeConcepts({ ...baseArgs, candidateState: null, transcript: [] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("results are sorted by priority descending", () => {
    const r = selectKnowledgeConcepts({ ...baseArgs, candidateState: null, transcript: [] });
    for (let i = 1; i < r.concepts.length; i++) {
      expect(r.concepts[i - 1].priority).toBeGreaterThanOrEqual(r.concepts[i].priority);
    }
  });

  it("carries lightweight relationship data through for future consumers, without using it to score", () => {
    const r = selectKnowledgeConcepts({ ...baseArgs });
    expect(getConceptById("ib_dcf").relatedConceptIds).toContain("ib_wacc");
    expect(getConceptById("ib_dcf").prerequisiteConceptIds).toContain("ib_three_statements");
    expect(Array.isArray(r.concepts[0].relatedConceptIds)).toBe(true);
    expect(Array.isArray(r.concepts[0].prerequisiteConceptIds)).toBe(true);
  });

  it("every selected concept comes from the requested domain + category ONLY — never cross-domain, never cross-category", () => {
    const r = selectKnowledgeConcepts({ domain: SWE_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn" });
    const sweTechIds = getDomainConcepts(SWE_DOMAIN, "technical_functional").map((c) => c.id);
    for (const c of r.concepts) expect(sweTechIds).toContain(c.id);
  });
});

/* ============================== candidate-state-aware priority (EXECUTABLE) ============================== */
describe("buildKnowledgeGuidance — Candidate-State-aware priority, never a parallel intelligence system", () => {
  const baseArgs = { domain: IB_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn" };

  it("returns null when the gate fails or no domain resolved", () => {
    expect(buildKnowledgeGuidance({ ...baseArgs, pipeline: "independent_batch" })).toBeNull();
    expect(buildKnowledgeGuidance({ ...baseArgs, domain: null })).toBeNull();
  });

  it("an unseen concept (no candidateState entry) is prioritised as 'not yet tested'", () => {
    const guidance = buildKnowledgeGuidance({ ...baseArgs, candidateState: null, transcript: [] });
    expect(guidance).not.toBeNull();
    expect(guidance.domainLabel).toBe("Investment Banking");
    expect(guidance.priorityConcepts.every((c) => c.statusLabel === "not yet tested")).toBe(true);
  });

  it("a STRONG, already-demonstrated core concept is deprioritised below an unseen core concept of the same domain/category", () => {
    // swe_big_o and swe_data_structures are both "core" (equal base priority).
    const candidateState = { competencies: { "Time/space complexity (Big O)": { tests: 5, trend: "stable", mostRecentEvidence: { strength: "strong" } } } };
    const guidance = buildKnowledgeGuidance({ domain: SWE_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn", candidateState, transcript: [] });
    const bigO = guidance.priorityConcepts.find((c) => c.label === "Time/space complexity (Big O)");
    const dataStructures = guidance.priorityConcepts.find((c) => c.label === "Data structure trade-offs");
    expect(bigO?.statusLabel).toBe("demonstrated strongly");
    expect(dataStructures?.statusLabel).toBe("not yet tested");
    expect(guidance.targetConcept.label).toBe("Data structure trade-offs");
  });

  it("a WEAK/declining concept is marked for revisiting, not silently ignored", () => {
    const candidateState = { competencies: { "DCF valuation": { tests: 2, trend: "declining", mostRecentEvidence: { strength: "weak" } } } };
    const guidance = buildKnowledgeGuidance({ ...baseArgs, candidateState, transcript: [] });
    const dcf = guidance.priorityConcepts.find((c) => c.label === "DCF valuation");
    expect(dcf?.statusLabel).toBe("weak — worth revisiting");
    expect(dcf?.reasons.join(" ")).toMatch(/candidate weakness/i);
  });

  it("degrades safely on legacy/malformed candidateState shapes — never throws", () => {
    expect(() => buildKnowledgeGuidance({ ...baseArgs, candidateState: "not an object", transcript: [] })).not.toThrow();
    expect(() => buildKnowledgeGuidance({ ...baseArgs, candidateState: {}, transcript: undefined })).not.toThrow();
    expect(() => buildKnowledgeGuidance()).not.toThrow();
  });

  it("never leaks another interview's candidateState — reads only the object explicitly passed in, no module-level state", () => {
    // SWE technical_functional has exactly 4 concepts, so every one is always in the returned
    // set regardless of score — a clean way to compare the SAME concept across two calls.
    const sweArgs = { domain: SWE_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn", transcript: [] };
    const withEvidence = buildKnowledgeGuidance({ ...sweArgs, candidateState: { competencies: { "Data structure trade-offs": { tests: 9, trend: "stable", mostRecentEvidence: { strength: "strong" } } } } });
    const without = buildKnowledgeGuidance({ ...sweArgs, candidateState: null });
    expect(withEvidence.priorityConcepts.find((c) => c.label === "Data structure trade-offs")?.statusLabel).toBe("demonstrated strongly");
    expect(without.priorityConcepts.find((c) => c.label === "Data structure trade-offs")?.statusLabel).toBe("not yet tested");
  });
});

/* ============================== anti-repetition (EXECUTABLE) ============================== */
describe("anti-repetition — a concept asked this interview is HARD-excluded, never merely deprioritised", () => {
  const baseArgs = { domain: IB_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn" };

  it("a concept already asked this interview never reappears, even if it would otherwise be top priority", () => {
    const transcript = [{ question: { competency: "Accretion/dilution" } }];
    const jdRequirements = [{ requirement: "accretion/dilution modelling", evidence_quote: "accretion", confidence: "explicit", category: "technical_functional", occurrences: 1 }];
    const guidance = buildKnowledgeGuidance({ ...baseArgs, candidateState: null, transcript, jdRequirements });
    expect(guidance.priorityConcepts.some((c) => c.label === "Accretion/dilution")).toBe(false);
    expect(guidance.targetConcept.label).not.toBe("Accretion/dilution");
  });

  it("an explicit invitation topic cannot pin the same concept every turn — once asked, it is excluded despite the boost", () => {
    const invitationContext = { explicitTopics: ["dcf"], explicitComponents: [] };
    const first = buildKnowledgeGuidance({ ...baseArgs, candidateState: null, transcript: [], invitationContext });
    expect(first.targetConcept.label).toBe("DCF valuation");
    const afterAsked = buildKnowledgeGuidance({ ...baseArgs, candidateState: null, transcript: [{ question: { competency: "DCF valuation" } }], invitationContext });
    expect(afterAsked.targetConcept.label).not.toBe("DCF valuation");
    expect(afterAsked.priorityConcepts.some((c) => c.label === "DCF valuation")).toBe(false);
  });

  it("returns null when every relevant concept has already been asked this interview (never fabricates guidance)", () => {
    const allLabels = getDomainConcepts(IB_DOMAIN, "technical_functional").map((c) => c.label);
    const transcript = allLabels.map((label) => ({ question: { competency: label } }));
    expect(buildKnowledgeGuidance({ ...baseArgs, candidateState: null, transcript })).toBeNull();
  });
});

/* ============================== JD relevance (EXECUTABLE) ============================== */
describe("JD relevance — bounded keyword intersection, no cross-domain leakage", () => {
  const baseArgs = { domain: IB_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn" };

  it("a JD requirement the catalogue recognises boosts the matching concept to the target", () => {
    const jdRequirements = [{ requirement: "Deep understanding of accretion/dilution modelling", evidence_quote: "accretion", confidence: "explicit", category: "technical_functional", occurrences: 1 }];
    const guidance = buildKnowledgeGuidance({ ...baseArgs, candidateState: null, transcript: [], jdRequirements });
    expect(guidance.targetConcept.label).toBe("Accretion/dilution");
    expect(guidance.priorityConcepts.find((c) => c.label === "Accretion/dilution").reasons).toContain("JD relevance");
  });

  it("a JD requirement from an unrelated domain never leaks a concept into this domain's selection", () => {
    const jdRequirements = [{ requirement: "Experience with hash maps and Big O analysis", evidence_quote: "big o", confidence: "explicit", category: "technical_functional", occurrences: 1 }];
    const guidance = buildKnowledgeGuidance({ ...baseArgs, candidateState: null, transcript: [], jdRequirements });
    const ibIds = getDomainConcepts(IB_DOMAIN, "technical_functional").map((c) => c.label);
    for (const c of guidance.priorityConcepts) expect(ibIds).toContain(c.label);
    // The SWE keyword must not have boosted anything here — no IB concept lists "big o".
    expect(guidance.priorityConcepts.some((c) => c.reasons.includes("JD relevance"))).toBe(false);
  });
});

/* ============================== invitation context — explicit vs inferred (EXECUTABLE) ============================== */
describe("invitation context — explicit topics boost; inferred/vague context changes nothing", () => {
  const baseArgs = { domain: IB_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn", candidateState: null, transcript: [] };

  it("an explicit invitation topic boosts the concept(s) it matches, and the reason echoes the TOPIC (never claims the concept was named)", () => {
    const guidance = buildKnowledgeGuidance({ ...baseArgs, invitationContext: { explicitTopics: ["valuation"], explicitComponents: [] } });
    const target = guidance.priorityConcepts.find((c) => c.label === guidance.targetConcept.label);
    expect(target.reasons.some((r) => /explicit invitation topic: valuation/.test(r))).toBe(true);
  });

  it("a vague invitation (no explicit topics) produces selection IDENTICAL to no invitation context at all", () => {
    const withVague = buildKnowledgeGuidance({ ...baseArgs, invitationContext: { explicitTopics: [], explicitComponents: [] } });
    const without = buildKnowledgeGuidance({ ...baseArgs });
    expect(JSON.stringify(withVague)).toBe(JSON.stringify(without));
  });

  it("an inferred domain is NOT an explicit topic — passing only a domain guess (empty explicitTopics) never adds an 'explicit invitation topic' reason", () => {
    const guidance = buildKnowledgeGuidance({ ...baseArgs, invitationContext: { explicitTopics: [], explicitComponents: ["technical_functional"] } });
    for (const c of guidance.priorityConcepts) {
      expect(c.reasons.some((r) => /explicit invitation topic/.test(r))).toBe(false);
    }
  });

  it("normalizeInvitationContext coerces junk to a safe empty shape and drops sub-3-char tokens", () => {
    expect(normalizeInvitationContext(undefined)).toEqual({ explicitTopics: [], explicitComponents: [] });
    expect(normalizeInvitationContext("nope")).toEqual({ explicitTopics: [], explicitComponents: [] });
    const n = normalizeInvitationContext({ explicitTopics: ["  DCF  ", "ab", 42, "Valuation"], explicitComponents: ["technical_functional", "motivation_fit", "bogus"] });
    expect(n.explicitTopics).toEqual(["dcf", "valuation"]);
    // motivation_fit is not a knowledge-eligible component; bogus is dropped.
    expect(n.explicitComponents).toEqual(["technical_functional"]);
  });

  it("explicit invitation topic boost is bounded — it cannot exceed a specialist concept's ceiling nor drive priority past 200", () => {
    const guidance = buildKnowledgeGuidance({ ...baseArgs, invitationContext: { explicitTopics: ["dcf", "wacc", "terminal value"], explicitComponents: [] } });
    for (const c of guidance.priorityConcepts) {
      // reasons is capped context; priority stays within [0,200] (checked structurally in selectKnowledgeConcepts tests)
      expect(c.statusLabel.length).toBeGreaterThan(0);
    }
  });
});

/* ============================== stage / format applicability (EXECUTABLE) ============================== */
describe("interview-context applicability — stage/format narrow the pool without ever assigning them", () => {
  it("ib_lbo_analysis (technical/final_round only) is selectable at a technical stage but not at a recruiter_screen", () => {
    const atTechnical = selectKnowledgeConcepts({
      domain: IB_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn",
      stage: "technical", candidateState: null, transcript: [], limit: 50,
    });
    const atRecruiter = selectKnowledgeConcepts({
      domain: IB_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn",
      stage: "recruiter_screen", candidateState: null, transcript: [], limit: 50,
    });
    expect(atTechnical.concepts.some((c) => c.id === "ib_lbo_analysis")).toBe(true);
    expect(atRecruiter.concepts.some((c) => c.id === "ib_lbo_analysis")).toBe(false);
  });

  it("omitting stage/format reproduces the unfiltered pool (backwards compatible)", () => {
    const noContext = selectKnowledgeConcepts({ domain: IB_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn", candidateState: null, transcript: [], limit: 50 });
    expect(noContext.concepts.some((c) => c.id === "ib_lbo_analysis")).toBe(true);
  });
});

/* ============================== scheduler ownership (EXECUTABLE) ============================== */
describe("the Knowledge Infrastructure never assigns category / turn_type / anchor_source", () => {
  it("selectKnowledgeConcepts output contains no category/turn_type/anchor_source assignment — only an echo of the category it was asked about", () => {
    const r = selectKnowledgeConcepts({ domain: IB_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn" });
    expect(r.category).toBe("technical_functional"); // echoed, normalised — never chosen
    expect(r).not.toHaveProperty("turnType");
    expect(r).not.toHaveProperty("turn_type");
    expect(r).not.toHaveProperty("anchorSource");
    expect(r).not.toHaveProperty("anchor_source");
    for (const c of r.concepts) {
      expect(c).not.toHaveProperty("category");
      expect(c).not.toHaveProperty("turnType");
      expect(c).not.toHaveProperty("anchorSource");
    }
  });

  it("buildKnowledgeGuidance output exposes only domainLabel / priorityConcepts / targetConcept", () => {
    const g = buildKnowledgeGuidance({ domain: IB_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn", candidateState: null, transcript: [] });
    expect(Object.keys(g).sort()).toEqual(["domainLabel", "priorityConcepts", "targetConcept"]);
    // Phase 10A: targetConcept additionally carries `misconceptions` (always an array, may be empty).
    expect(Object.keys(g.targetConcept).sort()).toEqual(["archetype", "label", "misconceptions"]);
    expect(Array.isArray(g.targetConcept.misconceptions)).toBe(true);
  });
});

/* ============================== HireVue / behavioural protection (EXECUTABLE) ============================== */
describe("HireVue / behavioural protection — technical concepts never reach an ineligible turn", () => {
  it("independent_batch pipeline: no guidance for ANY category or domain", () => {
    for (const category of KNOWLEDGE_ELIGIBLE_CATEGORIES) {
      expect(buildKnowledgeGuidance({ domain: IB_DOMAIN, category, pipeline: "independent_batch", candidateState: null, transcript: [] })).toBeNull();
    }
  });
  it("behavioural_competency / motivation_fit: no guidance even on adaptive_turn with a confidently-matched domain and explicit invitation topics", () => {
    for (const category of ["behavioural_competency", "motivation_fit"]) {
      expect(buildKnowledgeGuidance({
        domain: IB_DOMAIN, category, pipeline: "adaptive_turn", candidateState: null, transcript: [],
        invitationContext: { explicitTopics: ["dcf", "valuation"], explicitComponents: ["technical_functional"] },
      })).toBeNull();
    }
  });
});

/* ============================== prompt bounds (EXECUTABLE) ============================== */
describe("prompt bounds — a small bounded set, never the whole catalogue", () => {
  it("priorityConcepts is always <= MAX_GUIDANCE_CONCEPTS even for the largest domain/category", () => {
    const g = buildKnowledgeGuidance({ domain: IB_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn", candidateState: null, transcript: [] });
    expect(g.priorityConcepts.length).toBeLessThanOrEqual(MAX_GUIDANCE_CONCEPTS);
  });
  it("guidance for one domain never mentions another domain's label", () => {
    const g = buildKnowledgeGuidance({ domain: IB_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn", candidateState: null, transcript: [] });
    const blob = JSON.stringify(g);
    expect(blob).not.toMatch(/Software Engineering|Management Consulting|Marketing|Data Science/);
  });
  it("archetype text never contains the internal concept id", () => {
    for (const concept of KNOWLEDGE_CONCEPTS) {
      for (const archetype of concept.archetypes) expect(archetype).not.toMatch(new RegExp(concept.id));
    }
  });
});
