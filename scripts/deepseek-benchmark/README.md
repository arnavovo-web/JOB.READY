# DeepSeek vs. Claude quality benchmark harness (Phase 36)

## What this is

A comparison harness for the 5 representative JOB.READY tasks called out in
the Phase 36 spec:

1. Interview question generation (Investment Banking Summer Analyst)
2. Answer evaluation (a realistic student answer)
3. Invitation extraction (a representative interview-invitation email)
4. Assessment Centre scenario generation
5. Interview report generation

For each task it calls **the same input** against both providers (via the
real `callAnthropicProvider` / `callDeepSeekProvider` functions in
`supabase/functions/ai-generate/providers.ts` — not a reimplementation),
runs the **same existing product validator** (`validateQuestionBatch`,
`validateEvaluationSignals`, `validateInvitationExtraction`,
`validateAcScenario`, `validateReport` — imported straight from `src/App.jsx`)
against each response, and prints a side-by-side comparison in the format
the spec asked for: input, both raw outputs, structural-validation pass/fail
for each, latency, and reported token usage.

## What it does NOT do

**It does not fabricate results.** If `ANTHROPIC_API_KEY` and/or
`DEEPSEEK_API_KEY` are not set in the environment it runs in, the harness
prints `SKIPPED — no API key configured` for that provider on every task and
exits without ever claiming a result it didn't actually get back from a real
API call. It was written and is checked into this repo, but **has not been
run with live keys** as part of Phase 36 — this sandbox has neither key
configured. See the Phase 36 report's "Quality benchmark" section for what
that means for the switch recommendation.

It also does not compute a dollar cost — see Step 11/12 of the report:
`estimated_cost` is deliberately left `null` in `ai_usage` (same as before
this phase) because current, accurate per-token pricing could not be
confirmed against DeepSeek's official documentation from this sandbox
(network egress to deepseek.com domains is blocked here — see the main
report). The harness prints raw `input_tokens`/`output_tokens` only.

## Running it

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export DEEPSEEK_API_KEY=sk-...       # optional — omit to see Claude-only output
node scripts/deepseek-benchmark/run.mjs
```

Output is plain text to stdout, formatted per-task as:

```
TASK
────────────────────
INPUT
...
CLAUDE OUTPUT
...
DEEPSEEK OUTPUT
...
STRUCTURAL VALIDATION
Claude: PASS
DeepSeek: PASS
LATENCY
Claude: 1234ms
DeepSeek: 987ms
TOKEN USAGE (input / output)
Claude: 512 / 340
DeepSeek: 498 / 355
```

**The structural-validation PASS/FAIL line is the only automated quality
signal.** It confirms the response is well-formed JSON with the required
fields in range — it says nothing about whether the questions are more
relevant, the feedback more specific, or the report more useful. That
judgement needs a human reading both outputs side by side — this harness
produces the side-by-side text specifically so a person can do that; it does
not (and cannot) do it for you. See Step 10 of the Phase 36 spec.
