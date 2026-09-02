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
      model: "deepseek-chat",
      choices: [{ message: { content: '{"questions":[]}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: 40 },
    });
    expect(n.content).toEqual([{ type: "text", text: '{"questions":[]}' }]);
    expect(n.stop_reason).toBe("end_turn"); // OpenAI "stop" -> the Anthropic-shaped vocabulary callClaude() expects
    expect(n.usage).toEqual({ input_tokens: 120, output_tokens: 40 });
    expect(n.model).toBe("deepseek-chat");
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

/* ============================== security ============================== */
describe("security — no client-exposed provider secrets", () => {
  it("this module never reads a VITE_-prefixed env var (those are bundled into the browser build)", () => {
    const src = String(callAIProvider) + String(callAnthropicProvider) + String(callDeepSeekProvider) + String(selectProvider);
    expect(src).not.toMatch(/VITE_/);
  });
  it("provider/keys are plain function parameters, never read from import.meta.env, process.env or Deno.env directly in this module's CODE — the caller (index.ts) supplies them; only prose comments may mention Deno.env", () => {
    const src = readFileSync(new URL("./providers.ts", import.meta.url), "utf8");
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/import\.meta\.env|process\.env|Deno\.env/);
  });
});
