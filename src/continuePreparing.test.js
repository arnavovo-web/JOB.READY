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

/* ============================== PHASE 15B — deterministic within-tier ranking ============================== */
const topic = (over) => ({ id: "t", topic: "DCF", company: "JPMorgan", role: "IB Analyst", scores: [40], lastInterviewId: "iv1", applicationId: "app-jpm", updated_at: "2026-08-20T00:00:00.000Z", ...over });
const mod = (over) => ({ id: "m", topic_id: "t", dimension: "technical", topic: "DCF", source_interview_id: "iv1", ...over });
const prog = (over) => ({ module_id: "m", attempts: 0, best_coverage: 0, flashcards_seen: 0, retry_answers: [], updated_at: "2026-08-20T00:00:00.000Z", ...over });
const runP1 = ({ modules, progress }) => pickContinuePreparing({ developmentModules: modules, moduleProgress: progress, classroomTopics: [], applications: [], candidateState: {} })[0];

describe("P1 — depth of progress ranks before recency", () => {
  it("A: 80% coverage / 1 attempt beats 10% coverage / 5 attempts, even when the latter is more recent", () => {
    const modules = [mod({ id: "m-lo", topic_id: "t-lo" }), mod({ id: "m-hi", topic_id: "t-hi" })];
    const progress = [
      prog({ module_id: "m-lo", best_coverage: 0.10, attempts: 5, updated_at: "2026-08-30T00:00:00.000Z" }), // more recent
      prog({ module_id: "m-hi", best_coverage: 0.80, attempts: 1, updated_at: "2026-08-20T00:00:00.000Z" }),
    ];
    const topics = [topic({ id: "t-lo" }), topic({ id: "t-hi" })];
    const winner = pickContinuePreparing({ developmentModules: modules, moduleProgress: progress, classroomTopics: topics, applications: [], candidateState: {} })[0];
    expect(winner.topicId).toBe("t-hi");
  });

  it("B: equal coverage -> more completed quiz attempts wins", () => {
    const winner = runP1({
      modules: [mod({ id: "m1", topic_id: "t1" }), mod({ id: "m2", topic_id: "t2" })],
      progress: [prog({ module_id: "m1", best_coverage: 0.5, attempts: 1 }), prog({ module_id: "m2", best_coverage: 0.5, attempts: 3 })],
    });
    expect(winner.topicId).toBe("t2");
  });

  it("C: equal coverage + attempts -> more flashcard progress wins", () => {
    const winner = runP1({
      modules: [mod({ id: "m1", topic_id: "t1" }), mod({ id: "m2", topic_id: "t2" })],
      progress: [
        prog({ module_id: "m1", best_coverage: 0.5, attempts: 2, flashcards_seen: 1 }),
        prog({ module_id: "m2", best_coverage: 0.5, attempts: 2, flashcards_seen: 4 }),
      ],
    });
    expect(winner.topicId).toBe("t2");
  });

  it("D: equal coverage + attempts + flashcards -> more redo practice wins", () => {
    const winner = runP1({
      modules: [mod({ id: "m1", topic_id: "t1" }), mod({ id: "m2", topic_id: "t2" })],
      progress: [
        prog({ module_id: "m1", best_coverage: 0.5, attempts: 2, flashcards_seen: 3, retry_answers: [{}] }),
        prog({ module_id: "m2", best_coverage: 0.5, attempts: 2, flashcards_seen: 3, retry_answers: [{}, {}, {}] }),
      ],
    });
    expect(winner.topicId).toBe("t2");
  });

  it("E: all progress fields equal -> newer updated_at wins", () => {
    const winner = runP1({
      modules: [mod({ id: "m1", topic_id: "t1" }), mod({ id: "m2", topic_id: "t2" })],
      progress: [
        prog({ module_id: "m1", best_coverage: 0.5, attempts: 2, flashcards_seen: 3, retry_answers: [{}], updated_at: "2026-08-20T00:00:00.000Z" }),
        prog({ module_id: "m2", best_coverage: 0.5, attempts: 2, flashcards_seen: 3, retry_answers: [{}], updated_at: "2026-08-29T00:00:00.000Z" }),
      ],
    });
    expect(winner.topicId).toBe("t2");
  });

  it("F: everything equal incl. timestamp -> stable module.id ASC decides, independent of array order", () => {
    const p = (id) => prog({ module_id: id, best_coverage: 0.5, attempts: 2, flashcards_seen: 3, retry_answers: [{}], updated_at: "2026-08-20T00:00:00.000Z" });
    const forward = pickContinuePreparing({
      developmentModules: [mod({ id: "m-bbb", topic_id: "t-bbb" }), mod({ id: "m-aaa", topic_id: "t-aaa" })],
      moduleProgress: [p("m-bbb"), p("m-aaa")], classroomTopics: [], applications: [], candidateState: {},
    })[0];
    const reversed = pickContinuePreparing({
      developmentModules: [mod({ id: "m-aaa", topic_id: "t-aaa" }), mod({ id: "m-bbb", topic_id: "t-bbb" })],
      moduleProgress: [p("m-aaa"), p("m-bbb")], classroomTopics: [], applications: [], candidateState: {},
    })[0];
    expect(forward.topicId).toBe("t-aaa"); // "m-aaa" < "m-bbb"
    expect(reversed.topicId).toBe("t-aaa"); // same regardless of input order
  });
});

describe("P2 — final tie-break is a stable topic id, not array order", () => {
  const t = (id, over) => topic({ id, scores: [45], updated_at: "2026-08-20T00:00:00.000Z", lastInterviewId: "iv", applicationId: "app", ...over });
  it("equal latest score + equal updated_at -> topic.id ASC decides, same in both array orders", () => {
    const forward = pickContinuePreparing({ developmentModules: [], moduleProgress: [], classroomTopics: [t("t-zzz"), t("t-aaa")], applications: [], candidateState: {} })[0];
    const reversed = pickContinuePreparing({ developmentModules: [], moduleProgress: [], classroomTopics: [t("t-aaa"), t("t-zzz")], applications: [], candidateState: {} })[0];
    expect(forward.topicId).toBe("t-aaa");
    expect(reversed.topicId).toBe("t-aaa");
  });
});

describe("tier short-circuit is preserved", () => {
  const p1State = {
    developmentModules: [mod({ id: "m1", topic_id: "t1" })],
    moduleProgress: [prog({ module_id: "m1", attempts: 1, best_coverage: 0.3 })],
    classroomTopics: [
      topic({ id: "t1" }),
      topic({ id: "t2", topic: "Something demonstrated", scores: [20], lastInterviewId: "ivX", applicationId: "app-jpm" }), // P2 candidate
    ],
    applications: [], candidateState: {},
  };
  it("P1 + P2 (+ would-be P3) -> always returns the P1 item", () => {
    const r = pickContinuePreparing(p1State)[0];
    expect(r.kind).toBe("resume_module");
    expect(r.topicId).toBe("t1");
  });
  it("no P1 + P2 present -> returns the P2 item", () => {
    const r = pickContinuePreparing({ ...p1State, developmentModules: [], moduleProgress: [] })[0];
    expect(r.kind).toBe("develop_demonstrated");
    expect(r.topicId).toBe("t2");
  });
});

describe("input array order never changes the result", () => {
  it("reversing every input array yields the identical pick", () => {
    const state = {
      developmentModules: [mod({ id: "m1", topic_id: "t1" }), mod({ id: "m2", topic_id: "t2" })],
      moduleProgress: [prog({ module_id: "m1", attempts: 1, best_coverage: 0.2 }), prog({ module_id: "m2", attempts: 3, best_coverage: 0.2 })],
      classroomTopics: [topic({ id: "t1" }), topic({ id: "t2" })],
      applications: [], candidateState: {},
    };
    const rev = {
      developmentModules: [...state.developmentModules].reverse(),
      moduleProgress: [...state.moduleProgress].reverse(),
      classroomTopics: [...state.classroomTopics].reverse(),
      applications: [], candidateState: {},
    };
    expect(pickContinuePreparing(state)).toEqual(pickContinuePreparing(rev));
  });
});
