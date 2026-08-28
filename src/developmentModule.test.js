/* ================================================================== *
 * PHASE 14 — DEVELOPMENT MODULE VALIDATION + KNOWLEDGE GROUNDING
 * ------------------------------------------------------------------
 * validateDevelopmentModule must coerce/clamp arbitrary AI JSON into a
 * safe shape and drop malformed learning items (so the caller can treat
 * "zero usable items" as a failed generation). findConceptsByText must
 * return catalogue concepts for grounding ONLY, with no scheduler/context.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { validateDevelopmentModule } from "./App.jsx";
import { findConceptsByText } from "./interviewKnowledge.js";

const goodItem = (over = {}) => ({
  concept: "Terminal value",
  explanation: "The value of cash flows beyond the forecast.",
  flashcard_front: "What does terminal value represent?",
  flashcard_back: "The value of expected cash flows beyond the explicit forecast period.",
  quiz_question: "Explain what terminal value represents in a DCF.",
  model_answer: "It is the PV of all cash flows after the forecast horizon.",
  review: "Terminal value often dominates a DCF's output.",
  expected_concepts: [
    { label: "future cash flows", accepted_terms: ["cash flows after the forecast"] },
    { label: "beyond the forecast period" },
  ],
  ...over,
});

describe("validateDevelopmentModule — coercion & safety", () => {
  it("passes a well-formed module through, clamped", () => {
    const m = validateDevelopmentModule({
      topic: "DCF terminal value",
      why_it_matters: "You were unclear on this in the interview.",
      context_note: "",
      learning_guide: { core_explanation: "…", frameworks: ["step 1", "step 2"], examples: ["e"], common_mistakes: ["m"], application_context: "" },
      learning_items: [goodItem(), goodItem({ concept: "Discount rate" })],
    });
    expect(m.topic).toBe("DCF terminal value");
    expect(m.learning_items.length).toBe(2);
    expect(m.learning_items[0].expected_concepts[0].label).toBe("future cash flows");
    expect(m.learning_guide.frameworks).toEqual(["step 1", "step 2"]);
  });

  it("drops learning items missing required fields (concept / flashcards / quiz / concepts)", () => {
    const m = validateDevelopmentModule({
      learning_items: [
        goodItem(),
        { concept: "no flashcard", quiz_question: "q", expected_concepts: [{ label: "x" }] },   // no flashcards -> dropped
        { concept: "no concepts", flashcard_front: "f", flashcard_back: "b", quiz_question: "q", expected_concepts: [] }, // dropped
        goodItem({ concept: "kept" }),
      ],
    });
    expect(m.learning_items.map((i) => i.concept)).toEqual(["Terminal value", "kept"]);
  });

  it("never throws on garbage and yields zero usable items (caller treats as failed generation)", () => {
    for (const junk of [null, undefined, {}, "nope", 42, { learning_items: "no" }, { learning_items: [null, {}, 1] }]) {
      expect(() => validateDevelopmentModule(junk)).not.toThrow();
      expect(validateDevelopmentModule(junk).learning_items).toEqual([]);
    }
  });

  it("clamps oversized arrays and preserves declared order", () => {
    const many = Array.from({ length: 20 }, (_, i) => goodItem({ concept: `c${i}` }));
    const m = validateDevelopmentModule({ learning_items: many });
    expect(m.learning_items.length).toBe(8);
    expect(m.learning_items[0].concept).toBe("c0");
    const ec = validateDevelopmentModule({ learning_items: [goodItem({ expected_concepts: Array.from({ length: 12 }, (_, i) => ({ label: `L${i}` })) })] });
    expect(ec.learning_items[0].expected_concepts.length).toBe(6);
  });

  it("expected_concepts always have a string label and an array of accepted_terms", () => {
    const m = validateDevelopmentModule({ learning_items: [goodItem({ expected_concepts: [{ label: "ok", accepted_terms: "not-array" }, { label: 5 }, { notlabel: "x" }] })] });
    const ecs = m.learning_items.length ? m.learning_items[0].expected_concepts : [];
    for (const c of ecs) {
      expect(typeof c.label).toBe("string");
      expect(Array.isArray(c.accepted_terms)).toBe(true);
    }
  });
});

describe("findConceptsByText — grounding lookup only", () => {
  it("finds the three-statements concept from a free-text development need", () => {
    const hits = findConceptsByText("Linking the three financial statements", 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((c) => /statement/i.test(c.label))).toBe(true);
  });

  it("returns [] for text that overlaps nothing in the catalogue", () => {
    expect(findConceptsByText("my favourite colour is blue", 2)).toEqual([]);
    expect(findConceptsByText("", 2)).toEqual([]);
    expect(findConceptsByText(null, 2)).toEqual([]);
  });

  it("returned objects are raw catalogue concepts (carry misconceptions/archetypes for grounding), never a scheduler decision", () => {
    const hits = findConceptsByText("discounted cash flow valuation", 1);
    if (hits.length) {
      expect(hits[0]).toHaveProperty("id");
      expect(hits[0]).toHaveProperty("label");
      expect(hits[0]).not.toHaveProperty("turn_type");
      expect(hits[0]).not.toHaveProperty("anchor_source");
    }
  });
});
