/* ================================================================== *
 * PHASE 40 — POST-STRIPE-CHECKOUT RETURN UX
 * ------------------------------------------------------------------
 * On returning with ?checkout=success the browser must NOT claim the
 * purchase landed until a fresh entitlement snapshot actually shows the
 * NEW entitlement (Stripe's webhook + the DB are the sole source of
 * truth — the browser grants nothing). It shows a truthful "confirming"
 * banner and polls refreshEntitlements() with a short backoff; on
 * confirmation it swaps to a success flash; on timeout it shows a
 * "may still be processing" banner with a Refresh button — never a
 * false success.
 *
 * App() is a React closure this node suite can't render, so the poll
 * loop and the Refresh handler are exercised against a faithful model
 * of exactly what the effect does, and the wiring is asserted by
 * source inspection (repo convention — cf. supabaseSchemaTracking).
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  normalizeEntitlements, checkoutConfirmed,
  CHECKOUT_POLL_BACKOFF_MS, CHECKOUT_CONFIRMING_MESSAGE, CHECKOUT_PENDING_MESSAGE,
} from "./entitlements.js";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

/* -------- faithful model of the useEffect poll + the Refresh handler -------- */
const CONFIRMED_FLASH = (productName) =>
  productName ? `${productName} confirmed — it's on your account now.`
             : "Purchase confirmed — your account has been updated.";

// Mirrors the effect: set { phase:"confirming" }, then check at i=0..N with a
// wait between checks; on confirm -> banner cleared + success flash; if never
// confirmed within the window -> { phase:"pending" }.
function simulatePoll({ expect: expected, baseline, productName, snapshotAt }) {
  const N = CHECKOUT_POLL_BACKOFF_MS.length;
  let banner = { phase: "confirming", productName, expect: expected, baseline };
  let flash = null;
  let checks = 0;
  for (let i = 0; i <= N; i++) {
    checks++;
    const current = snapshotAt(i);
    if (checkoutConfirmed({ expect: expected, baseline, current })) {
      banner = null;
      flash = CONFIRMED_FLASH(productName);
      break;
    }
  }
  if (banner && banner.phase === "confirming") banner = { ...banner, phase: "pending", busy: false };
  return { banner, flash, checks };
}

// Mirrors retryCheckoutConfirmation(): reload, and if the new entitlement is now
// visible clear the banner + show success, else stay pending.
function simulateRefresh({ status, current }) {
  if (checkoutConfirmed({ expect: status.expect, baseline: status.baseline, current })) {
    return { banner: null, flash: CONFIRMED_FLASH(status.productName) };
  }
  return { banner: { ...status, phase: "pending", busy: false }, flash: null };
}

const BASE = normalizeEntitlements({ freeUnlockUsed: true, unlockCredits: 1 });
const GAINED = normalizeEntitlements({ freeUnlockUsed: true, unlockCredits: 6 }); // Student Pack landed
const GAINED_SUB = normalizeEntitlements({ hasActiveSubscription: true, freeUnlockUsed: true });

/* ============================== the four required scenarios ============================== */
describe("scenario 1 — immediate checkout return, webhook not done yet", () => {
  it("shows the truthful 'confirming' state, never a success message", () => {
    // initial banner (set synchronously before the async loop)
    const initial = { phase: "confirming", productName: "Student Pack", expect: "credits", baseline: BASE };
    expect(initial.phase).toBe("confirming");
    expect(CHECKOUT_CONFIRMING_MESSAGE).toMatch(/confirming your purchase/i);
    // and during the whole poll (entitlement never appears) no success is emitted
    const r = simulatePoll({ expect: "credits", baseline: BASE, productName: "Student Pack", snapshotAt: () => BASE });
    expect(r.flash).toBeNull();
    expect(r.banner.phase).toBe("pending");
  });
});

describe("scenario 2 — entitlement appears during polling", () => {
  it("swaps to a confirmed success once refreshEntitlements() actually shows the credits", () => {
    // not there for the first two checks, then the webhook completes
    const r = simulatePoll({
      expect: "credits", baseline: BASE, productName: "Student Pack",
      snapshotAt: (i) => (i >= 2 ? GAINED : BASE),
    });
    expect(r.banner).toBeNull();
    expect(r.flash).toBe("Student Pack confirmed — it's on your account now.");
    expect(r.checks).toBe(3); // confirmed on the 3rd check, no further polling
  });

  it("works the same for a Job Search Pass (inactive → active) subscription", () => {
    const r = simulatePoll({
      expect: "subscription", baseline: normalizeEntitlements({}), productName: "Job Search Pass",
      snapshotAt: (i) => (i >= 1 ? GAINED_SUB : normalizeEntitlements({})),
    });
    expect(r.banner).toBeNull();
    expect(r.flash).toBe("Job Search Pass confirmed — it's on your account now.");
  });
});

describe("scenario 3 — entitlement still absent after the polling window", () => {
  it("shows the 'may still be processing' banner and never claims success", () => {
    const r = simulatePoll({
      expect: "credits", baseline: BASE, productName: "Student Pack",
      snapshotAt: () => BASE, // webhook never lands within the window
    });
    expect(r.flash).toBeNull();
    expect(r.banner).toMatchObject({ phase: "pending", productName: "Student Pack" });
    expect(r.checks).toBe(CHECKOUT_POLL_BACKOFF_MS.length + 1); // exhausted every check
    expect(CHECKOUT_PENDING_MESSAGE).toMatch(/may still be processing/i);
    expect(CHECKOUT_PENDING_MESSAGE).not.toMatch(/\bsuccess\b|is now on your account/i);
  });
});

describe("scenario 4 — manual Refresh picks up a subsequently-completed entitlement", () => {
  const pending = { phase: "pending", productName: "Student Pack", expect: "credits", baseline: BASE, busy: false };

  it("Refresh while still not ready -> stays pending, still no false success", () => {
    const r = simulateRefresh({ status: pending, current: BASE });
    expect(r.flash).toBeNull();
    expect(r.banner).toMatchObject({ phase: "pending" });
  });

  it("Refresh after the webhook has completed -> confirmed success, banner cleared", () => {
    const r = simulateRefresh({ status: pending, current: GAINED });
    expect(r.banner).toBeNull();
    expect(r.flash).toBe("Student Pack confirmed — it's on your account now.");
  });

  it("a second Student Pack while already holding credits is only confirmed when the balance rises above the baseline", () => {
    const status = { phase: "pending", productName: "Student Pack", expect: "credits", baseline: normalizeEntitlements({ freeUnlockUsed: true, unlockCredits: 2 }), busy: false };
    expect(simulateRefresh({ status, current: normalizeEntitlements({ freeUnlockUsed: true, unlockCredits: 2 }) }).flash).toBeNull();
    expect(simulateRefresh({ status, current: normalizeEntitlements({ freeUnlockUsed: true, unlockCredits: 7 }) }).flash).toBe("Student Pack confirmed — it's on your account now.");
  });
});

/* ============================== App.jsx wiring ============================== */
describe("Phase 40 — App.jsx checkout-return wiring", () => {
  const EFFECT = SRC.slice(
    SRC.indexOf("// Phase 40: returning from Stripe Checkout."),
    SRC.indexOf("// Phase 40: auto-dismiss the transient entitlement confirmation banner."),
  );

  it("sets a 'confirming' banner synchronously, BEFORE the async poll", () => {
    expect(EFFECT).toMatch(/setCheckoutStatus\(\{ phase: "confirming"/);
    expect(EFFECT.indexOf('phase: "confirming"')).toBeLessThan(EFFECT.indexOf("await refreshEntitlements()"));
  });

  it("captures the pre-checkout entitlement baseline and the expected product kind", () => {
    expect(EFFECT).toMatch(/const baseline = normalizeEntitlements\(entitlementsRef\.current\)/);
    expect(EFFECT).toMatch(/plan\?\.kind === "subscription" \? "subscription"/);
  });

  it("polls refreshEntitlements() with the shared backoff and the checkoutConfirmed check — the browser never grants", () => {
    expect(EFFECT).toMatch(/for \(let i = 0; i <= CHECKOUT_POLL_BACKOFF_MS\.length; i\+\+\)/);
    expect(EFFECT).toMatch(/const fresh = await refreshEntitlements\(\)/);
    expect(EFFECT).toMatch(/checkoutConfirmed\(\{ expect, baseline, current: fresh \}\)/);
    expect(EFFECT).toMatch(/setTimeout\(r, CHECKOUT_POLL_BACKOFF_MS\[i\]\)/);
    // no local entitlement mutation anywhere in the effect
    expect(EFFECT).not.toMatch(/setEntitlements\(|applyEntitlements\(\{[^}]*(unlock_credits|hasActiveSubscription)/);
  });

  it("only shows a success flash INSIDE the confirmed branch; on timeout it goes to 'pending', never success", () => {
    expect(EFFECT).toMatch(/if \(checkoutConfirmed\([\s\S]{0,120}setCheckoutStatus\(null\);[\s\S]{0,160}setEntitlementFlash\(/);
    expect(EFFECT).toMatch(/phase: "pending"/);
    // the old premature "is now on your account" inline copy is gone
    expect(EFFECT).not.toMatch(/is now on your account/);
    expect(EFFECT).not.toMatch(/for \(let i = 0; i < 4; i\+\+\)/);
    expect(EFFECT).not.toMatch(/fresh\.hasActiveSubscription \|\| fresh\.unlockCredits > 0/);
  });

  it("scrubs the query params and guards against re-running", () => {
    expect(EFFECT).toMatch(/checkoutHandledRef\.current = true/);
    expect(EFFECT).toMatch(/window\.history\.replaceState\(null, "", window\.location\.pathname\)/);
    expect(EFFECT).toMatch(/outcome === "cancel"/);
  });

  it("renders a 'confirming' banner with the truthful message and a spinner", () => {
    const block = SRC.slice(
      SRC.indexOf('{user && checkoutStatus && checkoutStatus.phase === "confirming"'),
      SRC.indexOf('{user && checkoutStatus && checkoutStatus.phase === "pending"'),
    );
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/CHECKOUT_CONFIRMING_MESSAGE/);
    expect(block).toMatch(/Loader2 className="animate-spin"/);
  });

  it("renders a 'pending' banner with the truthful message and a Refresh button wired to retryCheckoutConfirmation", () => {
    const pendingBlock = SRC.slice(
      SRC.indexOf('{user && checkoutStatus && checkoutStatus.phase === "pending"'),
      SRC.indexOf('{/* ---------------- PHASE 40: entitlement confirmation banner'),
    );
    expect(pendingBlock).toMatch(/CHECKOUT_PENDING_MESSAGE/);
    expect(pendingBlock).toMatch(/onClick=\{retryCheckoutConfirmation\}/);
    expect(pendingBlock).toMatch(/Refresh/);
    expect(pendingBlock).toMatch(/aria-label="Dismiss"[\s\S]{0,120}setCheckoutStatus\(null\)/);
  });

  it("retryCheckoutConfirmation reloads via refreshEntitlements() and re-checks with checkoutConfirmed — no local grant", () => {
    const fn = SRC.slice(
      SRC.indexOf("async function retryCheckoutConfirmation()"),
      SRC.indexOf("// THE access chokepoint."),
    );
    expect(fn).toMatch(/const fresh = await refreshEntitlements\(\)/);
    expect(fn).toMatch(/checkoutConfirmed\(\{ expect: s\.expect, baseline: s\.baseline, current: fresh \}\)/);
    expect(fn).toMatch(/setCheckoutStatus\(null\);[\s\S]{0,160}setEntitlementFlash\(/);
    expect(fn).toMatch(/phase: "pending"/);
    expect(fn).not.toMatch(/setEntitlements\(|applyEntitlements\(\{/);
  });

  it("checkout state is reset on sign-out", () => {
    expect(SRC).toMatch(/setCheckoutStatus\(null\); checkoutHandledRef\.current = false;/);
  });

  it("the banners are gated on `user` so a stale status never renders signed-out", () => {
    expect(SRC).toMatch(/\{user && checkoutStatus && checkoutStatus\.phase === "confirming"/);
    expect(SRC).toMatch(/\{user && checkoutStatus && checkoutStatus\.phase === "pending"/);
  });
});
