/* ================================================================== *
 * EKI² — AI Careers Adviser Briefing Edge Function guards
 * The AI layer is thin, isolated and OPTIONAL: it re-authorises via
 * eki_student_snapshot, sends only a compact fact set, embeds the
 * hallucination-resistant rules, and degrades to { ok:false } (client
 * keeps its deterministic briefing) when the key is absent or the model
 * fails / returns malformed output.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const FN_RAW = readFileSync(join(HERE, "..", "..", "supabase", "functions", "eki-adviser-briefing", "index.ts"), "utf8");
const FN = FN_RAW.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");   // strip comments
const API = readFileSync(join(HERE, "api.js"), "utf8");

describe("re-authorisation + minimal data", () => {
  it("forwards the caller's JWT to eki_student_snapshot (the RPC's gate is the authority)", () => {
    expect(FN).toMatch(/rpc\/eki_student_snapshot/);
    expect(FN).toMatch(/Authorization:\s*authHeader/);
    expect(FN).toMatch(/if \(!rpcRes\.ok\)[\s\S]*?not_authorised/);
  });
  it("requires a Bearer token and the two id params", () => {
    expect(FN).toMatch(/authHeader\.startsWith\("Bearer "\)/);
    expect(FN).toMatch(/!payload\.institution_id \|\| !payload\.student_id/);
  });
  it("sends the model a COMPACT fact set only — no transcript, no raw answers", () => {
    expect(FN).toMatch(/function factsFromSnapshot/);
    expect(FN).not.toMatch(/answer_text|\btranscript\b/i);
    // it derives facts from the snapshot, it does not forward the whole snapshot
    expect(FN).toMatch(/JSON\.stringify\(facts\)/);
    expect(FN).not.toMatch(/JSON\.stringify\(snapshot\)/);
  });
});

describe("hallucination-resistant prompt", () => {
  it("embeds the rules: only supplied facts, no diagnosis, no causality, no employment prediction", () => {
    expect(FN).toMatch(/Use ONLY the facts/i);
    expect(FN).toMatch(/do not diagnose/i);
    expect(FN).toMatch(/do not claim any intervention caused a change/i);
    expect(FN).toMatch(/do not predict employment/i);
    expect(FN).toMatch(/distinguish what the data shows/i);
  });
});

describe("optional + safe fallback", () => {
  it("returns { ok:false } (not an error) when ANTHROPIC_API_KEY is absent", () => {
    expect(FN).toMatch(/!ANTHROPIC_API_KEY[\s\S]{0,120}reason: "ai_unavailable"/);
  });
  it("returns { ok:false } on model error / malformed JSON / unreachable model", () => {
    expect(FN).toMatch(/reason: "model_error"/);
    expect(FN).toMatch(/reason: "malformed_response"/);
    expect(FN).toMatch(/reason: "model_unreachable"/);
  });
  it("defaults to a small, cheap model and caps output tokens", () => {
    expect(FN).toMatch(/EKI_BRIEFING_MODEL.*\?\?\s*"claude-haiku/);
    expect(FN).toMatch(/max_tokens:\s*\d{2,3}\b/);
  });
});

describe("client wrapper degrades silently", () => {
  it("api.requestAdviserBriefing swallows errors into { ok:false }", () => {
    expect(API).toMatch(/export async function requestAdviserBriefing/);
    expect(API).toMatch(/functions\.invoke\("eki-adviser-briefing"/);
    expect(API).toMatch(/return \{ ok: false, reason: "unavailable" \}/);
  });
});
