/* ================================================================== *
 * PHASE 40 — STRIPE WEBHOOK: ATOMIC, IDEMPOTENT CREDIT GRANTS
 * ------------------------------------------------------------------
 * Audit-4 fix. The webhook no longer does a service-role
 * read-modify-write of user_entitlements.unlock_credits (which could
 * lose an increment under concurrent delivery, or leave a payment
 * permanently "processed" without its credits if it died mid-way).
 * Instead public.apply_purchase_credits claims the checkout session
 * and increments credits ATOMICALLY, in one transaction.
 *
 * There is no local Postgres/Supabase test harness in this repo, so —
 * same convention as supabaseSchemaTracking.test.js — the SQL and the
 * webhook wiring are asserted by source inspection, and the three
 * required behaviours are additionally exercised against a faithful
 * in-memory model of exactly what the RPC's statements do.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const MIG_DIR = new URL("../supabase/migrations/", import.meta.url);
// apply_purchase_credits lives in the original Phase 40 entitlements migration
// (the pricing-model-v2 migration only touches subscription enforcement).
const PRICING_MIG = readdirSync(MIG_DIR).filter((f) => /pricing_entitlements/i.test(f)).sort().pop();
const SQL = readFileSync(new URL(PRICING_MIG, MIG_DIR), "utf8");
const WEBHOOK = readFileSync(new URL("../supabase/functions/stripe-webhook/index.ts", import.meta.url), "utf8");

// The body of the apply_purchase_credits function (between its signature and its `$$;`).
const FN = (() => {
  const start = SQL.indexOf("create or replace function public.apply_purchase_credits(");
  expect(start, "apply_purchase_credits must exist in the migration").toBeGreaterThan(-1);
  const end = SQL.indexOf("$$;", SQL.indexOf("as $$", start));
  return SQL.slice(start, end);
})();
const FN_LOWER = FN.toLowerCase().replace(/[ \t]+/g, " ");

/* ============================== the RPC exists and is safe ============================== */
describe("apply_purchase_credits — definition", () => {
  it("is SECURITY DEFINER with a pinned search_path", () => {
    expect(FN_LOWER).toMatch(/security definer/);
    expect(FN_LOWER).toMatch(/set search_path to 'public'/);
  });

  it("is service-role only — revoked from public / anon / authenticated, granted to service_role", () => {
    expect(SQL).toMatch(/revoke all on function public\.apply_purchase_credits\(text, uuid, text, integer, integer, text, text\)\s*from public, anon, authenticated/);
    expect(SQL).toMatch(/grant execute on function public\.apply_purchase_credits\(text, uuid, text, integer, integer, text, text\)\s*to service_role/);
    expect(SQL).not.toMatch(/grant execute on function public\.apply_purchase_credits[^;]*to authenticated/);
  });

  it("re-runnable (create or replace) — the migration stays idempotent", () => {
    expect(SQL).toMatch(/create or replace function public\.apply_purchase_credits/);
    expect(SQL).not.toMatch(/create function public\.apply_purchase_credits/);
  });

  it("clamps a negative / null credit count to a non-negative integer", () => {
    expect(FN_LOWER).toMatch(/greatest\(coalesce\(p_credits, 0\), 0\)/);
  });
});

/* ============================== (1) duplicate delivery -> credits once ============================== */
describe("duplicate delivery of the same checkout session", () => {
  it("claims the session with `on conflict (provider_checkout_id) do nothing` and reads row_count", () => {
    expect(FN_LOWER).toMatch(/insert into public\.payments \([\s\S]*?\)\s*values \([\s\S]*?\)\s*on conflict \(provider_checkout_id\) do nothing;/);
    expect(FN_LOWER).toMatch(/get diagnostics \w+ = row_count;/);
  });

  it("increments credits ONLY when a payment row was newly inserted (row_count != 0)", () => {
    // the "already processed" early-return sits BEFORE the user_entitlements write
    const idxGuard = FN_LOWER.indexOf("if v_claimed = 0 then");
    const idxReturnAlready = FN_LOWER.indexOf("already_processed', true");
    const idxIncrement = FN_LOWER.indexOf("insert into public.user_entitlements");
    expect(idxGuard).toBeGreaterThan(-1);
    expect(idxReturnAlready).toBeGreaterThan(idxGuard);
    expect(idxIncrement).toBeGreaterThan(idxReturnAlready);
  });

  it("the already-processed result is explicit (ok + already_processed:true + 0 credits granted)", () => {
    expect(FN_LOWER).toMatch(/return jsonb_build_object\('ok', true, 'already_processed', true, 'credits_granted', 0\);/);
  });
});

/* ============================== (2) two purchases -> credits accumulate ============================== */
describe("two different successful purchases", () => {
  it("increments RELATIVELY (unlock_credits = unlock_credits + p_credits), never a recomputed absolute", () => {
    expect(FN_LOWER).toMatch(/set unlock_credits = user_entitlements\.unlock_credits \+ v_credits/);
    // no client-style read of the current value then a write of a constant
    expect(FN_LOWER).not.toMatch(/select unlock_credits into/);
  });

  it("the create-or-increment is a SINGLE atomic upsert (row-locked by Postgres), also seeding a missing row", () => {
    expect(FN_LOWER).toMatch(/insert into public\.user_entitlements \(user_id, unlock_credits, updated_at\)\s*values \(p_user_id, v_credits, now\(\)\)\s*on conflict \(user_id\) do update/);
    expect(FN_LOWER).toMatch(/returning unlock_credits into \w+;/);
  });
});

/* ============================== (3) failure can't strand a claimed payment ============================== */
describe("a failure cannot leave a payment marked processed without its credits", () => {
  it("the payment claim and the credit grant are in the SAME function body (one transaction) — no COMMIT between them", () => {
    const claim = FN_LOWER.indexOf("insert into public.payments");
    const grant = FN_LOWER.indexOf("insert into public.user_entitlements");
    const begin = FN_LOWER.indexOf("\nbegin");
    const end = FN_LOWER.lastIndexOf("end;");
    expect(begin).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(begin);
    expect(grant).toBeGreaterThan(claim);
    expect(grant).toBeLessThan(end);
    expect(FN_LOWER).not.toMatch(/\bcommit\b/); // no explicit commit splitting the two writes
  });

  it("on any error the whole function raises — plpgsql rolls back BOTH writes together", () => {
    // there is no error-swallowing: no `exception when others then` that could
    // let the payment insert commit while hiding a later failure.
    expect(FN_LOWER).not.toMatch(/exception\s+when\s+others/);
  });
});

/* ============================== webhook wiring ============================== */
describe("stripe-webhook calls the RPC (no read-modify-write) and preserves everything else", () => {
  it("grantCredits invokes apply_purchase_credits with the checkout id / user / credits", () => {
    expect(WEBHOOK).toMatch(/db\.rpc\("apply_purchase_credits",\s*\{/);
    expect(WEBHOOK).toMatch(/p_checkout_id:\s*session\.id/);
    expect(WEBHOOK).toMatch(/p_user_id:\s*userId/);
    expect(WEBHOOK).toMatch(/p_credits:\s*credits/);
    expect(WEBHOOK).toMatch(/p_amount_total:\s*session\.amount_total/);
    expect(WEBHOOK).toMatch(/p_payment_intent:/);
  });

  it("no longer does a service-role read-modify-write of user_entitlements or an inline payments upsert", () => {
    expect(WEBHOOK).not.toMatch(/\.from\("user_entitlements"\)[\s\S]{0,40}\.select\("unlock_credits"\)/);
    expect(WEBHOOK).not.toMatch(/\.from\("user_entitlements"\)[\s\S]{0,40}\.update\(\{\s*unlock_credits/);
    expect(WEBHOOK).not.toMatch(/\.from\("payments"\)[\s\S]{0,20}\.upsert/);
  });

  it("a redelivery short-circuits on the RPC's already_processed result", () => {
    expect(WEBHOOK).toMatch(/data\?\.already_processed/);
    expect(WEBHOOK).toMatch(/already processed, skipping grant/);
  });

  it("an RPC error still throws -> 500 -> Stripe retries (safe: RPC is atomic + idempotent)", () => {
    const fn = WEBHOOK.slice(WEBHOOK.indexOf("async function grantCredits("), WEBHOOK.indexOf("async function syncSubscription("));
    expect(fn).toMatch(/if \(error\) \{[\s\S]*?throw new Error\("apply_purchase_credits failed"\)/);
  });

  it("Stripe signature verification and ALL subscription behaviour are untouched", () => {
    expect(WEBHOOK).toMatch(/constructEventAsync\(raw, sig, STRIPE_WEBHOOK_SECRET\)/);
    expect(WEBHOOK).toMatch(/Invalid signature/);
    expect(WEBHOOK).toMatch(/async function syncSubscription\(sub: Stripe\.Subscription\)/);
    expect(WEBHOOK).toMatch(/\.upsert\(row, \{ onConflict: "stripe_subscription_id" \}\)/);
    for (const ev of ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]) {
      expect(WEBHOOK).toContain(ev);
    }
  });
});

/* ============================== behavioural model ============================== *
 * A faithful in-memory replica of what apply_purchase_credits' statements do,
 * exercised for the three required scenarios. This is the executable proof that
 * the shape asserted above actually produces "granted exactly once" and
 * "credits accumulate".
 * ========================================================================== */
function makeDb() {
  return {
    payments: new Map(), // provider_checkout_id -> row  (UNIQUE constraint)
    entitlements: new Map(), // user_id -> { unlock_credits }
  };
}
// Mirrors the RPC body: (1) INSERT ... ON CONFLICT DO NOTHING on payments,
// (2) if not inserted -> {already_processed:true, credits_granted:0},
// (3) else atomic upsert-increment of unlock_credits.
function applyPurchaseCredits(db, { checkoutId, userId, credits }) {
  const c = Math.max(Math.trunc(credits) || 0, 0);
  if (db.payments.has(checkoutId)) {
    return { ok: true, already_processed: true, credits_granted: 0 };
  }
  db.payments.set(checkoutId, { user_id: userId, credits_granted: c, status: "completed" });
  const row = db.entitlements.get(userId) || { unlock_credits: 0 };
  row.unlock_credits += c; // relative increment
  db.entitlements.set(userId, row);
  return { ok: true, already_processed: false, credits_granted: c, unlock_credits: row.unlock_credits };
}

describe("behavioural model — matches the three required outcomes", () => {
  it("duplicate delivery of the same checkout session -> credits granted exactly once", () => {
    const db = makeDb();
    const a = applyPurchaseCredits(db, { checkoutId: "cs_1", userId: "u1", credits: 5 });
    const b = applyPurchaseCredits(db, { checkoutId: "cs_1", userId: "u1", credits: 5 }); // retry
    const c = applyPurchaseCredits(db, { checkoutId: "cs_1", userId: "u1", credits: 5 }); // retry
    expect(a).toMatchObject({ already_processed: false, credits_granted: 5 });
    expect(b).toMatchObject({ already_processed: true, credits_granted: 0 });
    expect(c).toMatchObject({ already_processed: true, credits_granted: 0 });
    expect(db.entitlements.get("u1").unlock_credits).toBe(5);
    expect(db.payments.size).toBe(1);
  });

  it("two different successful Application Pack purchases -> +8 total (accumulate)", () => {
    const db = makeDb();
    applyPurchaseCredits(db, { checkoutId: "cs_A", userId: "u1", credits: 4 });
    applyPurchaseCredits(db, { checkoutId: "cs_B", userId: "u1", credits: 4 });
    expect(db.entitlements.get("u1").unlock_credits).toBe(8);
    expect(db.payments.size).toBe(2);
  });

  it("mixed products accumulate on the same user (Application Pack + Single Application = +5)", () => {
    const db = makeDb();
    applyPurchaseCredits(db, { checkoutId: "cs_A", userId: "u1", credits: 4 });
    applyPurchaseCredits(db, { checkoutId: "cs_B", userId: "u1", credits: 1 });
    expect(db.entitlements.get("u1").unlock_credits).toBe(5);
  });

  it("a first-time buyer with no entitlements row still gets exactly their credits (row seeded atomically)", () => {
    const db = makeDb();
    expect(db.entitlements.has("newuser")).toBe(false);
    const r = applyPurchaseCredits(db, { checkoutId: "cs_X", userId: "newuser", credits: 5 });
    expect(r.credits_granted).toBe(5);
    expect(db.entitlements.get("newuser").unlock_credits).toBe(5);
  });

  it("interleaved retries of two purchases still land on +10 and never double-count", () => {
    const db = makeDb();
    applyPurchaseCredits(db, { checkoutId: "cs_A", userId: "u1", credits: 5 });
    applyPurchaseCredits(db, { checkoutId: "cs_A", userId: "u1", credits: 5 }); // retry A
    applyPurchaseCredits(db, { checkoutId: "cs_B", userId: "u1", credits: 5 });
    applyPurchaseCredits(db, { checkoutId: "cs_B", userId: "u1", credits: 5 }); // retry B
    applyPurchaseCredits(db, { checkoutId: "cs_A", userId: "u1", credits: 5 }); // retry A again
    expect(db.entitlements.get("u1").unlock_credits).toBe(10);
  });
});
