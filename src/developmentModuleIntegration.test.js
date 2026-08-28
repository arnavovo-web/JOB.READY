/* ================================================================== *
 * PHASE 14 — DEVELOPMENT MODULE WIRING (STRUCTURAL, App.jsx source)
 * ------------------------------------------------------------------
 * The invariant: AI creates the module knowledge ONCE. Everything after
 * — Learn, Flashcards, Quiz, marking, retakes, What Next — is deterministic
 * and makes NO further AI call. Also: reuse-before-generate, double-generate
 * guard, source-question retry linkage, and no scheduler interference.
 * Same source-inspection convention as reportUX.test.js.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function slice(startMarker, endMarker) {
  const s = SRC.indexOf(startMarker);
  if (s === -1) throw new Error(`marker not found: ${startMarker}`);
  const e = SRC.indexOf(endMarker, s + startMarker.length);
  if (e === -1) throw new Error(`end marker not found: ${endMarker}`);
  return SRC.slice(s, e);
}

const OPEN_FN = slice("async function openDevelopmentModule(topic)", "// ---- deterministic sub-activities");
const DETERMINISTIC = slice("// ---- deterministic sub-activities (NO AI calls below this line) ----", "function practiseThisWeakness(topic)");
const DEV_SCREEN = slice('{screen === "dev_module" && devModule && devTopic', "{/* ---------------- LESSON ---------------- */}");

/* ============================== ONE AI call, reuse first ============================== */
describe("openDevelopmentModule — generate once, then reuse", () => {
  it("checks for an existing module BEFORE any generation", () => {
    const getIdx = OPEN_FN.indexOf("dbGetDevelopmentModule(topic.id)");
    const callIdx = OPEN_FN.indexOf("callClaude(");
    expect(getIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(-1);
    expect(getIdx).toBeLessThan(callIdx); // reuse check comes first
    // the reuse branch returns before ever reaching callClaude
    expect(OPEN_FN).toMatch(/if \(existing\) \{[\s\S]*?setScreen\("dev_module"\);\s*return;\s*\}/);
  });

  it("makes exactly ONE callClaude, tagged requestType 'development_module', no web search", () => {
    const calls = OPEN_FN.match(/callClaude\(/g) || [];
    expect(calls.length).toBe(1);
    expect(OPEN_FN).toMatch(/callClaude\(system, userText, \d+, false, \{ requestType: "development_module"/);
  });

  it("guards against a double-generate race (devGenRef) and clears it in finally", () => {
    expect(OPEN_FN).toMatch(/if \(!topic \|\| !user \|\| devGenRef\.current\) return;/);
    expect(OPEN_FN).toMatch(/devGenRef\.current = true;/);
    expect(OPEN_FN).toMatch(/finally \{\s*devGenRef\.current = false;\s*\}/);
  });

  it("a validated module with zero learning items is treated as a failed generation (surfaced, not silent)", () => {
    expect(OPEN_FN).toMatch(/if \(!validated\.learning_items\.length\) throw new Error\(/);
  });

  it("persists via dbInsertDevelopmentModule and snapshots the source question / interview for retry", () => {
    expect(OPEN_FN).toMatch(/dbInsertDevelopmentModule\(topic\.id, user\.id, moduleFields\)/);
    expect(OPEN_FN).toMatch(/source_question: topic\.relatedQuestion/);
    expect(OPEN_FN).toMatch(/source_interview_id: topic\.lastInterviewId/);
  });

  it("Phase 15A: a failed persist does NOT fake an id:null module and does NOT auto-regenerate", () => {
    // on !saved: keep the generated content for a persist-only retry, return to Classroom
    expect(OPEN_FN).toMatch(/if \(!saved\) \{[\s\S]*?setPendingModuleSave\(\{ topicId: topic\.id[\s\S]*?setScreen\("classroom"\);\s*\n?\s*return;/);
    // the id:null fake-module fallback is gone
    expect(OPEN_FN).not.toMatch(/hydrateDevModuleRow\(saved \|\| \{/);
    expect(OPEN_FN).not.toMatch(/id: null, dimension/);
    // the retry path re-attempts the SAME fields — never callClaude
    const RETRY = SRC.slice(SRC.indexOf("async function retrySaveModule()"), SRC.indexOf("async function retrySaveModule()") + 900);
    expect(RETRY).toMatch(/dbInsertDevelopmentModule\(pendingModuleSave\.topicId, user\.id, pendingModuleSave\.fields\)/);
    expect(RETRY).not.toMatch(/callClaude/);
  });

  it("knowledge-layer grounding is read-only (findConceptsByText), technical dimension only", () => {
    expect(OPEN_FN).toMatch(/dimension === "technical" \? findConceptsByText\(topic\.topic/);
    // grounding must not call the scheduler's concept selector or stamp a turn
    expect(OPEN_FN).not.toMatch(/selectKnowledgeConcepts|scheduleNextCategory|stampQuestionFromDecision/);
  });
});

/* ============================== zero AI in every deterministic activity ============================== */
describe("deterministic sub-activities make NO AI call", () => {
  it("the whole deterministic block never calls callClaude", () => {
    expect(DETERMINISTIC).not.toMatch(/callClaude/);
  });
  it("flashcards / quiz start / quiz submit / retake / redo are all in the no-AI block", () => {
    for (const fn of ["function goToDevView", "function startWrittenQuiz", "async function saveFlashProgress", "async function submitWrittenAnswer", "async function saveRedoAnswer"]) {
      expect(DETERMINISTIC).toContain(fn);
    }
  });
  it("quiz marking uses the pure markWrittenQuiz helper, not an AI request", () => {
    expect(DETERMINISTIC).toMatch(/markWrittenQuiz\(quizDraft, item\?\.expected_concepts/);
    expect(SRC).toMatch(/import \{ markWrittenQuiz, coverageVerdict \} from "\.\/writtenQuiz"/);
  });
  it("retake reshuffles the persisted item pool — no regeneration", () => {
    const START_QUIZ = DETERMINISTIC.slice(DETERMINISTIC.indexOf("function startWrittenQuiz()"), DETERMINISTIC.indexOf("async function saveFlashProgress"));
    expect(START_QUIZ).toMatch(/learning_items[\s\S]*?Math\.random\(\)[\s\S]*?setDevView\("quiz"\)/);
    expect(START_QUIZ).not.toMatch(/dbInsertDevelopmentModule|callClaude|generate/i);
  });
  it("dev_module render block contains no callClaude", () => {
    expect(DEV_SCREEN).not.toMatch(/callClaude/);
  });
});

/* ============================== What Next hub + routes ============================== */
describe("What Next hub routes to all four activities", () => {
  it("renders the four options", () => {
    expect(DEV_SCREEN).toMatch(/What next\?/i);
    expect(DEV_SCREEN).toMatch(/Review learning material/);
    expect(DEV_SCREEN).toMatch(/Practise flashcards/);
    expect(DEV_SCREEN).toMatch(/Take another quiz/);
    expect(DEV_SCREEN).toMatch(/Try the interview question again/);
  });
  it("each option calls a deterministic view switch (goToDevView / startWrittenQuiz), never a generator", () => {
    const hub = DEV_SCREEN.slice(DEV_SCREEN.indexOf("const whatNext ="), DEV_SCREEN.indexOf("const whatNext =") + 900);
    expect(hub).toMatch(/goToDevView\("learn"\)/);
    expect(hub).toMatch(/goToDevView\("flashcards"\)/);
    expect(hub).toMatch(/startWrittenQuiz/);
    expect(hub).toMatch(/goToDevView\("redo"\)/);
    expect(hub).not.toMatch(/openDevelopmentModule/);
  });
});

/* ============================== quiz feedback model (no "wrong", not colour-only) ============================== */
describe("quiz review shows covered / still-to-include / review, never binary wrong", () => {
  it("uses the required feedback sections and 'Try again'", () => {
    expect(DEV_SCREEN).toMatch(/Your answer/);
    expect(DEV_SCREEN).toMatch(/Key points covered/);
    expect(DEV_SCREEN).toMatch(/Still to include/);
    expect(DEV_SCREEN).toMatch(/Review: /);
    expect(DEV_SCREEN).toMatch(/Try again/);
  });
  it("covered/missing carry a text glyph, not colour alone", () => {
    expect(DEV_SCREEN).toMatch(/✓/);
    expect(DEV_SCREEN).toMatch(/○/);
  });
  it("never renders the word 'wrong' / 'incorrect' in the dev module screen", () => {
    expect(DEV_SCREEN).not.toMatch(/\bwrong\b|\bincorrect\b/i);
  });
});

/* ============================== redo linkage + no scheduler interference ============================== */
describe("redo question stays connected to source; scheduler untouched", () => {
  it("redo shows the snapshotted source question and offers the existing full-interview path", () => {
    expect(DEV_SCREEN).toMatch(/devModule\.source_question \|\| devTopic\.relatedQuestion/);
    expect(DEV_SCREEN).toMatch(/practiseThisWeakness\(devTopic\)/);
  });
  it("saveRedoAnswer persists the retry answer with its source question + deterministic coverage, no AI", () => {
    const REDO = DETERMINISTIC.slice(DETERMINISTIC.indexOf("async function saveRedoAnswer()"), DETERMINISTIC.indexOf("async function retrySaveReport()"));
    // Phase 15A: marked deterministically via markWrittenQuiz over the module's own concept union
    expect(REDO).toMatch(/redoConceptUnion\(devModule\)/);
    expect(REDO).toMatch(/markWrittenQuiz\(redoDraft, concepts\)/);
    expect(REDO).toMatch(/retry_answers: \[\.\.\.prev, entry\]/);
    expect(REDO).toMatch(/source_question: devModule\.source_question \|\| devTopic\?\.relatedQuestion/);
    // no AI, no graded "overall_score"
    expect(REDO).not.toMatch(/callClaude|overall_score|interview_report/);
  });
  it("no Phase 14 code assigns a scheduler-owned field", () => {
    const all = OPEN_FN + DETERMINISTIC + DEV_SCREEN;
    expect(all).not.toMatch(/\.(turn_type|anchor_source|category)\s*=|["'](turn_type|anchor_source)["']\s*:/);
  });
  it("classroom_topics.scores is never written by a learning activity", () => {
    expect(DETERMINISTIC).not.toMatch(/dbUpsertClassroomTopic|\.scores\s*=|scores:/);
  });
});

/* ============================== entry points rewired, old lesson untouched ============================== */
describe("Classroom entry points route to the Development Module", () => {
  it("the learning-area card calls openDevelopmentModule directly", () => {
    expect(SRC).toMatch(/onClick=\{\(\) => guarded\(\(\) => openDevelopmentModule\(t\)\)\}/);
  });
  it("the Phase 13B recommendation enters the module system (reuse match, else materialise via 14.1)", () => {
    expect(SRC).toMatch(/match \? openDevelopmentModule\(match\) : startLearningFromRecommendation\(r, activeClassroomApp\)/);
  });
  it("the legacy openLesson function and lesson screen still exist (not deleted)", () => {
    expect(SRC).toMatch(/async function openLesson\(topic\)/);
    expect(SRC).toMatch(/\{screen === "lesson" && lesson && classroomTopic/);
  });
});
