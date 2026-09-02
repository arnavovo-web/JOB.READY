import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { callAIProvider, ProviderHttpError, ProviderCapabilityError } from "./providers.ts";

// Secure AI proxy for JOB.READY.
// verify_jwt=true (set at deploy time) means Supabase's edge runtime rejects
// any request without a valid user JWT BEFORE this code even runs — satisfies
// "unauthenticated user cannot invoke protected AI functionality".

// ROOT-CAUSE FIX (found via live testing + function_logs on 2026-08-21): this
// function never sent any Access-Control-Allow-* headers. The browser (called
// cross-origin from job-ready-delta.vercel.app) sends a CORS preflight OPTIONS
// request before every real POST, because the request carries an Authorization
// header. That preflight landed on the `method !== "POST"` branch below and
// got back a 405 with no CORS headers, so the browser blocked every actual
// call before it was ever sent — confirmed in function_logs as
// "handler entered, method: OPTIONS" followed immediately by a 405. This made
// every AI request fail, for every user, unconditionally. Fixed by answering
// OPTIONS directly and adding CORS headers to every response.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RATE_LIMIT_MAX_REQUESTS = 40; // per window
const RATE_LIMIT_WINDOW_MINUTES = 10;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Client scoped to the calling user's JWT — RLS applies to every query below,
  // so this function can never read/write another user's rows.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
  const userId = userData.user.id;

  // Phase 36 — provider abstraction. AI_PROVIDER is a server-side-only secret
  // ("anthropic" | "deepseek", defaults to "anthropic" when unset or anything
  // else) — never read from the request body, never settable by the client,
  // exactly like ANTHROPIC_API_KEY/DEEPSEEK_API_KEY. See providers.ts for the
  // full abstraction; this file only wires Deno.env into it.
  const providerEnv = {
    AI_PROVIDER: Deno.env.get("AI_PROVIDER"),
    ANTHROPIC_API_KEY: Deno.env.get("ANTHROPIC_API_KEY"),
    DEEPSEEK_API_KEY: Deno.env.get("DEEPSEEK_API_KEY"),
  };
  if (!providerEnv.ANTHROPIC_API_KEY && !providerEnv.DEEPSEEK_API_KEY) {
    console.error("Neither ANTHROPIC_API_KEY nor DEEPSEEK_API_KEY is configured for this project.");
    return json({ error: "AI service is not configured. Please contact support." }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { system, userText, maxTokens, useWebSearch, requestType, applicationId, interviewId } = body || {};
  if (typeof system !== "string" || typeof userText !== "string") {
    return json({ error: "Request must include 'system' and 'userText' strings" }, 400);
  }
  // Phase 4B: raised from 6000 to 8000. The new interview_question_batch and
  // interview_batch_evaluation call types return larger JSON payloads (up to ~15
  // questions/evaluations with richer per-item metadata than any existing call
  // produces) and were getting close to the old ceiling on longer interviews.
  const clampedMaxTokens = Math.max(200, Math.min(8000, Number(maxTokens) || 2000));

  // ---- Simple server-side rate limiting using public.api_usage_limits ----
  const nowIso = new Date().toISOString();
  const { data: limitRow } = await supabase
    .from("api_usage_limits")
    .select("window_started_at, request_count")
    .eq("user_id", userId)
    .maybeSingle();

  let requestCount = 1;
  let windowStart = nowIso;
  if (limitRow) {
    const windowAgeMs = Date.now() - new Date(limitRow.window_started_at).getTime();
    if (windowAgeMs < RATE_LIMIT_WINDOW_MINUTES * 60 * 1000) {
      requestCount = (limitRow.request_count || 0) + 1;
      windowStart = limitRow.window_started_at;
      if (requestCount > RATE_LIMIT_MAX_REQUESTS) {
        return json({ error: "You're sending requests too quickly. Please wait a few minutes and try again." }, 429);
      }
    }
  }
  await supabase.from("api_usage_limits").upsert(
    { user_id: userId, window_started_at: windowStart, request_count: requestCount, updated_at: nowIso },
    { onConflict: "user_id" }
  );

  // ---- Call the configured AI provider ----
  let result;
  try {
    result = await callAIProvider(providerEnv, { system, userText, maxTokens: clampedMaxTokens, useWebSearch: !!useWebSearch });
  } catch (e) {
    if (e instanceof ProviderHttpError) {
      if (e.message) console.error("Provider error:", e.status, e.message);
      await logUsage(supabase, { userId, applicationId, interviewId, requestType, status: "upstream_error_" + e.status });
      if (e.status === 429) return json({ error: "The AI service is busy right now. Please try again shortly." }, 429);
      if (e.status >= 500) return json({ error: "The AI service is temporarily unavailable. Please try again." }, 502);
      return json({ error: "Something went wrong on our end. Please try again." }, 500);
    }
    if (e instanceof ProviderCapabilityError) {
      console.error("Provider capability error:", e.message);
      await logUsage(supabase, { userId, applicationId, interviewId, requestType, status: "provider_capability_error" });
      return json({ error: "Something went wrong on our end. Please try again." }, 500);
    }
    // Network failure (fetch threw) or misconfiguration (missing key for the
    // selected provider) — same "couldn't reach the AI service" shape the
    // frontend has always handled for a network error.
    await logUsage(supabase, { userId, applicationId, interviewId, requestType, status: "network_error" });
    return json({ error: "Couldn't reach the AI service. Please try again." }, 502);
  }

  // Phase 36: model is recorded as "<provider>:<model id>" (e.g.
  // "anthropic:claude-sonnet-4-6", "deepseek:deepseek-chat") — reuses the
  // EXISTING free-text ai_usage.model column (no schema change) while making
  // provider observable per Step 11. Legacy rows keep their bare model name;
  // both are just text, so no migration is needed and no reader breaks.
  await logUsage(supabase, {
    userId, applicationId, interviewId, requestType,
    status: "completed",
    model: `${result.provider}:${result.model}`,
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
  });

  return json({ content: result.content, stop_reason: result.stop_reason });
});

async function logUsage(supabase: any, opts: {
  userId: string; applicationId?: string | null; interviewId?: string | null; requestType?: string;
  status: string; model?: string; inputTokens?: number | null; outputTokens?: number | null;
}) {
  try {
    await supabase.from("ai_usage").insert({
      user_id: opts.userId,
      application_id: opts.applicationId || null,
      interview_id: opts.interviewId || null,
      request_type: opts.requestType || "unknown",
      model: opts.model || null,
      input_tokens: opts.inputTokens ?? null,
      output_tokens: opts.outputTokens ?? null,
      estimated_cost: null, // not reliably computable without current published pricing — left null rather than guessed
      status: opts.status,
    });
  } catch (e) {
    console.error("Failed to log ai_usage:", e);
  }
}
