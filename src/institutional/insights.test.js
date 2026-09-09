/* ================================================================== *
 * INSTITUTIONAL INSIGHTS — insight-derivation tests
 * Fixtures mirror real inst_* RPC envelope shapes (captured from the
 * live functions against synthetic data). Asserts that the derived
 * findings are correct, data-grounded restatements — and that a
 * suppressed / empty section never produces a fabricated claim.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import {
  isLive, contractIssue, rankFindings, sectionHeadline,
  deriveCompetencyFindings, deriveDevelopmentFindings, deriveImprovementFindings,
  derivePerformanceFindings, deriveCareerFindings, deriveQuestionFindings,
  deriveOverviewFindings,
} from "./insights.js";
import { MIN_COHORT_N } from "./taxonomy.js";

/* ---------- fixtures ---------- */
const COMPETENCIES_LIVE = {
  supported: true, min_n: 5, readiness_target: 70, material_gap_points: 4,
  competency_average: 50,
  scope: { students_in_scope: 13, students_with_data: 12 },
  dimensions: [
    { key: "communication", n_students: 12, suppressed: false, mean: 56, median: 60, stddev: 21.5, pct_at_or_above_target: 25, delta_vs_competency_avg: 6.1, materially_below: false },
    { key: "competency_demonstration", n_students: 12, suppressed: false, mean: 47, median: 52, pct_at_or_above_target: 0, delta_vs_competency_avg: -2.7, materially_below: false },
    { key: "evidence", n_students: 12, suppressed: false, mean: 40, median: 44, pct_at_or_above_target: 0, delta_vs_competency_avg: -10, materially_below: true },
    { key: "relevance", n_students: 12, suppressed: false, mean: 59, median: 64, pct_at_or_above_target: 33, delta_vs_competency_avg: 9.2, materially_below: false },
    { key: "specificity", n_students: 12, suppressed: false, mean: 45, median: 50, pct_at_or_above_target: 0, delta_vs_competency_avg: -4.4, materially_below: true },
    { key: "structure", n_students: 12, suppressed: false, mean: 52, median: 58, pct_at_or_above_target: 17, delta_vs_competency_avg: 1.8, materially_below: false },
  ],
};
const COMPETENCIES_SUPPRESSED = {
  supported: true, min_n: 5, readiness_target: 70, competency_average: null,
  scope: { students_in_scope: 5, students_with_data: 4 },
  dimensions: [
    { key: "evidence", n_students: 4, suppressed: true, mean: null },
    { key: "relevance", n_students: 4, suppressed: true, mean: null },
  ],
};
const DEVELOPMENT_LIVE = {
  supported: true, min_n: 5, readiness_target: 70,
  scope: { students_in_scope: 13, students_with_data: 12 },
  opportunities: [
    { kind: "competency", key: "evidence", n_students: 12, cohort_mean: 40, gap_vs_target: 30.1, pct_below_target: 100, opportunity_score: 30.1 },
    { kind: "competency", key: "specificity", n_students: 12, cohort_mean: 45, gap_vs_target: 24.6, pct_below_target: 100, opportunity_score: 24.6 },
    { kind: "question_category", key: "motivation_fit", n_students: 12, cohort_mean: 46, gap_vs_target: 23.5, pct_below_target: 100, opportunity_score: 23.5 },
    { kind: "competency", key: "structure", n_students: 12, cohort_mean: 52, gap_vs_target: 18.4, pct_below_target: 83, opportunity_score: 15.3 },
  ],
  reportable: 4,
};
const IMPROVEMENT_LIVE = {
  supported: true, min_n: 5, improve_epsilon: 3,
  scope: { students_in_scope: 13, students_with_data: 12, students_with_repeat_practice: 9 },
  overall: { suppressed: false, n_students: 9, mean_delta: 6.8, median_delta: 7, pct_improving: 100, pct_declining: 0 },
  by_dimension: [
    { key: "structure", n_students: 8, suppressed: false, mean_delta: 5.2, pct_improving: 88 },
    { key: "evidence", n_students: 8, suppressed: false, mean_delta: -0.5, pct_improving: 40 },
    { key: "relevance", n_students: 8, suppressed: false, mean_delta: -4.3, pct_improving: 20 },
  ],
};
const IMPROVEMENT_SUPPRESSED = {
  supported: true, min_n: 5, improve_epsilon: 3,
  scope: { students_in_scope: 5, students_with_data: 4, students_with_repeat_practice: 1 },
  overall: { suppressed: true, reason: "below_min_n", n_students_with_repeat: 1 },
  by_dimension: [],
};
const PERFORMANCE_LIVE = {
  supported: true, min_n: 5, readiness_target: 70,
  scope: { students_in_scope: 13, students_with_data: 12 },
  overall: { suppressed: false, n_students: 12, n_interviews: 21, mean: 53, median: 60, p25: 54, p75: 66, pct_at_or_above_target: 8 },
  distribution: { suppressed: false, n: 12, buckets: [{ label: "priority", count: 2 }, { label: "developing", count: 3 }, { label: "solid", count: 7 }] },
  by_stage: [
    { key: "first_round", n_students: 10, suppressed: false, mean: 66 },
    { key: "final_round", n_students: 8, suppressed: false, mean: 48 },
    { key: "recruiter_screen", n_students: 1, suppressed: true, mean: null },
  ],
  by_format: [{ key: "live_conversational", n_students: 10, suppressed: false, mean: 56 }],
  trend_monthly: [{ month: "2026-08", n_students: 10, suppressed: false, mean: 60 }],
};
const CAREER_LIVE = {
  supported: true, min_n: 5, readiness_target: 70, cross_family_mean: 62, families_total: 3, families_reportable: 2,
  scope: { students_in_scope: 13, students_with_data: 12 },
  families: [
    { key: "markets", n_students: 6, n_interviews: 9, suppressed: false, mean: 55, delta_vs_cross_family: -7, gap_vs_target: 15 },
    { key: "consulting", n_students: 8, n_interviews: 16, suppressed: false, mean: 69, delta_vs_cross_family: 7, gap_vs_target: 1 },
    { key: "swe", n_students: 1, n_interviews: 1, suppressed: true, mean: null },
  ],
};
const CAREER_ONE_FAMILY = {
  supported: true, min_n: 5, readiness_target: 70, cross_family_mean: 62, families_total: 2,
  scope: { students_in_scope: 13, students_with_data: 12 },
  families: [
    { key: "consulting", n_students: 8, n_interviews: 16, suppressed: false, mean: 62, gap_vs_target: 8 },
    { key: "markets", n_students: 3, suppressed: true, mean: null },
  ],
};
const QUESTIONS_LIVE = {
  supported: true, min_n: 5, readiness_target: 70, cross_category_mean: 50,
  scope: { students_in_scope: 13, students_with_data: 12 },
  categories: [
    { key: "motivation_fit", n_students: 12, n_answers: 17, suppressed: false, mean: 46, delta_vs_cross_category: -3.8, gap_vs_target: 23.5 },
    { key: "behavioural_competency", n_students: 12, n_answers: 25, suppressed: false, mean: 52, gap_vs_target: 18 },
    { key: "commercial_awareness", n_students: 11, n_answers: 15, suppressed: false, mean: 58, gap_vs_target: 12 },
    { key: "technical_functional", n_students: 3, suppressed: true, mean: null },
  ],
};
const OVERVIEW_LIVE = {
  supported: true, min_n: 5, readiness_target: 70,
  scope: { students_in_scope: 13, students_with_data: 12 },
  activity: { completed_interviews: 21, students_with_completed: 12, coverage_pct: 92, avg_interviews_per_active_student: 1.75 },
  performance: { suppressed: false, n_students: 12, mean_overall: 53, median_overall: 60, pct_at_or_above_target: 8 },
  readiness_mix: { suppressed: false, n: 12, buckets: [{ key: "needs_improvement", count: 9 }, { key: "interview_ready", count: 3 }] },
};

/* ---------- contract ---------- */
describe("contract guards", () => {
  it("isLive only accepts a real, matching-threshold envelope", () => {
    expect(isLive(COMPETENCIES_LIVE)).toBe(true);
    expect(isLive({ supported: false })).toBe(false);
    expect(isLive({ supported: true, min_n: 3 })).toBe(false);
    expect(isLive(null)).toBe(false);
  });
  it("contractIssue explains a threshold mismatch", () => {
    expect(contractIssue({ supported: true, min_n: 99 })).toMatch(/threshold mismatch/i);
    expect(contractIssue(COMPETENCIES_LIVE)).toBeNull();
    expect(contractIssue({ supported: false })).toMatch(/not deployed/i);
  });
});

/* ---------- competencies ---------- */
describe("deriveCompetencyFindings", () => {
  const f = deriveCompetencyFindings(COMPETENCIES_LIVE);
  it("names the strongest competency with the right number", () => {
    const s = f.find((x) => x.severity === "positive");
    expect(s.headline).toBe("Relevance is the cohort's strongest competency");
    expect(s.detail).toContain("59");
    expect(s.detail).toContain("above the competency average (50)");
  });
  it("flags the weakest competency as critical when below the interview-ready threshold", () => {
    const w = f.find((x) => x.headline.includes("weakest"));
    expect(w.headline).toBe("Evidence is the cohort's weakest competency");
    expect(w.severity).toBe("critical");
    expect(w.detail).toContain("30 points below the interview-ready threshold");
  });
  it("calls out the materially-below dimensions by name", () => {
    const m = f.find((x) => x.headline.includes("materially below"));
    expect(m.headline).toBe("Evidence and specificity are materially below the cohort's competency average");
    expect(m.evidence.keys).toEqual(["evidence", "specificity"]);
  });
  it("notes an uneven spread only when it is large", () => {
    const sp = f.find((x) => x.headline.includes("uneven"));
    expect(sp).toBeTruthy();
    expect(sp.detail).toContain("19 point"); // 59 - 40
  });
  it("suppressed section -> a single neutral 'not enough data' finding, never a fabricated number", () => {
    const s = deriveCompetencyFindings(COMPETENCIES_SUPPRESSED);
    expect(s).toHaveLength(1);
    expect(s[0].severity).toBe("neutral");
    expect(s[0].headline).toMatch(/not enough data/i);
    expect(JSON.stringify(s[0])).not.toMatch(/\b(4[0-9]|5[0-9]|6[0-9])\b/); // no cohort score leaked
  });
});

/* ---------- development areas (synthesis) ---------- */
describe("deriveDevelopmentFindings", () => {
  it("headlines the single biggest opportunity and attaches improvement direction", () => {
    const f = deriveDevelopmentFindings(DEVELOPMENT_LIVE, IMPROVEMENT_LIVE);
    const top = f[0];
    expect(top.severity).toBe("critical");
    expect(top.headline).toBe("Evidence is the cohort's biggest development opportunity");
    expect(top.detail).toContain("100% of reportable students score below interview-ready");
    expect(top.detail).toContain("30 point");
    // evidence improvement delta is -0.5 -> "broadly flat"
    expect(top.detail).toMatch(/broadly flat with repeated practice/);
  });
  it("labels a question-category opportunity as '… questions'", () => {
    const f = deriveDevelopmentFindings(DEVELOPMENT_LIVE, IMPROVEMENT_LIVE);
    const cat = f.find((x) => x.evidence.kind === "question_category");
    expect(cat.headline).toContain("Motivation & fit questions");
  });
  it("says 'not improving' when the tied competency is declining with practice", () => {
    const dev = { ...DEVELOPMENT_LIVE, opportunities: [
      { kind: "competency", key: "relevance", n_students: 12, cohort_mean: 55, gap_vs_target: 15, pct_below_target: 80, opportunity_score: 12 },
    ]};
    const f = deriveDevelopmentFindings(dev, IMPROVEMENT_LIVE); // relevance delta -4.3
    expect(f[0].detail).toMatch(/not improving with repeated practice/);
  });
  it("suppressed / empty -> neutral 'not enough data', no ranking claim", () => {
    const f = deriveDevelopmentFindings({ supported: true, min_n: 5, opportunities: [], scope: { students_with_data: 4 } }, IMPROVEMENT_SUPPRESSED);
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe("neutral");
    expect(f[0].headline).toMatch(/not enough data/i);
  });
});

/* ---------- improvement ---------- */
describe("deriveImprovementFindings", () => {
  it("reports the per-student-then-cohort delta as positive when students improve", () => {
    const f = deriveImprovementFindings(IMPROVEMENT_LIVE);
    expect(f[0].severity).toBe("positive");
    expect(f[0].headline).toBe("Students improve with repeated interview practice");
    expect(f[0].detail).toContain("+6.8 points");
    expect(f[0].detail).toContain("median +7");
    expect(f[0].detail).toContain("100% improved");
  });
  it("surfaces the strongest-improving and a declining dimension", () => {
    const f = deriveImprovementFindings(IMPROVEMENT_LIVE);
    expect(f.some((x) => x.headline === "Improvement is strongest in Structure")).toBe(true);
    expect(f.some((x) => x.headline === "Relevance is not improving with practice")).toBe(true);
  });
  it("suppressed -> a single neutral finding explaining the per-student method", () => {
    const f = deriveImprovementFindings(IMPROVEMENT_SUPPRESSED);
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe("neutral");
    expect(f[0].detail).toContain("per student");
    expect(f[0].detail).toContain(String(MIN_COHORT_N));
  });
});

/* ---------- performance ---------- */
describe("derivePerformanceFindings", () => {
  const f = derivePerformanceFindings(PERFORMANCE_LIVE);
  it("leads with the interview-ready share and the spread", () => {
    expect(f[0].headline).toBe("8% of students score at interview-ready or better");
    expect(f[0].severity).toBe("watch");
    expect(f[0].detail).toContain("middle half 54–66");
  });
  it("flags the priority band", () => {
    expect(f.some((x) => x.headline.includes("priority band"))).toBe(true);
  });
  it("detects a final-round drop", () => {
    const drop = f.find((x) => x.headline.includes("final round"));
    expect(drop.headline).toBe("Performance drops at the final round");
    expect(drop.detail).toContain("−18");
  });
  it("suppressed overall -> not-enough-data", () => {
    expect(derivePerformanceFindings({ supported: true, min_n: 5, overall: { suppressed: true }, scope: {} })[0].severity).toBe("neutral");
  });
});

/* ---------- career ---------- */
describe("deriveCareerFindings", () => {
  it("names the weakest reportable career path and the spread", () => {
    const f = deriveCareerFindings(CAREER_LIVE);
    expect(f.some((x) => x.headline === "Markets, sales & trading is the cohort's weakest career path")).toBe(true);
    const spread = f.find((x) => x.headline.includes("varies by career path"));
    expect(spread.detail).toContain("14 point"); // 69 - 55
  });
  it("with only one reportable family, says so plainly", () => {
    const f = deriveCareerFindings(CAREER_ONE_FAMILY);
    expect(f).toHaveLength(1);
    expect(f[0].headline).toContain("Only the Management consulting path");
  });
  it("with no reportable family, a neutral note only", () => {
    const f = deriveCareerFindings({ supported: true, min_n: 5, families_total: 3, families: [{ suppressed: true, mean: null }], scope: {} });
    expect(f[0].severity).toBe("neutral");
    expect(f[0].headline).toMatch(/No career path has enough students/);
  });
});

/* ---------- questions ---------- */
describe("deriveQuestionFindings", () => {
  const f = deriveQuestionFindings(QUESTIONS_LIVE);
  it("identifies the hardest question category", () => {
    expect(f[0].headline).toBe("Motivation & fit questions cause the cohort the most difficulty");
    expect(f[0].detail).toContain("Category average is 50");
  });
  it("names the strongest category when the spread is wide", () => {
    expect(f.some((x) => x.headline.includes("Commercial awareness questions are the cohort's strongest"))).toBe(true);
  });
});

/* ---------- overview synthesis ---------- */
describe("deriveOverviewFindings", () => {
  const f = deriveOverviewFindings({
    overview: OVERVIEW_LIVE, competencies: COMPETENCIES_LIVE,
    improvement: IMPROVEMENT_LIVE, developmentAreas: DEVELOPMENT_LIVE, performance: PERFORMANCE_LIVE,
  });
  it("opens with the readiness headline including coverage", () => {
    expect(f[0].headline).toBe("8% of students are interview-ready");
    expect(f[0].detail).toContain("92% of the cohort has practised");
  });
  it("carries the biggest development opportunity into the exec summary", () => {
    expect(f.some((x) => x.headline === "Evidence is the cohort's biggest development opportunity" && x.section === "overview")).toBe(true);
  });
  it("carries the improvement headline and a positive competency balance", () => {
    expect(f.some((x) => x.headline.includes("improve with repeated interview practice"))).toBe(true);
    expect(f.some((x) => x.headline.includes("strongest competency"))).toBe(true);
  });
  it("degrades gracefully when everything is suppressed", () => {
    const g = deriveOverviewFindings({
      overview: { supported: true, min_n: 5, performance: { suppressed: true }, scope: { students_with_data: 4 } },
      competencies: COMPETENCIES_SUPPRESSED, improvement: IMPROVEMENT_SUPPRESSED,
      developmentAreas: { supported: true, min_n: 5, opportunities: [], scope: { students_with_data: 4 } },
    });
    expect(g.every((x) => x.severity === "neutral")).toBe(true);
    expect(g.some((x) => x.headline.match(/not enough/i))).toBe(true);
  });
});

/* ---------- ranking helpers ---------- */
describe("rankFindings / sectionHeadline", () => {
  it("orders worst-first", () => {
    const ranked = rankFindings([
      { severity: "positive", headline: "a" }, { severity: "critical", headline: "b" },
      { severity: "neutral", headline: "c" }, { severity: "watch", headline: "d" },
    ]);
    expect(ranked.map((x) => x.headline)).toEqual(["b", "d", "c", "a"]);
  });
  it("sectionHeadline picks the worst finding's headline", () => {
    expect(sectionHeadline("x", deriveCompetencyFindings(COMPETENCIES_LIVE))).toBe("Evidence is the cohort's weakest competency");
  });
});
