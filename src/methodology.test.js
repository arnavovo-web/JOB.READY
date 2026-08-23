import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CATEGORIES,
  ACTIVE_CATEGORIES,
  ANCHOR_SOURCES,
  BATCH_ANCHOR_SOURCES,
  STAGE_METHODOLOGY,
  mapLegacyCategory,
  mapCategoryWithLegacyFallback,
  normalizeAnchorSource,
  computeMethodologyDistribution,
  TURN_TYPES,
  MAX_PROBE_DEPTH,
  ADAPTIVE_SIGNALS,
  scheduleNextCategory,
  countTrailingProbeDepth,
  resolveTurnDirective,
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

describe("mapCategoryWithLegacyFallback", () => {
  it("routes an unrecognized category through the given legacy alias (role_specific -> technical_functional)", () => {
    expect(mapCategoryWithLegacyFallback("not_a_real_category", "role_specific")).toBe("technical_functional");
    expect(mapCategoryWithLegacyFallback(undefined, "role_specific")).toBe("technical_functional");
    expect(mapCategoryWithLegacyFallback("", "role_specific")).toBe("technical_functional");
  });

  it("leaves a recognized legacy or canonical category untouched by the fallback alias", () => {
    expect(mapCategoryWithLegacyFallback("cv_behavioural", "role_specific")).toBe("behavioural_competency");
    expect(mapCategoryWithLegacyFallback("motivation_fit", "role_specific")).toBe("motivation_fit");
  });

  it("differs from mapLegacyCategory's own generic default for unrecognized input", () => {
    expect(mapLegacyCategory("not_a_real_category")).toBe("behavioural_competency");
    expect(mapCategoryWithLegacyFallback("not_a_real_category", "role_specific")).toBe("technical_functional");
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

/* ================================================================== *
 * PHASE 2C.1 — DETERMINISTIC ADAPTIVE INTERVIEW SCHEDULER
 * ================================================================== */

describe("2C.1 constants", () => {
  it("TURN_TYPES has the four approved turn types, normal first", () => {
    expect(TURN_TYPES).toEqual(["normal", "follow_up", "challenge_claim", "clarify"]);
  });

  it("MAX_PROBE_DEPTH is the approved value", () => {
    expect(MAX_PROBE_DEPTH).toBe(2);
  });

  it("ADAPTIVE_SIGNALS is a non-empty list of distinct strings", () => {
    expect(Array.isArray(ADAPTIVE_SIGNALS)).toBe(true);
    expect(ADAPTIVE_SIGNALS.length).toBeGreaterThan(0);
    expect(new Set(ADAPTIVE_SIGNALS).size).toBe(ADAPTIVE_SIGNALS.length);
  });
});

describe("scheduleNextCategory — deficit selection", () => {
  it("every active category can be the scheduler's choice", () => {
    for (const target of ACTIVE_CATEGORIES) {
      const distribution = Object.fromEntries(ACTIVE_CATEGORIES.map((c) => [c, c === target ? 100 : 0]));
      const result = scheduleNextCategory({ distribution, transcript: [], questionCount: 5 });
      expect(result).toBe(target);
    }
  });

  it("selects the category with the strictly largest deficit", () => {
    const distribution = {
      motivation_fit: 10, behavioural_competency: 50, situational_judgement: 15,
      technical_functional: 15, commercial_awareness: 10,
    };
    // questionCount 10 -> targets 1 / 5 / 1.5 / 1.5 / 1, all askedCount 0.
    const result = scheduleNextCategory({ distribution, transcript: [], questionCount: 10 });
    expect(result).toBe("behavioural_competency");
  });

  it("breaks an equal-deficit tie by larger methodology weight, even against canonical order", () => {
    const distribution = {
      motivation_fit: 10, behavioural_competency: 20, situational_judgement: 20,
      technical_functional: 20, commercial_awareness: 30,
    };
    // questionCount 10 -> targets: motivation 1, behavioural/situational/technical 2, commercial 3.
    const transcript = [
      ...Array(2).fill({ category: "behavioural_competency" }),
      ...Array(2).fill({ category: "situational_judgement" }),
      ...Array(2).fill({ category: "technical_functional" }),
      ...Array(2).fill({ category: "commercial_awareness" }),
    ];
    // Deficits: motivation 1, behavioural/situational/technical 0, commercial 1 -> tie between
    // motivation_fit (weight 10) and commercial_awareness (weight 30, and LATER in canonical
    // order) — weight must win over both order and "earlier in the list".
    const result = scheduleNextCategory({ distribution, transcript, questionCount: 10 });
    expect(result).toBe("commercial_awareness");
  });

  it("breaks a fully-equal tie (deficit and weight) by canonical category order", () => {
    const distribution = Object.fromEntries(ACTIVE_CATEGORIES.map((c) => [c, 20]));
    const result = scheduleNextCategory({ distribution, transcript: [], questionCount: 10 });
    expect(result).toBe(ACTIVE_CATEGORIES[0]);
  });

  it("falls back to the heaviest-weighted category once every deficit is exhausted", () => {
    const distribution = {
      motivation_fit: 40, behavioural_competency: 25, situational_judgement: 15,
      technical_functional: 10, commercial_awareness: 10,
    };
    const transcript = ACTIVE_CATEGORIES.flatMap((c) => Array(20).fill({ category: c }));
    const result = scheduleNextCategory({ distribution, transcript, questionCount: 8 });
    expect(result).toBe("motivation_fit");
  });

  it("fallback tie (exhausted deficits, equal top weight) breaks by canonical order", () => {
    const distribution = {
      motivation_fit: 30, behavioural_competency: 30, situational_judgement: 15,
      technical_functional: 15, commercial_awareness: 10,
    };
    const transcript = ACTIVE_CATEGORIES.flatMap((c) => Array(10).fill({ category: c }));
    const result = scheduleNextCategory({ distribution, transcript, questionCount: 6 });
    expect(result).toBe("motivation_fit");
  });

  it("never selects a zero-weight category while another category still has weight", () => {
    const distribution = {
      motivation_fit: 25, behavioural_competency: 25, situational_judgement: 25,
      technical_functional: 0, commercial_awareness: 25,
    };
    const result = scheduleNextCategory({ distribution, transcript: [], questionCount: 8 });
    expect(result).not.toBe("technical_functional");
    expect(result).toBe("motivation_fit");
  });

  it("still applies plain deficit scheduling on the final question of the interview (no special-casing)", () => {
    const distribution = Object.fromEntries(ACTIVE_CATEGORIES.map((c) => [c, 20]));
    const questionCount = 5;
    // 4 questions already asked, one per category except commercial_awareness.
    const transcript = [
      { category: "motivation_fit" }, { category: "behavioural_competency" },
      { category: "situational_judgement" }, { category: "technical_functional" },
    ];
    const result = scheduleNextCategory({ distribution, transcript, questionCount });
    expect(result).toBe("commercial_awareness");
  });
});

describe("scheduleNextCategory — self-compensation", () => {
  it("asking a category repeatedly lowers its own future deficit without a separate counter", () => {
    const distribution = Object.fromEntries(ACTIVE_CATEGORIES.map((c) => [c, 20]));
    const first = scheduleNextCategory({ distribution, transcript: [], questionCount: 10 });
    expect(first).toBe("motivation_fit");

    const transcript = [
      { category: "motivation_fit", turn_type: "normal" },
      { category: "motivation_fit", turn_type: "follow_up" },
      { category: "motivation_fit", turn_type: "clarify" },
    ];
    const second = scheduleNextCategory({ distribution, transcript, questionCount: 10 });
    expect(second).not.toBe("motivation_fit");
    expect(second).toBe("behavioural_competency");
  });

  it("counts repeated probing turns — with no normal turns at all — toward coverage exactly like normal turns", () => {
    const distribution = { motivation_fit: 50, behavioural_competency: 50 };
    const transcript = [
      { category: "motivation_fit", turn_type: "follow_up" },
      { category: "motivation_fit", turn_type: "challenge_claim" },
      { category: "motivation_fit", turn_type: "clarify" },
      { category: "motivation_fit", turn_type: "follow_up" },
    ];
    // questionCount 8 -> motivation target 4, asked 4 (all probing) -> deficit 0.
    // behavioural target 4, asked 0 -> deficit 4 -> wins.
    const result = scheduleNextCategory({ distribution, transcript, questionCount: 8 });
    expect(result).toBe("behavioural_competency");
  });
});

describe("PHASE 2E — scheduleNextCategory's optional categoryPreference nudge", () => {
  it("omitted categoryPreference reproduces the exact pre-2E decision — full backward compatibility", () => {
    const distribution = Object.fromEntries(ACTIVE_CATEGORIES.map((c) => [c, 20]));
    const withoutPref = scheduleNextCategory({ distribution, transcript: [], questionCount: 10 });
    const withEmptyPref = scheduleNextCategory({ distribution, transcript: [], questionCount: 10, categoryPreference: {} });
    expect(withEmptyPref).toBe(withoutPref);
  });

  it("candidate strategy CAN tip a genuinely close call between two near-tied categories", () => {
    // motivation_fit and behavioural_competency have the SAME weight, therefore the same
    // deficit at 0 asked — a real tie. A strong candidate-strategy preference for
    // behavioural_competency should tip the scheduler's choice toward it.
    const distribution = { motivation_fit: 20, behavioural_competency: 20, situational_judgement: 20, technical_functional: 20, commercial_awareness: 20 };
    const withoutPref = scheduleNextCategory({ distribution, transcript: [], questionCount: 10 });
    expect(withoutPref).toBe("motivation_fit"); // canonical-order tie-break, pre-2E

    const tipped = scheduleNextCategory({
      distribution, transcript: [], questionCount: 10,
      categoryPreference: { behavioural_competency: 1 },
    });
    expect(tipped).toBe("behavioural_competency");
  });

  it("methodology remains authoritative — a strong candidate preference CANNOT override a category with a materially larger deficit", () => {
    const distribution = { motivation_fit: 10, behavioural_competency: 70, situational_judgement: 10, technical_functional: 5, commercial_awareness: 5 };
    // questionCount 10 -> behavioural_competency target 7, deficit 7 vs motivation_fit deficit 1.
    // Even a maximal +1 preference for motivation_fit (nudge = +STRATEGY_NUDGE_CAP, well under
    // the real deficit gap) cannot flip the outcome.
    const result = scheduleNextCategory({
      distribution, transcript: [], questionCount: 10,
      categoryPreference: { motivation_fit: 1, behavioural_competency: -1 },
    });
    expect(result).toBe("behavioural_competency");
  });

  it("the nudge is bounded by STRATEGY_NUDGE_CAP regardless of how extreme the preference value is", () => {
    const distribution = Object.fromEntries(ACTIVE_CATEGORIES.map((c) => [c, 20]));
    const extreme = scheduleNextCategory({ distribution, transcript: [], questionCount: 10, categoryPreference: { behavioural_competency: 9999 } });
    const capped = scheduleNextCategory({ distribution, transcript: [], questionCount: 10, categoryPreference: { behavioural_competency: 1 } });
    expect(extreme).toBe(capped); // clamped to [-1, 1] before the cap is applied — same result either way
  });

  it("candidate strategy can never manufacture a category out of one methodology has already fully satisfied (exhaustion fallback is preference-blind)", () => {
    const distribution = {
      motivation_fit: 40, behavioural_competency: 25, situational_judgement: 15,
      technical_functional: 10, commercial_awareness: 10,
    };
    const transcript = ACTIVE_CATEGORIES.flatMap((c) => Array(20).fill({ category: c })); // methodology fully exhausted
    const withoutPref = scheduleNextCategory({ distribution, transcript, questionCount: 8 });
    const withPref = scheduleNextCategory({
      distribution, transcript, questionCount: 8,
      categoryPreference: { commercial_awareness: 1, motivation_fit: -1 },
    });
    expect(withPref).toBe(withoutPref); // still the heaviest-weight fallback, unaffected by preference
  });

  it("an invalid/out-of-range/non-numeric preference value defaults to no nudge for that category, never throws", () => {
    const distribution = Object.fromEntries(ACTIVE_CATEGORIES.map((c) => [c, 20]));
    for (const bad of [NaN, "not-a-number", null, undefined, {}, []]) {
      expect(() => scheduleNextCategory({ distribution, transcript: [], questionCount: 10, categoryPreference: { motivation_fit: bad } })).not.toThrow();
    }
  });

  it("is deterministic — identical inputs (including categoryPreference) always produce the same result", () => {
    const distribution = { motivation_fit: 20, behavioural_competency: 20, situational_judgement: 20, technical_functional: 20, commercial_awareness: 20 };
    const args = { distribution, transcript: [], questionCount: 10, categoryPreference: { behavioural_competency: 0.7 } };
    const results = Array.from({ length: 10 }, () => scheduleNextCategory(args));
    expect(new Set(results).size).toBe(1);
  });

  it("adversarial: a maximal preference for a zero-weight, fully-exhausted category can never get it selected over the heaviest-weight exhaustion fallback", () => {
    const distribution = { motivation_fit: 100, behavioural_competency: 0, situational_judgement: 0, technical_functional: 0, commercial_awareness: 0 };
    const transcript = Array(8).fill({ category: "motivation_fit" }); // motivation_fit's own deficit now 0 too — fully exhausted
    const result = scheduleNextCategory({
      distribution, transcript, questionCount: 8,
      categoryPreference: { behavioural_competency: 1 }, // maximal preference for a category methodology gives 0 weight
    });
    expect(result).toBe("motivation_fit"); // heaviest-weight fallback, never the preferred zero-weight category
  });
});

describe("countTrailingProbeDepth", () => {
  it("depth 0: empty transcript", () => {
    expect(countTrailingProbeDepth([])).toBe(0);
  });

  it("depth 0: transcript ending in a normal turn", () => {
    expect(countTrailingProbeDepth([{ turn_type: "follow_up" }, { turn_type: "normal" }])).toBe(0);
  });

  it("depth 1: one trailing probing turn", () => {
    expect(countTrailingProbeDepth([{ turn_type: "normal" }, { turn_type: "clarify" }])).toBe(1);
  });

  it("depth 2: two trailing probing turns", () => {
    expect(
      countTrailingProbeDepth([{ turn_type: "normal" }, { turn_type: "follow_up" }, { turn_type: "clarify" }])
    ).toBe(2);
  });

  it("depth > 2 keeps counting past MAX_PROBE_DEPTH — the counter doesn't cap, the caller circuit-breaks", () => {
    const transcript = [
      { turn_type: "normal" }, { turn_type: "follow_up" }, { turn_type: "clarify" }, { turn_type: "challenge_claim" },
    ];
    const depth = countTrailingProbeDepth(transcript);
    expect(depth).toBe(3);
    expect(depth).toBeGreaterThan(MAX_PROBE_DEPTH);
  });

  it("a null turn_type (the opening interview question) resets trailing depth to zero", () => {
    expect(countTrailingProbeDepth([{ turn_type: "follow_up" }, { turn_type: "follow_up" }, { turn_type: null }])).toBe(0);
    expect(countTrailingProbeDepth([{ turn_type: null }])).toBe(0);
  });

  it("a missing/undefined turn_type resets trailing depth to zero", () => {
    expect(countTrailingProbeDepth([{ turn_type: "clarify" }, { category: "motivation_fit" }])).toBe(0);
  });

  it("an invalid/unrecognized turn_type string resets trailing depth to zero", () => {
    expect(countTrailingProbeDepth([{ turn_type: "clarify" }, { turn_type: "banana" }])).toBe(0);
  });
});

describe("resolveTurnDirective — probing turn category inheritance", () => {
  const cases = [
    ["strong_signal", "follow_up"],
    ["unsupported_claim", "challenge_claim"],
    ["vague_or_incomplete", "clarify"],
  ];

  for (const [signal, expectedType] of cases) {
    it(`${expectedType} inherits priorCategory, not normalCandidate`, () => {
      const result = resolveTurnDirective({
        observedSignal: signal,
        priorCategory: "technical_functional",
        normalCandidate: "motivation_fit",
        challengedClaimEvidenced: false,
      });
      expect(result.turnType).toBe(expectedType);
      expect(result.category).toBe("technical_functional");
    });

    it(`${expectedType} defensively falls back to normalCandidate when priorCategory isn't a valid active category`, () => {
      const result = resolveTurnDirective({
        observedSignal: signal,
        priorCategory: "case_problem_solving", // reserved, never an active category
        normalCandidate: "commercial_awareness",
        challengedClaimEvidenced: false,
      });
      expect(result.turnType).toBe(expectedType);
      expect(result.category).toBe("commercial_awareness");
    });
  }

  it("a normal turn always uses normalCandidate from scheduleNextCategory", () => {
    const result = resolveTurnDirective({
      observedSignal: "sufficient",
      priorCategory: "technical_functional",
      normalCandidate: "commercial_awareness",
    });
    expect(result.turnType).toBe("normal");
    expect(result.category).toBe("commercial_awareness");
  });

  it("an unrecognized/missing observedSignal defensively resolves to a normal turn", () => {
    const result = resolveTurnDirective({
      observedSignal: "not_a_real_signal",
      priorCategory: "technical_functional",
      normalCandidate: "commercial_awareness",
    });
    expect(result.turnType).toBe("normal");
    expect(result.category).toBe("commercial_awareness");
  });
});

describe("resolveTurnDirective — challenge_claim anchoring", () => {
  it("defaults anchorSource to previous_answer", () => {
    const result = resolveTurnDirective({
      observedSignal: "unsupported_claim", priorCategory: "behavioural_competency", normalCandidate: "motivation_fit",
    });
    expect(result.anchorSource).toBe("previous_answer");
  });

  it("an evidenced challenge_claim anchors on the CV instead", () => {
    const result = resolveTurnDirective({
      observedSignal: "unsupported_claim", priorCategory: "behavioural_competency",
      normalCandidate: "motivation_fit", challengedClaimEvidenced: true,
    });
    expect(result.anchorSource).toBe("cv");
  });

  it("never selects an anchor source other than previous_answer or cv, and only literal true triggers cv", () => {
    for (const evidenced of [true, false, undefined, null, "yes", 0, 1]) {
      const result = resolveTurnDirective({
        observedSignal: "unsupported_claim", priorCategory: "motivation_fit",
        normalCandidate: "behavioural_competency", challengedClaimEvidenced: evidenced,
      });
      expect(["cv", "previous_answer"]).toContain(result.anchorSource);
      expect(result.anchorSource).toBe(evidenced === true ? "cv" : "previous_answer");
    }
  });
});

describe("2C.1 has no career/company-specific branching", () => {
  it("the scheduler source contains no company/role/industry conditionals or hardcoded employer/industry names", () => {
    const source = readFileSync(new URL("./methodology.js", import.meta.url), "utf8");
    const marker = "PHASE 2C.1";
    const idx = source.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);
    const schedulerSection = source.slice(idx);

    const forbidden = [
      /company\s*===/i, /role\s*===/i, /industry\s*===/i,
      /\bgoldman\b/i, /\bgoogle\b/i, /\bmckinsey\b/i, /\bjpmorgan\b/i, /\bmorgan stanley\b/i,
      /\binvestment bank(ing)?\b/i, /\bconsulting\b/i, /\bsoftware engineer\b/i,
    ];
    for (const pattern of forbidden) {
      expect(schedulerSection).not.toMatch(pattern);
    }
  });
});

describe("2C.1 determinism / fuzz", () => {
  // Same small deterministic PRNG shape already used above in this file, kept
  // local to this describe block since scheduleNextCategory/resolveTurnDirective
  // fuzzing needs different fixture shapes than computeMethodologyDistribution's.
  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("scheduleNextCategory is a pure, deterministic function of its input across randomized fixtures", () => {
    const rng = mulberry32(2026);
    for (let i = 0; i < 300; i++) {
      const distribution = Object.fromEntries(ACTIVE_CATEGORIES.map((c) => [c, Math.floor(rng() * 40)]));
      const questionCount = Math.floor(rng() * 20);
      const transcript = Array.from({ length: Math.floor(rng() * 15) }, () => ({
        category: ACTIVE_CATEGORIES[Math.floor(rng() * ACTIVE_CATEGORIES.length)],
        turn_type: TURN_TYPES[Math.floor(rng() * TURN_TYPES.length)],
      }));
      const first = scheduleNextCategory({ distribution, transcript, questionCount });
      const second = scheduleNextCategory({
        distribution: { ...distribution }, transcript: transcript.map((t) => ({ ...t })), questionCount,
      });
      expect(ACTIVE_CATEGORIES).toContain(first);
      expect(second).toBe(first);
    }
  });

  it("resolveTurnDirective is a pure, deterministic function of its input across randomized fixtures", () => {
    const rng = mulberry32(99);
    const observedPool = [...ADAPTIVE_SIGNALS, "unrecognized_garbage", undefined];
    for (let i = 0; i < 300; i++) {
      const args = {
        observedSignal: observedPool[Math.floor(rng() * observedPool.length)],
        priorCategory: rng() < 0.7 ? ACTIVE_CATEGORIES[Math.floor(rng() * ACTIVE_CATEGORIES.length)] : "not_a_category",
        normalCandidate: ACTIVE_CATEGORIES[Math.floor(rng() * ACTIVE_CATEGORIES.length)],
        challengedClaimEvidenced: rng() < 0.5,
      };
      const first = resolveTurnDirective(args);
      const second = resolveTurnDirective({ ...args });
      expect(TURN_TYPES).toContain(first.turnType);
      expect(ACTIVE_CATEGORIES).toContain(first.category);
      expect(second).toEqual(first);
    }
  });
});
