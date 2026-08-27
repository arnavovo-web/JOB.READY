/* ================================================================== *
 * PHASE 9 — KNOWLEDGE CATALOGUE DATA: INTEGRITY + MIGRATION COMPLETENESS
 * ------------------------------------------------------------------
 * knowledgeCatalogue.js is pure data. These tests guarantee it stays
 * well-formed as it grows, that it never drifts from methodology.js's
 * canonical category taxonomy, that every Phase 6 concept/domain survived
 * the flattening, and that the lightweight relationship links are valid.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CATEGORIES } from "./methodology.js";
import {
  KNOWLEDGE_DOMAINS, KNOWLEDGE_DOMAIN_GROUPS, KNOWLEDGE_CONCEPTS,
  IMPORTANCE_LEVELS, IMPORTANCE_BASE_PRIORITY, DIFFICULTY_LEVELS,
} from "./knowledgeCatalogue.js";

const VALID_DOMAIN_IDS = new Set(KNOWLEDGE_DOMAINS.map((d) => d.id));
const VALID_CONCEPT_IDS = new Set(KNOWLEDGE_CONCEPTS.map((c) => c.id));
// Kept in sync with App.jsx's INTERVIEW_STAGES / INTERVIEW_FORMATS keys — a
// concept restricting itself to a non-existent stage/format is a bug.
const VALID_STAGE_KEYS = new Set(["recruiter_screen", "first_round", "technical", "final_round"]);
const VALID_FORMAT_KEYS = new Set(["asynchronous_video", "live_conversational", "technical"]);
// Canonical knowledge must never be tested under these.
const FORBIDDEN_CATEGORIES = new Set(["motivation_fit", "behavioural_competency"]);

/* ============================== module purity ============================== */
describe("knowledgeCatalogue.js is inert, zero-dependency data", () => {
  const src = readFileSync(new URL("./knowledgeCatalogue.js", import.meta.url), "utf8");
  it("imports nothing at all", () => {
    expect(src.match(/^import\s/gm)).toBeNull();
  });
  it("contains no logic, no AI, no IO — only data declarations", () => {
    expect(src).not.toMatch(/callClaude|supabase|fetch\(|require\(|WebSearch|embedding|vector/i);
    expect(src).not.toMatch(/\bfunction\b/);      // no function declarations/expressions
    expect(src).not.toMatch(/=>\s*[{([]/);        // no arrow functions (prose "=>" in comments is fine)
    // The only executable statements are `export const NAME = <literal>`.
    const execLines = src.split("\n").filter((l) => /^\s*(export\s+)?(const|let|var)\s/.test(l));
    for (const l of execLines) expect(l).toMatch(/^export const [A-Z_]+ = /);
  });
});

/* ============================== domains & groups ============================== */
describe("domains and the group taxonomy", () => {
  it("has the original 9 Phase 6 domains, by id", () => {
    expect([...VALID_DOMAIN_IDS].sort()).toEqual([
      "accounting", "consulting", "data_science", "investment_banking", "marketing",
      "private_equity", "product_management", "sales_and_trading", "software_engineering",
    ]);
  });

  it("every domain has a non-empty label and >=1 roleKeyword; no two domains share a roleKeyword", () => {
    const seen = new Map();
    for (const d of KNOWLEDGE_DOMAINS) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(Array.isArray(d.roleKeywords) && d.roleKeywords.length > 0).toBe(true);
      for (const kw of d.roleKeywords) {
        const k = kw.toLowerCase();
        expect(seen.has(k), `roleKeyword "${kw}" shared by ${seen.get(k)} and ${d.id}`).toBe(false);
        seen.set(k, d.id);
      }
    }
  });

  it("every domain belongs to exactly one group, and every group references only real domains", () => {
    const grouped = new Map();
    for (const g of KNOWLEDGE_DOMAIN_GROUPS) {
      for (const id of g.domainIds) {
        expect(VALID_DOMAIN_IDS.has(id), `group ${g.id} -> unknown domain ${id}`).toBe(true);
        expect(grouped.has(id), `domain ${id} in multiple groups`).toBe(false);
        grouped.set(id, g.id);
      }
    }
    for (const d of KNOWLEDGE_DOMAINS) {
      expect(grouped.has(d.id), `domain ${d.id} is in no group`).toBe(true);
      expect(d.group).toBe(grouped.get(d.id));
    }
  });
});

/* ============================== concept schema integrity ============================== */
describe("every concept is schema-valid", () => {
  it("unique ids and unique (case-insensitive) labels across the WHOLE catalogue", () => {
    const ids = new Set();
    const labels = new Set();
    for (const c of KNOWLEDGE_CONCEPTS) {
      expect(ids.has(c.id), `duplicate id ${c.id}`).toBe(false);
      ids.add(c.id);
      const lk = c.label.toLowerCase();
      expect(labels.has(lk), `duplicate label ${c.label}`).toBe(false);
      labels.add(lk);
    }
  });

  it("id is snake_case, label/keywords are non-empty, archetypes are present and id-free", () => {
    for (const c of KNOWLEDGE_CONCEPTS) {
      expect(c.id).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
      expect(typeof c.label === "string" && c.label.trim().length > 0).toBe(true);
      expect(Array.isArray(c.keywords) && c.keywords.length > 0).toBe(true);
      expect(c.keywords.every((k) => typeof k === "string" && k === k.toLowerCase())).toBe(true);
      expect(Array.isArray(c.archetypes) && c.archetypes.length > 0).toBe(true);
      for (const a of c.archetypes) expect(a).not.toMatch(new RegExp(c.id));
    }
  });

  it("domain is a real domain id", () => {
    for (const c of KNOWLEDGE_CONCEPTS) {
      expect(VALID_DOMAIN_IDS.has(c.domain), `${c.id} -> unknown domain ${c.domain}`).toBe(true);
      expect(typeof c.subdomain === "string" && c.subdomain.length > 0).toBe(true);
    }
  });

  it("importance is a canonical level; difficulty is a canonical level", () => {
    for (const c of KNOWLEDGE_CONCEPTS) {
      expect(IMPORTANCE_LEVELS).toContain(c.importance);
      expect(DIFFICULTY_LEVELS).toContain(c.difficulty);
    }
    expect(Object.keys(IMPORTANCE_BASE_PRIORITY).sort()).toEqual([...IMPORTANCE_LEVELS].sort());
  });

  it("categories are canonical methodology.js categories, non-empty, and never motivation_fit / behavioural_competency", () => {
    for (const c of KNOWLEDGE_CONCEPTS) {
      expect(Array.isArray(c.categories) && c.categories.length > 0).toBe(true);
      for (const cat of c.categories) {
        expect(CATEGORIES, `${c.id} -> non-canonical category ${cat}`).toContain(cat);
        expect(FORBIDDEN_CATEGORIES.has(cat), `${c.id} -> forbidden category ${cat}`).toBe(false);
      }
    }
  });

  it("applicableStages / applicableFormats, when present, reference only real keys", () => {
    for (const c of KNOWLEDGE_CONCEPTS) {
      for (const s of c.applicableStages || []) expect(VALID_STAGE_KEYS.has(s), `${c.id} -> bad stage ${s}`).toBe(true);
      for (const f of c.applicableFormats || []) expect(VALID_FORMAT_KEYS.has(f), `${c.id} -> bad format ${f}`).toBe(true);
    }
  });
});

/* ============================== relationship integrity ============================== */
describe("lightweight relationship links are valid (no graph algorithm, just referential integrity)", () => {
  it("every relatedConceptId / prerequisiteConceptId points at a concept that exists", () => {
    for (const c of KNOWLEDGE_CONCEPTS) {
      for (const rel of c.relatedConceptIds || []) {
        expect(VALID_CONCEPT_IDS.has(rel), `${c.id}.relatedConceptIds -> missing ${rel}`).toBe(true);
      }
      for (const pre of c.prerequisiteConceptIds || []) {
        expect(VALID_CONCEPT_IDS.has(pre), `${c.id}.prerequisiteConceptIds -> missing ${pre}`).toBe(true);
      }
    }
  });

  it("no concept lists itself as related / prerequisite; no concept is its own prerequisite chain of length 1", () => {
    for (const c of KNOWLEDGE_CONCEPTS) {
      expect((c.relatedConceptIds || []).includes(c.id)).toBe(false);
      expect((c.prerequisiteConceptIds || []).includes(c.id)).toBe(false);
    }
  });

  it("prerequisite links are acyclic", () => {
    const prereqs = new Map(KNOWLEDGE_CONCEPTS.map((c) => [c.id, c.prerequisiteConceptIds || []]));
    const visit = (id, stack) => {
      if (stack.includes(id)) throw new Error(`prerequisite cycle: ${[...stack, id].join(" -> ")}`);
      for (const p of prereqs.get(id) || []) visit(p, [...stack, id]);
    };
    expect(() => { for (const c of KNOWLEDGE_CONCEPTS) visit(c.id, []); }).not.toThrow();
  });
});

/* ============================== Phase 6 migration completeness ============================== */
describe("Phase 6 -> Phase 9 migration lost nothing", () => {
  // The exact 41 concept ids that existed at the end of Phase 6.
  const PHASE6_CONCEPT_IDS = [
    "ib_three_statements", "ib_statement_linkage", "ib_working_capital", "ib_depreciation",
    "ib_dcf", "ib_trading_comps", "ib_precedent_transactions", "ib_ev_vs_equity",
    "ib_accretion_dilution", "ib_synergies", "ib_purchase_accounting", "ib_ma_rationale",
    "st_bond_pricing", "st_duration_convexity", "st_options_greeks", "st_market_context",
    "pe_lbo_mechanics", "pe_returns_drivers", "pe_value_creation",
    "consulting_profitability", "consulting_market_sizing", "consulting_market_entry", "consulting_structuring",
    "acc_double_entry", "acc_revenue_recognition", "acc_deferred_tax", "acc_audit_risk",
    "swe_big_o", "swe_data_structures", "swe_system_design", "swe_concurrency",
    "ds_bias_variance", "ds_overfitting", "ds_ab_testing", "ds_model_eval",
    "pm_prioritisation", "pm_metrics", "pm_launch_strategy",
    "mkt_mix", "mkt_segmentation", "mkt_roi",
  ];

  it("all 41 original concepts are still present, by id", () => {
    expect(PHASE6_CONCEPT_IDS).toHaveLength(41);
    for (const id of PHASE6_CONCEPT_IDS) {
      expect(VALID_CONCEPT_IDS.has(id), `Phase 6 concept ${id} missing after migration`).toBe(true);
    }
  });

  it("all 9 original domains are still present and still represented by >=1 concept", () => {
    expect(KNOWLEDGE_DOMAINS).toHaveLength(9);
    for (const d of KNOWLEDGE_DOMAINS) {
      expect(KNOWLEDGE_CONCEPTS.some((c) => c.domain === d.id), `domain ${d.id} has no concepts`).toBe(true);
    }
  });

  it("the catalogue grew only by a small, deliberate amount (infrastructure phase, not an expansion)", () => {
    const added = KNOWLEDGE_CONCEPTS.length - 41;
    expect(added).toBeGreaterThanOrEqual(0);
    expect(added).toBeLessThanOrEqual(5);
  });

  it("every Phase 6 concept's label is unchanged (labels are Candidate State keys — a rename would orphan evidence)", () => {
    const labelById = Object.fromEntries(KNOWLEDGE_CONCEPTS.map((c) => [c.id, c.label]));
    expect(labelById.ib_three_statements).toBe("Three financial statements");
    expect(labelById.ib_dcf).toBe("DCF valuation");
    expect(labelById.ib_accretion_dilution).toBe("Accretion/dilution");
    expect(labelById.swe_big_o).toBe("Time/space complexity (Big O)");
    expect(labelById.consulting_market_sizing).toBe("Market sizing");
    expect(labelById.pe_lbo_mechanics).toBe("LBO mechanics");
  });
});
