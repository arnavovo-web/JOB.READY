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
the dialog's confirm handler (guarded by
`phase40PricingPaywall.test.js` / `phase40SubscriptionUnlockSecurity.test.js`).

### Locked application — the paywall

When the gate finds `ACCESS.CREDIT` or `ACCESS.LOCKED` it opens the paywall
("Continue your preparation — unlock this application to get unlimited access to
all JOB.READY preparation resources"): a "spend 1 credit" option when the user
has credits, plus the four plans / Stripe Checkout. The application stays saved.

### Returning from Stripe Checkout — truthful confirmation

The browser **never** claims the purchase landed until a fresh entitlement
snapshot actually shows the new entitlement (the webhook + DB are the sole
source of truth — the browser grants nothing). On `?checkout=success` it:

1. captures the entitlement snapshot as it was **before** checkout, and shows
   *"Payment received — we're confirming your purchase…"*;
2. polls `refreshEntitlements()` with a short increasing backoff (~13s over 6
   checks), comparing against the baseline — a one-time purchase confirms only
   when `unlock_credits` rises **above** the baseline (so a repeat purchase
   isn't a false positive); a subscription confirms on an inactive→active flip;
3. on confirmation → *"{Plan} confirmed — it's on your account now."*;
4. on timeout → *"Your payment was received and may still be processing. Refresh
   your account in a moment to check your unlocks."* with a **Refresh** button
   that only re-reads / reconciles (`refreshEntitlements()` again).

## Entitlement data model (`supabase/migrations/20260903090000_pricing_entitlements.sql`)

Timestamped **after** `20260902200000_profiles_reference_code.sql` (and after the
live ledger's latest entry `20260902193126`) so the repo apply order stays
monotonic and matches production.

| Table | Row | Written by |
|---|---|---|
| `user_entitlements` | one per user: `free_unlock_used`, `unlock_credits` | `consume_free_unlock` / `consume_unlock_credit` (free/credit spend); `apply_purchase_credits` (webhook, credit grant) |
| `application_unlocks` | one **permanent** unlock per (user, application): `source` = `free` \| `credit` \| `comp` | `consume_free_unlock` (`free`) / `consume_unlock_credit` (`credit`); the one-shot migration grandfather backfill (`comp`) |
| `payments` | one-time Stripe purchase (audit + idempotency claim; `provider_checkout_id` UNIQUE) | `apply_purchase_credits` (webhook) |
| `subscriptions` | Stripe subscription mirror (`status`, `current_period_end`, `cancel_at_period_end`, …) | `stripe-webhook` (upsert on `stripe_subscription_id`) |

All four have **RLS = SELECT-own-rows only, no insert/update/delete policy**, so
the browser can read its entitlement state but can never forge it. (`source`'s
CHECK still permits `subscription` for forward-compat, but **no code path writes
it** — see `consume_*` below.)

### RPCs (all `SECURITY DEFINER`, `search_path = public`)

- **`consume_free_unlock(p_application_id)`** *(authenticated)* — validates
  application ownership; if already unlocked → returns `already`; **if the caller
  has an active subscription → returns `{ source: 'subscription', persisted:
  false }` and writes nothing** (subscription access is temporary and checked
  live — it must never become a permanent `application_unlocks` row, even via a
  direct RPC call); otherwise row-locks `user_entitlements` (`SELECT … FOR
  UPDATE`), spends the one free unlock (once per account), inserts
  `application_unlocks(source='free')`.
- **`consume_unlock_credit(p_application_id)`** *(authenticated)* — same shape;
  the subscription branch likewise returns `persisted: false` and spends nothing;
  otherwise row-locks, refuses at `unlock_credits < 1`, decrements by 1, inserts
  `application_unlocks(source='credit')`.
- **`has_application_access(p_application_id)`** *(authenticated)* — true if the
  caller owns the app **and** (`has_active_subscription` is true **or** an
  `application_unlocks` row exists). Called by `ai-generate` before spending an
  AI call, and by the client for display.
- **`has_active_subscription(uid)`** *(internal — revoked from every end-user
  role)* — **fails closed**: true only when a row has `status ∈ (active,
  trialing)` **and** a concrete `current_period_end` that is still within the
  one-day grace window. A NULL / absent `current_period_end` is **not** active.
  Kept exactly in step with `subscriptionIsActive()` in `src/entitlements.js`.
- **`apply_purchase_credits(p_checkout_id, p_user_id, p_product, p_credits, …)`**
  *(`service_role` only — end-user JWTs cannot call it)* — the webhook's
  one-time-purchase grant. In one transaction: `INSERT INTO payments … ON
  CONFLICT (provider_checkout_id) DO NOTHING`; if `row_count = 0` returns
  `{ already_processed: true }` and stops; otherwise `INSERT INTO
  user_entitlements … ON CONFLICT (user_id) DO UPDATE SET unlock_credits =
  unlock_credits + p_credits` (single atomic relative increment, also seeds a
  missing row). Redelivery = no-op; two concurrent purchases both accumulate;
  a mid-transaction failure rolls back both writes.
- `ensure_user_entitlements()` *(authenticated)* — lazy row creation helper.

Existing applications at migration time are grandfathered with an
`application_unlocks(source='comp')` row — a **one-shot** `INSERT … SELECT` over
`public.applications`, so the paywall applies only to applications created
afterwards (nothing grandfathers future applications). `handle_new_user()`
(re-asserted as a superset — profiles + candidate_dna behaviour unchanged) also
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
                     │  one-time  -> apply_purchase_credits RPC (service role):
                     │              claim payments row + unlock_credits += 1|5
                     │              in ONE atomic transaction (idempotent, no
                     │              lost update on concurrent purchases)
                     │  subscription -> upsert public.subscriptions
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
| Call `ai-generate` directly for a locked application | The function calls `has_application_access` for application-scoped request types (402 otherwise). |
| Replay / spoof the Stripe webhook | `constructEventAsync` signature check against `STRIPE_WEBHOOK_SECRET`; `apply_purchase_credits` claims the checkout id (`payments.provider_checkout_id` UNIQUE) in the same transaction as the grant. |
| Double-grant credits on a webhook redelivery / concurrent purchases | `apply_purchase_credits` is atomic: idempotent claim + relative `unlock_credits + n` increment in one transaction. |
| Convert a subscription into a permanent unlock (e.g. calling `consume_free_unlock` while subscribed, then cancelling) | The subscription branch of both `consume_*` RPCs returns `persisted: false` and writes no `application_unlocks` row; access ends when `has_active_subscription` goes false. |
| Retain subscription access via a stale row with no end date | `has_active_subscription` / `subscriptionIsActive` fail closed — a NULL / missing `current_period_end` is not "active". |
| Directly call the credit-grant RPC | `apply_purchase_credits` is `service_role`-only; `anon` / `authenticated` are revoked. |
| Double-spend the free unlock or a credit | `consume_*` row-lock `user_entitlements` (`SELECT … FOR UPDATE`); free unlock checks `free_unlock_used`, credit refuses at `< 1`. |

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
