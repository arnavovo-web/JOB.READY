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
 * — see the Phase 36 report's "Quality benchmark" section. Still not run
 * with live keys as part of Phase 37 either, for the same reason (no
 * ANTHROPIC_API_KEY/DEEPSEEK_API_KEY available in this sandbox) — no live
 * benchmark results are claimed here.
 *
 * PHASE 37 addition: each task below now also names the REAL requestType it
 * represents and prints what Phase 37's actual hybrid routing policy
 * (selectProviderForRequest, the same centralized function
 * supabase/functions/ai-generate/index.ts calls) would route that requestType
 * to. This doesn't change which provider the raw side-by-side comparison
 * calls (both providers are still called directly, unconditionally, for
 * every task — that's the whole point of a comparison benchmark) — it makes
 * the benchmark's output legible against Phase 37's actual routing table,
 * so a real run with live keys tells you not just "which provider does
 * better on this task" but "does that match what hybrid mode would actually
 * choose for it".
 * ================================================================== */
import { describe, it, expect, vi } from "vitest";
import {
  validateQuestionBatch, validateEvaluationSignals,
  validateInvitationExtraction, buildInvitationExtractionPrompt,
  validateAcScenario, validateReport,
  // Phase 41B — the three remaining priority DeepSeek-candidate request types
  validateProfile, validateLesson, validateDevelopmentModule,
} from "./App.jsx";
import { callAnthropicProvider, callDeepSeekProvider, selectProviderForRequest } from "../supabase/functions/ai-generate/providers.ts";

const LIVE_ENABLED = process.env.RUN_DEEPSEEK_BENCHMARK === "1";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

// ------------------------------------------------------------------
// Benchmark EXECUTION config only (not a change to any task, prompt,
// routing or validator). Live provider calls in this file legitimately
// take 20-30s+ each — well past Vitest's 5s default — so raise the
// per-test / per-hook ceiling to 90s. This is scoped to THIS test file
// (vi.setConfig only affects the current file) and only raises a
// timeout ceiling; it never makes `npm test` do anything, because every
// live task is still `it.skipIf(!LIVE_ENABLED)` and LIVE_ENABLED is
// false unless RUN_DEEPSEEK_BENCHMARK=1.
//
// Sequential execution: the tasks below are plain `it(...)` (never
// `.concurrent`), so Vitest already runs them one at a time within this
// file; scripts/deepseek-benchmark/run.mjs additionally pins the run to
// a single non-parallel worker so per-task stdout can't interleave.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

function section(title) {
  console.log(`\n${title}\n${"─".repeat(20)}`);
}

// Runs one task against both providers (DeepSeek skipped if no key), prints
// the spec's comparison format, and returns pass/fail per provider so the
// test assertion is itself meaningful rather than just "did not throw".
// `requestType` (Phase 37, optional) is the REAL requestType this task represents — when
// given, prints what selectProviderForRequest (the actual hybrid routing policy) would route
// it to, so the benchmark's output is legible against Phase 37's real routing table.
async function runTask(taskName, { system, userText, maxTokens, validate, inputSummary, requestType }) {
  section(`TASK: ${taskName}`);
  console.log("INPUT");
  console.log(inputSummary);
  if (requestType) {
    const routing = selectProviderForRequest({ requestType, useWebSearch: false, configuredProvider: undefined });
    section("HYBRID ROUTING (Phase 37)");
    console.log(`requestType="${requestType}" -> hybrid mode routes this to: ${routing.provider} (${routing.reason})`);
  }

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

// ---------------------------------------------------------------------------
// The 8 benchmark task specs, hoisted to module scope so BOTH the provider
// comparison below AND the opt-in JSON-mode experiment (further down) run the
// EXACT same inputs. Hoisting only relocates these objects — every system /
// userText / maxTokens / validate / requestType is byte-for-byte what the
// inline `it()` blocks used before. No task, prompt or validator was changed.
// ---------------------------------------------------------------------------
const BENCHMARK_TASKS = [
  {
    // Representative reconstruction of the real interview_question_batch prompt
    // (buildQuestionBatchPrompt, App.jsx — not exported, module-private) using
    // the exact JSON shape / rules that function actually specifies.
    testName: "1. Interview question generation — Investment Banking Summer Analyst",
    taskName: "Interview question generation (IB Summer Analyst)",
    system: `You are an expert interview designer building a COMPLETE, FIXED set of independent interview questions for an asynchronous, one-way video interview (Recruiter screen — Asynchronous video). Every question must be answerable entirely on its own, with zero dependency on any other question or its answer.

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
- Vary categories and difficulty sensibly across the set.`,
    userText: `Company: Northwind Capital Partners\nRole: Investment Banking Summer Analyst\nInterview stage: Recruiter screen\nInterview format: Asynchronous video\n\nInterview profile (from JD analysis): {"jd_requirements":[{"requirement":"Strong technical accounting and valuation fundamentals","category":"technical"},{"requirement":"Ability to work under pressure with attention to detail","category":"behavioural"}]}\n\nCandidate background: {"education":["BSc Economics, University of Bristol"],"experience":["Summer internship, boutique advisory firm"],"skills":["Excel modelling","DCF valuation"]}\n\nJob description:\nWe are seeking a Summer Analyst for our M&A Advisory team. You will support live deal execution, build financial models (DCF, comparable companies, precedent transactions), and prepare client-facing materials. Strong technical grounding in accounting and valuation is essential; you'll work in a fast-paced, detail-oriented environment.`,
    maxTokens: 3000,
    validate: (parsed) => validateQuestionBatch(parsed, 5),
    inputSummary: "Investment Banking Summer Analyst — technical+behavioural+motivational mix, intermediate technical difficulty, 5 questions requested.",
    requestType: "interview_question_batch",
  },
  {
    // Verbatim shape from validateEvaluationSignals/validateEvaluation
    // (App.jsx, interview_turn_evaluate) — the nested "evaluation" object plus
    // the three scheduler signals, not a flat score object.
    testName: "2. Answer evaluation — a realistic student answer",
    taskName: "Answer evaluation",
    system: `You are scoring a single interview answer for an adaptive interview scheduler. Return strict JSON only:
{"evaluation":{"relevance":0,"specificity":0,"structure":0,"evidence":0,"clarity":0,"competency_demonstration":0,"strengths":[""],"issues":[""]},"follow_up_worthy":false,"challenge_worthy":false,"flagged_claim":""}
Score 0-100 for each evaluation dimension honestly. "strengths"/"issues" should be specific, referencing what the candidate actually said. Set follow_up_worthy true if a natural follow-up question would add value; challenge_worthy true if the claim deserves a harder probe; flagged_claim to a short quote of any claim worth verifying later, else "".`,
    userText: `Question: "Tell me about a time you had to work under a tight deadline."\nCategory: cv_behavioural\nCompetency: Resilience under pressure\n\nCandidate's answer: "During my internship, we had a pitch deck due in two days after the client moved the meeting up. I reprioritised my other tasks, worked with the analyst team to split the model-building and slide-writing, and we stayed late two nights to finish. The client was happy with the deck and we won the follow-on mandate. I learned that clear task-splitting early on saves a lot of time later."`,
    maxTokens: 900,
    validate: (parsed) => validateEvaluationSignals(parsed),
    inputSummary: "Behavioural answer (STAR-shaped, concrete outcome) to a resilience-under-pressure question.",
    requestType: "interview_turn_evaluate",
  },
  {
    // Real prompt builder — not a reconstruction.
    testName: "3. Invitation extraction — a representative interview-invitation email",
    taskName: "Invitation extraction",
    ...buildInvitationExtractionPrompt(`Subject: Invitation to interview — Investment Banking Summer Analyst, Northwind Capital Partners

Dear Candidate,

Thank you for your application. We would like to invite you to a first-round interview for the Investment Banking Summer Analyst position on our M&A Advisory team.

The interview will be a 45-minute video call covering technical (valuation, accounting) and behavioural questions. Please have a copy of your CV ready and be prepared to discuss a recent transaction you find interesting.

Best regards,
Northwind Capital Partners Recruiting`),
    maxTokens: 1600,
    validate: (parsed) => validateInvitationExtraction(parsed),
    inputSummary: "A representative first-round IB interview invitation email (company, role, stage, format, duration, topics all explicit).",
    requestType: "invitation_extraction",
  },
  {
    // Verbatim shape from the real system prompt (generateAcScenario, App.jsx —
    // not exported, module-private) — validateAcScenario expects EXACTLY these
    // fields, so this is copied faithfully rather than reconstructed loosely.
    testName: "4. Assessment Centre scenario generation",
    taskName: "Assessment Centre scenario generation",
    system: `You design realistic graduate assessment-centre exercises. Return strict JSON only, no prose:
{ "title": "", "brief": "", "objective": "", "materials": [""], "suggested_time_minutes": 15 }
Rules: ground it in the specific company and role given, for a "Case Study" exercise. materials should be short concrete bullets (documents or data points). Calibrate difficulty for a first attempt: realistic but approachable.`,
    userText: `Company: Northwind Capital Partners\nRole context: Graduate scheme, Investment Banking division\nDifficulty: Standard graduate assessment centre level`,
    maxTokens: 1400,
    validate: (parsed) => validateAcScenario(parsed),
    inputSummary: "Case Study exercise for a graduate IB assessment centre.",
    requestType: "assessment_centre_scenario",
  },
  {
    testName: "5. Interview report generation",
    taskName: "Interview report generation",
    system: `You produce a final interview performance report as strict JSON only, no prose. Shape:
{
  "overall_score": 0, "readiness": "not_ready|needs_improvement|interview_ready|strong",
  "breakdown": {"relevance":0,"structure":0,"specificity":0,"evidence":0,"communication":0,"competency_demonstration":0},
  "strongest_areas": [""], "weakest_areas": [""],
  "per_question_feedback": [{"question":"", "did_well": [""], "weakened_it": [""], "how_to_improve": "", "note_on_missing_data": ""}],
  "next_practice_focus": "", "updated_candidate_weaknesses": [""], "updated_candidate_strengths": [""],
  "interview_style_notes": [""],
  "classroom_topics": [{"topic": "", "category": "company_knowledge|technical|commercial_awareness|behavioural|technique|role_specific", "description": "", "related_question": "", "initial_score": 0}]
}`,
    userText: `Company: Northwind Capital Partners\nRole: Investment Banking Summer Analyst\nStage: Recruiter screen (asynchronous)\n\nTranscript:\nQ1 (motivation_fit): "Why investment banking?" — A1: "I'm drawn to the pace and the direct exposure to live transactions..." Score: 78/100\nQ2 (technical): "Walk me through a DCF." — A2: "You project free cash flows, discount them at WACC, add a terminal value..." Score: 65/100 (mentioned WACC and terminal value but didn't explain how WACC is calculated)\nQ3 (cv_behavioural): "Tell me about a time you worked under pressure." — A3: "During my internship, a pitch deck deadline moved up two days early..." Score: 82/100`,
    maxTokens: 3000,
    validate: (parsed) => validateReport(parsed),
    inputSummary: "3-question mixed-stage transcript with per-question scores, requesting a full readiness report.",
    requestType: "interview_report",
  },

  // -------------------------------------------------------------------------
  // Phase 41B additions — the remaining 3 of the 6 highest-priority
  // DeepSeek-candidate request types not already covered by tasks 1-5:
  //   6. interview_profile        7. classroom_lesson (non-web)   8. development_module
  // classroom_lesson is benchmarked ONLY in its non-web-search form — the
  // current architecture routes any useWebSearch:true lesson to Anthropic and
  // callDeepSeekProvider hard-rejects useWebSearch, so a web lesson is not a
  // DeepSeek candidate at all and is deliberately not benchmarked here.
  // -------------------------------------------------------------------------
  {
    // Faithful copy of INTERVIEW_PROFILE_SYSTEM (App.jsx, module-private const) —
    // the exact shape/rules validateProfile enforces. Kept verbatim so a real
    // run exercises the same provenance/verbatim-quote rules production does.
    testName: "6. Interview profile / application analysis — JD + CV -> structured profile",
    taskName: "Interview profile / application analysis (IB Summer Analyst, JD + CV)",
    system: `You are an expert interview coach and recruiter. You analyse a job description and a CV together and produce a single strict JSON object (no prose, no markdown fences) with this exact shape:
{
  "interview_profile": {
    "company": "", "role": "", "division": "", "seniority": "",
    "responsibilities": [""], "required_skills": [""], "preferred_skills": [""],
    "competencies": [{"name": "", "basis": "explicit|inferred|general"}],
    "technical_topics": [""], "behavioural_topics": [""], "commercial_topics": [""],
    "question_mix": {"motivation_fit": 30, "cv_behavioural": 25, "role_specific": 20, "technical": 15, "commercial_awareness": 10},
    "jd_requirements": [{"requirement": "", "evidence_quote": "", "confidence": "explicit|inferred|general", "category": "motivation_fit|behavioural_competency|situational_judgement|technical_functional|commercial_awareness", "occurrences": 1}]
  },
  "candidate_profile": {
    "education": [""], "experience": [""], "leadership": [""], "achievements": [""],
    "skills": [""], "behavioural_examples": [""],
    "cv_evidence": [{"text": "", "source": "cv|jd|inferred", "evidence_quote": ""}],
    "potential_probe_areas": [{"claim": "", "why": "", "source": "cv|jd|inferred", "evidence_quote": ""}]
  },
  "application_intelligence": {
    "company_themes": [{"theme": "", "evidence": ""}],
    "role_themes": [{"theme": "", "evidence": ""}],
    "company_context_strength": "strong|moderate|weak",
    "role_context_strength": "strong|moderate|weak"
  },
  "opening_question": { "text": "", "category": "motivation_fit|cv_behavioural|role_specific|technical|commercial_awareness", "competency": "" }
}
Rules: "basis" must honestly mark whether each competency is explicitly stated in the JD, reasonably inferred, or just generally expected for this role type. question_mix percentages sum to 100 and reflect the actual role type. potential_probe_areas should point at specific claims worth challenging. opening_question must be natural and specific, not generic.
CANDIDATE PROFILE PROVENANCE (strict): the six list fields (education, experience, leadership, achievements, skills, behavioural_examples) stay plain strings. For "cv_evidence" and for each "potential_probe_areas" entry, set "source" to where the statement genuinely comes from — "cv" only if it is actually present in the supplied CV text, "jd" if it comes from the job description, "inferred" if it is your reasonable inference from the role. When "source" is "cv", "evidence_quote" MUST be a short exact substring copied verbatim from the supplied CV text — never a paraphrase, summary or inference. If you cannot copy an exact CV quote, do not use "source": "cv". If NO CV text was supplied, never use "source": "cv" for anything and leave "cv_evidence" as []. jd_requirements should list distinct requirements actually evidenced in the job description — "evidence_quote" must be an exact short quote copied verbatim from the job description text (not a paraphrase or summary), "confidence" follows the same explicit/inferred/general distinction as competencies' basis, and "occurrences" is how many times this requirement (or a clear restatement of it) appears in the job description text.
"application_intelligence" captures what THIS specific application appears to prioritise, using ONLY the company/role/job-description-and-application-context/invitation material provided above — never outside knowledge, never assumed company values. "company_themes" = themes, culture, values or programme characteristics the material EXPLICITLY states about this company; each "evidence" MUST be an exact verbatim quote from the provided text. If the material gives nothing company-specific beyond the name, return "company_themes": [] and "company_context_strength": "weak" — do NOT invent plausible-sounding values. "role_themes" = what the role itself is about (responsibilities, focus areas) with verbatim "evidence" where possible. "*_context_strength" is your honest read of how much genuine company-/role-specific detail the material contains.`,
    userText: `This candidate has no prior interview history.

Company: Northwind Capital Partners
Role: Investment Banking Summer Analyst
Interview stage: First round
Interview format: Video call

Job description:
We are seeking a Summer Analyst for our M&A Advisory team. You will support live deal execution, build financial models (DCF, comparable companies, precedent transactions), and prepare client-facing materials. Strong technical grounding in accounting and valuation is essential; you'll work in a fast-paced, detail-oriented environment and must show excellent attention to detail under pressure.

Candidate CV:
Education: BSc Economics, University of Bristol (2:1 expected). Relevant modules: Corporate Finance, Financial Accounting.
Experience: Summer intern, boutique M&A advisory firm (8 weeks) — built comparable-companies analyses in Excel, supported two live sell-side mandates, prepared sections of information memoranda.
Skills: Excel financial modelling, DCF valuation, PowerPoint, Bloomberg basics.
Extra-curricular: Treasurer, University Finance Society — managed a £4,000 budget and ran a stock-pitch competition for 40 members.`,
    maxTokens: 6000,
    validate: (parsed) => validateProfile(parsed),
    inputSummary: "Real JD + a short but concrete CV — tests structured extraction plus the strict verbatim-quote provenance rules (cv_evidence / jd_requirements evidence_quote).",
    requestType: "interview_profile",
  },
  {
    // Faithful copy of the classroom_lesson system prompt (openLesson, App.jsx,
    // module-private). validateLesson enforces exactly this shape.
    testName: "7. Classroom lesson generation — non-web-search topic",
    taskName: "Classroom lesson generation (non-web-search — STAR technique)",
    system: `You are a specialist interview-preparation tutor. You generate one short, targeted lesson (5-10 minutes to complete) that teaches a candidate exactly what they need to know to fix ONE specific interview weakness. Return strict JSON only, no prose, no markdown fences, in this exact shape:
{
  "title": "", "why_it_matters": "",
  "core_knowledge": [{"point": "", "grounded": true}],
  "key_points": [""], "example_answer_snippet": "", "interview_application": "",
  "quick_check": [{"question": "", "options": ["",""], "correct_index": 0, "explanation": ""}],
  "grounding_note": ""
}
Rules: mini study guide, not an essay. core_knowledge 3-5 points, key_points 3-5, quick_check 2-3 questions with 3-4 options each. "grounded" is true only for points you are confident are accurate and current; mark false for general guidance and never present an unverified company fact as confirmed. If you can't establish reliable specifics, say so in grounding_note and stay general. example_answer_snippet shows how to use the knowledge, not fabricated achievements. Match depth to the candidate's level given.`,
    userText: `Weakness topic: Structuring behavioural answers with the STAR method
Category: technique
Weakness as identified: Answers jump straight to the outcome without setting up the situation or task, so the interviewer can't follow the candidate's specific contribution.
Company: Northwind Capital Partners
Role: Investment Banking Summer Analyst
Related interview question: "Tell me about a time you worked under pressure."
Candidate level: Penultimate-year undergraduate, some internship experience

General interview-technique or subject-matter topic; no need to search.`,
    maxTokens: 2200,
    validate: (parsed) => validateLesson(parsed),
    inputSummary: "A technique-only lesson topic (no company facts to verify) — the exact case hybrid routing would send to DeepSeek. Web-search lessons are excluded by design.",
    requestType: "classroom_lesson",
  },
  {
    // Faithful copy of the development_module system prompt (openDevelopmentModule,
    // App.jsx, module-private). The two runtime placeholder branches are resolved
    // to the common case: an "area to prepare" (not a demonstrated weakness), with
    // enough company/role context that no data-limitation caveat is needed.
    testName: "8. Development module generation — learning guide + flashcards + written quiz",
    taskName: "Development module generation (DCF valuation fundamentals)",
    system: `You are a specialist interview-preparation tutor. Generate ONE reusable development module that will power a learning guide, flashcards and a written quiz WITHOUT any further AI call. Return strict JSON only, no prose, no markdown fences, in this exact shape:
{
  "topic": "",
  "why_it_matters": "",
  "context_note": "",
  "learning_guide": { "core_explanation": "", "frameworks": [""], "examples": [""], "common_mistakes": [""], "application_context": "" },
  "learning_items": [
    { "concept": "", "explanation": "",
      "flashcard_front": "", "flashcard_back": "",
      "quiz_question": "", "model_answer": "", "review": "",
      "expected_concepts": [ { "concept": "", "accepted_terms": ["",""], "aliases": ["",""], "definition": "", "required": true } ] }
  ]
}
Rules: EXACTLY 4 learning_items, each ONE atomic idea — do not exceed 4. Keep it tight: "explanation" 2-3 sentences, "flashcard_back" 1-2 sentences, "model_answer" 3-4 sentences, "review" 2-3 sentences. flashcard_front is a short question. quiz_question is open / free-response — NEVER multiple choice.
expected_concepts: 2-4 atomic ideas per quiz answer. These drive DETERMINISTIC (non-AI) marking, so be precise and literal. For each concept:
 - "concept": a 2-5 word noun phrase naming the idea (not a bare generic word like "value" or "process").
 - "accepted_terms": 2-4 alternative WORDINGS a correct student might genuinely write for this same idea — true synonyms and standard phrasings only.
 - "aliases": abbreviations / initialisms AND their expansions (e.g. "DCF" and "discounted cash flow"), plus UK/US spelling variants if relevant (e.g. "amortisation", "amortization"). Omit or leave [] if none apply.
 - "definition": ONE plain-language sentence stating the idea in different words from "concept" — used as a tolerant fallback when the student paraphrases. Keep it concrete and specific to this idea.
 - "required": true for a concept the answer MUST express to be complete; false for a supporting/optional concept that is good to mention but not essential. Mark 2-3 as required and any extras as optional.
Never invent an alias that is not genuinely equivalent. "review" is the model knowledge to show after marking. learning_guide.frameworks/examples/common_mistakes: at most 3 short bullets each. why_it_matters: this is an AREA TO PREPARE for this application; it is NOT a demonstrated weakness — say exactly that. context_note: leave it an empty string unless a genuine data-limitation caveat is needed. Do not use web search. Match depth to the candidate level given.`,
    userText: `Development need: DCF valuation fundamentals
Dimension: technical
Diagnosis / description: Area to prepare for this M&A Advisory role — the candidate should be able to walk through a DCF end to end and defend each assumption.
Original interview question: n/a
Company: Northwind Capital Partners
Role: Investment Banking Summer Analyst
Candidate level: Penultimate-year undergraduate, some internship experience`,
    maxTokens: 6000,
    validate: (parsed) => validateDevelopmentModule(parsed),
    inputSummary: "Technical learning module — large structured output (4 items x flashcard + open quiz + expected_concepts for deterministic marking). The expected_concepts precision is the thing to eyeball.",
    requestType: "development_module",
  },
];

describe("DeepSeek vs. Claude quality benchmark", () => {
  BENCHMARK_TASKS.forEach((task) => {
    it.skipIf(!LIVE_ENABLED)(task.testName, async () => {
      await runTask(task.taskName, task);
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
    // Phase 41B: the three added priority tasks (interview_profile / classroom_lesson / development_module)
    expect(typeof validateProfile).toBe("function");
    expect(typeof validateLesson).toBe("function");
    expect(typeof validateDevelopmentModule).toBe("function");
    // Phase 37: the benchmark's routing-preview line uses the SAME centralized routing
    // function index.ts calls, and every task's requestType really is one of the 11 known
    // types (so a real run's "hybrid mode routes this to: ..." line reflects the actual
    // production policy, not a made-up label).
    expect(typeof selectProviderForRequest).toBe("function");
    const decision = selectProviderForRequest({ requestType: "interview_question_batch", useWebSearch: false, configuredProvider: undefined });
    expect(decision.provider).toBe("deepseek");
    // Phase 41B: the six benchmarked priority types are exactly the ones hybrid mode fast-routes
    // to DeepSeek; the two exploratory types stay on Anthropic regardless of benchmark result.
    ["interview_profile", "classroom_lesson", "development_module", "assessment_centre_scenario", "invitation_extraction"].forEach((rt) => {
      expect(selectProviderForRequest({ requestType: rt, useWebSearch: false, configuredProvider: undefined }).provider).toBe("deepseek");
    });
    ["interview_turn_evaluate", "interview_report"].forEach((rt) => {
      expect(selectProviderForRequest({ requestType: rt, useWebSearch: false, configuredProvider: undefined }).provider).toBe("anthropic");
    });
    // The hoisted task table (consumed by both the provider comparison and the
    // opt-in JSON-mode experiment) still has exactly the 8 expected specs, with
    // the same requestTypes and max_tokens the inline blocks used — a cheap guard
    // that a future edit didn't drop, reorder or retune a benchmark task.
    expect(BENCHMARK_TASKS.map((t) => t.requestType)).toEqual([
      "interview_question_batch", "interview_turn_evaluate", "invitation_extraction",
      "assessment_centre_scenario", "interview_report", "interview_profile",
      "classroom_lesson", "development_module",
    ]);
    expect(BENCHMARK_TASKS.map((t) => t.maxTokens)).toEqual([3000, 900, 1600, 1400, 3000, 6000, 2200, 6000]);
    BENCHMARK_TASKS.forEach((t) => {
      expect(typeof t.system).toBe("string");
      expect(t.system.length).toBeGreaterThan(0);
      expect(typeof t.userText).toBe("string");
      expect(t.userText.length).toBeGreaterThan(0);
      expect(typeof t.validate).toBe("function");
    });
    if (!LIVE_ENABLED) {
      console.log("\n[deepseekBenchmarkLive] RUN_DEEPSEEK_BENCHMARK is not set — live benchmark tasks skipped, as expected for `npm test`. Run `npm run benchmark:deepseek` (with ANTHROPIC_API_KEY / DEEPSEEK_API_KEY set) to actually compare providers.");
    }
  });
});

/* ================================================================== *
 * DEEPSEEK JSON-MODE / THINKING-MODE EXPERIMENT  (opt-in, read-only)
 * ------------------------------------------------------------------
 * WHY: a live `npm run benchmark:deepseek` showed 6 of 8 DeepSeek tasks
 * failing structural validation, most having consumed exactly their
 * max_tokens, with chain-of-thought text leaking into the output. Per the
 * current DeepSeek docs, deepseek-v4-flash runs THINKING MODE ON BY
 * DEFAULT at reasoning_effort "high", returns the chain-of-thought in a
 * separate `reasoning_content` field, and those reasoning tokens count
 * toward the same max_tokens budget — so a tight max_tokens is exhausted
 * during reasoning and the JSON answer is truncated (finish_reason
 * "length") or empty.
 *
 * WHAT THIS IS: a purely observational experiment that re-runs the SAME 8
 * BENCHMARK_TASKS above (same system/userText/maxTokens/validator — nothing
 * changed) against DeepSeek under three request configurations, and prints
 * the full diagnostic surface the normal harness hides (finish_reason, the
 * whole usage object incl. reasoning tokens, reasoning_content length).
 *
 * WHAT THIS IS NOT: it does NOT touch providers.ts, index.ts, routing,
 * prompts, validators, AI_PROVIDER, Supabase secrets or any deployed
 * function. `callDeepSeekVariantRaw` below is a local raw fetch, not an
 * edit to callDeepSeekProvider. Nothing here changes production behaviour;
 * it only gathers evidence for a later decision.
 *
 * RUN IT (opt-in — a normal `npm test` / `npm run benchmark:deepseek`
 * never touches this block):
 *   RUN_DEEPSEEK_JSON_EXPERIMENT=1 DEEPSEEK_API_KEY=... \
 *     npx vitest run src/deepseekBenchmarkLive.test.js -t "JSON-mode experiment"
 * (24 live calls, sequential — can take 10-20 min; the test's own timeout
 * is raised to 30 min below, overriding the file's 90s default.)
 * ================================================================== */
const JSON_EXPERIMENT_ENABLED = process.env.RUN_DEEPSEEK_JSON_EXPERIMENT === "1";

// Same model id and endpoint production uses (read-only copy — DEEPSEEK_MODEL
// / DEEPSEEK_URL in providers.ts are not exported, and importing is beside the
// point: this experiment deliberately builds its own request so it can add the
// response_format / thinking levers without any change to the shared caller).
const DEEPSEEK_EXPERIMENT_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_EXPERIMENT_MODEL = "deepseek-v4-flash";

// The three configurations under test. `baseline` sends the EXACT body
// callDeepSeekProvider sends today (model + max_tokens + messages, nothing
// else). The other two add one lever each.
const JSON_EXPERIMENT_VARIANTS = [
  { key: "baseline",              label: "baseline (current config)",          responseFormat: false, thinking: null },
  { key: "json_mode",             label: "json_mode (response_format only)",   responseFormat: true,  thinking: null },
  { key: "json_mode_no_thinking", label: "json_mode + thinking disabled",      responseFormat: true,  thinking: { type: "disabled" } },
];

// Local raw caller — NOT imported from / NOT a modification to providers.ts.
// Returns the parsed raw response so the experiment can read finish_reason,
// usage (incl. reasoning tokens) and message.reasoning_content directly.
async function callDeepSeekVariantRaw(apiKey, { system, userText, maxTokens }, variant) {
  const body = {
    model: DEEPSEEK_EXPERIMENT_MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userText },
    ],
  };
  if (variant.responseFormat) body.response_format = { type: "json_object" };
  if (variant.thinking) body.thinking = variant.thinking;

  const t0 = Date.now();
  const res = await fetch(DEEPSEEK_EXPERIMENT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - t0;
  let raw = null;
  try { raw = await res.json(); } catch { /* leave raw null — logged below */ }
  return { httpOk: res.ok, httpStatus: res.status, latencyMs, raw };
}

function pickReasoningTokens(usage) {
  if (!usage || typeof usage !== "object") return null;
  return (
    usage?.completion_tokens_details?.reasoning_tokens ??
    usage?.reasoning_tokens ??
    null
  );
}

describe("DeepSeek JSON-mode experiment", () => {
  it.skipIf(!JSON_EXPERIMENT_ENABLED)(
    "baseline vs json_mode vs json_mode_no_thinking — all 8 tasks, full diagnostics",
    async () => {
      if (!DEEPSEEK_KEY) {
        console.log("\n[json-experiment] SKIPPED — DEEPSEEK_API_KEY not set. Provide it to run the 24-call experiment.");
        return;
      }

      const rows = [];
      for (const task of BENCHMARK_TASKS) {
        section(`EXPERIMENT TASK: ${task.taskName}  (requestType=${task.requestType}, max_tokens=${task.maxTokens})`);
        for (const variant of JSON_EXPERIMENT_VARIANTS) {
          const row = {
            task: task.taskName, requestType: task.requestType, maxTokens: task.maxTokens,
            variant: variant.key,
            latencyMs: null, finishReason: null, httpStatus: null,
            promptTokens: null, completionTokens: null, reasoningTokens: null,
            contentLen: null, reasoningLen: null, parseOk: false, validationOk: false, validationError: null,
          };
          try {
            const { httpOk, httpStatus, latencyMs, raw } = await callDeepSeekVariantRaw(DEEPSEEK_KEY, task, variant);
            row.latencyMs = latencyMs;
            row.httpStatus = httpStatus;

            const choice = Array.isArray(raw?.choices) ? raw.choices[0] : null;
            const message = choice?.message ?? {};
            const content = typeof message.content === "string" ? message.content : "";
            const reasoning = typeof message.reasoning_content === "string" ? message.reasoning_content : "";
            const usage = raw?.usage ?? null;

            row.finishReason = choice?.finish_reason ?? (httpOk ? "(none)" : `http_${httpStatus}`);
            row.promptTokens = usage?.prompt_tokens ?? null;
            row.completionTokens = usage?.completion_tokens ?? null;
            row.reasoningTokens = pickReasoningTokens(usage);
            row.contentLen = content.length;
            row.reasoningLen = reasoning.length;

            const clean = content.replace(/```json/g, "").replace(/```/g, "").trim();
            let parsed;
            try { parsed = JSON.parse(clean); row.parseOk = true; } catch { row.parseOk = false; }
            if (row.parseOk) {
              try { task.validate(parsed); row.validationOk = true; }
              catch (e) { row.validationError = e.message; }
            }

            console.log(`\n[${variant.label}]`);
            console.log(`  http_status:      ${httpStatus}${httpOk ? "" : "  <-- non-OK"}`);
            console.log(`  finish_reason:    ${row.finishReason}`);
            console.log(`  latency_ms:       ${latencyMs}`);
            console.log(`  usage (full):     ${usage ? JSON.stringify(usage) : "n/a"}`);
            console.log(`  reasoning_tokens: ${row.reasoningTokens ?? "n/a"}`);
            console.log(`  content_length:   ${content.length}`);
            console.log(`  reasoning_length: ${reasoning.length}`);
            if (reasoning) console.log(`  reasoning[:240]:  ${reasoning.slice(0, 240).replace(/\s+/g, " ")}`);
            console.log(`  content[:600]:    ${clean.slice(0, 600).replace(/\s+/g, " ")}`);
            console.log(`  JSON.parse:       ${row.parseOk ? "PASS" : "FAIL"}`);
            console.log(`  structural_valid: ${row.validationOk ? "PASS" : `FAIL${row.validationError ? ` (${row.validationError})` : ""}`}`);
            if (!httpOk) console.log(`  error_body[:400]: ${JSON.stringify(raw).slice(0, 400)}`);
          } catch (e) {
            row.finishReason = "exception";
            row.validationError = e.message;
            console.log(`\n[${variant.label}] EXPERIMENT ERROR: ${e.message}`);
          }
          rows.push(row);
        }
      }

      // ---- summary table: per task x variant ----
      section("SUMMARY TABLE — task x variant");
      const header = [
        "task".padEnd(24), "variant".padEnd(21), "lat(ms)".padStart(8), "finish".padEnd(12),
        "prompt".padStart(7), "compl".padStart(7), "reason".padStart(7), "clen".padStart(6),
        "parse".padEnd(5), "valid".padEnd(5),
      ].join(" | ");
      console.log(header);
      console.log("-".repeat(header.length));
      for (const r of rows) {
        console.log([
          r.task.slice(0, 24).padEnd(24),
          r.variant.padEnd(21),
          String(r.latencyMs ?? "ERR").padStart(8),
          String(r.finishReason ?? "-").slice(0, 12).padEnd(12),
          String(r.promptTokens ?? "-").padStart(7),
          String(r.completionTokens ?? "-").padStart(7),
          String(r.reasoningTokens ?? "-").padStart(7),
          String(r.contentLen ?? "-").padStart(6),
          (r.parseOk ? "ok" : "FAIL").padEnd(5),
          (r.validationOk ? "ok" : "FAIL").padEnd(5),
        ].join(" | "));
      }

      // ---- per-variant aggregates across all 8 tasks ----
      section("SUMMARY — per-variant aggregates (n=8 tasks each)");
      for (const variant of JSON_EXPERIMENT_VARIANTS) {
        const vr = rows.filter((r) => r.variant === variant.key);
        const timed = vr.filter((r) => typeof r.latencyMs === "number");
        const avgLatency = timed.length
          ? Math.round(timed.reduce((s, r) => s + r.latencyMs, 0) / timed.length)
          : null;
        const structuralPasses = vr.filter((r) => r.validationOk).length;
        const parsePasses = vr.filter((r) => r.parseOk).length;
        const truncated = vr.filter((r) => r.finishReason === "length").length;
        console.log(
          `${variant.key.padEnd(21)}  ` +
          `avg_latency=${avgLatency ?? "n/a"}ms  ` +
          `structural_pass_rate=${structuralPasses}/${vr.length} (${Math.round((structuralPasses / vr.length) * 100)}%)  ` +
          `json_parse=${parsePasses}/${vr.length}  ` +
          `finish_reason=length: ${truncated}/${vr.length}`,
        );
      }

      // Observational test: assert only that every task x variant combination ran.
      expect(rows.length).toBe(BENCHMARK_TASKS.length * JSON_EXPERIMENT_VARIANTS.length);
    },
    30 * 60 * 1000, // 30-minute timeout — overrides the file-level 90s default for this long sequential run only.
  );

  it("json-experiment sanity check — always runs, never calls a live API", () => {
    expect(typeof callDeepSeekVariantRaw).toBe("function");
    expect(JSON_EXPERIMENT_VARIANTS.map((v) => v.key)).toEqual([
      "baseline", "json_mode", "json_mode_no_thinking",
    ]);
    // baseline must send NOTHING beyond today's body (no response_format, no thinking).
    expect(JSON_EXPERIMENT_VARIANTS[0]).toMatchObject({ responseFormat: false, thinking: null });
    expect(JSON_EXPERIMENT_VARIANTS[1]).toMatchObject({ responseFormat: true, thinking: null });
    expect(JSON_EXPERIMENT_VARIANTS[2]).toMatchObject({ responseFormat: true, thinking: { type: "disabled" } });
    if (!JSON_EXPERIMENT_ENABLED) {
      console.log("\n[json-experiment] RUN_DEEPSEEK_JSON_EXPERIMENT is not set — the 24-call experiment is skipped (expected for `npm test` and `npm run benchmark:deepseek`).");
    }
  });
});

/* ================================================================== *
 * DEEPSEEK PRODUCTION-PATH LIVE CHECK  (opt-in, DEEPSEEK_API_KEY only)
 * ------------------------------------------------------------------
 * PURPOSE: after enabling response_format:{type:"json_object"} +
 * thinking:{type:"disabled"} in callDeepSeekProvider, confirm the ACTUAL
 * production function (imported straight from
 * supabase/functions/ai-generate/providers.ts — NOT a local re-implementation,
 * NOT the experiment's raw caller) now returns output that PARSES as JSON and
 * PASSES the real product validator for every benchmark task.
 *
 * Unlike the "DeepSeek vs. Claude quality benchmark" block above, this needs
 * NO ANTHROPIC_API_KEY and calls ONLY DeepSeek. Unlike the JSON-mode
 * experiment, it does NOT build its own request body — it exercises exactly
 * the bytes callDeepSeekProvider sends in production today.
 *
 * It changes NO production code. It is one more opt-in describe block, gated
 * on its own env flag so `npm test`, `npm run benchmark:deepseek` and the
 * JSON-mode experiment are all completely unaffected.
 *
 * RUN IT (PowerShell):
 *   $env:DEEPSEEK_API_KEY = "<your-deepseek-key>"
 *   $env:RUN_DEEPSEEK_PROD_CHECK = "1"
 *   npx vitest run src/deepseekBenchmarkLive.test.js -t "DeepSeek production-path live check"
 *   Remove-Item Env:DEEPSEEK_API_KEY, Env:RUN_DEEPSEEK_PROD_CHECK
 *
 * RUN IT (bash):
 *   RUN_DEEPSEEK_PROD_CHECK=1 DEEPSEEK_API_KEY=... \
 *     npx vitest run src/deepseekBenchmarkLive.test.js -t "DeepSeek production-path live check"
 *
 * 8 live calls, one per task, sequential (~1-4 min total). Each task is its
 * own `it()` so a failure names the exact task and the validator message.
 * ================================================================== */
const PROD_CHECK_ENABLED = process.env.RUN_DEEPSEEK_PROD_CHECK === "1";

describe("DeepSeek production-path live check", () => {
  BENCHMARK_TASKS.forEach((task) => {
    it.skipIf(!PROD_CHECK_ENABLED)(
      `${task.testName} — callDeepSeekProvider output parses + passes ${task.requestType} validator`,
      async () => {
        if (!DEEPSEEK_KEY) {
          console.log(`\n[prod-check] SKIPPED "${task.taskName}" — DEEPSEEK_API_KEY not set.`);
          return;
        }

        const t0 = Date.now();
        // The REAL production function, with the REAL production request shape.
        const res = await callDeepSeekProvider(DEEPSEEK_KEY, {
          system: task.system,
          userText: task.userText,
          maxTokens: task.maxTokens,
          useWebSearch: false,
        });
        const latencyMs = Date.now() - t0;

        const text = (res.content || []).map((b) => b.text || "").join("\n");
        const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();

        let parsed;
        let parseError = null;
        try { parsed = JSON.parse(clean); } catch (e) { parseError = e.message; }

        let validationError = null;
        if (parsed !== undefined) {
          try { task.validate(parsed); } catch (e) { validationError = e.message; }
        }

        section(`PROD-CHECK: ${task.taskName}  (requestType=${task.requestType}, max_tokens=${task.maxTokens})`);
        console.log(`  normalized stop_reason: ${res.stop_reason}`);
        console.log(`  usage (input/output):   ${res.usage?.input_tokens ?? "?"} / ${res.usage?.output_tokens ?? "?"}`);
        console.log(`  latency_ms:             ${latencyMs}`);
        console.log(`  content_length:         ${text.length}`);
        console.log(`  JSON.parse:             ${parseError ? `FAIL (${parseError})` : "PASS"}`);
        console.log(`  structural_validation:  ${parsed === undefined ? "N/A (parse failed)" : validationError ? `FAIL (${validationError})` : "PASS"}`);
        console.log(`  content[:600]:          ${clean.slice(0, 600).replace(/\s+/g, " ")}`);

        // Hard assertions — this is a real pass/fail test, not observational.
        expect(res.stop_reason).not.toBe("max_tokens"); // reasoning tokens must no longer be exhausting the budget
        expect(parseError, `DeepSeek output for "${task.taskName}" did not parse as JSON`).toBeNull();
        expect(
          validationError,
          `DeepSeek output for "${task.taskName}" failed the ${task.requestType} structural validator`,
        ).toBeNull();
      },
      120_000, // 120s per task — one live DeepSeek call with thinking disabled should be well under this.
    );
  });

  it("prod-check sanity check — always runs, never calls a live API", () => {
    // Uses the SAME production function the live checks above call.
    expect(typeof callDeepSeekProvider).toBe("function");
    expect(BENCHMARK_TASKS).toHaveLength(8);
    if (!PROD_CHECK_ENABLED) {
      console.log("\n[prod-check] RUN_DEEPSEEK_PROD_CHECK is not set — the 8 live production-path checks are skipped (expected for `npm test` and `npm run benchmark:deepseek`).");
    }
  });
});
