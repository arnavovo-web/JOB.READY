/* ================================================================== *
 * SUPABASE SCHEMA TRACKING — INFRASTRUCTURE REGRESSION TESTS
 * ------------------------------------------------------------------
 * Covers the deployment/reproducibility fix:
 *   (1) A repository-tracked Supabase migration baseline exists and is
 *       written idempotently (safe to run against the existing live DB).
 *   (2) The baseline actually covers every table the client code talks to,
 *       and the three previously-ad-hoc `applications` columns in particular
 *       (jd_profile, jd_profile_hash, application_intelligence).
 *   (3) A REQUIRED dbUpdateApplication write that fails no longer silently
 *       masquerades as success — dbUpdateApplication reports { ok }, and the
 *       analyseAndPlan call site that persists jd_profile / Application
 *       Intelligence checks it and aborts loudly.
 *   (4) Application Intelligence survives a persist -> reload round trip and
 *       degrades gracefully for a legacy row with nothing stored.
 * Structural checks use the same source-inspection convention as the rest of
 * the suite (reportUX.test.js etc.).
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildApplicationIntelligence, validateApplicationIntelligence } from "./applicationIntelligence.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const MIGRATIONS_DIR = join(REPO, "supabase", "migrations");
const APP_SRC = readFileSync(join(HERE, "App.jsx"), "utf8");

/* ============================== (1) baseline migration exists & is idempotent ============================== */
describe("supabase/migrations — a tracked, idempotent baseline", () => {
  it("supabase/ scaffolding is present (migrations dir, config.toml, README)", () => {
    expect(existsSync(MIGRATIONS_DIR)).toBe(true);
    expect(existsSync(join(REPO, "supabase", "config.toml"))).toBe(true);
    expect(existsSync(join(REPO, "supabase", "README.md"))).toBe(true);
  });

  const files = existsSync(MIGRATIONS_DIR)
    ? readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))
    : [];

  it("contains exactly one timestamped baseline migration", () => {
    const baseline = files.filter((f) => /^\d{14}_.*baseline.*\.sql$/.test(f));
    expect(baseline.length).toBe(1);
  });

  const SQL = files.length ? readFileSync(join(MIGRATIONS_DIR, files[0]), "utf8") : "";
  const sqlLower = SQL.toLowerCase();

  it("every table creation is guarded with IF NOT EXISTS", () => {
    const creates = sqlLower.match(/create table[^(]*/g) || [];
    expect(creates.length).toBeGreaterThan(10);
    for (const c of creates) expect(c).toMatch(/create table if not exists/);
  });

  it("every index / policy creation is idempotent (IF NOT EXISTS / preceded by DROP POLICY IF EXISTS)", () => {
    for (const c of sqlLower.match(/create index[^(]*/g) || []) expect(c).toMatch(/create index if not exists/);
    // each `create policy X` must have a matching `drop policy if exists X` earlier in the file
    for (const m of SQL.matchAll(/create policy (\w+)/g)) {
      expect(SQL).toMatch(new RegExp(`drop policy if exists ${m[1]}\\b`));
    }
  });

  it("functions use CREATE OR REPLACE and the auth trigger creation is guarded", () => {
    if (/create function|create or replace function/.test(sqlLower)) {
      expect(sqlLower).toMatch(/create or replace function/);
      expect(sqlLower).not.toMatch(/create function (?!or replace)/);
    }
    if (sqlLower.includes("on_auth_user_created")) {
      expect(sqlLower).toMatch(/if not exists \(\s*select 1 from pg_trigger/);
    }
  });

  it("contains no destructive statements (no DROP TABLE / DROP COLUMN / TRUNCATE / DROP ... CASCADE on data)", () => {
    expect(sqlLower).not.toMatch(/drop table/);
    expect(sqlLower).not.toMatch(/drop column/);
    expect(sqlLower).not.toMatch(/truncate/);
    expect(sqlLower).not.toMatch(/alter table[^;]*drop constraint/);
    expect(sqlLower).not.toMatch(/delete from/);
  });
});

/* ============================== (2) baseline covers what the code actually uses ============================== */
describe("baseline migration covers every client-referenced table + the ad-hoc columns", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const norm = (s) => s.toLowerCase().replace(/[ \t]+/g, " ");
  // baseline only — for the baseline-specific assertions below
  const SQL = norm(readFileSync(join(MIGRATIONS_DIR, files.find((f) => /baseline/.test(f))), "utf8"));
  // every migration concatenated — the repo's migrations COLLECTIVELY must cover
  // the schema the code uses (a table added in a later migration counts).
  const ALL_SQL = norm(files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8")).join("\n"));

  // every distinct table name the browser client reads or writes
  const referenced = new Set();
  for (const m of APP_SRC.matchAll(/(?:\bfrom|dbSelect)\(\s*["']([a-z_]+)["']/g)) referenced.add(m[1]);

  it("client code references a non-trivial set of tables", () => {
    expect(referenced.size).toBeGreaterThanOrEqual(15);
  });

  it("every referenced table has a `create table if not exists public.<t>` across the migrations", () => {
    const missing = [...referenced].filter((t) => !ALL_SQL.includes(`create table if not exists public.${t} (`)
      && !ALL_SQL.includes(`create table if not exists public.${t}(`));
    expect(missing).toEqual([]);
  });

  it("the three previously-ad-hoc applications columns are defined AND have explicit ADD COLUMN IF NOT EXISTS catch-up", () => {
    expect(SQL).toMatch(/application_intelligence jsonb/);
    expect(SQL).toMatch(/jd_profile\s+jsonb/);
    expect(SQL).toMatch(/jd_profile_hash\s+text/);
    expect(SQL).toMatch(/alter table public\.applications add column if not exists jd_profile\b/);
    expect(SQL).toMatch(/alter table public\.applications add column if not exists jd_profile_hash\b/);
    expect(SQL).toMatch(/alter table public\.applications add column if not exists application_intelligence\b/);
  });

  it("RLS is explicitly enabled on every referenced table (does not rely on the superuser event trigger)", () => {
    const missing = [...referenced].filter((t) => !ALL_SQL.includes(`alter table public.${t} enable row level security`));
    expect(missing).toEqual([]);
  });

  it("every field analyseAndPlan writes to `applications` exists as a column in the baseline", () => {
    // pull the object literal passed to the REQUIRED (checked) dbUpdateApplication call
    const call = APP_SRC.match(/const appUpdate = await dbUpdateApplication\(applicationId,\s*\{([\s\S]*?)\}\);/);
    expect(call).toBeTruthy();
    const keys = [...call[1].matchAll(/(\w+):/g)].map((m) => m[1]);
    expect(keys).toContain("application_intelligence");
    expect(keys).toContain("jd_profile");
    const appStart = SQL.indexOf("create table if not exists public.applications");
    const appBlock = SQL.slice(appStart, SQL.indexOf(");", appStart));
    for (const k of keys) expect(appBlock).toContain(k.toLowerCase());
  });
});

/* ============================== (3) required-write failure is no longer silent ============================== */
describe("dbUpdateApplication — required persistence failure is visible", () => {
  const FN = APP_SRC.slice(
    APP_SRC.indexOf("async function dbUpdateApplication("),
    APP_SRC.indexOf("async function dbInsertDocument(")
  );

  it("reports success/failure via a { ok } result instead of returning undefined", () => {
    expect(FN).toMatch(/return \{ ok: false/);
    expect(FN).toMatch(/return \{ ok: true/);
  });

  it("still logs the error (resilience preserved for best-effort callers) and names the fields", () => {
    expect(FN).toMatch(/console\.error\("application update failed:"/);
    expect(FN).toMatch(/Object\.keys\(fields/);
  });

  it("is NOT reverted to the old bare swallow", () => {
    // old body was exactly: if (error) console.error("application update failed:", error.message);  then }
    expect(FN).not.toMatch(/if \(error\) console\.error\("application update failed:", error\.message\);\s*\}/);
  });

  it("analyseAndPlan checks the result and aborts loudly when the analysed-role write fails", () => {
    const ap = APP_SRC.slice(APP_SRC.indexOf("ivConfig.question_mix = questionMixSelected"), APP_SRC.indexOf("function beginInterview()"));
    expect(ap).toMatch(/const appUpdate = await dbUpdateApplication\(applicationId,/);
    expect(ap).toMatch(/if \(!appUpdate \|\| !appUpdate\.ok\)\s*\{\s*\n?\s*throw new Error\(/);
    // the checked write is the one carrying jd_profile + application_intelligence
    expect(ap).toMatch(/jd_profile: jdProfile[\s\S]{0,200}application_intelligence: applicationIntelligence[\s\S]{0,200}if \(!appUpdate/);
  });

  it("the two best-effort callers (company/role rename) still ignore the result — no throw introduced there", () => {
    const renames = [...APP_SRC.matchAll(/await dbUpdateApplication\([^,]+,\s*\{ company: cleanCompany, role: cleanRole \}\);/g)];
    expect(renames.length).toBe(2);
  });
});

/* ============================== (4) Application Intelligence persist -> reload lifecycle ============================== */
describe("application_intelligence lifecycle: persist, reload, legacy null", () => {
  const built = buildApplicationIntelligence({
    applicationId: "app-1", company: "JPMorgan", role: "Analyst",
    jdText: "Strong financial modelling and a genuine passion for mergers and acquisitions.",
    interviewProfile: {
      competencies: [{ name: "financial modelling", basis: "explicit" }],
      jd_requirements: [
        { requirement: "strong financial modelling", evidence_quote: "Strong financial modelling", confidence: "explicit", category: "technical_functional" },
      ],
      technical_topics: ["valuation"], behavioural_topics: [], commercial_topics: [],
    },
    aiBlock: {},
  });

  it("a freshly built profile survives a JSONB persist -> reload round trip unchanged", () => {
    // simulate: write JSONB to Postgres, read it back, re-validate on load (App.jsx does exactly this)
    const roundTripped = validateApplicationIntelligence(JSON.parse(JSON.stringify(built)));
    expect(roundTripped).not.toBeNull();
    expect(roundTripped.technicalPriorities.length).toBe(built.technicalPriorities.length);
    expect(roundTripped.technicalPriorities[0].label).toBe(built.technicalPriorities[0].label);
    expect(roundTripped.coverage).toEqual(built.coverage);
    expect(roundTripped.sourceHash).toBe(built.sourceHash);
  });

  it("a legacy application row (column present, value NULL) loads as null, not a crash", () => {
    expect(validateApplicationIntelligence(null)).toBeNull();
    expect(validateApplicationIntelligence(undefined)).toBeNull();
  });

  it("a partially-shaped stored blob (older writer) still validates into a usable object", () => {
    const partial = { technicalPriorities: [{ label: "x", dimension: "technical", importance: "high", confidence: "high", source: "job_description", evidence: "x" }] };
    const v = validateApplicationIntelligence(partial);
    expect(v).not.toBeNull();
    expect(v.technicalPriorities[0].label).toBe("x");
    expect(v.behaviouralPriorities).toEqual([]);
    expect(v.coverage.technical).toBe("none"); // absent coverage clamps, doesn't throw
  });

  it("App.jsx reads the column back through validateApplicationIntelligence on load (persisted, not recomputed)", () => {
    expect(APP_SRC).toMatch(/applicationIntelligence: validateApplicationIntelligence\(a\.application_intelligence\)/);
  });
});
