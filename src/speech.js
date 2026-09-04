/* ================================================================== *
 * SPEECH-TO-TEXT — pure helpers for the Web Speech API voice input
 * ------------------------------------------------------------------
 * Zero direct API cost: this only ever wraps the browser's built-in
 * `window.SpeechRecognition` / `window.webkitSpeechRecognition`. No audio
 * is uploaded or stored; recognition runs entirely in the user's browser.
 *
 * This module is deliberately DOM-free and side-effect-free so it can be
 * unit-tested in the node test env (same idea as entitlements.js). The
 * React lifecycle wrapper (`useSpeechToText`) lives in App.jsx and imports
 * these helpers.
 * ================================================================== */

// Default recognition language. JOB.READY has no per-user language
// preference system today, so English (British) is the initial default.
export const SPEECH_LANG = "en-GB";

// Shown, non-blocking, when the browser has no Web Speech API. Typing is
// always still available — this never disables the textarea.
export const VOICE_UNSUPPORTED_MESSAGE =
  "Voice input isn't supported in this browser. You can still type your answer.";

/**
 * Feature detection. Returns the SpeechRecognition constructor (preferring
 * the un-prefixed name, falling back to the WebKit-prefixed one) or `null`.
 * Pass an explicit window-like object in tests; defaults to the global
 * `window` when present.
 */
export function getSpeechRecognition(win) {
  const w =
    win !== undefined
      ? win
      : typeof window !== "undefined"
      ? window
      : undefined;
  if (!w) return null;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** Convenience boolean form of {@link getSpeechRecognition}. */
export function isSpeechRecognitionSupported(win) {
  return !!getSpeechRecognition(win);
}

/**
 * Append a newly-recognised (final) speech chunk to whatever the user has
 * ALREADY got in the answer field — typed, previously spoken, or both.
 *
 *  - never overwrites existing text;
 *  - inserts a single separating space only when needed (not at the very
 *    start, not when the previous text already ends in whitespace, not
 *    before closing punctuation);
 *  - capitalises the first letter only when the field was empty, so a
 *    spoken answer doesn't start lower-case;
 *  - collapses the internal whitespace of the chunk itself.
 *
 * Interim (not-yet-final) results are shown to the user as a live preview
 * elsewhere and are NEVER passed here, so this can't double-count them.
 */
export function appendSpokenChunk(prev, chunk) {
  const existing = typeof prev === "string" ? prev : "";
  const addition = String(chunk == null ? "" : chunk).replace(/\s+/g, " ").trim();
  if (!addition) return existing;
  if (!existing) return addition.charAt(0).toUpperCase() + addition.slice(1);
  // No leading space before ,.!?;: or a closing bracket/quote.
  if (/^[,.!?;:)\]}'"]/.test(addition)) return existing + addition;
  const needsSpace = !/\s$/.test(existing);
  return existing + (needsSpace ? " " : "") + addition;
}

/**
 * Map a SpeechRecognitionErrorEvent `.error` code to an honest, reassuring,
 * user-facing sentence — always ending by reminding the user they can type.
 * Returns `null` for `"aborted"` (an intentional stop is not an error the
 * user needs to see). An unknown code falls back to a generic recovery line.
 */
export function speechErrorMessage(code) {
  switch (code) {
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow it in your browser settings, then try again — or just type your answer.";
    case "no-speech":
      return "We didn't catch any speech. Tap the mic to try again, or type your answer.";
    case "audio-capture":
      return "No microphone was found. You can still type your answer.";
    case "network":
      return "Voice input hit a network problem and stopped. You can still type your answer.";
    case "language-not-supported":
      return "Voice input isn't available for this language here. You can still type your answer.";
    default:
      return "Voice input stopped unexpectedly. You can still type your answer.";
  }
}

/**
 * Pull the final + interim transcript out of a SpeechRecognition `onresult`
 * event, starting from `event.resultIndex` (so already-delivered results
 * are not re-read). Pure: takes a plain event-shaped object.
 */
export function readRecognitionEvent(event) {
  const results = event && event.results ? event.results : [];
  const from = Number.isFinite(event && event.resultIndex) ? event.resultIndex : 0;
  let final = "";
  let interim = "";
  for (let i = from; i < results.length; i++) {
    const r = results[i];
    if (!r || !r[0]) continue;
    const text = r[0].transcript || "";
    if (r.isFinal) final += text;
    else interim += text;
  }
  return { final: final.trim(), interim: interim.trim() };
}
