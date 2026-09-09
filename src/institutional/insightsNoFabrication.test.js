/* ================================================================== *
 * INSTITUTIONAL INSIGHTS — "never fabricate" guarantee
 * ------------------------------------------------------------------
 * For every deriver, a suppressed / empty / contract-broken envelope
 * must produce EITHER [] OR only neutral "not enough data" findings —
 * and never a cohort score, percentage, or delta that the data does
 * not contain. This is the property that lets the dashboard be shown
 * to a university without risk of an invented claim.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import {
  deriveOverviewFindings, derivePerformanceFindings, deriveCompetencyFindings,
  deriveCareerFindings, deriveQuestionFindings, deriveImprovementFindings,
  deriveDevelopmentFindings,
} from "./insights.js";
import { MIN_COHORT_N } from "./taxonomy.js";

/* An envelope that is "live" (supported, right threshold) but every group is
 * withheld — the realistic below-threshold case. */
const suppressed = {
  competencies: {
    supported: true, min_n: MIN_COHORT_N, readiness_target: 70, competency_average: null,
    scope: { students_in_scope: 4, students_with_data: 4 },
    dimensions: ["relevance", "specificity", "structure", "evidence", "communication", "competency_demonstration"]
      .map((k) => ({ key: k, n_students: 4, suppressed: true, mean: null })),
  },
  performance: {
    supported: true, min_n: MIN_COHORT_N, readiness_target: 70,
    scope: { students_in_scope: 4, students_with_data: 4 },
    overall: { suppressed: true, reason: "below_min_n", n: 4 },
    distribution: { suppressed: true }, by_stage: [{ key: "first_round", n_students: 3, suppressed: true, mean: null }],
    by_format: [], trend_monthly: [{ month: "2026-08", n_students: 2, suppressed: true, mean: null }],
  },
  career: {
    supported: true, min_n: MIN_COHORT_N, readiness_target: 70, families_total: 3, cross_family_mean: null,
    scope: { students_in_scope: 4, students_with_data: 4 },
    families: [{ key: "swe", n_students: 3, suppressed: true, mean: null }, { key: "ib", n_students: 2, suppressed: true, mean: null }],
  },
  questions: {
    supported: true, min_n: MIN_COHORT_N, readiness_target: 70, cross_category_mean: null,
    scope: { students_in_scope: 4, students_with_data: 4 },
    categories: [{ key: "motivation_fit", n_students: 4, suppressed: true, mean: null }],
  },
  improvement: {
    supported: true, min_n: MIN_COHORT_N, improve_epsilon: 3,
    scope: { students_in_scope: 4, students_with_data: 4, students_with_repeat_practice: 1 },
    overall: { suppressed: true, reason: "below_min_n", n_students_with_repeat: 1 },
    by_dimension: [],
  },
  developmentAreas: {
    supported: true, min_n: MIN_COHORT_N, readiness_target: 70,
    scope: { students_in_scope: 4, students_with_data: 4 }, opportunities: [], reportable: 0,
  },
  overview: {
    supported: true, min_n: MIN_COHORT_N, readiness_target: 70,
    scope: { students_in_scope: 4, students_with_data: 4 },
    activity: { completed_interviews: 6, students_with_completed: 4, coverage_pct: null },
    performance: { suppressed: true, reason: "below_min_n", n: 4 },
    readiness_mix: { suppressed: true },
  },
};

/* Not-yet-deployed / contract-broken envelopes. */
const brokenEnvelopes = [
  null,
  { supported: false, reason: "analytics_engine_pending" },
  { supported: true, min_n: 3 },              // wrong threshold
  { supported: true, min_n: MIN_COHORT_N },   // no data at all
  {},
];

const SCORE_LIKE = /\b(?:[1-9][0-9]|100)\b/; // a 2-digit-or-100 number — a cohort score / % / count

function assertNoFabrication(findings) {
  expect(Array.isArray(findings)).toBe(true);
  for (const f of findings) {
    // suppressed sections may only ever be neutral
    expect(f.severity, `unexpected non-neutral finding on suppressed data: ${f.headline}`).toBe("neutral");
    const text = `${f.headline} ${f.detail}`;
    // the only 2-digit numbers allowed are the threshold itself and a raw
    // "students with data" count (both legitimately known, not a score/%).
    const offenders = (text.match(new RegExp(SCORE_LIKE, "g")) || [])
      .filter((n) => Number(n) !== MIN_COHORT_N);
    for (const n of offenders) {
      const scopeCount = findings.some((x) => x.evidence && (
        x.evidence.students_with_data === Number(n) || x.evidence.students_in_scope === Number(n) ||
        x.evidence.students_with_repeat_practice === Number(n)
      ));
      expect(scopeCount, `finding leaked a score-like number ${n}: "${text}"`).toBe(true);
    }
  }
}

describe("suppressed (below-threshold) data never yields a fabricated figure", () => {
  it("deriveCompetencyFindings", () => assertNoFabrication(deriveCompetencyFindings(suppressed.competencies)));
  it("derivePerformanceFindings", () => assertNoFabrication(derivePerformanceFindings(suppressed.performance)));
  it("deriveCareerFindings", () => assertNoFabrication(deriveCareerFindings(suppressed.career)));
  it("deriveQuestionFindings", () => assertNoFabrication(deriveQuestionFindings(suppressed.questions)));
  it("deriveImprovementFindings", () => assertNoFabrication(deriveImprovementFindings(suppressed.improvement)));
  it("deriveDevelopmentFindings", () => assertNoFabrication(deriveDevelopmentFindings(suppressed.developmentAreas, suppressed.improvement)));
  it("deriveOverviewFindings (cross-section)", () => assertNoFabrication(deriveOverviewFindings(suppressed)));
});

describe("broken / not-deployed envelopes yield [] or only neutral notes — never a throw, never a number", () => {
  const derivers = {
    competencies: (e) => deriveCompetencyFindings(e),
    performance: (e) => derivePerformanceFindings(e),
    career: (e) => deriveCareerFindings(e),
    questions: (e) => deriveQuestionFindings(e),
    improvement: (e) => deriveImprovementFindings(e),
    development: (e) => deriveDevelopmentFindings(e, e),
    overview: (e) => deriveOverviewFindings({ overview: e, competencies: e, improvement: e, developmentAreas: e, performance: e }),
  };
  for (const [name, fn] of Object.entries(derivers)) {
    for (let i = 0; i < brokenEnvelopes.length; i++) {
      it(`${name} — envelope #${i}`, () => {
        let out;
        expect(() => { out = fn(brokenEnvelopes[i]); }).not.toThrow();
        assertNoFabrication(out);
      });
    }
  }
});
