/* ================================================================== *
 * SPEECH-TO-TEXT — pure helper unit tests (Feature 2)
 * ------------------------------------------------------------------
 * Node env, no DOM. Covers the parts that decide behaviour:
 *   - supported / unsupported browser detection (both API names);
 *   - transcript integration into the EXISTING answer (append, never
 *     overwrite; sane spacing/capitalisation; interim never double-counted);
 *   - error-code -> honest user message mapping (incl. the "aborted" = no
 *     message case);
 *   - reading final vs interim results out of a recognition event.
 * The React lifecycle wrapper (`useSpeechToText`) and its cleanup wiring
 * are covered structurally in loadingVoiceContactFeatures.test.js.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import {
  SPEECH_LANG,
  VOICE_UNSUPPORTED_MESSAGE,
  getSpeechRecognition,
  isSpeechRecognitionSupported,
  appendSpokenChunk,
  speechErrorMessage,
  readRecognitionEvent,
} from "./speech.js";

/* ---------------------------------------------------------------- *
 * feature detection — both window.SpeechRecognition AND webkit
 * ---------------------------------------------------------------- */
describe("getSpeechRecognition — browser feature detection", () => {
  it("returns null when neither API is present (unsupported browser)", () => {
    expect(getSpeechRecognition({})).toBeNull();
    expect(isSpeechRecognitionSupported({})).toBe(false);
  });

  it("picks up the un-prefixed window.SpeechRecognition", () => {
    const Ctor = function SpeechRecognition() {};
    expect(getSpeechRecognition({ SpeechRecognition: Ctor })).toBe(Ctor);
    expect(isSpeechRecognitionSupported({ SpeechRecognition: Ctor })).toBe(true);
  });

  it("falls back to the WebKit-prefixed window.webkitSpeechRecognition", () => {
    const Ctor = function webkitSpeechRecognition() {};
    expect(getSpeechRecognition({ webkitSpeechRecognition: Ctor })).toBe(Ctor);
    expect(isSpeechRecognitionSupported({ webkitSpeechRecognition: Ctor })).toBe(true);
  });

  it("prefers the un-prefixed name when both exist", () => {
    const Std = function A() {};
    const Webkit = function B() {};
    expect(getSpeechRecognition({ SpeechRecognition: Std, webkitSpeechRecognition: Webkit })).toBe(Std);
  });

  it("tolerates being called with no window at all", () => {
    expect(getSpeechRecognition(null)).toBeNull();
  });

  it("defaults the recognition language to en-GB and has a plain-English unsupported message", () => {
    expect(SPEECH_LANG).toBe("en-GB");
    expect(VOICE_UNSUPPORTED_MESSAGE).toMatch(/isn't supported/i);
    expect(VOICE_UNSUPPORTED_MESSAGE).toMatch(/still type your answer/i);
  });
});

/* ---------------------------------------------------------------- *
 * transcript integration — append to EXISTING text, never overwrite
 * ---------------------------------------------------------------- */
describe("appendSpokenChunk — merge recognised speech into the existing answer", () => {
  it("uses the chunk as-is (capitalised) when the field is empty", () => {
    expect(appendSpokenChunk("", "hello there")).toBe("Hello there");
    expect(appendSpokenChunk(undefined, "my answer")).toBe("My answer");
    expect(appendSpokenChunk(null, "already Capitalised")).toBe("Already Capitalised");
  });

  it("PRESERVES existing typed text and appends after it with one space", () => {
    expect(appendSpokenChunk("I have typed this.", "and now I speak")).toBe(
      "I have typed this. and now I speak"
    );
  });

  it("does not add a second space when the existing text already ends in whitespace", () => {
    expect(appendSpokenChunk("typed so far ", "spoken part")).toBe("typed so far spoken part");
    expect(appendSpokenChunk("line one\n", "line two")).toBe("line one\nline two");
  });

  it("does not put a space before closing punctuation", () => {
    expect(appendSpokenChunk("This is my point", ".")).toBe("This is my point.");
    expect(appendSpokenChunk("A list item", ", and another")).toBe("A list item, and another");
  });

  it("collapses internal whitespace in the recognised chunk", () => {
    expect(appendSpokenChunk("Start.", "  lots   of\tspace  ")).toBe("Start. lots of space");
  });

  it("is a no-op for an empty / whitespace-only chunk (never wipes the field)", () => {
    expect(appendSpokenChunk("keep me", "")).toBe("keep me");
    expect(appendSpokenChunk("keep me", "   ")).toBe("keep me");
    expect(appendSpokenChunk("keep me", null)).toBe("keep me");
  });

  it("accumulates across multiple final chunks the way a running dictation would", () => {
    let answer = "My prepared notes:";
    answer = appendSpokenChunk(answer, "I led a team of four");
    answer = appendSpokenChunk(answer, "over two months");
    answer = appendSpokenChunk(answer, ".");
    expect(answer).toBe("My prepared notes: I led a team of four over two months.");
  });
});

/* ---------------------------------------------------------------- *
 * error handling — honest, recoverable, "you can still type" messages
 * ---------------------------------------------------------------- */
describe("speechErrorMessage — browser recognition error codes", () => {
  it("returns null for an intentional 'aborted' stop (not shown to the user)", () => {
    expect(speechErrorMessage("aborted")).toBeNull();
  });

  it("explains a blocked microphone for not-allowed / service-not-allowed", () => {
    for (const code of ["not-allowed", "service-not-allowed"]) {
      expect(speechErrorMessage(code)).toMatch(/microphone access is blocked/i);
      expect(speechErrorMessage(code)).toMatch(/type your answer/i);
    }
  });

  it("has specific, non-alarming copy for no-speech / audio-capture / network", () => {
    expect(speechErrorMessage("no-speech")).toMatch(/didn't catch any speech/i);
    expect(speechErrorMessage("audio-capture")).toMatch(/no microphone was found/i);
    expect(speechErrorMessage("network")).toMatch(/network problem/i);
  });

  it("falls back to a generic recovery line for an unknown code, still ending with 'type your answer'", () => {
    const msg = speechErrorMessage("some-future-code");
    expect(msg).toMatch(/stopped unexpectedly/i);
    expect(msg).toMatch(/type your answer/i);
  });
});

/* ---------------------------------------------------------------- *
 * reading a recognition event — final committed vs interim preview
 * ---------------------------------------------------------------- */
describe("readRecognitionEvent — split final vs interim from resultIndex", () => {
  const evt = (results, resultIndex = 0) => ({ results, resultIndex });
  const res = (transcript, isFinal) => ({ 0: { transcript }, isFinal });

  it("returns only the newly-final text as `final`, the rest as `interim`", () => {
    const e = evt([res("I led a project ", true), res("and it went well", false)]);
    expect(readRecognitionEvent(e)).toEqual({ final: "I led a project", interim: "and it went well" });
  });

  it("starts reading at event.resultIndex so earlier (already-delivered) results are not re-emitted", () => {
    const e = evt(
      [res("old final ", true), res("newer final ", true), res("live interim", false)],
      1
    );
    expect(readRecognitionEvent(e)).toEqual({ final: "newer final", interim: "live interim" });
  });

  it("handles an all-interim event (nothing final yet)", () => {
    expect(readRecognitionEvent(evt([res("still speaking", false)]))).toEqual({
      final: "",
      interim: "still speaking",
    });
  });

  it("never throws on a malformed / empty event", () => {
    expect(() => readRecognitionEvent({})).not.toThrow();
    expect(() => readRecognitionEvent({ results: [null, {}] })).not.toThrow();
    expect(readRecognitionEvent({})).toEqual({ final: "", interim: "" });
  });
});
