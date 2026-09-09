/* ================================================================== *
 * EKI² — trajectory engine (the ONE classifier, mirrors SQL)
 * ================================================================== */
import { describe, it, expect } from "vitest";
import {
  classifyTrajectory, trajectoryMeta, shapeTrajectory, trajectoryLine,
  shapeDnaEvolution, dnaEvolutionLine,
  TRAJ_MIN_POINTS, TRAJ_IMPROVE_DELTA,
} from "./trajectory.js";

describe("classifyTrajectory", () => {
  it("insufficient_data below the minimum number of points", () => {
    expect(classifyTrajectory([])).toBe("insufficient_data");
    expect(classifyTrajectory([50, 60])).toBe("insufficient_data");
    expect(TRAJ_MIN_POINTS).toBe(3);
  });
  it("improving: gained >= 6 overall AND still rising recently", () => {
    expect(classifyTrajectory([48, 53, 57, 61, 64])).toBe("improving");
    expect(classifyTrajectory([50, 60, 70])).toBe("improving");
    expect(TRAJ_IMPROVE_DELTA).toBe(6);
  });
  it("declining: lost >= 6 overall OR a sharp recent drop", () => {
    expect(classifyTrajectory([70, 66, 60, 58])).toBe("declining");
    expect(classifyTrajectory([60, 62, 64, 58])).toBe("declining"); // recent drop -6
  });
  it("plateauing: the 42 -> 51 -> 58 -> 58 -> 59 shape (flat recently, tight last 3)", () => {
    expect(classifyTrajectory([42, 51, 58, 58, 59])).toBe("plateauing");
    expect(classifyTrajectory([60, 61, 62, 62, 63])).toBe("plateauing");
  });
  it("stable: some movement, not decisively anything else", () => {
    expect(classifyTrajectory([60, 58, 62, 61])).toBe("stable");
    expect(classifyTrajectory([55, 60, 58])).toBe("stable");
  });
  it("ignores null / NaN entries", () => {
    expect(classifyTrajectory([48, null, 53, undefined, 61, NaN, 64])).toBe("improving");
  });
});

describe("shapeTrajectory / trajectoryLine", () => {
  it("derives the classification from the series when the payload omits it", () => {
    const t = shapeTrajectory({ series: [48, 53, 57, 61, 64] });
    expect(t.classification).toBe("improving");
    expect(t.firstScore).toBe(48);
    expect(t.latestScore).toBe(64);
    expect(t.overallDelta).toBe(16);
  });
  it("trajectoryLine is factual and never causal", () => {
    const line = trajectoryLine(shapeTrajectory({ classification: "improving", series: [48, 64], first_score: 48, latest_score: 64, n_interviews: 5 }));
    expect(line).toMatch(/48 to 64/);
    expect(line).not.toMatch(/\b(because|caused|led to|thanks to)\b/i);
  });
  it("trajectoryMeta covers every class with a tone", () => {
    for (const k of ["improving", "stable", "plateauing", "declining", "insufficient_data"]) {
      expect(trajectoryMeta(k).label).toBeTruthy();
      expect(["good", "warn", "bad", "neutral"]).toContain(trajectoryMeta(k).tone);
    }
  });
});

describe("shapeDnaEvolution", () => {
  it("maps dimensions with labels + deltas and surfaces strongest/persistent", () => {
    const ev = shapeDnaEvolution({
      has_data: true,
      dimensions: [
        { key: "evidence", earliest: 43, latest: 61, delta: 18 },
        { key: "structure", earliest: 49, latest: 65, delta: 16 },
        { key: "communication", earliest: 71, latest: 75, delta: 4 },
      ],
      strongest_improvement: "evidence",
      persistent_weakness: "evidence",
    });
    expect(ev.hasData).toBe(true);
    expect(ev.dimensions[0].label).toBe("Evidence");
    expect(ev.dimensions[0].delta).toBe(18);
    const line = dnaEvolutionLine(ev);
    expect(line).toMatch(/Evidence rose 18 points/);
    expect(line).toMatch(/persistent gap/);
  });
  it("no data -> hasData false, no line", () => {
    expect(shapeDnaEvolution({ has_data: false }).hasData).toBe(false);
    expect(dnaEvolutionLine({ hasData: false })).toBe(null);
  });
});
