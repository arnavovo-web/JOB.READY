/* ================================================================== *
 * PHASE 10A — RESEARCH-BACKED FINANCE KNOWLEDGE EXPANSION: BEHAVIOUR TESTS
 * ------------------------------------------------------------------
 * Exercises the EXPANDED catalogue through the UNCHANGED Phase 9 selection
 * API (selectKnowledgeConcepts / buildKnowledgeGuidance). Catalogue-data
 * integrity lives in knowledgeCatalogue.test.js; the App.jsx prompt wiring
 * lives in knowledgeLayerIntegration.test.js. This file is about: does the
 * bigger four-domain finance catalogue select the RIGHT concepts for a
 * given interview context, without leaking across domains, without breaking
 * any earlier-phase protection?
 * ================================================================== */
import { describe, it, expect } from "vitest";
import {
  KNOWLEDGE_DOMAINS, KNOWLEDGE_CONCEPTS, KNOWLEDGE_ELIGIBLE_CATEGORIES,
  selectKnowledgeConcepts, buildKnowledgeGuidance, getDomainConcepts, getConceptById,
} from "./interviewKnowledge.js";

const DOMdomain = (id) => KNOWLEDGE_DOMAINS.find((d) => d.id === id);
const IB = DOMdomain("investment_banking");
const PE = DOMdomain("private_equity");
const ST = DOMdomain("sales_and_trading");
const ACC = DOMdomain("accounting");
const SWE = DOMdomain("software_engineering");

// Everything that can be selected for a domain (home concepts + shared-in concepts), any category.
function poolFor(domainId) {
  return KNOWLEDGE_CONCEPTS.filter((c) => c.domain === domainId || (c.sharedWithDomains || []).includes(domainId));
}
function selectIds(args) {
  return selectKnowledgeConcepts({ pipeline: "adaptive_turn", candidateState: null, transcript: [], limit: 200, ...args }).concepts.map((c) => c.id);
}

/* ============================== research-backed coverage ============================== */
describe("each finance domain has meaningful, research-backed coverage", () => {
  it("Investment Banking spans accounting, valuation, M&A and LBO/leverage territory", () => {
    const subs = new Set(poolFor("investment_banking").map((c) => c.subdomain));
    expect(subs).toContain("Accounting & Financial Statements");
    expect(subs).toContain("Valuation");
    expect(subs).toContain("M&A");
    // canonical IB concepts the research repeatedly surfaced
    for (const id of ["ib_three_statements", "ib_dcf", "ib_wacc", "ib_ev_vs_equity", "ib_ebitda", "ib_unlevered_fcf", "ib_multiples", "ib_accretion_dilution", "ib_sources_and_uses"]) {
      expect(getConceptById(id), id).toBeTruthy();
    }
  });

  it("Private Equity has its OWN process/returns concepts, not just a copy of IB", () => {
    const homeIds = KNOWLEDGE_CONCEPTS.filter((c) => c.domain === "private_equity").map((c) => c.id);
    for (const id of ["pe_investment_thesis", "pe_lbo_candidate", "pe_paper_lbo", "pe_irr_vs_moic", "pe_leverage_debt", "pe_commercial_dd", "pe_fund_economics", "pe_exit_strategy", "pe_entry_exit_multiple"]) {
      expect(homeIds, id).toContain(id);
    }
  });

  it("Sales & Trading separates core Global Markets knowledge from desk-specialist knowledge", () => {
    const core = poolFor("sales_and_trading").filter((c) => c.importance === "core").map((c) => c.id);
    const specialist = poolFor("sales_and_trading").filter((c) => c.importance === "specialist").map((c) => c.id);
    expect(core).toEqual(expect.arrayContaining(["st_macro_drivers", "st_central_banks", "st_bid_ask_making", "st_trade_idea", "st_asset_classes"]));
    expect(specialist).toEqual(expect.arrayContaining(["st_derivatives", "st_credit_spreads", "st_structured_products"]));
  });

  it("Accounting distinguishes financial reporting from audit", () => {
    const subs = new Set(poolFor("accounting").map((c) => c.subdomain));
    expect(subs).toContain("Financial Reporting");
    expect(subs).toContain("Audit");
    for (const id of ["acc_accruals", "acc_materiality", "acc_audit_assertions", "acc_provisions", "acc_reporting_standards", "acc_going_concern"]) {
      expect(getConceptById(id), id).toBeTruthy();
    }
  });
});

/* ============================== concept selection per interview context ============================== */
describe("concept selection produces the right shape for each finance interview context", () => {
  it("generic Investment Banking technical interview -> foundational technical concepts, bounded", () => {
    const g = buildKnowledgeGuidance({ domain: IB, category: "technical_functional", pipeline: "adaptive_turn", stage: "technical", format: "technical", candidateState: null, transcript: [] });
    expect(g).not.toBeNull();
    expect(g.domainLabel).toBe("Investment Banking");
    expect(g.priorityConcepts.length).toBeLessThanOrEqual(4);
    const ibPoolLabels = getDomainConcepts(IB, "technical_functional", { stage: "technical", format: "technical" }).map((c) => c.label);
    for (const c of g.priorityConcepts) expect(ibPoolLabels).toContain(c.label);
  });

  it("PE investment-focused interview -> PE thesis/returns concepts available, IB shared valuation concepts available, IB-only concepts NOT", () => {
    const ids = selectIds({ domain: PE, category: "technical_functional", stage: "first_round" });
    // PE-native
    expect(ids).toEqual(expect.arrayContaining(["pe_investment_thesis", "pe_lbo_candidate", "pe_irr_vs_moic"]));
    // shared from IB (declared sharedWithDomains: ["private_equity"])
    expect(ids).toEqual(expect.arrayContaining(["ib_dcf", "ib_ev_vs_equity", "ib_ebitda"]));
    // IB-only concepts must NOT appear in a PE interview
    expect(ids).not.toContain("ib_accretion_dilution");
    expect(ids).not.toContain("ib_lbo_analysis"); // deliberately IB-home; PE has pe_lbo_mechanics
    expect(ids).not.toContain("ib_ma_process");
  });

  it("generic Markets interview (first_round) -> core Global Markets concepts, NO desk-specialist derivatives", () => {
    const ids = selectIds({ domain: ST, category: "technical_functional", stage: "first_round", format: "live_conversational" });
    expect(ids).toEqual(expect.arrayContaining(["st_bond_pricing", "st_yield_curve", "st_bid_ask_making"]));
    expect(ids).not.toContain("st_derivatives");
    expect(ids).not.toContain("st_credit_spreads");
    expect(ids).not.toContain("st_structured_products");
  });

  it("desk-specialist Markets context (technical stage) -> specialist derivatives concepts become selectable", () => {
    const ids = selectIds({ domain: ST, category: "technical_functional", stage: "technical", format: "technical" });
    expect(ids).toEqual(expect.arrayContaining(["st_derivatives", "st_credit_spreads"]));
  });

  it("accounting interview -> core reporting concepts; audit concepts also present in the same domain", () => {
    const ids = selectIds({ domain: ACC, category: "technical_functional", stage: "first_round" });
    expect(ids).toEqual(expect.arrayContaining(["acc_accruals", "acc_revenue_recognition", "acc_reporting_standards"]));
    expect(ids).toEqual(expect.arrayContaining(["acc_materiality", "acc_audit_assertions"]));
  });

  it("audit-flavoured context still selects audit concepts by priority (materiality is 'core')", () => {
    const g = buildKnowledgeGuidance({ domain: ACC, category: "situational_judgement", pipeline: "adaptive_turn", stage: "first_round", candidateState: null, transcript: [] });
    expect(g).not.toBeNull();
    const labels = g.priorityConcepts.map((c) => c.label);
    expect(labels.some((l) => /materiality|audit risk|internal controls|going concern/i.test(l))).toBe(true);
  });
});

/* ============================== shared concepts ============================== */
describe("shared concepts — one canonical concept, multiple domains, domain-specific guidance", () => {
  it("ib_dcf is selectable in BOTH Investment Banking and Private Equity", () => {
    expect(selectIds({ domain: IB, category: "technical_functional" })).toContain("ib_dcf");
    expect(selectIds({ domain: PE, category: "technical_functional" })).toContain("ib_dcf");
  });

  it("ib_dcf's question guidance DIFFERS by domain (mechanics for IB, returns framing for PE)", () => {
    const ibG = buildKnowledgeGuidance({ domain: IB, category: "technical_functional", pipeline: "adaptive_turn", candidateState: { competencies: { "DCF valuation": { tests: 3, trend: "declining", mostRecentEvidence: { strength: "weak" } } } }, transcript: [] });
    const peG = buildKnowledgeGuidance({ domain: PE, category: "technical_functional", pipeline: "adaptive_turn", candidateState: { competencies: { "DCF valuation": { tests: 3, trend: "declining", mostRecentEvidence: { strength: "weak" } } } }, transcript: [] });
    expect(ibG.targetConcept.label).toBe("DCF valuation");
    expect(peG.targetConcept.label).toBe("DCF valuation");
    expect(ibG.targetConcept.archetype).not.toBe(peG.targetConcept.archetype);
    expect(peG.targetConcept.archetype.toLowerCase()).toMatch(/sponsor|returns|entry price|buyer/);
  });

  it("the three statements + depreciation are shared into Accounting with accounting-specific guidance", () => {
    expect(selectIds({ domain: ACC, category: "technical_functional" })).toEqual(expect.arrayContaining(["ib_three_statements", "ib_depreciation"]));
    const g = buildKnowledgeGuidance({ domain: ACC, category: "technical_functional", pipeline: "adaptive_turn", candidateState: { competencies: { "Three financial statements": { tests: 2, trend: "declining", mostRecentEvidence: { strength: "weak" } } } }, transcript: [] });
    expect(g.targetConcept.label).toBe("Three financial statements");
    expect(g.targetConcept.archetype).toMatch(/primary financial statement|cash flow statement is built/i);
  });

  it("a shared concept keeps ONE label everywhere — Candidate State evidence is not fragmented", () => {
    // "DCF valuation" evidence recorded in an IB interview must be seen by a later PE interview.
    const cs = { competencies: { "DCF valuation": { tests: 5, trend: "stable", mostRecentEvidence: { strength: "strong" } } } };
    const pe = selectKnowledgeConcepts({ domain: PE, category: "technical_functional", pipeline: "adaptive_turn", candidateState: cs, transcript: [], limit: 200 });
    const dcf = pe.concepts.find((c) => c.id === "ib_dcf");
    expect(dcf.statusLabel).toBe("demonstrated strongly");
  });
});

/* ============================== domain isolation (Step 16) ============================== */
describe("domain isolation — no cross-domain concept leakage", () => {
  const CATS = ["technical_functional", "commercial_awareness", "situational_judgement", "case_problem_solving"];

  it("Investment Banking concepts never appear in a Sales & Trading interview", () => {
    for (const category of CATS) {
      const ids = selectIds({ domain: ST, category, stage: "technical" });
      expect(ids.some((id) => id.startsWith("ib_"))).toBe(false);
    }
  });

  it("Sales & Trading concepts never appear in an Investment Banking interview", () => {
    for (const category of CATS) {
      const ids = selectIds({ domain: IB, category, stage: "technical" });
      expect(ids.some((id) => id.startsWith("st_"))).toBe(false);
    }
  });

  it("PE-only concepts never appear in an Investment Banking interview, and vice versa for IB-only concepts in PE", () => {
    const ibIds = selectIds({ domain: IB, category: "technical_functional", stage: "technical" });
    expect(ibIds.some((id) => id.startsWith("pe_"))).toBe(false);
    const peIds = selectIds({ domain: PE, category: "technical_functional", stage: "technical" });
    // Only IB concepts explicitly shared into PE may appear.
    const sharedIntoPe = new Set(KNOWLEDGE_CONCEPTS.filter((c) => (c.sharedWithDomains || []).includes("private_equity")).map((c) => c.id));
    for (const id of peIds.filter((x) => x.startsWith("ib_"))) expect(sharedIntoPe.has(id), `${id} leaked into PE`).toBe(true);
  });

  it("audit-specific concepts do not appear outside the accounting domain", () => {
    for (const d of [IB, PE, ST, SWE]) {
      for (const category of CATS) {
        const ids = selectIds({ domain: d, category, stage: "technical" });
        expect(ids.some((id) => id.startsWith("acc_") && !getConceptById(id).sharedWithDomains?.includes(d.id))).toBe(false);
      }
    }
  });

  it("finance concepts never appear in a Software Engineering interview", () => {
    for (const category of CATS) {
      const ids = selectIds({ domain: SWE, category, stage: "technical" });
      expect(ids.some((id) => /^(ib_|pe_|st_|acc_)/.test(id))).toBe(false);
    }
  });
});

/* ============================== candidate state ============================== */
describe("candidate state drives priority across the expanded catalogue", () => {
  const base = { domain: PE, category: "technical_functional", pipeline: "adaptive_turn", stage: "first_round" };

  it("unseen concept -> 'not yet tested'", () => {
    const g = buildKnowledgeGuidance({ ...base, candidateState: null, transcript: [] });
    expect(g.priorityConcepts.every((c) => c.statusLabel === "not yet tested")).toBe(true);
  });

  it("weak concept -> surfaced for revisiting", () => {
    const g = buildKnowledgeGuidance({ ...base, candidateState: { competencies: { "Paper LBO": { tests: 2, trend: "declining", mostRecentEvidence: { strength: "weak" } } } }, transcript: [] });
    const pl = g.priorityConcepts.find((c) => c.label === "Paper LBO");
    expect(pl?.statusLabel).toBe("weak — worth revisiting");
  });

  it("improving concept -> treated as demonstrated, deprioritised", () => {
    const strong = { competencies: { "Investment thesis": { tests: 4, trend: "improving", mostRecentEvidence: { strength: "moderate" } } } };
    const sel = selectKnowledgeConcepts({ ...base, candidateState: strong, transcript: [], limit: 200 });
    const it = sel.concepts.find((c) => c.label === "Investment thesis");
    expect(it.statusLabel).toBe("demonstrated strongly");
  });

  it("strong concept -> ranked below unseen peers of equal importance", () => {
    const cs = { competencies: { "Investment thesis": { tests: 6, trend: "stable", mostRecentEvidence: { strength: "strong" } } } };
    const g = buildKnowledgeGuidance({ ...base, candidateState: cs, transcript: [] });
    expect(g.targetConcept.label).not.toBe("Investment thesis");
  });
});

/* ============================== explicit invitation vs inferred ============================== */
describe("invitation context — explicit boosts, inference never becomes explicit evidence", () => {
  const base = { domain: IB, category: "technical_functional", pipeline: "adaptive_turn", stage: "technical", candidateState: null, transcript: [] };

  it("explicit topic 'lbo' boosts the LBO concept and echoes the TOPIC in the reason", () => {
    const g = buildKnowledgeGuidance({ ...base, invitationContext: { explicitTopics: ["leveraged buyout model"], explicitComponents: [] } });
    const lbo = g.priorityConcepts.find((c) => c.label === "LBO analysis");
    expect(lbo).toBeTruthy();
    expect(lbo.reasons.some((r) => /explicit invitation topic: leveraged buyout model/.test(r))).toBe(true);
  });

  it("an inferred IB domain (no explicit topics) never produces an 'explicit invitation topic' reason for ANY concept", () => {
    const g = buildKnowledgeGuidance({ ...base, invitationContext: { explicitTopics: [], explicitComponents: ["technical_functional"] } });
    for (const c of g.priorityConcepts) expect(c.reasons.some((r) => /explicit invitation topic/.test(r))).toBe(false);
  });

  it("a vague finance invitation yields selection identical to no invitation context at all", () => {
    const withVague = buildKnowledgeGuidance({ ...base, invitationContext: { explicitTopics: [], explicitComponents: [] } });
    const without = buildKnowledgeGuidance({ ...base });
    expect(JSON.stringify(withVague)).toBe(JSON.stringify(without));
  });
});

/* ============================== JD relevance ============================== */
describe("JD relevance — deterministic, in-domain, no cross-sector leakage", () => {
  it("a finance JD requirement boosts the matching in-domain concept", () => {
    const jd = [{ requirement: "Build and interpret paper LBO analyses", evidence_quote: "paper lbo", confidence: "explicit", category: "technical_functional", occurrences: 2 }];
    const g = buildKnowledgeGuidance({ domain: PE, category: "technical_functional", pipeline: "adaptive_turn", stage: "technical", candidateState: null, transcript: [], jdRequirements: jd });
    const pl = g.priorityConcepts.find((c) => c.label === "Paper LBO");
    expect(pl?.reasons).toContain("JD relevance");
  });

  it("a software JD requirement never boosts (or injects) a finance concept", () => {
    const jd = [{ requirement: "Strong grasp of hash maps, recursion and Big O analysis", evidence_quote: "big o analysis", confidence: "explicit", category: "technical_functional", occurrences: 1 }];
    const g = buildKnowledgeGuidance({ domain: IB, category: "technical_functional", pipeline: "adaptive_turn", stage: "technical", candidateState: null, transcript: [], jdRequirements: jd });
    expect(g.priorityConcepts.some((c) => c.reasons.includes("JD relevance"))).toBe(false);
  });
});

/* ============================== anti-repetition ============================== */
describe("anti-repetition — a bigger catalogue means more variety, never a drilling loop", () => {
  it("after a core concept is asked AND demonstrated strongly, a different related concept becomes the target", () => {
    const cs = { competencies: { "LBO mechanics": { tests: 3, trend: "stable", mostRecentEvidence: { strength: "strong" } } } };
    const transcript = [{ question: { competency: "LBO mechanics" } }];
    const g = buildKnowledgeGuidance({ domain: PE, category: "technical_functional", pipeline: "adaptive_turn", stage: "technical", candidateState: cs, transcript });
    expect(g).not.toBeNull();
    expect(g.priorityConcepts.some((c) => c.label === "LBO mechanics")).toBe(false); // hard-excluded (asked)
    expect(g.targetConcept.label).not.toBe("LBO mechanics");
  });

  it("repeatedly asking around one weak concept still rotates — each already-asked label is excluded", () => {
    const asked = ["Paper LBO", "Returns drivers (IRR/MOIC)", "IRR vs MOIC"];
    const g = buildKnowledgeGuidance({
      domain: PE, category: "technical_functional", pipeline: "adaptive_turn", stage: "technical",
      candidateState: { competencies: Object.fromEntries(asked.map((l) => [l, { tests: 2, trend: "declining", mostRecentEvidence: { strength: "weak" } }])) },
      transcript: asked.map((l) => ({ question: { competency: l } })),
    });
    expect(g).not.toBeNull();
    for (const l of asked) expect(g.priorityConcepts.some((c) => c.label === l)).toBe(false);
  });
});

/* ============================== HireVue / scheduler / prompt bounds ============================== */
describe("every earlier-phase protection still holds with the expanded catalogue", () => {
  it("HireVue (independent_batch) gets NO finance guidance for any domain/category", () => {
    for (const d of [IB, PE, ST, ACC]) {
      for (const category of KNOWLEDGE_ELIGIBLE_CATEGORIES) {
        expect(buildKnowledgeGuidance({ domain: d, category, pipeline: "independent_batch", candidateState: null, transcript: [] })).toBeNull();
      }
    }
  });

  it("behavioural / motivation turns get NO finance guidance, even with explicit technical invitation topics", () => {
    for (const category of ["behavioural_competency", "motivation_fit"]) {
      expect(buildKnowledgeGuidance({
        domain: IB, category, pipeline: "adaptive_turn", candidateState: null, transcript: [],
        invitationContext: { explicitTopics: ["dcf", "lbo", "accretion"], explicitComponents: ["technical_functional"] },
      })).toBeNull();
    }
  });

  it("selection never assigns category / turn_type / anchor_source for any finance domain", () => {
    for (const d of [IB, PE, ST, ACC]) {
      const r = selectKnowledgeConcepts({ domain: d, category: "technical_functional", pipeline: "adaptive_turn" });
      expect(r).not.toHaveProperty("turnType");
      expect(r).not.toHaveProperty("anchorSource");
      expect(r).not.toHaveProperty("turn_type");
      for (const c of r.concepts) {
        expect(c).not.toHaveProperty("category");
        expect(c).not.toHaveProperty("turnType");
      }
    }
  });

  it("the whole finance catalogue is NEVER injected — guidance is always <= 4 priority concepts from ONE domain", () => {
    for (const d of [IB, PE, ST, ACC]) {
      const g = buildKnowledgeGuidance({ domain: d, category: "technical_functional", pipeline: "adaptive_turn", stage: "technical", candidateState: null, transcript: [] });
      if (!g) continue;
      expect(g.priorityConcepts.length).toBeLessThanOrEqual(4);
      const blob = JSON.stringify(g);
      expect(g.domainLabel).toBe(d.label);
      expect(blob.length).toBeLessThan(4000); // compact, bounded regardless of catalogue size
    }
  });
});
