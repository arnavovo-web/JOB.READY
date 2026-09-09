/* ================================================================== *
 * INSTITUTIONAL INSIGHTS — chart render smoke tests
 * ------------------------------------------------------------------
 * The project has no DOM test env by design, but react-dom/server's
 * renderToStaticMarkup runs in plain node. These render the PURE
 * presentational primitives from charts.jsx / ui.jsx with realistic
 * fixtures and assert they (a) never throw and (b) emit the expected
 * numbers / suppression treatment — so a k-anonymised group can never
 * be drawn as a real bar.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FindingList, ScoreBars, DistributionBar, DeltaBars, TrendLine,
  OpportunityList, SuppressedBlock, KeyStatRow, CalloutPair,
} from "./charts.jsx";

const html = (el) => renderToStaticMarkup(el);

describe("FindingList", () => {
  it("renders each finding's headline + severity tag", () => {
    const out = html(<FindingList findings={[
      { id: "a", severity: "critical", headline: "Evidence is the biggest gap", detail: "Cohort mean 40." },
      { id: "b", severity: "positive", headline: "Relevance is strongest", detail: "Cohort mean 65." },
    ]} />);
    expect(out).toContain("Evidence is the biggest gap");
    expect(out).toContain("Cohort mean 40.");
    expect(out).toContain("Relevance is strongest");
    expect(out).toMatch(/Priority/);
    expect(out).toMatch(/Strength/);
  });
  it("shows an empty label rather than an empty box", () => {
    expect(html(<FindingList findings={[]} emptyLabel="Nothing yet." />)).toContain("Nothing yet.");
  });
});

describe("ScoreBars", () => {
  const target = 70;
  it("draws reportable dimensions with their mean and a target marker", () => {
    const out = html(<ScoreBars target={target} rows={[
      { key: "relevance", label: "Relevance", mean: 59, suppressed: false, n_students: 12, min_n: 5, deltaLabel: "+9 vs avg", deltaTone: "good" },
      { key: "evidence", label: "Evidence", mean: 40, suppressed: false, n_students: 12, min_n: 5 },
    ]} />);
    expect(out).toContain("Relevance");
    expect(out).toContain("59");
    expect(out).toContain("+9 vs avg");
    expect(out).toContain("ii-meter-target");
    expect(out).toContain("interview-ready (70)");
  });
  it("a suppressed row (among reportable ones) shows a lock, never a bar or a number", () => {
    const out = html(<ScoreBars target={target} rows={[
      { key: "fr", label: "First round", mean: 62, suppressed: false, n_students: 10, min_n: 5 },
      { key: "x", label: "Recruiter screen", mean: null, suppressed: true, n_students: 3, min_n: 5 },
    ]} />);
    expect(out).toContain("Recruiter screen");
    expect(out).toMatch(/n&lt;5|n<5/);
    // exactly one drawn bar (the reportable row); the suppressed row draws none
    expect((out.match(/ii-meter-fill-/g) || []).length).toBe(1);
    expect(out).toContain(">62<");
  });
  it("all-suppressed -> a single explanatory block", () => {
    const out = html(<ScoreBars target={target} rows={[
      { key: "a", suppressed: true, n_students: 2, min_n: 5 }, { key: "b", suppressed: true, n_students: 1, min_n: 5 },
    ]} />);
    expect(out).toMatch(/Hidden to protect individual students/);
  });
});

describe("DistributionBar", () => {
  it("segments sum to the legend counts + percentages", () => {
    const out = html(<DistributionBar n={12} min={5} segments={[
      { label: "Priority (<45)", count: 2, tone: "bad" },
      { label: "Developing (45–59)", count: 3, tone: "warn" },
      { label: "Solid (60–74)", count: 7, tone: "good" },
    ]} />);
    expect(out).toContain("Priority (&lt;45)");
    expect(out).toContain("17%"); // 2/12
    expect(out).toContain("58%"); // 7/12
  });
  it("no data -> suppressed block", () => {
    expect(html(<DistributionBar n={0} min={5} segments={[]} />)).toMatch(/Hidden to protect/);
  });
});

describe("DeltaBars (improvement)", () => {
  it("renders signed deltas and direction", () => {
    const out = html(<DeltaBars rows={[
      { key: "structure", label: "Structure", delta: 5.2, suppressed: false, n_students: 8, min_n: 5 },
      { key: "relevance", label: "Relevance", delta: -4.3, suppressed: false, n_students: 8, min_n: 5 },
    ]} />);
    expect(out).toContain("Structure");
    expect(out).toMatch(/\+5\.2/);
    expect(out).toMatch(/−4\.3/);
    expect(out).toContain("ii-deltafill-up");
    expect(out).toContain("ii-deltafill-down");
  });
  it("suppressed dimension (among reportable ones) shows a lock instead of a delta", () => {
    const out = html(<DeltaBars rows={[
      { key: "s", label: "Structure", delta: 4, suppressed: false, n_students: 8, min_n: 5 },
      { key: "x", label: "Evidence", delta: null, suppressed: true, n_students: 3, min_n: 5 },
    ]} />);
    expect(out).toMatch(/n&lt;5|n<5/);
    expect(out).toContain("Structure");
  });
});

describe("TrendLine", () => {
  it("draws an SVG path once there are >= 2 reportable months", () => {
    const out = html(<TrendLine target={70} points={[
      { month: "2026-06", mean: 55, suppressed: false },
      { month: "2026-07", mean: 58, suppressed: false },
      { month: "2026-08", mean: 62, suppressed: false },
    ]} />);
    expect(out).toContain("<svg");
    expect(out).toContain("ii-trend-line");
    expect(out).toContain("2026-06");
    expect(out).toContain("2026-08");
  });
  it("< 2 reportable months -> a plain note, no misleading chart", () => {
    const out = html(<TrendLine points={[{ month: "2026-08", mean: 60, suppressed: false }, { month: "2026-09", suppressed: true }]} />);
    expect(out).not.toContain("<svg");
    expect(out).toMatch(/Not enough reportable months/);
  });
});

describe("OpportunityList", () => {
  it("ranks opportunities with gap + %below + optional improvement chip", () => {
    const out = html(<OpportunityList target={70} items={[
      { kind: "competency", key: "evidence", label: "Evidence", cohort_mean: 40, gap_vs_target: 30, pct_below_target: 100, opportunity_score: 30, improvingLabel: "flat with practice", improvingTone: "neutral" },
      { kind: "question_category", key: "motivation_fit", label: "Motivation & fit questions", cohort_mean: 46, gap_vs_target: 24, pct_below_target: 100, opportunity_score: 24 },
    ]} />);
    expect(out).toContain("Evidence");
    expect(out).toContain("100% of students below interview-ready");
    expect(out).toContain("30-point gap");
    expect(out).toContain("flat with practice");
    expect(out).toContain("question type");
    expect(out).toContain("Motivation &amp; fit questions");
  });
  it("empty -> honest message, no ranking", () => {
    expect(html(<OpportunityList items={[]} />)).toMatch(/No development opportunities meet the reporting threshold/);
  });
});

describe("KeyStatRow / CalloutPair / SuppressedBlock", () => {
  it("KeyStatRow renders label/value/unit/sub", () => {
    const out = html(<KeyStatRow stats={[
      { label: "Interview-ready", value: "8%", sub: "mean 53", tone: "bad" },
      { label: "Cohorts", value: 2 },
    ]} />);
    expect(out).toContain("Interview-ready");
    expect(out).toContain("8%");
    expect(out).toContain("mean 53");
  });
  it("CalloutPair shows strongest + biggest gap", () => {
    const out = html(<CalloutPair
      strong={{ label: "Relevance", detail: "Cohort mean 65." }}
      weak={{ label: "Evidence", detail: "Cohort mean 40." }} />);
    expect(out).toContain("Strongest");
    expect(out).toContain("Biggest gap");
    expect(out).toContain("Relevance");
    expect(out).toContain("Evidence");
  });
  it("SuppressedBlock names the threshold", () => {
    expect(html(<SuppressedBlock n={3} min={5} />)).toMatch(/fewer than 5 with data/);
  });
});

describe("full app shell renders without throwing (loading state)", () => {
  it("renderToStaticMarkup(<InstitutionalApp/>) succeeds", async () => {
    const mod = await import("./InstitutionalApp.jsx");
    const out = renderToStaticMarkup(React.createElement(mod.default));
    expect(typeof out).toBe("string");
    expect(out).toContain("ii-root");
  });
});
