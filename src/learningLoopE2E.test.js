/* ================================================================== *
 * PHASE 15A — LEARNING-LOOP END-TO-END (behavioural, controlled fakes)
 * ------------------------------------------------------------------
 * Traces the decision logic of:
 *
 *   application recommendation
 *     -> materialise a classroom topic (no interview, no score)
 *     -> "generate" the Development Module (ONE validation of the AI JSON)
 *     -> persist it (fake DB)
 *     -> REOPEN / reload
 *     -> a persisted module is REUSED with ZERO further AI "calls"
 *     -> deterministic flashcards are available from the persisted module
 *     -> the written quiz marks deterministically from the persisted concepts
 *
 * App.jsx's React glue can't be executed under the `node` test env, so this
 * exercises the exported pure pieces the glue is built from:
 *   validateDevelopmentModule, classroomTopicMatch, markWrittenQuiz,
 *   redoConceptUnion, plus a tiny fake persistence layer + a call counter.
 * ================================================================== */
import { describe, it, expect, vi } from "vitest";
import { validateDevelopmentModule } from "./App.jsx";
import { classroomTopicMatch, redoConceptUnion } from "./continuePreparing.js";
import { markWrittenQuiz } from "./writtenQuiz.js";

// ---- a fake of the ONE AI generation call, with a hard counter ----
function makeFakeGenerator() {
  const calls = { n: 0 };
  const generate = vi.fn((topicLabel) => {
    calls.n += 1;
    return {
      topic: topicLabel,
      why_it_matters: "This is an area to prepare for this application; it is NOT a demonstrated weakness.",
      context_note: "",
      learning_guide: { core_explanation: "…", frameworks: ["step 1"], examples: [], common_mistakes: [], application_context: "" },
      learning_items: [
        { concept: "Terminal value", explanation: "e", flashcard_front: "What is terminal value?", flashcard_back: "value beyond the forecast",
          quiz_question: "Explain terminal value.", model_answer: "m", review: "r",
          expected_concepts: [{ label: "future cash flows", accepted_terms: ["cash flows after the forecast"] }, { label: "beyond the forecast period" }] },
        { concept: "Discount rate", explanation: "e", flashcard_front: "What rate discounts FCF?", flashcard_back: "WACC",
          quiz_question: "Which rate discounts unlevered FCF?", model_answer: "m", review: "r",
          expected_concepts: [{ label: "weighted average cost of capital", accepted_terms: ["wacc"] }] },
      ],
    };
  });
  return { calls, generate };
}

// ---- a fake development_modules store, keyed by topic id ----
function makeModuleStore() {
  const rows = new Map();
  return {
    get: (topicId) => rows.get(topicId) || null,
    insert: (topicId, fields) => {
      if (rows.has(topicId)) return rows.get(topicId); // UNIQUE(topic_id) — idempotent
      const row = { id: `mod-${rows.size + 1}`, topic_id: topicId, ...fields };
      rows.set(topicId, row);
      return row;
    },
    size: () => rows.size,
  };
}

// the reuse-or-generate decision openDevelopmentModule makes, in isolation.
async function openModule({ topic, store, gen }) {
  const existing = store.get(topic.id);
  if (existing) return { module: existing, generated: false };              // <- COST INVARIANT
  const raw = gen.generate(topic.topic);
  const validated = validateDevelopmentModule(raw);
  if (!validated.learning_items.length) throw new Error("incomplete");
  const saved = store.insert(topic.id, { dimension: "technical", ...validated, source_interview_id: null });
  return { module: saved, generated: true };
}

describe("learning loop — recommendation -> module -> reuse -> flashcards -> quiz", () => {
  it("materialise (no interview, no score) -> ONE generation -> persist -> reopen reuses with ZERO further AI", async () => {
    const store = makeModuleStore();
    const { calls, generate } = makeFakeGenerator();
    const gen = { generate };

    // --- application recommendation with no pre-existing topic ---
    const existingTopics = [{ id: "t-other", topic: "Something else", applicationId: "app-A" }];
    const rec = { label: "DCF terminal value", dimension: "technical", gapKind: "preparation" };
    expect(classroomTopicMatch(existingTopics, rec.label, "app-A")).toBeNull(); // -> materialise

    // --- materialised topic: NO interview, NO score (area to prepare) ---
    const topic = { id: "t-new", topic: rec.label, applicationId: "app-A", scores: [], lastInterviewId: null, company: "JPMorgan", role: "IB Analyst" };

    // --- first open: exactly ONE generation, persisted ---
    const first = await openModule({ topic, store, gen });
    expect(first.generated).toBe(true);
    expect(calls.n).toBe(1);
    expect(store.size()).toBe(1);
    expect(first.module.id).toBeTruthy();

    // --- reopen (same session) ---
    const second = await openModule({ topic, store, gen });
    expect(second.generated).toBe(false);
    expect(calls.n).toBe(1); // ZERO additional AI calls

    // --- "reload": a brand-new store hydrated from the same persisted row ---
    const reloaded = makeModuleStore();
    reloaded.insert(topic.id, { dimension: first.module.dimension, learning_guide: first.module.learning_guide, learning_items: first.module.learning_items, source_interview_id: null });
    const gen2 = makeFakeGenerator();
    const afterReload = await openModule({ topic, store: reloaded, gen: { generate: gen2.generate } });
    expect(afterReload.generated).toBe(false);
    expect(gen2.calls.n).toBe(0); // ZERO AI after reload

    // --- deterministic flashcards from the persisted module ---
    const cards = afterReload.module.learning_items.map((it) => ({ front: it.flashcard_front, back: it.flashcard_back }));
    expect(cards).toHaveLength(2);
    expect(cards[0].front).toMatch(/terminal value/i);
    expect(cards.every((c) => c.front && c.back)).toBe(true);

    // --- deterministic written-quiz marking from the persisted concepts, no AI ---
    const item0 = afterReload.module.learning_items[0];
    const strong = markWrittenQuiz("It is the value of the future cash flows beyond the forecast period.", item0.expected_concepts);
    expect(strong.coverage).toEqual({ n: 2, total: 2 });
    const weak = markWrittenQuiz("It is some number at the end.", item0.expected_concepts);
    expect(weak.coverage.n).toBe(0);
    expect(weak.missing).toEqual(["future cash flows", "beyond the forecast period"]);
    // partial answer is partial, never binary "wrong"
    const partial = markWrittenQuiz("the future cash flows matter here", item0.expected_concepts);
    expect(partial.coverage.n).toBe(1);
    expect(partial.coverage.total).toBe(2);

    // --- redo the original question: marked deterministically over the concept UNION, still no AI ---
    const union = redoConceptUnion(afterReload.module);
    expect(union.map((c) => c.label)).toEqual(["future cash flows", "beyond the forecast period", "weighted average cost of capital"]);
    const redoMark = markWrittenQuiz("You discount the future cash flows, including those beyond the forecast period, at the weighted average cost of capital.", union);
    expect(redoMark.coverage).toEqual({ n: 3, total: 3 });
    expect(gen2.calls.n).toBe(0); // nothing above touched AI
  });

  it("a rejected AI payload never persists a module and never fakes one", async () => {
    const store = makeModuleStore();
    const gen = { generate: () => ({ learning_items: [{ concept: "x" }] }) }; // missing flashcards/quiz/concepts -> dropped
    const topic = { id: "t-bad", topic: "Broken", applicationId: "app-A" };
    await expect(openModule({ topic, store, gen })).rejects.toThrow(/incomplete/);
    expect(store.size()).toBe(0);
  });
});
