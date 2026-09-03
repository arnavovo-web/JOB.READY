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
  CREDITS_PER_PRODUCT, CURRENCY,
  ACTIVE_SUBSCRIPTION_STATUSES, subscriptionIsActive,
  normalizeEntitlements, entitlementsFromRows,
  ACCESS, evaluateApplicationAccess, applicationIsUnlocked, accessNeedsPrompt,
  remainingUnlocksSummary, freeUnlockPromptCopy, paywallCopy,
} from "./entitlements.js";

/* ------------------------------ the plans ------------------------------ */
describe("PRICING_PLANS — the four published plans", () => {
  it("has exactly Free / Last-Minute Saver / Student Pack / Job Search Pass", () => {
    expect(PRICING_PLANS.map((p) => p.id)).toEqual([
      "free", "last_minute_saver", "student_pack", "job_search_pass",
    ]);
  });

  it("prices match the final pricing model (pence + label)", () => {
    const byId = Object.fromEntries(PRICING_PLANS.map((p) => [p.id, p]));
    expect(byId.free.amount).toBe(0);
    expect(byId.free.priceLabel).toBe("£0");
    expect(byId.last_minute_saver.amount).toBe(299);
    expect(byId.last_minute_saver.priceLabel).toBe("£2.99");
    expect(byId.student_pack.amount).toBe(499);
    expect(byId.student_pack.priceLabel).toBe("£4.99");
    expect(byId.job_search_pass.amount).toBe(799);
    expect(byId.job_search_pass.priceLabel).toBe("£7.99");
    expect(byId.job_search_pass.cadence).toBe("per month");
  });

  it("unlock counts match the model (1 / 1 / 5 / unlimited)", () => {
    const byId = Object.fromEntries(PRICING_PLANS.map((p) => [p.id, p]));
    expect(byId.free.unlocks).toBe(1);
    expect(byId.last_minute_saver.unlocks).toBe(1);
    expect(byId.student_pack.unlocks).toBe(5);
    expect(byId.job_search_pass.unlocks).toBe(Infinity);
  });

  it("currency is GBP", () => {
    expect(CURRENCY).toBe("gbp");
  });

  it("planById resolves known ids and returns null otherwise", () => {
    expect(planById("student_pack").name).toBe("Student Pack");
    expect(planById("nope")).toBeNull();
    expect(planById(null)).toBeNull();
  });

  it("only the three paid plans are purchasable, and credits-per-product is consistent", () => {
    expect(PURCHASABLE_PRODUCT_IDS).toEqual(["last_minute_saver", "student_pack", "job_search_pass"]);
    expect(isPurchasableProduct("free")).toBe(false);
    expect(isPurchasableProduct("student_pack")).toBe(true);
    expect(CREDITS_PER_PRODUCT.last_minute_saver).toBe(1);
    expect(CREDITS_PER_PRODUCT.student_pack).toBe(5);
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

  it("missing / unparseable period end falls back to the status", () => {
    expect(subscriptionIsActive({ status: "active", current_period_end: null })).toBe(true);
    expect(subscriptionIsActive({ status: "active", current_period_end: "not-a-date" })).toBe(true);
    expect(subscriptionIsActive({ status: "canceled", current_period_end: null })).toBe(false);
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

  it("an active subscription unlocks every application", () => {
    const ent = normalizeEntitlements({ hasActiveSubscription: true, freeUnlockUsed: true, unlockCredits: 0 });
    expect(evaluateApplicationAccess({ applicationId: APP, entitlements: ent }).status).toBe(ACCESS.UNLOCKED);
    expect(evaluateApplicationAccess({ applicationId: "other", entitlements: ent }).status).toBe(ACCESS.UNLOCKED);
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

  it("subscription takes priority over the free unlock", () => {
    const ent = normalizeEntitlements({ hasActiveSubscription: true, freeUnlockUsed: false });
    expect(evaluateApplicationAccess({ applicationId: APP, entitlements: ent }).status).toBe(ACCESS.UNLOCKED);
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

  it("active subscription -> unlimited", () => {
    const s = remainingUnlocksSummary(normalizeEntitlements({ hasActiveSubscription: true, freeUnlockUsed: true }));
    expect(s.unlimited).toBe(true);
    expect(s.count).toBeNull();
    expect(s.text).toBe("Unlimited applications");
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
  it("always leads with 'Continue your preparation' and the unlimited-access line", () => {
    for (const status of [ACCESS.CREDIT, ACCESS.LOCKED]) {
      const c = paywallCopy(status);
      expect(c.title).toBe("Continue your preparation");
      expect(c.body).toMatch(/unlimited access to all JOB\.READY preparation resources/i);
    }
  });

  it("accepts either a status string or the full access object", () => {
    expect(paywallCopy(ACCESS.LOCKED).title).toBe(paywallCopy({ status: ACCESS.LOCKED }).title);
  });
});
