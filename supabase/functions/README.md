# Supabase Edge Functions — deployment runbook

The application's **only** server-side artifact. Everything AI in JOB.READY goes
through `ai-generate`; nothing calls an AI provider from the browser.

## Functions

| Slug | In repo | Used by the app | Purpose |
|---|---|---|---|
| `ai-generate` | `functions/ai-generate/index.ts` + `functions/ai-generate/providers.ts` | **yes** — every `callClaude()`/`callAI()` in `src/App.jsx` → `supabase.functions.invoke("ai-generate", …)` | Authenticated proxy to the configured AI provider. Verifies the caller's JWT, enforces a per-user rate limit, logs usage. |
| `health-check` | not captured | no | Present on the live project (v3), unused by the app. Left as-is. |

**Phase 36 — provider abstraction (NOT YET DEPLOYED):** `index.ts` used to be a
verbatim capture of the live project (v5, 2026-08-30) that called Anthropic
directly. It has since been split into `index.ts` (unchanged Deno/Supabase glue
— CORS, JWT check, rate limiting, usage logging) + a new `providers.ts` (the
provider abstraction: builds the request for whichever provider is configured,
normalizes its response back into the exact same `{ content, stop_reason }`
shape the frontend has always received).

**Phase 37 — hybrid, per-request-type routing (also NOT YET DEPLOYED):** adds
one centralized routing decision — `selectProviderForRequest()` in
`providers.ts` — that picks Anthropic or DeepSeek **per AI call**, based on
which of the app's 11 `requestType` values the call is (see "Routing policy"
below), instead of Phase 36's single global provider switch. `index.ts` itself
still never branches on `requestType` — it only reads it back for logging; the
one function `index.ts` calls (`callAIProvider`) is the only thing that
changed how it decides internally.

**The live project still runs the pre-Phase-36 Anthropic-only version** —
these files (Phase 36 and Phase 37 both) are local edits, not yet deployed.
Deploying them (see below) is what actually switches anything; merging this
branch does not. Before making further edits, re-capture from the live project
first (see "Verifying repo vs live" below) so a local edit is never applied on
top of undiscovered live drift.

## What `ai-generate` needs

### Deploy-time setting
* `verify_jwt = true` — Supabase's edge runtime rejects any request without a
  valid user JWT **before** the function body runs. Do not deploy with
  `--no-verify-jwt`.

### Secrets (Supabase → Project Settings → Edge Functions → Secrets)
| Name | Required | Who sets it | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes, unless `AI_PROVIDER=deepseek` | you, once, per project | Required in hybrid mode (the default) — every quality-critical request type routes here, and it's also the universal web-search fallback. Never in the repo, never in the browser bundle, never in Vercel/a `VITE_*` var. |
| `DEEPSEEK_API_KEY` | yes, unless `AI_PROVIDER=anthropic` | you, once, per project | **New in Phase 36.** Required in hybrid mode (the default) — every fast/cost-efficient request type routes here (see "Routing policy" below). Same secrecy rule as above. Not required only when `AI_PROVIDER=anthropic` (emergency rollback). |
| `AI_PROVIDER` | no (defaults to `"hybrid"`) | you, optional | **New in Phase 36, extended in Phase 37.** One of three values — server-side only, no client-facing control, the frontend cannot request a provider: <br>• unset or `"hybrid"` (**default**) — per-`requestType` routing, see "Routing policy" below. <br>• `"anthropic"` — **emergency rollback**: every request goes to Anthropic, no matter its type. <br>• `"deepseek"` — every *eligible* request goes to DeepSeek (still subject to the web-search override below). <br>Any other value (e.g. a typo) is treated exactly like unset/`"hybrid"` — logged as a warning (`AI_PROVIDER is set to an unrecognised value…`), never silently treated as `"deepseek"` and never a hard failure. A request with `useWebSearch: true` **always** routes to Anthropic, regardless of this setting — DeepSeek web-search support could not be confirmed (see the Phase 36 report) — `AI_PROVIDER=deepseek` cannot override this. |
| `SUPABASE_URL` | yes | **auto-injected by Supabase** | Do not set manually. |
| `SUPABASE_ANON_KEY` | yes | **auto-injected by Supabase** | Do not set manually. |

If neither `ANTHROPIC_API_KEY` nor `DEEPSEEK_API_KEY` is set, the function
returns HTTP 500 `"AI service is not configured"`, same as before Phase 36.
In hybrid mode (the default), a call that resolves to a provider whose key
isn't set fails clearly for that call (`"DeepSeek was selected (…) but
DEEPSEEK_API_KEY is not configured."` / the Anthropic equivalent) — it never
silently falls back to the other provider unannounced (see "Fallback
behaviour" below).

## Routing policy (Phase 37, hybrid mode)

The single source of truth is `REQUEST_TYPE_ROUTING_POLICY` in `providers.ts`
— this table mirrors it. Applies whenever `AI_PROVIDER` is unset, `"hybrid"`,
or an unrecognised value; ignored entirely when `AI_PROVIDER` is forced to
`"anthropic"` or `"deepseek"` (see above), and always overridden by
`useWebSearch: true` regardless of mode.

| Request type | Provider (hybrid mode) | Why |
|---|---|---|
| `invitation_extraction` | DeepSeek | one-shot extraction, structurally validated |
| `interview_question_batch` | DeepSeek | high-volume generation, structurally validated |
| `classroom_lesson` | DeepSeek | generation, structurally validated (routes to Anthropic instead when it uses web search — see below) |
| `development_module` | DeepSeek | generation, structurally validated |
| `interview_profile` | DeepSeek | single per-application extraction; nothing downstream trusts it as a score (see `providers.ts`'s own comment for the full reasoning) |
| `assessment_centre_scenario` | DeepSeek | one-shot generation, structurally validated |
| `interview_turn_evaluate` | Anthropic | scores a live answer — feeds the adaptive scheduler's next decision |
| `interview_turn_generate` | Anthropic | writes the next live interview question |
| `interview_batch_evaluation` | Anthropic | scores a candidate's answers |
| `interview_report` | Anthropic | candidate-facing final score/readiness judgement |
| `assessment_centre` | Anthropic | candidate-facing evaluation |

An unrecognised or missing `requestType` (e.g. a future call site added
without updating this table) safely defaults to **Anthropic** — it is never
routed to DeepSeek "by accident", and the request still succeeds rather than
being rejected outright.

### Web-search override

Any request with `useWebSearch: true` routes to Anthropic, full stop —
before the table above is even consulted, and regardless of `AI_PROVIDER`
(including `AI_PROVIDER=deepseek`). Today only `classroom_lesson` calls
`callAI(..., true)` in some cases (a lesson that benefits from current,
real-world context) — it stays on DeepSeek when it doesn't use web search,
and moves to Anthropic only for the specific calls that do.

### Database tables (already present on the live project)
| Table | Access | Used for |
|---|---|---|
| `api_usage_limits` | `upsert` on `user_id` | rate limit: 40 requests / 10 minutes / user |
| `ai_usage` | `insert` | one row per AI call (request type, model, token counts, status) |

Both are covered by `supabase/migrations/20260828120000_baseline_schema.sql`.
A fresh project that has run the migrations already has them. **No migration
was added for Phase 36** — `ai_usage.model` (a pre-existing free-text column)
now stores `"<provider>:<model id>"` (e.g. `"anthropic:claude-sonnet-4-6"` or
`"deepseek:deepseek-chat"`) instead of a bare model name, so provider is
observable per-row without a schema change. Older rows keep their bare name;
both are just text in an unconstrained column.

### Model
`ANTHROPIC_MODEL` / `DEEPSEEK_MODEL` constants at the top of `providers.ts`
(currently `claude-sonnet-4-6` / `deepseek-chat`) — one model per provider,
used for every request type routed to it. Changing either is a function edit
+ redeploy, not a client change. **The DeepSeek model ID and endpoint could
not be verified against official DeepSeek documentation** — see the comment
at the top of `providers.ts` and the Phase 36 report's "DeepSeek integration
research" section before deploying with `AI_PROVIDER=deepseek` or (Phase 37)
letting hybrid mode reach DeepSeek at all. Phase 37 deliberately does **not**
introduce a second, faster/cheaper DeepSeek tier ("Flash"/"Pro") — no such
model ID has been verified, and the phase's instructions are explicit that
inventing one is unacceptable. `REQUEST_TYPE_ROUTING_POLICY`'s value type
(`providers.ts`) is structured so a verified second tier can be added later
without changing `callAIProvider`'s contract or this file's routing table
shape — see that constant's own comment.

## Fallback behaviour

There is none, deliberately. If the routed provider's call fails (HTTP error,
network failure, missing key), the request fails with a clear error — it is
**never** automatically retried against the other provider. Silently
retrying DeepSeek→Anthropic (or the reverse) would risk an unannounced
double API cost, an unpredictable extra network round-trip on every failure,
and a much harder-to-debug system. The existing (pre-Phase-36) retry
behaviour is unchanged: the frontend's own error handling (a clear message,
optionally a user-initiated "try again") is the only retry path, exactly as
before. To recover from an ongoing provider-side outage, use the rollback
switch below, not automatic fallback.

## Contract with the frontend

`src/App.jsx` `callAI(system, userText, maxTokens = 2000, useWebSearch = false, meta)`
(aliased as `callClaude` for the ~12 existing call sites — see App.jsx)
POSTs `{ system, userText, maxTokens, useWebSearch, requestType, applicationId, interviewId }`.
The function clamps `maxTokens` to `[200, 8000]`, calls whichever provider is
configured, and returns `{ content, stop_reason }` — **unchanged by Phase 36**;
the frontend has no idea which provider served a given request.

CORS: the function answers `OPTIONS` and sends `Access-Control-Allow-Origin: *`
on every response, so it works from any Vercel preview/production domain without
a per-origin allow-list.

## Deploying

Requires the Supabase CLI, logged in, with the project linked
(`supabase/config.toml` has `project_id`; `supabase link --project-ref
dcltfxnzzfqjtctixlxe` if not linked).

```bash
# one-time per project: set the provider key(s) you intend to use.
# ANTHROPIC_API_KEY is required for hybrid mode (the default) AND for the
# emergency-rollback mode below — set it regardless.
supabase secrets set ANTHROPIC_API_KEY=<key>   --project-ref dcltfxnzzfqjtctixlxe
# DEEPSEEK_API_KEY is required for hybrid mode too (fast-route request types
# need it) — verify providers.ts against official DeepSeek docs first (see
# the Phase 36 report) before setting this and going live with it:
supabase secrets set DEEPSEEK_API_KEY=<key>    --project-ref dcltfxnzzfqjtctixlxe

# deploy (verify_jwt defaults to true; keep it) — bundles index.ts + providers.ts
supabase functions deploy ai-generate          --project-ref dcltfxnzzfqjtctixlxe
```

Leaving `AI_PROVIDER` unset (or deploying without setting it) puts the
function in **hybrid mode** — per-`requestType` routing, see "Routing policy"
above — as soon as these files are deployed. Before Phase 37, unset meant
Anthropic-only; that is no longer true once this branch is deployed, so set
`AI_PROVIDER=anthropic` explicitly first (see "Emergency rollback" below) if
you want to deploy Phase 37's code changes (better observability, the routing
function itself) while staying Anthropic-only in practice.

### Emergency rollback

If DeepSeek has an outage, a quality regression, or malformed-output problems,
route every request back to Anthropic **without any frontend change and
without a redeploy** — this is the one config switch the whole routing layer
exists to make safe:

```bash
supabase secrets set AI_PROVIDER=anthropic --project-ref dcltfxnzzfqjtctixlxe
```

Takes effect on the next request (Edge Function secrets are read via
`Deno.env.get()` per invocation, no function restart needed). To force
DeepSeek instead (e.g. to test it deliberately, once its model ID/endpoint
have been verified — see "Model" above):

```bash
supabase secrets set AI_PROVIDER=deepseek --project-ref dcltfxnzzfqjtctixlxe
```

A request with `useWebSearch: true` still routes to Anthropic even in this
mode. To go back to normal hybrid routing:

```bash
supabase secrets set AI_PROVIDER=hybrid --project-ref dcltfxnzzfqjtctixlxe
# (unset also works — hybrid is the default when AI_PROVIDER isn't set at all)
```

## Verifying repo vs live

```bash
supabase functions download ai-generate --project-ref dcltfxnzzfqjtctixlxe -o /tmp/live-ai-generate
diff /tmp/live-ai-generate/index.ts supabase/functions/ai-generate/index.ts
```

Expected, as of Phase 36 (not yet deployed): **a diff** — the live project is
still the pre-Phase-36, Anthropic-only version. If you deploy this branch's
version, re-run this diff afterward and expect no diff. If the live project
differs from BOTH the pre- and post-Phase-36 versions here, it has drifted for
some other reason — re-capture into the repo, commit, and only then make
further edits.

## Recovery scenario

If `ai-generate` is deleted or the project is recreated:
1. Ensure the schema exists (run the migrations).
2. `supabase secrets set ANTHROPIC_API_KEY=<key>` — required regardless of mode.
   For hybrid mode (the default once this branch is deployed) also set
   `DEEPSEEK_API_KEY=<key>`; if you'd rather come back up Anthropic-only
   first and add DeepSeek later, also set `AI_PROVIDER=anthropic` (see
   "Emergency rollback" above).
3. `supabase functions deploy ai-generate` from this repo.
The product is fully restored — no other server-side artifact exists.
