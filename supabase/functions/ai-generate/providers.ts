// ================================================================================
// PHASE 36 — AI PROVIDER ABSTRACTION
// --------------------------------------------------------------------------------
// Deliberately split out of index.ts: this file has NO Deno-specific imports
// (no `jsr:` specifiers, no `Deno.*` globals) so it can be imported directly by
// the Vitest/Node test suite for REAL executable tests — not just structural
// source-text assertions. index.ts (the actual Deno.serve handler) imports this
// file for everything provider-related; it keeps only the Deno/Supabase glue
// (CORS, JWT/auth, rate limiting, usage logging, Deno.env reads).
//
// Every provider function accepts the SAME normalized input shape and returns
// the SAME normalized output shape:
//   input:  { system, userText, maxTokens, useWebSearch }
//   output: { content: [{ type: "text", text }], stop_reason, usage: { input_tokens, output_tokens }, model }
// That output shape is byte-for-byte what the frontend's callClaude() has
// always received from this function (`{ content, stop_reason }`, passed
// through unchanged) — so provider selection lives ENTIRELY here. The
// frontend needs zero changes regardless of which provider actually served
// a given request.
// ================================================================================

// ---- Anthropic ----
// Unchanged from the pre-Phase-36 implementation — same endpoint, same model,
// same request/response shape. This is the default, and remains the sole
// provider unless AI_PROVIDER is explicitly set to "deepseek" server-side.
export const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// ---- DeepSeek ----
// IMPORTANT — see the Phase 36 report ("DeepSeek integration research"): the
// official DeepSeek documentation domains (api-docs.deepseek.com,
// platform.deepseek.com, www.deepseek.com) were unreachable from the sandbox
// this integration was built in (network egress to those domains is blocked
// at the proxy level — confirmed, not a guess). The values below were
// cross-referenced from multiple independent secondary sources (SDK wrapper
// repos, tutorials mirroring the official quickstart) rather than the
// official docs directly, because the task instructions are explicit that
// guessing endpoints/models is unacceptable and fabricating "verified"
// status is worse than stating the gap plainly.
//   - Base URL: https://api.deepseek.com (OpenAI-compatible surface)
//   - Auth: `Authorization: Bearer <DEEPSEEK_API_KEY>` (OpenAI-style, NOT
//     Anthropic's `x-api-key` header)
//   - Chat completions endpoint: POST /chat/completions (OpenAI-compatible
//     request/response shape: messages[], choices[0].message.content,
//     usage.prompt_tokens / completion_tokens, choices[0].finish_reason)
// DO NOT deploy against this without first confirming the exact model ID,
// endpoint path, and current pricing directly against
// https://api-docs.deepseek.com from an environment that can reach it.
export const DEEPSEEK_MODEL = "deepseek-chat"; // UNVERIFIED against official docs — see above
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

export class ProviderCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderCapabilityError";
  }
}

export interface ProviderRequest {
  system: string;
  userText: string;
  maxTokens: number;
  useWebSearch: boolean;
}

export interface NormalizedContentBlock {
  type: "text";
  text: string;
}

export interface NormalizedResponse {
  content: NormalizedContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number | null; output_tokens: number | null };
  model: string;
}

// `fetchImpl` is injectable purely so the Vitest suite can exercise this
// logic with a mocked fetch — the real Edge Function always calls with the
// default (global `fetch`, Deno's native implementation).
type FetchImpl = typeof fetch;

// ---- Anthropic call + normalization ----
export function normalizeAnthropicResponse(data: any): NormalizedResponse {
  return {
    content: Array.isArray(data?.content) ? data.content : [],
    stop_reason: data?.stop_reason ?? "end_turn",
    usage: {
      input_tokens: data?.usage?.input_tokens ?? null,
      output_tokens: data?.usage?.output_tokens ?? null,
    },
    model: data?.model || ANTHROPIC_MODEL,
  };
}

export async function callAnthropicProvider(
  apiKey: string,
  req: ProviderRequest,
  fetchImpl: FetchImpl = fetch,
): Promise<NormalizedResponse> {
  const body: Record<string, unknown> = {
    model: ANTHROPIC_MODEL,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: "user", content: req.userText }],
  };
  if (req.useWebSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

  const res = await fetchImpl(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch { /* ignore */ }
    throw new ProviderHttpError(res.status, detail);
  }

  const data = await res.json();
  return normalizeAnthropicResponse(data);
}

// ---- DeepSeek call + normalization ----
export function normalizeDeepSeekResponse(data: any): NormalizedResponse {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const text = choice?.message?.content ?? "";
  // OpenAI-shaped finish_reason -> the same vocabulary callClaude() already
  // checks (only "max_tokens" is inspected downstream; anything else behaves
  // like a normal completion, matching today's Anthropic pass-through).
  const finishReason = choice?.finish_reason;
  const stopReason = finishReason === "length" ? "max_tokens" : finishReason === "stop" ? "end_turn" : (finishReason || "end_turn");
  return {
    content: text ? [{ type: "text", text }] : [],
    stop_reason: stopReason,
    usage: {
      input_tokens: data?.usage?.prompt_tokens ?? null,
      output_tokens: data?.usage?.completion_tokens ?? null,
    },
    model: data?.model || DEEPSEEK_MODEL,
  };
}

export async function callDeepSeekProvider(
  apiKey: string,
  req: ProviderRequest,
  fetchImpl: FetchImpl = fetch,
): Promise<NormalizedResponse> {
  // DeepSeek's OpenAI-compatible surface has no documented equivalent of
  // Anthropic's server-side web_search tool that this integration could
  // confirm (see the header note above) — selectProvider() below already
  // routes any useWebSearch request to Anthropic regardless of the
  // configured default, so this should be unreachable in practice. Kept as
  // a hard guard rather than silently dropping the search requirement.
  if (req.useWebSearch) {
    throw new ProviderCapabilityError("DeepSeek provider does not support useWebSearch in this integration.");
  }
  const body: Record<string, unknown> = {
    model: DEEPSEEK_MODEL,
    max_tokens: req.maxTokens,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.userText },
    ],
    // NOTE: deliberately NOT setting response_format: {type: "json_object"}.
    // Several OpenAI-compatible providers reject that flag with a 400 unless
    // the literal word "json" appears in the prompt text, and this could not
    // be confirmed for DeepSeek specifically (see header note). Every
    // existing system prompt already asks for strict JSON, and callClaude()'s
    // existing fence-stripping + regex-fallback extraction already tolerates
    // a non-strict-JSON response — so omitting this avoids a new, unverified
    // failure mode without weakening JSON extraction.
  };

  const res = await fetchImpl(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch { /* ignore */ }
    throw new ProviderHttpError(res.status, detail);
  }

  const data = await res.json();
  return normalizeDeepSeekResponse(data);
}

export class ProviderHttpError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(detail || `Provider returned HTTP ${status}`);
    this.name = "ProviderHttpError";
    this.status = status;
  }
}

// ---- Provider selection (server-side only — never exposed to the client) ----
// Reused unconditionally for EVERY call: a request that asked for web search
// always goes to Anthropic, regardless of the configured default provider,
// because DeepSeek's web-search support could not be confirmed. This is the
// one place selection logic lives — callAIProvider is the only entry point
// index.ts calls into.
export function selectProvider(configuredProvider: string | undefined, useWebSearch: boolean): "anthropic" | "deepseek" {
  if (useWebSearch) return "anthropic";
  return configuredProvider === "deepseek" ? "deepseek" : "anthropic";
}

export interface ProviderEnv {
  AI_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
}

export interface ProviderResult extends NormalizedResponse {
  provider: "anthropic" | "deepseek";
}

// The one function index.ts calls. Resolves which provider serves this
// request, validates the corresponding key is configured, calls it, and
// returns the normalized result tagged with which provider actually served
// it (for usage logging — see logUsage in index.ts).
export async function callAIProvider(
  env: ProviderEnv,
  req: ProviderRequest,
  fetchImpl: FetchImpl = fetch,
): Promise<ProviderResult> {
  const provider = selectProvider(env.AI_PROVIDER, req.useWebSearch);
  if (provider === "deepseek") {
    if (!env.DEEPSEEK_API_KEY) {
      throw new Error("AI_PROVIDER is set to \"deepseek\" but DEEPSEEK_API_KEY is not configured.");
    }
    const result = await callDeepSeekProvider(env.DEEPSEEK_API_KEY, req, fetchImpl);
    return { provider: "deepseek", ...result };
  }
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }
  const result = await callAnthropicProvider(env.ANTHROPIC_API_KEY, req, fetchImpl);
  return { provider: "anthropic", ...result };
}
