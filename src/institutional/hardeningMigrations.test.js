/* ================================================================== *
 * INSTITUTIONAL INSIGHTS — Milestone 4 migration guards
 * The analytics-index and RLS-policy-split migrations: additive,
 * idempotent, non-destructive, and they leave exactly one SELECT
 * policy per institutional table.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "..", "supabase", "migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const read = (frag) => {
  const f = FILES.find((x) => x.includes(frag));
  return { name: f, sql: f ? readFileSync(join(DIR, f), "utf8") : "" };
};
const idx = read("institutional_analytics_indexes");
const split = read("institutional_rls_policy_split");

describe("analytics index migration", () => {
  it("exists and is additive + idempotent", () => {
    expect(idx.name).toMatch(/^\d{14}_institutional_analytics_indexes\.sql$/);
    const code = idx.sql.replace(/--[^\n]*/g, "").toLowerCase();
    for (const c of code.match(/create index[^(]*/g) || []) expect(c).toMatch(/create index if not exists/);
    expect(code).not.toMatch(/drop |alter table|create table|delete from|update /);
  });
  it("indexes the hot analytics join paths on the existing student tables", () => {
    expect(idx.sql).toMatch(/on public\.interviews \(user_id, status, completed_at\)/);
    expect(idx.sql).toMatch(/on public\.competency_history \(user_id, source_type, created_at\)/);
  });
});

describe("RLS policy-split migration", () => {
  const code = split.sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
  const codeLower = code.toLowerCase();

  it("exists, ordered after the analytics migrations, additive + idempotent", () => {
    expect(split.name).toMatch(/^\d{14}_institutional_rls_policy_split\.sql$/);
    const analyticsIdx = FILES.findIndex((f) => f.includes("institutional_analytics_indexes"));
    expect(FILES.indexOf(split.name)).toBeGreaterThan(analyticsIdx);
    for (const c of codeLower.match(/create index[^(]*/g) || []) expect(c).toMatch(/if not exists/);
    expect(codeLower).not.toMatch(/drop table|alter table|truncate|delete from|update public\./);
  });
  it("every `create policy X` has a matching `drop policy if exists X`", () => {
    for (const m of code.matchAll(/create policy (\w+)/g)) {
      expect(code).toMatch(new RegExp(`drop policy if exists ${m[1]}\\b`));
    }
  });
  it("replaces the FOR ALL manage policies with command-scoped write policies (no SELECT overlap)", () => {
    // the old FOR ALL policies are dropped
    for (const p of ["cohorts_manage", "cohort_members_manage", "inst_orgs_manage", "institution_staff_manage"]) {
      expect(code).toMatch(new RegExp(`drop policy if exists ${p}\\b`));
    }
    // and replaced by insert/update/delete only — inspect each statement in isolation
    const stmts = code.split(/;\s*/).map((s) => s.trim().toLowerCase());
    for (const t of ["cohorts", "cohort_members", "inst_orgs", "institution_staff"]) {
      for (const cmd of ["insert", "update", "delete"]) {
        const s = stmts.find((x) => x.startsWith(`create policy ${t}_${cmd}`));
        expect(s, `${t}_${cmd} policy statement`).toBeTruthy();
        expect(s).toMatch(new RegExp(`for ${cmd}\\b`));
        expect(s).not.toMatch(/for (all|select)\b/);
      }
    }
  });
  it("merges cohort_members' two SELECT policies into one OR'd read policy", () => {
    expect(code).toMatch(/drop policy if exists cohort_members_staff_read/);
    expect(code).toMatch(/drop policy if exists cohort_members_student_read_self/);
    expect(code).toMatch(/create policy cohort_members_read[\s\S]*?for select[\s\S]*?student_id = \(select auth\.uid\(\)\)[\s\S]*?or public\.jr_inst_role/);
  });
  it("adds the FK-covering index the advisor flagged", () => {
    expect(codeLower).toMatch(/create index if not exists cohort_members_added_by_idx on public\.cohort_members \(added_by\)/);
  });
  it("writes still require owner/admin — jr_inst_can_manage on every write policy", () => {
    for (const m of code.matchAll(/create policy \w+_(insert|update|delete)([\s\S]*?);/g)) {
      expect(m[0]).toMatch(/jr_inst_can_manage/);
    }
  });
});
