import { describe, it, expect } from "vitest";
import { ACTIVE_CATEGORIES } from "./methodology.js";
import {
  CLAIM_SOURCES, CLAIM_STATUSES, CONFIDENCE_LEVELS, CATEGORY_STATUSES,
  normalizeClaimText, claimsAreDuplicate, dedupeNewClaims, classifyClaimStatus,
  buildCategoryCoverage, buildCompetencyCoverage, buildUnresolvedClaims,
  buildRecommendedProbes, mergeProbeAreasForInterview, matchClaimIdForProbeArea,
  buildCandidateSignals, isCandidateIntelligenceUsable,
} from "./candidateIntelligence.js";

function memRow({ category, competency = "leadership", score = 70, interview_id = "iv-1", created_at = "2026-01-01T00:00:00Z" } = {}) {
  return { category, competency, score, interview_id, created_at };
}
function claim({ id = "c1", claim_text, status = "unverified", confidence = "low", evidence_count = 0, category = null, created_at = "2026-01-01T00:00:00Z" } = {}) {
  return { id, claim_text, status, confidence, evidence_count, category, created_at };
}
function evaluation(specificity, evidence) {
  return { relevance: 70, specificity, structure: 60, evidence, clarity: 60, competency_demonstration: 60, strengths: [], issues: [] };
}

describe("enums", () => {
  it("exposes the exact enums the candidate_claims schema constrains to", () => {
    expect(CLAIM_SOURCES).toEqual(["cv", "interview", "candidate_input"]);
    expect(CLAIM_STATUSES).toEqual(["unverified", "partially_supported", "supported", "contradicted"]);
    expect(CONFIDENCE_LEVELS).toEqual(["low", "medium", "high"]);
    expect(CATEGORY_STATUSES).toEqual(["unknown", "insufficient", "demonstrated"]);
  });
});

describe("normalizeClaimText / claimsAreDuplicate", () => {
  it("normalizes case/whitespace", () => {
    expect(normalizeClaimText("  Led   a Team \n of 10  ")).toBe("led a team of 10");
  });

  it("matches exact-after-normalization claims", () => {
    expect(claimsAreDuplicate("Led a team of 10", "led a team of 10")).toBe(true);
  });

  it("matches substring claims above the minimum length guard", () => {
    expect(claimsAreDuplicate("built an automated valuation model", "automated valuation model")).toBe(true);
  });

  it("does not match unrelated short strings even if one contains the other", () => {
    expect(claimsAreDuplicate("led", "I led a huge cross-functional team of ten engineers")).toBe(false);
  });

  it("does not match unrelated claims", () => {
    expect(claimsAreDuplicate("led a team of 10", "built a financial model")).toBe(false);
  });

  it("defensively handles missing/empty input", () => {
    expect(claimsAreDuplicate("", "led a team of 10")).toBe(false);
    expect(claimsAreDuplicate(null, undefined)).toBe(false);
  });
});

describe("dedupeNewClaims — construction: duplicate evidence, malformed AI output", () => {
  it("drops a fresh CV claim that duplicates an existing persisted claim", () => {
    const existing = [claim({ claim_text: "Led a team of 10" })];
    const fresh = [{ claim: "led a team of 10", why: "leadership claim" }, { claim: "Built an automated valuation model", why: "technical claim" }];
    const result = dedupeNewClaims(existing, fresh);
    expect(result).toEqual([{ claim: "Built an automated valuation model", why: "technical claim" }]);
  });

  it("keeps all claims when there is no existing overlap (empty candidate)", () => {
    const result = dedupeNewClaims([], [{ claim: "Led a team of 10", why: "x" }]);
    expect(result).toHaveLength(1);
  });

  it("never throws on malformed AI output — missing claim field, null entries, non-array input", () => {
    expect(dedupeNewClaims([], [{ why: "no claim field" }, null, undefined, { claim: "" }])).toEqual([]);
    expect(dedupeNewClaims([], null)).toEqual([]);
    expect(dedupeNewClaims(null, [{ claim: "x that is long enough" }])).toEqual([{ claim: "x that is long enough" }]);
    expect(dedupeNewClaims(undefined, undefined)).toEqual([]);
  });
});

describe("classifyClaimStatus — confidence evolution", () => {
  it("a strong, detailed answer produces supported/high confidence", () => {
    expect(classifyClaimStatus({ currentStatus: "unverified", evaluation: evaluation(85, 90) })).toEqual({ status: "supported", confidence: "high" });
  });

  it("a vague-but-present answer moves an unverified claim to partially_supported, not straight to supported (per the spec's worked example)", () => {
    expect(classifyClaimStatus({ currentStatus: "unverified", evaluation: evaluation(40, 45) })).toEqual({ status: "partially_supported", confidence: "medium" });
  });

  it("weak evidence never single-handedly becomes supported, however high currentStatus might suggest", () => {
    const result = classifyClaimStatus({ currentStatus: "supported", evaluation: evaluation(10, 5) });
    expect(result.status).not.toBe("supported");
  });

  it("a weak retest of an already-supported claim pulls it back to partially_supported — confidence can decrease", () => {
    expect(classifyClaimStatus({ currentStatus: "supported", evaluation: evaluation(10, 5) })).toEqual({ status: "partially_supported", confidence: "low" });
  });

  it("a near-zero test on an already-unverified claim leaves it unverified, not upgraded", () => {
    expect(classifyClaimStatus({ currentStatus: "unverified", evaluation: evaluation(2, 3) })).toEqual({ status: "unverified", confidence: "low" });
  });

  it("never auto-produces 'contradicted' — that requires semantic judgement, deliberately out of scope for deterministic classification", () => {
    for (const specificity of [0, 10, 30, 50, 70, 90, 100]) {
      for (const currentStatus of CLAIM_STATUSES) {
        expect(classifyClaimStatus({ currentStatus, evaluation: evaluation(specificity, specificity) }).status).not.toBe("contradicted");
      }
    }
  });

  it("defensively handles a missing/malformed evaluation", () => {
    expect(classifyClaimStatus({ currentStatus: "unverified", evaluation: null })).toEqual({ status: "unverified", confidence: "low" });
    expect(classifyClaimStatus({ currentStatus: "unverified", evaluation: {} })).toEqual({ status: "unverified", confidence: "low" });
  });
});

describe("buildCategoryCoverage — construction: empty, one interview, multiple interviews, missing evidence", () => {
  it("an empty candidate has every active category at status 'unknown', not omitted", () => {
    const coverage = buildCategoryCoverage([]);
    for (const c of ACTIVE_CATEGORIES) {
      expect(coverage[c]).toEqual({ evidenceCount: 0, interviewCount: 0, averageScore: null, lastTestedAt: null, status: "unknown", recentlyTested: false });
    }
  });

  it("defensively handles missing/null memoryRows the same as empty", () => {
    expect(buildCategoryCoverage(null)).toEqual(buildCategoryCoverage([]));
    expect(buildCategoryCoverage(undefined)).toEqual(buildCategoryCoverage([]));
  });

  it("'unknown' (zero evidence) is distinct from 'insufficient' (weak/thin evidence) — unknown does not mean weak", () => {
    const oneWeak = buildCategoryCoverage([memRow({ category: "motivation_fit", score: 50 })]);
    expect(oneWeak.motivation_fit.status).toBe("insufficient");
    expect(oneWeak.behavioural_competency.status).toBe("unknown");
    expect(oneWeak.motivation_fit.status).not.toBe(oneWeak.behavioural_competency.status);
  });

  it("one interview's worth of strong evidence is not yet 'demonstrated' (needs >= 3 evidence points)", () => {
    const coverage = buildCategoryCoverage([
      memRow({ category: "behavioural_competency", score: 90 }),
      memRow({ category: "behavioural_competency", score: 85 }),
    ]);
    expect(coverage.behavioural_competency.status).toBe("insufficient");
    expect(coverage.behavioural_competency.evidenceCount).toBe(2);
  });

  it("multiple interviews with strong, sufficient evidence reach 'demonstrated'", () => {
    const coverage = buildCategoryCoverage([
      memRow({ category: "behavioural_competency", score: 90, interview_id: "iv-1" }),
      memRow({ category: "behavioural_competency", score: 85, interview_id: "iv-2" }),
      memRow({ category: "behavioural_competency", score: 80, interview_id: "iv-3" }),
    ]);
    expect(coverage.behavioural_competency.status).toBe("demonstrated");
    expect(coverage.behavioural_competency.interviewCount).toBe(3);
    expect(coverage.behavioural_competency.averageScore).toBe(85);
  });

  it("sufficient evidence count with a weak average score stays 'insufficient', not 'demonstrated'", () => {
    const coverage = buildCategoryCoverage([
      memRow({ category: "technical_functional", score: 30, interview_id: "iv-1" }),
      memRow({ category: "technical_functional", score: 35, interview_id: "iv-2" }),
      memRow({ category: "technical_functional", score: 40, interview_id: "iv-3" }),
    ]);
    expect(coverage.technical_functional.status).toBe("insufficient");
  });

  it("normalizes legacy category strings via mapLegacyCategory (canonical category mapping)", () => {
    const coverage = buildCategoryCoverage([
      memRow({ category: "cv_behavioural", score: 80, interview_id: "iv-1" }),
      memRow({ category: "role_specific", score: 80, interview_id: "iv-1" }),
    ]);
    expect(coverage.behavioural_competency.evidenceCount).toBe(1);
    expect(coverage.technical_functional.evidenceCount).toBe(1);
  });

  it("recentlyTested reflects the staleness window (last_tested_at based)", () => {
    const now = new Date("2026-03-01T00:00:00Z").getTime();
    const coverage = buildCategoryCoverage([memRow({ category: "motivation_fit", created_at: "2026-02-25T00:00:00Z" })], now);
    expect(coverage.motivation_fit.recentlyTested).toBe(true);

    const staleCoverage = buildCategoryCoverage([memRow({ category: "motivation_fit", created_at: "2025-01-01T00:00:00Z" })], now);
    expect(staleCoverage.motivation_fit.recentlyTested).toBe(false);
  });
});

describe("buildCompetencyCoverage", () => {
  it("aggregates by free-text competency label", () => {
    const coverage = buildCompetencyCoverage([
      memRow({ category: "behavioural_competency", competency: "leadership", score: 80, interview_id: "iv-1" }),
      memRow({ category: "behavioural_competency", competency: "leadership", score: 60, interview_id: "iv-2" }),
      memRow({ category: "commercial_awareness", competency: "market sizing", score: 50, interview_id: "iv-1" }),
    ]);
    expect(coverage.leadership.evidenceCount).toBe(2);
    expect(coverage.leadership.interviewCount).toBe(2);
    expect(coverage.leadership.averageScore).toBe(70);
    expect(coverage["market sizing"].evidenceCount).toBe(1);
  });

  it("skips rows with no competency label and handles empty/missing input", () => {
    expect(buildCompetencyCoverage([{ category: "motivation_fit", competency: "", score: 80 }])).toEqual({});
    expect(buildCompetencyCoverage([])).toEqual({});
    expect(buildCompetencyCoverage(null)).toEqual({});
  });
});

describe("buildUnresolvedClaims / buildRecommendedProbes", () => {
  it("includes unverified and partially_supported, excludes supported and contradicted", () => {
    const claims = [
      claim({ id: "a", claim_text: "a", status: "unverified" }),
      claim({ id: "b", claim_text: "b", status: "partially_supported" }),
      claim({ id: "c", claim_text: "c", status: "supported" }),
      claim({ id: "d", claim_text: "d", status: "contradicted" }),
    ];
    const unresolved = buildUnresolvedClaims(claims);
    expect(unresolved.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("sorts least-evidenced first, then oldest first — deterministic priority order", () => {
    const claims = [
      claim({ id: "later-more-evidence", claim_text: "x", evidence_count: 2, created_at: "2026-01-01T00:00:00Z" }),
      claim({ id: "earlier-no-evidence", claim_text: "y", evidence_count: 0, created_at: "2026-01-02T00:00:00Z" }),
      claim({ id: "earliest-no-evidence", claim_text: "z", evidence_count: 0, created_at: "2026-01-01T00:00:00Z" }),
    ];
    const unresolved = buildUnresolvedClaims(claims);
    expect(unresolved.map((c) => c.id)).toEqual(["earliest-no-evidence", "earlier-no-evidence", "later-more-evidence"]);
  });

  it("buildRecommendedProbes caps at max and returns only claim/why/category/claimId", () => {
    const claims = Array.from({ length: 6 }, (_, i) => claim({ id: `c${i}`, claim_text: `claim ${i}` }));
    const probes = buildRecommendedProbes(buildUnresolvedClaims(claims), 3);
    expect(probes).toHaveLength(3);
    expect(Object.keys(probes[0]).sort()).toEqual(["category", "claim", "claimId", "why"]);
  });

  it("defensively handles empty/missing input", () => {
    expect(buildUnresolvedClaims(null)).toEqual([]);
    expect(buildRecommendedProbes(null)).toEqual([]);
  });
});

describe("mergeProbeAreasForInterview — the 2C integration point", () => {
  it("merges fresh CV claims with recommended persistent probes, deduped", () => {
    const fresh = [{ claim: "Built an automated valuation model", why: "cv" }];
    const recommended = [{ claim: "Led a team of 10", why: "unresolved", category: "behavioural_competency", claimId: "c1" }];
    const merged = mergeProbeAreasForInterview(fresh, recommended);
    expect(merged).toEqual([
      { claim: "Built an automated valuation model", why: "cv" },
      { claim: "Led a team of 10", why: "unresolved" },
    ]);
  });

  it("output is strictly {claim, why} — never leaks category/claimId or any scheduler-owned field", () => {
    const merged = mergeProbeAreasForInterview([], [{ claim: "x claim here", why: "y", category: "motivation_fit", claimId: "c1" }]);
    expect(Object.keys(merged[0]).sort()).toEqual(["claim", "why"]);
  });

  it("drops duplicates between fresh and recommended (same underlying claim from two sources)", () => {
    const fresh = [{ claim: "Led a team of 10 engineers", why: "cv" }];
    const recommended = [{ claim: "led a team of 10 engineers", why: "unresolved" }];
    expect(mergeProbeAreasForInterview(fresh, recommended)).toHaveLength(1);
  });

  it("caps at the max bound regardless of how many claims have accumulated", () => {
    const recommended = Array.from({ length: 10 }, (_, i) => ({ claim: `distinct claim number ${i}`, why: "x" }));
    expect(mergeProbeAreasForInterview([], recommended, 5)).toHaveLength(5);
  });

  it("defensively handles empty/missing input", () => {
    expect(mergeProbeAreasForInterview(null, null)).toEqual([]);
    expect(mergeProbeAreasForInterview(undefined, undefined)).toEqual([]);
  });
});

describe("matchClaimIdForProbeArea", () => {
  it("finds the persisted claim id for a matching probe-area claim text", () => {
    const claims = [claim({ id: "c1", claim_text: "Led a team of 10" })];
    expect(matchClaimIdForProbeArea(claims, "led a team of 10")).toBe("c1");
  });

  it("returns null (never throws) when nothing matches — the fallback path for a fresh, unpersisted claim", () => {
    expect(matchClaimIdForProbeArea([claim({ claim_text: "Led a team of 10" })], "built a valuation model")).toBeNull();
    expect(matchClaimIdForProbeArea([], "anything")).toBeNull();
    expect(matchClaimIdForProbeArea(null, "anything")).toBeNull();
  });
});

describe("buildCandidateSignals — full construction", () => {
  it("an empty candidate produces a complete, well-shaped, empty-but-never-null signals object", () => {
    const signals = buildCandidateSignals({});
    expect(signals.strengths).toEqual([]);
    expect(signals.developmentAreas).toEqual([]);
    expect(signals.unresolvedClaims).toEqual([]);
    expect(signals.recommendedProbes).toEqual([]);
    expect(signals.untestedCompetencies.sort()).toEqual([...ACTIVE_CATEGORIES].sort());
    expect(signals.recentlyTested).toEqual([]);
    for (const c of ACTIVE_CATEGORIES) expect(signals.categoryCoverage[c].status).toBe("unknown");
    expect(isCandidateIntelligenceUsable(signals)).toBe(true);
  });

  it("passes candidate_dna strengths/weaknesses through unchanged (reuses the existing system, doesn't duplicate it)", () => {
    const signals = buildCandidateSignals({ dna: { strengths: ["Clear communicator"], weaknesses: ["Rambles under pressure"] } });
    expect(signals.strengths).toEqual(["Clear communicator"]);
    expect(signals.developmentAreas).toEqual(["Rambles under pressure"]);
  });

  it("multiple interviews across the same candidate accumulate into one coherent view (cross-interview persistence)", () => {
    const memoryRows = [
      memRow({ category: "behavioural_competency", score: 85, interview_id: "iv-1", created_at: "2026-01-01T00:00:00Z" }),
      memRow({ category: "behavioural_competency", score: 80, interview_id: "iv-2", created_at: "2026-01-15T00:00:00Z" }),
    ];
    const signals = buildCandidateSignals({ memoryRows });
    expect(signals.categoryCoverage.behavioural_competency.interviewCount).toBe(2);
    expect(signals.categoryCoverage.commercial_awareness.status).toBe("unknown");
  });

  it("multiple applications' worth of evidence still aggregate into one persistent view — no per-application scoping inside this module", () => {
    // interview_memory rows carry no application_id at all; this module never filters by one,
    // which is exactly what makes the resulting signals a PERSISTENT, cross-application view
    // rather than role/application-specific intelligence (App.jsx layer keeps those separate —
    // see the module header).
    const memoryRows = [
      memRow({ category: "technical_functional", score: 90, interview_id: "iv-goldman" }),
      memRow({ category: "technical_functional", score: 85, interview_id: "iv-google" }),
      memRow({ category: "technical_functional", score: 80, interview_id: "iv-mckinsey" }),
    ];
    const signals = buildCandidateSignals({ memoryRows });
    expect(signals.categoryCoverage.technical_functional.status).toBe("demonstrated");
    expect(signals.categoryCoverage.technical_functional.interviewCount).toBe(3);
  });

  it("unresolved claims feed recommendedProbes end-to-end", () => {
    const claims = [claim({ id: "c1", claim_text: "Built an automated valuation model", status: "unverified", evidence_count: 0 })];
    const signals = buildCandidateSignals({ claims });
    expect(signals.unresolvedClaims).toHaveLength(1);
    expect(signals.recommendedProbes[0].claimId).toBe("c1");
  });

  it("is deterministic — identical input produces identical output across repeated calls", () => {
    const input = {
      dna: { strengths: ["a"], weaknesses: ["b"] },
      memoryRows: [memRow({ category: "motivation_fit", score: 70 })],
      claims: [claim({ claim_text: "x claim" })],
      now: 1750000000000,
    };
    expect(buildCandidateSignals(input)).toEqual(buildCandidateSignals(input));
  });
});

describe("isCandidateIntelligenceUsable — the fallback gate", () => {
  it("true for a well-formed signals object, including an empty one", () => {
    expect(isCandidateIntelligenceUsable(buildCandidateSignals({}))).toBe(true);
  });

  it("false for missing, null, or malformed input — never throws", () => {
    expect(isCandidateIntelligenceUsable(null)).toBe(false);
    expect(isCandidateIntelligenceUsable(undefined)).toBe(false);
    expect(isCandidateIntelligenceUsable({})).toBe(false);
    expect(isCandidateIntelligenceUsable("not an object")).toBe(false);
    expect(isCandidateIntelligenceUsable(42)).toBe(false);
  });
});
