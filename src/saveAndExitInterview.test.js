/* ================================================================== *
 * SAVE & EXIT — leave an active interview without losing progress
 * ------------------------------------------------------------------
 * The resumable-interview ENGINE (persistence + deterministic
 * reconstruction + the Dashboard / Application "Continue your
 * interview" surfaces + the resume_choice screen) already exists
 * (Phase 18 / 20) and is covered by resumeInterview.test.js /
 * resumableInterviews18.test.js / interviewStateIntegrity20.test.js.
 *
 * This file covers ONLY what "Save & exit" adds on top:
 *   - a dedicated, understated "Save & exit" control in every
 *     multi-question interview screen (adaptive, its Call-2 recovery
 *     sub-screen, and batch / Quick Practice) — never on Challenge Me
 *   - saveAndExitInterview(): persist the UNSUBMITTED draft onto the
 *     existing interviews.config jsonb (no migration), THEN — only on a
 *     successful write — refresh the resume surfaces, drop the in-memory
 *     interview, navigate to the dashboard and show the toast
 *   - a failed persist keeps the user in the interview with a retryable
 *     error and NO toast / NO navigation
 *   - the interview row is never flipped to 'completed' by this path
 *   - resume restores the draft (pure layer: resumeInterview.test.js)
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
function slice(a, b) {
  const s = SRC.indexOf(a);
  if (s === -1) throw new Error(`start marker not found: ${a}`);
  const e = SRC.indexOf(b, s + a.length);
  if (e === -1) throw new Error(`end marker not found: ${b}`);
  return SRC.slice(s, e);
}
function codeOnly(s) { return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); }

const DB_SAVE = slice("async function dbSaveInterviewProgress(interviewId, { draft }) {", "async function dbLoadResumableInterviews(");
const DB_LOAD_RESUMABLE = slice("async function dbLoadResumableInterviews(userId, apps) {", "async function dbInsertMemory(");
const SAVE_EXIT = slice("async function saveAndExitInterview() {", "\n  /* ---------------- PHASE 7: INTERVIEW INVITATION SCANNER");
const SAVE_EXIT_CODE = codeOnly(SAVE_EXIT);
const RESUME_FN = slice("async function resumeInterviewById(interviewId) {", "async function saveAndExitInterview() {");
const SAVE_EXIT_BTN = slice("function SaveExitButton(", "\n// Phase B — a small, reusable confirmation dialog");

/* ===================== no migration — reuses the existing config jsonb ===================== */
describe("Save & exit needs no schema change", () => {
  it("persists onto interviews.config (the Phase 18 vehicle), not a new column/table", () => {
    expect(DB_SAVE).toMatch(/\.from\("interviews"\)\.select\("config, status"\)/);
    expect(DB_SAVE).toMatch(/\.update\(\{ config: nextConfig \}\)\.eq\("id", interviewId\)/);
    // draft + a last_saved_at marker are merged onto the PREVIOUS config, nothing dropped
    expect(DB_SAVE).toMatch(/const prev = row\.config && typeof row\.config === "object" \? row\.config : \{\};/);
    expect(DB_SAVE).toMatch(/const nextConfig = \{ \.\.\.prev, draft: draft \|\| null, last_saved_at: /);
  });
  it("adds no new migration file for this feature", () => {
    const files = readdirSync(new URL("../supabase/migrations", import.meta.url)).filter((f) => f.endsWith(".sql"));
    expect(files.some((f) => /save|resume|draft|exit/i.test(f))).toBe(false);
  });
});

/* ===================== dbSaveInterviewProgress — durability boundary ===================== */
describe("dbSaveInterviewProgress", () => {
  it("THROWS on a failed read and on a failed write (never resolves silently)", () => {
    expect(DB_SAVE).toMatch(/if \(rErr \|\| !row\) throw new Error\(/);
    expect(DB_SAVE).toMatch(/if \(uErr\) throw new Error\(/);
  });
  it("never mutates interviews.status (a saved-and-exited interview stays in_progress)", () => {
    expect(codeOnly(DB_SAVE)).not.toMatch(/status:\s*["']completed["']/);
    expect(codeOnly(DB_SAVE)).not.toMatch(/\.update\(\{[^}]*status/);
  });
  it("is a no-op (no clobber) when the row is already completed", () => {
    expect(DB_SAVE).toMatch(/if \(row\.status === "completed"\) \{[\s\S]*?return row\.config \|\| null;/);
  });
});

/* ===================== dbLoadResumableInterviews — same metadata-only shape ===================== */
describe("dbLoadResumableInterviews rebuilds the resume surfaces with no transcript read", () => {
  it("mirrors the Phase 18 metadata reads (in_progress rows + two bulk id/number reads) and the shared summariser", () => {
    expect(DB_LOAD_RESUMABLE).toMatch(/\.eq\("status", "in_progress"\)/);
    expect(DB_LOAD_RESUMABLE).toMatch(/from\("interview_questions"\)\.select\("id, interview_id, question_number"\)\.in\("interview_id", ipIds\)/);
    expect(DB_LOAD_RESUMABLE).toMatch(/from\("answers"\)\.select\("question_id"\)\.in\("question_id", qIds\)/);
    expect(DB_LOAD_RESUMABLE).toMatch(/summariseResumable\(row, countsByIv\.get\(row\.id\) \|\| \{ total: 0, answered: 0 \}/);
    // no transcript / answer_text / evaluation / reconstruction here
    expect(DB_LOAD_RESUMABLE).not.toMatch(/answer_text|reconstructInterviewState|evaluations\(/);
  });
});

/* ===================== saveAndExitInterview — order of operations ===================== */
describe("saveAndExitInterview persists BEFORE it navigates", () => {
  it("awaits dbSaveInterviewProgress before the dashboard navigation and before the toast", () => {
    const idxSave = SAVE_EXIT_CODE.indexOf("await dbSaveInterviewProgress(interview.id, { draft })");
    const idxNav = SAVE_EXIT_CODE.indexOf('setScreen("dashboard")');
    const idxToast = SAVE_EXIT_CODE.indexOf("setEntitlementFlash(");
    expect(idxSave).toBeGreaterThan(-1);
    expect(idxNav).toBeGreaterThan(idxSave);
    expect(idxToast).toBeGreaterThan(idxSave);
  });
  it("the draft is the unsubmitted answer, keyed to the question the resume will land on", () => {
    expect(SAVE_EXIT).toMatch(/const isBatch = interview\.config\?\.pipeline === "independent_batch";/);
    expect(SAVE_EXIT).toMatch(/interview\.questions\?\.\[interview\.currentIndex\]\?\.dbId/);
    expect(SAVE_EXIT).toMatch(/interview\.currentQuestion\?\.dbId/);
    expect(SAVE_EXIT).toMatch(/const draft = draftText && landingQId\s*\n?\s*\? \{ questionDbId: landingQId, text: draftText, savedAt: /);
  });
  it("shows exactly the specified confirmation copy, only on success", () => {
    expect(SAVE_EXIT).toMatch(/setEntitlementFlash\("Interview progress saved — you can continue whenever you're ready\."\)/);
  });
  it("refreshes the resume surfaces so the Dashboard card is present on arrival (best-effort)", () => {
    expect(SAVE_EXIT).toMatch(/const refreshed = await dbLoadResumableInterviews\(user\.id, appsForSummary\);\s*\n?\s*setResumableInterviews\(refreshed\);/);
    // the refresh failing must not block the exit
    expect(SAVE_EXIT).toMatch(/try \{[\s\S]*?dbLoadResumableInterviews[\s\S]*?\} catch \(e\) \{ console\.error\("resumable refresh after save & exit failed:/);
  });
  it("clears the in-memory interview after a successful save", () => {
    expect(SAVE_EXIT).toMatch(/setInterview\(null\); setProfile\(null\); setReport\(null\); setAnswerInput\(""\);/);
  });
});

describe("saveAndExitInterview — failure keeps the user safely in the interview", () => {
  // the OUTER catch (there is also an inner best-effort catch around the refresh)
  const tryIdx = SAVE_EXIT.lastIndexOf("} catch (e) {");
  const catchBlock = SAVE_EXIT.slice(tryIdx, SAVE_EXIT.indexOf("} finally {", tryIdx));
  it("the catch path shows a retryable error and does NOT navigate or toast", () => {
    expect(catchBlock).toMatch(/setError\(/);
    expect(catchBlock).not.toMatch(/setScreen\(/);
    expect(catchBlock).not.toMatch(/setEntitlementFlash\(/);
    expect(catchBlock).not.toMatch(/setInterview\(null\)/);
  });
  it("is single-flighted (a double click cannot double-write / double-navigate)", () => {
    expect(SAVE_EXIT).toMatch(/if \(!interview \|\| !interview\.id \|\| !user \|\| saveExitRef\.current\) return;\s*\n?\s*saveExitRef\.current = true;/);
    expect(SAVE_EXIT).toMatch(/finally \{\s*\n?\s*saveExitRef\.current = false;/);
    expect(SRC).toMatch(/const saveExitRef = useRef\(false\);/);
  });
  it("never creates or completes an interview (no dbCreateInterview / dbCompleteInterview / status write)", () => {
    expect(SAVE_EXIT_CODE).not.toMatch(/dbCreateInterview|dbCompleteInterview|analyseAndPlan|generateQuestionBatch|status:\s*["']completed["']/);
  });
});

/* ===================== resume restores the draft ===================== */
describe("resumeInterviewById restores the saved draft", () => {
  it("sets the answer box from recon.draftAnswer (empty string when there is none)", () => {
    expect(RESUME_FN).toMatch(/setAnswerInput\(recon\.draftAnswer \|\| ""\)/);
  });
});

/* ===================== the control itself ===================== */
describe("the Save & exit control", () => {
  it("SaveExitButton renders the exact label with a back-arrow, and supports a dark (batch) theme", () => {
    expect(SAVE_EXIT_BTN).toMatch(/Save &amp; exit/);
    expect(SAVE_EXIT_BTN).toMatch(/<ArrowLeft size=\{13\}/);
    expect(SAVE_EXIT_BTN).toMatch(/dark = false/);
  });
  it("appears in the adaptive interview screen, its Call-2 recovery sub-screen, and the batch/Quick-Practice screen — each wired to guarded(saveAndExitInterview)", () => {
    const ADAPTIVE = slice('{screen === "interview" && interview && (() => {', '{screen === "evaluating" &&');
    const ASYNC = slice('{screen === "async_interview" && interview && interview.config?.pipeline === "independent_batch" && (() => {', "{screen === \"async_evaluating\"");
    // recovery sub-screen
    expect(ADAPTIVE).toMatch(/if \(interview\.pendingRecovery\) \{[\s\S]*?<SaveExitButton onClick=\{\(\) => guarded\(saveAndExitInterview\)\} \/>/);
    // main adaptive question screen
    expect(ADAPTIVE.lastIndexOf("<SaveExitButton onClick={() => guarded(saveAndExitInterview)} />")).toBeGreaterThan(ADAPTIVE.indexOf("if (interview.pendingRecovery)"));
    // batch / Quick Practice screen (dark)
    expect(ASYNC).toMatch(/<SaveExitButton dark onClick=\{\(\) => guarded\(saveAndExitInterview\)\} \/>/);
  });
  it("is NOT on Challenge Me (one question, completes on submit — no resumable multi-question state)", () => {
    const CHALLENGE = slice('{screen === "challenge_question" &&', '{screen === "challenge_feedback"');
    expect(CHALLENGE).not.toMatch(/SaveExitButton|saveAndExitInterview/);
  });
});
