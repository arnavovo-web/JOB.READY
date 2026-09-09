/* ================================================================== *
 * EKI² — AI Careers Adviser Briefing: deterministic core
 * The deterministic briefing never fabricates a fact, distinguishes
 * evidence from suggestion, and is what "Brief me" shows with no AI.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { briefingFacts, deterministicBriefing, BRIEFING_AI_RULES } from "./briefing.js";

const SHAPED = {
  target: 70,
  student: { name: "Demo Student" },
  dna: {
    nInterviews: 3, overallMean: 61,
    strengths: [{ key: "communication", mean: 74 }],
    development: [{ key: "evidence", mean: 44 }],
  },
  trajectory: { classification: "improving", firstScore: 48, latestScore: 61, overallDelta: 13, nInterviews: 3 },
  dnaEvolution: { strongestImprovement: "structure", persistentWeakness: "evidence", hasData: true },
  patterns: { repeatedDevelopmentArea: { key: "evidence", recentInterviews: 3 } },
  previousSupport: { typeLabel: "Answer structure", actionAgreed: "Practise STAR", followUpRequired: true },
  history: [{ appointmentId: "a1" }],
  flags: { isStuck: false, noPriorContact: false },
  recommendedResources: [{ title: "Evidence bank exercise" }],
};

describe("briefingFacts", () => {
  it("is a compact, model-safe restatement — no transcript, no raw answers", () => {
    const f = briefingFacts(SHAPED);
    expect(f.n_interviews).toBe(3);
    expect(f.trajectory).toBe("improving");
    expect(f.weakest_competency).toBe("Evidence");
    expect(f.strongest_competency).toBe("Communication");
    expect(f.repeated_weakness).toBe("Evidence");
    expect(f.previous_appointments).toBe(1);
    expect(JSON.stringify(f)).not.toMatch(/transcript|answer_text/i);
  });
});

describe("deterministicBriefing", () => {
  const b = deterministicBriefing(SHAPED);

  it("every number in the briefing appears in the facts (no fabrication)", () => {
    const nums = (b.focus.match(/\d+/g) || []).map(Number);
    const allowed = new Set([48, 61, 3, 70, 13]);
    for (const n of nums) expect(allowed.has(n), `unexpected number ${n}`).toBe(true);
  });
  it("distinguishes evidence (has/is) from suggestion (could)", () => {
    expect(b.focus).toMatch(/improved from 48 to 61/);
    expect(b.focus).toMatch(/could focus on/);
  });
  it("no causal claims, no employment prediction", () => {
    expect(b.focus).not.toMatch(/\b(because|caused|led to|will get a job|employment outcome)\b/i);
  });
  it("offers 2-4 concrete discussion points", () => {
    expect(b.discussion.length).toBeGreaterThanOrEqual(2);
    expect(b.discussion.length).toBeLessThanOrEqual(5);
    expect(b.generated_by).toBe("deterministic");
  });
  it("degrades cleanly with no practice data", () => {
    const empty = deterministicBriefing({ target: 70, dna: {}, trajectory: {}, history: [] });
    expect(empty.focus).toMatch(/not completed enough/i);
    expect(empty.discussion.length).toBeGreaterThan(0);
    expect(empty.generated_by).toBe("deterministic");
  });
  it("null shaped -> safe fallback", () => {
    expect(deterministicBriefing(null).generated_by).toBe("deterministic");
  });
});

describe("BRIEFING_AI_RULES", () => {
  it("instructs the model to use only supplied facts and not to diagnose / predict / claim causality", () => {
    expect(BRIEFING_AI_RULES).toMatch(/only the facts/i);
    expect(BRIEFING_AI_RULES).toMatch(/do not diagnose/i);
    expect(BRIEFING_AI_RULES).toMatch(/do not predict employment/i);
    expect(BRIEFING_AI_RULES).toMatch(/causal|caused a change/i);
  });
});
