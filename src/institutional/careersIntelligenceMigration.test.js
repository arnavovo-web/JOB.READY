/* ================================================================== *
 * EKI² — intelligence-platform migration guards
 * ------------------------------------------------------------------
 * One deterministic engine, no LLM in SQL; k-anonymity on every
 * institutional aggregate (programme pulse included); staff / double
 * gates on every student-level RPC; RLS on every new table; students
 * never write; adviser notes never reachable from a student path.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "..", "supabase", "migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const FILE = FILES.find((f) => /careers_intelligence_platform\.sql$/.test(f));
const SQL = FILE ? readFileSync(join(DIR, FILE), "utf8") : "";
const CODE = SQL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const codeLower = CODE.toLowerCase();
const fn = (name) => {
  const m = SQL.match(new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\$\\$;`));
  return m ? m[0] : "";
};

describe("file + shape", () => {
  it("exists, timestamped after the performance-intervention migration", () => {
    expect(FILE).toMatch(/^\d{14}_careers_intelligence_platform\.sql$/);
    const prev = FILES.filter((f) => /careers_performance_intervention/.test(f)).pop();
    expect(FILE.slice(0, 14) > prev.slice(0, 14)).toBe(true);
  });
  it("contains NO LLM / external HTTP call — every figure is SQL", () => {
    expect(codeLower).not.toMatch(/http|openai|anthropic|api\.anthropic|fetch\(/);
  });
  it("is additive: no student-domain table dropped or truncated", () => {
    expect(codeLower).not.toMatch(/drop table|truncate|delete from public\.(profiles|interviews|evaluations|applications|cohort_members)/);
  });
});

describe("shared deterministic engine", () => {
  it("jr_classify_trajectory is a single IMMUTABLE definition with documented thresholds", () => {
    const b = fn("jr_classify_trajectory");
    expect(b).toMatch(/immutable/i);
    expect(b).toMatch(/'improving'/);
    expect(b).toMatch(/'plateauing'/);
    expect(b).toMatch(/'insufficient_data'/);
    expect(b).toMatch(/\(p_last - p_first\) >= 6/);
  });
  it("the per-student rows helper feeds trajectory + readiness group", () => {
    const b = fn("jr_student_trajectory_rows");
    expect(b).toMatch(/public\.jr_classify_trajectory/);
    expect(b).toMatch(/public\.jr_readiness_group/);
  });
});

describe("eki_student_intelligence — staff workflow, NOT k-anon, no transcript", () => {
  const b = fn("eki_student_intelligence");
  it("staff + scope gated via jr_inst_scope_student_ids (raises 42501 for non-staff)", () => {
    expect(b).toMatch(/jr_inst_scope_student_ids\(p_institution_id, p_cohort_ids\)/);
  });
  it("derives no-contact and stuck from documented deterministic rules", () => {
    expect(b).toMatch(/c_nc_min_interviews constant int := 3/);
    expect(b).toMatch(/c_nc_min_gap constant int := 5/);
    expect(b).toMatch(/c_stuck_eps constant int := 3/);
    expect(b).toMatch(/no_prior_contact/);
    expect(b).toMatch(/is_stuck/);
  });
  it("exposes no transcript / no free-text competency", () => {
    expect(b).not.toMatch(/answer_text|\btranscript\b/i);
    expect(b).not.toMatch(/q\.competency|e\.competency\b/);
  });
});

describe("eki_programme_pulse — programme (cohort) aggregates ARE k-anonymised", () => {
  const b = fn("eki_programme_pulse");
  it("staff-gated for the institution", () => {
    expect(b).toMatch(/jr_inst_role\(p_institution_id\) is null[\s\S]*?42501/);
  });
  it("suppresses any programme with fewer than MIN_COHORT_N (5) assessed students", () => {
    expect(b).toMatch(/c_min_n constant int := 5/);
    expect(b).toMatch(/p\.assessed < c_min_n then jsonb_build_object\([\s\S]*?'suppressed', true/);
  });
  it("also suppresses a per-competency figure below the threshold (n >= c_min_n)", () => {
    expect(b).toMatch(/where dna\.cohort_id = p\.cohort_id and n >= c_min_n/);
  });
});

describe("student-level RPCs are double-gated like the briefing", () => {
  for (const name of ["eki_student_snapshot", "eki_student_careers_profile", "save_development_plan", "save_adviser_briefing"]) {
    it(name, () => {
      const b = fn(name);
      expect(b, `${name} defined`).not.toBe("");
      expect(b).toMatch(/jr_inst_role\(.*\) is null[\s\S]*?42501/);
      expect(b).toMatch(/from public\.cohort_members cm[\s\S]*?42501/);
      expect(b).toMatch(/security definer/i);
      expect(b).toMatch(/set search_path to 'public'/i);
    });
  }
  it("eki_my_development returns ONLY the caller's own data (auth.uid), no institution arg", () => {
    const b = fn("eki_my_development");
    expect(b).toMatch(/uid uuid := \(select auth\.uid\(\)\)/);
    expect(b).toMatch(/dp\.student_id = uid/);
    expect(b).not.toMatch(/p_institution_id/);
  });
});

describe("new tables — RLS complete, students never write, adviser notes staff-only", () => {
  it("development_plans: student reads OWN, staff read institution, NO client write policy", () => {
    expect(codeLower).toMatch(/alter table public\.development_plans\s+enable row level security/);
    expect(SQL).toMatch(/create policy development_plans_student_read on public\.development_plans[\s\S]*?student_id = \(select auth\.uid\(\)\)/);
    expect(SQL).toMatch(/create policy development_plans_staff_read on public\.development_plans[\s\S]*?public\.jr_inst_role/);
    expect(SQL).not.toMatch(/create policy \w+ on public\.development_plans\s+for (all|insert|update|delete)/);
  });
  it("adviser_briefings: staff-only read, NO student policy, NO client write", () => {
    expect(codeLower).toMatch(/alter table public\.adviser_briefings\s+enable row level security/);
    expect(SQL).toMatch(/create policy adviser_briefings_staff_read on public\.adviser_briefings[\s\S]*?public\.jr_inst_role/);
    expect(SQL).not.toMatch(/create policy \w+ on public\.adviser_briefings\s+for (all|insert|update|delete)/);
    expect(SQL).not.toMatch(/create policy \w*student\w* on public\.adviser_briefings/);
  });
  it("resources: readable by global/staff/student-of-institution, managed only by owner/admin", () => {
    expect(SQL).toMatch(/create policy resources_read on public\.resources[\s\S]*?active[\s\S]*?jr_student_institution_ids/);
    expect(SQL).toMatch(/create policy resources_manage on public\.resources[\s\S]*?jr_inst_can_manage/);
  });
});

describe("grants", () => {
  it("every new RPC is revoked from public/anon and granted to authenticated", () => {
    for (const name of [
      "eki_student_intelligence", "eki_programme_pulse", "eki_follow_up_queue",
      "eki_student_snapshot", "eki_my_development", "save_development_plan",
      "mark_follow_up_done", "save_adviser_briefing", "list_resources", "eki_student_careers_profile",
    ]) {
      expect(codeLower).toMatch(new RegExp(`'public\\.${name}\\(`));
    }
    expect(codeLower).toMatch(/revoke all on function %s from public, anon/);
    expect(codeLower).toMatch(/grant execute on function %s to authenticated/);
  });
});
