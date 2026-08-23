import { describe, it, expect } from "vitest";
import { validateQuestionBatch, validateProfile, filterEvidencedSignals, buildJdProfile } from "./App.jsx";
import { STAGE_METHODOLOGY, ACTIVE_CATEGORIES, computeMethodologyDistribution } from "./methodology.js";

describe("validateQuestionBatch — category fallback regression", () => {
  it("resolves an unrecognized/invalid category to technical_functional (pre-2A parity)", () => {
    const result = validateQuestionBatch(
      { questions: [{ text: "Tell me about a time you led a project.", category: "not_a_real_category" }] },
      1
    );
    expect(result.questions[0].category).toBe("technical_functional");
  });

  it("resolves a missing category the same way", () => {
    const result = validateQuestionBatch({ questions: [{ text: "Question with no category at all." }] }, 1);
    expect(result.questions[0].category).toBe("technical_functional");
  });

  it("still passes recognized legacy categories through canonical normalization, unaffected by the fallback", () => {
    const result = validateQuestionBatch(
      {
        questions: [
          { text: "q1", category: "motivation_fit" },
          { text: "q2", category: "cv_behavioural" },
          { text: "q3", category: "technical" },
          { text: "q4", category: "commercial_awareness" },
        ],
      },
      4
    );
    expect(result.questions.map((q) => q.category)).toEqual([
      "motivation_fit",
      "behavioural_competency",
      "technical_functional",
      "commercial_awareness",
    ]);
  });

  it("never emits the reserved case_problem_solving category via the fallback path", () => {
    const result = validateQuestionBatch({ questions: [{ text: "q", category: "" }] }, 1);
    expect(result.questions[0].category).not.toBe("case_problem_solving");
  });
});

describe("validateQuestionBatch — anchor_source (Phase 2B)", () => {
  it("passes through a recognized anchor_source unchanged", () => {
    const result = validateQuestionBatch({ questions: [{ text: "q", category: "technical", anchor_source: "jd" }] }, 1);
    expect(result.questions[0].anchor_source).toBe("jd");
  });

  it("falls back to generic for a missing anchor_source", () => {
    const missing = validateQuestionBatch({ questions: [{ text: "q", category: "technical" }] }, 1);
    expect(missing.questions[0].anchor_source).toBe("generic");
  });

  it("structurally rejects previous_answer even though it's a valid anchor_source in general", () => {
    // previous_answer is real and used by the scheduler (2C.1), but is meaningless at
    // batch-creation time (no answer exists yet) — validateQuestionBatch enforces the
    // narrower BATCH_ANCHOR_SOURCES set rather than trusting the prompt instruction alone.
    const invalid = validateQuestionBatch({ questions: [{ text: "q", category: "technical", anchor_source: "previous_answer" }] }, 1);
    expect(invalid.questions[0].anchor_source).toBe("generic");
  });
});

describe("validateProfile — jd_requirements (Phase 2B)", () => {
  it("normalizes a well-formed jd_requirements entry", () => {
    const result = validateProfile({
      interview_profile: {
        jd_requirements: [
          { requirement: "financial modelling", evidence_quote: "build complex financial models", confidence: "explicit", category: "technical_functional", occurrences: 2 },
        ],
      },
    });
    expect(result.interview_profile.jd_requirements).toEqual([
      { requirement: "financial modelling", evidence_quote: "build complex financial models", confidence: "explicit", category: "technical_functional", occurrences: 2 },
    ]);
  });

  it("drops malformed entries missing requirement or evidence_quote", () => {
    const result = validateProfile({
      interview_profile: {
        jd_requirements: [
          { requirement: "", evidence_quote: "some quote", confidence: "explicit", category: "technical_functional" },
          { requirement: "some requirement", evidence_quote: "", confidence: "explicit", category: "technical_functional" },
          { requirement: "kept", evidence_quote: "kept quote", confidence: "explicit", category: "technical_functional" },
        ],
      },
    });
    expect(result.interview_profile.jd_requirements).toHaveLength(1);
    expect(result.interview_profile.jd_requirements[0].requirement).toBe("kept");
  });

  it("defaults an invalid/missing confidence to general", () => {
    const result = validateProfile({
      interview_profile: {
        jd_requirements: [{ requirement: "x", evidence_quote: "y", confidence: "not_a_real_confidence", category: "technical_functional" }],
      },
    });
    expect(result.interview_profile.jd_requirements[0].confidence).toBe("general");
  });

  it("normalizes category through the canonical taxonomy (legacy input tolerated)", () => {
    const result = validateProfile({
      interview_profile: {
        jd_requirements: [{ requirement: "x", evidence_quote: "y", confidence: "inferred", category: "role_specific" }],
      },
    });
    expect(result.interview_profile.jd_requirements[0].category).toBe("technical_functional");
  });

  it("clamps occurrences to a sane range and defaults missing occurrences to 1", () => {
    const result = validateProfile({
      interview_profile: {
        jd_requirements: [
          { requirement: "a", evidence_quote: "qa", confidence: "explicit", category: "motivation_fit" },
          { requirement: "b", evidence_quote: "qb", confidence: "explicit", category: "motivation_fit", occurrences: 9999 },
        ],
      },
    });
    expect(result.interview_profile.jd_requirements[0].occurrences).toBe(1);
    expect(result.interview_profile.jd_requirements[1].occurrences).toBeLessThanOrEqual(50);
  });

  it("returns an empty array when jd_requirements is missing entirely", () => {
    const result = validateProfile({ interview_profile: {} });
    expect(result.interview_profile.jd_requirements).toEqual([]);
  });
});

describe("filterEvidencedSignals (Phase 2B)", () => {
  const jdText = "We are looking for someone with strong financial modelling skills and excellent client communication.";

  it("keeps a requirement whose evidence_quote is a real substring of the JD text", () => {
    const kept = filterEvidencedSignals(
      [{ requirement: "modelling", evidence_quote: "strong financial modelling skills", category: "technical_functional" }],
      jdText
    );
    expect(kept).toHaveLength(1);
  });

  it("drops a requirement whose evidence_quote is not actually in the JD text (hallucinated quote)", () => {
    const kept = filterEvidencedSignals(
      [{ requirement: "leadership", evidence_quote: "must have led a team of 50 engineers", category: "behavioural_competency" }],
      jdText
    );
    expect(kept).toHaveLength(0);
  });

  it("drops entries with an empty evidence_quote", () => {
    const kept = filterEvidencedSignals([{ requirement: "x", evidence_quote: "", category: "motivation_fit" }], jdText);
    expect(kept).toHaveLength(0);
  });

  it("handles a mixed set, keeping only the evidenced ones", () => {
    const kept = filterEvidencedSignals(
      [
        { requirement: "real", evidence_quote: "client communication", category: "commercial_awareness" },
        { requirement: "fake", evidence_quote: "10 years of Rust experience", category: "technical_functional" },
      ],
      jdText
    );
    expect(kept.map((r) => r.requirement)).toEqual(["real"]);
  });
});

describe("buildJdProfile (Phase 2B)", () => {
  const jdText = "Must be proficient in advanced Excel financial modelling for this role.";

  it("constructs direction: 1 internally — the AI-facing schema never supplies it", () => {
    const profile = buildJdProfile(
      [{ requirement: "Excel modelling", evidence_quote: "advanced Excel financial modelling", confidence: "explicit", category: "technical_functional", occurrences: 1 }],
      jdText
    );
    expect(profile.signals).toHaveLength(1);
    expect(profile.signals[0].direction).toBe(1);
  });

  it("only includes evidence-verified signals, matching filterEvidencedSignals", () => {
    const profile = buildJdProfile(
      [
        { requirement: "real", evidence_quote: "advanced Excel financial modelling", confidence: "explicit", category: "technical_functional", occurrences: 1 },
        { requirement: "fake", evidence_quote: "never actually said this", confidence: "explicit", category: "commercial_awareness", occurrences: 1 },
      ],
      jdText
    );
    expect(profile.signals).toHaveLength(1);
    expect(profile.signals[0].requirement).toBe("real");
  });

  it("returns an empty signals array (not an error) when nothing is evidenced", () => {
    const profile = buildJdProfile([], jdText);
    expect(profile).toEqual({ signals: [] });
  });
});

describe("methodology distribution integration (Phase 2B, end-to-end through the real functions)", () => {
  it("validateProfile -> filterEvidencedSignals -> buildJdProfile -> computeMethodologyDistribution stays within the stage envelope", () => {
    const jdText = "This role requires advanced Excel financial modelling and strong client-facing communication skills.";
    const aiResponse = {
      interview_profile: {
        jd_requirements: [
          { requirement: "Excel modelling", evidence_quote: "advanced Excel financial modelling", confidence: "explicit", category: "technical_functional", occurrences: 2 },
          { requirement: "client communication", evidence_quote: "strong client-facing communication skills", confidence: "explicit", category: "commercial_awareness", occurrences: 1 },
          { requirement: "hallucinated", evidence_quote: "must have shipped a mobile app", confidence: "explicit", category: "technical_functional", occurrences: 1 },
        ],
      },
    };
    const profile = validateProfile(aiResponse);
    const jdProfile = buildJdProfile(profile.interview_profile.jd_requirements, jdText);
    // The hallucinated (unevidenced) requirement must not survive into the signals used
    // for the actual distribution calculation.
    expect(jdProfile.signals).toHaveLength(2);

    const { baseline, envelope } = STAGE_METHODOLOGY.first_round;
    const result = computeMethodologyDistribution("first_round", jdProfile);
    for (const c of ACTIVE_CATEGORIES) {
      expect(result[c]).toBeGreaterThanOrEqual(baseline[c] - envelope[c].minus);
      expect(result[c]).toBeLessThanOrEqual(baseline[c] + envelope[c].plus);
    }
    expect(result.technical_functional).toBeGreaterThan(baseline.technical_functional);
    expect(result.case_problem_solving).toBe(0);
  });

  it("falls back to the stage baseline unmodified when no requirements survive evidence filtering", () => {
    const jdText = "Generic role description with nothing specific.";
    const profile = validateProfile({
      interview_profile: { jd_requirements: [{ requirement: "x", evidence_quote: "not present in the jd text", confidence: "explicit", category: "technical_functional" }] },
    });
    const jdProfile = buildJdProfile(profile.interview_profile.jd_requirements, jdText);
    const result = computeMethodologyDistribution("first_round", jdProfile);
    expect(result).toEqual(STAGE_METHODOLOGY.first_round.baseline);
  });
});
