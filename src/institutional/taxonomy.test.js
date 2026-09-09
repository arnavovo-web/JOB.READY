import { describe, it, expect } from "vitest";
import {
  MIN_COHORT_N, COMPETENCY_DIMENSIONS, canonicalDimension, dimensionLabel,
  QUESTION_CATEGORIES, canonicalCategory, categoryLabel,
  INTERVIEW_STAGES, stageLabel, READINESS_LEVELS, readinessMeta,
  scoreBand, ROLE_FAMILIES, classifyRole, roleFamilyLabel,
} from "./taxonomy.js";

describe("k-anonymity threshold", () => {
  it("is a sensible minimum group size and is a single source of truth", () => {
    expect(Number.isInteger(MIN_COHORT_N)).toBe(true);
    expect(MIN_COHORT_N).toBeGreaterThanOrEqual(3);
  });
});

describe("competency dimensions — the controlled axis", () => {
  it("has exactly the six evaluation dimensions the student platform scores", () => {
    expect(COMPETENCY_DIMENSIONS.map((d) => d.key).sort()).toEqual(
      ["communication", "competency_demonstration", "evidence", "relevance", "specificity", "structure"]
    );
  });
  it("maps the historical `clarity` alias onto `communication`", () => {
    expect(canonicalDimension("clarity")).toBe("communication");
    expect(canonicalDimension("Clarity")).toBe("communication");
    expect(canonicalDimension("communication")).toBe("communication");
  });
  it("returns null for anything outside the axis (so free-text competency strings can't leak in)", () => {
    expect(canonicalDimension("Analytical rigour and attention to detail")).toBeNull();
    expect(canonicalDimension("")).toBeNull();
    expect(canonicalDimension(null)).toBeNull();
  });
  it("labels every dimension", () => {
    for (const d of COMPETENCY_DIMENSIONS) expect(dimensionLabel(d.key)).toBe(d.label);
    expect(dimensionLabel("clarity")).toBe("Communication");
  });
});

describe("question categories — canonical six + legacy normalisation", () => {
  it("has the canonical six-category methodology taxonomy", () => {
    expect(QUESTION_CATEGORIES.map((c) => c.key).sort()).toEqual(
      ["behavioural_competency", "case_problem_solving", "commercial_awareness", "motivation_fit", "situational_judgement", "technical_functional"]
    );
  });
  it("normalises the legacy raw category values seen in the live DB", () => {
    expect(canonicalCategory("cv_behavioural")).toBe("behavioural_competency");
    expect(canonicalCategory("role_specific")).toBe("technical_functional");
    expect(canonicalCategory("technical")).toBe("technical_functional");
    expect(canonicalCategory("commercial_awareness")).toBe("commercial_awareness");
    expect(canonicalCategory("motivation_fit")).toBe("motivation_fit");
  });
  it("falls back to behavioural_competency for unknown/missing, never throws", () => {
    expect(canonicalCategory("something_new")).toBe("behavioural_competency");
    expect(canonicalCategory(undefined)).toBe("behavioural_competency");
    expect(categoryLabel("motivation_fit")).toMatch(/motivation/i);
  });
});

describe("stages & readiness", () => {
  it("covers the four interview stages seen in the data", () => {
    expect(INTERVIEW_STAGES.map((s) => s.key)).toEqual(
      ["recruiter_screen", "first_round", "technical", "final_round"]
    );
    expect(stageLabel("final_round")).toBe("Final round");
    expect(stageLabel(null)).toBe("Unspecified");
  });
  it("readiness ladder is ordered worst -> best and mapped", () => {
    expect(READINESS_LEVELS.map((r) => r.key)).toEqual(
      ["not_ready", "needs_improvement", "interview_ready", "strong"]
    );
    expect(readinessMeta("strong").score).toBe(3);
    expect(readinessMeta("not_ready").score).toBe(0);
    expect(readinessMeta("bogus").score).toBeNull();
  });
});

describe("scoreBand", () => {
  it("bands a 0-100 score qualitatively, with a no-data case", () => {
    expect(scoreBand(null).key).toBe("none");
    expect(scoreBand(80).tone).toBe("good");
    expect(scoreBand(62).key).toBe("solid");
    expect(scoreBand(50).key).toBe("developing");
    expect(scoreBand(20).tone).toBe("bad");
  });
});

describe("career-path role classification (documented heuristic)", () => {
  it("classifies clear role strings confidently", () => {
    expect(classifyRole("Investment Banking Summer Analyst", "Goldman Sachs")).toMatchObject({ key: "ib", confident: true });
    expect(classifyRole("Global Markets Sales & Trading Summer Analyst", "JPMorgan")).toMatchObject({ key: "markets", confident: true });
    expect(classifyRole("Private Equity Summer Analyst", "Blackstone")).toMatchObject({ key: "pe_pc", confident: true });
    expect(classifyRole("Business Analyst", "McKinsey & Company")).toMatchObject({ key: "consulting", confident: true });
    expect(classifyRole("software engineer", "netflix")).toMatchObject({ key: "swe", confident: true });
  });
  it("falls back to a low-confidence company hint, then to unclassified", () => {
    expect(classifyRole("Summer Analyst", "Goldman Sachs")).toMatchObject({ key: "ib", confident: false });
    expect(classifyRole("Graduate Analyst", "Northgate Retail Group")).toMatchObject({ key: "unclassified", confident: false });
    expect(classifyRole("", "")).toMatchObject({ key: "unclassified", confident: false });
  });
  it("every family has a label and keywords; roleFamilyLabel round-trips", () => {
    for (const f of ROLE_FAMILIES) {
      expect(f.label.length).toBeGreaterThan(2);
      expect(Array.isArray(f.kw) && f.kw.length).toBeTruthy();
      expect(roleFamilyLabel(f.key)).toBe(f.label);
    }
    expect(roleFamilyLabel("unclassified")).toMatch(/unclassified/i);
  });
});
