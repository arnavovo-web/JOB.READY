/* ================================================================== *
 * CONTACT MESSAGES — email notification layer
 * ------------------------------------------------------------------
 * Every valid submission to public.contact_messages (general feedback,
 * "Book a university demo", and the EKI² auth "Arrange a demo" action all
 * write there via the ONE existing dbSubmitContactMessage/ContactDialog
 * path in App.jsx) must additionally reach outreachteam@jobreadyai.pro by
 * email, WITHOUT changing the database write, the client bundle, or any
 * secret's location.
 *
 * Same source-inspection convention as
 * src/institutional/careersIntelligenceMigration.test.js and
 * src/institutional/adviserBriefingFunction.test.js.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(HERE, "App.jsx"), "utf8");

const MIGRATIONS_DIR = join(HERE, "..", "supabase", "migrations");
const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const NOTIFY_MIGRATION_FILE = MIGRATION_FILES.find((f) => /contact_messages_notify/.test(f));
const SQL = NOTIFY_MIGRATION_FILE ? readFileSync(join(MIGRATIONS_DIR, NOTIFY_MIGRATION_FILE), "utf8") : "";
const SQL_CODE = SQL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, ""); // comments stripped

const FN_RAW = readFileSync(
  join(HERE, "..", "supabase", "functions", "notify-contact-message", "index.ts"),
  "utf8",
);
// Strip comments, but never a "//" that's part of a URL (https://...) — a
// plain /\/\/.../ strip would truncate the fetch("https://api.resend.com/...")
// call itself.
const FN = FN_RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "");

/* ---------------------------------------------------------------- *
 * 1. Existing submission paths — traced, and untouched
 * ---------------------------------------------------------------- */
describe("every website submission still writes to contact_messages the same way", () => {
  it("there is exactly ONE client write path: dbSubmitContactMessage -> contact_messages", () => {
    const fn = APP.slice(APP.indexOf("async function dbSubmitContactMessage("), APP.indexOf("async function rpcConsumeFreeUnlock("));
    expect(fn).toMatch(/\.from\("contact_messages"\)\.insert\(\{/);
    expect(fn).toMatch(/user_id: userId/);
    expect(fn).toMatch(/name: name \|\| null/);
    expect(fn).toMatch(/email,/);
    expect(fn).toMatch(/message,/);
    expect(fn).toMatch(/page: typeof window/);
    expect(fn).toMatch(/user_agent: typeof navigator/);
    // still throws on failure -> the dialog never claims success falsely
    expect(fn).toMatch(/if \(error\) throw new Error/);
    // no email/notification call was added to the client insert path
    expect(fn).not.toMatch(/fetch\(|resend|functions\.invoke|RESEND/i);
  });

  it("all three submission entry points route through the one shared <ContactDialog>", () => {
    // general Contact Us (nav)
    expect(APP).toMatch(/onContact=\{\(\) => openContact\(\)\}/);
    // Universities page "Book a university demo"
    expect(APP).toMatch(/onDemo=\{\(\) => openContact\(\{/);
    // EKI² auth no-workspace "Arrange a demo"
    expect(APP).toMatch(/onBookDemo=\{\(\) => openContact\(\{/);
    // exactly one ContactDialog instance, wired to the one insert function
    expect((APP.match(/<ContactDialog\b/g) || []).length).toBe(1);
    expect(APP).toMatch(/<ContactDialog[\s\S]*?onSubmit=\{dbSubmitContactMessage\}/);
  });

  it("the university-demo preset is recognisable text the notify function can classify", () => {
    expect(APP).toMatch(/\[University demo request\]/);
    expect(APP).toMatch(/Institution:\\nRole \/ team:/);
  });
});

/* ---------------------------------------------------------------- *
 * 2. Migration — additive, idempotent, never blocks the insert
 * ---------------------------------------------------------------- */
describe("contact_messages_notify migration", () => {
  it("exists, sorts with the contact_messages lineage (not the institutional/EKI² layer)", () => {
    expect(NOTIFY_MIGRATION_FILE).toBeTruthy();
    expect(NOTIFY_MIGRATION_FILE).toMatch(/^\d{14}_contact_messages_notify\.sql$/);
    expect(NOTIFY_MIGRATION_FILE.slice(0, 14) > "20260903120000").toBe(true);
    expect(NOTIFY_MIGRATION_FILE.slice(0, 14) < "20260909120000").toBe(true);
  });

  it("contact_messages stays the source of record: additive columns only, no destructive DDL", () => {
    expect(SQL_CODE.toLowerCase()).not.toMatch(/drop table|truncate|delete from public\.contact_messages/);
    expect(SQL).toMatch(/alter table public\.contact_messages add column if not exists notified_at timestamptz/);
    expect(SQL).toMatch(/alter table public\.contact_messages add column if not exists notify_error text/);
  });

  it("does not touch the existing INSERT-only RLS policies", () => {
    expect(SQL_CODE.toLowerCase()).not.toMatch(/drop policy|create policy|alter table public\.contact_messages (enable|disable) row level security/);
  });

  it("pg_net is installed the same way btree_gist already is (extensions schema)", () => {
    expect(SQL).toMatch(/create schema if not exists extensions;/);
    expect(SQL).toMatch(/create extension if not exists pg_net with schema extensions;/);
  });

  it("the trigger function NEVER lets a notification failure roll back the insert", () => {
    const fn = SQL.slice(SQL.indexOf("create or replace function public.notify_contact_message()"), SQL.indexOf("drop trigger if exists"));
    expect(fn).toMatch(/security definer/i);
    expect(fn).toMatch(/set search_path to 'public'/i);
    // the net.http_post call is inside its own begin/exception block
    expect(fn).toMatch(/begin\s*\n\s*perform net\.http_post\(/);
    expect(fn).toMatch(/exception when others then/);
    expect(fn).toMatch(/raise warning/);
    // and the function unconditionally returns the row either way
    expect(fn).toMatch(/return new;\s*\n\s*end;\s*\n\$\$;\s*$/);
  });

  it("fires AFTER insert (row already committed before any notification attempt)", () => {
    expect(SQL).toMatch(/create trigger contact_messages_notify\s*\n\s*after insert on public\.contact_messages/);
  });

  it("only sends the row id to the function — no attacker-controllable content in the payload", () => {
    expect(SQL).toMatch(/body\s*:= jsonb_build_object\('id', new\.id\)/);
  });

  it("the trigger function's EXECUTE is locked down (it can still only run as a trigger)", () => {
    expect(SQL).toMatch(/revoke all on function public\.notify_contact_message\(\) from public, anon, authenticated;/);
  });
});

/* ---------------------------------------------------------------- *
 * 3. Edge Function — classification, recipient, subject, reliability
 * ---------------------------------------------------------------- */
describe("notify-contact-message Edge Function", () => {
  it("defaults to the required recipient, configurable via env (never hardcoded elsewhere)", () => {
    expect(FN).toMatch(/NOTIFY_TO_EMAIL = Deno\.env\.get\("NOTIFY_TO_EMAIL"\) \|\| "outreachteam@jobreadyai\.pro"/);
  });

  it("reads its email-provider secret ONLY from a server-side env var, never a literal", () => {
    expect(FN).toMatch(/RESEND_API_KEY = Deno\.env\.get\("RESEND_API_KEY"\)/);
    // no key-shaped literal assigned to it
    expect(FN).not.toMatch(/RESEND_API_KEY\s*=\s*"[^"]*re_[A-Za-z0-9]/);
  });

  it("classifies University Demo Request vs Website Feedback and builds the specified subject shapes", () => {
    expect(FN).toMatch(/DEMO_PREFIX = \/\^\\\[University demo request\\\]\/i/);
    expect(FN).toMatch(/isDemo \? "University Demo Request" : "Website Feedback"/);
    expect(FN).toMatch(/subject = `\[JOB\.READY\] \$\{type\} — \$\{subjectName\}`/);
  });

  it("extracts University/organisation, Role/title, Country from the message when present, never required", () => {
    expect(FN).toMatch(/extractField\(message, "Institution"\)/);
    expect(FN).toMatch(/extractField\(message, "Role\\\\s\*\/\\\\s\*team"\)/);
    expect(FN).toMatch(/extractField\(message, "Country"\)/);
    expect(FN).toMatch(/institution \? `University \/ organisation: \$\{institution\}` : null/);
    expect(FN).toMatch(/role \? `Role \/ title: \$\{role\}` : null/);
    expect(FN).toMatch(/country \? `Country: \$\{country\}` : null/);
  });

  it("includes name, email, message and the submission timestamp unconditionally", () => {
    expect(FN).toMatch(/`Name: \$\{row\.name \|\| "\(not provided\)"\}`/);
    expect(FN).toMatch(/`Email: \$\{row\.email\}`/);
    expect(FN).toMatch(/"Message:"/);
    expect(FN).toMatch(/`Submitted: \$\{row\.created_at\}`/);
  });

  it("re-reads the row from contact_messages by id — never trusts the webhook body for content", () => {
    expect(FN).toMatch(/\.from\("contact_messages"\)\s*\n\s*\.select\("id, name, email, message, page, user_agent, created_at, notified_at"\)\s*\n\s*\.eq\("id", id\)/);
    expect(FN).toMatch(/buildEmail\(row as any\)/);
  });

  it("never touches contact_messages content columns, only the two notification-status columns", () => {
    const updates = [...FN.matchAll(/\.update\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(updates.length).toBeGreaterThanOrEqual(2);
    for (const u of updates) {
      expect(u).toMatch(/notify_error|notified_at/);
      expect(u).not.toMatch(/\bname:|\bemail:|\bmessage:/);
    }
  });

  it("a missing email-provider secret is handled gracefully — logged, not thrown, DB row untouched otherwise", () => {
    const block = FN.slice(FN.indexOf("if (!RESEND_API_KEY)"), FN.indexOf("const { subject, text }"));
    expect(block).toMatch(/console\.error\(/);
    expect(block).toMatch(/notify_error: "email_not_configured"/);
    expect(block).toMatch(/return json\(\{ ok: false, reason: "email_not_configured" \}\)/);
  });

  it("a failed send is caught, logged, and recorded on the row — never thrown past the handler", () => {
    expect(FN).toMatch(/if \(!res\.ok\) \{[\s\S]*?console\.error\("Resend send failed:"/);
    expect(FN).toMatch(/notify_error: `resend_\$\{res\.status\}`/);
    expect(FN).toMatch(/catch \(e\) \{[\s\S]*?console\.error\("Resend request error:"/);
    expect(FN).toMatch(/notify_error: String\(\(e as Error\)\.message\)/);
  });

  it("is idempotent: an already-notified row is skipped, never re-sent", () => {
    expect(FN).toMatch(/if \(row\.notified_at\) \{[\s\S]*?return json\(\{ ok: true, skipped: "already_notified" \}\)/);
  });

  it("marks success only after the email provider actually accepted the send", () => {
    const order = FN.indexOf("await fetch(\"https://api.resend.com/emails\"");
    const markSuccess = FN.indexOf("notified_at: new Date().toISOString()");
    expect(order).toBeGreaterThan(-1);
    expect(markSuccess).toBeGreaterThan(order); // the send happens BEFORE notified_at is ever set
  });

  it("the trigger authenticates its call with a Supabase JWT (satisfies the deployed verify_jwt=true gate)", () => {
    // verify_jwt is a deploy-time flag (not stored in the function source, same as
    // eki-adviser-briefing) — set true on deploy; asserted here via the caller side:
    // the trigger sends a real Supabase JWT (the publishable anon key) as Bearer.
    expect(SQL).toMatch(/'Authorization', 'Bearer ey/);
  });

  it("uses the service-role client (bypasses RLS the same way stripe-webhook / eki-adviser-briefing do)", () => {
    expect(FN).toMatch(/Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  });
});

/* ---------------------------------------------------------------- *
 * 4. No secret ever ships to the browser
 * ---------------------------------------------------------------- */
describe("no email-provider secret in the client bundle", () => {
  it("no src/**/*.{js,jsx} file references the email provider or its secret", () => {
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return /\.(jsx?|tsx?)$/.test(e.name) ? [p] : [];
    });
    const files = walk(HERE).filter((p) => !p.includes(`${join("src", "contactMessagesNotify.test.js")}`));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/RESEND_API_KEY/);
      expect(src, f).not.toMatch(/api\.resend\.com/);
      expect(src, f).not.toMatch(/re_[A-Za-z0-9]{20,}/); // shape of a real Resend key
    }
  });

  it("Edge Function secrets are Deno.env-only, never inlined as string literals in the function source", () => {
    expect(FN_RAW).not.toMatch(/"re_[A-Za-z0-9]{10,}"/);
  });
});
