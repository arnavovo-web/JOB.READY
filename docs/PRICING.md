# JOB.READY — Pricing, Payments & Paywall (Phase 40)

## The model

| Plan | Price | Grants |
|---|---|---|
| 🆓 Free | £0 | 1 application unlock. The user is asked to **confirm** before it's spent — never consumed automatically. |
| ⚡ Last-Minute Saver | £2.99 one-off | +1 application unlock credit |
| 🎓 Student Pack | £4.99 one-off | +5 application unlock credits (spent one at a time) |
| 🔥 Job Search Pass | £7.99 / month | Unlimited application unlocks while active |

An unlocked application gives **unlimited access to every JOB.READY preparation
resource for that specific application** (mock interviews, Application analysis,
Classroom lessons / development modules, Assessment Centre exercises).

Single source of truth: `src/entitlements.js` `PRICING_PLANS`.

## Critical product rule

**Creating and saving applications is never gated.** Access is checked only when
the user actively opens a *preparation resource* for a specific application.
Gated entry points in `src/App.jsx` (all call `ensureApplicationAccess(app, …)`):
`buildInterviewFromApplication`, `analyseApplicationOnly`, `continueApplication`,
`startPractiseAgain`, `startQuickPractice`, `startChallengeMe`, `analyseAndPlan`
(backstop), `startLearningFromRecommendation`, `openDevelopmentModule`,
`openLesson`, `generateAcScenario` (when application-scoped).

### Free unlock — explicit confirmation, never silent

When the gate finds `ACCESS.FREE` (free unlock available, not yet used) it opens
`FreeUnlockDialog`:

> **You're about to unlock your application at {Company}**
> Once unlocked, you'll have unlimited access to all JOB.READY preparation tools
> for this application.
> *1 free application unlock remaining*
> `[ Not now ]  [ Unlock & start preparing ]`

- "Unlock & start preparing" → `consume_free_unlock` RPC → refresh entitlements →
  re-run the action the user was taking.
- "Not now", Escape, backdrop click, navigating away → **nothing is spent.**

`rpcConsumeFreeUnlock` is reachable from exactly one place — `confirmFreeUnlock`,
the dialog's confirm handler (guarded by `phase40PricingPaywall.test.js`).

### Locked application — the paywall

When the gate finds `ACCESS.CREDIT` or `ACCESS.LOCKED` it opens the paywall
("Continue your preparation — unlock this application to get unlimited access to
all JOB.READY preparation resources"): a "spend 1 credit" option when the user
has credits, plus the four plans / Stripe Checkout. The application stays saved.

## Entitlement data model (`supabase/migrations/20260903090000_pricing_entitlements.sql`)

Timestamped **after** `20260902200000_profiles_reference_code.sql` (and after the
live ledger's latest entry `20260902193126`) so the repo apply order stays
monotonic and matches production.

| Table | Row | Written by |
|---|---|---|
| `user_entitlements` | one per user: `free_unlock_used`, `unlock_credits` | `consume_*` RPCs; Stripe webhook |
| `application_unlocks` | one per (user, application): `source` = free \| credit \| subscription \| comp | `consume_*` RPCs |
| `payments` | one-time Stripe purchase (audit + idempotency; `provider_checkout_id` UNIQUE) | Stripe webhook |
| `subscriptions` | Stripe subscription mirror (`status`, `current_period_end`, …) | Stripe webhook |

All four have **RLS = SELECT-own-rows only, no insert/update/delete policy**, so
the browser can read its entitlement state but can never forge it.

### RPCs (`SECURITY DEFINER`, `search_path = public`, `authenticated`-only)

- `consume_free_unlock(p_application_id)` — validates application ownership,
  row-locks `user_entitlements`, spends the one free unlock (once per account),
  inserts `application_unlocks(source='free')`.
- `consume_unlock_credit(p_application_id)` — validates ownership, decrements
  `unlock_credits` (refuses at 0), inserts `application_unlocks(source='credit')`.
- `has_application_access(p_application_id)` — true if the caller has an
  `application_unlocks` row for it **or** an active subscription. Called by
  `ai-generate` before spending an AI call, and by the client for display.
- `ensure_user_entitlements()` / `has_active_subscription(uid)` — helpers.

Existing applications at migration time are grandfathered with an
`application_unlocks(source='comp')` row — the paywall applies only to
applications created afterwards. `handle_new_user()` (re-asserted as a superset)
seeds a `user_entitlements` row for every new account.

## Payment architecture (Stripe)

No payment infra existed; Stripe Checkout + webhooks was added.

```
Browser ──(JWT)──▶ create-checkout (Edge Fn, verify_jwt=true)
                     │  builds a Stripe Checkout Session (inline price_data,
                     │  £2.99 / £4.99 / £7.99·mo — no dashboard price setup)
                     ▼
                 Stripe Hosted Checkout ──▶ card entry (never touches JOB.READY)
                     │
                     ▼  checkout.session.completed / customer.subscription.*
                 stripe-webhook (Edge Fn, --no-verify-jwt, Stripe-signature verified)
                     │  service-role writes, idempotent on provider_checkout_id
                     ▼
                 user_entitlements.unlock_credits += 1|5   /   subscriptions upsert
```

The browser only ever redirects to the returned Checkout URL. It never handles a
card number or a Stripe secret. No new npm dependency — `stripe` is a Deno
`npm:` import inside the Edge Functions only.

## Security summary

| Attack | Defence |
|---|---|
| Flip React state / edit the entitlement snapshot | Snapshot is display-only; every gated action re-checks via RPC; `ai-generate` re-checks `has_application_access` (HTTP 402 `application_locked`). |
| `INSERT`/`UPDATE` entitlement tables from the browser | No write RLS policy on any of the four tables. |
| Call `ai-generate` directly for a locked application | The function calls `has_application_access` for application-scoped request types. |
| Replay / spoof the Stripe webhook | `constructEventAsync` signature check against `STRIPE_WEBHOOK_SECRET`; grants idempotent on `provider_checkout_id`. |
| Double-spend the free unlock | `consume_free_unlock` row-locks `user_entitlements` and checks `free_unlock_used`. |

## Manual steps to go live

1. Apply `20260903090000_pricing_entitlements.sql` (via `supabase db push` or the
   management API — the newest ledger entry is `20260902193126`, so this file's
   `20260903…` timestamp sorts correctly after it).
2. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (+ optional `PUBLIC_SITE_URL`)
   as Edge Function secrets.
3. Deploy `create-checkout`, `stripe-webhook` (`--no-verify-jwt`), and the updated
   `ai-generate`. **Note:** redeploying `ai-generate` also ships the pending
   Phase 36/37 provider-abstraction work already on `release/beta` — review that
   first (see `supabase/functions/README.md`).
4. Add the Stripe webhook endpoint and copy its signing secret.

Nothing in this branch is deployed. See `supabase/functions/README.md` for exact
commands.
