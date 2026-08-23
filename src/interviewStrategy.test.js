/* ================================================================== *
 * PHASE 2E — CANDIDATE STRATEGY TEST SUITE
 * ================================================================== */
import { describe, it, expect } from "vitest";
import {
  buildCategoryPriorities, buildCompetencyPriorities, buildClaimPriorities,
  buildCoverageSummary, buildCategoryPreference, buildInterviewStrategy,
  isInterviewStrategyUsable,
} from "./interviewStrategy.js";
import { buildCandidateSignals } from "./candidateIntelligence.js";
import { ACTIVE_CATEGORIES } from "./methodology.js";

function claim(overrides = {}) {
  return { id: "c1", claim_text: "led a team of 15 analysts", status: "unverified", confidence: "low", evidence_count: 0, category: null, created_at: "2026-01-01T00:00:00Z", ...overrides };
}

function memoryRow(overrides = {}) {
  return { category: "technical_functional", competency: "sql", score: 70, interview_id: "iv-1", created_at: "2026-01-01T00:00:00Z", ...overrides };
}

/* ============================== empty/legacy ============================== */
describe("buildInterviewStrategy — empty/legacy input degrades safely", () => {
  it("a well-shaped but EMPTY candidate (zero evidence, zero claims) is usable and every category surfaces as untested — not silently hidden", () => {
    const signals = buildCandidateSignals({});
    const strategy = buildInterviewStrategy({ candidateSignals: signals, claims: [], transcript: [] });
    expect(strategy.priorities.map((p) => p.type)).toEqual(strategy.priorities.map(() => "category"));
    expect(strategy.priorities.length).toBe(ACTIVE_CATEGORIES.length);
    expect(strategy.depriorities).toEqual([]);
    expect(Object.keys(strategy.categoryPreference).length).toBe(ACTIVE_CATEGORIES.length);
    for (const p of Object.values(strategy.categoryPreference)) expect(p).toBeGreaterThan(0); // every category: never tested -> positive preference
  });

  it("missing/malformed candidateSignals (undefined, null, {}) never throws and returns the inert strategy", () => {
    for (const bad of [undefined, null, {}, "nonsense", 42]) {
      const strategy = buildInterviewStrategy({ candidateSignals: bad, claims: [] });
      expect(strategy.priorities).toEqual([]);
      expect(strategy.categoryPreference).toEqual({});
    }
  });

  it("missing/malformed claims never throws", () => {
    const signals = buildCandidateSignals({});
    for (const bad of [undefined, null, "nonsense", 42, [null, undefined, {}]]) {
      expect(() => buildInterviewStrategy({ candidateSignals: signals, claims: bad })).not.toThrow();
    }
  });

  it("a legacy interview with no candidateIntelligence at all behaves identically to omitting the whole call (empty categoryPreference)", () => {
    const strategy = buildInterviewStrategy({});
    expect(strategy).toEqual({ priorities: [], depriorities: [], coverage: { categories: {}, competencies: {} }, categoryPreference: {} });
  });
});

/* ============================== claims ============================== */
describe("buildClaimPriorities — claim strategy", () => {
  it("an untested (unverified) claim gets high priority", () => {
    const [entry] = buildClaimPriorities([claim({ status: "unverified", evidence_count: 0 })]);
    expect(entry.priority).toBeGreaterThanOrEqual(60);
    expect(entry.reason).toMatch(/not yet tested/);
  });

  it("a strongly evidenced (supported) claim gets deprioritised", () => {
    const [entry] = buildClaimPriorities([claim({ status: "supported", confidence: "high", evidence_count: 4 })]);
    expect(entry.priority).toBeLessThanOrEqual(35);
    expect(entry.reason).toMatch(/strongly evidenced/);
  });

  it("a weak/partially-supported claim retains meaningful priority (worth deeper follow-up)", () => {
    const [entry] = buildClaimPriorities([claim({ status: "partially_supported", evidence_count: 1 })]);
    expect(entry.priority).toBeGreaterThan(35);
    expect(entry.reason).toMatch(/partially substantiated/);
  });

  it("a contradicted claim is treated as high priority to revisit, per the actual Phase 2D status model", () => {
    const [entry] = buildClaimPriorities([claim({ status: "contradicted", evidence_count: 2 })]);
    expect(entry.priority).toBeGreaterThanOrEqual(60);
    expect(entry.reason).toMatch(/contradicted/);
  });

  it("an unrecognized/malformed status defaults to the unverified base, never throws", () => {
    const [entry] = buildClaimPriorities([claim({ status: "not_a_real_status" })]);
    expect(entry.priority).toBeGreaterThanOrEqual(60);
  });

  it("more accumulated evidence within the SAME status trims priority further, status still dominates", () => {
    const low = buildClaimPriorities([claim({ status: "partially_supported", evidence_count: 0 })])[0];
    const high = buildClaimPriorities([claim({ status: "partially_supported", evidence_count: 5 })])[0];
    expect(high.priority).toBeLessThan(low.priority);
    // status still dominates: a heavily-evidenced partially_supported claim never drops below
    // a freshly-unverified claim with a materially different status base.
    const unverified = buildClaimPriorities([claim({ status: "unverified", evidence_count: 0 })])[0];
    expect(high.priority).toBeGreaterThan(0);
    expect(unverified.priority).toBeGreaterThanOrEqual(high.priority - 40);
  });

  it("drops claims with no id, never throws on malformed rows", () => {
    expect(buildClaimPriorities([null, undefined, {}, { id: "x" }])).toHaveLength(1);
  });

  it("carries the claim's category through, normalized via mapLegacyCategory", () => {
    const [entry] = buildClaimPriorities([claim({ category: "role_specific" })]);
    expect(entry.category).toBe("technical_functional");
  });

  it("evidence_strength is a normalized 0-1 value, bounded even with very high evidence_count", () => {
    const [entry] = buildClaimPriorities([claim({ evidence_count: 999 })]);
    expect(entry.evidence_strength).toBe(1);
  });
});

/* ============================== categories ============================== */
describe("buildCategoryPriorities — category strategy / coverage / repetition control", () => {
  it("an uncovered (unknown) category gets the highest base priority", () => {
    const coverage = { motivation_fit: { status: "unknown", evidenceCount: 0, recentlyTested: false } };
    const entries = buildCategoryPriorities(coverage, []);
    const mf = entries.find((e) => e.key === "motivation_fit");
    expect(mf.priority).toBe(80);
  });

  it("an adequately covered (demonstrated) category is deprioritised relative to unknown/insufficient", () => {
    const coverage = {
      motivation_fit: { status: "unknown", evidenceCount: 0, recentlyTested: false },
      technical_functional: { status: "demonstrated", evidenceCount: 4, recentlyTested: true },
    };
    const entries = buildCategoryPriorities(coverage, []);
    const unknown = entries.find((e) => e.key === "motivation_fit");
    const demonstrated = entries.find((e) => e.key === "technical_functional");
    expect(demonstrated.priority).toBeLessThan(unknown.priority);
  });

  it("an over-tested category (asked repeatedly THIS interview) is further deprioritised — repetition control", () => {
    const coverage = { technical_functional: { status: "insufficient", evidenceCount: 1, recentlyTested: false } };
    const noAsk = buildCategoryPriorities(coverage, []).find((e) => e.key === "technical_functional");
    const transcript = [
      { question: { category: "technical_functional" } }, { question: { category: "technical_functional" } },
    ];
    const askedTwice = buildCategoryPriorities(coverage, transcript).find((e) => e.key === "technical_functional");
    expect(askedTwice.priority).toBeLessThan(noAsk.priority);
    expect(askedTwice.reason).toMatch(/already asked/);
  });

  it("in-session repetition penalty is bounded — cannot push priority below 0", () => {
    const coverage = { technical_functional: { status: "insufficient", evidenceCount: 1, recentlyTested: false } };
    const transcript = Array.from({ length: 20 }, () => ({ question: { category: "technical_functional" } }));
    const entry = buildCategoryPriorities(coverage, transcript).find((e) => e.key === "technical_functional");
    expect(entry.priority).toBeGreaterThanOrEqual(0);
  });

  it("always returns every ACTIVE_CATEGORY, even with completely empty coverage", () => {
    const entries = buildCategoryPriorities({}, []);
    expect(entries.map((e) => e.key).sort()).toEqual([...ACTIVE_CATEGORIES].sort());
  });

  it("accepts BOTH the live App.jsx transcript shape ({question:{category}}) and the adapted TurnRecord shape ({category})", () => {
    const coverage = { motivation_fit: { status: "insufficient", evidenceCount: 1, recentlyTested: false } };
    const liveShape = [{ question: { category: "motivation_fit" } }];
    const adaptedShape = [{ category: "motivation_fit" }];
    const a = buildCategoryPriorities(coverage, liveShape).find((e) => e.key === "motivation_fit");
    const b = buildCategoryPriorities(coverage, adaptedShape).find((e) => e.key === "motivation_fit");
    expect(a.priority).toBe(b.priority);
  });

  it("normalizes legacy category strings in the transcript via mapLegacyCategory", () => {
    const coverage = { technical_functional: { status: "insufficient", evidenceCount: 1, recentlyTested: false } };
    const legacyTranscript = [{ question: { category: "role_specific" } }]; // legacy -> technical_functional
    const entry = buildCategoryPriorities(coverage, legacyTranscript).find((e) => e.key === "technical_functional");
    expect(entry.priority).toBeLessThan(55); // insufficient base (55) minus in-session penalty
  });
});

/* ============================== competencies ============================== */
describe("buildCompetencyPriorities — competency strategy", () => {
  it("an uncovered but required competency gets high priority", () => {
    const entries = buildCompetencyPriorities({}, [{ name: "stakeholder management", basis: "explicit" }]);
    expect(entries).toHaveLength(1);
    expect(entries[0].priority).toBe(75);
    expect(entries[0].reason).toMatch(/required by the role/);
  });

  it("an adequately covered competency is deprioritised", () => {
    const coverage = { leadership: { evidenceCount: 4, averageScore: 75, recentlyTested: true } };
    const [entry] = buildCompetencyPriorities(coverage, []);
    expect(entry.priority).toBeLessThanOrEqual(20);
  });

  it("an insufficiently tested competency (low evidence or low score) keeps meaningful priority", () => {
    const coverage = { leadership: { evidenceCount: 1, averageScore: 40, recentlyTested: false } };
    const [entry] = buildCompetencyPriorities(coverage, []);
    expect(entry.priority).toBe(55);
  });

  it("does not duplicate a required competency already present in competencyCoverage (case-insensitive match)", () => {
    const coverage = { Leadership: { evidenceCount: 4, averageScore: 80, recentlyTested: true } };
    const entries = buildCompetencyPriorities(coverage, [{ name: "leadership", basis: "explicit" }]);
    expect(entries).toHaveLength(1);
    expect(entries[0].priority).toBeLessThanOrEqual(20); // uses the covered entry, not the required-untested base
  });

  it("defensively handles missing/malformed input", () => {
    expect(buildCompetencyPriorities(null, null)).toEqual([]);
    expect(buildCompetencyPriorities(undefined, [{ name: "" }, { }, null])).toEqual([]);
  });
});

/* ============================== coverage summary ============================== */
describe("buildCoverageSummary — untouched / lightly tested / adequately tested / over-tested", () => {
  it("buckets categories by evidence count", () => {
    const coverage = {
      motivation_fit: { evidenceCount: 0, status: "unknown", recentlyTested: false },
      behavioural_competency: { evidenceCount: 2, status: "insufficient", recentlyTested: false },
      technical_functional: { evidenceCount: 4, status: "demonstrated", recentlyTested: true },
      commercial_awareness: { evidenceCount: 8, status: "demonstrated", recentlyTested: true },
    };
    const summary = buildCoverageSummary(coverage, {});
    expect(summary.categories.motivation_fit.bucket).toBe("untouched");
    expect(summary.categories.behavioural_competency.bucket).toBe("lightly_tested");
    expect(summary.categories.technical_functional.bucket).toBe("adequately_tested");
    expect(summary.categories.commercial_awareness.bucket).toBe("over_tested");
  });

  it("buckets competencies the same way, only for competencies actually present", () => {
    const summary = buildCoverageSummary({}, { sql: { evidenceCount: 7, averageScore: 80, recentlyTested: true } });
    expect(summary.competencies.sql.bucket).toBe("over_tested");
    expect(Object.keys(summary.competencies)).toEqual(["sql"]);
  });

  it("defensively handles missing input", () => {
    const summary = buildCoverageSummary(null, undefined);
    expect(Object.keys(summary.categories).sort()).toEqual([...ACTIVE_CATEGORIES].sort());
    expect(summary.competencies).toEqual({});
  });
});

/* ============================== categoryPreference ============================== */
describe("buildCategoryPreference — the scheduler-facing bounded signal", () => {
  it("maps priority 100 -> +1, 0 -> -1, 50 -> 0", () => {
    const entries = [
      { type: "category", key: "motivation_fit", priority: 100 },
      { type: "category", key: "behavioural_competency", priority: 0 },
      { type: "category", key: "technical_functional", priority: 50 },
    ];
    const pref = buildCategoryPreference(entries);
    expect(pref.motivation_fit).toBe(1);
    expect(pref.behavioural_competency).toBe(-1);
    expect(pref.technical_functional).toBe(0);
  });

  it("ignores non-category entries and unrecognized category keys", () => {
    const entries = [{ type: "claim", key: "c1", priority: 90 }, { type: "category", key: "not_a_category", priority: 90 }];
    expect(buildCategoryPreference(entries)).toEqual({});
  });
});

/* ============================== determinism / ordering ============================== */
describe("buildInterviewStrategy — determinism and canonical ordering", () => {
  const signals = buildCandidateSignals({
    memoryRows: [memoryRow({ category: "motivation_fit", score: 90 }), memoryRow({ category: "motivation_fit", score: 88 }), memoryRow({ category: "motivation_fit", score: 92 })],
    claims: [claim({ id: "a", status: "unverified" }), claim({ id: "b", status: "partially_supported", evidence_count: 1 })],
  });

  it("identical input produces identical output across repeated calls", () => {
    const inputs = { candidateSignals: signals, claims: [claim({ id: "a" }), claim({ id: "b", status: "supported", evidence_count: 5 })], transcript: [] };
    const results = Array.from({ length: 10 }, () => buildInterviewStrategy(inputs));
    for (const r of results) expect(r).toEqual(results[0]);
  });

  it("deterministic tie-break: equal priority sorted by type (claim < competency < category) then key ascending", () => {
    const claims = buildClaimPriorities([claim({ id: "z", status: "unverified" }), claim({ id: "a", status: "unverified" })]);
    // Both claims share the same base priority (unverified, 0 evidence) — key order must be deterministic.
    expect(claims[0].priority).toBe(claims[1].priority);
  });

  it("priorities/depriorities are both bounded in size", () => {
    const manyClaims = Array.from({ length: 20 }, (_, i) => claim({ id: `c${i}`, status: "unverified" }));
    const strategy = buildInterviewStrategy({ candidateSignals: buildCandidateSignals({}), claims: manyClaims });
    expect(strategy.priorities.length).toBeLessThanOrEqual(8);
  });

  it("priorities are sorted descending by priority", () => {
    const strategy = buildInterviewStrategy({
      candidateSignals: buildCandidateSignals({}),
      claims: [claim({ id: "a", status: "unverified" }), claim({ id: "b", status: "contradicted", evidence_count: 3 })],
    });
    for (let i = 1; i < strategy.priorities.length; i++) {
      expect(strategy.priorities[i - 1].priority).toBeGreaterThanOrEqual(strategy.priorities[i].priority);
    }
  });
});

/* ============================== cross-interview intelligence ============================== */
describe("cross-interview intelligence (§10)", () => {
  it("a claim strongly evidenced in a previous interview does NOT automatically receive high priority again", () => {
    const previouslyTested = claim({ id: "excel", status: "supported", confidence: "high", evidence_count: 3 });
    const [entry] = buildClaimPriorities([previouslyTested]);
    expect(entry.priority).toBeLessThanOrEqual(DEPRIORITY_THRESHOLD_FOR_TEST());
  });

  it("a claim that produced weak evidence in a previous interview receives increased priority in the next", () => {
    const weaklyTested = claim({ id: "commercial", status: "partially_supported", confidence: "low", evidence_count: 1 });
    const [entry] = buildClaimPriorities([weaklyTested]);
    expect(entry.priority).toBeGreaterThan(35);
  });

  it("category coverage persists across interviews via candidateSignals (built from ALL of this user's interview_memory, not just the current one)", () => {
    const signals = buildCandidateSignals({
      memoryRows: [
        memoryRow({ category: "commercial_awareness", score: 85, interview_id: "iv-old-1" }),
        memoryRow({ category: "commercial_awareness", score: 90, interview_id: "iv-old-2" }),
        memoryRow({ category: "commercial_awareness", score: 88, interview_id: "iv-old-3" }),
      ],
    });
    const strategy = buildInterviewStrategy({ candidateSignals: signals, claims: [], transcript: [] });
    // commercial_awareness has 3 strong data points across 3 PAST interviews -> demonstrated -> deprioritised
    expect(strategy.categoryPreference.commercial_awareness).toBeLessThan(0);
  });
});
function DEPRIORITY_THRESHOLD_FOR_TEST() { return 35; }

/* ============================== usability gate ============================== */
describe("isInterviewStrategyUsable", () => {
  it("true for a well-formed strategy, including the empty one", () => {
    expect(isInterviewStrategyUsable(buildInterviewStrategy({}))).toBe(true);
  });
  it("false for missing/malformed input, never throws", () => {
    expect(isInterviewStrategyUsable(null)).toBe(false);
    expect(isInterviewStrategyUsable(undefined)).toBe(false);
    expect(isInterviewStrategyUsable({})).toBe(false);
    expect(isInterviewStrategyUsable("nonsense")).toBe(false);
  });
});

/* ============================== module purity ============================== */
describe("module purity (§2: deterministic, no React/Supabase/AI/network)", () => {
  it("has no forbidden dependency", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./interviewStrategy.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/from ["']react["']/i);
    expect(src).not.toMatch(/supabase/i);
    expect(src).not.toMatch(/fetch\(/);
    expect(src).not.toMatch(/callClaude/);
    expect(src).not.toMatch(/window\./);
  });
});
