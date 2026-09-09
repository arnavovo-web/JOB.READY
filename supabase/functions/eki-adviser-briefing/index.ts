// =============================================================================
// EKI² — AI Careers Adviser Briefing (thin, optional AI synthesis layer)
// -----------------------------------------------------------------------------
// The deterministic system (SQL + src/institutional/briefing.js) does all the
// gathering. This function ONLY turns an already-authorised, already-structured
// fact set into one fluent adviser paragraph + a few discussion points.
//
//   * Re-authorises by forwarding the caller's JWT to eki_student_snapshot —
//     the RPC's own institution + cohort-membership gate is the authority.
//   * Sends the model a COMPACT fact JSON only. No transcript, no raw answers,
//     no adviser notes beyond "actions agreed" text the adviser themselves wrote.
//   * If ANTHROPIC_API_KEY is not configured, or the model call fails, it
//     returns { ok: false, reason } and the client keeps its deterministic
//     briefing. EKI² never depends on this function.
//   * Cost: one ~600-token request only when an adviser clicks "Brief me" and
//     no briefing is cached. Model defaults to a small, cheap model.
// =============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("EKI_BRIEFING_MODEL") ?? "claude-haiku-4-5-20251001";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const AI_RULES =
  "Use ONLY the facts in the JSON. Do not add any fact, number, name or detail not present. " +
  "Do not infer personal information or intent that is not stated. Do not diagnose the student and " +
  "do not claim any intervention caused a change. Do not predict employment or graduate outcomes. " +
  'Distinguish what the data shows ("has", "is") from what you suggest ("could", "might"). ' +
  "One short paragraph (max ~70 words) then 2-4 short discussion points.";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

/** Reduce the full snapshot to the compact fact set the model is allowed to see. */
function factsFromSnapshot(s: any) {
  const dna = s?.interview_dna ?? {};
  const traj = s?.trajectory ?? {};
  const ev = s?.dna_evolution ?? {};
  const prev = s?.previous_support ?? null;
  const rep = s?.patterns?.repeated_development_area ?? null;
  return {
    student_name: s?.student?.name ?? null,
    n_interviews: dna.n_completed_interviews ?? traj.n_interviews ?? 0,
    latest_overall: dna.overall_mean ?? traj.latest_score ?? null,
    target: s?.target ?? 70,
    trajectory: traj.classification ?? "insufficient_data",
    trajectory_first: traj.first_score ?? null,
    trajectory_latest: traj.latest_score ?? null,
    trajectory_delta: traj.overall_delta ?? null,
    strongest_competency: (dna.strengths ?? [])[0]?.key ?? null,
    weakest_competency: (dna.development_areas ?? [])[0]?.key ?? null,
    repeated_weakness: rep?.key ?? null,
    repeated_weakness_interviews: rep?.recent_interviews ?? null,
    strongest_improvement: ev.strongest_improvement ?? null,
    persistent_weakness: ev.persistent_weakness ?? null,
    previous_appointments: (s?.history ?? []).length,
    last_focus: prev?.type_label ?? null,
    last_actions_agreed: prev?.actions_agreed ?? null,
    last_follow_up_required: !!prev?.follow_up_required,
    is_stuck: !!s?.flags?.is_stuck,
    no_prior_contact: !!s?.flags?.no_prior_contact,
    recommended_resources: (s?.recommended_resources ?? []).map((r: any) => r.title).slice(0, 3),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ ok: false, reason: "unauthenticated" }, 401);

  let payload: { institution_id?: string; student_id?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, reason: "bad_request" }, 400);
  }
  if (!payload.institution_id || !payload.student_id) {
    return json({ ok: false, reason: "missing_params" }, 400);
  }

  // Re-authorise: eki_student_snapshot enforces institution + cohort membership
  // for THIS caller. A wrong-institution / non-staff caller gets 42501 here.
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/eki_student_snapshot`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON_KEY,
      Authorization: authHeader,
    },
    body: JSON.stringify({
      p_institution_id: payload.institution_id,
      p_student_id: payload.student_id,
    }),
  });
  if (!rpcRes.ok) {
    const status = rpcRes.status === 403 || rpcRes.status === 401 ? 403 : 502;
    return json({ ok: false, reason: "not_authorised_or_unavailable" }, status);
  }
  const snapshot = await rpcRes.json();
  const facts = factsFromSnapshot(snapshot);

  if (!ANTHROPIC_API_KEY) {
    return json({ ok: false, reason: "ai_unavailable", facts });
  }
  if (!facts.n_interviews) {
    return json({ ok: false, reason: "insufficient_data", facts });
  }

  try {
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system:
          "You are EKI², writing a short briefing for a university careers adviser about to meet a student. " +
          AI_RULES +
          ' Reply as strict JSON: {"focus": string, "discussion": string[]}.',
        messages: [
          {
            role: "user",
            content:
              "Write the briefing from these facts. Competency keys map to: relevance, specificity, structure, " +
              "evidence, communication (delivery), competency_demonstration.\n\n" +
              JSON.stringify(facts),
          },
        ],
      }),
    });
    if (!aiRes.ok) return json({ ok: false, reason: "model_error", facts }, 502);
    const data = await aiRes.json();
    const text: string = data?.content?.[0]?.text ?? "";
    let parsed: { focus?: string; discussion?: string[] } = {};
    try {
      parsed = JSON.parse(text.trim().replace(/^```json\s*/i, "").replace(/```$/, ""));
    } catch {
      return json({ ok: false, reason: "malformed_response", facts }, 502);
    }
    if (!parsed.focus || typeof parsed.focus !== "string") {
      return json({ ok: false, reason: "malformed_response", facts }, 502);
    }
    return json({
      ok: true,
      generated_by: "ai",
      model: MODEL,
      focus: parsed.focus.trim(),
      discussion: Array.isArray(parsed.discussion)
        ? parsed.discussion.filter((d) => typeof d === "string" && d.trim()).slice(0, 5)
        : [],
    });
  } catch (_e) {
    return json({ ok: false, reason: "model_unreachable", facts }, 502);
  }
});
