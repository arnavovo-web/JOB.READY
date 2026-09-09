/* ================================================================== *
 * EKI² — Careers Relationship History migration guards
 * appointment_outcomes is staff-only and RPC-write-only; the careers
 * profile is double-gated, chronological, exposes no transcript, and
 * never fabricates a longitudinal claim.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "..", "supabase", "migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const FILE = FILES.find((f) => /careers_relationship_history\.sql$/.test(f));
const SQL = FILE ? readFileSync(join(DIR, FILE), "utf8") : "";
const CODE = SQL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const codeLower = CODE.toLowerCase();
const fn = (name) => {
  const m = SQL.match(new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\$\\$;`));
  return m ? m[0] : "";
};

describe("file + ordering", () => {
  it("exists, timestamped, applies after the appointments migrations", () => {
    expect(FILE).toMatch(/^\d{14}_careers_relationship_history\.sql$/);
    const prev = FILES.filter((f) => /careers_appointments/.test(f)).pop();
    expect(FILE.slice(0, 14) > prev.slice(0, 14)).toBe(true);
  });
});

describe("appointment_outcomes — additive, audited, one per appointment", () => {
  it("creates the table with IF NOT EXISTS and the audit columns", () => {
    expect(codeLower).toMatch(/create table if not exists public\.appointment_outcomes \(/);
    for (const c of ["created_at", "updated_at", "created_by", "updated_by"]) {
      expect(codeLower).toContain(c);
    }
  });
  it("one outcome per appointment (unique appointment_id) referencing existing appointments", () => {
    expect(codeLower).toMatch(/appointment_id\s+uuid not null unique references public\.appointments\(id\) on delete cascade/);
  });
  it("does not create / alter / delete any student-domain table", () => {
    expect(codeLower).not.toMatch(/create table (if not exists )?public\.(students|profiles|applications|interviews|appointments)\b/);
    expect(codeLower).not.toMatch(/alter table public\.(profiles|applications|interviews|appointments|cohort_members)\b/);
    expect(codeLower).not.toMatch(/drop table|truncate|delete from public\./);
  });
});

describe("RLS — adviser notes are staff-only, write only via RPC", () => {
  it("enables RLS and has exactly ONE policy: a staff-only SELECT", () => {
    expect(codeLower).toMatch(/alter table public\.appointment_outcomes enable row level security/);
    const policies = [...SQL.matchAll(/create policy (\w+) on public\.appointment_outcomes\s+for (\w+)/g)];
    expect(policies.length).toBe(1);
    expect(policies[0][2].toLowerCase()).toBe("select");
    expect(SQL).toMatch(/create policy appointment_outcomes_staff_read on public\.appointment_outcomes\s+for select using \(public\.jr_inst_role\(institution_id\) is not null\)/);
  });
  it("has NO student policy and NO insert/update/delete policy", () => {
    expect(SQL).not.toMatch(/create policy \w+ on public\.appointment_outcomes\s+for (all|insert|update|delete)/);
    expect(SQL).not.toMatch(/appointment_outcomes[\s\S]*?student_id = \(select auth\.uid\(\)\)/);
  });
});

describe("save_appointment_outcome — gated upsert, never cross-appointment", () => {
  const b = fn("save_appointment_outcome");
  it("is SECURITY DEFINER, search_path-pinned, staff-gated", () => {
    expect(b).toMatch(/security definer/i);
    expect(b).toMatch(/set search_path to 'public'/i);
    expect(b).toMatch(/jr_inst_role\(v_ap\.institution_id\) is null[\s\S]*?42501/);
  });
  it("keys strictly on the passed appointment (a later appointment can't overwrite an earlier one)", () => {
    expect(b).toMatch(/from public\.appointment_outcomes where appointment_id = p_appointment_id for update/);
    expect(b).toMatch(/insert into public\.appointment_outcomes/);
    expect(b).toMatch(/update public\.appointment_outcomes set[\s\S]*?where appointment_id = p_appointment_id/);
  });
  it("stamps created_by on insert and updated_by on every write", () => {
    expect(b).toMatch(/created_by, updated_by[\s\S]*?uid, uid/);
    expect(b).toMatch(/updated_by\s*=\s*uid,\s*updated_at\s*=\s*now\(\)/);
  });
});

describe("eki_student_careers_profile — the evolved briefing", () => {
  const b = fn("eki_student_careers_profile");
  it("is defined, SECURITY DEFINER, search_path-pinned", () => {
    expect(b).not.toBe("");
    expect(b).toMatch(/security definer/i);
    expect(b).toMatch(/set search_path to 'public'/i);
  });
  it("double-gates exactly like eki_student_briefing", () => {
    expect(b).toMatch(/if public\.jr_inst_role\(v_inst\) is null then[\s\S]*?42501/);
    expect(b).toMatch(/from public\.cohort_members cm[\s\S]*?c\.institution_id = v_inst and cm\.student_id = v_student[\s\S]*?42501/);
  });
  it("scopes history + previous_support to THIS student at THIS institution, and prior to this appointment", () => {
    expect(b).toMatch(/ap\.student_id = v_student and ap\.institution_id = v_inst/);
    expect(b).toMatch(/ap\.id <> p_appointment_id/);
    expect(b).toMatch(/coalesce\(sl\.starts_at, ap\.booked_at\) < coalesce\(v_appt_at, now\(\)\)/);
  });
  it("returns history in reverse-chronological order", () => {
    const histBlock = b.slice(b.indexOf("'history'"), b.indexOf("'longitudinal'"));
    expect(histBlock).toMatch(/jsonb_agg\(/);
    expect(histBlock).toMatch(/order by at desc/);
  });
  it("exposes the current appointment's own outcome for the adviser's form", () => {
    expect(b).toMatch(/'current_outcome',/);
    expect(b).toMatch(/from public\.appointment_outcomes o where o\.appointment_id = p_appointment_id/);
  });
  it("keeps the interview intelligence (6 controlled dimensions), NO transcript", () => {
    for (const d of ["relevance", "specificity", "structure", "evidence", "communication", "competency_demonstration"]) {
      expect(b).toContain(`'${d}'`);
    }
    expect(b).not.toMatch(/answer_text|\btranscript\b/i);
    expect(b).not.toMatch(/jd_profile|application_intelligence/);
  });
  it("longitudinal is factual and only emitted with real support (prior outcome + interviews both sides)", () => {
    // only from a prior appointment that HAS an outcome
    expect(b).toMatch(/prev_with_outcome as \(\s*select[\s\S]*?where \(h\.discussed is not null or h\.actions_agreed is not null or h\.next_steps is not null\)/);
    // require >= 1 interview before AND after
    expect(b).toMatch(/lc\.n_before < 1 or lc\.n_after < 1 then '\[\]'::jsonb/);
    // factual kind name — no causal wording baked into the payload
    expect(b).toMatch(/'kind', 'interview_score_change_after_intervention'/);
    expect(b).not.toMatch(/caused|because of|led to|due to the appointment/i);
  });
});

describe("grants", () => {
  it("both RPCs are revoked from public/anon and granted to authenticated", () => {
    expect(codeLower).toMatch(/'public\.save_appointment_outcome\(uuid,text,text,text,boolean,text\)'/);
    expect(codeLower).toMatch(/'public\.eki_student_careers_profile\(uuid\)'/);
    expect(codeLower).toMatch(/revoke all on function %s from public, anon/);
    expect(codeLower).toMatch(/grant execute on function %s to authenticated/);
  });
});
