/* ================================================================== *
 * PHASE 40 — PRICING, PAYMENTS & PAYWALL: PURE ENTITLEMENT LOGIC
 * ------------------------------------------------------------------
 * A pure, deterministic module (same shape as questionMix.js /
 * applicationSchedule.js — no AI call, no web search, no database access,
 * never throws). It is the single source of truth for:
 *
 *   - the four published plans (Free / Single Application / Student Pack /
 *     Job Search Pass) and their prices, shared by the pricing page, the
 *     paywall and the Stripe Checkout call. NOTE: `id` (last_minute_saver /
 *     student_pack / job_search_pass), `amount` and `unlocks` are the
 *     functional keys and never change; `name` / `headline` / `summary` /
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
      "1 application unlock, then unlimited access to every JOB.READY preparation tool for that application. Nothing is ever charged automatically.",
    features: [
      "1 application unlock",
      "Unlimited AI mock interviews, Classroom, Assessment Centre and reports for that application",
      "Nothing is charged automatically — you confirm before it's used",
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
    headline: "1 application unlock",
    perUnit: "£2.99 per application",
    summary: "Perfect if you're preparing for one specific role.",
    features: [
      "Unlimited preparation for one application",
      "No subscription",
      "Use the unlock whenever you choose",
    ],
    ctaLabel: "Buy 1 Unlock",
  },
  {
    id: "student_pack",
    kind: "one_time",
    name: "Student Pack",
    emoji: "\u{1F393}", // 🎓
    amount: 499,
    priceLabel: "£4.99",
    cadence: "one-off",
    unlocks: 5,
    headline: "5 application unlocks",
    badge: "⭐ BEST VALUE", // ⭐ — display only
    perUnit: "Just £1 per application",
    // 5 × £2.99 = £14.95 individually vs £4.99 → (14.95 − 4.99) / 14.95 ≈ 66.6%.
    savingNote: "Save over 65% compared with buying individually",
    summary: "Perfect for students applying to multiple roles.",
    features: [
      "5 application unlocks",
      "Use them one application at a time",
      "No subscription",
    ],
    ctaLabel: "Buy 5 Unlocks",
  },
  {
    id: "job_search_pass",
    kind: "subscription",
    name: "Job Search Pass",
    emoji: "\u{1F525}", // 🔥
    amount: 799,
    priceLabel: "£7.99",
    cadence: "per month",
    unlocks: Infinity,
    headline: "Unlimited application unlocks",
    positioning: "Best for multiple applications",
    summary: "For active job seekers applying to multiple roles.",
    features: [
      "Unlimited application unlocks while active",
      "Unlimited AI mock interviews, Classroom, Assessment Centre and reports",
      "Cancel anytime — access lasts until the end of the paid period",
    ],
    ctaLabel: "Start Unlimited",
  },
];

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
  student_pack: 5,
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
  return {
    freeUnlockUsed: !!r.freeUnlockUsed,
    unlockCredits: Math.max(0, Math.floor(Number(r.unlockCredits) || 0)),
    hasActiveSubscription: !!r.hasActiveSubscription,
    subscriptionStatus: typeof r.subscriptionStatus === "string" ? r.subscriptionStatus : null,
    subscriptionCurrentPeriodEnd: r.subscriptionCurrentPeriodEnd || null,
    unlockedApplicationIds: [...new Set(ids.filter((x) => typeof x === "string" && x))],
  };
}

// Build the canonical snapshot from the raw Supabase rows the client loads
// (public.user_entitlements + public.application_unlocks + public.subscriptions).
export function entitlementsFromRows({ entitlementRow, unlockRows, subscriptionRows }, now = Date.now()) {
  const unlocks = Array.isArray(unlockRows) ? unlockRows : [];
  const subs = Array.isArray(subscriptionRows) ? subscriptionRows : [];
  const activeSub = subs.find((s) => subscriptionIsActive(s, now)) || null;
  return normalizeEntitlements({
    freeUnlockUsed: !!entitlementRow?.free_unlock_used,
    unlockCredits: entitlementRow?.unlock_credits,
    hasActiveSubscription: !!activeSub,
    subscriptionStatus: activeSub?.status || subs[0]?.status || null,
    subscriptionCurrentPeriodEnd: activeSub?.current_period_end || null,
    unlockedApplicationIds: unlocks.map((u) => u.application_id),
  });
}

/* ----------------------------- access decision ---------------------------- */

export const ACCESS = {
  UNLOCKED: "unlocked", // no action needed
  FREE: "unlockable_free", // free unlock available — show the confirmation modal
  CREDIT: "unlockable_credit", // user has >=1 purchased credit to spend
  LOCKED: "locked", // nothing available — show the pricing options
};

export function evaluateApplicationAccess({ applicationId, entitlements }) {
  const e = normalizeEntitlements(entitlements);
  const base = { creditsRemaining: e.unlockCredits, hasSubscription: e.hasActiveSubscription };
  if (!applicationId) return { status: ACCESS.LOCKED, reason: "no_application", ...base };
  if (e.hasActiveSubscription) return { status: ACCESS.UNLOCKED, reason: "subscription", ...base };
  if (e.unlockedApplicationIds.includes(applicationId))
    return { status: ACCESS.UNLOCKED, reason: "already_unlocked", ...base };
  if (!e.freeUnlockUsed) return { status: ACCESS.FREE, reason: "free_available", ...base };
  if (e.unlockCredits > 0) return { status: ACCESS.CREDIT, reason: "credit_available", ...base };
  return { status: ACCESS.LOCKED, reason: "no_entitlement", ...base };
}

export function applicationIsUnlocked({ applicationId, entitlements }) {
  return evaluateApplicationAccess({ applicationId, entitlements }).status === ACCESS.UNLOCKED;
}

// Every not-UNLOCKED status now needs an explicit user decision in a modal
// (FREE -> confirmation modal; CREDIT/LOCKED -> paywall).
export function accessNeedsPrompt(status) {
  return status === ACCESS.FREE || status === ACCESS.CREDIT || status === ACCESS.LOCKED;
}

/* ------------------------------- display copy ----------------------------- */

export function remainingUnlocksSummary(entitlements) {
  const e = normalizeEntitlements(entitlements);
  if (e.hasActiveSubscription) {
    return { unlimited: true, count: null, text: "Unlimited applications", detail: "Job Search Pass active" };
  }
  const freeLeft = e.freeUnlockUsed ? 0 : 1;
  const count = freeLeft + e.unlockCredits;
  const text = `${count} application unlock${count === 1 ? "" : "s"} remaining`;
  let detail;
  if (count === 0) detail = "Buy an unlock to prepare for another application";
  else if (freeLeft && !e.unlockCredits) detail = "Your free unlock is still available";
  else if (freeLeft && e.unlockCredits) detail = `Free unlock + ${e.unlockCredits} purchased`;
  else detail = `${e.unlockCredits} purchased credit${e.unlockCredits === 1 ? "" : "s"}`;
  return { unlimited: false, count, text, detail };
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

// Headline + body for the locked-application paywall (CREDIT or LOCKED).
export function paywallCopy(access) {
  const status = typeof access === "string" ? access : access?.status;
  if (status === ACCESS.CREDIT) {
    return {
      title: "Continue your preparation",
      body: "Unlock this application to get unlimited access to all JOB.READY preparation resources. You can spend one of your unlock credits, or choose another option below.",
    };
  }
  return {
    title: "Continue your preparation",
    body: "Unlock this application to get unlimited access to all JOB.READY preparation resources.",
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
