/* ================================================================== *
 * EKI² — readiness distribution model + recommendation
 * ------------------------------------------------------------------
 * A cohort is not one verdict. readinessGroup() places each student in
 * ready / developing / needs_support against the SAME thresholds used
 * end-to-end (70 interview-ready; 55 = 70 − 15, the eki_student_briefing
 * per-dimension "priority" cutoff). readinessRecommendation() turns the
 * aggregate distribution into a supportive "where to focus" insight —
 * deterministic, never judgemental, null when the data is suppressed.
 * Pure — no DB, no React.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import {
  READINESS_GROUPS, READINESS_TARGET, READINESS_SUPPORT_FLOOR,
  readinessGroup, readinessGroupMeta,
} from "./taxonomy.js";
import { readinessRecommendation } from "./present.js";

describe("readiness thresholds", () => {
  it("uses the established constants (70 interview-ready, 55 support floor)", () => {
    expect(READINESS_TARGET).toBe(70);
    expect(READINESS_SUPPORT_FLOOR).toBe(55);
  });
  it("classifies a mean practice score into one of three groups", () => {
    expect(readinessGroup(82)).toBe("ready");
    expect(readinessGroup(70)).toBe("ready");        // at the threshold is ready
    expect(readinessGroup(69)).toBe("developing");
    expect(readinessGroup(55)).toBe("developing");   // at the floor is still developing
    expect(readinessGroup(54)).toBe("needs_support");
    expect(readinessGroup(20)).toBe("needs_support");
  });
  it("returns null when there is no score (never a fabricated group)", () => {
    expect(readinessGroup(null)).toBe(null);
    expect(readinessGroup(undefined)).toBe(null);
    expect(readinessGroup(NaN)).toBe(null);
  });
  it("every group has supportive, non-judgemental language", () => {
    expect(READINESS_GROUPS.map((g) => g.key)).toEqual(["ready", "developing", "needs_support"]);
    for (const g of READINESS_GROUPS) {
      expect(g.label).toBeTruthy();
      expect(g.blurb.length).toBeGreaterThan(10);
      expect(g.blurb).not.toMatch(/\b(bad|weak student|unemployable|failing|poor)\b/i);
    }
    expect(readinessGroupMeta("needs_support").label).toBe("Needs support");
    expect(readinessGroupMeta("nonsense").tone).toBe("neutral");
  });
});

describe("readinessRecommendation(distribution)", () => {
  const dist = (assessed, ready, developing, need, suppressed = false) => ({
    assessed, suppressed,
    groups: [
      { key: "ready", count: ready, pct: Math.round((100 * ready) / assessed) },
      { key: "developing", count: developing, pct: Math.round((100 * developing) / assessed) },
      { key: "needs_support", count: need, pct: Math.round((100 * need) / assessed) },
    ],
  });

  it("returns null when the distribution is suppressed or empty", () => {
    expect(readinessRecommendation({ assessed: 3, suppressed: true, groups: [] })).toBe(null);
    expect(readinessRecommendation({ assessed: 0, suppressed: false, groups: [] })).toBe(null);
    expect(readinessRecommendation(null)).toBe(null);
  });

  it("leads on the needs-support group when it is a meaningful share, with a Review students CTA", () => {
    const rec = readinessRecommendation(dist(20, 6, 9, 5)); // 25% needs support
    expect(rec.headline).toMatch(/25% of students are currently in the .Needs support/);
    expect(rec.body).toMatch(/targeted careers support/i);
    expect(rec.cta).toEqual({ label: "Review students", group: "needs_support" });
    expect(`${rec.headline} ${rec.body}`).not.toMatch(/\b(bad|unemployable|failing)\b/i);
  });

  it("when few need support but many are developing, points at the developing group", () => {
    const rec = readinessRecommendation(dist(20, 4, 15, 1)); // 5% need, 75% developing
    expect(rec.headline).toMatch(/still developing/i);
    expect(rec.cta.label).toBe("Review students");
  });

  it("when most are interview-ready, stays positive and still offers a check-in", () => {
    const rec = readinessRecommendation(dist(20, 16, 3, 1));
    expect(rec.headline).toMatch(/interview-ready practice performance/i);
    expect(rec.cta).toEqual({ label: "Review students", group: "needs_support" });
  });
});
