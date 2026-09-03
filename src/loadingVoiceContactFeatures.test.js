/* ================================================================== *
 * FEATURES: Classroom loading copy · voice interview answers · Contact Us
 * ------------------------------------------------------------------
 * Source-inspection guards (node env, no DOM — same idiom as
 * referenceCodeAndInterviewLoadingCopy.test.js / phaseBEngagement.test.js).
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const slice = (a, b) => {
  const s = SRC.indexOf(a);
  const e = SRC.indexOf(b, s + a.length);
  if (s === -1 || e === -1) throw new Error(`markers not found: ${a} .. ${b}`);
  return SRC.slice(s, e);
};

/* ================================================================== *
 * FEATURE 1 — Classroom resource loading screen
 * ================================================================== */
describe("Feature 1 — Classroom learning-resource loading copy", () => {
  const NOTE = slice("const CLASSROOM_RESOURCE_LOADING_NOTE = {", "};");

  it("defines the reassurance copy once, with the required primary + supporting meaning", () => {
    expect(NOTE).toContain('small: "This may take a minute…"');
    expect(NOTE).toMatch(/main: "We're creating personalised learning resources to help you ace this interview\."/);
  });

  it("shows it on BOTH Classroom resource generation screens — the lesson AND the development module", () => {
    expect(SRC).toMatch(/screen === "classroom_generating" && <LoadingScreen[^>]*note=\{CLASSROOM_RESOURCE_LOADING_NOTE\}/);
    expect(SRC).toMatch(/screen === "dev_module_generating" && <LoadingScreen[^>]*note=\{CLASSROOM_RESOURCE_LOADING_NOTE\}/);
  });

  it("does NOT put a fake progress percentage, countdown or time estimate anywhere in LoadingScreen", () => {
    const LS = slice("function LoadingScreen({ messages, progress, note }) {", '/* PHASE 36 — "HOW IT WORKS"');
    expect(LS).not.toMatch(/countdown|ETA|% complete|seconds remaining|estimated time/i);
    // still exactly one interval (the pre-existing legacy message rotation)
    expect((LS.match(/setInterval\(/g) || []).length).toBe(1);
  });

  it("keeps the existing animation: the gradient spinner + (staged) real step checklist are untouched", () => {
    const LS = slice("function LoadingScreen({ messages, progress, note }) {", '/* PHASE 36 — "HOW IT WORKS"');
    expect(LS).toMatch(/Loader2 className="animate-spin"/);
    expect(LS).toMatch(/progress\.steps\.map\(/);
    expect(LS).toMatch(/const done = i < stage, active = i === stage/);
  });

  it("renders `note` in the legacy message mode and as a staged-mode fallback (never double)", () => {
    const LS = slice("function LoadingScreen({ messages, progress, note }) {", '/* PHASE 36 — "HOW IT WORKS"');
    expect(LS).toMatch(/\{!progress\.note && note && \(/); // staged fallback, only when the progress object didn't set its own
    expect(LS).toMatch(/\{note && \(/);                    // legacy-mode note block
  });
});

/* ================================================================== *
 * FEATURE 2 — Speech-to-text for interview answers
 * ================================================================== */
describe("Feature 2 — voice input hook + control", () => {
  const HOOK = slice("function useSpeechToText() {", "\n/* Compact mic control");
  const CONTROL = slice("function VoiceAnswerControl({ speech, onFinalChunk, dark = false }) {", "\nfunction Card(");

  it("uses the browser's native Web Speech API via feature detection of BOTH names (no paid API, no upload)", () => {
    // detection lives in src/speech.js and is imported here
    expect(SRC).toMatch(/from "\.\/speech"/);
    const speechMod = readFileSync(new URL("./speech.js", import.meta.url), "utf8");
    expect(speechMod).toMatch(/w\.SpeechRecognition \|\| w\.webkitSpeechRecognition/);
    // no third-party transcription / upload
    expect(HOOK).not.toMatch(/deepseek|openai|whisper|fetch\(|XMLHttpRequest|FormData|uploadBytes/i);
  });

  it("sets the recognition language to en-GB and turns on interim results for a live preview", () => {
    expect(HOOK).toMatch(/rec\.lang = SPEECH_LANG/);
    expect(HOOK).toMatch(/rec\.interimResults = true/);
    expect(HOOK).toMatch(/rec\.continuous = true/);
  });

  it("commits only FINAL chunks to answer state (interim shown separately, never written) — no double count", () => {
    expect(HOOK).toMatch(/if \(final && onFinalRef\.current\) onFinalRef\.current\(final\)/);
    expect(HOOK).toMatch(/setInterim\(iv\)/);
    // the append helper is the pure, tested one — never a raw overwrite
    expect(SRC).toMatch(/setAnswerInput\(\(prev\) => appendSpokenChunk\(prev, chunk\)\)/);
    expect(SRC).toMatch(/setChallengeAnswerInput\(\(prev\) => appendSpokenChunk\(prev, chunk\)\)/);
  });

  it("recovers cleanly from every ending: onerror / onend / start() throw all clear `listening`", () => {
    expect(HOOK).toMatch(/rec\.onerror = \(e\) => \{[\s\S]*setListening\(false\)/);
    expect(HOOK).toMatch(/rec\.onend = \(\) => \{[\s\S]*setListening\(false\)/);
    expect(HOOK).toMatch(/catch \{\s*\/\/[^\n]*\n\s*teardown\(true\);\s*setError/);
    // an unsupported browser is a message, never a stuck state
    expect(HOOK).toMatch(/if \(!supported\) \{[\s\S]*VOICE_UNSUPPORTED_MESSAGE/);
  });

  it("cleans up on unmount AND whenever the answering context changes (new question / leaving the screen)", () => {
    expect(HOOK).toMatch(/useEffect\(\(\) => \(\) => teardown\(true\), \[teardown\]\)/);
    const KEY = slice("const voiceAnswerContextKey = [", "].join(\"|\");");
    expect(KEY).toMatch(/screen/);
    expect(KEY).toMatch(/interview\?\.currentQuestion\?\.dbId/);
    expect(KEY).toMatch(/challenge\?\.questionDbId/);
    expect(SRC).toMatch(/useEffect\(\(\) => \{\s*speech\.stop\(\);\s*speech\.reset\(\);[\s\S]*\}, \[voiceAnswerContextKey\]\)/);
  });

  it("also stops recognition the instant an answer is submitted, on all three surfaces", () => {
    for (const fn of ["submitAnswer", "submitAsyncAnswer", "submitChallengeAnswer"]) {
      const body = slice(`async function ${fn}(`, "\n  }\n");
      expect(body, `${fn} must call speech.stop()`).toMatch(/speech\.stop\(\);/);
    }
  });

  it("the control has accessible labels, an aria-pressed toggle, and a non-colour-only status", () => {
    expect(CONTROL).toMatch(/aria-label=\{listening \? "Stop voice input" : "Speak your answer"\}/);
    expect(CONTROL).toMatch(/aria-pressed=\{listening\}/);
    expect(CONTROL).toMatch(/role="status" aria-live="polite"/);
    // recording state is conveyed by TEXT ("Listening…") + a dot, not colour alone
    expect(CONTROL).toMatch(/Listening…/);
    expect(CONTROL).toMatch(/<Mic size=\{13\} aria-hidden="true" \/> Speak your answer/);
  });

  it("unsupported browsers get a clear, non-blocking message instead of the button — typing still works", () => {
    expect(CONTROL).toMatch(/if \(!speech\.supported\) \{[\s\S]*VOICE_UNSUPPORTED_MESSAGE/);
    // the answer <textarea>s are never disabled by any of this
    expect(SRC).not.toMatch(/<textarea aria-label="Your answer"[^>]*disabled/);
  });

  it("is wired into all three interview-answer surfaces (adaptive, async/dark, Challenge Me)", () => {
    expect((SRC.match(/<VoiceAnswerControl speech=\{speech\}/g) || []).length).toBe(3);
    expect(SRC).toMatch(/<VoiceAnswerControl speech=\{speech\} dark onFinalChunk=/); // the async dark panel
    expect(SRC).not.toMatch(/Voice — coming soon/); // the old placeholder is gone
  });
});

/* ================================================================== *
 * FEATURE 3 — Contact Us / feedback
 * ================================================================== */
describe("Feature 3 — Contact Us dialog + nav entry + sink", () => {
  const DIALOG = slice("function ContactDialog({ user, onClose, onSubmit }) {", "\n/* ==");
  const SUBMIT = slice("async function dbSubmitContactMessage(", "\n}\n");

  it("adds a 'Contact Us' item to the shared NavBar on BOTH desktop and mobile, keyboard-reachable", () => {
    expect(SRC).toMatch(/function NavBar\(\{ screen, setScreen, user, classroomNeedsWorkCount, onSignOut, onContact \}\)/);
    // rendered in both <nav> blocks (desktop + mobile) as a real <button> via LinkBtn
    expect((SRC.match(/\{onContact && \(/g) || []).length).toBe(2);
    expect((SRC.match(/<LinkBtn onClick=\{onContact\}/g) || []).length).toBe(2);
    expect((SRC.match(/>\s*Contact Us\s*<\/LinkBtn>/g) || []).length).toBe(2);
    // shown regardless of auth state (App passes onContact whenever the nav is shown)
    expect(SRC).toMatch(/<NavBar [\s\S]*?onContact=\{\(\) => setContactOpen\(true\)\} \/>/);
    expect(SRC).toMatch(/\{showNav && <NavBar /); // the single shared header, both public + authed
  });

  it("opens a portalled modal (not a new route) reusing the ConfirmDialog/FreeUnlockDialog pattern", () => {
    expect(SRC).toMatch(/\{contactOpen && \(\s*<ContactDialog user=\{user\} onClose=\{\(\) => setContactOpen\(false\)\} onSubmit=\{dbSubmitContactMessage\} \/>/);
    expect(DIALOG).toMatch(/return createPortal\(/);
    expect(DIALOG).toMatch(/role="dialog" aria-modal="true"/);
    expect(DIALOG).toMatch(/e\.key === "Escape"/); // Escape closes
  });

  it("has the required heading + supporting copy and the Name / Email / Message fields", () => {
    expect(DIALOG).toContain("How can we help?");
    expect(DIALOG).toContain("Have feedback, a question, or a query? We'd love to hear from you.");
    expect(DIALOG).toContain("Tell us about your feedback, question, or query...");
    expect(DIALOG).toMatch(/htmlFor="jr-contact-name"[\s\S]{0,160}\(optional\)/);
    expect(DIALOG).toMatch(/id="jr-contact-email"/);
    expect(DIALOG).toMatch(/id="jr-contact-message"/);
  });

  it("pre-fills name + email for a signed-in user without forcing it", () => {
    expect(DIALOG).toMatch(/user \? \[user\.first_name, user\.last_name\]\.filter\(Boolean\)\.join\(" "\) : ""/);
    expect(DIALOG).toMatch(/useState\(user\?\.email \|\| ""\)/);
  });

  it("validates: message required, email plausible — and prevents a double submit while in flight", () => {
    expect(DIALOG).toMatch(/const messageOk = message\.trim\(\)\.length >= 5/);
    expect(DIALOG).toMatch(/const emailOk = isPlausibleEmail\(email\)/);
    expect(DIALOG).toMatch(/if \(busyRef\.current\) return;/);
    expect(DIALOG).toMatch(/setStatus\("sending"\)/);
  });

  it("only claims success after the write actually succeeds; a failure shows an honest error", () => {
    expect(DIALOG).toMatch(/await onSubmit\(\{[\s\S]*setStatus\("sent"\)/);
    expect(DIALOG).toMatch(/catch \(err\) \{\s*setStatus\("error"\)/);
    expect(DIALOG).toContain("Thanks for getting in touch! We'll get back to you as soon as we can.");
    // the sink throws on error so the dialog can't silently pretend
    expect(SUBMIT).toMatch(/if \(error\) throw new Error/);
  });

  it("submits to the cheapest sink — a direct Supabase insert into contact_messages, no Edge Function / SaaS", () => {
    expect(SUBMIT).toMatch(/supabase\.from\("contact_messages"\)\.insert\(/);
    expect(SUBMIT).not.toMatch(/functions\.invoke|fetch\(|stripe|sendgrid|mailgun|resend/i);
    // logged-out visitors supported: user_id resolved from the session, null when absent
    expect(SUBMIT).toMatch(/userId = sessionData\?\.session\?\.user\?\.id \|\| null/);
  });

  it("does NOT invent a company email — it reads the (currently null) legalContact single source of truth", () => {
    expect(SRC).toMatch(/const SUPPORT_CONTACT_EMAIL = LEGAL_CONTACT\.supportContactEmail \|\| null/);
    expect(DIALOG).toMatch(/SUPPORT_CONTACT_EMAIL \? \(/);
    expect(DIALOG).toMatch(/Or feel free to contact us directly at/);
    // when unset: a clearly-identified placeholder + a TODO(config) marker, never a fake address
    expect(DIALOG).toMatch(/A direct support email address will be published here shortly\./);
    expect(DIALOG).toMatch(/TODO\(config\): set LEGAL_CONTACT\.supportContactEmail/);
    expect(DIALOG).not.toMatch(/@jobready|@job-ready|support@|hello@|contact@/i);
  });
});

/* ================================================================== *
 * FEATURE 3 — the contact_messages migration file
 * ================================================================== */
describe("Feature 3 — contact_messages migration (repository file only, NOT applied)", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const file = readdirSync(dir).find((f) => /contact_messages/.test(f));
  const sql = file ? readFileSync(new URL(file, dir), "utf8") : "";

  it("exists, timestamped after the pricing/entitlements migration, additive + idempotent", () => {
    expect(file, "a *contact_messages*.sql migration").toBeTruthy();
    expect(file.slice(0, 14) > "20260903090000").toBe(true);
    expect(sql).toMatch(/create table if not exists public\.contact_messages/i);
    expect(sql).not.toMatch(/drop table|drop column|truncate|delete from/i);
  });

  it("is a write-only sink: RLS on, INSERT-only for anon + authenticated, no select/update/delete policy", () => {
    expect(sql).toMatch(/alter table public\.contact_messages enable row level security/i);
    expect(sql).toMatch(/for insert to anon/i);
    expect(sql).toMatch(/for insert to authenticated/i);
    expect(sql).not.toMatch(/for select|for update|for delete/i);
    // an anon sender cannot attribute a row to a user; an authed sender only to themselves
    expect(sql).toMatch(/with check \(user_id is null\)/i);
    expect(sql).toMatch(/user_id is null or user_id = \(select auth\.uid\(\)\)/i);
  });

  it("documents that deployment is a deliberate, separate step (does not touch the migration ledger here)", () => {
    expect(sql).toMatch(/NOT applied to the live database/i);
  });
});
