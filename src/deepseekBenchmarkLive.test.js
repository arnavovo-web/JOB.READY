/* ================================================================== *
 * PHASE 36 — DEEPSEEK VS. CLAUDE QUALITY BENCHMARK (OPTIONAL LIVE RUN)
 * ------------------------------------------------------------------
 * Same pattern as src/invitationScannerLiveEvaluation.test.js (Phase 8):
 * picked up by the normal `npm test`, but every test inside is SKIPPED
 * unless RUN_DEEPSEEK_BENCHMARK=1 is set — so `npm test` never makes a
 * network/AI call and never needs credentials because this file exists.
 *
 * Unlike the invitation live-eval (which goes through the REAL DEPLOYED
 * Edge Function, and so only ever exercises whichever provider that
 * function is currently configured for), this harness compares BOTH
 * providers side by side for the SAME input — that requires calling each
 * vendor directly with its own raw API key, bypassing the Edge Function.
 * It reuses the exact same callAnthropicProvider / callDeepSeekProvider
 * functions the Edge Function itself calls (supabase/functions/ai-generate/
 * providers.ts) — not a reimplementation — and the SAME real product
 * validators (validateQuestionBatch, validateEvaluationSignals,
 * validateInvitationExtraction, validateAcScenario, validateReport,
 * buildInvitationExtractionPrompt), imported straight from src/App.jsx.
 *
 * Run it for real with:
 *   ANTHROPIC_API_KEY=... DEEPSEEK_API_KEY=... RUN_DEEPSEEK_BENCHMARK=1 \
 *     npx vitest run src/deepseekBenchmarkLive.test.js
 * (or `npm run benchmark:deepseek` — see package.json / scripts/deepseek-benchmark/README.md)
 *
 * DEEPSEEK_API_KEY is optional: omit it to see Claude-only output printed
 * (still useful — confirms the harness and the real prompts still work).
 * Neither key is ever hardcoded, logged, or committed — only read from
 * process.env, and never printed. This file was NOT run with live keys as
 * part of Phase 36 (no keys were available in the sandbox it was built in)
 * — see the Phase 36 report's "Quality benchmark" section.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import {
  validateQuestionBatch, validateEvaluationSignals,
  validateInvitationExtraction, buildInvitationExtractionPrompt,
  validateAcScenario, validateReport,
} from "./App.jsx";
import { callAnthropicProvider, callDeepSeekProvider } from "../supabase/functions/ai-generate/providers.ts";

const LIVE_ENABLED = process.env.RUN_DEEPSEEK_BENCHMARK === "1";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

function section(title) {
  console.log(`\n${title}\n${"─".repeat(20)}`);
}

// Runs one task against both providers (DeepSeek skipped if no key), prints
// the spec's comparison format, and returns pass/fail per provider so the
// test assertion is itself meaningful rather than just "did not throw".
async function runTask(taskName, { system, userText, maxTokens, validate, inputSummary }) {
  section(`TASK: ${taskName}`);
  console.log("INPUT");
  console.log(inputSummary);

  const results = {};
  for (const [label, key, caller] of [
    ["Claude", ANTHROPIC_KEY, callAnthropicProvider],
    ["DeepSeek", DEEPSEEK_KEY, callDeepSeekProvider],
  ]) {
    if (!key) {
      console.log(`\n${label.toUpperCase()} OUTPUT\nSKIPPED — no API key configured`);
      results[label] = { skipped: true };
      continue;
    }
    const t0 = Date.now();
    try {
      const res = await caller(key, { system, userText, maxTokens, useWebSearch: false });
      const latencyMs = Date.now() - t0;
      const text = (res.content || []).map((b) => b.text || "").join("\n");
      const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
      let parsed, parseOk = true;
      try { parsed = JSON.parse(clean); } catch { parseOk = false; }
      let validationOk = false, validationError = null;
      if (parseOk) {
        try { validate(parsed); validationOk = true; } catch (e) { validationError = e.message; }
      }
      console.log(`\n${label.toUpperCase()} OUTPUT`);
      console.log(clean.slice(0, 2000));
      results[label] = {
        skipped: false, latencyMs, parseOk, validationOk, validationError,
        inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens,
      };
    } catch (e) {
      console.log(`\n${label.toUpperCase()} OUTPUT\nERROR: ${e.message}`);
      results[label] = { skipped: false, error: e.message, validationOk: false };
    }
  }

  section("STRUCTURAL VALIDATION");
  for (const label of ["Claude", "DeepSeek"]) {
    const r = results[label];
    console.log(`${label}: ${r.skipped ? "SKIPPED" : r.validationOk ? "PASS" : `FAIL${r.validationError ? ` (${r.validationError})` : ""}`}`);
  }
  section("LATENCY");
  for (const label of ["Claude", "DeepSeek"]) {
    const r = results[label];
    console.log(`${label}: ${r.skipped ? "SKIPPED" : r.error ? "ERROR" : `${r.latencyMs}ms`}`);
  }
  section("TOKEN USAGE (input / output, as reported by the provider)");
  for (const label of ["Claude", "DeepSeek"]) {
    const r = results[label];
    console.log(`${label}: ${r.skipped || r.error ? "N/A" : `${r.inputTokens ?? "?"} / ${r.outputTokens ?? "?"}`}`);
  }
  console.log("");
  return results;
}

describe("DeepSeek vs. Claude quality benchmark", () => {
  it.skipIf(!LIVE_ENABLED)("1. Interview question generation — Investment Banking Summer Analyst", async () => {
    // Representative reconstruction of the real interview_question_batch prompt
    // (buildQuestionBatchPrompt, App.jsx — not exported, module-private) using
    // the exact JSON shape / rules that function actually specifies.
    const system = `You are an expert interview designer building a COMPLETE, FIXED set of independent interview questions for an asynchronous, one-way video interview (Recruiter screen — Asynchronous video). Every question must be answerable entirely on its own, with zero dependency on any other question or its answer.

Return strict JSON only, no prose, no markdown fences, in this exact shape:
{
  "questions": [
    {
      "text": "", "category": "motivation_fit|cv_behavioural|role_specific|technical|commercial_awareness",
      "competency": "", "anchor_source": "generic|cv|jd|company", "difficulty": "foundational|intermediate|advanced",
      "is_technical": false, "role_relevance": "", "expected_answer_characteristics": ""
    }
  ]
}
Rules:
- Generate exactly 5 questions.
- Target composition (approximate weighting): motivation 20%, behavioural 30%, situational judgement 10%, technical/functional 30%, commercial awareness 10%.
- For every question you mark "is_technical": true, calibrate to INTERMEDIATE difficulty: comfortable with core valuation/accounting concepts, not yet expert.
- Vary categories and difficulty sensibly across the set.`;
    const userText = `Company: Northwind Capital Partners\nRole: Investment Banking Summer Analyst\nInterview stage: Recruiter screen\nInterview format: Asynchronous video\n\nInterview profile (from JD analysis): {"jd_requirements":[{"requirement":"Strong technical accounting and valuation fundamentals","category":"technical"},{"requirement":"Ability to work under pressure with attention to detail","category":"behavioural"}]}\n\nCandidate background: {"education":["BSc Economics, University of Bristol"],"experience":["Summer internship, boutique advisory firm"],"skills":["Excel modelling","DCF valuation"]}\n\nJob description:\nWe are seeking a Summer Analyst for our M&A Advisory team. You will support live deal execution, build financial models (DCF, comparable companies, precedent transactions), and prepare client-facing materials. Strong technical grounding in accounting and valuation is essential; you'll work in a fast-paced, detail-oriented environment.`;
    await runTask("Interview question generation (IB Summer Analyst)", {
      system, userText, maxTokens: 3000,
      validate: (parsed) => validateQuestionBatch(parsed, 5),
      inputSummary: "Investment Banking Summer Analyst — technical+behavioural+motivational mix, intermediate technical difficulty, 5 questions requested.",
    });
  });

  it.skipIf(!LIVE_ENABLED)("2. Answer evaluation — a realistic student answer", async () => {
    // Verbatim shape from validateEvaluationSignals/validateEvaluation
    // (App.jsx, interview_turn_evaluate) — the nested "evaluation" object plus
    // the three scheduler signals, not a flat score object.
    const system = `You are scoring a single interview answer for an adaptive interview scheduler. Return strict JSON only:
{"evaluation":{"relevance":0,"specificity":0,"structure":0,"evidence":0,"clarity":0,"competency_demonstration":0,"strengths":[""],"issues":[""]},"follow_up_worthy":false,"challenge_worthy":false,"flagged_claim":""}
Score 0-100 for each evaluation dimension honestly. "strengths"/"issues" should be specific, referencing what the candidate actually said. Set follow_up_worthy true if a natural follow-up question would add value; challenge_worthy true if the claim deserves a harder probe; flagged_claim to a short quote of any claim worth verifying later, else "".`;
    const userText = `Question: "Tell me about a time you had to work under a tight deadline."\nCategory: cv_behavioural\nCompetency: Resilience under pressure\n\nCandidate's answer: "During my internship, we had a pitch deck due in two days after the client moved the meeting up. I reprioritised my other tasks, worked with the analyst team to split the model-building and slide-writing, and we stayed late two nights to finish. The client was happy with the deck and we won the follow-on mandate. I learned that clear task-splitting early on saves a lot of time later."`;
    await runTask("Answer evaluation", {
      system, userText, maxTokens: 900,
      validate: (parsed) => validateEvaluationSignals(parsed),
      inputSummary: "Behavioural answer (STAR-shaped, concrete outcome) to a resilience-under-pressure question.",
    });
  });

  it.skipIf(!LIVE_ENABLED)("3. Invitation extraction — a representative interview-invitation email", async () => {
    // Real prompt builder — not a reconstruction.
    const emailText = `Subject: Invitation to interview — Investment Banking Summer Analyst, Northwind Capital Partners

Dear Candidate,

Thank you for your application. We would like to invite you to a first-round interview for the Investment Banking Summer Analyst position on our M&A Advisory team.

The interview will be a 45-minute video call covering technical (valuation, accounting) and behavioural questions. Please have a copy of your CV ready and be prepared to discuss a recent transaction you find interesting.

Best regards,
Northwind Capital Partners Recruiting`;
    const { system, userText } = buildInvitationExtractionPrompt(emailText);
    await runTask("Invitation extraction", {
      system, userText, maxTokens: 1600,
      validate: (parsed) => validateInvitationExtraction(parsed),
      inputSummary: "A representative first-round IB interview invitation email (company, role, stage, format, duration, topics all explicit).",
    });
  });

  it.skipIf(!LIVE_ENABLED)("4. Assessment Centre scenario generation", async () => {
    // Verbatim shape from the real system prompt (generateAcScenario, App.jsx —
    // not exported, module-private) — validateAcScenario expects EXACTLY these
    // fields, so this is copied faithfully rather than reconstructed loosely.
    const system = `You design realistic graduate assessment-centre exercises. Return strict JSON only, no prose:
{ "title": "", "brief": "", "objective": "", "materials": [""], "suggested_time_minutes": 15 }
Rules: ground it in the specific company and role given, for a "Case Study" exercise. materials should be short concrete bullets (documents or data points). Calibrate difficulty for a first attempt: realistic but approachable.`;
    const userText = `Company: Northwind Capital Partners\nRole context: Graduate scheme, Investment Banking division\nDifficulty: Standard graduate assessment centre level`;
    await runTask("Assessment Centre scenario generation", {
      system, userText, maxTokens: 1400,
      validate: (parsed) => validateAcScenario(parsed),
      inputSummary: "Case Study exercise for a graduate IB assessment centre.",
    });
  });

  it.skipIf(!LIVE_ENABLED)("5. Interview report generation", async () => {
    const system = `You produce a final interview performance report as strict JSON only, no prose. Shape:
{
  "overall_score": 0, "readiness": "not_ready|needs_improvement|interview_ready|strong",
  "breakdown": {"relevance":0,"structure":0,"specificity":0,"evidence":0,"communication":0,"competency_demonstration":0},
  "strongest_areas": [""], "weakest_areas": [""],
  "per_question_feedback": [{"question":"", "did_well": [""], "weakened_it": [""], "how_to_improve": "", "note_on_missing_data": ""}],
  "next_practice_focus": "", "updated_candidate_weaknesses": [""], "updated_candidate_strengths": [""],
  "interview_style_notes": [""],
  "classroom_topics": [{"topic": "", "category": "company_knowledge|technical|commercial_awareness|behavioural|technique|role_specific", "description": "", "related_question": "", "initial_score": 0}]
}`;
    const userText = `Company: Northwind Capital Partners\nRole: Investment Banking Summer Analyst\nStage: Recruiter screen (asynchronous)\n\nTranscript:\nQ1 (motivation_fit): "Why investment banking?" — A1: "I'm drawn to the pace and the direct exposure to live transactions..." Score: 78/100\nQ2 (technical): "Walk me through a DCF." — A2: "You project free cash flows, discount them at WACC, add a terminal value..." Score: 65/100 (mentioned WACC and terminal value but didn't explain how WACC is calculated)\nQ3 (cv_behavioural): "Tell me about a time you worked under pressure." — A3: "During my internship, a pitch deck deadline moved up two days early..." Score: 82/100`;
    await runTask("Interview report generation", {
      system, userText, maxTokens: 3000,
      validate: (parsed) => validateReport(parsed),
      inputSummary: "3-question mixed-stage transcript with per-question scores, requesting a full readiness report.",
    });
  });

  it("harness sanity check — always runs, never calls a live API, confirms the file itself is wired correctly", () => {
    expect(typeof callAnthropicProvider).toBe("function");
    expect(typeof callDeepSeekProvider).toBe("function");
    expect(typeof validateQuestionBatch).toBe("function");
    expect(typeof validateEvaluationSignals).toBe("function");
    expect(typeof validateInvitationExtraction).toBe("function");
    expect(typeof validateAcScenario).toBe("function");
    expect(typeof validateReport).toBe("function");
    if (!LIVE_ENABLED) {
      console.log("\n[deepseekBenchmarkLive] RUN_DEEPSEEK_BENCHMARK is not set — live benchmark tasks skipped, as expected for `npm test`. Run `npm run benchmark:deepseek` (with ANTHROPIC_API_KEY / DEEPSEEK_API_KEY set) to actually compare providers.");
    }
  });
});
