/* ================================================================== *
 * PHASE 14 — DETERMINISTIC WRITTEN-QUIZ MARKING: UNIT TESTS
 * ------------------------------------------------------------------
 * markWrittenQuiz must, with NO AI call:
 *   - credit a concept only when the answer really expresses it;
 *   - never turn a partial answer into a binary "wrong";
 *   - survive case / punctuation / whitespace / plural variation;
 *   - honour generator-supplied accepted terms (synonyms);
 *   - NOT be fooled by one incidental keyword in an unrelated sentence;
 *   - treat an empty answer as zero coverage, not a crash.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { markWrittenQuiz, coverageVerdict } from "./writtenQuiz.js";

const SRC = readFileSync(new URL("./writtenQuiz.js", import.meta.url), "utf8");

const DCF_TV = [
  { label: "future cash flows", accepted_terms: ["cash flows in the future", "cash flow beyond the forecast"] },
  { label: "value", accepted_terms: ["worth", "present value"] },
  { label: "beyond the explicit forecast period", accepted_terms: ["after the forecast period", "past the projection window"] },
];

/* ============================== purity ============================== */
describe("writtenQuiz.js is a pure, offline module", () => {
  it("no AI call, no network, no react, no db", () => {
    expect(SRC).not.toMatch(/callClaude|fetch\(|supabase|from ["']react["']|XMLHttpRequest|WebSocket/);
  });
  it("has no imports at all (self-contained)", () => {
    expect(SRC.match(/^import /m)).toBeNull();
  });
});

/* ============================== core coverage ============================== */
describe("markWrittenQuiz — concept coverage", () => {
  it("a full, correct answer covers every concept", () => {
    const r = markWrittenQuiz(
      "Terminal value is the value of the future cash flows that occur beyond the explicit forecast period.",
      DCF_TV
    );
    expect(r.coverage).toEqual({ n: 3, total: 3 });
    expect(r.missing).toEqual([]);
    expect(r.answered).toBe(true);
  });

  it("a partial answer is scored as partial, never as binary wrong", () => {
    const r = markWrittenQuiz("It represents the future cash flows of the business.", DCF_TV);
    expect(r.coverage.n).toBe(1);
    expect(r.coverage.total).toBe(3);
    expect(r.covered).toContain("future cash flows");
    expect(r.missing).toContain("beyond the explicit forecast period");
    // partial != "wrong"
    expect(r.coverage.n).toBeGreaterThan(0);
    expect(r.coverage.n).toBeLessThan(r.coverage.total);
  });

  it("covered/missing preserve the declared concept order", () => {
    const r = markWrittenQuiz("value beyond the explicit forecast period", DCF_TV);
    // 'value' declared before 'beyond...'
    expect(r.covered).toEqual(["value", "beyond the explicit forecast period"]);
    expect(r.missing).toEqual(["future cash flows"]);
  });
});

/* ============================== normalisation ============================== */
describe("markWrittenQuiz — normalisation is forgiving", () => {
  it("case-insensitive", () => {
    const r = markWrittenQuiz("FUTURE CASH FLOWS, VALUE, BEYOND THE EXPLICIT FORECAST PERIOD", DCF_TV);
    expect(r.coverage.n).toBe(3);
  });
  it("punctuation and extra whitespace do not matter", () => {
    const r = markWrittenQuiz("  future   cash-flows...  value!!  beyond   the explicit forecast period.  ", DCF_TV);
    expect(r.coverage.n).toBe(3);
  });
  it("singular / plural variation ('cash flow' vs 'cash flows')", () => {
    const r = markWrittenQuiz("the future cash flow and its present value", DCF_TV);
    expect(r.covered).toContain("future cash flows");
    expect(r.covered).toContain("value");
  });
  it("reordered wording within a small window still counts ('cash flows in the future')", () => {
    const r = markWrittenQuiz("the cash flows expected in the future are discounted", DCF_TV);
    expect(r.covered).toContain("future cash flows");
  });
});

/* ============================== accepted terms (synonyms) ============================== */
describe("markWrittenQuiz — accepted terminology", () => {
  it("credits a concept via an explicit accepted term", () => {
    const r = markWrittenQuiz("it is the worth of everything after the forecast period", DCF_TV);
    expect(r.covered).toContain("value");                                  // 'worth'
    expect(r.covered).toContain("beyond the explicit forecast period");    // 'after the forecast period'
  });
  it("a concept with no accepted terms still matches its own label", () => {
    const r = markWrittenQuiz("net income flows into retained earnings", [
      { label: "retained earnings" }, { label: "net income" }, { label: "dividends" },
    ]);
    expect(r.covered.sort()).toEqual(["net income", "retained earnings"]);
    expect(r.missing).toEqual(["dividends"]);
  });
});

/* ============================== adversarial: no false positives ============================== */
describe("markWrittenQuiz — adversarial (must NOT over-credit)", () => {
  it("one incidental keyword in an unrelated sentence does NOT cover a multi-word concept", () => {
    const r = markWrittenQuiz(
      "I once did a summer internship and my manager valued my forecast of the office party budget.",
      DCF_TV
    );
    // 'value'/'forecast' appear as stray words but not the concepts
    expect(r.covered).not.toContain("future cash flows");
    expect(r.covered).not.toContain("beyond the explicit forecast period");
  });

  it("a single shared stopword never credits a concept", () => {
    const r = markWrittenQuiz("the the the of of in on at", DCF_TV);
    expect(r.coverage.n).toBe(0);
  });

  it("scattered concept words far apart do not count as a proximity match", () => {
    const filler = "and then we discussed many other unrelated matters at length in the meeting room ".repeat(3);
    const r = markWrittenQuiz(`future ${filler} cash ${filler} flows`, DCF_TV);
    expect(r.covered).not.toContain("future cash flows");
  });

  it("empty / whitespace answer covers nothing and does not throw", () => {
    expect(() => markWrittenQuiz("", DCF_TV)).not.toThrow();
    const r = markWrittenQuiz("   \n  ", DCF_TV);
    expect(r.answered).toBe(false);
    expect(r.coverage).toEqual({ n: 0, total: 3 });
    expect(r.missing.length).toBe(3);
  });

  it("never throws on malformed concept input", () => {
    expect(() => markWrittenQuiz("anything", null)).not.toThrow();
    expect(() => markWrittenQuiz("anything", [null, {}, { label: "" }, { label: "x", accepted_terms: "nope" }])).not.toThrow();
    expect(markWrittenQuiz("x", []).coverage).toEqual({ n: 0, total: 0 });
  });
});

/* ============================== verdict text (no colour-only) ============================== */
describe("coverageVerdict — text carries the meaning, never 'wrong'", () => {
  it("full / partial / none each get distinct wording", () => {
    expect(coverageVerdict({ n: 3, total: 3 }).label).toMatch(/all 3/i);
    expect(coverageVerdict({ n: 1, total: 3 }).label).toMatch(/1 of 3/);
    expect(coverageVerdict({ n: 0, total: 3 }).label).toMatch(/0 of 3/);
  });
  it("never emits the word 'wrong' or 'incorrect'", () => {
    for (const n of [0, 1, 2, 3]) {
      expect(coverageVerdict({ n, total: 3 }).label).not.toMatch(/wrong|incorrect|fail/i);
    }
  });
  it("degrades safely with no concepts", () => {
    expect(() => coverageVerdict({ n: 0, total: 0 })).not.toThrow();
    expect(coverageVerdict(null).tone).toBe("none");
  });
});
