/* ================================================================== *
 * PRICING PAGE — pricing model v2 copy + config (display + values)
 * ------------------------------------------------------------------
 * Pricing model v2:
 *   Single Application  £2.99 one-time   -> unlock 1 application
 *   Application Pack    £4.99 one-time   -> unlock 4 applications
 *   Job Search Pass     £8.99 / month    -> unlock 10 applications per month
 * Each application unlock = up to 5 mock interviews (+ feedback) + up to 5
 * assessment-centre scenarios. Unlimited Classroom access on every plan.
 *
 * Guards that the config values AND the user-facing copy match, across
 * entitlements.js, the pricing screen and the PricingPlans component,
 * and that create-checkout / stripe-webhook stay in sync.
 * Node env — source + pure-value assertions only.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  PRICING_PLANS, planById, PURCHASABLE_PRODUCT_IDS, CREDITS_PER_PRODUCT,
  SUBSCRIPTION_MONTHLY_UNLOCKS, MAX_MOCK_INTERVIEWS_PER_APPLICATION, MAX_AC_SCENARIOS_PER_APPLICATION,
} from "./entitlements.js";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const CHECKOUT = readFileSync(new URL("../supabase/functions/create-checkout/index.ts", import.meta.url), "utf8");
const WEBHOOK = readFileSync(new URL("../supabase/functions/stripe-webhook/index.ts", import.meta.url), "utf8");
const byId = Object.fromEntries(PRICING_PLANS.map((p) => [p.id, p]));

/* ---------------------------------------------------------------- *
 * config values — the source of truth
 * ---------------------------------------------------------------- */
describe("pricing model v2 — config values", () => {
  it("plan ids + order are the stable functional keys (unchanged)", () => {
    expect(PRICING_PLANS.map((p) => p.id)).toEqual(["free", "last_minute_saver", "student_pack", "job_search_pass"]);
    expect(PURCHASABLE_PRODUCT_IDS).toEqual(["last_minute_saver", "student_pack", "job_search_pass"]);
  });

  it("£2.99 -> exactly 1 application", () => {
    expect(byId.last_minute_saver.amount).toBe(299);
    expect(byId.last_minute_saver.priceLabel).toBe("£2.99");
    expect(byId.last_minute_saver.unlocks).toBe(1);
    expect(byId.last_minute_saver.kind).toBe("one_time");
    expect(CREDITS_PER_PRODUCT.last_minute_saver).toBe(1);
  });

  it("£4.99 -> exactly 4 applications", () => {
    expect(byId.student_pack.amount).toBe(499);
    expect(byId.student_pack.priceLabel).toBe("£4.99");
    expect(byId.student_pack.unlocks).toBe(4);
    expect(byId.student_pack.kind).toBe("one_time");
    expect(CREDITS_PER_PRODUCT.student_pack).toBe(4);
  });

  it("£8.99/month -> exactly 10 applications per billing month, as a subscription", () => {
    expect(byId.job_search_pass.amount).toBe(899);
    expect(byId.job_search_pass.priceLabel).toBe("£8.99");
    expect(byId.job_search_pass.cadence).toBe("per month");
    expect(byId.job_search_pass.kind).toBe("subscription");
    expect(byId.job_search_pass.unlocks).toBe(10);
    expect(SUBSCRIPTION_MONTHLY_UNLOCKS).toBe(10);
    // the subscription is NOT a one-time credit grant
    expect(CREDITS_PER_PRODUCT.job_search_pass).toBeUndefined();
  });

  it("per-application allowances: 5 mock interviews + 5 assessment-centre scenarios", () => {
    expect(MAX_MOCK_INTERVIEWS_PER_APPLICATION).toBe(5);
    expect(MAX_AC_SCENARIOS_PER_APPLICATION).toBe(5);
  });

  it("display names: Single Application / Application Pack / Job Search Pass", () => {
    expect(planById("last_minute_saver").name).toBe("Single Application");
    expect(planById("student_pack").name).toBe("Application Pack");
    expect(planById("job_search_pass").name).toBe("Job Search Pass");
  });
});

/* ---------------------------------------------------------------- *
 * create-checkout + stripe-webhook stay in sync with the config
 * ---------------------------------------------------------------- */
describe("Stripe checkout + webhook mirror the config", () => {
  it("create-checkout unit_amounts = entitlements.js amounts (299 / 499 / 899)", () => {
    expect(CHECKOUT).toMatch(new RegExp(`last_minute_saver:[\\s\\S]*?amount:\\s*${byId.last_minute_saver.amount}\\b`));
    expect(CHECKOUT).toMatch(new RegExp(`student_pack:[\\s\\S]*?amount:\\s*${byId.student_pack.amount}\\b`));
    expect(CHECKOUT).toMatch(new RegExp(`job_search_pass:[\\s\\S]*?amount:\\s*${byId.job_search_pass.amount}\\b`));
    expect(CHECKOUT).toMatch(/job_search_pass:[\s\S]*?amount:\s*899\b/);
    expect(CHECKOUT).not.toMatch(/amount:\s*799\b/); // old subscription price is gone
  });

  it("create-checkout display strings match the plan names, no stale wording", () => {
    expect(CHECKOUT).toMatch(/name:\s*"JOB\.READY — Single Application"/);
    expect(CHECKOUT).toMatch(/name:\s*"JOB\.READY — Application Pack"/);
    expect(CHECKOUT).toMatch(/name:\s*"JOB\.READY — Job Search Pass"/);
    expect(CHECKOUT).not.toMatch(/Student Pack|Last-Minute Saver|Unlimited application unlocks while active/);
    // subscription is still a recurring monthly price
    expect(CHECKOUT).toMatch(/job_search_pass:[\s\S]*?mode:\s*"subscription"[\s\S]*?recurring:\s*\{\s*interval:\s*"month"\s*\}/);
  });

  it("webhook one-time credit grants: last_minute_saver -> 1, student_pack -> 4 (no subscription entry)", () => {
    expect(WEBHOOK).toMatch(new RegExp(`last_minute_saver:\\s*${CREDITS_PER_PRODUCT.last_minute_saver}\\b`));
    expect(WEBHOOK).toMatch(new RegExp(`student_pack:\\s*${CREDITS_PER_PRODUCT.student_pack}\\b`));
    expect(WEBHOOK).toMatch(/student_pack:\s*4\b/);
    expect(WEBHOOK).not.toMatch(/student_pack:\s*5\b/);
  });
});

/* ---------------------------------------------------------------- *
 * the advertised Application Pack saving is arithmetically correct
 * ---------------------------------------------------------------- */
describe("Application Pack value claims are mathematically accurate", () => {
  const single = byId.last_minute_saver.amount; // 299p
  const pack = byId.student_pack.amount;         // 499p
  const packUnlocks = byId.student_pack.unlocks; // 4

  it("'£1.25 per application' — £4.99 / 4 = 124.75p, rounds to £1.25", () => {
    const perUnitPence = pack / packUnlocks; // 124.75
    expect(Math.round(perUnitPence)).toBe(125);
    expect(byId.student_pack.perUnit).toBe("£1.25 per application");
  });

  it("'Save over 55% compared with buying singly' is true (actual ≈ 58.3%)", () => {
    const buyingSingly = single * packUnlocks; // 1196p
    const saving = (buyingSingly - pack) / buyingSingly;
    expect(saving).toBeGreaterThan(0.55);
    expect(Math.round(saving * 1000) / 10).toBe(58.3);
    expect(byId.student_pack.savingNote).toMatch(/over 55%/);
  });

  it("only the Application Pack carries a badge / saving note", () => {
    expect(PRICING_PLANS.filter((p) => p.badge).map((p) => p.id)).toEqual(["student_pack"]);
    expect(PRICING_PLANS.filter((p) => p.savingNote).map((p) => p.id)).toEqual(["student_pack"]);
    expect(byId.student_pack.badge).toMatch(/BEST VALUE/);
  });
});

/* ---------------------------------------------------------------- *
 * every plan's feature list communicates the product model
 * ---------------------------------------------------------------- */
describe("plan feature copy communicates the model", () => {
  it("every paid plan mentions 5 mock interviews, feedback, 5 AC scenarios and unlimited Classroom", () => {
    for (const id of ["last_minute_saver", "student_pack", "job_search_pass"]) {
      const joined = byId[id].features.join(" | ");
      expect(joined, id).toMatch(/5 (personalised )?(mock )?interviews?/i);
      expect(joined, id).toMatch(/feedback/i);
      expect(joined, id).toMatch(/5 (personalised )?assessment-centre scenarios?/i);
      expect(joined, id).toMatch(/unlimited classroom/i);
    }
  });

  it("the subscription plan makes the 10/month allowance explicit", () => {
    const p = byId.job_search_pass;
    expect(p.headline).toMatch(/10 applications? ?\/ ?month/i);
    expect(p.features.join(" | ")).toMatch(/10 application unlocks every month/i);
    expect(p.ctaLabel).toBe("Start Job Search Pass");
  });

  it("no plan still advertises 'unlimited application unlocks' or the old names", () => {
    const all = JSON.stringify(PRICING_PLANS);
    expect(all).not.toMatch(/Unlimited application unlocks/);
    expect(all).not.toMatch(/Student Pack|Last-Minute Saver|Start Unlimited/);
  });
});

/* ---------------------------------------------------------------- *
 * pricing SCREEN copy (App.jsx)
 * ---------------------------------------------------------------- */
describe("pricing screen copy", () => {
  const start = SRC.indexOf('{screen === "pricing" && (');
  const PRICING_SCREEN = SRC.slice(start, SRC.indexOf("<LegalFooter openLegal={openLegal} />", start));

  it("core message: unlock applications, prepare with personalised AI practice", () => {
    expect(PRICING_SCREEN).toMatch(/Unlock applications\. Prepare for each one with personalised AI practice\./);
  });

  it("makes it explicit that users buy application unlocks, not individual interviews", () => {
    expect(PRICING_SCREEN).toMatch(/application unlocks<\/strong>, not individual interviews/);
  });

  it("'what every application unlock includes' names the 5 interviews / feedback / 5 scenarios / unlimited Classroom", () => {
    expect(PRICING_SCREEN).toMatch(/What every application unlock includes/i);
    expect(PRICING_SCREEN).toMatch(/5 personalised mock interviews per application/);
    expect(PRICING_SCREEN).toMatch(/Detailed feedback after every interview/);
    expect(PRICING_SCREEN).toMatch(/5 assessment-centre scenarios per application/);
    expect(PRICING_SCREEN).toMatch(/Unlimited Classroom access/);
  });

  it("'How unlocks work' explains the monthly reset for Job Search Pass and drops stale wording", () => {
    expect(PRICING_SCREEN).toMatch(/up to 10 applications per month\. The allowance resets/);
    expect(PRICING_SCREEN).toMatch(/Application Pack \(4\)/);
    expect(PRICING_SCREEN).not.toMatch(/Student Pack|Last-Minute Saver/);
  });
});

/* ---------------------------------------------------------------- *
 * PricingPlans COMPONENT (App.jsx) — prices, allowances, tooltip
 * ---------------------------------------------------------------- */
describe("PricingPlans component", () => {
  const start = SRC.indexOf("function PricingPlans(");
  const COMP = SRC.slice(start, SRC.indexOf("\nfunction FreeUnlockDialog(", start));

  it("renders each plan's price label and allowance headline", () => {
    expect(COMP).toMatch(/\{plan\.priceLabel\}/);
    expect(COMP).toMatch(/\{plan\.cadence\}/);       // "per month" for the subscription
    expect(COMP).toMatch(/<span>\{plan\.headline\}<\/span>/); // "1 application" / "4 applications" / "10 applications / month"
  });

  it("shows an accessible application-unlock info tooltip next to the allowance (reuses InfoTooltip, no new dependency)", () => {
    expect(COMP).toMatch(/<InfoTooltip label="What's included with an application unlock\?" text=\{APPLICATION_UNLOCK_TOOLTIP\} \/>/);
    // it's hidden on the Free card, present on the paid ones
    expect(COMP).toMatch(/\{!isFree && <InfoTooltip/);
    // the shared tooltip copy names the allowances + unlimited Classroom
    expect(SRC).toMatch(/const APPLICATION_UNLOCK_TOOLTIP =\s*\n?\s*"Each application you unlock includes up to 5 personalised mock interviews[\s\S]*?up to 5 personalised assessment-centre scenarios\. Unlimited Classroom access is included with every plan\."/);
    // InfoTooltip itself is the existing component — desktop hover + focus + click (touch) + role="tooltip"
    expect(SRC).toMatch(/function InfoTooltip\(\{ label, text \}\)/);
    expect(SRC).toMatch(/role="tooltip"/);
    expect(SRC).toMatch(/onMouseEnter=\{\(\) => setOpen\(true\)\} onMouseLeave/);
    expect(SRC).toMatch(/aria-describedby=\{open \? idRef\.current : undefined\}/);
  });

  it("still features the best-value (badged) plan and keeps the paywall context highlight", () => {
    expect(COMP).toMatch(/const featured = contextHighlight \|\| \(!compact && !!plan\.badge\)/);
    expect(COMP).toMatch(/highlightAccess === "unlockable_credit" && plan\.id === "student_pack"/);
    expect(COMP).toMatch(/highlightAccess === "locked" && plan\.id === "last_minute_saver"/);
  });

  it("prices £2.99 / £4.99 / £8.99 and allowances 1 / 4 / 10 are what the cards will render", () => {
    // (values come from PRICING_PLANS, asserted above; this ties them to the render path)
    expect([byId.last_minute_saver.priceLabel, byId.student_pack.priceLabel, byId.job_search_pass.priceLabel])
      .toEqual(["£2.99", "£4.99", "£8.99"]);
    expect([byId.last_minute_saver.headline, byId.student_pack.headline, byId.job_search_pass.headline])
      .toEqual(["1 application", "4 applications", "10 applications / month"]);
  });
});
