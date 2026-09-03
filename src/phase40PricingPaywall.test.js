/* ================================================================== *
 * PHASE 40 — PRICING, PAYMENTS & PAYWALL (structural / integration)
 * ------------------------------------------------------------------
 * Source-inspection guards (same convention as supabaseSchemaTracking /
 * phaseBEngagement). They assert that:
 *   - the entitlement migration exists, is timestamped AFTER the current
 *     latest repo migration, is idempotent, and is SELECT-only from the
 *     browser (no write policy on any of the four new tables);
 *   - the consume / access RPCs exist and validate ownership;
 *   - the Stripe Edge Functions exist (checkout = authed; webhook =
 *     signature-verified, service-role, idempotent) and ai-generate
 *     refuses application-scoped AI for a locked application;
 *   - amounts + credit counts are identical in entitlements.js and the
 *     Edge Functions;
 *   - App.jsx wires the pricing page, the nav item and the paywall gate
 *     into every preparation-resource entry point — and the free unlock
 *     is spent ONLY after the user confirms it in the modal, never
 *     silently — WITHOUT gating application creation/save, adding an npm
 *     dependency, or adding a new callClaude request type.
 * Node env — source + pure-content assertions only.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { PRICING_PLANS, CREDITS_PER_PRODUCT } from "./entitlements.js";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const ENT_SRC = readFileSync(new URL("./entitlements.js", import.meta.url), "utf8");
const MIG_DIR = new URL("../supabase/migrations/", import.meta.url);
const migFiles = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const PRICING_MIG_NAME = migFiles.find((f) => /pricing|entitlement/i.test(f));
const MIG = PRICING_MIG_NAME ? readFileSync(new URL(PRICING_MIG_NAME, MIG_DIR), "utf8") : "";
const migLower = MIG.toLowerCase().replace(/[ \t]+/g, " ");
const CHECKOUT = readFileSync(new URL("../supabase/functions/create-checkout/index.ts", import.meta.url), "utf8");
const WEBHOOK = readFileSync(new URL("../supabase/functions/stripe-webhook/index.ts", import.meta.url), "utf8");
const AIGEN = readFileSync(new URL("../supabase/functions/ai-generate/index.ts", import.meta.url), "utf8");

const NEW_TABLES = ["user_entitlements", "application_unlocks", "payments", "subscriptions"];

/* ============================== migration ============================== */
describe("Phase 40 — entitlement migration", () => {
  it("a dedicated pricing/entitlement migration file exists and is not named a 'baseline'", () => {
    expect(PRICING_MIG_NAME, "supabase/migrations/*pricing*|*entitlement*.sql").toBeTruthy();
    expect(/^\d{14}_/.test(PRICING_MIG_NAME)).toBe(true);
    expect(/baseline/i.test(PRICING_MIG_NAME)).toBe(false);
  });

  it("is timestamped after every migration that predates it (monotonic apply order; a later additive migration is fine)", () => {
    const mine = PRICING_MIG_NAME.slice(0, 14);
    // The migrations that existed when this one was authored — it must apply
    // strictly after all of them. Migrations added *later* (e.g. the Contact Us
    // contact_messages table) legitimately sort after this one and are not a
    // monotonicity violation.
    const predecessors = [
      "20260828120000", // baseline_schema
      "20260828135856", // development_modules
      "20260901220000", // phase37_application_checklist
      "20260902200000", // profiles_reference_code (already in the live ledger)
    ];
    for (const ts of predecessors) expect(mine > ts, `${mine} must sort after ${ts}`).toBe(true);
    // specifically: after the reference-code migration that is already in the live ledger
    expect(mine > "20260902200000").toBe(true);
  });

  it("creates all four entitlement tables, each guarded with IF NOT EXISTS", () => {
    for (const t of NEW_TABLES) expect(migLower).toContain(`create table if not exists public.${t} (`);
  });

  it("enables RLS on every new table", () => {
    for (const t of NEW_TABLES) expect(migLower).toContain(`alter table public.${t} enable row level security`);
  });

  it("is SELECT-own only from the browser — NO insert/update/delete policy on any new table", () => {
    const policies = [...MIG.matchAll(/create policy\s+(\w+)\s+on\s+public\.(\w+)\s+for\s+(\w+)/gi)];
    expect(policies.length).toBeGreaterThanOrEqual(4);
    for (const [, name, table, verb] of policies) {
      if (NEW_TABLES.includes(table)) {
        expect(verb.toLowerCase(), `policy ${name} on ${table} must be SELECT-only`).toBe("select");
      }
    }
    expect(migLower).not.toMatch(/create policy[^;]+for (insert|update|delete|all)[^;]*public\.(user_entitlements|application_unlocks|payments|subscriptions)/);
    for (const m of MIG.matchAll(/create policy (\w+)/g)) {
      expect(MIG).toMatch(new RegExp(`drop policy if exists ${m[1]}\\b`));
    }
  });

  it("indexes are idempotent and there are no destructive statements", () => {
    for (const c of migLower.match(/create index[^(]*/g) || []) expect(c).toMatch(/create index if not exists/);
    expect(migLower).not.toMatch(/drop table/);
    expect(migLower).not.toMatch(/drop column/);
    expect(migLower).not.toMatch(/truncate/);
    expect(migLower).not.toMatch(/delete from/);
  });

  it("defines the consume + access RPCs as SECURITY DEFINER with a pinned search_path", () => {
    for (const fn of ["consume_free_unlock", "consume_unlock_credit", "has_application_access", "ensure_user_entitlements", "has_active_subscription"]) {
      expect(migLower).toContain(`create or replace function public.${fn}(`);
    }
    const fns = [...migLower.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\$\$/g)];
    expect(fns.length).toBeGreaterThanOrEqual(5);
    for (const [body, name] of fns) {
      expect(body, `${name} must be SECURITY DEFINER`).toMatch(/security definer/);
      expect(body, `${name} must pin search_path`).toMatch(/set search_path to 'public'/);
    }
  });

  it("the consume RPCs verify the caller owns the application and row-lock before granting", () => {
    for (const fn of ["consume_free_unlock", "consume_unlock_credit"]) {
      const from = migLower.indexOf(`create or replace function public.${fn}(`);
      const fnBody = migLower.slice(from, migLower.indexOf("$$;", from));
      expect(fnBody).toMatch(/from public\.applications a where a\.id = p_application_id and a\.user_id = uid/);
      expect(fnBody).toMatch(/for update/);
    }
  });

  it("consume_free_unlock enforces 'once per account'; consume_unlock_credit refuses at zero", () => {
    const free = migLower.slice(migLower.indexOf("create or replace function public.consume_free_unlock("));
    expect(free.slice(0, free.indexOf("$$;"))).toMatch(/if ent\.free_unlock_used then/);
    const credit = migLower.slice(migLower.indexOf("create or replace function public.consume_unlock_credit("));
    expect(credit.slice(0, credit.indexOf("$$;"))).toMatch(/if ent\.unlock_credits < 1 then/);
  });

  it("seeds user_entitlements for existing accounts and wires it into handle_new_user", () => {
    expect(migLower).toMatch(/insert into public\.user_entitlements \(user_id\)\s*select p\.id from public\.profiles p/);
    const hnu = migLower.slice(migLower.indexOf("create or replace function public.handle_new_user()"));
    expect(hnu.slice(0, hnu.indexOf("$$;"))).toMatch(/insert into public\.user_entitlements \(user_id\)/);
  });

  it("grandfathers every application that exists when the migration runs", () => {
    expect(migLower).toMatch(/insert into public\.application_unlocks \(user_id, application_id, source\)\s*select a\.user_id, a\.id, 'comp'\s*from public\.applications a/);
  });

  it("execute is granted to authenticated only for the callable RPCs, revoked from anon", () => {
    expect(migLower).toMatch(/revoke all on function public\.consume_free_unlock\(uuid\)\s+from public, anon/);
    expect(migLower).toMatch(/grant execute on function public\.consume_free_unlock\(uuid\)\s+to authenticated/);
    expect(migLower).toMatch(/revoke all on function public\.has_active_subscription\(uuid\)\s+from public, anon, authenticated/);
  });
});

/* ==================== schema-tracking cross-check ==================== */
describe("Phase 40 — the new client-referenced tables are covered by a migration", () => {
  it("every from(\"<new table>\") in App.jsx has a create-table + RLS in the migrations", () => {
    const ALL_SQL = migFiles
      .map((f) => readFileSync(new URL(f, MIG_DIR), "utf8"))
      .join("\n").toLowerCase().replace(/[ \t]+/g, " ");
    for (const t of NEW_TABLES) {
      if (SRC.includes(`from("${t}")`)) {
        expect(ALL_SQL).toContain(`create table if not exists public.${t} (`);
        expect(ALL_SQL).toContain(`alter table public.${t} enable row level security`);
      }
    }
  });
});

/* ============================== Stripe: create-checkout ============================== */
describe("Phase 40 — create-checkout Edge Function", () => {
  it("authenticates the caller and never grants entitlements itself", () => {
    expect(CHECKOUT).toMatch(/supabase\.auth\.getUser\(\)/);
    expect(CHECKOUT).toMatch(/Not authenticated/);
    expect(CHECKOUT).not.toMatch(/from\("user_entitlements"\)|from\("application_unlocks"\)|from\("subscriptions"\)/);
  });

  it("only creates sessions for the three purchasable products", () => {
    expect(CHECKOUT).toMatch(/last_minute_saver:/);
    expect(CHECKOUT).toMatch(/student_pack:/);
    expect(CHECKOUT).toMatch(/job_search_pass:/);
    expect(CHECKOUT).toMatch(/Unknown product/);
  });

  it("stamps the user id onto the session (and the subscription) so the webhook can attribute it", () => {
    expect(CHECKOUT).toMatch(/client_reference_id:\s*user\.id/);
    expect(CHECKOUT).toMatch(/user_id:\s*user\.id/);
    expect(CHECKOUT).toMatch(/subscription_data:\s*\{\s*metadata:\s*\{\s*user_id:\s*user\.id/);
  });

  it("subscription product uses a recurring monthly price and guards the return origin", () => {
    expect(CHECKOUT).toMatch(/mode:\s*"subscription"/);
    expect(CHECKOUT).toMatch(/recurring:\s*\{\s*interval:\s*"month"\s*\}/);
    expect(CHECKOUT).toMatch(/resolveSiteOrigin/);
    expect(CHECKOUT).toMatch(/Checkout origin not allowed/);
  });
});

/* ============================== Stripe: webhook ============================== */
describe("Phase 40 — stripe-webhook Edge Function", () => {
  it("verifies the Stripe signature before doing anything", () => {
    expect(WEBHOOK).toMatch(/constructEventAsync\(raw, sig, STRIPE_WEBHOOK_SECRET\)/);
    expect(WEBHOOK).toMatch(/Invalid signature/);
  });

  it("writes with the service-role key (RLS bypassed — the payer is not the caller)", () => {
    expect(WEBHOOK).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("grants credits via the atomic apply_purchase_credits RPC, not a service-role read-modify-write", () => {
    expect(WEBHOOK).toMatch(/db\.rpc\("apply_purchase_credits",\s*\{/);
    // the checkout id + user id + credit count are all passed to the RPC
    expect(WEBHOOK).toMatch(/p_checkout_id:\s*session\.id/);
    expect(WEBHOOK).toMatch(/p_user_id:\s*userId/);
    expect(WEBHOOK).toMatch(/p_credits:\s*credits/);
    // a redelivery is reported by the RPC and short-circuits
    expect(WEBHOOK).toMatch(/already_processed/);
    expect(WEBHOOK).toMatch(/already processed, skipping grant/);
    // the old non-atomic pattern is gone
    expect(WEBHOOK).not.toMatch(/from\("user_entitlements"\)\s*\.\s*select\("unlock_credits"\)/s);
    expect(WEBHOOK).not.toMatch(/from\("payments"\)\s*\.\s*upsert/s);
  });

  it("handles checkout completion and subscription lifecycle events; only grants on a paid one-time purchase", () => {
    expect(WEBHOOK).toMatch(/checkout\.session\.completed/);
    expect(WEBHOOK).toMatch(/customer\.subscription\.created/);
    expect(WEBHOOK).toMatch(/customer\.subscription\.updated/);
    expect(WEBHOOK).toMatch(/customer\.subscription\.deleted/);
    expect(WEBHOOK).toMatch(/session\.mode === "payment" && session\.payment_status === "paid"/);
  });
});

/* ============================== ai-generate backend gate ============================== */
describe("Phase 40 — ai-generate enforces entitlement for application-scoped AI", () => {
  it("checks has_application_access for application-scoped request types, returning 402", () => {
    expect(AIGEN).toMatch(/APPLICATION_SCOPED_REQUEST_TYPES/);
    expect(AIGEN).toMatch(/supabase\.rpc\("has_application_access",\s*\{\s*p_application_id:\s*applicationId/);
    expect(AIGEN).toMatch(/402/);
    expect(AIGEN).toMatch(/application_locked/);
    expect(AIGEN).toMatch(/APPLICATION_SCOPED_REQUEST_TYPES\.has\(requestType\) && applicationId/);
  });

  it("gates the AI request types that carry meaningful cost", () => {
    for (const t of [
      "interview_profile", "interview_question_batch", "interview_turn_generate",
      "interview_turn_evaluate", "interview_batch_evaluation", "interview_report",
      "classroom_lesson", "development_module", "assessment_centre_scenario",
    ]) {
      expect(AIGEN).toContain(`"${t}"`);
    }
  });

  it("does NOT gate pre-application / stand-alone request types", () => {
    const gateBlock = AIGEN.slice(AIGEN.indexOf("APPLICATION_SCOPED_REQUEST_TYPES"), AIGEN.indexOf("Phase 37 — hybrid routing"));
    expect(gateBlock).not.toMatch(/"invitation_extraction"/);
    expect(gateBlock).not.toMatch(/"assessment_centre"[^_]/);
  });

  it("keeps the v7 provider abstraction (built on the current base, not a stale one)", () => {
    expect(AIGEN).toMatch(/from "\.\/providers\.ts"/);
    expect(AIGEN).toMatch(/callAIProvider\(/);
  });
});

/* ============================== amounts stay in sync ============================== */
describe("Phase 40 — prices + credit counts are identical everywhere", () => {
  const byId = Object.fromEntries(PRICING_PLANS.map((p) => [p.id, p]));

  it("create-checkout amounts match entitlements.js PRICING_PLANS", () => {
    expect(CHECKOUT).toMatch(new RegExp(`last_minute_saver:[\\s\\S]*?amount:\\s*${byId.last_minute_saver.amount}\\b`));
    expect(CHECKOUT).toMatch(new RegExp(`student_pack:[\\s\\S]*?amount:\\s*${byId.student_pack.amount}\\b`));
    expect(CHECKOUT).toMatch(new RegExp(`job_search_pass:[\\s\\S]*?amount:\\s*${byId.job_search_pass.amount}\\b`));
  });

  it("webhook credit grants match CREDITS_PER_PRODUCT", () => {
    expect(WEBHOOK).toMatch(new RegExp(`last_minute_saver:\\s*${CREDITS_PER_PRODUCT.last_minute_saver}\\b`));
    expect(WEBHOOK).toMatch(new RegExp(`student_pack:\\s*${CREDITS_PER_PRODUCT.student_pack}\\b`));
  });
});

/* ============================== entitlements.js purity ============================== */
describe("Phase 40 — entitlements.js is a pure module", () => {
  it("imports nothing and has no runtime coupling to React / Supabase / fetch / DOM", () => {
    expect(ENT_SRC).not.toMatch(/^import\s/m);
    expect(ENT_SRC).not.toMatch(/require\(/);
    expect(ENT_SRC).not.toMatch(/\bfetch\s*\(|getSupabase|createClient\(|localStorage|sessionStorage|document\.\w|window\.\w/);
  });
});

/* ============================== App.jsx wiring ============================== */
describe("Phase 40 — App.jsx wiring", () => {
  it("adds a Pricing item to the public nav and a dedicated pricing screen", () => {
    expect(SRC).toMatch(/\{ label: "Pricing", to: "pricing" \}/);
    expect(SRC).toMatch(/screen === "pricing"/);
    expect(SRC).toMatch(/const showNav = \[[^\]]*"pricing"[^\]]*\]/);
    expect(SRC).toMatch(/<PricingPlans\b/);
  });

  it("the authenticated nav still points at exactly the five product sections (unchanged)", () => {
    const li = SRC.indexOf("const links = user");
    const authed = SRC.slice(li, li + 320);
    for (const dest of ['to: "dashboard"', 'to: "applications"', 'to: "classroom"', 'to: "ac_home"', 'to: "progress"']) {
      expect(authed).toContain(dest);
    }
  });

  it("loads the entitlement snapshot at auth (into a ref-mirrored state) and clears it on sign-out", () => {
    expect(SRC).toMatch(/dbLoadEntitlements\(userId\)/);
    expect(SRC).toMatch(/applyEntitlements\(state\.entitlements\)/);
    expect(SRC).toMatch(/entitlementsRef\.current = norm/);
    expect(SRC).toMatch(/applyEntitlements\(\{\}\); setFreeUnlockPrompt\(null\); setPaywall\(null\)/);
  });

  it("entitlement tables are read-only from the client; mutations go only through the two RPCs", () => {
    const fn = SRC.slice(SRC.indexOf("async function dbLoadEntitlements("), SRC.indexOf("async function rpcConsumeFreeUnlock("));
    for (const t of NEW_TABLES) {
      expect(fn).not.toMatch(new RegExp(`from\\("${t}"\\)\\.(insert|update|delete|upsert)`));
    }
    expect(SRC).toMatch(/supabase\.rpc\("consume_free_unlock", \{ p_application_id: applicationId \}\)/);
    expect(SRC).toMatch(/supabase\.rpc\("consume_unlock_credit", \{ p_application_id: applicationId \}\)/);
  });

  it("routes checkout through the create-checkout Edge Function (no card handling in the browser)", () => {
    expect(SRC).toMatch(/functions\.invoke\("create-checkout"/);
    expect(SRC).not.toMatch(/@stripe\/stripe-js|loadStripe/);
  });

  it("the paywall gate is called before every application-scoped preparation resource", () => {
    for (const fn of [
      "async function buildInterviewFromApplication(app)",
      "async function analyseApplicationOnly(app)",
      "async function continueApplication(app)",
      "async function startPractiseAgain(app)",
      "async function startQuickPractice(app, questionCount)",
      "async function startChallengeMe(app)",
      "async function analyseAndPlan()",
      "async function startLearningFromRecommendation(rec, app)",
      "async function openDevelopmentModule(topic, opts = {})",
      "async function openLesson(topic)",
      "async function generateAcScenario(type)",
    ]) {
      const start = SRC.indexOf(fn);
      expect(start, `${fn} present`).toBeGreaterThan(-1);
      const body = SRC.slice(start, start + 700);
      expect(body, `${fn} calls ensureApplicationAccess`).toMatch(/ensureApplicationAccess\(/);
    }
  });

  it("FREE never spends the unlock silently — ensureApplicationAccess opens the confirmation modal, and rpcConsumeFreeUnlock is only reached from confirmFreeUnlock", () => {
    const gate = SRC.slice(SRC.indexOf("async function ensureApplicationAccess("), SRC.indexOf("async function confirmFreeUnlock("));
    expect(gate).toMatch(/access\.status === ACCESS\.FREE/);
    expect(gate).toMatch(/setFreeUnlockPrompt\(\{ applicationId, company, role, onProceed/);
    expect(gate).not.toMatch(/rpcConsumeFreeUnlock|consume_free_unlock/);
    // the RPC is invoked from exactly one place: confirmFreeUnlock (the modal's confirm button)
    const consumeCallers = [...SRC.matchAll(/rpcConsumeFreeUnlock\(/g)];
    expect(consumeCallers.length).toBe(2); // the helper definition + the one call site
    const confirmFn = SRC.slice(SRC.indexOf("async function confirmFreeUnlock("), SRC.indexOf("async function spendUnlockCreditFromPaywall("));
    expect(confirmFn).toMatch(/const result = await rpcConsumeFreeUnlock\(prompt\.applicationId\)/);
  });

  it("renders the free-unlock confirmation modal with the exact required buttons + a dynamic company title", () => {
    expect(SRC).toMatch(/freeUnlockPrompt && \(\s*\n?\s*<FreeUnlockDialog/);
    const dialog = SRC.slice(SRC.indexOf("function FreeUnlockDialog("), SRC.indexOf("function Card({ children, style, hover = true"));
    expect(dialog, "FreeUnlockDialog must be defined among the shared components, before the landing components").toContain("freeUnlockPromptCopy(company)");
    expect(dialog).toMatch(/copy\.cancelLabel/);
    expect(dialog).toMatch(/copy\.confirmLabel/);
    expect(dialog).toMatch(/copy\.note/);
    // dynamic-company title + exact copy live in entitlements.js (unit-tested there)
    expect(ENT_SRC).toMatch(/You're about to unlock your application at \$\{clean\}/);
    expect(ENT_SRC).toContain("Unlock & start preparing");
    expect(ENT_SRC).toContain("Not now");
  });

  it("renders the locked-application paywall using the shared product copy + a credit-spend option", () => {
    expect(SRC).toMatch(/paywall && \(\(\) => \{/);
    expect(SRC).toMatch(/paywallCopy\(access\)/);
    expect(SRC).toMatch(/spendUnlockCreditFromPaywall/);
    expect(ENT_SRC).toMatch(/Continue your preparation/);
  });

  it("shows the remaining-unlocks count on the dashboard", () => {
    expect(SRC).toMatch(/remainingUnlocksSummary\(entitlements\)/);
  });
});

/* ============================== CRITICAL PRODUCT RULE ============================== */
describe("Phase 40 — application creation / save is NEVER gated", () => {
  it("dbCreateApplication and saveApplicationForm do not call the paywall gate", () => {
    const create = SRC.slice(SRC.indexOf("async function dbCreateApplication("), SRC.indexOf("async function dbUpdateApplication("));
    expect(create).not.toMatch(/ensureApplicationAccess|evaluateApplicationAccess|paywall/);
    const save = SRC.slice(SRC.indexOf("async function saveApplicationForm("), SRC.indexOf("async function analyseApplicationOnly("));
    expect(save).not.toMatch(/ensureApplicationAccess\(/);
  });

  it("confirmCompanyRole (wizard step 1 -> 2) is not gated — setup always proceeds", () => {
    const fn = SRC.slice(SRC.indexOf("async function confirmCompanyRole("), SRC.indexOf("async function handleFileUpload("));
    expect(fn).not.toMatch(/ensureApplicationAccess\(/);
  });
});

/* ============================== no scope creep ============================== */
describe("Phase 40 — no new dependency, no new AI request type", () => {
  it("package.json dependency set is unchanged", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort()).toEqual(
      ["@vitejs/plugin-react", "lucide-react", "mammoth", "react", "react-dom", "vite", "vitest"].sort(),
    );
  });

  it("introduces no new callClaude/callAI requestType string", () => {
    const types = [...new Set([...SRC.matchAll(/requestType:\s*"([a-z_]+)"/g)].map((m) => m[1]))].sort();
    expect(types).toEqual([
      "assessment_centre", "assessment_centre_scenario", "classroom_lesson", "development_module",
      "interview_batch_evaluation", "interview_profile", "interview_question_batch", "interview_report",
      "interview_turn_evaluate", "interview_turn_generate", "invitation_extraction",
    ].sort());
  });
});
