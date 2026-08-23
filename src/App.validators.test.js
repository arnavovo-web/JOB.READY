import { describe, it, expect } from "vitest";
import { validateQuestionBatch } from "./App.jsx";

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
