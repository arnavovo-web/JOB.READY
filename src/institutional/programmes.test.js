/* ================================================================== *
 * EKI² — programme-level intelligence (pure synthesis)
 * Every figure comes straight from a payload; no employment-outcome
 * language; suppressed programmes are never surfaced.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { reportableProgrammes, programmeIntelligence, topInstitutionalInsight } from "./programmes.js";

const PULSE = [
  { cohort_id: "a", name: "Finance", assessed: 14, suppressed: false, mean_readiness: 53,
    pct_ready: 21, pct_developing: 57, pct_needs: 22, weakest_competency: "evidence",
    weakest_competency_below_target_pct: 62, strongest_competency: "relevance", careers_engagement_pct: 21 },
  { cohort_id: "b", name: "Computer Science", assessed: 12, suppressed: false, mean_readiness: 68,
    pct_ready: 63, pct_developing: 27, pct_needs: 10, weakest_competency: "evidence",
    weakest_competency_below_target_pct: 40, strongest_competency: "structure", careers_engagement_pct: 12 },
  { cohort_id: "c", name: "Tiny cohort", assessed: 3, suppressed: true },
];
const ENV = {
  pulse: PULSE,
  summary: { stuck: 4, no_contact: 7 },
  movement: { developing_to_ready: 9, needs_support_to_developing: 5 },
  followUpCount: 6,
};

describe("reportableProgrammes", () => {
  it("drops suppressed programmes and sorts worst readiness first", () => {
    const r = reportableProgrammes(PULSE);
    expect(r.map((p) => p.name)).toEqual(["Finance", "Computer Science"]);
    expect(r.some((p) => p.suppressed)).toBe(false);
  });
});

describe("programmeIntelligence", () => {
  const items = programmeIntelligence(ENV);
  it("leads with the most concentrated programme development gap", () => {
    const opp = items.find((x) => x.kind === "programme_opportunity");
    expect(opp.headline).toMatch(/Finance: 62% of students are below target for Evidence/);
  });
  it("flags a competency that is weakest across multiple programmes", () => {
    const trend = items.find((x) => x.kind === "competency_trend");
    expect(trend.headline).toMatch(/Evidence is the most common development area across 2 programmes/);
  });
  it("flags an engagement gap: strong readiness, low engagement", () => {
    const gap = items.find((x) => x.kind === "engagement_gap");
    expect(gap.headline).toMatch(/Computer Science has strong interview readiness but low careers engagement \(12%\)/);
  });
  it("surfaces intervention opportunity, follow-up pressure and positive movement", () => {
    expect(items.find((x) => x.kind === "intervention_opportunity").headline).toMatch(/4 students are practising repeatedly without meaningful improvement/);
    expect(items.find((x) => x.kind === "follow_up_pressure").headline).toMatch(/6 student follow-ups are currently due/);
    expect(items.find((x) => x.kind === "positive_movement").headline).toMatch(/9 students moved into Interview-ready/);
  });
  it("never uses employment-outcome language", () => {
    const all = items.map((x) => `${x.headline} ${x.detail}`).join(" ");
    expect(all).not.toMatch(/employment|graduate outcome|job prospects|hireable|will get a job/i);
  });
  it("empty env -> empty list", () => {
    expect(programmeIntelligence({ pulse: [], summary: {}, movement: {}, followUpCount: 0 })).toEqual([]);
  });
});

describe("topInstitutionalInsight", () => {
  it("returns the highest-priority item (programme opportunity first)", () => {
    expect(topInstitutionalInsight(ENV).kind).toBe("programme_opportunity");
  });
  it("null when nothing to say", () => {
    expect(topInstitutionalInsight({ pulse: [], summary: {}, movement: {}, followUpCount: 0 })).toBe(null);
  });
});
