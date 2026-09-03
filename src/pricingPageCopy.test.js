/* ================================================================== *
 * PRICING PAGE — clarity / conversion copy (display only)
 * ------------------------------------------------------------------
 * Guards that the pricing-page UI+copy improvements landed WITHOUT
 * touching any functional key: plan ids, amounts, unlock counts,
 * cadence, Stripe/checkout/webhook logic, entitlement constants.
 * Also checks the advertised Student Pack saving is arithmetically true.
 * Node env — source + pure-value assertions only.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PRICING_PLANS, planById, PURCHASABLE_PRODUCT_IDS, CREDITS_PER_PRODUCT } from "./entitlements.js";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const CHECKOUT = readFileSync(new URL("../supabase/functions/create-checkout/index.ts", import.meta.url), "utf8");
const WEBHOOK = readFileSync(new URL("../supabase/functions/stripe-webhook/index.ts", import.meta.url), "utf8");
const byId = Object.fromEntries(PRICING_PLANS.map((p) => [p.id, p]));

/* ---------------------------------------------------------------- *
 * functional keys UNCHANGED
 * ---------------------------------------------------------------- */
describe("nothing functional changed", () => {
  it("plan ids, order, amounts, unlock counts and cadence are exactly the pricing model", () => {
    expect(PRICING_PLANS.map((p) => p.id)).toEqual(["free", "last_minute_saver", "student_pack", "job_search_pass"]);
    expect([byId.free.amount, byId.last_minute_saver.amount, byId.student_pack.amount, byId.job_search_pass.amount]).toEqual([0, 299, 499, 799]);
    expect([byId.free.unlocks, byId.last_minute_saver.unlocks, byId.student_pack.unlocks, byId.job_search_pass.unlocks]).toEqual([1, 1, 5, Infinity]);
    expect(byId.last_minute_saver.priceLabel).toBe("£2.99");
    expect(byId.student_pack.priceLabel).toBe("£4.99");
    expect(byId.job_search_pass.priceLabel).toBe("£7.99");
    expect(byId.job_search_pass.cadence).toBe("per month");
    expect(byId.last_minute_saver.kind).toBe("one_time");
    expect(byId.student_pack.kind).toBe("one_time");
    expect(byId.job_search_pass.kind).toBe("subscription");
    expect(PURCHASABLE_PRODUCT_IDS).toEqual(["last_minute_saver", "student_pack", "job_search_pass"]);
    expect(CREDITS_PER_PRODUCT).toEqual({ last_minute_saver: 1, student_pack: 5 });
  });

  it("create-checkout + webhook still keyed on the same ids / amounts / credit counts — untouched", () => {
    expect(CHECKOUT).toMatch(/last_minute_saver:[\s\S]*?amount:\s*299\b/);
    expect(CHECKOUT).toMatch(/student_pack:[\s\S]*?amount:\s*499\b/);
    expect(CHECKOUT).toMatch(/job_search_pass:[\s\S]*?amount:\s*799\b/);
    expect(WEBHOOK).toMatch(/last_minute_saver:\s*1\b/);
    expect(WEBHOOK).toMatch(/student_pack:\s*5\b/);
    // the Stripe-facing display string matches the pricing page ("Single
    // Application") — a NAME only; the product id key `last_minute_saver:` and
    // its amount: 299 are untouched (asserted above).
    expect(CHECKOUT).toMatch(/name:\s*"JOB\.READY — Single Application"/);
    expect(CHECKOUT).not.toMatch(/Last-Minute Saver/);
    expect(CHECKOUT).toMatch(/last_minute_saver:\s*\{[\s\S]*?name:\s*"JOB\.READY — Single Application"/);
  });
});

/* ---------------------------------------------------------------- *
 * display name + card copy
 * ---------------------------------------------------------------- */
describe("plan display copy", () => {
  it("the £2.99 one-time plan is displayed as 'Single Application' (id unchanged)", () => {
    expect(planById("last_minute_saver").name).toBe("Single Application");
    expect(planById("last_minute_saver").id).toBe("last_minute_saver");
  });

  it("Free: '1 application unlock' + unlimited tools + nothing charged automatically", () => {
    expect(byId.free.headline).toBe("1 application unlock");
    expect(byId.free.summary).toMatch(/nothing is (ever )?charged automatically/i);
    expect(byId.free.features.join(" | ")).toMatch(/1 application unlock/);
    expect(byId.free.features.join(" | ")).toMatch(/nothing is charged automatically/i);
  });

  it("Single Application: 1 unlock, 'one specific role' copy, no-subscription benefits, '£2.99 per application', CTA 'Buy 1 Unlock'", () => {
    const p = byId.last_minute_saver;
    expect(p.headline).toBe("1 application unlock");
    expect(p.summary).toBe("Perfect if you're preparing for one specific role.");
    expect(p.perUnit).toBe("£2.99 per application");
    expect(p.ctaLabel).toBe("Buy 1 Unlock");
    expect(p.features).toEqual([
      "Unlimited preparation for one application",
      "No subscription",
      "Use the unlock whenever you choose",
    ]);
  });

  it("Student Pack: BEST VALUE badge, 5 unlocks, 'multiple roles' copy, '£1 per application', accurate saving, CTA 'Buy 5 Unlocks'", () => {
    const p = byId.student_pack;
    expect(p.badge).toMatch(/BEST VALUE/);
    expect(p.badge).toMatch(/⭐/);
    expect(p.headline).toBe("5 application unlocks");
    expect(p.summary).toBe("Perfect for students applying to multiple roles.");
    expect(p.perUnit).toBe("Just £1 per application");
    expect(p.savingNote).toBe("Save over 65% compared with buying individually");
    expect(p.ctaLabel).toBe("Buy 5 Unlocks");
    expect(p.features).toEqual([
      "5 application unlocks",
      "Use them one application at a time",
      "No subscription",
    ]);
  });

  it("Job Search Pass: 'Unlimited application unlocks', 'active job seekers' copy, positioning line, CTA 'Start Unlimited'", () => {
    const p = byId.job_search_pass;
    expect(p.headline).toBe("Unlimited application unlocks");
    expect(p.summary).toBe("For active job seekers applying to multiple roles.");
    expect(p.positioning).toBe("Best for multiple applications");
    expect(p.ctaLabel).toBe("Start Unlimited");
    expect(p.features[0]).toBe("Unlimited application unlocks while active");
    expect(p.features[2]).toMatch(/Cancel anytime/);
  });

  it("only Student Pack carries a badge / saving note", () => {
    expect(PRICING_PLANS.filter((p) => p.badge).map((p) => p.id)).toEqual(["student_pack"]);
    expect(PRICING_PLANS.filter((p) => p.savingNote).map((p) => p.id)).toEqual(["student_pack"]);
  });
});

/* ---------------------------------------------------------------- *
 * the advertised saving is arithmetically correct
 * ---------------------------------------------------------------- */
describe("Student Pack value claims are mathematically accurate", () => {
  const single = byId.last_minute_saver.amount;   // 299p
  const pack = byId.student_pack.amount;          // 499p
  const packUnlocks = byId.student_pack.unlocks;  // 5

  it("'Just £1 per application' — £4.99 / 5 rounds to ~£1.00", () => {
    const perUnitPence = pack / packUnlocks; // 99.8
    expect(Math.round(perUnitPence)).toBe(100); // £1.00 to the nearest penny
    expect(perUnitPence).toBeLessThan(100);     // it is in fact fractionally UNDER £1
  });

  it("'Save over 65% compared with buying individually' is true (actual ≈ 66.6%)", () => {
    const buyingIndividually = single * packUnlocks; // 1495p
    const saving = (buyingIndividually - pack) / buyingIndividually;
    expect(saving).toBeGreaterThan(0.65);
    expect(Math.round(saving * 1000) / 10).toBe(66.6);
  });
});

/* ---------------------------------------------------------------- *
 * pricing screen: explanation section
 * ---------------------------------------------------------------- */
describe("pricing screen — 'Choose how you want to prepare' explainer", () => {
  const start = SRC.indexOf('{screen === "pricing" && (');
  const PRICING_SCREEN = SRC.slice(start, SRC.indexOf("<LegalFooter openLegal={openLegal} />", start));

  it("leads with the required heading + supporting copy", () => {
    expect(PRICING_SCREEN).toContain("Choose how you want to prepare");
    expect(PRICING_SCREEN).toMatch(/Each <strong>application unlock<\/strong> gives you unlimited access to JOB\.READY's preparation tools for one job application\./);
  });

  it("shows what every unlock includes — the four required items, once each", () => {
    for (const item of [
      "Unlimited AI mock interviews",
      "Personalised Classroom resources",
      "Assessment Centre practice",
      "Detailed performance reports",
    ]) {
      expect(PRICING_SCREEN.split(item).length - 1, item).toBe(1);
    }
    expect(PRICING_SCREEN).toMatch(/Every application unlock includes/i);
  });

  it("does not stuff the plan-name change anywhere stale in the page", () => {
    expect(PRICING_SCREEN).not.toMatch(/Last-Minute Saver/);
  });
});

/* ---------------------------------------------------------------- *
 * PricingPlans component renders the new display fields
 * ---------------------------------------------------------------- */
describe("PricingPlans component", () => {
  const start = SRC.indexOf("function PricingPlans(");
  const COMP = SRC.slice(start, SRC.indexOf("\nfunction FreeUnlockDialog(", start));

  it("renders badge, per-unit line, saving note, positioning line and a per-plan CTA label", () => {
    expect(COMP).toMatch(/plan\.badge &&/);
    expect(COMP).toMatch(/BEST VALUE/);
    expect(COMP).toMatch(/plan\.perUnit &&/);
    expect(COMP).toMatch(/plan\.savingNote &&/);
    expect(COMP).toMatch(/plan\.positioning &&/);
    expect(COMP).toMatch(/plan\.ctaLabel \? plan\.ctaLabel/);
  });

  it("features the best-value (badged) plan on the full page, but the paywall keeps its own context highlight", () => {
    expect(COMP).toMatch(/const featured = contextHighlight \|\| \(!compact && !!plan\.badge\)/);
    // context highlight logic (paywall) is preserved verbatim
    expect(COMP).toMatch(/highlightAccess === "unlockable_credit" && plan\.id === "student_pack"/);
    expect(COMP).toMatch(/highlightAccess === "locked" && plan\.id === "last_minute_saver"/);
  });

  it("compact (paywall) mode: keeps badge + per-application price, but hides the long summary AND the savingNote / positioning lines", () => {
    // kept in compact — badge + per-unit are NOT gated on !compact
    expect(COMP).not.toMatch(/!compact && plan\.badge/);
    expect(COMP).not.toMatch(/!compact && plan\.perUnit/);
    // hidden in compact
    expect(COMP).toMatch(/!compact && plan\.summary &&/);
    expect(COMP).toMatch(/!compact && plan\.savingNote &&/);
    expect(COMP).toMatch(/!compact && plan\.positioning &&/);
  });
});
