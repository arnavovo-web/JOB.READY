/* ================================================================== *
 * PHASE 40 — ENTITLEMENT LOGIC (pure unit tests)
 * ------------------------------------------------------------------
 * Covers src/entitlements.js: the four plans, the "can this application
 * be prepared for right now" decision, subscription-active evaluation,
 * the raw-rows -> snapshot builder, the "N unlocks remaining" copy and
 * the free-unlock confirmation-modal copy.
 * Node env, no DOM, no network — same convention as questionMix.test.js.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import {
  PRICING_PLANS, planById, PURCHASABLE_PRODUCT_IDS, isPurchasableProduct,
  CREDITS_PER_PRODUCT, CURRENCY, SUBSCRIPTION_MONTHLY_UNLOCKS,
  ACTIVE_SUBSCRIPTION_STATUSES, subscriptionIsActive,
  normalizeEntitlements, entitlementsFromRows,
  ACCESS, evaluateApplicationAccess, applicationIsUnlocked, accessNeedsPrompt,
  subscriptionUnlocksRemaining, subscriptionUnlocksUsed,
  remainingUnlocksSummary, freeUnlockPromptCopy, paywallCopy,
  checkoutConfirmed, CHECKOUT_POLL_BACKOFF_MS, CHECKOUT_CONFIRMING_MESSAGE, CHECKOUT_PENDING_MESSAGE,
} from "./entitlements.js";

/* ------------------------------ the plans ------------------------------ */
describe("PRICING_PLANS — the four published plans", () => {
  it("has exactly the four plans in order — ids are the stable functional keys (display name is separate)", () => {
    expect(PRICING_PLANS.map((p) => p.id)).toEqual([
      "free", "last_minute_saver", "student_pack", "job_search_pass",
    ]);
    // ids never change even though display names do (Single Application / Application Pack)
    expect(planById("last_minute_saver").name).toBe("Single Application");
    expect(planById("student_pack").name).toBe("Application Pack");
    expect(planById("job_search_pass").name).toBe("Job Search Pass");
  });

  it("prices match the pricing model — £2.99 / £4.99 / £8.99 (pence + label)", () => {
    const byId = Object.fromEntries(PRICING_PLANS.map((p) => [p.id, p]));
    expect(byId.free.amount).toBe(0);
    expect(byId.free.priceLabel).toBe("£0");
    expect(byId.last_minute_saver.amount).toBe(299);
    expect(byId.last_minute_saver.priceLabel).toBe("£2.99");
    expect(byId.student_pack.amount).toBe(499);
    expect(byId.student_pack.priceLabel).toBe("£4.99");
    expect(byId.job_search_pass.amount).toBe(899);
    expect(byId.job_search_pass.priceLabel).toBe("£8.99");
    expect(byId.job_search_pass.cadence).toBe("per month");
  });

  it("application allowances match the model — 1 / 1 / 4 / 10-per-month", () => {
    const byId = Object.fromEntries(PRICING_PLANS.map((p) => [p.id, p]));
    expect(byId.free.unlocks).toBe(1);
    expect(byId.last_minute_saver.unlocks).toBe(1);
    expect(byId.student_pack.unlocks).toBe(4);
    expect(byId.job_search_pass.unlocks).toBe(10);
  });

  it("currency is GBP", () => {
    expect(CURRENCY).toBe("gbp");
  });

  it("planById resolves known ids and returns null otherwise", () => {
    expect(planById("student_pack").name).toBe("Application Pack");
    expect(planById("nope")).toBeNull();
    expect(planById(null)).toBeNull();
  });

  it("only the three paid plans are purchasable, and credits-per-product is consistent", () => {
    expect(PURCHASABLE_PRODUCT_IDS).toEqual(["last_minute_saver", "student_pack", "job_search_pass"]);
    expect(isPurchasableProduct("free")).toBe(false);
    expect(isPurchasableProduct("student_pack")).toBe(true);
    // one-time products only — the subscription grants a monthly allowance, not credits
    expect(CREDITS_PER_PRODUCT.last_minute_saver).toBe(1);
    expect(CREDITS_PER_PRODUCT.student_pack).toBe(4);
    expect(CREDITS_PER_PRODUCT.job_search_pass).toBeUndefined();
  });
});

/* --------------------------- subscriptions --------------------------- */
describe("subscriptionIsActive", () => {
  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const past = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  it("active/trialing with a future period end are active", () => {
    expect(subscriptionIsActive({ status: "active", current_period_end: future })).toBe(true);
    expect(subscriptionIsActive({ status: "trialing", current_period_end: future })).toBe(true);
  });

  it("past_due / canceled / incomplete never grant access", () => {
    for (const status of ["past_due", "canceled", "incomplete", "unpaid", "paused"]) {
      expect(subscriptionIsActive({ status, current_period_end: future })).toBe(false);
    }
  });

  it("an expired period end (beyond the grace window) is not active", () => {
    expect(subscriptionIsActive({ status: "active", current_period_end: past })).toBe(false);
  });

  it("a just-lapsed period end within the 24h grace window is still active", () => {
    const almost = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    expect(subscriptionIsActive({ status: "active", current_period_end: almost })).toBe(true);
  });

  it("FAILS CLOSED on a missing / null / unparseable period end — even for active/trialing (R1)", () => {
    for (const status of ["active", "trialing"]) {
      expect(subscriptionIsActive({ status, current_period_end: null })).toBe(false);
      expect(subscriptionIsActive({ status, current_period_end: undefined })).toBe(false);
      expect(subscriptionIsActive({ status })).toBe(false); // key absent
      expect(subscriptionIsActive({ status, current_period_end: "" })).toBe(false);
      expect(subscriptionIsActive({ status, current_period_end: "not-a-date" })).toBe(false);
      expect(subscriptionIsActive({ status, current_period_end: 0 })).toBe(false);
    }
    expect(subscriptionIsActive({ status: "canceled", current_period_end: null })).toBe(false);
  });

  it("still active for active/trialing WITH a concrete, still-valid period end (unchanged)", () => {
    expect(subscriptionIsActive({ status: "active", current_period_end: future })).toBe(true);
    expect(subscriptionIsActive({ status: "trialing", current_period_end: future })).toBe(true);
  });

  it("null / non-object input is safe", () => {
    expect(subscriptionIsActive(null)).toBe(false);
    expect(subscriptionIsActive(undefined)).toBe(false);
    expect(subscriptionIsActive("active")).toBe(false);
  });

  it("ACTIVE_SUBSCRIPTION_STATUSES is exactly active + trialing", () => {
    expect(ACTIVE_SUBSCRIPTION_STATUSES).toEqual(["active", "trialing"]);
  });
});

/* --------------------------- snapshot shaping --------------------------- */
describe("normalizeEntitlements", () => {
  it("fills every field with a safe default from an empty / garbage input", () => {
    for (const input of [undefined, null, {}, 42, "x", []]) {
      expect(normalizeEntitlements(input)).toEqual({
        freeUnlockUsed: false,
        unlockCredits: 0,
        hasActiveSubscription: false,
        subscriptionStatus: null,
        subscriptionCurrentPeriodEnd: null,
        subscriptionCurrentPeriodStart: null,
        subscriptionUnlocksUsedThisPeriod: null,
        unlockedApplicationIds: [],
      });
    }
  });

  it("clamps credits to a non-negative integer and dedupes unlocked ids", () => {
    const n = normalizeEntitlements({
      unlockCredits: -3,
      unlockedApplicationIds: ["a", "a", "b", "", null, 7],
    });
    expect(n.unlockCredits).toBe(0);
    expect(n.unlockedApplicationIds).toEqual(["a", "b"]);
    expect(normalizeEntitlements({ unlockCredits: 4.9 }).unlockCredits).toBe(4);
  });
});

describe("entitlementsFromRows", () => {
  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

  it("builds the snapshot from user_entitlements + application_unlocks + subscriptions rows", () => {
    const snap = entitlementsFromRows({
      entitlementRow: { free_unlock_used: true, unlock_credits: 3 },
      unlockRows: [{ application_id: "app-1", source: "free" }, { application_id: "app-2", source: "credit" }],
      subscriptionRows: [{ status: "active", current_period_end: future }],
    });
    expect(snap.freeUnlockUsed).toBe(true);
    expect(snap.unlockCredits).toBe(3);
    expect(snap.hasActiveSubscription).toBe(true);
    expect(snap.subscriptionStatus).toBe("active");
    expect(snap.unlockedApplicationIds.sort()).toEqual(["app-1", "app-2"]);
  });

  it("no rows at all -> a fresh account (free unlock available, nothing else)", () => {
    const snap = entitlementsFromRows({ entitlementRow: null, unlockRows: [], subscriptionRows: [] });
    expect(snap).toEqual(normalizeEntitlements({}));
  });

  it("an inactive subscription row does not set hasActiveSubscription", () => {
    const snap = entitlementsFromRows({
      entitlementRow: null, unlockRows: [],
      subscriptionRows: [{ status: "canceled", current_period_end: future }],
    });
    expect(snap.hasActiveSubscription).toBe(false);
  });
});

/* --------------------------- the access decision --------------------------- */
describe("evaluateApplicationAccess", () => {
  const APP = "app-123";

  it("an active subscription does NOT blanket-unlock every application — each needs a spend (ACCESS.SUBSCRIPTION)", () => {
    const ent = normalizeEntitlements({ hasActiveSubscription: true, freeUnlockUsed: true, unlockCredits: 0, subscriptionUnlocksUsedThisPeriod: 0 });
    expect(evaluateApplicationAccess({ applicationId: APP, entitlements: ent }).status).toBe(ACCESS.SUBSCRIPTION);
    expect(evaluateApplicationAccess({ applicationId: "other", entitlements: ent }).status).toBe(ACCESS.SUBSCRIPTION);
  });

  it("an application already unlocked (row present) IS unlocked for a subscriber, no re-spend", () => {
    const ent = normalizeEntitlements({ hasActiveSubscription: true, freeUnlockUsed: true, unlockedApplicationIds: [APP], subscriptionUnlocksUsedThisPeriod: 3 });
    expect(evaluateApplicationAccess({ applicationId: APP, entitlements: ent }).status).toBe(ACCESS.UNLOCKED);
    expect(evaluateApplicationAccess({ applicationId: "other", entitlements: ent }).status).toBe(ACCESS.SUBSCRIPTION);
  });

  it("subscriber who has used all 10 this period falls through to free unlock / credits / paywall", () => {
    const used10 = { hasActiveSubscription: true, subscriptionUnlocksUsedThisPeriod: 10 };
    expect(evaluateApplicationAccess({ applicationId: APP, entitlements: normalizeEntitlements({ ...used10, freeUnlockUsed: false }) }).status).toBe(ACCESS.FREE);
    expect(evaluateApplicationAccess({ applicationId: APP, entitlements: normalizeEntitlements({ ...used10, freeUnlockUsed: true, unlockCredits: 2 }) }).status).toBe(ACCESS.CREDIT);
    expect(evaluateApplicationAccess({ applicationId: APP, entitlements: normalizeEntitlements({ ...used10, freeUnlockUsed: true, unlockCredits: 0 }) }).status).toBe(ACCESS.LOCKED);
  });

  it("subscriber with an UNKNOWN period count still gets ACCESS.SUBSCRIPTION (allowance present, count not fabricated)", () => {
    const ent = normalizeEntitlements({ hasActiveSubscription: true, subscriptionUnlocksUsedThisPeriod: null });
    expect(evaluateApplicationAccess({ applicationId: APP, entitlements: ent }).status).toBe(ACCESS.SUBSCRIPTION);
  });

  it("an application already in unlockedApplicationIds is unlocked", () => {
    const ent = normalizeEntitlements({ unlockedApplicationIds: [APP], freeUnlockUsed: true });
    expect(evaluateApplicationAccess({ applicationId: APP, entitlements: ent }).status).toBe(ACCESS.UNLOCKED);
    expect(evaluateApplicationAccess({ applicationId: "another", entitlements: ent }).status).not.toBe(ACCESS.UNLOCKED);
  });

  it("fresh account -> the first application is FREE (confirmation modal), which still needs a prompt", () => {
    const a = evaluateApplicationAccess({ applicationId: APP, entitlements: normalizeEntitlements({}) });
    expect(a.status).toBe(ACCESS.FREE);
    // Phase 40: FREE is no longer silent — it needs the explicit confirmation modal.
    expect(accessNeedsPrompt(a.status)).toBe(true);
  });

  it("free unlock already used, credits available -> unlockable via a credit (needs the paywall)", () => {
    const ent = normalizeEntitlements({ freeUnlockUsed: true, unlockCredits: 2 });
    const a = evaluateApplicationAccess({ applicationId: APP, entitlements: ent });
    expect(a.status).toBe(ACCESS.CREDIT);
    expect(a.creditsRemaining).toBe(2);
    expect(accessNeedsPrompt(a.status)).toBe(true);
  });

  it("free unlock used, no credits, no subscription -> fully locked", () => {
    const ent = normalizeEntitlements({ freeUnlockUsed: true, unlockCredits: 0 });
    const a = evaluateApplicationAccess({ applicationId: APP, entitlements: ent });
    expect(a.status).toBe(ACCESS.LOCKED);
    expect(accessNeedsPrompt(a.status)).toBe(true);
  });

  it("an already-unlocked application stays unlocked even with 0 credits and no subscription", () => {
    const ent = normalizeEntitlements({ freeUnlockUsed: true, unlockCredits: 0, unlockedApplicationIds: [APP] });
    expect(applicationIsUnlocked({ applicationId: APP, entitlements: ent })).toBe(true);
    expect(accessNeedsPrompt(evaluateApplicationAccess({ applicationId: APP, entitlements: ent }).status)).toBe(false);
  });

  it("no applicationId -> locked, never a silent free spend", () => {
    const a = evaluateApplicationAccess({ applicationId: null, entitlements: normalizeEntitlements({}) });
    expect(a.status).toBe(ACCESS.LOCKED);
  });

  it("an active subscription with allowance is offered before the free unlock (ACCESS.SUBSCRIPTION, not FREE)", () => {
    const ent = normalizeEntitlements({ hasActiveSubscription: true, freeUnlockUsed: false, subscriptionUnlocksUsedThisPeriod: 4 });
    expect(evaluateApplicationAccess({ applicationId: APP, entitlements: ent }).status).toBe(ACCESS.SUBSCRIPTION);
  });
});

/* ------------------- subscription monthly allowance (client mirror) ------------------- */
describe("subscriptionUnlocksRemaining", () => {
  it("0 for a non-subscriber", () => {
    expect(subscriptionUnlocksRemaining(normalizeEntitlements({}))).toBe(0);
  });
  it("10 - used for a subscriber with a known count, clamped at 0", () => {
    expect(subscriptionUnlocksRemaining(normalizeEntitlements({ hasActiveSubscription: true, subscriptionUnlocksUsedThisPeriod: 0 }))).toBe(10);
    expect(subscriptionUnlocksRemaining(normalizeEntitlements({ hasActiveSubscription: true, subscriptionUnlocksUsedThisPeriod: 7 }))).toBe(3);
    expect(subscriptionUnlocksRemaining(normalizeEntitlements({ hasActiveSubscription: true, subscriptionUnlocksUsedThisPeriod: 10 }))).toBe(0);
    expect(subscriptionUnlocksRemaining(normalizeEntitlements({ hasActiveSubscription: true, subscriptionUnlocksUsedThisPeriod: 99 }))).toBe(0);
  });
  it("null (unknown count) for a subscriber with no reliable period data", () => {
    expect(subscriptionUnlocksRemaining(normalizeEntitlements({ hasActiveSubscription: true, subscriptionUnlocksUsedThisPeriod: null }))).toBeNull();
  });
});

describe("entitlementsFromRows — subscription period usage", () => {
  const future = new Date(Date.now() + 20 * 864e5).toISOString();
  const periodStart = new Date(Date.now() - 10 * 864e5).toISOString();
  const inPeriod = new Date(Date.now() - 3 * 864e5).toISOString();
  const beforePeriod = new Date(Date.now() - 40 * 864e5).toISOString();

  it("counts only source='subscription' unlocks created since current_period_start; ignores older ones and other sources", () => {
    const snap = entitlementsFromRows({
      entitlementRow: null,
      unlockRows: [
        { application_id: "a", source: "subscription", created_at: inPeriod },
        { application_id: "b", source: "subscription", created_at: inPeriod },
        { application_id: "c", source: "subscription", created_at: beforePeriod }, // prior period — not counted
        { application_id: "d", source: "credit", created_at: inPeriod },           // not a subscription unlock
      ],
      subscriptionRows: [{ status: "active", current_period_end: future, current_period_start: periodStart }],
    });
    expect(snap.subscriptionUnlocksUsedThisPeriod).toBe(2);
    // access-granting id set: both in-period sub rows + the credit row + the prior-period sub row (sub still active)
    expect(snap.unlockedApplicationIds.sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("no current_period_start -> usage count is null (unknown), never fabricated", () => {
    const snap = entitlementsFromRows({
      entitlementRow: null,
      unlockRows: [{ application_id: "a", source: "subscription", created_at: inPeriod }],
      subscriptionRows: [{ status: "active", current_period_end: future }], // no period start
    });
    expect(snap.subscriptionUnlocksUsedThisPeriod).toBeNull();
  });

  it("inactive subscription -> subscription rows do NOT grant access and are not counted", () => {
    const snap = entitlementsFromRows({
      entitlementRow: null,
      unlockRows: [
        { application_id: "a", source: "subscription", created_at: inPeriod },
        { application_id: "b", source: "credit", created_at: inPeriod },
      ],
      subscriptionRows: [{ status: "canceled", current_period_end: new Date(Date.now() - 864e5).toISOString(), current_period_start: beforePeriod }],
    });
    expect(snap.hasActiveSubscription).toBe(false);
    expect(snap.subscriptionUnlocksUsedThisPeriod).toBeNull();
    expect(snap.unlockedApplicationIds).toEqual(["b"]); // credit persists; subscription row does not grant
  });
});

/* --------------------------- display copy --------------------------- */
describe("remainingUnlocksSummary", () => {
  it("fresh account -> '1 application unlock remaining'", () => {
    const s = remainingUnlocksSummary(normalizeEntitlements({}));
    expect(s.unlimited).toBe(false);
    expect(s.count).toBe(1);
    expect(s.text).toBe("1 application unlock remaining");
  });

  it("free used + 4 credits -> '4 application unlocks remaining'", () => {
    const s = remainingUnlocksSummary(normalizeEntitlements({ freeUnlockUsed: true, unlockCredits: 4 }));
    expect(s.count).toBe(4);
    expect(s.text).toBe("4 application unlocks remaining");
  });

  it("free unused + 5 credits -> 6 total", () => {
    const s = remainingUnlocksSummary(normalizeEntitlements({ freeUnlockUsed: false, unlockCredits: 5 }));
    expect(s.count).toBe(6);
    expect(s.text).toBe("6 application unlocks remaining");
  });

  it("nothing left -> '0 application unlocks remaining' with a buy prompt", () => {
    const s = remainingUnlocksSummary(normalizeEntitlements({ freeUnlockUsed: true, unlockCredits: 0 }));
    expect(s.count).toBe(0);
    expect(s.text).toBe("0 application unlocks remaining");
    expect(s.detail).toMatch(/buy/i);
  });

  it("active subscription, UNKNOWN count -> not unlimited; 'Job Search Pass active' + 'up to 10 this month'", () => {
    const s = remainingUnlocksSummary(normalizeEntitlements({ hasActiveSubscription: true, freeUnlockUsed: true, subscriptionUnlocksUsedThisPeriod: null }));
    expect(s.unlimited).toBe(false); // Job Search Pass is NEVER unlimited
    expect(s.subscription).toBe(true);
    expect(s.count).toBeNull(); // count is not fabricated
    expect(s.text).toBe("Job Search Pass active");
    expect(s.detail).toMatch(/up to 10 application unlocks this month/i);
  });

  it("active subscription, KNOWN count -> 'N of 10 application unlocks remaining this month'", () => {
    const s = remainingUnlocksSummary(normalizeEntitlements({ hasActiveSubscription: true, subscriptionUnlocksUsedThisPeriod: 3 }));
    expect(s.unlimited).toBe(false);
    expect(s.subscription).toBe(true);
    expect(s.count).toBe(7);
    expect(s.text).toBe("7 of 10 application unlocks remaining this month");
  });

  it("active subscription, allowance exhausted -> '0 of 10 ... remaining' + reset note", () => {
    const s = remainingUnlocksSummary(normalizeEntitlements({ hasActiveSubscription: true, subscriptionUnlocksUsedThisPeriod: 10 }));
    expect(s.count).toBe(0);
    expect(s.text).toBe("0 of 10 application unlocks remaining this month");
    expect(s.detail).toMatch(/resets at the start of the next billing period/i);
  });

  it("no summary path ever reports unlimited:true for Job Search Pass", () => {
    for (const used of [null, 0, 5, 10, 999]) {
      const s = remainingUnlocksSummary(normalizeEntitlements({ hasActiveSubscription: true, subscriptionUnlocksUsedThisPeriod: used }));
      expect(s.unlimited).toBe(false);
    }
  });
});

describe("freeUnlockPromptCopy — the explicit confirmation modal", () => {
  it("names the application by company when provided", () => {
    const c = freeUnlockPromptCopy("Goldman Sachs");
    expect(c.title).toBe("You're about to unlock your application at Goldman Sachs");
    expect(c.body).toMatch(/unlimited access to all JOB\.READY preparation tools for this application/i);
    expect(c.note).toBe("1 free application unlock remaining");
    expect(c.cancelLabel).toBe("Not now");
    expect(c.confirmLabel).toBe("Unlock & start preparing");
  });

  it("falls back to a generic title with no / blank company", () => {
    for (const co of [undefined, null, "", "   "]) {
      expect(freeUnlockPromptCopy(co).title).toBe("You're about to unlock this application");
    }
  });
});

describe("paywallCopy", () => {
  it("CREDIT / LOCKED lead with 'Continue your preparation'; no false 'unlimited' promise", () => {
    for (const status of [ACCESS.CREDIT, ACCESS.LOCKED]) {
      const c = paywallCopy(status);
      expect(c.title).toBe("Continue your preparation");
      expect(typeof c.body).toBe("string");
      expect(c.body.length).toBeGreaterThan(0);
      expect(c.body).not.toMatch(/unlimited access to all JOB\.READY preparation resources/i);
    }
  });

  it("SUBSCRIPTION paywall names the monthly Job Search Pass allowance", () => {
    const c = paywallCopy(ACCESS.SUBSCRIPTION);
    expect(c.title).toBe("Unlock this application");
    expect(c.body).toMatch(/Job Search Pass application unlocks for this month/i);
  });

  it("accepts either a status string or the full access object", () => {
    expect(paywallCopy(ACCESS.LOCKED).title).toBe(paywallCopy({ status: ACCESS.LOCKED }).title);
    expect(paywallCopy(ACCESS.SUBSCRIPTION).title).toBe(paywallCopy({ status: ACCESS.SUBSCRIPTION }).title);
  });
});

/* --------------------- checkout-return confirmation --------------------- */
describe("checkoutConfirmed — only true once the NEW entitlement is actually observed", () => {
  const zero = normalizeEntitlements({});
  const twoCredits = normalizeEntitlements({ freeUnlockUsed: true, unlockCredits: 2 });
  const withSub = normalizeEntitlements({ hasActiveSubscription: true, freeUnlockUsed: true });

  it("credits: false until unlock_credits rises above the pre-checkout baseline", () => {
    // immediate return, webhook not processed yet -> current == baseline
    expect(checkoutConfirmed({ expect: "credits", baseline: zero, current: zero })).toBe(false);
    // still processing (a stale/partial refresh) -> still equal
    expect(checkoutConfirmed({ expect: "credits", baseline: twoCredits, current: twoCredits })).toBe(false);
    // credits appeared during polling
    expect(checkoutConfirmed({ expect: "credits", baseline: zero, current: normalizeEntitlements({ unlockCredits: 5 }) })).toBe(true);
    // a SECOND pack while already holding 2 -> only true when it goes ABOVE 2, not merely > 0
    expect(checkoutConfirmed({ expect: "credits", baseline: twoCredits, current: twoCredits })).toBe(false);
    expect(checkoutConfirmed({ expect: "credits", baseline: twoCredits, current: normalizeEntitlements({ freeUnlockUsed: true, unlockCredits: 7 }) })).toBe(true);
  });

  it("subscription: false until an INACTIVE→ACTIVE transition vs the baseline", () => {
    expect(checkoutConfirmed({ expect: "subscription", baseline: zero, current: zero })).toBe(false);
    expect(checkoutConfirmed({ expect: "subscription", baseline: zero, current: withSub })).toBe(true);
    // already had an active sub in the baseline -> not a new gain
    expect(checkoutConfirmed({ expect: "subscription", baseline: withSub, current: withSub })).toBe(false);
    // a credit arriving does NOT confirm a subscription purchase
    expect(checkoutConfirmed({ expect: "subscription", baseline: zero, current: normalizeEntitlements({ unlockCredits: 5 }) })).toBe(false);
  });

  it("unknown product ('any'): confirmed on any positive change (credit OR new subscription)", () => {
    expect(checkoutConfirmed({ expect: "any", baseline: zero, current: zero })).toBe(false);
    expect(checkoutConfirmed({ expect: "any", baseline: zero, current: normalizeEntitlements({ unlockCredits: 1 }) })).toBe(true);
    expect(checkoutConfirmed({ expect: "any", baseline: zero, current: withSub })).toBe(true);
  });

  it("garbage / missing snapshots are safe (normalised, never throws)", () => {
    expect(checkoutConfirmed({ expect: "credits", baseline: null, current: undefined })).toBe(false);
    expect(checkoutConfirmed({ expect: "credits", baseline: undefined, current: { unlockCredits: 3 } })).toBe(true);
  });

  it("models the full poll lifecycle: absent → absent → present", () => {
    const baseline = normalizeEntitlements({ freeUnlockUsed: true, unlockCredits: 1 });
    const polls = [
      normalizeEntitlements({ freeUnlockUsed: true, unlockCredits: 1 }), // t0: not yet
      normalizeEntitlements({ freeUnlockUsed: true, unlockCredits: 1 }), // t1: not yet
      normalizeEntitlements({ freeUnlockUsed: true, unlockCredits: 6 }), // t2: webhook done
    ];
    const results = polls.map((current) => checkoutConfirmed({ expect: "credits", baseline, current }));
    expect(results).toEqual([false, false, true]);
  });
});

describe("checkout-return copy + backoff constants", () => {
  it("the confirming message never claims the purchase is already available", () => {
    expect(CHECKOUT_CONFIRMING_MESSAGE).toBe("Payment received — we're confirming your purchase…");
    expect(CHECKOUT_CONFIRMING_MESSAGE).not.toMatch(/on your account|available|unlocked|added/i);
  });
  it("the pending message is truthful (may still be processing) and points to Refresh", () => {
    expect(CHECKOUT_PENDING_MESSAGE).toBe(
      "Your payment was received and may still be processing. Refresh your account in a moment to check your unlocks.",
    );
    expect(CHECKOUT_PENDING_MESSAGE).not.toMatch(/\bfailed\b|\bsuccess\b|is now on your account/i);
  });
  it("backoff is a short increasing series of positive waits", () => {
    expect(Array.isArray(CHECKOUT_POLL_BACKOFF_MS)).toBe(true);
    expect(CHECKOUT_POLL_BACKOFF_MS.length).toBeGreaterThanOrEqual(3);
    for (const ms of CHECKOUT_POLL_BACKOFF_MS) expect(ms).toBeGreaterThan(0);
    for (let i = 1; i < CHECKOUT_POLL_BACKOFF_MS.length; i++) {
      expect(CHECKOUT_POLL_BACKOFF_MS[i]).toBeGreaterThanOrEqual(CHECKOUT_POLL_BACKOFF_MS[i - 1]);
    }
    const total = CHECKOUT_POLL_BACKOFF_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(4000);   // gives the webhook a real chance
    expect(total).toBeLessThan(30000);     // still "short"
  });
});
