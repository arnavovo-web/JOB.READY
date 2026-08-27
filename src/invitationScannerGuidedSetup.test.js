/* ================================================================== *
 * PHASE 12 — INVITATION EMAIL SCANNER & GUIDED SETUP: INTEGRATION TESTS
 * ------------------------------------------------------------------
 * EXECUTABLE where the pipe is a pure exported function
 * (validateInvitationExtraction -> resolveInvitationIdentity ->
 * buildCanonicalInterviewConfig -> Phase 11 gate); STRUCTURAL for the
 * App() closures (analyseInvitation / confirmInvitationAndBuild / the
 * review screen) — same convention invitationScanner.test.js established.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildQuestionGenerationPrompt, validateInvitationExtraction } from "./App.jsx";
import {
  resolveInvitationIdentity, deriveQuestionMixSignal, recommendedQuestionMixTypes,
  buildCanonicalInterviewConfig,
} from "./invitationScannerResolve.js";
import { isTechnicalMixEnabled } from "./questionMix.js";

const SOURCE = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
function fn(startMarker, endMarker) {
  const s = SOURCE.indexOf(startMarker);
  if (s === -1) throw new Error(`marker not found: ${startMarker}`);
  const e = SOURCE.indexOf(endMarker, s + startMarker.length);
  if (e === -1) throw new Error(`end marker not found: ${endMarker}`);
  return SOURCE.slice(s, e);
}
const ANALYSE_SRC = fn("async function analyseInvitation() {", "async function confirmInvitationAndBuild()");
const CONFIRM_SRC = fn("async function confirmInvitationAndBuild() {", "/* ---------------- STEP 1: JD + CV ANALYSIS");
const CHOOSE_SRC = fn("function chooseBuildMethod(method) {", "// Phase 4 (returning-user continuity)");
const REVIEW_SRC = fn('{screen === "invitation_review" && invitationDraft && (() => {', "{screen === \"analyzing\"");
const PROMPT_SRC = fn("export function buildInvitationExtractionPrompt(", "export function validateInvitationExtraction(");
const VALIDATE_SRC = fn("export function validateInvitationExtraction(", "invitationExtractionHasUsableSignal");

// helper: full pipe from a raw AI object to the canonical config the wizard receives.
// `rawExtraction` is exactly what the AI returned (before validateInvitationExtraction).
function pipe(rawExtraction, userMix /* { technical, behavioural, motivational } | undefined */) {
  const validated = validateInvitationExtraction(rawExtraction);
  const identity = resolveInvitationIdentity(validated);
  const mix = userMix || {
    technical: identity.questionMix.recommended.includes("technical"),
    behavioural: identity.questionMix.recommended.includes("behavioural"),
    motivational: identity.questionMix.recommended.includes("motivational"),
  };
  const canonical = buildCanonicalInterviewConfig({
    company: validated.company, role: validated.role, stage: validated.stage, questionMix: mix,
  });
  return { validated, identity, canonical };
}
// a raw AI object that resolves the three identity fields, so a Question-Mix-focused
// fixture still produces a canonical config.
function withIdentity(over = {}) {
  return {
    company: "JPMorgan", company_source: "explicit",
    role: "Investment Banking Summer Analyst", role_source: "explicit",
    stage: "first_round", stage_source: "explicit",
    ...over,
  };
}

/* ============================== TEST GROUP 1 — EXTRACTION VALIDATION ============================== */
describe("Group 1 — deterministic handling of extraction outputs", () => {
  it("EXPLICIT: 'first-round interview for the Investment Banking Summer Analyst position at JPMorgan' -> company/role/stage resolved", () => {
    const { identity } = pipe({
      company: "JPMorgan", company_source: "explicit", company_evidence: "position at JPMorgan",
      role: "Investment Banking Summer Analyst", role_source: "explicit", role_evidence: "the Investment Banking Summer Analyst position",
      stage: "first_round", stage_source: "explicit", stage_evidence: "a first-round interview",
    });
    expect(identity.company.resolved).toBe(true);
    expect(identity.role.resolved).toBe(true);
    expect(identity.stage.resolved).toBe(true);
    expect(identity.stage.value).toBe("first_round");
    expect(identity.allIdentityResolved).toBe(true);
  });

  it("UNKNOWN: 'We would like to invite you to an interview.' -> nothing fabricated, every field triggers follow-up", () => {
    const { identity } = pipe({}); // empty AI output
    expect(identity.company.resolved).toBe(false);
    expect(identity.role.resolved).toBe(false);
    expect(identity.stage.resolved).toBe(false);
    expect(identity.stage.value).toBe(""); // never a guessed stage
    expect(identity.questionMix.recommended).toEqual([]);
    expect(identity.missing.sort()).toEqual(["company", "questionMix", "role", "stage"]);
  });

  it("PARTIAL: 'The interview will cover technical knowledge and your previous experiences.' -> technical + behavioural identified, motivational stays UNRESOLVED (never false)", () => {
    const { identity } = pipe({
      question_mix: {
        technical: { status: "explicit", evidence: "cover technical knowledge" },
        behavioural: { status: "explicit", evidence: "your previous experiences" },
        motivational: { status: "unknown", evidence: "" },
      },
    });
    const s = identity.questionMix.signal;
    expect(s.technical).toBe("explicit");
    expect(s.behavioural).toBe("explicit");
    expect(s.motivational).toBe("unknown"); // NOT false
    expect(identity.questionMix.recommended.sort()).toEqual(["behavioural", "technical"]);
    expect(identity.questionMix.summary.notMentioned).toEqual(["motivational"]);
  });
});

/* ============================== TEST GROUP 2 — QUESTION MIX ============================== */
describe("Group 2 — Question Mix extraction & confirmation", () => {
  const mk = (t, b, m) => withIdentity({ question_mix: { technical: { status: t }, behavioural: { status: b }, motivational: { status: m } } });
  const sigOf = (raw) => deriveQuestionMixSignal(validateInvitationExtraction(raw));

  it("technical explicitly mentioned -> scanner recommends Technical", () => {
    expect(recommendedQuestionMixTypes(sigOf(mk("explicit", "unknown", "unknown")))).toEqual(["technical"]);
  });
  it("behavioural explicitly mentioned -> scanner recommends Behavioural", () => {
    expect(recommendedQuestionMixTypes(sigOf(mk("unknown", "explicit", "unknown")))).toEqual(["behavioural"]);
  });
  it("motivational explicitly mentioned -> scanner recommends Motivational", () => {
    expect(recommendedQuestionMixTypes(sigOf(mk("unknown", "unknown", "explicit")))).toEqual(["motivational"]);
  });
  it("an unmentioned type is NOT recommended (stays for the user to decide)", () => {
    expect(recommendedQuestionMixTypes(sigOf(mk("explicit", "unknown", "unknown")))).not.toContain("behavioural");
  });
  it("the final user confirmation produces a valid Phase 11 Question Mix", () => {
    const { canonical } = pipe(mk("explicit", "explicit", "unknown"), { technical: true, behavioural: true, motivational: false });
    expect(canonical.ok).toBe(true);
    expect(canonical.config.question_mix).toEqual(["technical", "behavioural"]);
  });
  it("the user can REMOVE a scanner-recommended type", () => {
    // email recommends technical; user unticks it
    const { canonical } = pipe(mk("explicit", "unknown", "unknown"), { technical: false, behavioural: true, motivational: false });
    expect(canonical.config.question_mix).toEqual(["behavioural"]);
  });
  it("the user can ADD an unmentioned type", () => {
    const { canonical } = pipe(mk("unknown", "unknown", "unknown"), { technical: true, behavioural: false, motivational: true });
    expect(canonical.config.question_mix).toEqual(["technical", "motivational"]);
  });
  it("if the user unticks everything, hand-off is blocked (>=1 required, Phase 11)", () => {
    const { canonical } = pipe(mk("explicit", "explicit", "explicit"), { technical: false, behavioural: false, motivational: false });
    expect(canonical.ok).toBe(false);
    expect(canonical.errors.questionMix).toBeTruthy();
  });
});

/* ============================== TEST GROUP 3 — FOLLOW-UP LOGIC ============================== */
describe("Group 3 — only missing / ambiguous fields are surfaced", () => {
  it("missing Company -> a text input is shown (review screen renders a company <input>)", () => {
    expect(REVIEW_SRC).toMatch(/id="invitation-company"/);
    expect(REVIEW_SRC).toMatch(/Which company is this interview with\?/);
  });
  it("missing Role -> a free-text input (never a fixed role list)", () => {
    expect(REVIEW_SRC).toMatch(/id="invitation-role"/);
    expect(REVIEW_SRC).toMatch(/What role are you interviewing for\?/);
    expect(REVIEW_SRC).not.toMatch(/ROLE_OPTIONS|predefinedRoles/);
  });
  it("missing / ambiguous Stage -> the four canonical stage options are shown as buttons", () => {
    expect(REVIEW_SRC).toMatch(/CANONICAL_STAGE_KEYS\.map\(\(key\) =>/);
    expect(REVIEW_SRC).toMatch(/aria-pressed=\{on\}/);
    expect(REVIEW_SRC).toMatch(/stageByKey\(key\)\.label/);
  });
  it("an unresolved stage shows an explanatory status message and does NOT persist a fake stage", () => {
    expect(REVIEW_SRC).toMatch(/!stageIsCanonical/);
    expect(REVIEW_SRC).toMatch(/didn't make the stage clear/);
    // continue is blocked until a concrete stage is chosen
    expect(REVIEW_SRC).toMatch(/disabled=\{!canonical\.ok\}/);
  });
  it("missing Question Mix -> all three Phase 11 options are shown (multi-select), >=1 required", () => {
    expect(REVIEW_SRC).toMatch(/QUESTION_MIX_OPTIONS\.map\(\(opt\) =>/);
    expect(REVIEW_SRC).toMatch(/role="checkbox" aria-checked=\{on\}/);
    expect(REVIEW_SRC).toMatch(/!normalizeQuestionMix\(scanMix\)/);
    expect(REVIEW_SRC).toMatch(/Choose at least one question type/);
  });
  it("PARTIAL Question Mix -> the review copy surfaces the uncertainty, never silently sets unknown=false", () => {
    expect(REVIEW_SRC).toMatch(/mixSummary\.notMentioned/);
    expect(REVIEW_SRC).toMatch(/wasn't|weren't/); // "X wasn't mentioned — choose whether to include it"
    // scanMix is seeded ONLY from recommendedQuestionMixTypes (explicit/inferred), never from unknown
    expect(ANALYSE_SRC).toMatch(/recommendedQuestionMixTypes\(deriveQuestionMixSignal\(extraction\)\)/);
  });
});

/* ============================== TEST GROUP 4 — FINAL CONFIGURATION ============================== */
describe("Group 4 — one canonical configuration, identical to manual setup", () => {
  it("scanner-confirmed values feed the SAME wizard state a manual setup uses (company/role/interviewStage/questionMix)", () => {
    expect(CONFIRM_SRC).toMatch(/setCompany\(cleanCompany\); setRole\(cleanRole\);/);
    expect(CONFIRM_SRC).toMatch(/setInterviewStage\(canonical\.config\.stage\)/);
    expect(CONFIRM_SRC).toMatch(/setQuestionMix\(\{/);
    expect(CONFIRM_SRC).toMatch(/setWizardStep\(4\); setScreen\("create"\)/);
  });
  it("there is NO scanner-specific interview object — the scanner never calls analyseAndPlan or an AI call itself", () => {
    expect(CONFIRM_SRC).not.toMatch(/analyseAndPlan\(|callClaude|new Interview|scannerInterview/);
  });
  it("buildCanonicalInterviewConfig output shape matches a manual config: { company, role, stage, question_mix:[...] }", () => {
    const r = buildCanonicalInterviewConfig({ company: "JPMorgan", role: "IB Analyst", stage: "technical", questionMix: { technical: true, behavioural: false, motivational: true } });
    expect(Object.keys(r.config).sort()).toEqual(["company", "question_mix", "role", "stage"]);
    expect(Array.isArray(r.config.question_mix)).toBe(true);
  });
});

/* ============================== TEST GROUP 5 — PHASE 11 INTEGRATION ============================== */
describe("Group 5 — the user's final Question Mix wins; the Knowledge Layer follows Phase 11", () => {
  const ibProfile = {
    interview_profile: {
      role: "Investment Banking Summer Analyst", division: "M&A Advisory", responsibilities: [],
      required_skills: ["DCF"], preferred_skills: [], competencies: [], technical_topics: ["DCF"],
      behavioural_topics: [], commercial_topics: [], question_mix: {}, jd_requirements: [],
    },
    candidate_profile: {},
  };
  const genInput = { category: "technical_functional", turnType: "normal", anchorSource: null, questionNumber: 1 };
  const runWith = (question_mix) => buildQuestionGenerationPrompt(
    genInput,
    { maxQuestions: 10, transcript: [], config: { pipeline: "adaptive_turn", stage: "technical", format: "technical", question_mix } },
    ibProfile, null, null, null,
  ).system;

  it("email recommends Technical, user REMOVES it -> config has no technical -> Knowledge Layer stays disabled", () => {
    const { canonical } = pipe(
      withIdentity({ question_mix: { technical: { status: "explicit" }, behavioural: { status: "explicit" }, motivational: { status: "unknown" } } }),
      { technical: false, behavioural: true, motivational: true },
    );
    expect(canonical.config.question_mix).not.toContain("technical");
    expect(isTechnicalMixEnabled(canonical.config.question_mix)).toBe(false);
    expect(runWith(canonical.config.question_mix)).not.toMatch(/KNOWLEDGE GUIDANCE/);
  });

  it("email does NOT mention technical, user ADDS it -> technical allowed -> Knowledge Layer may operate (Phase 11 gate)", () => {
    const { canonical } = pipe(
      withIdentity({ question_mix: { technical: { status: "unknown" }, behavioural: { status: "explicit" }, motivational: { status: "unknown" } } }),
      { technical: true, behavioural: true, motivational: false },
    );
    expect(canonical.config.question_mix).toContain("technical");
    expect(isTechnicalMixEnabled(canonical.config.question_mix)).toBe(true);
    expect(runWith(canonical.config.question_mix)).toMatch(/KNOWLEDGE GUIDANCE/);
  });

  it("even when the email EXPLICITLY mentions technical, the scanner only pre-ticks — the user's unticking still wins", () => {
    const raw = withIdentity({ question_mix: { technical: { status: "explicit", evidence: "technical interview" } } });
    expect(recommendedQuestionMixTypes(deriveQuestionMixSignal(validateInvitationExtraction(raw)))).toContain("technical"); // recommended
    const { canonical } = pipe(raw, { technical: false, behavioural: true, motivational: false }); // user removes
    expect(isTechnicalMixEnabled(canonical.config.question_mix)).toBe(false); // scanner did NOT lock it
  });
});

/* ============================== TEST GROUP 6 — NO HALLUCINATION ============================== */
describe("Group 6 — deterministic validation preserves 'unknown', never fabricates", () => {
  it("a minimal invitation keeps every question type at 'unknown' after validation + resolution", () => {
    const { identity } = pipe({ company: "", role: "", stage: "unknown" });
    expect(identity.questionMix.signal).toEqual({ technical: "unknown", behavioural: "unknown", motivational: "unknown" });
  });
  it("validateInvitationExtraction coerces an invalid mix status to 'unknown', never a false 'explicit'", () => {
    const v = validateInvitationExtraction({ question_mix: { technical: { status: "definitely" }, behavioural: { status: 5 }, motivational: {} } });
    expect(v.question_mix.technical.status).toBe("unknown");
    expect(v.question_mix.behavioural.status).toBe("unknown");
    expect(v.question_mix.motivational.status).toBe("unknown");
  });
  it("the AI prompt tells the model a bare invite is 'unknown' for ALL THREE types", () => {
    expect(PROMPT_SRC).toMatch(/we are pleased to invite you to an interview.*is "unknown" for ALL THREE/i);
    expect(PROMPT_SRC).toMatch(/do NOT assume a normal interview covers all types/i);
  });
});

/* ============================== TEST GROUP 7 — AI CALL COUNT / NO WEB SEARCH ============================== */
describe("Group 7 — exactly one scanner extraction call, no fan-out, no web search", () => {
  it("analyseInvitation makes exactly ONE callClaude, with useWebSearch=false, requestType 'invitation_extraction'", () => {
    expect((ANALYSE_SRC.match(/await callClaude\(/g) || []).length).toBe(1);
    expect(ANALYSE_SRC).toMatch(/callClaude\(system, userText, 1600, false, \{ requestType: "invitation_extraction" \}\)/);
  });
  it("there is NOT a separate call per field (no company/role/stage/mix extraction calls)", () => {
    for (const bad of ["company_extraction", "role_extraction", "stage_extraction", "question_mix_extraction", "mix_extraction"]) {
      expect(SOURCE).not.toMatch(new RegExp(bad));
    }
  });
  it("the guided follow-up (confirmInvitationAndBuild + review screen) makes NO AI call", () => {
    expect(CONFIRM_SRC).not.toMatch(/callClaude/);
    expect(REVIEW_SRC).not.toMatch(/callClaude/);
  });
  it("no web search anywhere in the scanner path", () => {
    expect(ANALYSE_SRC + CONFIRM_SRC + PROMPT_SRC).not.toMatch(/useWebSearch|WebSearch|web_search|fetch\(/);
    // the one call passes `false` for the useWebSearch positional arg
    expect(ANALYSE_SRC).toMatch(/callClaude\(system, userText, 1600, false,/);
  });
  it("invitationScannerResolve.js is entirely deterministic (no AI, no network)", () => {
    const mod = readFileSync(new URL("./invitationScannerResolve.js", import.meta.url), "utf8");
    expect(mod).not.toMatch(/callClaude|fetch\(|WebSearch|supabase/);
  });
});

/* ============================== TEST GROUP 8 — ERROR HANDLING ============================== */
describe("Group 8 — empty / failure / malformed / retry / switch-to-manual", () => {
  it("empty or too-short input never reaches the AI (client-side guard before callClaude)", () => {
    expect(ANALYSE_SRC).toMatch(/if \(!clean\) \{ setError[\s\S]*?return; \}/);
    expect(ANALYSE_SRC).toMatch(/clean\.length < INVITATION_MIN_CHARS/);
    // the guards appear textually before the callClaude line
    expect(ANALYSE_SRC.indexOf("INVITATION_MIN_CHARS")).toBeLessThan(ANALYSE_SRC.indexOf("await callClaude("));
  });
  it("extraction failure is recoverable — returns the user to the paste screen with their text intact", () => {
    expect(ANALYSE_SRC).toMatch(/catch \(e\) \{[\s\S]*setError\([\s\S]*setScreen\("invitation_paste"\)/);
  });
  it("malformed structured output is coerced defensively — validateInvitationExtraction never throws", () => {
    expect(() => validateInvitationExtraction(null)).not.toThrow();
    expect(() => validateInvitationExtraction("garbage")).not.toThrow();
    expect(() => validateInvitationExtraction({ question_mix: "nope" })).not.toThrow();
    const v = validateInvitationExtraction({ question_mix: "nope" });
    expect(v.question_mix.technical.status).toBe("unknown");
  });
  it("the user can switch to manual setup from BOTH the paste screen and the review screen", () => {
    const pasteScreen = fn('{screen === "invitation_paste" && (', '{screen === "invitation_analyzing"');
    expect(pasteScreen).toMatch(/Set up manually instead/);
    expect(pasteScreen).toMatch(/chooseBuildMethod\("jdcv"\)/);
    expect(REVIEW_SRC).toMatch(/Set up manually instead/);
    expect(REVIEW_SRC).toMatch(/chooseBuildMethod\("jdcv"\)/);
  });
});

/* ============================== STATE HYGIENE (STRUCTURAL) ============================== */
describe("switching flows never leaks stale scanner state into a fresh manual setup", () => {
  it("chooseBuildMethod('jdcv') clears the pasted email, the extraction, the original snapshot and BOTH question-mix states", () => {
    expect(CHOOSE_SRC).toMatch(/setInvitationText\(""\); setInvitationDraft\(null\); setInvitationOriginal\(null\);/);
    expect(CHOOSE_SRC).toMatch(/setScanMix\(\{ technical: false, behavioural: false, motivational: false \}\)/);
    expect(CHOOSE_SRC).toMatch(/setQuestionMix\(\{ technical: false, behavioural: false, motivational: false \}\)/);
  });
  it("startCreateFlow and resetForNewInterview also clear invitationOriginal + scanMix", () => {
    for (const marker of ["function startCreateFlow(focusWeak = false) {", "function resetForNewInterview() {"]) {
      const body = SOURCE.slice(SOURCE.indexOf(marker), SOURCE.indexOf(marker) + 900);
      expect(body, marker).toMatch(/setInvitationOriginal\(null\)/);
      expect(body, marker).toMatch(/setScanMix\(\{ technical: false, behavioural: false, motivational: false \}\)/);
    }
  });
  it("analyseInvitation snapshots the untouched extraction for honest provenance and pre-ticks only recommended types", () => {
    expect(ANALYSE_SRC).toMatch(/setInvitationOriginal\(extraction\)/);
    expect(ANALYSE_SRC).toMatch(/setScanMix\(\{\s*\n\s*technical: recommended\.includes\("technical"\)/);
  });
});

/* ============================== RAW EMAIL / PERSISTENCE (STRUCTURAL) ============================== */
describe("raw invitation email is never persisted", () => {
  it("the pasted email (invitationText) is React state only — never written to Supabase or an interview/application row", () => {
    // no db write takes invitationText
    expect(SOURCE).not.toMatch(/invitationText[^)]*\)\s*[,)]?\s*\/\/.*persist/i);
    expect(SOURCE).not.toMatch(/raw_email|raw_invitation|invitation_email_text|email_body/);
    // confirmInvitationAndBuild only persists company/role to the application, never the email or the full extraction
    expect(CONFIRM_SRC).not.toMatch(/invitationText|invitationDraft\)/);
  });
  it("no new DB column / DDL for the scanner — question_mix rides the existing config JSONB (Phase 11)", () => {
    expect(SOURCE).not.toMatch(/\balter table\b|\bcreate table\b|\badd column\b/i);
  });
});
