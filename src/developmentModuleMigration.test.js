/* ================================================================== *
 * PHASE 14 — DEVELOPMENT MODULE MIGRATION (schema tracking)
 * ------------------------------------------------------------------
 * A new, repo-tracked, idempotent migration adds the two Phase 14
 * tables. It must not touch the baseline, must keep user/application
 * isolation via RLS, and must be reproducible on a fresh environment.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "..", "supabase", "migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

describe("Phase 14 migration file", () => {
  it("adds a NEW timestamped migration after the baseline (baseline itself unchanged)", () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.some((f) => /baseline_schema\.sql$/.test(f))).toBe(true);
    const devmod = files.find((f) => /development_modules\.sql$/.test(f));
    expect(devmod).toBeTruthy();
    expect(/^\d{14}_/.test(devmod)).toBe(true);
    // sorts strictly after the baseline
    const baseline = files.find((f) => /baseline_schema\.sql$/.test(f));
    expect(devmod > baseline).toBe(true);
  });

  const SQL = readFileSync(join(MIGRATIONS, files.find((f) => /development_modules\.sql$/.test(f))), "utf8").toLowerCase().replace(/[ \t]+/g, " ");

  it("creates both Phase 14 tables, idempotently", () => {
    expect(SQL).toMatch(/create table if not exists public\.development_modules \(/);
    expect(SQL).toMatch(/create table if not exists public\.development_module_progress \(/);
    for (const c of SQL.match(/create table[^(]*/g) || []) expect(c).toMatch(/create table if not exists/);
    for (const c of SQL.match(/create index[^(]*/g) || []) expect(c).toMatch(/create index if not exists/);
  });

  it("has no destructive statements", () => {
    expect(SQL).not.toMatch(/drop table|drop column|truncate|delete from|alter table[^;]*drop constraint/);
  });

  it("binds a module to one classroom_topics row (topic_id UNIQUE) so it inherits per-user + per-application isolation", () => {
    expect(SQL).toMatch(/topic_id uuid not null unique references public\.classroom_topics\(id\) on delete cascade/);
  });

  it("enables RLS and scopes both tables to the owner", () => {
    expect(SQL).toMatch(/alter table public\.development_modules enable row level security/);
    expect(SQL).toMatch(/alter table public\.development_module_progress enable row level security/);
    // module: reachable only through a classroom_topics row the caller owns
    expect(SQL).toMatch(/create policy development_modules_via_topic_owner on public\.development_modules[\s\S]*classroom_topics t[\s\S]*t\.user_id = \(select auth\.uid\(\)\)/);
    // progress: direct user scope
    expect(SQL).toMatch(/create policy development_module_progress_self on public\.development_module_progress[\s\S]*user_id = \(select auth\.uid\(\)\)/);
    for (const m of SQL.matchAll(/create policy (\w+)/g)) expect(SQL).toMatch(new RegExp(`drop policy if exists ${m[1]}\\b`));
  });

  it("progress rows are unique per (module, user) so a retake overwrites rather than duplicates", () => {
    expect(SQL).toMatch(/unique \(module_id, user_id\)/);
  });

  it("dimension is constrained to the three question-type dimensions", () => {
    expect(SQL).toMatch(/dimension text not null default 'behavioural'\s*check \(dimension in \('technical', 'behavioural', 'motivational'\)\)/);
  });
});
