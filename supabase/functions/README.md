# Supabase Edge Functions — deployment runbook

The application's **only** server-side artifact. Everything AI in JOB.READY goes
through `ai-generate`; nothing calls Anthropic from the browser.

## Functions

| Slug | In repo | Used by the app | Purpose |
|---|---|---|---|
| `ai-generate` | `functions/ai-generate/index.ts` | **yes** — every `callClaude()` in `src/App.jsx` → `supabase.functions.invoke("ai-generate", …)` | Authenticated proxy to the Anthropic Messages API. Verifies the caller's JWT, enforces a per-user rate limit, logs usage. |
| `health-check` | not captured | no | Present on the live project (v3), unused by the app. Left as-is. |

`functions/ai-generate/index.ts` in this repo is a **verbatim capture of the
currently-deployed version (v5)**, taken 2026-08-30 for reproducibility. It was
not modified. Before changing it, re-capture from the live project first (see
"Verifying repo vs live" below) so a local edit is never applied on top of drift.

## What `ai-generate` needs

### Deploy-time setting
* `verify_jwt = true` — Supabase's edge runtime rejects any request without a
  valid user JWT **before** the function body runs. Do not deploy with
  `--no-verify-jwt`.

### Secrets (Supabase → Project Settings → Edge Functions → Secrets)
| Name | Required | Who sets it | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **yes** | you, once, per project | The only genuinely secret value. Never in the repo, never in the browser bundle, never in Vercel. If missing, the function returns HTTP 500 `"AI service is not configured"`. |
| `SUPABASE_URL` | yes | **auto-injected by Supabase** | Do not set manually. |
| `SUPABASE_ANON_KEY` | yes | **auto-injected by Supabase** | Do not set manually. |

### Database tables (already present on the live project)
| Table | Access | Used for |
|---|---|---|
| `api_usage_limits` | `upsert` on `user_id` | rate limit: 40 requests / 10 minutes / user |
| `ai_usage` | `insert` | one row per AI call (request type, model, token counts, status) |

Both are covered by `supabase/migrations/20260828120000_baseline_schema.sql`.
A fresh project that has run the migrations already has them.

### Model
Hardcoded in the function: `claude-sonnet-4-6`. Changing the model is a
function edit + redeploy, not a client change.

## Contract with the frontend

`src/App.jsx` `callClaude(system, userText, maxTokens = 2000, useWebSearch = false, meta)`
POSTs `{ system, userText, maxTokens, useWebSearch, requestType, applicationId, interviewId }`.
The function clamps `maxTokens` to `[200, 8000]`, calls Anthropic, and returns
`{ content, stop_reason }`. `useWebSearch` is always `false` from the app today.

CORS: the function answers `OPTIONS` and sends `Access-Control-Allow-Origin: *`
on every response, so it works from any Vercel preview/production domain without
a per-origin allow-list.

## Deploying

Requires the Supabase CLI, logged in, with the project linked
(`supabase/config.toml` has `project_id`; `supabase link --project-ref
dcltfxnzzfqjtctixlxe` if not linked).

```bash
# one-time per project: set the Anthropic key
supabase secrets set ANTHROPIC_API_KEY=<key>   --project-ref dcltfxnzzfqjtctixlxe

# deploy (verify_jwt defaults to true; keep it)
supabase functions deploy ai-generate          --project-ref dcltfxnzzfqjtctixlxe
```

## Verifying repo vs live

```bash
supabase functions download ai-generate --project-ref dcltfxnzzfqjtctixlxe -o /tmp/live-ai-generate
diff /tmp/live-ai-generate/index.ts supabase/functions/ai-generate/index.ts
```

Expected: no diff. If they differ, the live project is ahead — re-capture into
the repo, commit, and only then make further edits.

## Recovery scenario

If `ai-generate` is deleted or the project is recreated:
1. Ensure the schema exists (run the migrations).
2. `supabase secrets set ANTHROPIC_API_KEY=<key>`
3. `supabase functions deploy ai-generate` from this repo.
The product is fully restored — no other server-side artifact exists.
