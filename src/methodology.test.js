import { describe, it, expect } from "vitest";
import {
  CATEGORIES,
  ACTIVE_CATEGORIES,
  ANCHOR_SOURCES,
  BATCH_ANCHOR_SOURCES,
  STAGE_METHODOLOGY,
  mapLegacyCategory,
  normalizeAnchorSource,
  computeMethodologyDistribution,
} from "./methodology.js";

const STAGES = Object.keys(STAGE_METHODOLOGY);

function sum(distribution, keys = ACTIVE_CATEGORIES) {
  return keys.reduce((s, c) => s + distribution[c], 0);
}

describe("canonical taxonomy", () => {
  it("has exactly the six approved categories in order", () => {
    expect(CATEGORIES).toEqual([
      "motivation_fit",
      "behavioural_competency",
      "situational_judgement",
      "technical_functional",
      "commercial_awareness",
      "case_problem_solving",
    ]);
  });

  it("excludes case_problem_solving from ACTIVE_CATEGORIES", () => {
    expect(ACTIVE_CATEGORIES).not.toContain("case_problem_solving");
    expect(ACTIVE_CATEGORIES.length).toBe(5);
  });
});

describe("mapLegacyCategory", () => {
  it("maps every documented legacy category to its canonical target", () => {
    expect(mapLegacyCategory("motivation_fit")).toBe("motivation_fit");
    expect(mapLegacyCategory("cv_behavioural")).toBe("behavioural_competency");
    expect(mapLegacyCategory("role_specific")).toBe("technical_functional");
    expect(mapLegacyCategory("technical")).toBe("technical_functional");
    expect(mapLegacyCategory("commercial_awareness")).toBe("commercial_awareness");
  });

  it("passes already-canonical categories through unchanged, including the reserved one", () => {
    for (const c of CATEGORIES) expect(mapLegacyCategory(c)).toBe(c);
  });

  it("falls back to behavioural_competency for unrecognized/missing input", () => {
    expect(mapLegacyCategory("something_unrecognized")).toBe("behavioural_competency");
    expect(mapLegacyCategory(undefined)).toBe("behavioural_competency");
    expect(mapLegacyCategory(null)).toBe("behavioural_competency");
  });

  it("never collapses situational_judgement into another category (no legacy source maps to it)", () => {
    const legacyInputs = ["motivation_fit", "cv_behavioural", "role_specific", "technical", "commercial_awareness", "garbage"];
    for (const input of legacyInputs) expect(mapLegacyCategory(input)).not.toBe("situational_judgement");
  });
});

describe("anchor sources", () => {
  it("are bare strings, not nested objects", () => {
    for (const a of ANCHOR_SOURCES) expect(typeof a).toBe("string");
  });

  it("excludes previous_answer from the batch-time set", () => {
    expect(BATCH_ANCHOR_SOURCES).not.toContain("previous_answer");
    expect(ANCHOR_SOURCES).toContain("previous_answer");
  });

  it("normalizeAnchorSource falls back to generic for unrecognized input", () => {
    expect(normalizeAnchorSource("cv")).toBe("cv");
    expect(normalizeAnchorSource("nonsense")).toBe("generic");
    expect(normalizeAnchorSource(undefined)).toBe("generic");
  });
});

describe("STAGE_METHODOLOGY baselines (approved final numbers)", () => {
  it("every stage baseline sums to exactly 100 across active categories", () => {
    for (const stage of STAGES) {
      expect(sum(STAGE_METHODOLOGY[stage].baseline)).toBe(100);
    }
  });

  it("case_problem_solving baseline is always 0 with a zero envelope", () => {
    for (const stage of STAGES) {
      const m = STAGE_METHODOLOGY[stage];
      expect(m.baseline.case_problem_solving).toBe(0);
      expect(m.envelope.case_problem_solving.plus).toBe(0);
      expect(m.envelope.case_problem_solving.minus).toBe(0);
    }
  });

  it("matches the exact approved baseline numbers", () => {
    expect(STAGE_METHODOLOGY.recruiter_screen.baseline).toMatchObject({
      motivation_fit: 38, behavioural_competency: 20, situational_judgement: 12,
      technical_functional: 8, commercial_awareness: 22,
    });
    expect(STAGE_METHODOLOGY.first_round.baseline).toMatchObject({
      motivation_fit: 19, behavioural_competency: 28, situational_judgement: 15,
      technical_functional: 22, commercial_awareness: 16,
    });
    expect(STAGE_METHODOLOGY.technical.baseline).toMatchObject({
      motivation_fit: 8, behavioural_competency: 12, situational_judgement: 15,
      technical_functional: 55, commercial_awareness: 10,
    });
    expect(STAGE_METHODOLOGY.final_round.baseline).toMatchObject({
      motivation_fit: 12, behavioural_competency: 20, situational_judgement: 18,
      technical_functional: 35, commercial_awareness: 15,
    });
  });

  it("matches the exact approved envelope numbers, including asymmetric bounds", () => {
    expect(STAGE_METHODOLOGY.recruiter_screen.envelope.technical_functional).toEqual({ plus: 5, minus: 8 });
    expect(STAGE_METHODOLOGY.first_round.envelope.technical_functional).toEqual({ plus: 10, minus: 10 });
    expect(STAGE_METHODOLOGY.technical.envelope.technical_functional).toEqual({ plus: 10, minus: 15 });
    expect(STAGE_METHODOLOGY.final_round.envelope.technical_functional).toEqual({ plus: 10, minus: 10 });
    // first_round explicitly NOT widened past +/-10, final_round explicitly NOT widened to +/-12/13.
    for (const c of ACTIVE_CATEGORIES) {
      expect(STAGE_METHODOLOGY.first_round.envelope[c].plus).toBeLessThanOrEqual(10);
      expect(STAGE_METHODOLOGY.final_round.envelope[c].plus).toBeLessThanOrEqual(10);
    }
  });
});

describe("computeMethodologyDistribution — no-JD / weak-JD fallback", () => {
  it("returns the stage baseline unmodified when jdProfile is null", () => {
    for (const stage of STAGES) {
      expect(computeMethodologyDistribution(stage, null)).toEqual(STAGE_METHODOLOGY[stage].baseline);
    }
  });

  it("returns the stage baseline unmodified when jdProfile has zero signals", () => {
    expect(computeMethodologyDistribution("first_round", { signals: [] })).toEqual(
      STAGE_METHODOLOGY.first_round.baseline
    );
  });

  it("falls back to first_round for an unrecognized stage key (legacy interview safety net)", () => {
    expect(computeMethodologyDistribution("nonexistent_stage", null)).toEqual(STAGE_METHODOLOGY.first_round.baseline);
  });

  it("drops a signal with no evidence quote entirely — result equals baseline", () => {
    const result = computeMethodologyDistribution("first_round", {
      signals: [{ requirement: "x", evidence_quote: "", confidence: "explicit", category: "technical_functional", occurrences: 1, direction: 1 }],
    });
    expect(result).toEqual(STAGE_METHODOLOGY.first_round.baseline);
  });

  it("a general-confidence-only signal set contributes zero magnitude — result equals baseline", () => {
    const result = computeMethodologyDistribution("first_round", {
      signals: [{ requirement: "x", evidence_quote: "some quote", confidence: "general", category: "technical_functional", occurrences: 1, direction: 1 }],
    });
    expect(result).toEqual(STAGE_METHODOLOGY.first_round.baseline);
  });
});

describe("computeMethodologyDistribution — core invariants", () => {
  const CONFIDENCES = ["explicit", "inferred", "general"];
  function randomSignal(rng) {
    return {
      requirement: "req",
      evidence_quote: "an actual evidenced quote from the JD text",
      confidence: CONFIDENCES[Math.floor(rng() * CONFIDENCES.length)],
      category: ACTIVE_CATEGORIES[Math.floor(rng() * ACTIVE_CATEGORIES.length)],
      occurrences: 1 + Math.floor(rng() * 20), // deliberately exceeds the saturation cap sometimes
      direction: rng() < 0.5 ? -1 : 1,
    };
  }
  // Small deterministic PRNG so failures are reproducible without a fixed seed dependency.
  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("every category stays within baseline +/- envelope across 500 randomized fixtures per stage", () => {
    const rng = mulberry32(42);
    for (const stage of STAGES) {
      const { baseline, envelope: bounds } = STAGE_METHODOLOGY[stage];
      for (let i = 0; i < 500; i++) {
        const signalCount = 1 + Math.floor(rng() * 6);
        const signals = Array.from({ length: signalCount }, () => randomSignal(rng));
        const result = computeMethodologyDistribution(stage, { signals });
        for (const c of ACTIVE_CATEGORIES) {
          expect(result[c]).toBeGreaterThanOrEqual(baseline[c] - bounds[c].minus);
          expect(result[c]).toBeLessThanOrEqual(baseline[c] + bounds[c].plus);
        }
      }
    }
  });

  it("always sums to exactly 100 (all 6 categories) across the same randomized fixtures", () => {
    const rng = mulberry32(7);
    for (const stage of STAGES) {
      for (let i = 0; i < 500; i++) {
        const signalCount = 1 + Math.floor(rng() * 6);
        const signals = Array.from({ length: signalCount }, () => randomSignal(rng));
        const result = computeMethodologyDistribution(stage, { signals });
        expect(sum(result, CATEGORIES)).toBe(100);
        expect(result.case_problem_solving).toBe(0);
      }
    }
  });

  it("case_problem_solving is never nonzero regardless of what a (malformed) signal claims", () => {
    const result = computeMethodologyDistribution("first_round", {
      signals: [{ requirement: "x", evidence_quote: "quote", confidence: "explicit", category: "case_problem_solving", occurrences: 5, direction: 1 }],
    });
    // The signal targets a category outside ACTIVE_CATEGORIES and must be ignored entirely.
    expect(result).toEqual(STAGE_METHODOLOGY.first_round.baseline);
  });

  it("saturation: 20 occurrences of the same explicit signal is capped, not linear", () => {
    const lightlyRepeated = computeMethodologyDistribution("first_round", {
      signals: [{ requirement: "x", evidence_quote: "quote", confidence: "explicit", category: "technical_functional", occurrences: 3, direction: 1 }],
    });
    const heavilyRepeated = computeMethodologyDistribution("first_round", {
      signals: [{ requirement: "x", evidence_quote: "quote", confidence: "explicit", category: "technical_functional", occurrences: 60, direction: 1 }],
    });
    // Both clamp to the same effective magnitude (occurrences capped at 3) — identical output.
    expect(heavilyRepeated).toEqual(lightlyRepeated);
    // And that output must still respect the envelope even though the raw magnitude
    // (8 * 1.3 = 10.4) exceeds first_round's +/-10 bound before clamping.
    expect(heavilyRepeated.technical_functional).toBeLessThanOrEqual(
      STAGE_METHODOLOGY.first_round.baseline.technical_functional + STAGE_METHODOLOGY.first_round.envelope.technical_functional.plus
    );
  });

  it("top-3 cap: a 4th, weaker signal never moves the distribution beyond what the top 3 alone would", () => {
    const top3 = [
      { requirement: "a", evidence_quote: "q1", confidence: "explicit", category: "technical_functional", occurrences: 1, direction: 1 },
      { requirement: "b", evidence_quote: "q2", confidence: "explicit", category: "motivation_fit", occurrences: 1, direction: -1 },
      { requirement: "c", evidence_quote: "q3", confidence: "inferred", category: "commercial_awareness", occurrences: 1, direction: 1 },
    ];
    const withFourth = [...top3, { requirement: "d", evidence_quote: "q4", confidence: "inferred", category: "situational_judgement", occurrences: 1, direction: 1 }];
    const resultTop3 = computeMethodologyDistribution("first_round", { signals: top3 });
    const resultFour = computeMethodologyDistribution("first_round", { signals: withFourth });
    expect(resultFour).toEqual(resultTop3);
  });

  it("a stronger 4th signal displaces a weaker one out of the top 3", () => {
    const threeWeak = [
      { requirement: "a", evidence_quote: "q1", confidence: "inferred", category: "technical_functional", occurrences: 1, direction: 1 },
      { requirement: "b", evidence_quote: "q2", confidence: "inferred", category: "motivation_fit", occurrences: 1, direction: -1 },
      { requirement: "c", evidence_quote: "q3", confidence: "inferred", category: "commercial_awareness", occurrences: 1, direction: 1 },
    ];
    const strongFourth = { requirement: "d", evidence_quote: "q4", confidence: "explicit", category: "situational_judgement", occurrences: 3, direction: 1 };
    const resultWeakOnly = computeMethodologyDistribution("first_round", { signals: threeWeak });
    const resultWithStrong = computeMethodologyDistribution("first_round", { signals: [...threeWeak, strongFourth] });
    expect(resultWithStrong.situational_judgement).toBeGreaterThan(resultWeakOnly.situational_judgement);
  });
});

describe("computeMethodologyDistribution — worked examples stay in the first_round envelope", () => {
  // These fixtures approximate the four worked-example JDs from the product spec. Real
  // extraction is nondeterministic (an AI call), so this asserts the *mechanism* keeps any
  // plausible signal set for these roles within first_round's envelope — not that it
  // reproduces the exact historical numbers byte-for-byte.
  const baseline = STAGE_METHODOLOGY.first_round.baseline;
  const bounds = STAGE_METHODOLOGY.first_round.envelope;

  const fixtures = {
    goldmanIB: [
      { requirement: "financial modelling", evidence_quote: "build complex financial models", confidence: "explicit", category: "technical_functional", occurrences: 3, direction: 1 },
      { requirement: "long hours / resilience", evidence_quote: "demanding, fast-paced environment", confidence: "explicit", category: "behavioural_competency", occurrences: 1, direction: -1 },
      { requirement: "client-facing polish", evidence_quote: "represent the firm with clients", confidence: "inferred", category: "commercial_awareness", occurrences: 1, direction: 1 },
    ],
    googleSwe: [
      { requirement: "algorithms / data structures", evidence_quote: "strong CS fundamentals and coding ability", confidence: "explicit", category: "technical_functional", occurrences: 3, direction: 1 },
      { requirement: "collaboration", evidence_quote: "work cross-functionally with product and design", confidence: "inferred", category: "behavioural_competency", occurrences: 1, direction: -1 },
    ],
  };

  for (const [name, signals] of Object.entries(fixtures)) {
    it(`${name}: stays within the first_round envelope`, () => {
      const result = computeMethodologyDistribution("first_round", { signals });
      for (const c of ACTIVE_CATEGORIES) {
        expect(result[c]).toBeGreaterThanOrEqual(baseline[c] - bounds[c].minus);
        expect(result[c]).toBeLessThanOrEqual(baseline[c] + bounds[c].plus);
      }
      expect(sum(result, CATEGORIES)).toBe(100);
    });
  }
});
