/* ================================================================== *
 * PHASE 40 — SUBSCRIPTION ↔ UNLOCK INTERACTION (security)
 * ------------------------------------------------------------------
 * B1 (release-blocking, fixed): consume_free_unlock / consume_unlock_credit
 * must NOT persist an application_unlocks row when the caller has an active
 * subscription — otherwise a subscriber calling the RPC directly could
 * convert temporary subscription access into a permanent unlock that
 * survives cancellation.
 *
 * R1 (fail-closed): has_active_subscription() (SQL) and subscriptionIsActive()
 * (JS) must treat a NULL / missing / unparseable current_period_end as NOT
 * active — never grant unbounded access off a row with no end date.
 *
 * No local Postgres harness -> the SQL is asserted by source inspection and
 * the behaviour is exercised against a faithful in-memory model of exactly
 * what the RPCs + has_application_access do. subscriptionIsActive() itself is
 * unit-tested directly.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { subscriptionIsActive, entitlementsFromRows, ACTIVE_SUBSCRIPTION_STATUSES } from "./entitlements.js";

const MIG_DIR = new URL("../supabase/migrations/", import.meta.url);
const PRICING_MIG = readdirSync(MIG_DIR).filter((f) => /pricing|entitlement/i.test(f)).sort().pop();
const SQL = readFileSync(new URL(PRICING_MIG, MIG_DIR), "utf8");

function fnBody(name) {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} must exist`).toBeGreaterThan(-1);
  const end = SQL.indexOf("$$;", SQL.indexOf("as $$", start));
  return SQL.slice(start, end);
}

/* ============================== B1 — SQL shape ============================== */
describe("B1 — the consume RPCs never persist an unlock for an active subscriber", () => {
  for (const name of ["consume_free_unlock", "consume_unlock_credit"]) {
    it(`${name}: the has_active_subscription branch returns without inserting into application_unlocks`, () => {
      const body = fnBody(name).toLowerCase();
      const subIdx = body.indexOf("if public.has_active_subscription(uid) then");
      expect(subIdx, "subscription branch present").toBeGreaterThan(-1);
      // the branch ends at the next `end if;` after it
      const branch = body.slice(subIdx, body.indexOf("end if;", subIdx) + "end if;".length);
      expect(branch).not.toMatch(/insert\s+into\s+public\.application_unlocks/);
      expect(branch).not.toMatch(/update\s+public\.user_entitlements/); // and no credit/flag spend
      expect(branch).toMatch(/return jsonb_build_object\('ok', true, 'source', 'subscription', 'persisted', false\)/);
    });
  }

  it("the ONLY inserts into application_unlocks across both RPCs are the genuine 'free' and 'credit' spends", () => {
    const both = (fnBody("consume_free_unlock") + "\n" + fnBody("consume_unlock_credit")).toLowerCase();
    const inserts = [...both.matchAll(/insert into public\.application_unlocks[\s\S]*?values \(uid, p_application_id, '(\w+)'\)/g)].map((m) => m[1]);
    expect(inserts.sort()).toEqual(["credit", "free"]);
    expect(inserts).not.toContain("subscription");
  });

  it("has_application_access still grants a subscriber access live (via has_active_subscription), needing no row", () => {
    const body = fnBody("has_application_access").toLowerCase();
    expect(body).toMatch(/if public\.has_active_subscription\(uid\) then\s*return true;/);
  });
});

/* ============================== R1 — SQL fail-closed ============================== */
describe("R1 — has_active_subscription() fails closed on a NULL period end", () => {
  const body = fnBody("has_active_subscription").toLowerCase().replace(/\s+/g, " ");
  it("requires a concrete current_period_end (is not null) and drops the old `is null or` fail-open", () => {
    expect(body).toMatch(/status in \('active', 'trialing'\)/);
    expect(body).toMatch(/current_period_end is not null/);
    expect(body).toMatch(/current_period_end \+ interval '1 day' > now\(\)/);
    expect(body).not.toMatch(/current_period_end is null or/);
  });
});

/* ============================== R1 — JS fail-closed ============================== */
describe("R1 — subscriptionIsActive() fails closed on a NULL / missing / unparseable period end", () => {
  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  it("returns false for active/trialing when current_period_end is absent/null/blank/garbage", () => {
    for (const status of ACTIVE_SUBSCRIPTION_STATUSES) {
      expect(subscriptionIsActive({ status })).toBe(false);
      expect(subscriptionIsActive({ status, current_period_end: null })).toBe(false);
      expect(subscriptionIsActive({ status, current_period_end: undefined })).toBe(false);
      expect(subscriptionIsActive({ status, current_period_end: "" })).toBe(false);
      expect(subscriptionIsActive({ status, current_period_end: "nope" })).toBe(false);
      expect(subscriptionIsActive({ status, current_period_end: NaN })).toBe(false);
    }
  });
  it("still true only with a concrete, still-valid period end", () => {
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

/* ============================== behavioural model ============================== *
 * Faithful replica of consume_free_unlock / consume_unlock_credit (post-B1) and
 * has_application_access / has_active_subscription (post-R1).
 * ========================================================================== */
const GRACE_MS = 24 * 60 * 60 * 1000;
function subActiveFor(db, uid, now) {
  return (db.subscriptions.get(uid) || []).some((s) => {
    if (!["active", "trialing"].includes(s.status)) return false;
    if (!s.current_period_end) return false; // R1: fail closed
    const end = new Date(s.current_period_end).getTime();
    if (Number.isNaN(end)) return false;
    return end + GRACE_MS > now;
  });
}
function ownsApp(db, uid, appId) {
  return (db.applications.get(appId) || {}).user_id === uid;
}
function unlockRow(db, uid, appId) {
  return db.application_unlocks.some((u) => u.user_id === uid && u.application_id === appId);
}
// mirrors consume_free_unlock / consume_unlock_credit (kind: "free" | "credit")
function consume(db, { uid, appId, kind, now = Date.now() }) {
  if (!ownsApp(db, uid, appId)) return { error: "application not found" };
  if (unlockRow(db, uid, appId)) return { ok: true, already: true, source: "existing" };
  if (subActiveFor(db, uid, now)) {
    // B1: NO write, NO spend
    return { ok: true, source: "subscription", persisted: false };
  }
  const ent = db.user_entitlements.get(uid) || { free_unlock_used: false, unlock_credits: 0 };
  db.user_entitlements.set(uid, ent);
  if (kind === "free") {
    if (ent.free_unlock_used) return { ok: false, reason: "free_unlock_used" };
    ent.free_unlock_used = true;
    db.application_unlocks.push({ user_id: uid, application_id: appId, source: "free" });
    return { ok: true, source: "free" };
  }
  if (ent.unlock_credits < 1) return { ok: false, reason: "no_credits" };
  ent.unlock_credits -= 1;
  db.application_unlocks.push({ user_id: uid, application_id: appId, source: "credit" });
  return { ok: true, source: "credit", unlock_credits: ent.unlock_credits };
}
// mirrors has_application_access
function hasAccess(db, { uid, appId, now = Date.now() }) {
  if (!ownsApp(db, uid, appId)) return false;
  if (subActiveFor(db, uid, now)) return true;
  return unlockRow(db, uid, appId);
}
function makeDb() {
  return { applications: new Map(), user_entitlements: new Map(), application_unlocks: [], subscriptions: new Map() };
}

describe("B1 behavioural — subscription access cannot be converted into a permanent unlock", () => {
  it("(1) an active subscriber calling either consume RPC creates NO application_unlocks row and spends nothing", () => {
    const db = makeDb();
    db.applications.set("appX", { user_id: "sub" });
    db.applications.set("appY", { user_id: "sub" });
    db.user_entitlements.set("sub", { free_unlock_used: false, unlock_credits: 5 });
    db.subscriptions.set("sub", [{ status: "active", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString() }]);

    const r1 = consume(db, { uid: "sub", appId: "appX", kind: "free" });
    const r2 = consume(db, { uid: "sub", appId: "appY", kind: "credit" });
    expect(r1).toMatchObject({ ok: true, source: "subscription", persisted: false });
    expect(r2).toMatchObject({ ok: true, source: "subscription", persisted: false });

    expect(db.application_unlocks).toEqual([]); // nothing persisted
    expect(db.user_entitlements.get("sub")).toEqual({ free_unlock_used: false, unlock_credits: 5 }); // nothing spent
  });

  it("(2) once the subscription is inactive, an app 'accessed' only via the subscription is no longer accessible", () => {
    const db = makeDb();
    db.applications.set("appX", { user_id: "sub" });
    db.user_entitlements.set("sub", { free_unlock_used: false, unlock_credits: 0 });
    db.subscriptions.set("sub", [{ status: "active", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString() }]);

    // subscriber pokes the RPC and uses the app while subscribed
    consume(db, { uid: "sub", appId: "appX", kind: "free" });
    expect(hasAccess(db, { uid: "sub", appId: "appX" })).toBe(true); // via subscription

    // subscription ends
    db.subscriptions.set("sub", [{ status: "canceled", current_period_end: new Date(Date.now() - 864e5).toISOString() }]);
    expect(hasAccess(db, { uid: "sub", appId: "appX" })).toBe(false); // no row, no active sub -> gone
    expect(db.application_unlocks).toEqual([]);
  });

  it("(3) direct authenticated RPC calls, repeated across many apps, still leave zero permanent unlocks after cancellation", () => {
    const db = makeDb();
    db.user_entitlements.set("sub", { free_unlock_used: false, unlock_credits: 5 });
    db.subscriptions.set("sub", [{ status: "active", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString() }]);
    for (let i = 0; i < 20; i++) {
      db.applications.set(`app${i}`, { user_id: "sub" });
      consume(db, { uid: "sub", appId: `app${i}`, kind: i % 2 ? "free" : "credit" });
    }
    expect(db.application_unlocks).toEqual([]);
    expect(db.user_entitlements.get("sub")).toEqual({ free_unlock_used: false, unlock_credits: 5 });

    db.subscriptions.set("sub", []); // cancelled, row gone entirely
    for (let i = 0; i < 20; i++) {
      expect(hasAccess(db, { uid: "sub", appId: `app${i}` })).toBe(false);
    }
  });

  it("legitimate flows are unchanged: a NON-subscriber's free + credit spends still create permanent unlocks", () => {
    const db = makeDb();
    db.applications.set("a1", { user_id: "u" });
    db.applications.set("a2", { user_id: "u" });
    db.user_entitlements.set("u", { free_unlock_used: false, unlock_credits: 5 });

    expect(consume(db, { uid: "u", appId: "a1", kind: "free" })).toMatchObject({ ok: true, source: "free" });
    expect(consume(db, { uid: "u", appId: "a2", kind: "credit" })).toMatchObject({ ok: true, source: "credit", unlock_credits: 4 });
    expect(db.application_unlocks).toEqual([
      { user_id: "u", application_id: "a1", source: "free" },
      { user_id: "u", application_id: "a2", source: "credit" },
    ]);
    // and those permanent unlocks persist regardless of subscription state
    expect(hasAccess(db, { uid: "u", appId: "a1" })).toBe(true);
    expect(hasAccess(db, { uid: "u", appId: "a2" })).toBe(true);

    // grandfather-style 'comp' rows (written once by the migration backfill) also grant access
    db.application_unlocks.push({ user_id: "u", application_id: "a3", source: "comp" });
    db.applications.set("a3", { user_id: "u" });
    expect(hasAccess(db, { uid: "u", appId: "a3" })).toBe(true);
  });

  it("an active subscriber legitimately gets access while active, and re-subscribing restores it (no persistence needed)", () => {
    const db = makeDb();
    db.applications.set("a1", { user_id: "u" });
    db.subscriptions.set("u", [{ status: "active", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString() }]);
    expect(hasAccess(db, { uid: "u", appId: "a1" })).toBe(true);
    db.subscriptions.set("u", [{ status: "canceled", current_period_end: new Date(Date.now() - 864e5).toISOString() }]);
    expect(hasAccess(db, { uid: "u", appId: "a1" })).toBe(false);
    db.subscriptions.set("u", [{ status: "active", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString() }]);
    expect(hasAccess(db, { uid: "u", appId: "a1" })).toBe(true);
  });
});
