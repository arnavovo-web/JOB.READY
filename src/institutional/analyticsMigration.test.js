/* ================================================================== *
 * INSTITUTIONAL ANALYTICS — migration structural regression tests
 * Guards the Milestone 2 analytics engine migration: read-only,
 * staff-gated, k-anonymised, additive, and consistent with the
 * taxonomy the JS layer uses.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MIN_COHORT_N } from "./taxonomy.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "..", "supabase", "migrations");
const FILES = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const FILE = FILES.find((f) => /institutional_analytics/.test(f));
const SQL = FILE ? readFileSync(join(MIGRATIONS_DIR, FILE), "utf8") : "";
const CODE = SQL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const codeLower = CODE.toLowerCase();

const RPCS = [
  "inst_overview", "inst_performance", "inst_competencies", "inst_career_insights",
  "inst_question_performance", "inst_improvement", "inst_development_areas",
];

describe("file presence + ordering", () => {
  it("exists, timestamped, and applies after the foundation migration", () => {
    expect(FILE).toMatch(/^\d{14}_institutional_analytics\.sql$/);
    const foundation = FILES.find((f) => /institutional_foundation/.test(f));
    expect(FILE.slice(0, 14) > foundation.slice(0, 14)).toBe(true);
  });
});

describe("read-only + additive", () => {
  it("performs no writes to any table (SELECT / aggregation only)", () => {
    expect(codeLower).not.toMatch(/\binsert into\b/);
    expect(codeLower).not.toMatch(/\bupdate\s+public\./);
    expect(codeLower).not.toMatch(/\bdelete\s+from\b/);
    expect(codeLower).not.toMatch(/\bdrop table\b/);
    expect(codeLower).not.toMatch(/\btruncate\b/);
    expect(codeLower).not.toMatch(/\bcreate table\b/);
    expect(codeLower).not.toMatch(/\balter table\b/);
  });
  it("only creates or replaces functions", () => {
    const creates = codeLower.match(/create (or replace )?function/g) || [];
    expect(creates.length).toBeGreaterThanOrEqual(RPCS.length + 2);
    expect(creates.every((c) => c === "create or replace function")).toBe(true);
  });
});

describe("every analytics RPC is present, SECURITY DEFINER, search_path-pinned, staff-gated", () => {
  for (const rpc of RPCS) {
    it(`${rpc} — definer, pinned, and enforces access via jr_inst_scope_student_ids`, () => {
      const re = new RegExp(`create or replace function public\\.${rpc}\\(([\\s\\S]*?)\\$\\$;`, "m");
      const m = SQL.match(re);
      expect(m, `${rpc} must be defined`).toBeTruthy();
      const body = m[0];
      expect(body).toMatch(/security definer/i);
      expect(body).toMatch(/set search_path to 'public'/i);
      // the gate: every RPC resolves its student set through the gated helper
      expect(body).toMatch(/jr_inst_scope_student_ids\(p_institution_id/);
      // standard filter signature
      expect(body).toMatch(/p_cohort_ids uuid\[\]/);
      expect(body).toMatch(/p_from timestamptz/);
      expect(body).toMatch(/p_to timestamptz/);
    });
  }
  it("jr_inst_scope_student_ids raises 42501 for a non-staff caller", () => {
    const m = SQL.match(/function public\.jr_inst_scope_student_ids[\s\S]*?\$\$;/);
    expect(m[0]).toMatch(/jr_inst_role\(p_institution_id\) is null/);
    expect(m[0]).toMatch(/raise exception[\s\S]*?42501/);
  });
});

describe("k-anonymity is enforced server-side with a single threshold matching the JS layer", () => {
  it("every RPC declares c_min_n = the app's MIN_COHORT_N", () => {
    const decls = SQL.match(/c_min_n\s+constant\s+int\s*:=\s*(\d+)/g) || [];
    expect(decls.length).toBeGreaterThanOrEqual(RPCS.length);
    for (const d of decls) {
      expect(Number(d.match(/(\d+)/)[1])).toBe(MIN_COHORT_N);
    }
  });
  it("every RPC echoes min_n in its envelope so the client can cross-check", () => {
    for (const rpc of RPCS) {
      const body = SQL.match(new RegExp(`function public\\.${rpc}\\(([\\s\\S]*?)\\$\\$;`))[0];
      expect(body).toMatch(/'min_n',\s*c_min_n/);
    }
  });
  it("suppresses groups below the threshold (a 'suppressed'/below_min_n path in every RPC)", () => {
    for (const rpc of RPCS) {
      const body = SQL.match(new RegExp(`function public\\.${rpc}\\(([\\s\\S]*?)\\$\\$;`))[0];
      expect(body, `${rpc} must have a suppression path`).toMatch(/suppressed|below_min_n|< c_min_n|>= c_min_n/);
    }
  });
});

describe("improvement is aggregated the safe way", () => {
  const body = SQL.match(/function public\.inst_improvement\(([\s\S]*?)\$\$;/)[0];
  it("computes a per-student delta (first vs last) before any cohort figure", () => {
    expect(body).toMatch(/repeat_students/);
    expect(body).toMatch(/cnt >= 2/);
    expect(body).toMatch(/per_student/);
    expect(body).toMatch(/l\.score - f\.score/);
  });
  it("documents the method in the envelope", () => {
    expect(body).toMatch(/'method'/);
    expect(body).toMatch(/never a comparison of two arbitrary interviews/i);
  });
});

describe("taxonomy parity with the JS layer", () => {
  it("jr_canonical_category maps the same legacy values as taxonomy.js", () => {
    const fn = SQL.match(/function public\.jr_canonical_category[\s\S]*?\$\$;/)[0];
    expect(fn).toMatch(/cv_behavioural.*behavioural_competency/s);
    expect(fn).toMatch(/'role_specific','technical'.*technical_functional/s);
    for (const canon of ["motivation_fit", "behavioural_competency", "situational_judgement", "technical_functional", "commercial_awareness", "case_problem_solving"]) {
      expect(fn).toContain(canon);
    }
  });
  it("jr_role_family covers the same family keys as taxonomy.js ROLE_FAMILIES", () => {
    const fn = SQL.match(/function public\.jr_role_family[\s\S]*?\$\$;/)[0];
    for (const key of ["ib", "markets", "pe_pc", "am_wm", "consulting", "swe", "data", "product", "finance_corp", "marketing", "ops_grad", "unclassified"]) {
      expect(fn).toContain(`'${key}'`);
    }
  });
});

describe("grants — authenticated only, helpers not left open", () => {
  it("revokes from public/anon and grants execute to authenticated for the RPCs + helpers", () => {
    expect(codeLower).toMatch(/revoke all on function %s from public, anon/); // the loop form
    expect(codeLower).toMatch(/grant execute on function %s to authenticated/);
    expect(codeLower).toMatch(/revoke all on function public\.jr_canonical_category\(text\)\s+from public, anon/);
    expect(codeLower).toMatch(/revoke all on function public\.jr_role_family\(text, text\)\s+from public, anon/);
  });
});
