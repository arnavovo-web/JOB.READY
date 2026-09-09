/* ================================================================== *
 * EKI² — presentation layer (present.js) unit tests
 * ------------------------------------------------------------------
 * present.js turns the analytical FINDINGS from insights.js into the
 * language a careers adviser uses. These tests pin:
 *   - the severity → careers-team vocabulary mapping
 *   - humanize(): plain sentence + one figure, NEVER a fabricated
 *     number and NEVER causal language
 *   - suggestedAction(): deterministic, only where an intervention
 *     genuinely follows, never for insufficient-data findings
 *   - overviewCards(): ≤4 cards, one per bucket, placeholders dropped
 *   - verdictFor(): one calm word, or null when suppressed
 * Pure — no DB, no React.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import {
  SEVERITY_UX, severityUx, plainDimension, bandWord, bandTone,
  humanize, suggestedAction, overviewCards, verdictFor, sectionVerdictLine,
} from "./present.js";
import * as insights from "./insights.js";
import {
  derivePerformanceFindings, deriveCompetencyFindings, deriveDevelopmentFindings,
  deriveImprovementFindings,
} from "./insights.js";

const live = (extra) => ({ supported: true, min_n: 5, ...extra });

const PERF = live({
  readiness_target: 70,
  overall: { mean: 62, median: 61, pct_at_or_above_target: 30, n_students: 12, n_interviews: 40, p25: 52, p75: 72, suppressed: false },
  distribution: { n: 12, suppressed: false, buckets: [{ label: "priority", count: 5 }, { label: "developing", count: 4 }, { label: "solid", count: 3 }] },
  by_stage: [
    { key: "first_round", mean: 66, suppressed: false, n_students: 8 },
    { key: "final_round", mean: 55, suppressed: false, n_students: 6 },
  ],
});
const PERF_SUPPRESSED = live({ readiness_target: 70, overall: { suppressed: true }, scope: { students_with_data: 2 } });

const COMP = live({
  readiness_target: 70,
  competency_average: 64,
  material_gap_points: 4,
  dimensions: [
    { key: "communication", mean: 74, suppressed: false, n_students: 10, materially_below: false, delta_vs_competency_avg: 10 },
    { key: "evidence", mean: 55, suppressed: false, n_students: 10, materially_below: true, delta_vs_competency_avg: -9, pct_at_or_above_target: 20 },
    { key: "structure", mean: 66, suppressed: false, n_students: 10, materially_below: false, delta_vs_competency_avg: 2 },
  ],
});

const DEV = live({
  readiness_target: 70,
  method: "gap × share below interview-ready",
  opportunities: [
    { kind: "competency", key: "evidence", cohort_mean: 55, pct_below_target: 80, gap_vs_target: 15 },
    { kind: "question_category", key: "behavioural_competency", cohort_mean: 60, pct_below_target: 70, gap_vs_target: 10 },
  ],
});

const IMP = live({
  improve_epsilon: 3,
  overall: { suppressed: false, mean_delta: 6, median_delta: 5, n_students: 9, pct_improving: 66, pct_declining: 10 },
  by_dimension: [{ key: "structure", suppressed: false, mean_delta: 7, pct_improving: 70 }],
});

const CAUSAL = /\b(because|caused by|causes|leads to|due to|as a result of|thanks to)\b/i;

describe("severity → careers-team vocabulary", () => {
  it("maps every analytical severity to a bucket + calm label + tone", () => {
    expect(SEVERITY_UX.critical).toMatchObject({ bucket: "attention", tone: "bad" });
    expect(SEVERITY_UX.watch).toMatchObject({ bucket: "watch", tone: "warn" });
    expect(SEVERITY_UX.neutral).toMatchObject({ bucket: "insight", tone: "info" });
    expect(SEVERITY_UX.positive).toMatchObject({ bucket: "working", tone: "good" });
    expect(SEVERITY_UX.critical.label).toMatch(/needs attention/i);
  });
  it("severityUx falls back to the neutral 'key insight' bucket for anything unknown", () => {
    expect(severityUx("nonsense")).toBe(SEVERITY_UX.neutral);
  });
});

describe("plainDimension / bandWord", () => {
  it("gives a verb / noun phrase for each known competency dimension", () => {
    expect(plainDimension("evidence", "verb")).toMatch(/examples/);
    expect(plainDimension("evidence", "noun")).toMatch(/evidence/);
    expect(plainDimension("structure", "skill")).toMatch(/structur/i);
  });
  it("falls back to the taxonomy label (lower-cased) for an unknown key", () => {
    expect(plainDimension("made_up_key")).toBe("made_up_key");
  });
  it("bandWord is a single calm word keyed off the readiness target", () => {
    expect(bandWord(82)).toBe("Strong");
    expect(bandWord(72, 70)).toBe("Solid");
    expect(bandWord(60, 70)).toBe("Developing");
    expect(bandWord(40, 70)).toBe("Priority");
    expect(bandWord(null)).toBe(null);
    expect(bandTone("Priority")).toBe("bad");
    expect(bandTone("Strong")).toBe("good");
  });
});

describe("humanize(finding)", () => {
  it("returns the { lead, why, figure, tone } shape and a safe empty result for null", () => {
    expect(humanize(null)).toEqual({ lead: "", why: "", figure: null, tone: "neutral" });
  });

  it("performance: a plain sentence + a single supporting figure, tone from severity", () => {
    const [top] = derivePerformanceFindings(PERF);
    const h = humanize(top);
    expect(h.lead).toMatch(/progress towards interview readiness/i);
    expect(h.why).toMatch(/8 pts below/); // 70 - 62
    expect(h.figure).toBe("30% interview-ready");
    expect(h.tone).toBe("info"); // neutral severity
    expect(h.lead + h.why).not.toMatch(CAUSAL);
  });

  it("competencies: names the weakest dimension in human terms with a below-target figure", () => {
    const findings = deriveCompetencyFindings(COMP);
    const weakest = findings.find((f) => f.headline.includes("weakest competency"));
    const h = humanize(weakest);
    expect(h.lead).toMatch(/hardest to back answers with specific, real examples/i);
    expect(h.figure).toMatch(/15 pts below interview-ready/);
    expect(h.tone).toBe("bad");
    expect(h.lead + h.why).not.toMatch(CAUSAL);
  });

  it("competencies: the strongest dimension is framed as a positive with an 'above average' figure", () => {
    const findings = deriveCompetencyFindings(COMP);
    const strongest = findings.find((f) => f.headline.includes("strongest competency"));
    const h = humanize(strongest);
    expect(h.lead).toMatch(/strongest at/i);
    expect(h.figure).toMatch(/10 pts above average/);
  });

  it("NEVER fabricates a figure for an insufficient-data finding", () => {
    const [only] = derivePerformanceFindings(PERF_SUPPRESSED);
    expect(only.headline).toMatch(/not enough data/i);
    const h = humanize(only);
    expect(h.figure).toBe(null);
    expect(h.lead).toBeTruthy();
  });

  it("no humanized finding across the sample uses causal language", () => {
    const sample = [
      ...derivePerformanceFindings(PERF),
      ...deriveCompetencyFindings(COMP),
      ...deriveDevelopmentFindings(DEV, IMP),
      ...deriveImprovementFindings(IMP),
    ];
    for (const f of sample) {
      const h = humanize(f);
      expect(`${h.lead} ${h.why} ${h.figure || ""}`).not.toMatch(CAUSAL);
    }
  });
});

describe("suggestedAction(finding)", () => {
  it("a critical development gap yields a grounded action + a Review appointments CTA", () => {
    const [top] = deriveDevelopmentFindings(DEV, IMP);
    const a = suggestedAction(top);
    expect(a).toBeTruthy();
    expect(a.text).toMatch(/practice|appointments/i);
    expect(a.cta).toMatchObject({ target: "appointments" });
  });
  it("returns null for null, and for an insufficient-data finding", () => {
    expect(suggestedAction(null)).toBe(null);
    const [none] = derivePerformanceFindings(PERF_SUPPRESSED);
    expect(suggestedAction(none)).toBe(null);
  });
  it("returns null for a purely informational neutral finding", () => {
    const findings = deriveCompetencyFindings(COMP);
    const uneven = findings.find((f) => f.headline.includes("uneven"));
    expect(uneven && uneven.severity).toBe("neutral");
    expect(suggestedAction(uneven)).toBe(null);
  });
  it("a positive improvement finding suggests continuing, with no appointments CTA", () => {
    const findings = deriveImprovementFindings(IMP);
    const positive = findings.find((f) => f.headline.includes("improve with repeated"));
    const a = suggestedAction(positive);
    expect(a.text).toMatch(/keep encouraging repeated practice/i);
    expect(a.cta).toBe(null);
  });
});

describe("overviewCards(sections, derivers)", () => {
  const SECTIONS = {
    performance: PERF, competencies: COMP, career: { supported: false },
    developmentAreas: DEV, questions: { supported: false }, improvement: IMP,
  };

  it("returns at most four cards, one per bucket, each minimal and navigable", () => {
    const cards = overviewCards(SECTIONS, insights);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(4);
    const buckets = cards.map((c) => c.bucket);
    expect(new Set(buckets).size).toBe(buckets.length); // no bucket twice
    for (const c of cards) {
      expect(typeof c.insight).toBe("string");
      expect(c.insight.length).toBeGreaterThan(0);
      expect(c.label).toBeTruthy();
      expect(c.tone).toBeTruthy();
      expect(c.target).toBeTruthy();
      expect(c.findingId).toBeTruthy();
    }
  });

  it("leads with the biggest development gap in the 'needs attention' bucket", () => {
    const cards = overviewCards(SECTIONS, insights);
    const attention = cards.find((c) => c.bucket === "attention");
    expect(attention).toBeTruthy();
    expect(attention.target).toBe("development");
    expect(attention.actionText).toMatch(/practice|appointments/i);
  });

  it("drops 'not enough data' placeholders and returns [] when nothing real remains", () => {
    expect(overviewCards({ performance: PERF_SUPPRESSED }, insights)).toEqual([]);
    expect(overviewCards({}, insights)).toEqual([]);
  });
});

describe("verdictFor(kind, env, findings)", () => {
  it("performance: one calm word + sentence + figure, derived from the mean", () => {
    const findings = derivePerformanceFindings(PERF);
    const v = verdictFor("performance", PERF, findings);
    expect(v.word).toBe("Developing"); // mean 62 vs target 70
    expect(v.tone).toBe("warn");
    expect(v.sentence).toBeTruthy();
    expect(v.figure).toMatch(/8 pts below interview-ready/);
  });
  it("performance: null when the headline metric is suppressed", () => {
    expect(verdictFor("performance", PERF_SUPPRESSED, [])).toBe(null);
  });
  it("competencies: strongest/weakest sentence + competency-average figure", () => {
    const v = verdictFor("competencies", COMP, deriveCompetencyFindings(COMP));
    expect(v.word).toBe("Developing");
    expect(v.sentence).toMatch(/strongest at .* need most support with/i);
    expect(v.figure).toBe("Competency average 64");
  });
  it("competencies: null when there is no competency average", () => {
    expect(verdictFor("competencies", live({}), [])).toBe(null);
  });
});

describe("sectionVerdictLine", () => {
  it("collapses a findings list to one lead + figure + tone, or null when empty", () => {
    const line = sectionVerdictLine(deriveCompetencyFindings(COMP));
    expect(line).toMatchObject({ tone: expect.any(String) });
    expect(line.lead).toBeTruthy();
    expect(sectionVerdictLine([])).toBe(null);
  });
});
