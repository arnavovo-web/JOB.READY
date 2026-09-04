/* ================================================================== *
 * PHASE 40 — PRICING, PAYMENTS & PAYWALL: PURE ENTITLEMENT LOGIC
 * ------------------------------------------------------------------
 * A pure, deterministic module (same shape as questionMix.js /
 * applicationSchedule.js — no AI call, no web search, no database access,
 * never throws). It is the single source of truth for:
 *
 *   - the four published plans (Free / Single Application / Application Pack /
 *     Job Search Pass) and their prices, shared by the pricing page, the
 *     paywall and the Stripe Checkout call. NOTE: `id` (last_minute_saver /
 *     student_pack / job_search_pass) is the STABLE functional key and never
 *     changes; `amount` and `unlocks` are functional values (mirrored in
 *     create-checkout / stripe-webhook, guarded by phase40PricingPaywall.test.js);
 *     `name` / `headline` / `summary` /
 *     `features` / `badge` / `perUnit` / `savingNote` / `positioning` /
 *     `ctaLabel` are display-only copy;
 *   - deciding, from a user's entitlement snapshot, whether a specific
 *     application may be prepared for right now, and if not, how it could
 *     be unlocked (free unlock / a purchased credit / a subscription);
 *   - the "N application unlocks remaining" copy and the free-unlock
 *     confirmation-modal copy.
 *
 * FREE-UNLOCK RULE (Phase 40): the one free unlock is NEVER consumed
 * silently. `evaluateApplicationAccess` only reports that it is *available*
 * (status ACCESS.FREE); App.jsx then shows an explicit confirmation modal
 * ("You're about to unlock your application at <Company>"), and the unlock
 * is spent only after the user clicks "Unlock & start preparing".
 *
 * SECURITY NOTE: nothing here is an enforcement boundary. Enforcement is
 * server-side — Postgres RLS + SECURITY DEFINER RPCs
 * (consume_free_unlock / consume_unlock_credit / has_application_access)
 * and the Stripe webhook Edge Function. This module only drives UI and
 * picks which server call to make; a tampered entitlement snapshot in the
 * browser cannot grant real access because every paid capability is
 * re-checked in the database and in the ai-generate Edge Function.
 * ================================================================== */

export const CURRENCY = "gbp";

// Prices in the smallest currency unit (pence). Mirrored in
// supabase/functions/create-checkout/index.ts and the Stripe webhook —
// kept in sync by src/phase40PricingPaywall.test.js.
export const PRICING_PLANS = [
  {
    id: "free",
    kind: "free",
    name: "Free",
    emoji: "\u{1F193}", // 🆓
    amount: 0,
    priceLabel: "£0",
    cadence: null,
    unlocks: 1,
    headline: "1 application unlock",
    summary:
      "Unlock one application and prepare for it with personalised AI practice. Nothing is ever charged automatically.",
    features: [
      "1 application unlock",
      "Up to 5 personalised mock interviews for that application",
      "Detailed feedback and analysis after every completed interview",
      "Up to 5 personalised assessment-centre scenarios",
      "Unlimited Classroom access",
    ],
  },
  {
    // id / amount / unlocks are functional keys — unchanged. Display name only.
    id: "last_minute_saver",
    kind: "one_time",
    name: "Single Application",
    emoji: "⚡",
    amount: 299,
    priceLabel: "£2.99",
    cadence: "one-off",
    unlocks: 1,
    headline: "1 application",
    perUnit: "£2.99 per application",
    summary: "Unlock one application and prepare for it with personalised AI practice.",
    features: [
      "5 personalised mock interviews for that application",
      "Detailed feedback after every interview",
      "5 assessment-centre scenarios for that application",
      "Unlimited Classroom access",
    ],
    ctaLabel: "Buy 1 Unlock",
  },
  {
    id: "student_pack",
    kind: "one_time",
    name: "Application Pack",
    emoji: "\u{1F393}", // 🎓
    amount: 499,
    priceLabel: "£4.99",
    cadence: "one-off",
    unlocks: 4,
    headline: "4 applications",
    badge: "⭐ BEST VALUE", // ⭐ — display only
    perUnit: "£1.25 per application",
    // 4 × £2.99 = £11.96 individually vs £4.99 → (11.96 − 4.99) / 11.96 ≈ 58.3%.
    savingNote: "Save over 55% compared with buying singly",
    summary: "Unlock four applications and prepare for each with personalised AI practice.",
    features: [
      "4 application unlocks — use one at a time",
      "5 mock interviews + 5 assessment-centre scenarios per application",
      "Detailed feedback after every interview",
      "Unlimited Classroom access",
    ],
    ctaLabel: "Buy 4 Unlocks",
  },
  {
    id: "job_search_pass",
    kind: "subscription",
    name: "Job Search Pass",
    emoji: "\u{1F525}", // 🔥
    amount: 899,
    priceLabel: "£8.99",
    cadence: "per month",
    // Monthly allowance of application unlocks. Resets each Stripe billing
    // period (see SUBSCRIPTION_MONTHLY_UNLOCKS + the period-scoped count in the
    // migration / evaluateApplicationAccess).
    unlocks: 10,
    headline: "10 applications / month",
    positioning: "Best for an active job search",
    summary: "Unlock up to 10 applications every month and prepare for each with personalised AI practice.",
    features: [
      "Up to 10 application unlocks every month",
      "5 mock interviews + 5 assessment-centre scenarios per application",
      "Detailed feedback after every interview",
      "Unlimited Classroom access",
      "Cancel anytime — access lasts until the end of the paid period",
    ],
    ctaLabel: "Start Job Search Pass",
  },
];

// The Job Search Pass monthly application-unlock allowance. Mirrored server-side
// in consume_subscription_unlock() (the migration) and enforced per Stripe
// billing period. Kept as a named constant so the pricing card, the paywall and
// the enforcement logic can never drift.
export const SUBSCRIPTION_MONTHLY_UNLOCKS = 10;

// Per unlocked application, the ceiling on personalised AI generation. Mirrored
// server-side (the migration's per-application cap triggers). Classroom is NOT
// capped — it is unlimited on every plan.
export const MAX_MOCK_INTERVIEWS_PER_APPLICATION = 5;
export const MAX_AC_SCENARIOS_PER_APPLICATION = 5;

export function planById(id) {
  return PRICING_PLANS.find((p) => p.id === id) || null;
}

// The three plans a signed-in user can actually buy (Free is not a purchase).
export const PURCHASABLE_PRODUCT_IDS = PRICING_PLANS.filter((p) => p.kind !== "free").map((p) => p.id);

export function isPurchasableProduct(id) {
  return PURCHASABLE_PRODUCT_IDS.includes(id);
}

// How many unlock credits a completed one-time purchase grants. Mirrored
// server-side in the Stripe webhook (guarded by the phase test).
export const CREDITS_PER_PRODUCT = {
  last_minute_saver: 1,
  student_pack: 4,
};

/* ------------------------------ subscriptions ------------------------------ */

export const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing"];

// Small grace window so a just-renewed subscription whose webhook is a few
// seconds behind the client clock still reads as active.
export const SUBSCRIPTION_GRACE_MS = 24 * 60 * 60 * 1000; // 24h

// FAIL CLOSED — kept exactly in step with public.has_active_subscription() in
// the migration. A subscription grants access only when its status is
// active/trialing AND it has a concrete, still-valid current_period_end (within
// the grace window). A missing / null / unparseable period end is treated as
// NOT active — we never grant unbounded access off a row that has no end date.
export function subscriptionIsActive(row, now = Date.now()) {
  if (!row || typeof row !== "object") return false;
  if (!ACTIVE_SUBSCRIPTION_STATUSES.includes(row.status)) return false;
  const rawEnd = row.current_period_end;
  if (!rawEnd) return false;
  const end = new Date(rawEnd).getTime();
  if (Number.isNaN(end)) return false;
  return end + SUBSCRIPTION_GRACE_MS > now;
}

/* --------------------------- entitlement snapshot -------------------------- */

// Canonical client-side shape. Everything downstream (paywall, pricing page,
// dashboard copy, gating) reads this — never the raw DB rows.
export function normalizeEntitlements(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const ids = Array.isArray(r.unlockedApplicationIds) ? r.unlockedApplicationIds : [];
  // Subscription unlocks already spent in the CURRENT Stripe billing period.
  // number when we have reliable data (rows + a period start), else null
  // ("unknown" — the UI must NOT fabricate a count; see remainingUnlocksSummary).
  // Guard null/undefined explicitly (Number(null) is 0, not NaN).
  const rawUsed = r.subscriptionUnlocksUsedThisPeriod;
  const usedThisPeriod =
    rawUsed == null || !Number.isFinite(Number(rawUsed)) ? null : Math.max(0, Math.floor(Number(rawUsed)));
  return {
    freeUnlockUsed: !!r.freeUnlockUsed,
    unlockCredits: Math.max(0, Math.floor(Number(r.unlockCredits) || 0)),
    hasActiveSubscription: !!r.hasActiveSubscription,
    subscriptionStatus: typeof r.subscriptionStatus === "string" ? r.subscriptionStatus : null,
    subscriptionCurrentPeriodEnd: r.subscriptionCurrentPeriodEnd || null,
    subscriptionCurrentPeriodStart: r.subscriptionCurrentPeriodStart || null,
    subscriptionUnlocksUsedThisPeriod: usedThisPeriod,
    unlockedApplicationIds: [...new Set(ids.filter((x) => typeof x === "string" && x))],
  };
}

// Build the canonical snapshot from the raw Supabase rows the client loads
// (public.user_entitlements + public.application_unlocks + public.subscriptions).
// application_unlocks rows must carry `source` and `created_at`; subscriptions
// rows must carry `current_period_start` (added by the pricing-model-v2 migration).
export function entitlementsFromRows({ entitlementRow, unlockRows, subscriptionRows }, now = Date.now()) {
  const unlocks = Array.isArray(unlockRows) ? unlockRows : [];
  const subs = Array.isArray(subscriptionRows) ? subscriptionRows : [];
  const activeSub = subs.find((s) => subscriptionIsActive(s, now)) || null;
  const hasActiveSubscription = !!activeSub;
  const periodStartRaw = activeSub?.current_period_start || null;
  const periodStartMs = periodStartRaw ? new Date(periodStartRaw).getTime() : NaN;

  // A row grants access when its source is permanent (free/credit/comp) OR it is
  // a subscription unlock and the subscription is still active — mirrors
  // has_application_access() in the migration.
  const grants = (u) =>
    ["free", "credit", "comp"].includes(u.source) ||
    (u.source === "subscription" && hasActiveSubscription);

  // Subscription unlocks spent in the current billing period. Only reliable when
  // we actually know the period start; otherwise null (UI shows "up to 10").
  let usedThisPeriod = null;
  if (hasActiveSubscription && Number.isFinite(periodStartMs)) {
    usedThisPeriod = unlocks.filter(
      (u) => u.source === "subscription" && new Date(u.created_at).getTime() >= periodStartMs,
    ).length;
  }

  return normalizeEntitlements({
    freeUnlockUsed: !!entitlementRow?.free_unlock_used,
    unlockCredits: entitlementRow?.unlock_credits,
    hasActiveSubscription,
    subscriptionStatus: activeSub?.status || subs[0]?.status || null,
    subscriptionCurrentPeriodEnd: activeSub?.current_period_end || null,
    subscriptionCurrentPeriodStart: periodStartRaw,
    subscriptionUnlocksUsedThisPeriod: usedThisPeriod,
    unlockedApplicationIds: unlocks.filter(grants).map((u) => u.application_id),
  });
}

/* ----------------------------- access decision ---------------------------- */

// The Job Search Pass monthly allowance already spent this billing period.
// Returns null when the count is unknown (no reliable period data).
export function subscriptionUnlocksUsed(entitlements) {
  const e = normalizeEntitlements(entitlements);
  if (!e.hasActiveSubscription) return 0;
  return e.subscriptionUnlocksUsedThisPeriod; // number | null
}

// How many of the 10 monthly application unlocks remain this billing period.
// number when known, null when unknown (UI must not fabricate — see
// remainingUnlocksSummary).
export function subscriptionUnlocksRemaining(entitlements) {
  const e = normalizeEntitlements(entitlements);
  if (!e.hasActiveSubscription) return 0;
  const used = e.subscriptionUnlocksUsedThisPeriod;
  if (used === null || used === undefined) return null;
  return Math.max(0, SUBSCRIPTION_MONTHLY_UNLOCKS - used);
}

export const ACCESS = {
  UNLOCKED: "unlocked", // no action needed
  FREE: "unlockable_free", // free unlock available — show the confirmation modal
  SUBSCRIPTION: "unlockable_subscription", // active Job Search Pass with monthly allowance left
  CREDIT: "unlockable_credit", // user has >=1 purchased credit to spend
  LOCKED: "locked", // nothing available — show the pricing options
};

export function evaluateApplicationAccess({ applicationId, entitlements }) {
  const e = normalizeEntitlements(entitlements);
  const subRemaining = subscriptionUnlocksRemaining(e); // number | null | 0
  const base = {
    creditsRemaining: e.unlockCredits,
    hasSubscription: e.hasActiveSubscription,
    subscriptionUnlocksRemaining: subRemaining,
  };
  if (!applicationId) return { status: ACCESS.LOCKED, reason: "no_application", ...base };

  // Already unlocked for THIS application (free/credit/comp permanently, or a
  // subscription unlock while the subscription is still active). Applies to
  // everyone — the subscription is no longer a blanket "all applications" grant.
  if (e.unlockedApplicationIds.includes(applicationId))
    return { status: ACCESS.UNLOCKED, reason: "already_unlocked", ...base };

  // Active Job Search Pass with monthly allowance remaining (or an unknown-but-
  // present allowance) -> spend one of the 10.
  if (e.hasActiveSubscription && (subRemaining === null || subRemaining > 0))
    return { status: ACCESS.SUBSCRIPTION, reason: "subscription_allowance", ...base };

  // Subscriber who has used all 10 this period falls through to their own free
  // unlock / purchased credits, then the paywall.
  if (!e.freeUnlockUsed) return { status: ACCESS.FREE, reason: "free_available", ...base };
  if (e.unlockCredits > 0) return { status: ACCESS.CREDIT, reason: "credit_available", ...base };
  return { status: ACCESS.LOCKED, reason: "no_entitlement", ...base };
}

export function applicationIsUnlocked({ applicationId, entitlements }) {
  return evaluateApplicationAccess({ applicationId, entitlements }).status === ACCESS.UNLOCKED;
}

// Every not-UNLOCKED status needs an explicit user decision in a modal
// (FREE -> confirmation modal; SUBSCRIPTION/CREDIT/LOCKED -> paywall).
export function accessNeedsPrompt(status) {
  return status === ACCESS.FREE || status === ACCESS.SUBSCRIPTION || status === ACCESS.CREDIT || status === ACCESS.LOCKED;
}

/* ------------------------------- display copy ----------------------------- */

export function remainingUnlocksSummary(entitlements) {
  const e = normalizeEntitlements(entitlements);
  if (e.hasActiveSubscription) {
    // Job Search Pass is NOT unlimited — 10 application unlocks per billing
    // period. `unlimited` is always false here; `subscription` flags the plan
    // for the UI (icon / "Manage plan" link).
    const remaining = subscriptionUnlocksRemaining(e); // number | null
    if (remaining === null) {
      // No reliable usage data yet — never fabricate a count.
      return {
        unlimited: false,
        subscription: true,
        count: null,
        text: "Job Search Pass active",
        detail: `Up to ${SUBSCRIPTION_MONTHLY_UNLOCKS} application unlocks this month`,
      };
    }
    return {
      unlimited: false,
      subscription: true,
      count: remaining,
      text: `${remaining} of ${SUBSCRIPTION_MONTHLY_UNLOCKS} application unlock${remaining === 1 ? "" : "s"} remaining this month`,
      detail:
        remaining === 0
          ? "Your allowance resets at the start of the next billing period"
          : "Job Search Pass — allowance resets each billing period",
    };
  }
  const freeLeft = e.freeUnlockUsed ? 0 : 1;
  const count = freeLeft + e.unlockCredits;
  const text = `${count} application unlock${count === 1 ? "" : "s"} remaining`;
  let detail;
  if (count === 0) detail = "Buy an unlock to prepare for another application";
  else if (freeLeft && !e.unlockCredits) detail = "Your free unlock is still available";
  else if (freeLeft && e.unlockCredits) detail = `Free unlock + ${e.unlockCredits} purchased`;
  else detail = `${e.unlockCredits} purchased credit${e.unlockCredits === 1 ? "" : "s"}`;
  return { unlimited: false, subscription: false, count, text, detail };
}

// Copy for the free-unlock confirmation modal. `company` is optional — when
// present the title names the application ("...your application at Goldman Sachs").
export function freeUnlockPromptCopy(company) {
  const clean = typeof company === "string" ? company.trim() : "";
  return {
    title: clean ? `You're about to unlock your application at ${clean}` : "You're about to unlock this application",
    body: "Once unlocked, you'll have unlimited access to all JOB.READY preparation tools for this application.",
    note: "1 free application unlock remaining",
    cancelLabel: "Not now",
    confirmLabel: "Unlock & start preparing",
  };
}

// Headline + body for the locked-application paywall (SUBSCRIPTION / CREDIT / LOCKED).
export function paywallCopy(access) {
  const status = typeof access === "string" ? access : access?.status;
  if (status === ACCESS.SUBSCRIPTION) {
    return {
      title: "Unlock this application",
      body: "Use one of your Job Search Pass application unlocks for this month, or choose another option below.",
    };
  }
  if (status === ACCESS.CREDIT) {
    return {
      title: "Continue your preparation",
      body: "Unlock this application to open its preparation tools. You can spend one of your unlock credits, or choose another option below.",
    };
  }
  return {
    title: "Continue your preparation",
    body: "Unlock this application to open its preparation tools — mock interviews, assessment-centre scenarios and Classroom.",
  };
}

/* --------------------- checkout-return confirmation --------------------- */

// After returning from Stripe Checkout the browser must NOT claim the purchase
// landed until a fresh entitlement snapshot actually shows it. Given the
// snapshot captured just before checkout (`baseline`) and a freshly-loaded
// snapshot (`current`), has the EXPECTED new entitlement appeared yet?
//   expect === "subscription" -> the Job Search Pass went from inactive to active
//   otherwise (one-time)       -> unlock_credits increased vs the baseline
// A missing `product` param falls back to "any positive change".
export function checkoutConfirmed({ expect, baseline, current }) {
  const b = normalizeEntitlements(baseline);
  const c = normalizeEntitlements(current);
  const gainedSub = c.hasActiveSubscription && !b.hasActiveSubscription;
  const gainedCredit = c.unlockCredits > b.unlockCredits;
  if (expect === "subscription") return gainedSub;
  if (expect === "credits") return gainedCredit;
  return gainedSub || gainedCredit;
}

// Increasing (but short) backoff between entitlement re-checks after a
// checkout return, in milliseconds. First check is immediate; these are the
// waits BETWEEN subsequent checks. ~13s total across 6 checks.
export const CHECKOUT_POLL_BACKOFF_MS = [1200, 1800, 2600, 3600, 4000];

export const CHECKOUT_CONFIRMING_MESSAGE = "Payment received — we're confirming your purchase…";
export const CHECKOUT_PENDING_MESSAGE =
  "Your payment was received and may still be processing. Refresh your account in a moment to check your unlocks.";
