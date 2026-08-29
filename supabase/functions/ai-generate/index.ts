import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-4-6";
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

  if (!ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY secret is not configured for this project.");
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

  // ---- Call Anthropic ----
  const anthropicBody: Record<string, unknown> = {
    model: MODEL,
    max_tokens: clampedMaxTokens,
    system,
    messages: [{ role: "user", content: userText }],
  };
  if (useWebSearch) anthropicBody.tools = [{ type: "web_search_20250305", name: "web_search" }];

  let anthropicRes: Response;
  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(anthropicBody),
    });
  } catch (e) {
    await logUsage(supabase, { userId, applicationId, interviewId, requestType, status: "network_error" });
    return json({ error: "Couldn't reach the AI service. Please try again." }, 502);
  }

  if (!anthropicRes.ok) {
    let detail = "";
    try { detail = (await anthropicRes.json())?.error?.message || ""; } catch { /* ignore */ }
    if (detail) console.error("Anthropic error:", anthropicRes.status, detail);
    await logUsage(supabase, { userId, applicationId, interviewId, requestType, status: "upstream_error_" + anthropicRes.status });
    if (anthropicRes.status === 429) return json({ error: "The AI service is busy right now. Please try again shortly." }, 429);
    if (anthropicRes.status >= 500) return json({ error: "The AI service is temporarily unavailable. Please try again." }, 502);
    return json({ error: "Something went wrong on our end. Please try again." }, 500);
  }

  const data = await anthropicRes.json();
  await logUsage(supabase, {
    userId, applicationId, interviewId, requestType,
    status: "completed",
    model: data?.model || MODEL,
    inputTokens: data?.usage?.input_tokens ?? null,
    outputTokens: data?.usage?.output_tokens ?? null,
  });

  return json({ content: data.content, stop_reason: data.stop_reason });
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
