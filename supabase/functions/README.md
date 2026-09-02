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
shape the frontend has always received). **The live project still runs the
pre-Phase-36 Anthropic-only version** — these files are local edits, not yet
deployed. Deploying them (see below) is what actually switches anything;
merging this branch does not. Before making further edits, re-capture from the
live project first (see "Verifying repo vs live" below) so a local edit is
never applied on top of undiscovered live drift.

## What `ai-generate` needs

### Deploy-time setting
* `verify_jwt = true` — Supabase's edge runtime rejects any request without a
  valid user JWT **before** the function body runs. Do not deploy with
  `--no-verify-jwt`.

### Secrets (Supabase → Project Settings → Edge Functions → Secrets)
| Name | Required | Who sets it | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes, unless `AI_PROVIDER=deepseek` | you, once, per project | The default provider's key. Never in the repo, never in the browser bundle, never in Vercel/a `VITE_*` var. |
| `DEEPSEEK_API_KEY` | only if `AI_PROVIDER=deepseek` | you, once, per project | **New in Phase 36.** Same rule as above: server-side Edge Function secret only, never the repo/browser bundle/Vercel/a `VITE_*` var. Not required at all while `AI_PROVIDER` is unset or `"anthropic"`. |
| `AI_PROVIDER` | no (defaults to `"anthropic"`) | you, optional | **New in Phase 36.** `"anthropic"` (default/unset) or `"deepseek"`. Server-side only — there is no client-facing control, and the frontend cannot request a provider. A request that sets `useWebSearch` is always routed to Anthropic regardless of this setting (DeepSeek web-search support could not be confirmed — see the Phase 36 report). |
| `SUPABASE_URL` | yes | **auto-injected by Supabase** | Do not set manually. |
| `SUPABASE_ANON_KEY` | yes | **auto-injected by Supabase** | Do not set manually. |

If neither `ANTHROPIC_API_KEY` nor `DEEPSEEK_API_KEY` is set, the function
returns HTTP 500 `"AI service is not configured"`, same as before Phase 36.

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
(currently `claude-sonnet-4-6` / `deepseek-chat`). Changing either is a
function edit + redeploy, not a client change. **The DeepSeek model ID and
endpoint could not be verified against official DeepSeek documentation** —
see the comment at the top of `providers.ts` and the Phase 36 report's
"DeepSeek integration research" section before deploying with
`AI_PROVIDER=deepseek`.

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
# one-time per project: set the provider key(s) you intend to use
supabase secrets set ANTHROPIC_API_KEY=<key>   --project-ref dcltfxnzzfqjtctixlxe
# only if you intend to actually use DeepSeek — verify providers.ts against
# official DeepSeek docs first (see the Phase 36 report):
supabase secrets set DEEPSEEK_API_KEY=<key>    --project-ref dcltfxnzzfqjtctixlxe
supabase secrets set AI_PROVIDER=deepseek      --project-ref dcltfxnzzfqjtctixlxe

# deploy (verify_jwt defaults to true; keep it) — bundles index.ts + providers.ts
supabase functions deploy ai-generate          --project-ref dcltfxnzzfqjtctixlxe
```

Leaving `AI_PROVIDER` unset (or deploying without setting it) keeps the
function on Anthropic — the same behaviour as before Phase 36 — even after
these files are deployed.

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
2. `supabase secrets set ANTHROPIC_API_KEY=<key>` (and `DEEPSEEK_API_KEY` +
   `AI_PROVIDER=deepseek` only if you want DeepSeek as the default provider).
3. `supabase functions deploy ai-generate` from this repo.
The product is fully restored — no other server-side artifact exists.
