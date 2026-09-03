/* ================================================================== *
 * PHASE 36 — AI PROVIDER ABSTRACTION TEST SUITE
 * ------------------------------------------------------------------
 * providers.ts has no Deno-specific imports (no `jsr:` specifiers, no
 * `Deno.*` globals), so — unlike index.ts, which Deno.serve()s and imports
 * jsr: packages Node/Vitest can't resolve — it can be imported and executed
 * directly here. These are REAL executable tests against real function
 * calls with a mocked `fetch`, not source-text/structural assertions.
 * ================================================================== */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  ANTHROPIC_MODEL, DEEPSEEK_MODEL,
  normalizeAnthropicResponse, normalizeDeepSeekResponse,
  callAnthropicProvider, callDeepSeekProvider,
  selectProvider, callAIProvider,
  ProviderHttpError, ProviderCapabilityError,
  // Phase 37 — hybrid, per-request-type routing
  KNOWN_REQUEST_TYPES, REQUEST_TYPE_ROUTING_POLICY, selectProviderForRequest,
} from "./providers.ts";

function fakeFetch(status, body, ok = status >= 200 && status < 300) {
  return vi.fn().mockResolvedValue({
    ok, status,
    json: async () => body,
  });
}

/* ============================== normalization (pure) ============================== */
describe("normalizeAnthropicResponse — passthrough shape (unchanged from pre-Phase-36 behaviour)", () => {
  it("normal text response", () => {
    const n = normalizeAnthropicResponse({ content: [{ type: "text", text: '{"ok":true}' }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, model: "claude-sonnet-4-6" });
    expect(n.content).toEqual([{ type: "text", text: '{"ok":true}' }]);
    expect(n.stop_reason).toBe("end_turn");
    expect(n.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
    expect(n.model).toBe("claude-sonnet-4-6");
  });
  it("missing/malformed fields degrade safely, never throw", () => {
    expect(() => normalizeAnthropicResponse({})).not.toThrow();
    const n = normalizeAnthropicResponse({});
    expect(n.content).toEqual([]);
    expect(n.stop_reason).toBe("end_turn");
    expect(n.usage).toEqual({ input_tokens: null, output_tokens: null });
    expect(n.model).toBe(ANTHROPIC_MODEL);
    expect(() => normalizeAnthropicResponse(null)).not.toThrow();
  });
  it("max_tokens truncation is preserved through normalization (callClaude's own truncation check depends on this exact string)", () => {
    expect(normalizeAnthropicResponse({ stop_reason: "max_tokens", content: [] }).stop_reason).toBe("max_tokens");
  });
});

describe("normalizeDeepSeekResponse — OpenAI-shaped response mapped into the SAME normalized shape", () => {
  it("normal text / valid JSON content", () => {
    const n = normalizeDeepSeekResponse({
      model: "deepseek-v4-flash",
      choices: [{ message: { content: '{"questions":[]}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: 40 },
    });
    expect(n.content).toEqual([{ type: "text", text: '{"questions":[]}' }]);
    expect(n.stop_reason).toBe("end_turn"); // OpenAI "stop" -> the Anthropic-shaped vocabulary callClaude() expects
    expect(n.usage).toEqual({ input_tokens: 120, output_tokens: 40 });
    expect(n.model).toBe("deepseek-v4-flash"); // whatever the API echoes back passes straight through
  });
  it("finish_reason 'length' maps to 'max_tokens' — callClaude()'s truncation check (`stop_reason === 'max_tokens'`) fires identically regardless of provider", () => {
    const n = normalizeDeepSeekResponse({ choices: [{ message: { content: "..." }, finish_reason: "length" }] });
    expect(n.stop_reason).toBe("max_tokens");
  });
  it("missing/malformed response (no choices, no message) degrades to empty content, never throws", () => {
    expect(() => normalizeDeepSeekResponse({})).not.toThrow();
    const n = normalizeDeepSeekResponse({});
    expect(n.content).toEqual([]);
    expect(n.model).toBe(DEEPSEEK_MODEL);
    expect(() => normalizeDeepSeekResponse(null)).not.toThrow();
    expect(() => normalizeDeepSeekResponse({ choices: [] })).not.toThrow();
  });
  it("an unrecognised finish_reason passes through unmapped rather than being coerced — only 'stop'/'length' are given special meaning", () => {
    const n = normalizeDeepSeekResponse({ choices: [{ message: { content: "x" }, finish_reason: "content_filter" }] });
    expect(n.stop_reason).toBe("content_filter");
  });
});

/* ============================== DEEPSEEK_MODEL — API compatibility (Phase 41A) ============================== */
describe("DEEPSEEK_MODEL is a currently-valid DeepSeek model id, not a retired pre-V4 alias", () => {
  // Verified against the official DeepSeek API reference on 2026-09-03:
  //   https://api-docs.deepseek.com/api/create-chat-completion  — accepted `model` values
  //   https://api-docs.deepseek.com/updates  — `deepseek-chat`/`deepseek-reasoner` discontinued 2026-07-24
  const CURRENT_DEEPSEEK_MODEL_IDS = ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash-vision-exp"];

  it("is one of the model ids the official chat-completions API currently accepts", () => {
    expect(CURRENT_DEEPSEEK_MODEL_IDS).toContain(DEEPSEEK_MODEL);
  });
  it("is never the discontinued `deepseek-chat` / `deepseek-reasoner` alias", () => {
    expect(DEEPSEEK_MODEL).not.toBe("deepseek-chat");
    expect(DEEPSEEK_MODEL).not.toBe("deepseek-reasoner");
  });
  it("is the cost-efficient `deepseek-v4-flash` default (not the ~3x-priced pro tier or the vision-experimental variant)", () => {
    expect(DEEPSEEK_MODEL).toBe("deepseek-v4-flash");
  });
  it("callDeepSeekProvider sends exactly that model id in the request body", async () => {
    const fetchImpl = fakeFetch(200, { choices: [{ message: { content: "{}" }, finish_reason: "stop" }] });
    await callDeepSeekProvider("k", { system: "s", userText: "u", maxTokens: 100, useWebSearch: false }, fetchImpl);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.model).toBe(DEEPSEEK_MODEL);
    expect(body.model).toBe("deepseek-v4-flash");
  });
});

/* ============================== provider calls (mocked fetch) ============================== */
describe("callAnthropicProvider", () => {
  const req = { system: "sys", userText: "hi", maxTokens: 500, useWebSearch: false };

  it("valid JSON response round-trips through the normalizer", async () => {
    const fetchImpl = fakeFetch(200, { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, model: ANTHROPIC_MODEL });
    const result = await callAnthropicProvider("test-key", req, fetchImpl);
    expect(result.content[0].text).toBe("{}");
    // key sent as Anthropic's own header, never as an OpenAI-style Bearer token
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers["x-api-key"]).toBe("test-key");
    expect(init.headers["Authorization"]).toBeUndefined();
  });
  it("useWebSearch adds the Anthropic server-side web_search tool", async () => {
    const fetchImpl = fakeFetch(200, { content: [], stop_reason: "end_turn" });
    await callAnthropicProvider("k", { ...req, useWebSearch: true }, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.tools).toEqual([{ type: "web_search_20250305", name: "web_search" }]);
  });
  it("API error (non-2xx) throws a typed ProviderHttpError carrying the status", async () => {
    const fetchImpl = fakeFetch(429, { error: { message: "rate limited" } });
    await expect(callAnthropicProvider("k", req, fetchImpl)).rejects.toBeInstanceOf(ProviderHttpError);
    try { await callAnthropicProvider("k", req, fetchImpl); } catch (e) { expect(e.status).toBe(429); }
  });
  it("network failure (fetch itself rejects — the timeout/connection-error case) propagates, not swallowed", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(callAnthropicProvider("k", req, fetchImpl)).rejects.toThrow("network down");
  });
});

describe("callDeepSeekProvider", () => {
  const req = { system: "sys", userText: "hi", maxTokens: 500, useWebSearch: false };

  it("valid JSON response round-trips through the normalizer", async () => {
    const fetchImpl = fakeFetch(200, { choices: [{ message: { content: '{"a":1}' }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 4 }, model: DEEPSEEK_MODEL });
    const result = await callDeepSeekProvider("test-key", req, fetchImpl);
    expect(result.content[0].text).toBe('{"a":1}');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    // OpenAI-style Bearer auth, never Anthropic's x-api-key
    expect(init.headers["Authorization"]).toBe("Bearer test-key");
    expect(init.headers["x-api-key"]).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body.model).toBe(DEEPSEEK_MODEL);
    expect(body.messages).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "hi" }]);
  });
  it("useWebSearch is rejected with a typed capability error — this integration never silently drops the search requirement", async () => {
    await expect(callDeepSeekProvider("k", { ...req, useWebSearch: true })).rejects.toBeInstanceOf(ProviderCapabilityError);
  });
  it("malformed JSON in the message content is passed through as text — extraction/parsing stays callClaude()'s job, not the provider layer's", async () => {
    const fetchImpl = fakeFetch(200, { choices: [{ message: { content: "```json\n{\"a\":1}\n```" }, finish_reason: "stop" }] });
    const result = await callDeepSeekProvider("k", req, fetchImpl);
    expect(result.content[0].text).toContain("```json");
  });
  it("API error (non-2xx) throws a typed ProviderHttpError carrying the status", async () => {
    const fetchImpl = fakeFetch(500, { error: { message: "server error" } });
    await expect(callDeepSeekProvider("k", req, fetchImpl)).rejects.toBeInstanceOf(ProviderHttpError);
  });
  it("network failure (fetch itself rejects) propagates", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(callDeepSeekProvider("k", req, fetchImpl)).rejects.toThrow("timeout");
  });
  it("never sends response_format — deliberately omitted (see providers.ts header note); asserting it stays that way is itself the regression guard", async () => {
    const fetchImpl = fakeFetch(200, { choices: [{ message: { content: "{}" }, finish_reason: "stop" }] });
    await callDeepSeekProvider("k", req, fetchImpl);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.response_format).toBeUndefined();
  });
});

/* ============================== provider selection / dispatch ============================== */
describe("selectProvider — server-side only, defaults to anthropic", () => {
  it("undefined/unrecognised AI_PROVIDER defaults to anthropic (safe default — no config change required for existing deployments)", () => {
    expect(selectProvider(undefined, false)).toBe("anthropic");
    expect(selectProvider("", false)).toBe("anthropic");
    expect(selectProvider("bogus", false)).toBe("anthropic");
  });
  it('AI_PROVIDER="deepseek" selects deepseek', () => {
    expect(selectProvider("deepseek", false)).toBe("deepseek");
  });
  it("useWebSearch always forces anthropic, even when the configured default is deepseek", () => {
    expect(selectProvider("deepseek", true)).toBe("anthropic");
  });
});

describe("callAIProvider — the one entry point index.ts calls", () => {
  const req = { system: "s", userText: "u", maxTokens: 400, useWebSearch: false };

  it("default env (no AI_PROVIDER set) routes to Anthropic and tags the result", async () => {
    const fetchImpl = fakeFetch(200, { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", model: ANTHROPIC_MODEL });
    const result = await callAIProvider({ ANTHROPIC_API_KEY: "k" }, req, fetchImpl);
    expect(result.provider).toBe("anthropic");
    expect(result.content[0].text).toBe("ok");
  });
  it('AI_PROVIDER="deepseek" with DEEPSEEK_API_KEY set routes to DeepSeek and tags the result', async () => {
    const fetchImpl = fakeFetch(200, { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
    const result = await callAIProvider({ AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "k" }, req, fetchImpl);
    expect(result.provider).toBe("deepseek");
  });
  it('AI_PROVIDER="deepseek" but DEEPSEEK_API_KEY missing fails loudly rather than silently falling back to a different provider unannounced', async () => {
    await expect(callAIProvider({ AI_PROVIDER: "deepseek" }, req)).rejects.toThrow(/DEEPSEEK_API_KEY/);
  });
  it("ANTHROPIC_API_KEY missing (default provider) fails loudly", async () => {
    await expect(callAIProvider({}, req)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
  it("a useWebSearch request is routed to Anthropic even when AI_PROVIDER=deepseek, and fails clearly if only the DeepSeek key is configured (no silent cross-provider key reuse)", async () => {
    await expect(callAIProvider({ AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "k" }, { ...req, useWebSearch: true })).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

/* ============================== Phase 37: hybrid per-request-type routing ============================== */
describe("KNOWN_REQUEST_TYPES / REQUEST_TYPE_ROUTING_POLICY — the verified inventory", () => {
  it("has exactly the 11 request types verified live against src/App.jsx, no more, no fewer", () => {
    expect(KNOWN_REQUEST_TYPES).toHaveLength(11);
    expect([...KNOWN_REQUEST_TYPES].sort()).toEqual([
      "assessment_centre", "assessment_centre_scenario", "classroom_lesson",
      "development_module", "interview_batch_evaluation", "interview_profile",
      "interview_question_batch", "interview_report", "interview_turn_evaluate",
      "interview_turn_generate", "invitation_extraction",
    ].sort());
  });
  it("every known request type has exactly one routing policy entry — nothing left implicit", () => {
    KNOWN_REQUEST_TYPES.forEach((t) => {
      expect(REQUEST_TYPE_ROUTING_POLICY[t]).toBeDefined();
      expect(["anthropic", "deepseek"]).toContain(REQUEST_TYPE_ROUTING_POLICY[t]);
    });
    expect(Object.keys(REQUEST_TYPE_ROUTING_POLICY)).toHaveLength(11);
  });
});

describe("selectProviderForRequest — hybrid mode (AI_PROVIDER unset)", () => {
  const FAST_TYPES = ["invitation_extraction", "interview_question_batch", "classroom_lesson", "development_module", "interview_profile", "assessment_centre_scenario"];
  const STRONG_TYPES = ["interview_turn_evaluate", "interview_turn_generate", "interview_batch_evaluation", "interview_report", "assessment_centre"];

  it("routes every fast/cost-efficient request type to deepseek", () => {
    FAST_TYPES.forEach((requestType) => {
      const decision = selectProviderForRequest({ requestType, useWebSearch: false, configuredProvider: undefined });
      expect(decision).toEqual({ provider: "deepseek", reason: "request_type_policy", mode: "hybrid", configWasInvalid: false });
    });
  });
  it("routes every strong/quality-critical request type to anthropic", () => {
    STRONG_TYPES.forEach((requestType) => {
      const decision = selectProviderForRequest({ requestType, useWebSearch: false, configuredProvider: undefined });
      expect(decision).toEqual({ provider: "anthropic", reason: "request_type_policy", mode: "hybrid", configWasInvalid: false });
    });
  });
  it("all 11 known types together cover the full FAST_TYPES + STRONG_TYPES partition with no overlap and no gap", () => {
    expect([...FAST_TYPES, ...STRONG_TYPES].sort()).toEqual([...KNOWN_REQUEST_TYPES].sort());
  });
  it('AI_PROVIDER="hybrid" (explicit) behaves identically to unset', () => {
    FAST_TYPES.forEach((requestType) => {
      expect(selectProviderForRequest({ requestType, useWebSearch: false, configuredProvider: "hybrid" }))
        .toEqual(selectProviderForRequest({ requestType, useWebSearch: false, configuredProvider: undefined }));
    });
  });
  it("an unknown/missing requestType safely defaults to anthropic rather than an arbitrary cheap provider", () => {
    expect(selectProviderForRequest({ requestType: "some_future_call_site", useWebSearch: false }))
      .toEqual({ provider: "anthropic", reason: "unknown_request_type_default", mode: "hybrid", configWasInvalid: false });
    expect(selectProviderForRequest({ requestType: undefined, useWebSearch: false }))
      .toEqual({ provider: "anthropic", reason: "unknown_request_type_default", mode: "hybrid", configWasInvalid: false });
    expect(selectProviderForRequest({ requestType: "unknown", useWebSearch: false })) // the literal fallback string App.jsx's callAI sends
      .toEqual({ provider: "anthropic", reason: "unknown_request_type_default", mode: "hybrid", configWasInvalid: false });
  });
});

describe("selectProviderForRequest — web-search override always wins", () => {
  it("classroom_lesson + useWebSearch=true routes to anthropic even though classroom_lesson normally routes to deepseek", () => {
    const decision = selectProviderForRequest({ requestType: "classroom_lesson", useWebSearch: true, configuredProvider: undefined });
    expect(decision).toEqual({ provider: "anthropic", reason: "web_search_override", mode: "hybrid", configWasInvalid: false });
  });
  it("the override applies to every fast-route request type, not just classroom_lesson, confirming it is a blanket rule and not special-cased per type", () => {
    ["invitation_extraction", "interview_question_batch", "development_module", "interview_profile", "assessment_centre_scenario"].forEach((requestType) => {
      expect(selectProviderForRequest({ requestType, useWebSearch: true, configuredProvider: undefined }).provider).toBe("anthropic");
    });
  });
  it("wins over an explicit AI_PROVIDER=deepseek forced mode too — the one case the phase spec calls out explicitly", () => {
    const decision = selectProviderForRequest({ requestType: "classroom_lesson", useWebSearch: true, configuredProvider: "deepseek" });
    expect(decision).toEqual({ provider: "anthropic", reason: "web_search_override", mode: "deepseek", configWasInvalid: false });
  });
  it("a strong-route type with web search stays on anthropic for the same reason web search chose it, not because it's already strong-routed", () => {
    const decision = selectProviderForRequest({ requestType: "interview_report", useWebSearch: true, configuredProvider: undefined });
    expect(decision.provider).toBe("anthropic");
    expect(decision.reason).toBe("web_search_override"); // not "request_type_policy" — web search is WHY, even though the policy would have agreed anyway
  });
});

describe("selectProviderForRequest — global AI_PROVIDER overrides", () => {
  it('AI_PROVIDER="anthropic" forces every request type to anthropic, including normally-deepseek ones', () => {
    KNOWN_REQUEST_TYPES.forEach((requestType) => {
      const decision = selectProviderForRequest({ requestType, useWebSearch: false, configuredProvider: "anthropic" });
      expect(decision).toEqual({ provider: "anthropic", reason: "global_override_anthropic", mode: "anthropic", configWasInvalid: false });
    });
  });
  it('AI_PROVIDER="deepseek" forces every eligible request type to deepseek, including normally-anthropic ones', () => {
    KNOWN_REQUEST_TYPES.forEach((requestType) => {
      const decision = selectProviderForRequest({ requestType, useWebSearch: false, configuredProvider: "deepseek" });
      expect(decision).toEqual({ provider: "deepseek", reason: "global_override_deepseek", mode: "deepseek", configWasInvalid: false });
    });
  });
  it('AI_PROVIDER="deepseek" + useWebSearch=true still forces anthropic — a global forced-DeepSeek config can never defeat the web-search guard', () => {
    const decision = selectProviderForRequest({ requestType: "interview_question_batch", useWebSearch: true, configuredProvider: "deepseek" });
    expect(decision.provider).toBe("anthropic");
    expect(decision.reason).toBe("web_search_override");
  });
});

describe("selectProviderForRequest — invalid/malformed configuration fails safely, not silently arbitrary", () => {
  it("an unrecognised AI_PROVIDER value falls back to hybrid mode (the same safe default unset gets), not an implicit deepseek-only or anthropic-only mode", () => {
    const decision = selectProviderForRequest({ requestType: "interview_report", useWebSearch: false, configuredProvider: "deepseak" }); // typo
    expect(decision.mode).toBe("hybrid");
    expect(decision.configWasInvalid).toBe(true);
    expect(decision.provider).toBe("anthropic"); // interview_report's own hybrid-mode policy entry — unaffected by the typo
  });
  it("an invalid AI_PROVIDER never silently routes a quality-critical request type to DeepSeek", () => {
    ["interview_turn_evaluate", "interview_turn_generate", "interview_batch_evaluation", "interview_report", "assessment_centre"].forEach((requestType) => {
      const decision = selectProviderForRequest({ requestType, useWebSearch: false, configuredProvider: "totally-bogus-value" });
      expect(decision.provider).toBe("anthropic");
      expect(decision.configWasInvalid).toBe(true);
    });
  });
  it("empty-string AI_PROVIDER is treated the same as unset (hybrid, not flagged invalid — an empty env var is indistinguishable from 'not configured')", () => {
    const decision = selectProviderForRequest({ requestType: "classroom_lesson", useWebSearch: false, configuredProvider: "" });
    expect(decision).toEqual({ provider: "deepseek", reason: "request_type_policy", mode: "hybrid", configWasInvalid: false });
  });
  it("configWasInvalid never changes the routing OUTCOME versus a genuinely unset AI_PROVIDER — only its own observability flag differs", () => {
    KNOWN_REQUEST_TYPES.forEach((requestType) => {
      const unset = selectProviderForRequest({ requestType, useWebSearch: false, configuredProvider: undefined });
      const invalid = selectProviderForRequest({ requestType, useWebSearch: false, configuredProvider: "garbage" });
      expect(invalid.provider).toBe(unset.provider);
      expect(invalid.reason).toBe(unset.reason);
      expect(invalid.mode).toBe(unset.mode);
      expect(unset.configWasInvalid).toBe(false);
      expect(invalid.configWasInvalid).toBe(true);
    });
  });
});

describe("callAIProvider — integrated with Phase 37 routing (real dispatch, mocked fetch)", () => {
  const baseReq = { system: "s", userText: "u", maxTokens: 400, useWebSearch: false };

  it("a fast-route requestType under hybrid mode actually dispatches to callDeepSeekProvider (real HTTP call shape), not just a routing-table lookup", async () => {
    const fetchImpl = fakeFetch(200, { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
    const result = await callAIProvider({ ANTHROPIC_API_KEY: "a", DEEPSEEK_API_KEY: "d" }, { ...baseReq, requestType: "classroom_lesson" }, fetchImpl);
    expect(result.provider).toBe("deepseek");
    expect(result.routingReason).toBe("request_type_policy");
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
  });
  it("a strong-route requestType under hybrid mode actually dispatches to callAnthropicProvider", async () => {
    const fetchImpl = fakeFetch(200, { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" });
    const result = await callAIProvider({ ANTHROPIC_API_KEY: "a", DEEPSEEK_API_KEY: "d" }, { ...baseReq, requestType: "interview_report" }, fetchImpl);
    expect(result.provider).toBe("anthropic");
    expect(result.routingReason).toBe("request_type_policy");
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
  });
  it("a fast-route requestType with only ANTHROPIC_API_KEY configured (no DEEPSEEK_API_KEY) fails clearly rather than silently falling back to Anthropic unannounced", async () => {
    await expect(callAIProvider({ ANTHROPIC_API_KEY: "a" }, { ...baseReq, requestType: "classroom_lesson" }))
      .rejects.toThrow(/DEEPSEEK_API_KEY/);
  });
  it("useWebSearch on a normally-deepseek requestType still dispatches to Anthropic end-to-end, and still requires ANTHROPIC_API_KEY specifically", async () => {
    await expect(callAIProvider({ DEEPSEEK_API_KEY: "d" }, { ...baseReq, requestType: "classroom_lesson", useWebSearch: true }))
      .rejects.toThrow(/ANTHROPIC_API_KEY/);
    const fetchImpl = fakeFetch(200, { content: [], stop_reason: "end_turn" });
    const result = await callAIProvider({ ANTHROPIC_API_KEY: "a", DEEPSEEK_API_KEY: "d" }, { ...baseReq, requestType: "classroom_lesson", useWebSearch: true }, fetchImpl);
    expect(result.provider).toBe("anthropic");
    expect(result.routingReason).toBe("web_search_override");
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.tools).toEqual([{ type: "web_search_20250305", name: "web_search" }]); // the actual search tool was requested, not silently dropped
  });
  it('AI_PROVIDER="deepseek" (forced) with an unknown requestType still routes to deepseek — global override outranks the request-type table entirely', async () => {
    const fetchImpl = fakeFetch(200, { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
    const result = await callAIProvider({ AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "d" }, { ...baseReq, requestType: "some_new_call_site" }, fetchImpl);
    expect(result.provider).toBe("deepseek");
    expect(result.routingReason).toBe("global_override_deepseek");
  });
  it("legacy callers that never pass requestType at all keep working exactly as before Phase 37 (defaults through hybrid's unknown-type bucket to anthropic)", async () => {
    const fetchImpl = fakeFetch(200, { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" });
    const result = await callAIProvider({ ANTHROPIC_API_KEY: "a" }, baseReq, fetchImpl); // no requestType field at all
    expect(result.provider).toBe("anthropic");
  });
});

/* ============================== security ============================== */
describe("security — no client-exposed provider secrets", () => {
  it("this module never reads a VITE_-prefixed env var (those are bundled into the browser build)", () => {
    const src = String(callAIProvider) + String(callAnthropicProvider) + String(callDeepSeekProvider) + String(selectProvider) + String(selectProviderForRequest);
    expect(src).not.toMatch(/VITE_/);
  });
  it("provider/keys are plain function parameters, never read from import.meta.env, process.env or Deno.env directly in this module's CODE — the caller (index.ts) supplies them; only prose comments may mention Deno.env", () => {
    const src = readFileSync(new URL("./providers.ts", import.meta.url), "utf8");
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/import\.meta\.env|process\.env|Deno\.env/);
  });
});
