/* ================================================================== *
 * PRICING MODEL v2 — SUBSCRIPTION ↔ UNLOCK ENFORCEMENT (security)
 * ------------------------------------------------------------------
 * Job Search Pass = £8.99/month = MAXIMUM 10 application unlocks per Stripe
 * billing period. Server-authoritative, concurrency-safe. NOT unlimited.
 *
 * Invariants under test:
 *   S1  consume_subscription_unlock() is the ONLY writer of a
 *       source='subscription' application_unlocks row, is capped at 10 per
 *       billing period, takes a per-user transaction advisory lock so
 *       concurrent calls cannot exceed 10, and rejects with a structured
 *       reason 'monthly_unlock_limit_reached'.
 *   S2  has_application_access() no longer blanket-grants for an active
 *       subscriber — access always requires an application_unlocks row; a
 *       source='subscription' row only counts while the subscription is
 *       active (existing Stripe period logic). free/credit/comp are permanent.
 *   S3  consume_free_unlock / consume_unlock_credit persist for subscribers
 *       too — a subscriber's one free unlock and purchased credits are
 *       INDEPENDENT of the monthly allowance.
 *   R1  has_active_subscription() (SQL) + subscriptionIsActive() (JS) fail
 *       closed on a NULL / missing / unparseable current_period_end.
 *
 * No local Postgres harness -> the SQL is asserted by source inspection and
 * the behaviour is exercised against a faithful in-memory model of exactly
 * what the RPCs do. subscriptionIsActive() itself is unit-tested directly.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  subscriptionIsActive, entitlementsFromRows, ACTIVE_SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_MONTHLY_UNLOCKS,
} from "./entitlements.js";

const MIG_DIR = new URL("../supabase/migrations/", import.meta.url);
const ENT_MIG = readdirSync(MIG_DIR).filter((f) => /pricing_entitlements/.test(f)).sort().pop();
const V2_MIG = readdirSync(MIG_DIR).filter((f) => /pricing_model_v2/.test(f)).sort().pop();
const ENT_SQL = readFileSync(new URL(ENT_MIG, MIG_DIR), "utf8");
const V2_SQL = readFileSync(new URL(V2_MIG, MIG_DIR), "utf8");
// v2 re-declares consume_free_unlock / consume_unlock_credit / has_application_access,
// so those bodies must be read from the LATEST migration that defines them.
function latestBody(name) {
  for (const sql of [V2_SQL, ENT_SQL]) {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    if (start === -1) continue;
    const end = sql.indexOf("$$;", sql.indexOf("as $$", start));
    return sql.slice(start, end);
  }
  throw new Error(`${name} not found in v2 or entitlements migration`);
}

/* ============================== S1 — SQL shape ============================== */
describe("S1 — consume_subscription_unlock: capped, period-scoped, concurrency-safe", () => {
  const body = latestBody("consume_subscription_unlock").toLowerCase();

  it("is a SECURITY DEFINER RPC with a pinned search_path, granted to authenticated only", () => {
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/set search_path to 'public'/);
    expect(V2_SQL).toMatch(/revoke all on function public\.consume_subscription_unlock\(uuid\)\s*from public, anon/);
    expect(V2_SQL).toMatch(/grant execute on function public\.consume_subscription_unlock\(uuid\)\s*to authenticated/);
    expect(V2_SQL).not.toMatch(/grant execute on function public\.consume_subscription_unlock[^;]*to (anon|service_role|public)\b/);
  });

  it("takes a per-user transaction advisory lock BEFORE counting (concurrency guard)", () => {
    expect(body).toMatch(/pg_advisory_xact_lock\(hashtext\('jobready_sub_unlock'\), hashtext\(uid::text\)\)/);
    // the lock is acquired before the count query
    const lockIdx = body.indexOf("pg_advisory_xact_lock");
    const countIdx = body.indexOf("select count(*) into v_used");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(countIdx).toBeGreaterThan(lockIdx);
  });

  it("counts ONLY source='subscription' unlocks created since the current billing-period start", () => {
    expect(body).toMatch(/from public\.application_unlocks u\s*where u\.user_id = uid\s*and u\.source = 'subscription'\s*and u\.created_at >= v_period_start/);
    expect(body).toMatch(/coalesce\(v_period_start, now\(\) - interval '31 days'\)/); // never fail open on NULL
  });

  it("enforces the 10 cap and returns the structured monthly_unlock_limit_reached reason", () => {
    expect(body).toMatch(/c_monthly_limit constant integer := 10/);
    expect(body).toMatch(/if v_used >= c_monthly_limit then/);
    expect(body).toMatch(/'reason', 'monthly_unlock_limit_reached'/);
    expect(body).toMatch(/'used', v_used/);
    expect(body).toMatch(/'limit', c_monthly_limit/);
  });

  it("rejects when the subscription is not active (no allowance to draw on)", () => {
    expect(body).toMatch(/if not public\.has_active_subscription\(uid\) then\s*return jsonb_build_object\('ok', false, 'reason', 'no_subscription'\)/);
  });

  it("writes exactly ONE source='subscription' row (upsert-on-source), and nothing else", () => {
    expect(body).toMatch(/insert into public\.application_unlocks \(user_id, application_id, source\)\s*values \(uid, p_application_id, 'subscription'\)\s*on conflict \(user_id, application_id\) do update set source = excluded\.source/);
    expect(body).not.toMatch(/update public\.user_entitlements/); // never touches credits / free flag
  });

  it("the 10 constant mirrors SUBSCRIPTION_MONTHLY_UNLOCKS in entitlements.js", () => {
    expect(SUBSCRIPTION_MONTHLY_UNLOCKS).toBe(10);
  });
});

/* ============================== S2 — has_application_access ============================== */
describe("S2 — has_application_access no longer blanket-grants for an active subscriber", () => {
  const body = latestBody("has_application_access").toLowerCase();

  it("the old `if has_active_subscription then return true` blanket grant is GONE", () => {
    expect(body).not.toMatch(/if public\.has_active_subscription\(uid\) then\s*return true;/);
  });

  it("access requires an application_unlocks row; a subscription row only counts while the subscription is active", () => {
    expect(body).toMatch(/from public\.application_unlocks u\s*where u\.user_id = uid and u\.application_id = p_application_id/);
    expect(body).toMatch(/u\.source in \('free', 'credit', 'comp'\)\s*or \(u\.source = 'subscription' and public\.has_active_subscription\(uid\)\)/);
  });
});

/* ============================== S3 — free/credit persist for subscribers ============================== */
describe("S3 — consume_free_unlock / consume_unlock_credit no longer short-circuit for subscribers", () => {
  for (const name of ["consume_free_unlock", "consume_unlock_credit"]) {
    const body = latestBody(name).toLowerCase();
    it(`${name}: the "active subscriber -> return persisted:false" branch is removed`, () => {
      expect(body).not.toMatch(/'source', 'subscription', 'persisted', false/);
      expect(body).not.toMatch(/if public\.has_active_subscription\(uid\) then\s*return jsonb_build_object\('ok', true, 'source', 'subscription'/);
    });
    it(`${name}: still spends + persists its own kind, upsert-on-source`, () => {
      const kind = name === "consume_free_unlock" ? "free" : "credit";
      expect(body).toMatch(new RegExp(`values \\(uid, p_application_id, '${kind}'\\)\\s*on conflict \\(user_id, application_id\\) do update set source = excluded\\.source`));
    });
  }
});

/* ============================== R1 — SQL / JS fail-closed (unchanged) ============================== */
describe("R1 — has_active_subscription() fails closed on a NULL period end", () => {
  const body = readFileSync(new URL(ENT_MIG, MIG_DIR), "utf8")
    .slice(ENT_SQL.indexOf("create or replace function public.has_active_subscription("))
    .toLowerCase().replace(/\s+/g, " ");
  it("requires a concrete current_period_end and has no `is null or` fail-open", () => {
    expect(body).toMatch(/status in \('active', 'trialing'\)/);
    expect(body).toMatch(/current_period_end is not null/);
    expect(body).toMatch(/current_period_end \+ interval '1 day' > now\(\)/);
    expect(body).not.toMatch(/current_period_end is null or/);
  });
});

describe("R1 — subscriptionIsActive() fails closed on a NULL / missing / unparseable period end", () => {
  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  it("false for active/trialing when current_period_end is absent/null/blank/garbage", () => {
    for (const status of ACTIVE_SUBSCRIPTION_STATUSES) {
      for (const bad of [undefined, null, "", "nope", NaN]) {
        expect(subscriptionIsActive({ status, current_period_end: bad })).toBe(false);
      }
      expect(subscriptionIsActive({ status })).toBe(false);
    }
  });
  it("true only with a concrete, still-valid period end", () => {
    expect(subscriptionIsActive({ status: "active", current_period_end: future })).toBe(true);
    expect(subscriptionIsActive({ status: "trialing", current_period_end: future })).toBe(true);
  });
  it("entitlementsFromRows: an active row with a null period end does NOT set hasActiveSubscription", () => {
    const snap = entitlementsFromRows({
      entitlementRow: null, unlockRows: [],
      subscriptionRows: [{ status: "active", current_period_end: null }],
    });
    expect(snap.hasActiveSubscription).toBe(false);
  });
});

/* ================================================================== *
 * BEHAVIOURAL MODEL — faithful replica of the new RPCs
 * ================================================================== */
const GRACE_MS = 24 * 60 * 60 * 1000;
const LIMIT = 10;

function subActiveFor(db, uid, now) {
  return (db.subscriptions.get(uid) || []).some((s) => {
    if (!["active", "trialing"].includes(s.status)) return false;
    if (!s.current_period_end) return false; // R1: fail closed
    const end = new Date(s.current_period_end).getTime();
    if (Number.isNaN(end)) return false;
    return end + GRACE_MS > now;
  });
}
function activeSub(db, uid, now) {
  return (db.subscriptions.get(uid) || []).find((s) =>
    ["active", "trialing"].includes(s.status) && s.current_period_end &&
    !Number.isNaN(new Date(s.current_period_end).getTime()) &&
    new Date(s.current_period_end).getTime() + GRACE_MS > now) || null;
}
function ownsApp(db, uid, appId) { return (db.applications.get(appId) || {}).user_id === uid; }
function accessRow(db, uid, appId, now) {
  return db.application_unlocks.find((u) =>
    u.user_id === uid && u.application_id === appId &&
    (["free", "credit", "comp"].includes(u.source) ||
     (u.source === "subscription" && subActiveFor(db, uid, now)))) || null;
}
// mirrors has_application_access
function hasAccess(db, { uid, appId, now = Date.now() }) {
  if (!ownsApp(db, uid, appId)) return false;
  return !!accessRow(db, uid, appId, now);
}
// mirrors consume_free_unlock / consume_unlock_credit (kind: "free" | "credit")
function consume(db, { uid, appId, kind, now = Date.now() }) {
  if (!ownsApp(db, uid, appId)) return { error: "application not found" };
  if (accessRow(db, uid, appId, now)) return { ok: true, already: true, source: "existing" };
  const ent = db.user_entitlements.get(uid) || { free_unlock_used: false, unlock_credits: 0 };
  db.user_entitlements.set(uid, ent);
  const upsert = (source) => {
    const stale = db.application_unlocks.find((u) => u.user_id === uid && u.application_id === appId);
    if (stale) stale.source = source;
    else db.application_unlocks.push({ user_id: uid, application_id: appId, source, created_at: new Date(now).toISOString() });
  };
  if (kind === "free") {
    if (ent.free_unlock_used) return { ok: false, reason: "free_unlock_used" };
    ent.free_unlock_used = true;
    upsert("free");
    return { ok: true, source: "free" };
  }
  if (ent.unlock_credits < 1) return { ok: false, reason: "no_credits" };
  ent.unlock_credits -= 1;
  upsert("credit");
  return { ok: true, source: "credit", unlock_credits: ent.unlock_credits };
}
// mirrors consume_subscription_unlock (the advisory lock => calls are serialised;
// this model is single-threaded so that is inherent — see the concurrency test).
function consumeSub(db, { uid, appId, now = Date.now() }) {
  if (!ownsApp(db, uid, appId)) return { error: "application not found" };
  if (accessRow(db, uid, appId, now)) return { ok: true, already: true, source: "existing" };
  const sub = activeSub(db, uid, now);
  if (!sub) return { ok: false, reason: "no_subscription" };
  const periodStart = new Date(sub.current_period_start || (now - 31 * 864e5)).getTime();
  const used = db.application_unlocks.filter((u) =>
    u.user_id === uid && u.source === "subscription" && new Date(u.created_at).getTime() >= periodStart).length;
  if (used >= LIMIT) {
    return { ok: false, reason: "monthly_unlock_limit_reached", used, limit: LIMIT };
  }
  const stale = db.application_unlocks.find((u) => u.user_id === uid && u.application_id === appId);
  if (stale) stale.source = "subscription";
  else db.application_unlocks.push({ user_id: uid, application_id: appId, source: "subscription", created_at: new Date(now).toISOString() });
  return { ok: true, source: "subscription", used: used + 1, limit: LIMIT, remaining: LIMIT - (used + 1) };
}
function makeDb() {
  return { applications: new Map(), user_entitlements: new Map(), application_unlocks: [], subscriptions: new Map() };
}
function seedSub(db, uid, { periodDays = 30 } = {}) {
  const now = Date.now();
  db.subscriptions.set(uid, [{
    status: "active",
    current_period_start: new Date(now - 1 * 864e5).toISOString(),
    current_period_end: new Date(now + periodDays * 864e5).toISOString(),
  }]);
}

describe("subscription monthly allowance — behavioural", () => {
  it("an active subscriber can unlock applications 1..10; attempt 11 is rejected", () => {
    const db = makeDb();
    seedSub(db, "sub");
    for (let i = 1; i <= 10; i++) {
      db.applications.set(`app${i}`, { user_id: "sub" });
      const r = consumeSub(db, { uid: "sub", appId: `app${i}` });
      expect(r).toMatchObject({ ok: true, source: "subscription", used: i, limit: 10, remaining: 10 - i });
    }
    db.applications.set("app11", { user_id: "sub" });
    const r11 = consumeSub(db, { uid: "sub", appId: "app11" });
    expect(r11).toEqual({ ok: false, reason: "monthly_unlock_limit_reached", used: 10, limit: 10 });
    expect(db.application_unlocks.filter((u) => u.source === "subscription")).toHaveLength(10);
    // and every one of the 10 is genuinely accessible
    for (let i = 1; i <= 10; i++) expect(hasAccess(db, { uid: "sub", appId: `app${i}` })).toBe(true);
    expect(hasAccess(db, { uid: "sub", appId: "app11" })).toBe(false);
  });

  it("concurrent attempts cannot exceed 10 — the advisory lock serialises them", () => {
    // The DB takes pg_advisory_xact_lock(hashtext('jobready_sub_unlock'), hashtext(uid)),
    // so simultaneous calls for one user run one-at-a-time. Model that by applying
    // 25 attempts sequentially (the serialised order the lock enforces) and asserting
    // exactly 10 succeed.
    const db = makeDb();
    seedSub(db, "sub");
    let ok = 0, rejected = 0;
    for (let i = 1; i <= 25; i++) {
      db.applications.set(`c${i}`, { user_id: "sub" });
      const r = consumeSub(db, { uid: "sub", appId: `c${i}` });
      if (r.ok) ok++; else { rejected++; expect(r.reason).toBe("monthly_unlock_limit_reached"); }
    }
    expect(ok).toBe(10);
    expect(rejected).toBe(15);
    expect(db.application_unlocks.filter((u) => u.source === "subscription")).toHaveLength(10);
  });

  it("a NEW billing period restores the full allowance of 10", () => {
    // Explicit timestamps so the period boundary is unambiguous (no Date.now() races).
    const T0 = new Date("2026-06-01T00:00:00Z").getTime();
    const DAY = 864e5;
    const db = makeDb();

    // --- Billing period 1: [T0, T0+30d]. 10 unlocks at T0+1d, then #11 blocked.
    db.subscriptions.set("sub", [{
      status: "active",
      current_period_start: new Date(T0).toISOString(),
      current_period_end: new Date(T0 + 30 * DAY).toISOString(),
    }]);
    for (let i = 1; i <= 10; i++) {
      db.applications.set(`m1_${i}`, { user_id: "sub" });
      expect(consumeSub(db, { uid: "sub", appId: `m1_${i}`, now: T0 + DAY }).ok).toBe(true);
    }
    db.applications.set("blocked", { user_id: "sub" });
    expect(consumeSub(db, { uid: "sub", appId: "blocked", now: T0 + DAY }))
      .toEqual({ ok: false, reason: "monthly_unlock_limit_reached", used: 10, limit: 10 });

    // --- Stripe advances the billing period (webhook writes the new window).
    db.subscriptions.set("sub", [{
      status: "active",
      current_period_start: new Date(T0 + 30 * DAY).toISOString(),
      current_period_end: new Date(T0 + 60 * DAY).toISOString(),
    }]);

    // --- Billing period 2: the 10 prior-period rows no longer count -> 10 again.
    for (let i = 1; i <= 10; i++) {
      db.applications.set(`m2_${i}`, { user_id: "sub" });
      expect(consumeSub(db, { uid: "sub", appId: `m2_${i}`, now: T0 + 31 * DAY }))
        .toMatchObject({ ok: true, source: "subscription", used: i });
    }
    db.applications.set("m2_11", { user_id: "sub" });
    expect(consumeSub(db, { uid: "sub", appId: "m2_11", now: T0 + 31 * DAY }).ok).toBe(false);
    // prior-period apps stay accessible while the subscription is still active
    expect(hasAccess(db, { uid: "sub", appId: "m1_1", now: T0 + 31 * DAY })).toBe(true);
  });

  it("an inactive / expired subscription grants NO subscription unlock", () => {
    const db = makeDb();
    db.applications.set("a1", { user_id: "u" });
    db.subscriptions.set("u", [{ status: "canceled", current_period_end: new Date(Date.now() - 864e5).toISOString(), current_period_start: new Date(Date.now() - 31 * 864e5).toISOString() }]);
    expect(consumeSub(db, { uid: "u", appId: "a1" })).toEqual({ ok: false, reason: "no_subscription" });
    expect(db.application_unlocks).toEqual([]);
  });

  it("cancel-at-period-end: while Stripe still reports active + a valid period end, remaining allowance is still usable", () => {
    const db = makeDb();
    const now = Date.now();
    db.subscriptions.set("u", [{
      status: "active", cancel_at_period_end: true,
      current_period_start: new Date(now - 5 * 864e5).toISOString(),
      current_period_end: new Date(now + 10 * 864e5).toISOString(),
    }]);
    db.applications.set("a1", { user_id: "u" });
    db.applications.set("a2", { user_id: "u" });
    expect(consumeSub(db, { uid: "u", appId: "a1" }).ok).toBe(true);
    expect(consumeSub(db, { uid: "u", appId: "a2" }).ok).toBe(true);
    // once the period actually ends, no more
    db.subscriptions.set("u", [{ status: "canceled", current_period_end: new Date(now - 864e5).toISOString() }]);
    db.applications.set("a3", { user_id: "u" });
    expect(consumeSub(db, { uid: "u", appId: "a3" }).ok).toBe(false);
    expect(hasAccess(db, { uid: "u", appId: "a1" })).toBe(false); // subscription row no longer grants
  });

  it("once the subscription is inactive, an app unlocked via the subscription is no longer accessible; a free/credit unlock survives", () => {
    const db = makeDb();
    seedSub(db, "u");
    db.applications.set("subApp", { user_id: "u" });
    db.applications.set("creditApp", { user_id: "u" });
    db.user_entitlements.set("u", { free_unlock_used: false, unlock_credits: 3 });

    consumeSub(db, { uid: "u", appId: "subApp" });
    consume(db, { uid: "u", appId: "creditApp", kind: "credit" });
    expect(hasAccess(db, { uid: "u", appId: "subApp" })).toBe(true);
    expect(hasAccess(db, { uid: "u", appId: "creditApp" })).toBe(true);

    db.subscriptions.set("u", [{ status: "canceled", current_period_end: new Date(Date.now() - 864e5).toISOString() }]);
    expect(hasAccess(db, { uid: "u", appId: "subApp" })).toBe(false);   // subscription unlock gone
    expect(hasAccess(db, { uid: "u", appId: "creditApp" })).toBe(true); // purchased credit persists
  });
});

describe("S3 behavioural — one-time entitlements work INDEPENDENTLY for subscribers", () => {
  it("a subscriber can still spend their free unlock + purchased credits (they persist)", () => {
    const db = makeDb();
    seedSub(db, "sub");
    db.user_entitlements.set("sub", { free_unlock_used: false, unlock_credits: 2 });
    db.applications.set("f", { user_id: "sub" });
    db.applications.set("c", { user_id: "sub" });

    expect(consume(db, { uid: "sub", appId: "f", kind: "free" })).toMatchObject({ ok: true, source: "free" });
    expect(consume(db, { uid: "sub", appId: "c", kind: "credit" })).toMatchObject({ ok: true, source: "credit", unlock_credits: 1 });
    expect(db.application_unlocks.map((u) => u.source).sort()).toEqual(["credit", "free"]);
    expect(db.user_entitlements.get("sub")).toEqual({ free_unlock_used: true, unlock_credits: 1 });

    // and those persist through cancellation
    db.subscriptions.set("sub", []);
    expect(hasAccess(db, { uid: "sub", appId: "f" })).toBe(true);
    expect(hasAccess(db, { uid: "sub", appId: "c" })).toBe(true);
  });

  it("a NON-subscriber's free + credit spends are unchanged, and 'comp' grandfather rows still grant access", () => {
    const db = makeDb();
    db.applications.set("a1", { user_id: "u" });
    db.applications.set("a2", { user_id: "u" });
    db.applications.set("a3", { user_id: "u" });
    db.user_entitlements.set("u", { free_unlock_used: false, unlock_credits: 5 });

    expect(consume(db, { uid: "u", appId: "a1", kind: "free" })).toMatchObject({ ok: true, source: "free" });
    expect(consume(db, { uid: "u", appId: "a2", kind: "credit" })).toMatchObject({ ok: true, source: "credit", unlock_credits: 4 });
    db.application_unlocks.push({ user_id: "u", application_id: "a3", source: "comp", created_at: new Date().toISOString() });
    for (const a of ["a1", "a2", "a3"]) expect(hasAccess(db, { uid: "u", appId: a })).toBe(true);
  });
});
