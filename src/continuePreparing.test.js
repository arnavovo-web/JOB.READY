/* ================================================================== *
 * PHASE 15A — TOPIC IDENTITY + "CONTINUE PREPARING" (behavioural)
 * ------------------------------------------------------------------
 *  - classroomTopicMatch: same name + same application -> match;
 *    same name + different application -> NO match; null application is
 *    one deliberate "unscoped practice" bucket.
 *  - pickContinuePreparing: deterministic P1>P2>P3 order, and it NEVER
 *    calls a preparation area a "weakness".
 *  - redoConceptUnion: de-duplicated concept set for redo marking.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { classroomTopicMatch, pickContinuePreparing, redoConceptUnion } from "./continuePreparing.js";

const SRC = readFileSync(new URL("./continuePreparing.js", import.meta.url), "utf8");

describe("continuePreparing.js is pure and offline", () => {
  it("no AI / DB / network / react", () => {
    expect(SRC).not.toMatch(/callClaude|supabase|fetch\(|from ["']react["']/);
  });
  it("imports only the one deterministic priority helper", () => {
    const imports = SRC.match(/^import .*/gm) || [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatch(/applicationDevelopmentPriorities.*applicationIntelligence/);
  });
});

/* ============================== application-scoped topic identity ============================== */
describe("classroomTopicMatch — identity = normalised name + application", () => {
  const list = [
    { id: "t-a", topic: "Quantifying impact", applicationId: "app-A" },
    { id: "t-b", topic: "Structuring answers", applicationId: "app-B" },
    { id: "t-legacy", topic: "Communication", applicationId: null },
  ];

  it("same name + same application => match (merge/update)", () => {
    expect(classroomTopicMatch(list, "quantifying impact", "app-A")).toBe(list[0]);
    expect(classroomTopicMatch(list, "Quantifying  Impact!!", "app-A")).toBe(list[0]);
  });

  it("same name + DIFFERENT application => NO match (stays separate)", () => {
    expect(classroomTopicMatch(list, "Quantifying impact", "app-B")).toBeNull();
    expect(classroomTopicMatch(list, "Structuring answers", "app-A")).toBeNull();
  });

  it("null application is its own bucket: null matches null, never a real app", () => {
    expect(classroomTopicMatch(list, "communication", null)).toBe(list[2]);
    expect(classroomTopicMatch(list, "communication", "app-A")).toBeNull();     // real app never merges into legacy null
    expect(classroomTopicMatch([{ topic: "X", applicationId: "app-A" }], "X", null)).toBeNull();
  });

  it("fuzzy containment still applies WITHIN the same application", () => {
    expect(classroomTopicMatch([{ id: "1", topic: "DCF valuation mechanics", applicationId: "app-A" }], "DCF valuation", "app-A")).toBeTruthy();
  });

  it("never throws on junk", () => {
    expect(() => classroomTopicMatch(null, null, null)).not.toThrow();
    expect(classroomTopicMatch([{}], "", "x")).toBeNull();
    expect(classroomTopicMatch([null, { topic: "" }], "a", "x")).toBeNull();
  });
});

/* ============================== deterministic "Continue preparing" ============================== */
describe("pickContinuePreparing — P1 in-progress module > P2 undeveloped demonstrated need > P3 preparation rec", () => {
  const baseTopics = [
    { id: "T1", topic: "DCF valuation", company: "JPMorgan", role: "IB Analyst", scores: [40], lastInterviewId: "iv1", applicationId: "app-jpm", updated_at: "2026-08-20" },
    { id: "T2", topic: "Statement linkage", company: "JPMorgan", role: "IB Analyst", scores: [55], lastInterviewId: "iv1", applicationId: "app-jpm", updated_at: "2026-08-22" },
  ];

  it("P1: an in-progress module wins, and demonstrated evidence is framed as interview performance", () => {
    const item = pickContinuePreparing({
      developmentModules: [{ id: "M1", topic_id: "T1", dimension: "technical", topic: "DCF valuation", source_interview_id: "iv1" }],
      moduleProgress: [{ module_id: "M1", attempts: 1, best_coverage: 0.4, flashcards_seen: 4, retry_answers: [], updated_at: "2026-08-25" }],
      classroomTopics: baseTopics, applications: [], candidateState: {},
    })[0];
    expect(item.kind).toBe("resume_module");
    expect(item.topicId).toBe("T1");
    expect(item.evidenceType).toBe("demonstrated");
    expect(item.sublabel).toMatch(/interview performance/i);
    expect(item.sublabel).not.toMatch(/weakness/i);
  });

  it("P1 drops a module already developed well (best_coverage >= bar) — falls through to P2", () => {
    const item = pickContinuePreparing({
      developmentModules: [{ id: "M1", topic_id: "T1", dimension: "technical", topic: "DCF valuation", source_interview_id: "iv1" }],
      moduleProgress: [{ module_id: "M1", attempts: 3, best_coverage: 0.95, flashcards_seen: 4, retry_answers: [], updated_at: "2026-08-25" }],
      classroomTopics: baseTopics, applications: [], candidateState: {},
    })[0];
    // T1 is developed; T2 (score 55, demonstrated, no module) is the P2 pick
    expect(item.kind).toBe("develop_demonstrated");
    expect(item.topicId).toBe("T2");
    expect(item.evidenceType).toBe("demonstrated");
    expect(item.sublabel).toMatch(/previous interview performance/i);
  });

  it("P2: weakest demonstrated undeveloped topic first; a topic at/above the score bar is skipped", () => {
    const topics = [
      { id: "A", topic: "Alpha", scores: [65], lastInterviewId: "iv", applicationId: "app", updated_at: "2026-08-20" },
      { id: "B", topic: "Beta", scores: [30], lastInterviewId: "iv", applicationId: "app", updated_at: "2026-08-19" },
      { id: "C", topic: "Gamma", scores: [88], lastInterviewId: "iv", applicationId: "app", updated_at: "2026-08-21" }, // >= 70 -> not urgent
    ];
    const item = pickContinuePreparing({ developmentModules: [], moduleProgress: [], classroomTopics: topics, applications: [], candidateState: {} })[0];
    expect(item.topicId).toBe("B"); // weakest
    const all = pickContinuePreparing({ developmentModules: [], moduleProgress: [], classroomTopics: topics, applications: [], candidateState: {} }, { limit: 5 });
    expect(all.map((x) => x.topicId)).not.toContain("C");
  });

  it("P3: a high-priority PREPARATION recommendation — labelled 'important to prepare', never a weakness, never demonstrated", () => {
    const app = {
      id: "app-jpm", company: "JPMorgan", role: "IB Analyst",
      applicationIntelligence: {
        technicalPriorities: [{ label: "accretion / dilution", dimension: "technical", importance: "high", confidence: "high", source: "job_description", evidence: "strong accretion/dilution modelling" }],
        behaviouralPriorities: [], motivationalPriorities: [], coverage: { technical: "strong" }, signals: [], companyThemes: [], roleThemes: [],
      },
    };
    const item = pickContinuePreparing({
      developmentModules: [], moduleProgress: [],
      classroomTopics: [],                     // nothing demonstrated
      applications: [app],
      candidateState: { competencies: {} },    // never tested -> gapKind "preparation"
    })[0];
    expect(item.kind).toBe("prepare_recommendation");
    expect(item.evidenceType).toBe("preparation");
    expect(item.applicationId).toBe("app-jpm");
    expect(item.recommendation.gapKind).toBe("preparation");
    expect(item.sublabel).toMatch(/important for your jpmorgan/i);
    expect(item.sublabel).toMatch(/not been tested/i);
    expect(item.sublabel).not.toMatch(/weakness/i);
  });

  it("returns [] when there is genuinely nothing to resume", () => {
    expect(pickContinuePreparing({ developmentModules: [], moduleProgress: [], classroomTopics: [], applications: [], candidateState: {} })).toEqual([]);
    expect(pickContinuePreparing(null)).toEqual([]);
    expect(pickContinuePreparing({})).toEqual([]);
  });

  it("a preparation-area module (no source interview) is framed as preparation, not a weakness", () => {
    const item = pickContinuePreparing({
      developmentModules: [{ id: "M9", topic_id: "P1", dimension: "motivational", topic: "Why this firm", source_interview_id: null }],
      moduleProgress: [{ module_id: "M9", attempts: 0, flashcards_seen: 2, retry_answers: [], best_coverage: 0, updated_at: "2026-08-25" }],
      classroomTopics: [{ id: "P1", topic: "Why this firm", company: "McKinsey", role: "Consultant", scores: [], lastInterviewId: null, applicationId: "app-mck" }],
      applications: [], candidateState: {},
    })[0];
    expect(item.evidenceType).toBe("preparation");
    expect(item.sublabel).toMatch(/important to prepare/i);
    expect(item.sublabel).not.toMatch(/weakness|interview performance/i);
  });
});

/* ============================== redo concept union ============================== */
describe("redoConceptUnion — de-duplicated concept set for redo marking", () => {
  it("flattens every learning item's expected_concepts and de-dupes by normalised label", () => {
    const mod = { learning_items: [
      { expected_concepts: [{ label: "Future cash flows", accepted_terms: ["cash flows"] }, { label: "Value" }] },
      { expected_concepts: [{ label: "future  cash  flows" }, { label: "Discount rate", accepted_terms: ["WACC"] }] },
    ] };
    const u = redoConceptUnion(mod);
    expect(u.map((c) => c.label)).toEqual(["Future cash flows", "Value", "Discount rate"]);
    expect(u[0].accepted_terms).toEqual(["cash flows"]);
  });
  it("never throws on junk", () => {
    expect(redoConceptUnion(null)).toEqual([]);
    expect(redoConceptUnion({ learning_items: "no" })).toEqual([]);
    expect(redoConceptUnion({ learning_items: [{}, { expected_concepts: [{}] }] })).toEqual([]);
  });
});
