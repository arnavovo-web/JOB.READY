/* ================================================================== *
 * PHASE 6 — UNIVERSAL INTERVIEW KNOWLEDGE LAYER: UNIT TESTS
 * ------------------------------------------------------------------
 * Covers interviewKnowledge.js in isolation (EXECUTABLE) — the App.jsx
 * integration itself (Call 2 wiring, HireVue/AC isolation, no extra AI
 * call) is covered separately in knowledgeLayerIntegration.test.js.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import {
  KNOWLEDGE_ELIGIBLE_CATEGORIES, KNOWLEDGE_DOMAINS,
  isKnowledgeLayerApplicable, resolveKnowledgeDomain, getDomainConcepts, buildKnowledgeGuidance,
} from "./interviewKnowledge.js";

const IB_DOMAIN = KNOWLEDGE_DOMAINS.find((d) => d.id === "investment_banking");
const SWE_DOMAIN = KNOWLEDGE_DOMAINS.find((d) => d.id === "software_engineering");
const CONSULTING_DOMAIN = KNOWLEDGE_DOMAINS.find((d) => d.id === "consulting");

// A small, fully-controlled two-concept domain — used where a test needs to reason precisely
// about ranking between exactly two concepts, without the real catalogue's larger concept count
// (>MAX_GUIDANCE_CONCEPTS) potentially pushing one of them out of the returned top-N entirely.
const TINY_DOMAIN = {
  id: "tiny_domain", label: "Tiny Domain", roleKeywords: ["tiny domain unique keyword"],
  topics: [{ label: "Tiny Topic", concepts: [
    { id: "tiny_concept_one", label: "Concept One", categories: ["technical_functional"], difficulty: "foundational", priority: 70, keywords: [], archetypes: ["Ask about concept one."] },
    { id: "tiny_concept_two", label: "Concept Two", categories: ["technical_functional"], difficulty: "foundational", priority: 70, keywords: [], archetypes: ["Ask about concept two."] },
  ] }],
};

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
  it("makes no AI calls, touches no database, has no React dependency, never imports App.jsx or the scheduler/state modules that own their own decisions", () => {
    const src = require("node:fs").readFileSync(new URL("./interviewKnowledge.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/callClaude|supabase|from ["']react["']|from ["']\.\/App/);
    // adaptiveEngine.js (the scheduler's own orchestration) and candidateState.js/
    // candidateIntelligence.js/interviewStrategy.js (their own evidence/priority systems) are
    // never imported — this module only ever RECEIVES their already-computed output as plain
    // arguments (candidateState, category), it never reaches back into how they're built.
    expect(src).not.toMatch(/from ["']\.\/adaptiveEngine["']|from ["']\.\/candidateState["']|from ["']\.\/candidateIntelligence["']|from ["']\.\/interviewStrategy["']/);
  });

  it("imports ONLY methodology.js's own canonical taxonomy (CATEGORIES/mapLegacyCategory) — the same import every other pure engine module already uses, never a duplicate/second taxonomy", () => {
    const src = require("node:fs").readFileSync(new URL("./interviewKnowledge.js", import.meta.url), "utf8");
    expect(src).toMatch(/import \{ CATEGORIES, mapLegacyCategory \} from ["']\.\/methodology\.js["']/);
    // Exactly one import statement in the whole file.
    const importCount = (src.match(/^import /gm) || []).length;
    expect(importCount).toBe(1);
  });
});

/* ============================== applicability gate (EXECUTABLE) ============================== */
describe("isKnowledgeLayerApplicable — the explicit, deterministic gate", () => {
  it("ON: adaptive_turn pipeline + technical_functional category + a resolved domain", () => {
    expect(isKnowledgeLayerApplicable({ pipeline: "adaptive_turn", category: "technical_functional", domain: IB_DOMAIN })).toBe(true);
  });

  it("OFF: independent_batch pipeline (HireVue-style) — never applicable regardless of category/domain", () => {
    expect(isKnowledgeLayerApplicable({ pipeline: "independent_batch", category: "technical_functional", domain: IB_DOMAIN })).toBe(false);
  });

  it("OFF: motivation_fit category — canonical knowledge must never leak into a motivation turn", () => {
    expect(isKnowledgeLayerApplicable({ pipeline: "adaptive_turn", category: "motivation_fit", domain: IB_DOMAIN })).toBe(false);
  });

  it("OFF: behavioural_competency category — canonical knowledge must never leak into a behavioural turn", () => {
    expect(isKnowledgeLayerApplicable({ pipeline: "adaptive_turn", category: "behavioural_competency", domain: IB_DOMAIN })).toBe(false);
  });

  it("OFF: no domain resolved — a generic/unmatched role makes the layer inert regardless of category", () => {
    expect(isKnowledgeLayerApplicable({ pipeline: "adaptive_turn", category: "technical_functional", domain: null })).toBe(false);
  });

  it("ON: consulting case — case_problem_solving and situational_judgement are both eligible categories", () => {
    expect(isKnowledgeLayerApplicable({ pipeline: "adaptive_turn", category: "case_problem_solving", domain: CONSULTING_DOMAIN })).toBe(true);
    expect(isKnowledgeLayerApplicable({ pipeline: "adaptive_turn", category: "situational_judgement", domain: CONSULTING_DOMAIN })).toBe(true);
  });

  it("ON: commercial_awareness is an eligible category (e.g. market-context concepts)", () => {
    expect(isKnowledgeLayerApplicable({ pipeline: "adaptive_turn", category: "commercial_awareness", domain: IB_DOMAIN })).toBe(true);
  });

  it("never throws on missing/malformed input", () => {
    expect(() => isKnowledgeLayerApplicable()).not.toThrow();
    expect(() => isKnowledgeLayerApplicable({})).not.toThrow();
    expect(isKnowledgeLayerApplicable(undefined)).toBe(false);
  });
});

/* ============================== domain resolution (EXECUTABLE) ============================== */
describe("resolveKnowledgeDomain — deterministic role/JD matching, no AI call", () => {
  it("matches Investment Banking Analyst / Global Markets style roles", () => {
    const domain = resolveKnowledgeDomain(ibProfile());
    expect(domain?.id).toBe("investment_banking");
  });

  it("matches Software Engineer roles to the software_engineering domain", () => {
    const domain = resolveKnowledgeDomain({ role: "Software Engineer", division: "", responsibilities: ["Build backend services"], required_skills: [], preferred_skills: [], technical_topics: [], commercial_topics: [], jd_requirements: [] });
    expect(domain?.id).toBe("software_engineering");
  });

  it("matches Strategy Consultant roles to the consulting domain", () => {
    const domain = resolveKnowledgeDomain({ role: "Strategy Consultant", division: "", responsibilities: [], required_skills: ["Case interview practice"], preferred_skills: [], technical_topics: [], commercial_topics: [], jd_requirements: [] });
    expect(domain?.id).toBe("consulting");
  });

  it("returns null for a generic/unmatched graduate role — a real, correct 'no domain' outcome, never a guess", () => {
    const domain = resolveKnowledgeDomain({ role: "Graduate Trainee", division: "", responsibilities: ["General rotation"], required_skills: [], preferred_skills: [], technical_topics: [], commercial_topics: [], jd_requirements: [] });
    expect(domain).toBeNull();
  });

  it("never throws on missing/malformed interviewProfile", () => {
    expect(resolveKnowledgeDomain(undefined)).toBeNull();
    expect(resolveKnowledgeDomain(null)).toBeNull();
    expect(resolveKnowledgeDomain("not an object")).toBeNull();
    expect(resolveKnowledgeDomain({})).toBeNull();
  });

  it("also matches via jd_requirements text alone (a role title too generic on its own, but the JD is specific)", () => {
    const domain = resolveKnowledgeDomain({
      role: "Analyst", division: "", responsibilities: [], required_skills: [], preferred_skills: [], technical_topics: [],
      commercial_topics: [], jd_requirements: [{ requirement: "Comfortable with leveraged buyout mechanics", evidence_quote: "leveraged buyout", confidence: "explicit", category: "technical_functional", occurrences: 1 }],
    });
    expect(domain?.id).toBe("private_equity");
  });
});

/* ============================== retrieval / category filtering (EXECUTABLE) ============================== */
describe("getDomainConcepts — retrieves only concepts relevant to the given category", () => {
  it("excludes irrelevant knowledge: motivation_fit yields nothing even for a real domain", () => {
    expect(getDomainConcepts(IB_DOMAIN, "motivation_fit")).toEqual([]);
  });

  it("technical_functional yields real IB concepts (three statements, DCF, accretion/dilution...)", () => {
    const concepts = getDomainConcepts(IB_DOMAIN, "technical_functional");
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.some((c) => c.id === "ib_three_statements")).toBe(true);
    expect(concepts.some((c) => c.id === "ib_dcf")).toBe(true);
  });

  it("never throws on a missing domain/category", () => {
    expect(getDomainConcepts(null, "technical_functional")).toEqual([]);
    expect(getDomainConcepts(IB_DOMAIN, undefined)).toEqual([]);
  });

  it("every domain's every concept declares at least one KNOWLEDGE_ELIGIBLE_CATEGORIES value (catalogue integrity)", () => {
    for (const domain of KNOWLEDGE_DOMAINS) {
      for (const topic of domain.topics) {
        for (const concept of topic.concepts) {
          expect(concept.categories.length).toBeGreaterThan(0);
          for (const c of concept.categories) expect(KNOWLEDGE_ELIGIBLE_CATEGORIES).toContain(c);
        }
      }
    }
  });

  it("no two concepts (even across different domains) share a label or an id — a label collision would corrupt Candidate State lookups across unrelated domains", () => {
    const seenLabels = new Set();
    const seenIds = new Set();
    for (const domain of KNOWLEDGE_DOMAINS) {
      for (const topic of domain.topics) {
        for (const concept of topic.concepts) {
          const labelKey = concept.label.toLowerCase();
          expect(seenLabels.has(labelKey)).toBe(false);
          expect(seenIds.has(concept.id)).toBe(false);
          seenLabels.add(labelKey);
          seenIds.add(concept.id);
        }
      }
    }
    expect(seenLabels.size).toBeGreaterThan(0);
  });

  it("no two domains share a roleKeyword phrase — an overlapping phrase would make resolveKnowledgeDomain's outcome order-dependent instead of a genuinely best match", () => {
    const seen = new Map();
    for (const domain of KNOWLEDGE_DOMAINS) {
      for (const kw of domain.roleKeywords) {
        const key = kw.toLowerCase();
        if (seen.has(key)) throw new Error(`roleKeyword "${kw}" shared by ${seen.get(key)} and ${domain.id}`);
        seen.set(key, domain.id);
      }
    }
  });
});

/* ============================== coverage / Candidate-State-aware priority (EXECUTABLE) ============================== */
describe("buildKnowledgeGuidance — Candidate-State-aware priority, never a parallel intelligence system", () => {
  const baseArgs = { domain: IB_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn" };

  it("returns null when the gate itself fails (e.g. independent_batch)", () => {
    expect(buildKnowledgeGuidance({ ...baseArgs, pipeline: "independent_batch" })).toBeNull();
  });

  it("returns null when no domain resolved", () => {
    expect(buildKnowledgeGuidance({ ...baseArgs, domain: null })).toBeNull();
  });

  it("an unseen concept (no candidateState entry at all) is prioritised as 'not yet tested'", () => {
    const guidance = buildKnowledgeGuidance({ ...baseArgs, candidateState: null, transcript: [] });
    expect(guidance).not.toBeNull();
    expect(guidance.domainLabel).toBe("Investment Banking");
    expect(guidance.priorityConcepts.every((c) => c.statusLabel === "not yet tested")).toBe(true);
  });

  it("a STRONG, already-demonstrated concept is deprioritised below an unseen one (same baseline priority otherwise)", () => {
    const candidateState = { competencies: { "Concept One": { tests: 5, trend: "stable", mostRecentEvidence: { strength: "strong" } } } };
    const guidance = buildKnowledgeGuidance({ domain: TINY_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn", candidateState, transcript: [] });
    const one = guidance.priorityConcepts.find((c) => c.label === "Concept One");
    const two = guidance.priorityConcepts.find((c) => c.label === "Concept Two");
    expect(one?.statusLabel).toBe("demonstrated strongly");
    expect(two?.statusLabel).toBe("not yet tested");
    // Concept Two (unseen) must outrank Concept One (already strong) despite an identical baseline priority.
    expect(guidance.targetConcept.label).toBe("Concept Two");
  });

  it("a WEAK/declining concept is marked for revisiting, not silently ignored", () => {
    const candidateState = { competencies: { "DCF valuation": { tests: 2, trend: "declining", mostRecentEvidence: { strength: "weak" } } } };
    const guidance = buildKnowledgeGuidance({ ...baseArgs, candidateState, transcript: [] });
    const dcf = guidance.priorityConcepts.find((c) => c.label === "DCF valuation");
    expect(dcf?.statusLabel).toBe("weak — worth revisiting");
  });

  it("a concept already asked THIS interview is hard-excluded (never immediately repeated), even if it would otherwise be top priority", () => {
    const transcript = [{ question: { competency: "Accretion/dilution" } }];
    const guidance = buildKnowledgeGuidance({ ...baseArgs, candidateState: null, transcript });
    expect(guidance.priorityConcepts.some((c) => c.label === "Accretion/dilution")).toBe(false);
    expect(guidance.targetConcept.label).not.toBe("Accretion/dilution");
  });

  it("returns null when every relevant concept has already been asked this interview (never fabricates guidance from nothing)", () => {
    const allIbTechnicalLabels = getDomainConcepts(IB_DOMAIN, "technical_functional").map((c) => c.label);
    const transcript = allIbTechnicalLabels.map((label) => ({ question: { competency: label } }));
    expect(buildKnowledgeGuidance({ ...baseArgs, candidateState: null, transcript })).toBeNull();
  });

  it("JD intersection boosts a concept the JD specifically emphasises, without ever excluding an irrelevant one from being simply lower priority", () => {
    const jdRequirements = [{ requirement: "Deep understanding of accretion/dilution modelling", evidence_quote: "accretion", confidence: "explicit", category: "technical_functional", occurrences: 1 }];
    const guidance = buildKnowledgeGuidance({ ...baseArgs, candidateState: null, transcript: [], jdRequirements });
    expect(guidance.targetConcept.label).toBe("Accretion/dilution");
  });

  it("targetConcept always comes from the SAME domain/category the guidance was built for — never a cross-domain concept", () => {
    const guidance = buildKnowledgeGuidance({ domain: SWE_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn", candidateState: null, transcript: [] });
    const sweLabels = getDomainConcepts(SWE_DOMAIN, "technical_functional").map((c) => c.label);
    expect(sweLabels).toContain(guidance.targetConcept.label);
  });

  it("only ever returns a bounded number of priority concepts (compact, never the whole catalogue)", () => {
    const guidance = buildKnowledgeGuidance({ ...baseArgs, candidateState: null, transcript: [] });
    expect(guidance.priorityConcepts.length).toBeLessThanOrEqual(4);
  });

  it("never leaks another user's/interview's candidateState — it only ever reads the object explicitly passed in, no module-level state", () => {
    const tinyArgs = { domain: TINY_DOMAIN, category: "technical_functional", pipeline: "adaptive_turn" };
    const guidanceA = buildKnowledgeGuidance({ ...tinyArgs, candidateState: { competencies: { "Concept One": { tests: 9, trend: "stable", mostRecentEvidence: { strength: "strong" } } } }, transcript: [] });
    const guidanceB = buildKnowledgeGuidance({ ...tinyArgs, candidateState: null, transcript: [] });
    expect(guidanceA.priorityConcepts.find((c) => c.label === "Concept One")?.statusLabel).toBe("demonstrated strongly");
    expect(guidanceB.priorityConcepts.find((c) => c.label === "Concept One")?.statusLabel).toBe("not yet tested");
  });

  it("degrades safely on legacy/malformed candidateState shapes — never throws", () => {
    expect(() => buildKnowledgeGuidance({ ...baseArgs, candidateState: "not an object", transcript: [] })).not.toThrow();
    expect(() => buildKnowledgeGuidance({ ...baseArgs, candidateState: {}, transcript: undefined })).not.toThrow();
    expect(() => buildKnowledgeGuidance()).not.toThrow();
  });

  it("archetype text never literally contains the internal concept id — plain candidate-facing-safe language only", () => {
    const guidance = buildKnowledgeGuidance({ ...baseArgs, candidateState: null, transcript: [] });
    for (const domain of [IB_DOMAIN]) {
      for (const topic of domain.topics) {
        for (const concept of topic.concepts) {
          for (const archetype of concept.archetypes) {
            expect(archetype).not.toMatch(new RegExp(concept.id));
          }
        }
      }
    }
    expect(guidance.targetConcept.archetype.length).toBeGreaterThan(0);
  });
});
