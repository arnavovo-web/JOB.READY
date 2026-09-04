/* ================================================================== *
 * PHASE 18 — resumeInterview.js (behavioural, pure)
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { reconstructInterviewState, sortResumableInterviews, summariseResumable } from "./resumeInterview.js";

const PROFILE = {
  interview_profile: { company: "JPMorgan", role: "Analyst", competencies: [{ name: "Adaptability", basis: "explicit" }] },
  candidate_profile: { experience: ["x"], potential_probe_areas: [] },
  opening_question: { text: "Tell me about yourself", category: "motivation_fit", competency: "" },
};

// one normalized adaptive question row
const q = (n, answered, over = {}) => ({
  id: `q${n}`, question_number: n, question_text: `Q${n}`, category: "role_specific", competency: "c",
  anchor_source: null, metadata: {}, prep_seconds: null, answer_seconds: null,
  answered: !!answered,
  answer_text: answered ? `A${n}` : undefined,
  time_expired: false,
  answer_id: answered ? `a${n}` : undefined,
  evaluation: answered ? { relevance: 70, competency_demonstration: 65, strengths: ["s"], issues: [] } : null,
  ...over,
});

const adaptiveRow = (over = {}) => ({
  id: "iv-1", application_id: "app-1", status: "in_progress", stage: "first_round", format: "live_conversational",
  config: { pipeline: "adaptive_turn", stage: "first_round", format: "live_conversational", max_questions: 4, profile: PROFILE },
  methodology_distribution: { motivation_fit: 30, role_specific: 40, technical: 30 },
  started_at: "2026-08-29T10:00:00Z", created_at: "2026-08-29T09:59:00Z",
  ...over,
});
const meta = { company: "JPMorgan", role: "Analyst", stageLabel: "First Round", formatLabel: "Live conversational" };

describe("reconstructInterviewState — adaptive", () => {
  it("zero answers → resume at the first (opening) question, empty transcript", () => {
    const r = reconstructInterviewState({ interviewRow: adaptiveRow(), questions: [q(1, false)], meta });
    expect(r.resumable).toBe(true);
    expect(r.reason).toBe("ok");
    expect(r.screen).toBe("interview");
    expect(r.needsFinish).toBe(false);
    expect(r.answeredCount).toBe(0);
    expect(r.interview.transcript).toEqual([]);
    expect(r.interview.currentQuestion.dbId).toBe("q1");
    expect(r.interview.currentQuestion.questionNumber).toBe(1);
    expect(r.interview.maxQuestions).toBe(4);
    expect(r.interview.methodologyDistribution).toMatchObject({ role_specific: 40 });
    expect(r.profile).toBe(PROFILE);
  });

  it("partial answers → resume at the FIRST unanswered question; answered ones become the transcript", () => {
    const r = reconstructInterviewState({
      interviewRow: adaptiveRow(),
      questions: [q(1, true), q(2, true), q(3, true), q(4, false)],
      meta,
    });
    expect(r.answeredCount).toBe(3);
    expect(r.interview.transcript.map((t) => t.question.dbId)).toEqual(["q1", "q2", "q3"]);
    expect(r.interview.transcript[0]).toMatchObject({ answer: "A1", evaluation: { relevance: 70 } });
    expect(r.interview.currentQuestion.dbId).toBe("q4");
    expect(r.needsFinish).toBe(false);
  });

  it("questions arriving out of order are sorted by question_number before reconstruction", () => {
    const r = reconstructInterviewState({
      interviewRow: adaptiveRow(),
      questions: [q(3, false), q(1, true), q(2, true)],
      meta,
    });
    expect(r.interview.transcript.map((t) => t.question.dbId)).toEqual(["q1", "q2"]);
    expect(r.interview.currentQuestion.dbId).toBe("q3");
  });

  it("all target questions answered but status still in_progress → needsFinish, currentQuestion null", () => {
    const r = reconstructInterviewState({
      interviewRow: adaptiveRow({ config: { pipeline: "adaptive_turn", max_questions: 3, profile: PROFILE } }),
      questions: [q(1, true), q(2, true), q(3, true)],
      meta,
    });
    expect(r.resumable).toBe(true);
    expect(r.needsFinish).toBe(true);
    expect(r.interview.currentQuestion).toBeNull();
    expect(r.interview.transcript).toHaveLength(3);
  });

  it("Call-2 gap — last question answered, more due, no follow-up generated → pendingRecovery restored, no AI implied", () => {
    const withPending = q(2, true, { metadata: { turn_type: "probe", pending_next_decision: { decision: { turnType: "new_topic" }, genInput: { questionNumber: 3, category: "technical" } } } });
    const r = reconstructInterviewState({
      interviewRow: adaptiveRow(), // max_questions 4
      questions: [q(1, true), withPending],
      meta,
    });
    expect(r.resumable).toBe(true);
    expect(r.needsFinish).toBe(false);
    expect(r.interview.currentQuestion).toBeNull();
    expect(r.interview.pendingRecovery).toMatchObject({
      questionId: "q2",
      decision: { turnType: "new_topic" },
      genInput: { questionNumber: 3 },
    });
  });

  it("Call-2 gap with no persisted pending_next_decision → pendingRecovery carries just the questionId (recompute path handles it)", () => {
    const r = reconstructInterviewState({
      interviewRow: adaptiveRow(),
      questions: [q(1, true), q(2, true)],
      meta,
    });
    expect(r.interview.pendingRecovery).toEqual({ questionId: "q2", decision: null, genInput: null, targetedClaimId: null });
  });

  it("legacy adaptive row with no config.max_questions → falls back to the generated question count so it can still be finished", () => {
    const r = reconstructInterviewState({
      interviewRow: adaptiveRow({ config: { pipeline: "adaptive_turn", profile: PROFILE } }),
      questions: [q(1, true), q(2, true)],
      meta,
    });
    expect(r.resumable).toBe(true);
    expect(r.needsFinish).toBe(true); // 2 answered >= fallback max 2
    expect(r.interview.maxQuestions).toBe(2);
  });
});

describe("reconstructInterviewState — batch (independent_batch)", () => {
  const batchRow = (over = {}) => ({
    id: "iv-b", application_id: "app-1", status: "in_progress", stage: "recruiter_screen", format: "async_video",
    config: { pipeline: "independent_batch", profile: PROFILE },
    methodology_distribution: null, started_at: "2026-08-29T10:00:00Z", created_at: "2026-08-29T09:00:00Z",
    ...over,
  });
  const bq = (n, answered) => ({
    id: `bq${n}`, question_number: n, question_text: `BQ${n}`, category: "role_specific", competency: "c",
    anchor_source: "jd", metadata: { difficulty: "medium", is_technical: false },
    prep_seconds: 30, answer_seconds: 120,
    answered: !!answered, answer_text: answered ? `BA${n}` : undefined, answer_id: answered ? `ba${n}` : undefined, time_expired: false,
  });

  it("partial answers → currentIndex = number answered, questions + answers restored in order", () => {
    const r = reconstructInterviewState({ interviewRow: batchRow(), questions: [bq(1, true), bq(2, true), bq(3, false), bq(4, false), bq(5, false)], meta });
    expect(r.pipeline).toBe("independent_batch");
    expect(r.screen).toBe("async_interview");
    expect(r.interview.currentIndex).toBe(2);
    expect(r.interview.questions).toHaveLength(5);
    expect(r.interview.questions[0]).toMatchObject({ dbId: "bq1", prepSeconds: 30, answerSeconds: 120 });
    expect(r.interview.answers.map((a) => a.questionDbId)).toEqual(["bq1", "bq2"]);
    expect(r.interview.answers[0]).toMatchObject({ answerDbId: "ba1", text: "BA1" });
    expect(r.interview.cvBackground).toBeNull(); // caller fills
    expect(r.needsFinish).toBe(false);
  });

  it("every batch question answered but not completed → needsFinish true", () => {
    const r = reconstructInterviewState({ interviewRow: batchRow(), questions: [bq(1, true), bq(2, true)], meta });
    expect(r.interview.currentIndex).toBe(2);
    expect(r.needsFinish).toBe(true);
  });

  it("Save & exit draft is restored when it belongs to the batch question the resume lands on", () => {
    const row = batchRow({ config: { pipeline: "independent_batch", profile: PROFILE, draft: { questionDbId: "bq3", text: "half-typed batch answer" } } });
    const r = reconstructInterviewState({ interviewRow: row, questions: [bq(1, true), bq(2, true), bq(3, false), bq(4, false)], meta });
    expect(r.interview.currentIndex).toBe(2); // lands on bq3
    expect(r.draftAnswer).toBe("half-typed batch answer");
  });

  it("a batch draft attached to an already-answered question is dropped", () => {
    const row = batchRow({ config: { pipeline: "independent_batch", profile: PROFILE, draft: { questionDbId: "bq1", text: "stale" } } });
    const r = reconstructInterviewState({ interviewRow: row, questions: [bq(1, true), bq(2, true), bq(3, false)], meta });
    expect(r.draftAnswer).toBe("");
  });
});

describe("reconstructInterviewState — Save & exit draft (adaptive)", () => {
  it("restores the draft only for the exact question the resume lands on", () => {
    const row = adaptiveRow({ config: { pipeline: "adaptive_turn", max_questions: 4, profile: PROFILE, draft: { questionDbId: "q3", text: "my unsent answer" } } });
    const r = reconstructInterviewState({ interviewRow: row, questions: [q(1, true), q(2, true), q(3, false)], meta });
    expect(r.interview.currentQuestion.dbId).toBe("q3");
    expect(r.draftAnswer).toBe("my unsent answer");
  });

  it("drops a draft that was saved against an earlier (now-answered) question", () => {
    const row = adaptiveRow({ config: { pipeline: "adaptive_turn", max_questions: 4, profile: PROFILE, draft: { questionDbId: "q2", text: "stale draft" } } });
    const r = reconstructInterviewState({ interviewRow: row, questions: [q(1, true), q(2, true), q(3, false)], meta });
    expect(r.draftAnswer).toBe("");
  });

  it("no draft key → draftAnswer is the empty string, never undefined", () => {
    const r = reconstructInterviewState({ interviewRow: adaptiveRow(), questions: [q(1, false)], meta });
    expect(r.draftAnswer).toBe("");
  });

  it("a whitespace-only draft is not restored", () => {
    const row = adaptiveRow({ config: { pipeline: "adaptive_turn", max_questions: 4, profile: PROFILE, draft: { questionDbId: "q1", text: "   \n  " } } });
    const r = reconstructInterviewState({ interviewRow: row, questions: [q(1, false)], meta });
    expect(r.draftAnswer).toBe("");
  });

  it("needsFinish / not-resumable results still carry draftAnswer:'' (no question to type against)", () => {
    const finish = reconstructInterviewState({
      interviewRow: adaptiveRow({ config: { pipeline: "adaptive_turn", max_questions: 2, profile: PROFILE, draft: { questionDbId: "q2", text: "x" } } }),
      questions: [q(1, true), q(2, true)], meta,
    });
    expect(finish.needsFinish).toBe(true);
    expect(finish.draftAnswer).toBe("");
    const dead = reconstructInterviewState({ interviewRow: { id: "iv", status: "completed", config: {} }, questions: [], meta });
    expect(dead.draftAnswer).toBe("");
  });
});

describe("reconstructInterviewState — safety / not-resumable", () => {
  it("legacy row with no config.profile → not resumable (reason no_profile), no crash", () => {
    const r = reconstructInterviewState({
      interviewRow: { id: "iv-x", status: "in_progress", config: { pipeline: "adaptive_turn", question_count: 8 } },
      questions: [q(1, false)], meta,
    });
    expect(r.resumable).toBe(false);
    expect(r.reason).toBe("no_profile");
    expect(r.interview).toBeNull();
    expect(r.profile).toBeNull();
  });

  it("row with a profile but zero question rows → not resumable (no_questions)", () => {
    const r = reconstructInterviewState({ interviewRow: adaptiveRow(), questions: [], meta });
    expect(r.resumable).toBe(false);
    expect(r.reason).toBe("no_questions");
  });

  it("already completed row → not resumable (already_complete)", () => {
    const r = reconstructInterviewState({ interviewRow: adaptiveRow({ status: "completed" }), questions: [q(1, true)], meta });
    expect(r.resumable).toBe(false);
    expect(r.reason).toBe("already_complete");
  });

  it("garbage / null input never throws", () => {
    expect(() => reconstructInterviewState(null)).not.toThrow();
    expect(reconstructInterviewState(null).resumable).toBe(false);
    expect(reconstructInterviewState({}).reason).toBe("malformed");
    expect(reconstructInterviewState({ interviewRow: 5, questions: "nope" }).reason).toBe("malformed");
    expect(() => reconstructInterviewState({ interviewRow: adaptiveRow(), questions: [null, {}, { question_number: "x" }], meta })).not.toThrow();
  });

  it("duplicate/invalid answer data — a question flagged answered:false with a stray answer_text is treated as unanswered", () => {
    const r = reconstructInterviewState({
      interviewRow: adaptiveRow(),
      questions: [q(1, true), { ...q(2, false), answer_text: "leftover", answered: false }, q(3, false)],
      meta,
    });
    expect(r.answeredCount).toBe(1);
    expect(r.interview.currentQuestion.dbId).toBe("q2");
  });

  it("is offline — the source has no imports, no await, no fetch/DB/AI calls, no timers", () => {
    // strip the leading /* ... */ docstring (it deliberately names what the module does NOT do)
    const raw = require("node:fs").readFileSync(new URL("./resumeInterview.js", import.meta.url), "utf8");
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bimport\b|\bawait\b|\bfetch\s*\(|\.from\s*\(|functions\.invoke|callClaude|getSupabase|setTimeout|setInterval/);
  });
});

describe("sortResumableInterviews — deterministic, no scoring", () => {
  const mk = (id, interviewDate, createdAt) => ({ id, interviewDate, createdAt });
  const NOW = new Date("2026-09-01T12:00:00Z").getTime();

  it("future application interview date wins, nearest first; then newest created; id ASC as final tie-break", () => {
    const a = mk("a", "2026-09-10", "2026-08-01T00:00:00Z"); // future, +9d
    const b = mk("b", "2026-09-03", "2026-08-01T00:00:00Z"); // future, +2d
    const c = mk("c", null, "2026-08-20T00:00:00Z");         // no date, newer
    const d = mk("d", "2026-08-15", "2026-08-25T00:00:00Z"); // past date -> treated as "no date"
    const out = sortResumableInterviews([a, c, d, b], NOW).map((x) => x.id);
    expect(out.slice(0, 2)).toEqual(["b", "a"]);   // future dates, nearest first
    expect(out.slice(2)).toEqual(["d", "c"]);       // no/past date: newer createdAt first (d 08-25 > c 08-20)
  });

  it("identical inputs in any order produce the same ordering", () => {
    const list = [mk("z", null, "2026-08-10T00:00:00Z"), mk("a", null, "2026-08-10T00:00:00Z"), mk("m", null, "2026-08-11T00:00:00Z")];
    const f = sortResumableInterviews(list, NOW).map((x) => x.id);
    const r = sortResumableInterviews([...list].reverse(), NOW).map((x) => x.id);
    expect(f).toEqual(r);
    expect(f).toEqual(["m", "a", "z"]); // m newest; a<z on id tie-break
  });

  it("never throws on malformed input", () => {
    expect(() => sortResumableInterviews(null)).not.toThrow();
    expect(() => sortResumableInterviews([null, {}, { interviewDate: "x" }])).not.toThrow();
  });
});

describe("summariseResumable — lightweight card metadata, no transcript needed", () => {
  it("carries counts, company/role from the application, and hasProfile from config", () => {
    const s = summariseResumable(
      { id: "iv-1", application_id: "app-1", stage: "first_round", created_at: "2026-08-29T00:00:00Z", config: { pipeline: "adaptive_turn", profile: PROFILE } },
      { total: 10, answered: 3 },
      { company: "JPMorgan", role: "Analyst", interview_date: "2026-09-05" },
    );
    expect(s).toMatchObject({
      id: "iv-1", applicationId: "app-1", company: "JPMorgan", role: "Analyst",
      pipeline: "adaptive_turn", answeredCount: 3, totalQuestions: 10,
      interviewDate: "2026-09-05", hasProfile: true,
    });
  });
  it("a legacy row with no config.profile is summarised with hasProfile:false (surfaced but not resumable)", () => {
    const s = summariseResumable({ id: "iv-x", application_id: "app-2", created_at: "2026-08-20T00:00:00Z", config: { pipeline: "adaptive_turn" } }, { total: 5, answered: 2 }, { company: "Acme", role: "R" });
    expect(s.hasProfile).toBe(false);
    expect(s.answeredCount).toBe(2);
  });
});
