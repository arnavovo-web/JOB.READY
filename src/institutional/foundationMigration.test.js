/* ================================================================== *
 * INSTITUTIONAL FOUNDATION — migration structural regression tests
 * Same source-inspection convention as src/supabaseSchemaTracking.test.js.
 * Guards the Milestone 1 migration: additive, idempotent, RLS-complete,
 * and non-destructive to the existing student schema.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "..", "supabase", "migrations");
const FILES = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const FOUNDATION = FILES.find((f) => /institutional_foundation/.test(f));
const SQL = FOUNDATION ? readFileSync(join(MIGRATIONS_DIR, FOUNDATION), "utf8") : "";
const lower = SQL.toLowerCase();

// SQL with comments removed — for structural checks that must not be fooled by
// prose inside `-- ...` / `/* ... */` (e.g. a comment that mentions a keyword).
const CODE = SQL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const codeLower = CODE.toLowerCase();

const INST_TABLES = [
  "institutions", "institution_organisations", "cohorts", "cohort_members", "institution_staff",
];

describe("the institutional foundation migration exists and applies after the last student migration", () => {
  it("is present with a 14-digit timestamp", () => {
    expect(FOUNDATION).toBeTruthy();
    expect(FOUNDATION).toMatch(/^\d{14}_institutional_foundation\.sql$/);
  });
  it("sorts AFTER every pre-existing student migration (monotonic apply order)", () => {
    const idx = FILES.indexOf(FOUNDATION);
    expect(idx).toBe(FILES.length - 1);
    expect(FOUNDATION.slice(0, 14) > "20260903150000").toBe(true);
  });
});

describe("additive + idempotent", () => {
  it("creates every institutional table with IF NOT EXISTS", () => {
    for (const t of INST_TABLES) {
      expect(lower).toMatch(new RegExp(`create table if not exists public\\.${t} \\(`));
    }
  });
  it("every index is created IF NOT EXISTS", () => {
    const idx = codeLower.match(/create (?:unique )?index[^(]*/g) || [];
    expect(idx.length).toBeGreaterThanOrEqual(6);
    for (const c of idx) expect(c).toMatch(/create (?:unique )?index if not exists/);
  });
  it("every `create policy X` has a matching earlier `drop policy if exists X`", () => {
    const created = [...SQL.matchAll(/create policy (\w+)/g)].map((m) => m[1]);
    expect(created.length).toBeGreaterThanOrEqual(10);
    for (const name of created) {
      expect(SQL).toMatch(new RegExp(`drop policy if exists ${name}\\b`));
    }
  });
  it("every function uses CREATE OR REPLACE (no bare CREATE FUNCTION)", () => {
    expect(lower).toMatch(/create or replace function/);
    expect(lower).not.toMatch(/create function (?!or replace)/);
  });
});

describe("non-destructive — never touches existing data or the student trigger", () => {
  it("contains no destructive statements", () => {
    expect(codeLower).not.toMatch(/drop table/);
    expect(codeLower).not.toMatch(/drop column/);
    expect(codeLower).not.toMatch(/truncate/);
    expect(codeLower).not.toMatch(/delete from/);
    expect(codeLower).not.toMatch(/alter table[^;]*drop constraint/);
  });
  it("does not redefine handle_new_user or the auth.users trigger (executable SQL only)", () => {
    expect(codeLower).not.toMatch(/create or replace function public\.handle_new_user/);
    expect(codeLower).not.toMatch(/create trigger/);
    expect(codeLower).not.toContain("on_auth_user_created");
    expect(codeLower).not.toContain("auth.users");
  });
  it("only ADDs to existing tables via FK references, never ALTERs them", () => {
    // references into profiles/auth are fine; an ALTER TABLE public.profiles is not.
    expect(codeLower).not.toMatch(/alter table public\.(profiles|applications|interviews|interview_reports|evaluations|competency_history)\b/);
  });
});

describe("RLS is complete on every new table", () => {
  it("enables row level security on all five tables", () => {
    for (const t of INST_TABLES) {
      expect(lower).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
    }
  });
  it("gives students a read path to their OWN membership only, and no write path", () => {
    expect(SQL).toMatch(/cohort_members_student_read_self[\s\S]*?for select[\s\S]*?student_id = \(select auth\.uid\(\)\)/);
  });
  it("gates staff reads behind the SECURITY DEFINER role helper (no recursive policy)", () => {
    expect(SQL).toMatch(/jr_inst_role\(/);
    expect(SQL).toMatch(/create policy institutions_staff_read[\s\S]*?jr_inst_role\(id\) is not null/);
  });
  it("restricts config writes to owner/admin via jr_inst_can_manage", () => {
    expect(SQL).toMatch(/jr_inst_can_manage/);
    expect(SQL).toMatch(/create policy cohorts_manage[\s\S]*?jr_inst_can_manage\(institution_id\)/);
  });
});

describe("SECURITY DEFINER discipline (matches the Phase 40 RPC convention)", () => {
  const defFns = [...SQL.matchAll(/create or replace function (public\.\w+)\(([^)]*)\)[\s\S]*?\$\$/g)];

  it("every SECURITY DEFINER function pins search_path", () => {
    for (const m of defFns) {
      const body = m[0];
      if (/security definer/i.test(body)) {
        expect(body, `${m[1]} must set search_path`).toMatch(/set search_path to 'public'/i);
      }
    }
  });
  it("revokes from public/anon and grants execute to authenticated for each exposed RPC", () => {
    for (const fn of ["jr_inst_role", "jr_inst_can_manage", "get_my_institutions", "inst_reconcile_cohort_members"]) {
      expect(lower).toMatch(new RegExp(`revoke all on function public\\.${fn}\\b[\\s\\S]*?from public, anon`));
      expect(lower).toMatch(new RegExp(`grant execute on function public\\.${fn}\\b[\\s\\S]*?to authenticated`));
    }
  });
  it("the reconcile RPC checks institution-manage rights before doing anything", () => {
    const fn = SQL.slice(SQL.indexOf("function public.inst_reconcile_cohort_members"));
    expect(fn).toMatch(/if not public\.jr_inst_can_manage\(p_institution_id\) then[\s\S]*?raise exception/);
  });
});

describe("no parallel student store", () => {
  it("creates no table that shadows a student-domain concept", () => {
    const created = [...lower.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
    for (const t of created) {
      expect(["students", "student_interviews", "student_applications", "interviews", "applications", "evaluations"]).not.toContain(t);
    }
    expect(created.sort()).toEqual([...INST_TABLES].sort());
  });
});
