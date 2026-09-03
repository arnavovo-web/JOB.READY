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
// Phase 41A — verified against the official DeepSeek API documentation
// (https://api-docs.deepseek.com, checked 2026-09-03):
//   - Base URL: https://api.deepseek.com (OpenAI-compatible surface)
//   - Auth: `Authorization: Bearer <DEEPSEEK_API_KEY>` (OpenAI-style, NOT
//     Anthropic's `x-api-key` header)
//   - Chat completions endpoint: POST /chat/completions (OpenAI-compatible
//     request/response shape: messages[], choices[0].message.content,
//     usage.prompt_tokens / completion_tokens, choices[0].finish_reason)
//   - Model IDs the `model` parameter currently accepts (official API
//     reference, /api/create-chat-completion): `deepseek-v4-flash`,
//     `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp`. The pre-V4 aliases
//     `deepseek-chat` / `deepseek-reasoner` were announced for discontinuation
//     on 2026-07-24 (official changelog dated 2026-04-24) and no longer appear
//     on the models or pricing pages — `deepseek-chat` is NOT a valid id.
//   - `deepseek-v4-flash` is chosen here as the cost-efficient default:
//     `deepseek-v4-pro` is ~3x the per-token price and `-vision-exp` is an
//     experimental vision variant JOB.READY has no use for.
// This model id is ONLY read inside callDeepSeekProvider below, which is only
// reached when AI_PROVIDER routing selects "deepseek" for a request — while
// AI_PROVIDER is unset/"anthropic" (today's production), this path is dormant.
// JSON mode (`response_format: { type: "json_object" }`) is officially
// supported on the V4 models and IS now enabled below, together with
// `thinking: { type: "disabled" }` — see the evidence note inside
// callDeepSeekProvider for why both were turned on.
export const DEEPSEEK_MODEL = "deepseek-v4-flash";
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
  // Phase 37: optional — every real call site sends it (see App.jsx's callAI, which defaults
  // to the literal string "unknown" when a caller omits meta.requestType), but it stays
  // optional here so every pre-Phase-37 test/call that constructs a ProviderRequest without
  // it keeps compiling and behaving identically (see selectProviderForRequest's docstring:
  // a missing requestType is treated exactly like an unrecognised one).
  requestType?: string;
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
    // A live benchmark (`npm run benchmark:deepseek`) plus a controlled
    // experiment (RUN_DEEPSEEK_JSON_EXPERIMENT=1 in
    // src/deepseekBenchmarkLive.test.js) showed the previous "send nothing
    // extra" config failing structural validation on most tasks:
    //  - deepseek-v4-flash runs THINKING MODE ON BY DEFAULT at reasoning_effort
    //    "high", and those chain-of-thought tokens count against this same
    //    max_tokens budget — so tighter-budget requests were exhausted
    //    mid-reasoning (finish_reason "length") and never emitted the closing
    //    JSON. `thinking: { type: "disabled" }` removes that hidden consumer.
    //  - `response_format: { type: "json_object" }` constrains the output to a
    //    single bare JSON object. Both V4 models support it; its one documented
    //    requirement — the literal word "json" in the prompt — is already met
    //    by every DeepSeek-routed system prompt in this app (all ask for
    //    "strict JSON only" with an explicit shape).
    // Response normalization and error handling below are unchanged: the
    // model's answer still arrives in choices[0].message.content, and
    // callClaude()'s fence-stripping + regex-fallback extraction still applies.
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
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

export type Provider = "anthropic" | "deepseek";

// ---- Provider selection (server-side only — never exposed to the client) ----
// Kept EXACTLY as Phase 36 shipped it (signature and behaviour both unchanged) — this was
// the original global-only routing rule and stays exported so nothing that already depends
// on it (existing tests included) breaks. It is no longer called by callAIProvider below
// (selectProviderForRequest, Phase 37, supersedes it there), but it remains a correct,
// standalone description of the pre-Phase-37 "single global provider + web-search override"
// rule, useful on its own (e.g. for a caller that genuinely never wants request-type routing).
export function selectProvider(configuredProvider: string | undefined, useWebSearch: boolean): Provider {
  if (useWebSearch) return "anthropic";
  return configuredProvider === "deepseek" ? "deepseek" : "anthropic";
}

// ================================================================================
// PHASE 37 — HYBRID, PER-REQUEST-TYPE ROUTING
// --------------------------------------------------------------------------------
// One centralized routing policy + one pure decision function. index.ts never branches on
// requestType itself — it only ever calls callAIProvider(), which calls
// selectProviderForRequest() below. Nothing about this changes what a provider CALL looks
// like (callAnthropicProvider/callDeepSeekProvider, and their normalization, are completely
// untouched above) — this section only decides WHICH of those two gets called.
// ================================================================================

// The exact, verified inventory of requestType values every real call site in src/App.jsx
// sends today — re-derived directly from source at the start of Phase 37
// (`grep -oE 'requestType:\s*"[a-z_]+"' src/App.jsx`), not carried over from memory. This
// list is the routing/observability allowlist ONLY: an unrecognised requestType still gets a
// normal AI response (see "unknown_request_type_default" below) rather than the whole request
// being rejected — outright rejection would be a NEW failure mode for any future call site
// added without this file being updated in lockstep, which the phase spec explicitly weighs
// against ("preserve backward compatibility"). It just never gets policy-based DeepSeek
// routing until this list is updated to know about it; it safely defaults to Anthropic
// instead (see REQUEST_TYPE_ROUTING_POLICY's docstring).
export const KNOWN_REQUEST_TYPES = [
  "interview_question_batch",
  "interview_batch_evaluation",
  "classroom_lesson",
  "development_module",
  "interview_profile",
  "invitation_extraction",
  "interview_turn_evaluate",
  "interview_turn_generate",
  "interview_report",
  "assessment_centre_scenario",
  "assessment_centre",
] as const;
export type KnownRequestType = typeof KNOWN_REQUEST_TYPES[number];

// The ONE place a request type maps to a default provider tier under hybrid mode.
//
// FAST / COST-EFFICIENT route (DeepSeek): high-volume or one-shot generation where the
// existing structural validator (validateQuestionBatch/validateLesson/validateDevelopmentModule/
// validateProfile/validateInvitationExtraction/validateAcScenario — all untouched by this
// phase) is the real product-level safeguard, not provider choice.
//   - invitation_extraction, interview_question_batch, classroom_lesson, development_module,
//     assessment_centre_scenario: exactly the fast-route list given in the phase spec.
//   - interview_profile: deliberately included here too, after inspecting it specifically
//     (per the spec's instruction not to blindly classify it) — it is a single per-application
//     extraction step, not a per-turn or scored call; ~6000 max_tokens is mid-sized, not the
//     largest prompt in the app; and everything materially downstream of it
//     (interview_turn_evaluate/interview_turn_generate for the live interview,
//     interview_report for the final score) independently re-evaluates the candidate's actual
//     answers against the real rubric — it never trusts interview_profile's output as a score
//     or a judgement. A weaker extraction here degrades to "slightly less tailored questions",
//     never a silently wrong candidate-facing score. That risk profile matches the fast route,
//     not the strong one.
//
// STRONG / QUALITY-CRITICAL route (Anthropic): every call that scores an answer, decides the
// next live question, or produces a candidate-facing judgement — interview_turn_evaluate,
// interview_turn_generate, interview_batch_evaluation, interview_report, assessment_centre —
// exactly the strong-route list given in the phase spec. A quality regression here is both
// expensive (it can shape the rest of a live interview or a final score) and hard for a
// candidate to detect on their own, unlike a slightly blander generated question.
//
// Kept as a bare Provider (not a provider+model tuple): there is currently only ONE verified/
// documented model per provider (ANTHROPIC_MODEL/DEEPSEEK_MODEL above) — inventing a second
// DeepSeek tier ("Flash"/"Pro") without a verified model ID would violate the phase's explicit
// "do not fabricate model IDs" rule. This table's VALUE type is what changes when a second,
// verified tier exists (e.g. `{ provider: "deepseek", tier: "fast" }`) — RoutingDecision/
// selectProviderForRequest's callers already consume a decision object, not a bare string, so
// that extension needs no change to callAIProvider's contract or to index.ts.
export const REQUEST_TYPE_ROUTING_POLICY: Record<KnownRequestType, Provider> = {
  // ---- fast / cost-efficient route ----
  invitation_extraction: "deepseek",
  interview_question_batch: "deepseek",
  classroom_lesson: "deepseek",
  development_module: "deepseek",
  interview_profile: "deepseek",
  assessment_centre_scenario: "deepseek",
  // ---- strong / quality-critical route ----
  interview_turn_evaluate: "anthropic",
  interview_turn_generate: "anthropic",
  interview_batch_evaluation: "anthropic",
  interview_report: "anthropic",
  assessment_centre: "anthropic",
};

// AI_PROVIDER's three valid values under Phase 37 (reuses the SAME env var Phase 36
// introduced — no new env var for this). "hybrid" is the new default: unset behaves
// identically to explicit "hybrid" (see normalizeRoutingMode below), so an existing
// deployment that has never set AI_PROVIDER at all picks up hybrid routing with no
// configuration change required.
export type RoutingMode = "hybrid" | "anthropic" | "deepseek";

export type RoutingReason =
  | "web_search_override"          // useWebSearch=true — always wins, over every mode
  | "global_override_anthropic"    // AI_PROVIDER=anthropic — emergency rollback
  | "global_override_deepseek"     // AI_PROVIDER=deepseek — forced DeepSeek (still web-search-gated above)
  | "request_type_policy"          // hybrid mode, requestType found in REQUEST_TYPE_ROUTING_POLICY
  | "unknown_request_type_default";// hybrid mode, requestType missing/not in KNOWN_REQUEST_TYPES

// Machine-readable routing outcome. `mode` is the EFFECTIVE mode this decision was made
// under, AFTER normalizing an unset or invalid AI_PROVIDER value down to "hybrid" (see
// normalizeRoutingMode) — `configWasInvalid` separately flags an AI_PROVIDER value that was
// neither unset nor one of "hybrid"/"anthropic"/"deepseek" (e.g. a typo like "deepseak"),
// purely for index.ts's own logging. It never changes the routing OUTCOME: an invalid value
// is always treated exactly like "hybrid" (the same safe default an unset value gets), never
// silently treated as "deepseek" or as an error that breaks the request — see the "Invalid
// configuration" reasoning in the module-level comment above selectProviderForRequest.
export interface RoutingDecision {
  provider: Provider;
  reason: RoutingReason;
  mode: RoutingMode;
  configWasInvalid: boolean;
}

function normalizeRoutingMode(configuredProvider: string | undefined): { mode: RoutingMode; configWasInvalid: boolean } {
  if (configuredProvider === "anthropic") return { mode: "anthropic", configWasInvalid: false };
  if (configuredProvider === "deepseek") return { mode: "deepseek", configWasInvalid: false };
  if (configuredProvider === undefined || configuredProvider === "" || configuredProvider === "hybrid") {
    return { mode: "hybrid", configWasInvalid: false };
  }
  // Invalid configuration (Phase 37 spec §6): a value that is set but isn't one of the three
  // recognised modes. "Fail safely and predictably" here means falling back to hybrid — the
  // SAME safe default an unset value already gets — rather than either (a) silently treating
  // an unrecognised string as an implicit "deepseek" (Phase 36's old selectProvider() had the
  // opposite failure mode: anything not EXACTLY "deepseek" silently became "anthropic", which
  // is safe but not informative), or (b) hard-erroring every AI call in the product over a
  // single mistyped env var. Hybrid mode itself still keeps every quality-critical request
  // type on Anthropic (REQUEST_TYPE_ROUTING_POLICY), so a misconfigured AI_PROVIDER can never
  // route interview_turn_evaluate/interview_report/etc. to DeepSeek by accident — only the
  // already-fast-eligible request types are affected, and configWasInvalid=true still makes
  // this observable (index.ts logs it) rather than silent.
  return { mode: "hybrid", configWasInvalid: true };
}

// The ONE routing decision function — the single centralized place this entire policy lives.
// Pure, synchronous, no I/O: directly unit-testable without mocking fetch or Deno.env.
//
// Priority order (highest first), matching the phase spec exactly:
//   1. useWebSearch=true -> ALWAYS Anthropic. This cannot be overridden by ANY mode,
//      including AI_PROVIDER=deepseek (Phase 36's original hard guard, preserved verbatim —
//      DeepSeek's web-search support was never confirmed; callDeepSeekProvider itself still
//      throws ProviderCapabilityError as a second, independent layer of defense if this
//      priority order were ever bypassed).
//   2. AI_PROVIDER=anthropic -> Anthropic for everything (emergency rollback mode).
//   3. AI_PROVIDER=deepseek -> DeepSeek for everything eligible (i.e. everything priority 1
//      didn't already claim).
//   4. Otherwise (hybrid — explicit "hybrid", unset, or an invalid value normalized to
//      hybrid) -> REQUEST_TYPE_ROUTING_POLICY[requestType] when requestType is a known type,
//      else Anthropic (the safe, non-arbitrary default for an unrecognised/missing
//      requestType — see KNOWN_REQUEST_TYPES's own docstring for why this doesn't hard-reject
//      the request).
export function selectProviderForRequest({ requestType, useWebSearch, configuredProvider }: {
  requestType?: string;
  useWebSearch?: boolean;
  configuredProvider?: string;
}): RoutingDecision {
  const { mode, configWasInvalid } = normalizeRoutingMode(configuredProvider);

  if (useWebSearch) {
    return { provider: "anthropic", reason: "web_search_override", mode, configWasInvalid };
  }
  if (mode === "anthropic") {
    return { provider: "anthropic", reason: "global_override_anthropic", mode, configWasInvalid };
  }
  if (mode === "deepseek") {
    return { provider: "deepseek", reason: "global_override_deepseek", mode, configWasInvalid };
  }

  // mode === "hybrid"
  const isKnownType = !!requestType && (KNOWN_REQUEST_TYPES as readonly string[]).includes(requestType);
  if (!isKnownType) {
    return { provider: "anthropic", reason: "unknown_request_type_default", mode, configWasInvalid };
  }
  return { provider: REQUEST_TYPE_ROUTING_POLICY[requestType as KnownRequestType], reason: "request_type_policy", mode, configWasInvalid };
}

export interface ProviderEnv {
  AI_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
}

export interface ProviderResult extends NormalizedResponse {
  provider: Provider;
  // Phase 37: routing metadata, additive to the Phase 36 shape (`{ provider, ...result }`
  // callers that only read `.provider`/`.content`/`.stop_reason` are completely unaffected).
  // index.ts uses these two purely for observability (ai_usage/console logging) — they never
  // feed back into another routing decision.
  routingReason: RoutingReason;
  configWasInvalid: boolean;
}

// The one function index.ts calls. Resolves which provider serves this request (Phase 37:
// selectProviderForRequest, not the legacy global-only selectProvider), validates the
// corresponding key is configured, calls it, and returns the normalized result tagged with
// which provider actually served it plus why (for usage logging — see logUsage in index.ts).
export async function callAIProvider(
  env: ProviderEnv,
  req: ProviderRequest,
  fetchImpl: FetchImpl = fetch,
): Promise<ProviderResult> {
  const routing = selectProviderForRequest({
    requestType: req.requestType,
    useWebSearch: req.useWebSearch,
    configuredProvider: env.AI_PROVIDER,
  });
  if (routing.provider === "deepseek") {
    if (!env.DEEPSEEK_API_KEY) {
      throw new Error(`DeepSeek was selected (${routing.reason}) but DEEPSEEK_API_KEY is not configured.`);
    }
    const result = await callDeepSeekProvider(env.DEEPSEEK_API_KEY, req, fetchImpl);
    return { provider: "deepseek", routingReason: routing.reason, configWasInvalid: routing.configWasInvalid, ...result };
  }
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(`Anthropic was selected (${routing.reason}) but ANTHROPIC_API_KEY is not configured.`);
  }
  const result = await callAnthropicProvider(env.ANTHROPIC_API_KEY, req, fetchImpl);
  return { provider: "anthropic", routingReason: routing.reason, configWasInvalid: routing.configWasInvalid, ...result };
}
