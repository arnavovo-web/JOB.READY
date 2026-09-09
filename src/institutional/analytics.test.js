import { describe, it, expect } from "vitest";
import {
  summariseCohorts, isUnsupported, LIMITATION, shapeCompetencyScores,
  strengthsAndWeaknesses, shapeDistribution, emptyFilters, filtersToRpcArgs, describeFilters,
} from "./analytics.js";
import { MIN_COHORT_N } from "./taxonomy.js";

const COHORTS = [
  { id: "c1", name: "BSc Economics 2026", organisation_id: "o1", academic_year: "2025/26", graduation_year: 2026 },
  { id: "c2", name: "IB Society 2025/26", organisation_id: null, academic_year: null, graduation_year: null },
];
const ORGS = [{ id: "o1", name: "Economics Department" }];
const MEMBERS = [
  { cohort_id: "c1", student_id: "s1", status: "active" },
  { cohort_id: "c1", student_id: "s2", status: "active" },
  { cohort_id: "c1", student_id: null, invited_email: "x@u.ac.uk", status: "invited" },
  { cohort_id: "c2", student_id: "s2", status: "active" }, // s2 in two cohorts
  { cohort_id: "c2", student_id: "s3", status: "removed" }, // excluded
];

describe("summariseCohorts", () => {
  const { rows, totals } = summariseCohorts(COHORTS, MEMBERS, ORGS);

  it("summarises each cohort with linked / pending counts and the org name", () => {
    const c1 = rows.find((r) => r.id === "c1");
    expect(c1).toMatchObject({ linkedStudents: 2, pendingInvites: 1, organisation: "Economics Department" });
    const c2 = rows.find((r) => r.id === "c2");
    expect(c2).toMatchObject({ linkedStudents: 1, pendingInvites: 0, organisation: null });
  });

  it("counts DISTINCT linked students across cohorts (a student in two cohorts is one person)", () => {
    expect(totals.cohorts).toBe(2);
    expect(totals.linkedStudents).toBe(3); // 2 + 1 membership rows
    expect(totals.distinctLinkedStudents).toBe(2); // s1, s2
    expect(totals.pendingInvites).toBe(1);
  });

  it("flags cohorts below the reporting threshold", () => {
    expect(rows.every((r) => r.belowThreshold === (r.linkedStudents < MIN_COHORT_N))).toBe(true);
  });

  it("is safe on empty input", () => {
    const empty = summariseCohorts([], [], []);
    expect(empty.rows).toEqual([]);
    expect(empty.totals.distinctLinkedStudents).toBe(0);
  });
});

describe("analytics envelope helpers", () => {
  it("recognises the api.js unsupported envelope", () => {
    expect(isUnsupported({ supported: false, metric: "overview", reason: "analytics_engine_pending" })).toBe(true);
    expect(isUnsupported(null)).toBe(true);
    expect(isUnsupported({ supported: true, data: {} })).toBe(false);
  });
  it("exposes standard limitation copy including the k-threshold", () => {
    expect(LIMITATION.BELOW_K).toContain(String(MIN_COHORT_N));
    expect(Object.keys(LIMITATION)).toEqual(
      expect.arrayContaining(["ANALYTICS_PENDING", "BELOW_K", "NO_DATA", "METRIC_UNSUPPORTED_BY_SCHEMA"])
    );
  });
});

describe("shapeCompetencyScores", () => {
  it("merges the clarity/communication alias and keeps canonical order", () => {
    const shaped = shapeCompetencyScores({
      relevance: 79, specificity: 60, structure: 63, evidence: 51, clarity: 72, competency_demonstration: 57,
    });
    expect(shaped.map((s) => s.key)).toEqual(
      ["relevance", "specificity", "structure", "evidence", "communication", "competency_demonstration"]
    );
    expect(shaped.find((s) => s.key === "communication").score).toBe(72);
  });
  it("drops withheld/null dimensions and ignores unknown keys", () => {
    const shaped = shapeCompetencyScores({ relevance: 80, evidence: null, "Analytical rigour": 90 });
    expect(shaped.map((s) => s.key)).toEqual(["relevance"]);
  });
  it("returns [] for junk", () => {
    expect(shapeCompetencyScores(null)).toEqual([]);
    expect(shapeCompetencyScores("nope")).toEqual([]);
  });
});

describe("strengthsAndWeaknesses", () => {
  it("ranks shaped scores into strongest / weakest slices", () => {
    const shaped = shapeCompetencyScores({
      relevance: 80, specificity: 40, structure: 70, evidence: 30, communication: 75, competency_demonstration: 55,
    });
    const { strongest, weakest } = strengthsAndWeaknesses(shaped, 2);
    expect(strongest.map((s) => s.key)).toEqual(["relevance", "communication"]);
    expect(weakest.map((s) => s.key)).toEqual(["evidence", "specificity"]);
  });
});

describe("shapeDistribution — k-anonymity suppression", () => {
  it("suppresses the whole distribution when fewer than MIN_COHORT_N students contribute", () => {
    const res = shapeDistribution({ n: MIN_COHORT_N - 1, buckets: [{ label: "Not ready", count: 2 }, { label: "Strong", count: 1 }] });
    expect(res.suppressed).toBe(true);
    expect(res.reason).toBe(LIMITATION.BELOW_K);
    expect(res.rows).toEqual([]);
  });
  it("passes through with percentages once the threshold is met", () => {
    const res = shapeDistribution({ n: 10, buckets: [{ label: "Not ready", count: 4 }, { label: "Interview ready", count: 6 }] });
    expect(res.suppressed).toBe(false);
    expect(res.rows).toEqual([
      { label: "Not ready", count: 4, pct: 40, tone: null },
      { label: "Interview ready", count: 6, pct: 60, tone: null },
    ]);
  });
  it("handles missing buckets", () => {
    expect(shapeDistribution(null).suppressed).toBe(true);
  });
});

describe("filter state", () => {
  it("emptyFilters is all-null", () => {
    expect(emptyFilters()).toEqual({ cohortIds: null, from: null, to: null });
  });
  it("filtersToRpcArgs normalises empty arrays to null", () => {
    expect(filtersToRpcArgs({ cohortIds: [], from: "", to: null })).toEqual({ cohortIds: null, from: null, to: null });
    expect(filtersToRpcArgs({ cohortIds: ["c1"], from: "2026-01-01", to: null })).toEqual({ cohortIds: ["c1"], from: "2026-01-01", to: null });
  });
  it("describeFilters renders a human summary", () => {
    const summary = summariseCohorts(COHORTS, MEMBERS, ORGS);
    expect(describeFilters({ cohortIds: null, from: null, to: null }, summary)).toBe("All cohorts · All time");
    expect(describeFilters({ cohortIds: ["c1"], from: "2026-01-01", to: null }, summary)).toBe("BSc Economics 2026 · 2026-01-01 → now");
    expect(describeFilters({ cohortIds: ["c1", "c2"], from: null, to: null }, summary)).toContain("BSc Economics 2026 + IB Society");
  });
});
