/* ================================================================== *
 * PHASE 11 — USER-CONTROLLED QUESTION MIX: MAPPING + CONSTRAINT UNIT TESTS
 * ------------------------------------------------------------------
 * questionMix.js in isolation: the type->category mapping (a partition of
 * methodology.js's canonical taxonomy), normalisation, the allowed-category
 * resolution, the distribution filter fed to the EXISTING scheduler, and
 * the Technical-Knowledge permission gate. Cross-cutting enforcement
 * (real scheduler + Knowledge Layer under each mix) lives in
 * questionMixEnforcement.test.js.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CATEGORIES, ACTIVE_CATEGORIES } from "./methodology.js";
import {
  QUESTION_MIX_TYPES, QUESTION_MIX_CATEGORY_MAP, QUESTION_MIX_OPTIONS,
  normalizeQuestionMix, questionMixIsValid, questionMixRestricts,
  isTechnicalMixEnabled, resolveAllowedCategories, isCategoryAllowedByMix,
  questionMixTypeForCategory, applyQuestionMixToDistribution, resolveOpeningCategory,
} from "./questionMix.js";

const src = readFileSync(new URL("./questionMix.js", import.meta.url), "utf8");
const STAGE_BASELINE_ISH = { motivation_fit: 19, behavioural_competency: 28, situational_judgement: 15, technical_functional: 22, commercial_awareness: 16, case_problem_solving: 0 };

/* ============================== module purity (STRUCTURAL) ============================== */
describe("questionMix.js is a pure constraint layer, not a second scheduler", () => {
  it("makes no AI call, no web search, touches no database, has no React import", () => {
    expect(src).not.toMatch(/callClaude|supabase|from ["']react["']|from ["']\.\/App|fetch\(|WebSearch|embedding/);
  });
  it("imports ONLY methodology.js (the canonical taxonomy + the existing scheduler entry point)", () => {
    const imports = src.match(/^import .*?from ["'][^"']+["'];/gms) || [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatch(/from ["']\.\/methodology\.js["']/);
  });
  it("never assigns a turn type, anchor source, competency or specific question", () => {
    expect(src).not.toMatch(/turn_?type|anchor_?source|resolveTurnDirective|stampQuestion/i);
  });
});

/* ============================== the mapping (EXECUTABLE) ============================== */
describe("QUESTION_MIX_CATEGORY_MAP is a strict partition of methodology.js's CATEGORIES", () => {
  it("has exactly the three user-facing types", () => {
    expect(QUESTION_MIX_TYPES).toEqual(["technical", "behavioural", "motivational"]);
    expect(Object.keys(QUESTION_MIX_CATEGORY_MAP).sort()).toEqual([...QUESTION_MIX_TYPES].sort());
  });

  it("every mapped category is a real canonical category (never a forked/invented taxonomy)", () => {
    for (const cats of Object.values(QUESTION_MIX_CATEGORY_MAP)) {
      for (const c of cats) expect(CATEGORIES).toContain(c);
    }
  });

  it("the union of all three types is exactly CATEGORIES, and the sets are pairwise disjoint", () => {
    const all = Object.values(QUESTION_MIX_CATEGORY_MAP).flat();
    expect(new Set(all).size).toBe(all.length); // disjoint
    expect([...new Set(all)].sort()).toEqual([...CATEGORIES].sort()); // total
  });

  it("Technical Knowledge -> the technical/functional + commercial + case categories ONLY", () => {
    expect(QUESTION_MIX_CATEGORY_MAP.technical).toEqual(["technical_functional", "commercial_awareness", "case_problem_solving"]);
  });
  it("Behavioural / Competency -> behavioural + situational-judgement ONLY", () => {
    expect(QUESTION_MIX_CATEGORY_MAP.behavioural).toEqual(["behavioural_competency", "situational_judgement"]);
  });
  it("Motivational -> motivation_fit ONLY", () => {
    expect(QUESTION_MIX_CATEGORY_MAP.motivational).toEqual(["motivation_fit"]);
  });

  it("questionMixTypeForCategory round-trips every canonical category back to its type", () => {
    for (const [type, cats] of Object.entries(QUESTION_MIX_CATEGORY_MAP)) {
      for (const c of cats) expect(questionMixTypeForCategory(c)).toBe(type);
    }
    // legacy alias still resolves
    expect(questionMixTypeForCategory("role_specific")).toBe("technical"); // -> technical_functional
    expect(questionMixTypeForCategory("cv_behavioural")).toBe("behavioural"); // -> behavioural_competency
    // an unrecognised string follows methodology.js's own mapLegacyCategory fallback
    // (-> behavioural_competency), so it lands in the behavioural bucket, never crashes.
    expect(questionMixTypeForCategory("nonsense")).toBe("behavioural");
  });

  it("UI options expose exactly the three types with a label, description and example each", () => {
    expect(QUESTION_MIX_OPTIONS.map((o) => o.type)).toEqual(["technical", "behavioural", "motivational"]);
    for (const o of QUESTION_MIX_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.description.length).toBeGreaterThan(0);
      expect(o.example.length).toBeGreaterThan(0);
    }
  });
});

/* ============================== normalisation + validity (EXECUTABLE) ============================== */
describe("normalizeQuestionMix — array or object map -> canonical-ordered type list | null", () => {
  it("accepts an array of types", () => {
    expect(normalizeQuestionMix(["behavioural", "technical"])).toEqual(["technical", "behavioural"]); // canonical order
  });
  it("accepts an object map { type: true }", () => {
    expect(normalizeQuestionMix({ technical: false, behavioural: true, motivational: true })).toEqual(["behavioural", "motivational"]);
  });
  it("drops invalid / unknown types, de-dupes", () => {
    expect(normalizeQuestionMix(["technical", "technical", "bogus", 5, null])).toEqual(["technical"]);
  });
  it("returns null for a missing / empty / wholly-invalid selection (a LEGACY interview)", () => {
    expect(normalizeQuestionMix(undefined)).toBeNull();
    expect(normalizeQuestionMix(null)).toBeNull();
    expect(normalizeQuestionMix([])).toBeNull();
    expect(normalizeQuestionMix({})).toBeNull();
    expect(normalizeQuestionMix({ technical: false, behavioural: false, motivational: false })).toBeNull();
    expect(normalizeQuestionMix(["only-garbage"])).toBeNull();
    expect(normalizeQuestionMix("technical")).toBeNull(); // a bare string is not a valid selection
  });
  it("questionMixIsValid / questionMixRestricts", () => {
    expect(questionMixIsValid(["technical"])).toBe(true);
    expect(questionMixIsValid([])).toBe(false);
    expect(questionMixRestricts(["technical"])).toBe(true);
    expect(questionMixRestricts(["technical", "behavioural"])).toBe(true);
    expect(questionMixRestricts(["technical", "behavioural", "motivational"])).toBe(false); // all three = no restriction
    expect(questionMixRestricts(null)).toBe(false); // legacy = no restriction
  });
});

/* ============================== the permission gate (EXECUTABLE) ============================== */
describe("isTechnicalMixEnabled — the Technical Knowledge Layer's permission boundary", () => {
  it("true ONLY when 'technical' is in a valid selection", () => {
    expect(isTechnicalMixEnabled(["technical"])).toBe(true);
    expect(isTechnicalMixEnabled(["technical", "behavioural"])).toBe(true);
    expect(isTechnicalMixEnabled(["technical", "behavioural", "motivational"])).toBe(true);
  });
  it("false when a valid selection EXCLUDES technical", () => {
    expect(isTechnicalMixEnabled(["behavioural"])).toBe(false);
    expect(isTechnicalMixEnabled(["motivational"])).toBe(false);
    expect(isTechnicalMixEnabled(["behavioural", "motivational"])).toBe(false);
  });
  it("true (permissive) for a legacy / missing selection — pre-Phase-11 interviews keep their behaviour", () => {
    expect(isTechnicalMixEnabled(null)).toBe(true);
    expect(isTechnicalMixEnabled(undefined)).toBe(true);
    expect(isTechnicalMixEnabled([])).toBe(true);
    expect(isTechnicalMixEnabled({})).toBe(true);
  });
});

/* ============================== allowed categories (EXECUTABLE) ============================== */
describe("resolveAllowedCategories — the hard category universe for the scheduler", () => {
  it("technical only -> exactly the technical-bucket categories", () => {
    expect([...resolveAllowedCategories(["technical"])].sort()).toEqual(["case_problem_solving", "commercial_awareness", "technical_functional"]);
  });
  it("behavioural only -> exactly the behavioural-bucket categories (no technical, no motivational)", () => {
    const a = resolveAllowedCategories(["behavioural"]);
    expect([...a].sort()).toEqual(["behavioural_competency", "situational_judgement"]);
    expect(a.has("technical_functional")).toBe(false);
    expect(a.has("commercial_awareness")).toBe(false);
    expect(a.has("motivation_fit")).toBe(false);
  });
  it("motivational only -> exactly {motivation_fit}", () => {
    expect([...resolveAllowedCategories(["motivational"])]).toEqual(["motivation_fit"]);
  });
  it("technical + behavioural -> both buckets, never motivation_fit", () => {
    const a = resolveAllowedCategories(["technical", "behavioural"]);
    expect(a.has("motivation_fit")).toBe(false);
    expect(a.has("technical_functional")).toBe(true);
    expect(a.has("behavioural_competency")).toBe(true);
    expect(a.has("situational_judgement")).toBe(true);
  });
  it("behavioural + motivational -> never a technical category", () => {
    const a = resolveAllowedCategories(["behavioural", "motivational"]);
    for (const t of QUESTION_MIX_CATEGORY_MAP.technical) expect(a.has(t)).toBe(false);
  });
  it("all three -> every canonical category", () => {
    expect([...resolveAllowedCategories(["technical", "behavioural", "motivational"])].sort()).toEqual([...CATEGORIES].sort());
  });
  it("legacy / no selection -> every canonical category (never a silent restriction)", () => {
    expect([...resolveAllowedCategories(null)].sort()).toEqual([...CATEGORIES].sort());
    expect([...resolveAllowedCategories(undefined)].sort()).toEqual([...CATEGORIES].sort());
  });
  it("isCategoryAllowedByMix respects legacy aliases", () => {
    expect(isCategoryAllowedByMix("role_specific", ["technical"])).toBe(true); // -> technical_functional
    expect(isCategoryAllowedByMix("role_specific", ["behavioural"])).toBe(false);
    expect(isCategoryAllowedByMix("cv_behavioural", ["behavioural"])).toBe(true);
    expect(isCategoryAllowedByMix("technical_functional", null)).toBe(true); // legacy = allowed
  });
});

/* ============================== distribution filter (EXECUTABLE) ============================== */
describe("applyQuestionMixToDistribution — zeroes disallowed, renormalises allowed to 100", () => {
  it("identity (same reference) for a legacy / no-selection input", () => {
    expect(applyQuestionMixToDistribution(STAGE_BASELINE_ISH, null)).toBe(STAGE_BASELINE_ISH);
    expect(applyQuestionMixToDistribution(STAGE_BASELINE_ISH, undefined)).toBe(STAGE_BASELINE_ISH);
    expect(applyQuestionMixToDistribution(STAGE_BASELINE_ISH, [])).toBe(STAGE_BASELINE_ISH);
  });
  it("identity for a selection that permits all three types", () => {
    expect(applyQuestionMixToDistribution(STAGE_BASELINE_ISH, ["technical", "behavioural", "motivational"])).toBe(STAGE_BASELINE_ISH);
  });

  it("technical only -> only technical-bucket categories carry weight, summing to 100", () => {
    const d = applyQuestionMixToDistribution(STAGE_BASELINE_ISH, ["technical"]);
    expect(d.motivation_fit).toBe(0);
    expect(d.behavioural_competency).toBe(0);
    expect(d.situational_judgement).toBe(0);
    expect(d.technical_functional).toBeGreaterThan(0);
    expect(d.commercial_awareness).toBeGreaterThan(0);
    expect(Object.values(d).reduce((s, n) => s + n, 0)).toBe(100);
    expect(d.case_problem_solving).toBe(0);
  });

  it("behavioural only -> zero technical AND zero motivational weight", () => {
    const d = applyQuestionMixToDistribution(STAGE_BASELINE_ISH, ["behavioural"]);
    expect(d.technical_functional).toBe(0);
    expect(d.commercial_awareness).toBe(0);
    expect(d.motivation_fit).toBe(0);
    expect(d.behavioural_competency + d.situational_judgement).toBe(100);
  });

  it("motivational only -> motivation_fit is 100, everything else 0", () => {
    const d = applyQuestionMixToDistribution(STAGE_BASELINE_ISH, ["motivational"]);
    expect(d.motivation_fit).toBe(100);
    for (const c of ACTIVE_CATEGORIES.filter((c) => c !== "motivation_fit")) expect(d[c]).toBe(0);
  });

  it("relative proportions of allowed categories are preserved", () => {
    const base = { motivation_fit: 10, behavioural_competency: 30, situational_judgement: 10, technical_functional: 40, commercial_awareness: 10, case_problem_solving: 0 };
    const d = applyQuestionMixToDistribution(base, ["technical"]); // 40 : 10 -> 80 : 20
    expect(d.technical_functional).toBe(80);
    expect(d.commercial_awareness).toBe(20);
  });

  it("degenerate: allowed categories all zero-weight -> even split across allowed ACTIVE, still summing 100", () => {
    const base = { motivation_fit: 100, behavioural_competency: 0, situational_judgement: 0, technical_functional: 0, commercial_awareness: 0, case_problem_solving: 0 };
    const d = applyQuestionMixToDistribution(base, ["technical"]);
    expect(d.technical_functional + d.commercial_awareness).toBe(100);
    expect(d.motivation_fit).toBe(0);
  });

  it("never throws on a malformed distribution", () => {
    expect(() => applyQuestionMixToDistribution(null, ["technical"])).not.toThrow();
    expect(() => applyQuestionMixToDistribution("nope", ["behavioural"])).not.toThrow();
    expect(() => applyQuestionMixToDistribution({ technical_functional: "x" }, ["technical"])).not.toThrow();
  });
});

/* ============================== opening category clamp (EXECUTABLE) ============================== */
describe("resolveOpeningCategory — reuses the scheduler, only when the mix restricts", () => {
  it("null when the mix does not restrict (AI keeps its free choice — pre-Phase-11)", () => {
    expect(resolveOpeningCategory(STAGE_BASELINE_ISH, null, 12)).toBeNull();
    expect(resolveOpeningCategory(STAGE_BASELINE_ISH, ["technical", "behavioural", "motivational"], 12)).toBeNull();
  });
  it("technical only -> an allowed technical category", () => {
    const c = resolveOpeningCategory(STAGE_BASELINE_ISH, ["technical"], 12);
    expect(QUESTION_MIX_CATEGORY_MAP.technical).toContain(c);
  });
  it("motivational only -> motivation_fit", () => {
    expect(resolveOpeningCategory(STAGE_BASELINE_ISH, ["motivational"], 12)).toBe("motivation_fit");
  });
  it("behavioural + motivational -> an allowed category, never a technical one", () => {
    const c = resolveOpeningCategory(STAGE_BASELINE_ISH, ["behavioural", "motivational"], 12);
    expect([...resolveAllowedCategories(["behavioural", "motivational"])]).toContain(c);
    expect(QUESTION_MIX_CATEGORY_MAP.technical).not.toContain(c);
  });
});
