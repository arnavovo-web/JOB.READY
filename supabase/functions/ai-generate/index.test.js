/* ================================================================== *
 * PHASE 36 — ai-generate/index.ts STRUCTURAL TEST SUITE
 * ------------------------------------------------------------------
 * index.ts imports `jsr:` specifiers and runs Deno.serve()/Deno.env.get()
 * at module scope — none of that resolves under Node/Vitest, so unlike
 * providers.ts (real executable tests, see providers.test.js) this file is
 * tested the same way the rest of this repo tests code that can't be
 * directly invoked in the test environment (App.jsx's React closure):
 * source-text inspection. Real security/normalization/dispatch LOGIC is
 * covered executably in providers.test.js — this file verifies index.ts
 * actually wires that logic in correctly and preserves everything it must.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ============================== security ============================== */
describe("security", () => {
  it("no VITE_-prefixed env var anywhere (those bundle into the browser)", () => {
    expect(SRC).not.toMatch(/VITE_/);
  });
  it("never logs an API key value — only ever the boolean fact that one is missing", () => {
    // every console.error/console.log call must not reference *_API_KEY as a value
    const logCalls = SRC.match(/console\.(error|log)\([^)]*\)/g) || [];
    for (const call of logCalls) expect(call).not.toMatch(/API_KEY\)/); // logging the variable itself
  });
  it("JWT auth check (supabase.auth.getUser) is still present and still gates the request before any provider call", () => {
    expect(SRC).toMatch(/supabase\.auth\.getUser\(\)/);
    const idxAuth = SRC.indexOf("supabase.auth.getUser()");
    const idxProvider = SRC.indexOf("callAIProvider(");
    // the LAST occurrence of callAIProvider( is the actual call site (first is the import)
    const idxProviderCall = SRC.lastIndexOf("callAIProvider(");
    expect(idxAuth).toBeGreaterThan(-1);
    expect(idxProviderCall).toBeGreaterThan(idxAuth);
  });
  it("AI_PROVIDER is read from Deno.env only — never accepted from the request body (no client-side provider selection)", () => {
    expect(SRC).toMatch(/AI_PROVIDER: Deno\.env\.get\("AI_PROVIDER"\)/);
    const bodyDestructure = SRC.match(/const \{ system, userText, maxTokens, useWebSearch, requestType, applicationId, interviewId \} = body \|\| \{\};/);
    expect(bodyDestructure).toBeTruthy();
    expect(bodyDestructure[0]).not.toMatch(/provider/i);
  });
  it("rate limiting (api_usage_limits) is unchanged — still enforced before the provider call", () => {
    expect(SRC).toMatch(/RATE_LIMIT_MAX_REQUESTS = 40/);
    expect(SRC).toMatch(/RATE_LIMIT_WINDOW_MINUTES = 10/);
    const idxLimit = SRC.indexOf('.from("api_usage_limits")');
    const idxProviderCall = SRC.lastIndexOf("callAIProvider(");
    expect(idxLimit).toBeGreaterThan(-1);
    expect(idxProviderCall).toBeGreaterThan(idxLimit);
  });
});

/* ============================== request contract preserved ============================== */
describe("request contract preserved", () => {
  it("still accepts exactly the same request body shape", () => {
    expect(SRC).toMatch(/const \{ system, userText, maxTokens, useWebSearch, requestType, applicationId, interviewId \} = body \|\| \{\};/);
  });
  it("still requires system/userText as strings, unchanged validation", () => {
    expect(SRC).toMatch(/typeof system !== "string" \|\| typeof userText !== "string"/);
  });
  it("maxTokens is still clamped to the same [200, 8000] range", () => {
    expect(SRC).toMatch(/Math\.max\(200, Math\.min\(8000, Number\(maxTokens\) \|\| 2000\)\)/);
  });
  it("still returns exactly { content, stop_reason } — the frontend's callClaude() needs zero changes", () => {
    expect(SRC).toMatch(/return json\(\{ content: result\.content, stop_reason: result\.stop_reason \}\);/);
  });
  it("requestType is NOT validated against an allowlist server-side — same as before Phase 36 (purely advisory/logging, enforced only by which call sites exist in App.jsx). This phase does not introduce new server-side restriction behaviour.", () => {
    expect(codeOnly(SRC)).not.toMatch(/ALLOWED_REQUEST_TYPES|requestType.*(?:not in|!== *")/);
  });
  it("CORS handling is unchanged", () => {
    expect(SRC).toMatch(/"Access-Control-Allow-Origin": "\*"/);
    expect(SRC).toMatch(/req\.method === "OPTIONS"/);
  });
});

/* ============================== provider dispatch wiring ============================== */
describe("provider dispatch wiring", () => {
  it("imports the provider abstraction (including Phase 37's routing function) from providers.ts rather than calling Anthropic inline", () => {
    expect(SRC).toMatch(/import \{ callAIProvider, selectProviderForRequest, ProviderHttpError, ProviderCapabilityError \} from "\.\/providers\.ts";/);
    expect(codeOnly(SRC)).not.toMatch(/https:\/\/api\.anthropic\.com/);
    expect(codeOnly(SRC)).not.toMatch(/https:\/\/api\.deepseek\.com/);
  });
  it("passes useWebSearch through unchanged (coerced to boolean)", () => {
    expect(SRC).toMatch(/useWebSearch: !!useWebSearch/);
  });
  it("handles ProviderHttpError, ProviderCapabilityError and network/misconfiguration failures distinctly (most-specific-first, per the skill's own error-handling guidance)", () => {
    expect(SRC).toMatch(/if \(e instanceof ProviderHttpError\)/);
    expect(SRC).toMatch(/if \(e instanceof ProviderCapabilityError\)/);
  });
  it("preserves the existing 429/5xx friendly-error-message mapping so the frontend's existing regex-based error handling (/rate\\|busy\\|quickly/i) keeps working unchanged", () => {
    expect(SRC).toMatch(/The AI service is busy right now\. Please try again shortly\./);
    expect(SRC).toMatch(/The AI service is temporarily unavailable\. Please try again\./);
  });
});

/* ============================== Phase 37: hybrid routing integration ============================== */
describe("Phase 37 — the real Edge Function path feeds requestType/useWebSearch into the routing decision", () => {
  it("requestType is threaded into the actual callAIProvider() call, not dropped at the Edge Function boundary", () => {
    const callSite = SRC.slice(SRC.indexOf("result = await callAIProvider("), SRC.indexOf("result = await callAIProvider(") + 220);
    expect(callSite).toMatch(/requestType/);
    expect(callSite).toMatch(/useWebSearch: !!useWebSearch/);
  });
  it("computes a routing preview from the SAME selectProviderForRequest providers.ts exports, fed by the real requestType/useWebSearch/AI_PROVIDER — not a re-derived or hard-coded copy", () => {
    expect(SRC).toMatch(/selectProviderForRequest\(\{\s*\n\s*requestType, useWebSearch: !!useWebSearch, configuredProvider: providerEnv\.AI_PROVIDER,/);
  });
  it("AI_PROVIDER (the routing-mode config) still comes from Deno.env only — the routing preview never reads it from the request body", () => {
    const idxPreview = SRC.indexOf("selectProviderForRequest({");
    const previewCall = SRC.slice(idxPreview, SRC.indexOf("});", idxPreview));
    expect(previewCall).toMatch(/providerEnv\.AI_PROVIDER/);
    expect(previewCall).not.toMatch(/body\.(AI_PROVIDER|provider)/);
  });
  it("index.ts itself never branches on requestType (no if/switch keyed on its value) — it only ever reads it back for logging; the routing DECISION stays entirely inside providers.ts", () => {
    const code = codeOnly(SRC);
    expect(code).not.toMatch(/if\s*\(\s*requestType\s*===/);
    expect(code).not.toMatch(/switch\s*\(\s*requestType\s*\)/);
  });
  it("logs a warning (not a hard failure) when AI_PROVIDER is configured but not one of the recognised values", () => {
    expect(SRC).toMatch(/routingPreview\.configWasInvalid/);
    expect(SRC).toMatch(/console\.warn\(/);
  });
  it("every failure path (HTTP error, capability error, network/misconfiguration) now records which provider was actually attempted, not just that something failed", () => {
    const errorBlock = SRC.slice(SRC.indexOf("} catch (e) {"), SRC.indexOf("// Phase 36: model is recorded"));
    expect(errorBlock).toMatch(/routingPreview\.provider/);
    expect(errorBlock.match(/model: attemptedModel/g)?.length).toBe(3); // ProviderHttpError, ProviderCapabilityError, network/misconfig — all three failure branches
  });
  it("a successful response still logs which provider actually served it and why, from the SAME result callAIProvider returned (never a second, possibly-stale lookup)", () => {
    expect(SRC).toMatch(/result\.provider/);
    expect(SRC).toMatch(/result\.routingReason/);
  });
});

/* ============================== usage logging (cost observability) ============================== */
describe("usage logging preserves the existing ai_usage table — no schema change", () => {
  it("logUsage still writes to the SAME columns as before Phase 36", () => {
    expect(SRC).toMatch(/\.from\("ai_usage"\)\.insert\(\{/);
    expect(SRC).toMatch(/request_type: opts\.requestType \|\| "unknown"/);
    expect(SRC).toMatch(/input_tokens: opts\.inputTokens \?\? null/);
    expect(SRC).toMatch(/output_tokens: opts\.outputTokens \?\? null/);
    // no new column referenced — provider is folded into the existing model text field
    expect(codeOnly(SRC)).not.toMatch(/provider: opts\.provider|provider:\s*result\.provider,/);
  });
  it("model is recorded as \"<provider>:<model id>\" — provider becomes observable without a migration", () => {
    expect(SRC).toMatch(/model: `\$\{result\.provider\}:\$\{result\.model\}`/);
  });
  it("estimated_cost is still left null (not guessed) — unchanged from before Phase 36", () => {
    expect(SRC).toMatch(/estimated_cost: null,.*not reliably computable/);
  });
});

/* ============================== regression: nothing unrelated changed ============================== */
describe("regression", () => {
  it("still a single Deno.serve(...) handler — no second entry point introduced", () => {
    expect((SRC.match(/Deno\.serve\(/g) || []).length).toBe(1);
  });
  it("still verifies the JWT via the anon-key + Authorization-header pattern (verify_jwt=true is a deploy-time setting, not code — this is the code-side half)", () => {
    expect(SRC).toMatch(/global: \{ headers: \{ Authorization: authHeader \} \}/);
  });
});
