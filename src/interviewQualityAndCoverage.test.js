/* ================================================================== *
 * PHASE 5 — INTERVIEW QUALITY, REPORT/JD CONNECTION, COMPETENCY TRENDS,
 * CLAIM CONFIDENCE & ASSESSMENT CENTRE / APPLICATION INTEGRATION
 * ------------------------------------------------------------------
 * Covers this phase's product push:
 *   (1) Call 2 (question generation) previously had NO visibility into what had already been
 *       asked this interview beyond the single immediately-preceding probing turn — nothing
 *       stopped it from picking the same competency label repeatedly for a "normal" turn, or
 *       drifting into a near-duplicate question. Content generation now sees every prior
 *       question (category/competency/text) and is instructed to avoid repeating a competency
 *       or restating an earlier question. Purely additional context for the ONE thing Call 2
 *       already owns (text/competency/anchor for a normal turn) — category/turn_type/anchor
 *       for a probing turn remain entirely the scheduler's, untouched.
 *   (2) The report prompt is instructed to name a real correspondence between feedback and a
 *       specific JD requirement/responsibility/skill when one genuinely exists — using JD
 *       context that was already being passed into the SAME call, never a second AI call.
 *   (3) acAttempts.applicationId — persisted since Phase 2's assessment_attempts schema, never
 *       read back — now flows through so an Assessment Centre attempt genuinely tied to a real
 *       application shows up there, closing the "AC feels disconnected" gap.
 *   (4) Competency trends (Progress) and claim confidence (Progress) are both thin renders of
 *       fields candidateState.js already computes — never a new intelligence system.
 * STRUCTURAL checks use the same source-text-inspection convention as the existing test suite,
 * since App() is a React closure that can't be invoked directly; buildQuestionGenerationPrompt
 * is exported and pure, so its own behaviour is tested EXECUTABLE.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildQuestionGenerationPrompt } from "./App.jsx";

const SOURCE = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function extractFunctionSource(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found in App.jsx: ${startMarker}`);
  const end = SOURCE.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`end marker not found in App.jsx: ${endMarker}`);
  return SOURCE.slice(start, end);
}

/* ============================== Call 2 repetition avoidance (EXECUTABLE) ============================== */
describe("buildQuestionGenerationPrompt surfaces prior questions to avoid repetition (EXECUTABLE)", () => {
  const interviewWithHistory = {
    maxQuestions: 10,
    transcript: [
      { question: { category: "behavioural_competency", competency: "leadership", text: "Tell me about a time you led a team through a difficult project." }, answer: "...", evaluation: {} },
      { question: { category: "motivation_fit", competency: "", text: "Why this role?" }, answer: "...", evaluation: {} },
    ],
  };
  const genInputNormal = { category: "behavioural_competency", turnType: "normal", anchorSource: null, questionNumber: 3 };

  it("lists every prior question (category / competency: text) when the interview has a transcript", () => {
    const { userText } = buildQuestionGenerationPrompt(genInputNormal, interviewWithHistory, {}, null, null);
    expect(userText).toMatch(/behavioural_competency \/ leadership: "Tell me about a time you led a team/);
    expect(userText).toMatch(/motivation_fit \/ general: "Why this role\?"/);
  });

  it("instructs the model not to reuse a competency or restate an earlier question", () => {
    const { userText } = buildQuestionGenerationPrompt(genInputNormal, interviewWithHistory, {}, null, null);
    expect(userText).toMatch(/do not reuse a competency already covered/);
    expect(userText).toMatch(/never restate or closely rephrase an earlier question/);
  });

  it("omits the prior-questions context entirely for a fresh interview with no transcript yet (no false claim of history that doesn't exist)", () => {
    const freshInterview = { maxQuestions: 10, transcript: [] };
    const { userText } = buildQuestionGenerationPrompt(genInputNormal, freshInterview, {}, null, null);
    expect(userText).not.toMatch(/Questions already asked/);
  });

  it("works identically (no throw) when transcript is missing entirely — legacy/malformed interview object", () => {
    expect(() => buildQuestionGenerationPrompt(genInputNormal, {}, {}, null, null)).not.toThrow();
    expect(() => buildQuestionGenerationPrompt(genInputNormal, undefined, {}, null, null)).not.toThrow();
  });

  it("still applies for a probing turn — never restating an earlier question matters regardless of turn type", () => {
    const genInputProbing = { category: "behavioural_competency", turnType: "follow_up", anchorSource: "previous_answer", questionNumber: 3, previousQuestionText: "x", previousAnswer: "y" };
    const { userText } = buildQuestionGenerationPrompt(genInputProbing, interviewWithHistory, {}, null, null);
    expect(userText).toMatch(/Questions already asked this interview/);
  });
});

describe("submitAnswer feeds Call 2 the up-to-date transcript, not the stale pre-answer one (STRUCTURAL — regression)", () => {
  it("passes { ...interview, transcript: newTranscript } into generateAndPersistNextQuestion, not the bare stale `interview`", () => {
    const SRC = extractFunctionSource("// ---- CALL 2: question generation only", "} catch (genErr) {");
    expect(SRC).toMatch(/generateAndPersistNextQuestion\(\{ \.\.\.interview, transcript: newTranscript \}, profile,/);
  });
});

/* ============================== report / JD connection (STRUCTURAL) ============================== */
describe("the final report is instructed to connect feedback to the specific job, never a fabricated one (STRUCTURAL)", () => {
  const FINISH_SRC = extractFunctionSource("async function finishInterview(finalInterview) {", "const userText = `Company:");

  it("instructs naming a real correspondence to a specific responsibility/skill/jd_requirement", () => {
    expect(FINISH_SRC).toMatch(/genuinely traces back to something specific in the interview profile/);
  });

  it("explicitly forbids forcing a connection that isn't really there — never an unsupported conclusion", () => {
    expect(FINISH_SRC).toMatch(/never force a connection that isn't really there/);
  });

  it("this reuses interview_profile context ALREADY being sent to this SAME callClaude call — no second AI call introduced", () => {
    const FULL_FINISH_SRC = extractFunctionSource("async function finishInterview(finalInterview) {", "async function submitAsyncAnswer");
    // Exactly one callClaude call in this function, and its own userText already carries interview_profile.
    const callClaudeCount = (FULL_FINISH_SRC.match(/await callClaude\(/g) || []).length;
    expect(callClaudeCount).toBe(1);
    expect(FULL_FINISH_SRC).toMatch(/Interview profile: \$\{JSON\.stringify\(profile\.interview_profile\)\}/);
  });
});

/* ============================== Assessment Centre / application integration (STRUCTURAL) ============================== */
describe("acAttempts carries applicationId through, closing the AC-feels-disconnected gap (STRUCTURAL)", () => {
  const LOAD_SRC = extractFunctionSource("async function loadFullUserState(userId) {", "async function dbCreateApplication");

  it("loadFullUserState maps application_id onto acAttempts, not just scenario/submission/result", () => {
    expect(LOAD_SRC).toMatch(/applicationId: a\.application_id \|\| null/);
  });

  it("submitAcResponse's in-memory attempt carries the SAME applicationId value the DB insert used (acAppMatches), not a fresh/different computation", () => {
    const SUBMIT_SRC = extractFunctionSource("async function submitAcResponse() {", "/* ---------------- DERIVED VALUES");
    expect(SUBMIT_SRC).toMatch(/const attempt = \{ id: savedAttempt\?\.id \|\| \("local_" \+ Date\.now\(\)\), applicationId: acAppMatches \? applicationId : null,/);
  });

  it("applicationsWithInterviews groups matching AC attempts under their application", () => {
    const DERIVED_SRC = extractFunctionSource("const applicationsWithInterviews = applications", "let globalCandidateState");
    expect(DERIVED_SRC).toMatch(/acAttempts\.filter\(\(a\) => a\.applicationId === app\.id\)/);
  });

  it("Dashboard shows an Assessment Centre badge on an application card only when it actually has AC attempts", () => {
    const DASHBOARD_SRC = extractFunctionSource('screen === "dashboard" && user && (', 'PHASE 16A — APPLICATIONS PILLAR');
    expect(DASHBOARD_SRC).toMatch(/\{app\.acAttempts\.length > 0 && <Pill/);
  });
});

/* ============================== Progress: competency trends (STRUCTURAL) ============================== */
describe("Competency trends panel is a thin render of candidateState.js's own trend field (STRUCTURAL)", () => {
  const PROGRESS_SRC = extractFunctionSource('screen === "progress" && (', '{/* ---------------- CLASSROOM DASHBOARD');

  it("reads globalCandidateState.competencies directly, never re-deriving a trend itself", () => {
    expect(PROGRESS_SRC).toMatch(/Object\.entries\(globalCandidateState\?\.competencies \|\| \{\}\)/);
  });

  it("only ever displays the four real trend values candidateState.js can produce, never insufficient_data as if it were a real trend", () => {
    const idx = PROGRESS_SRC.indexOf("const TREND_META = {");
    const block = PROGRESS_SRC.slice(idx, PROGRESS_SRC.indexOf("};", idx));
    expect(block).toMatch(/declining:/);
    expect(block).toMatch(/inconsistent:/);
    expect(block).toMatch(/stable:/);
    expect(block).toMatch(/improving:/);
    expect(block).not.toMatch(/insufficient_data/);
  });

  it("is gated on having at least one completed interview, same as the other deterministic Progress sections", () => {
    // The FIRST "Competency trends" occurrence is the section's own explanatory comment, which
    // sits ABOVE the gate — search from the JSX heading instead. Phase 28 renders the heading
    // through <SectionHeading>, so match the closing tag loosely (</span> now, was </div>).
    const idx = PROGRESS_SRC.indexOf(">Competency trends</");
    expect(idx).toBeGreaterThan(-1);
    const nearby = PROGRESS_SRC.slice(Math.max(0, idx - 1500), idx);
    expect(nearby).toMatch(/\{interviewList\.length > 0 && \(\(\) => \{/);
  });
});

describe("claim confidence is shown next to claim status, only once a claim actually has evidence (STRUCTURAL)", () => {
  const PROGRESS_SRC = extractFunctionSource('screen === "progress" && (', '{/* ---------------- CLASSROOM DASHBOARD');

  it("renders confidence + test count, gated on evidence_count > 0", () => {
    expect(PROGRESS_SRC).toMatch(/c\.evidence_count > 0 &&/);
    expect(PROGRESS_SRC).toMatch(/\{c\.confidence\} confidence/);
    expect(PROGRESS_SRC).toMatch(/\{c\.evidence_count\} test/);
  });
});
