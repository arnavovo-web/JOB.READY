/* ================================================================== *
 * EKI² — Careers Appointments migration guards
 * Additive, RLS-complete, double-booking-proof; the student-briefing
 * RPC is double-gated and exposes no transcript.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "..", "supabase", "migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const FILE = FILES.find((f) => /careers_appointments\.sql$/.test(f));
const SQL = FILE ? readFileSync(join(DIR, FILE), "utf8") : "";
const CODE = SQL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const codeLower = CODE.toLowerCase();
const fn = (name) => {
  const m = SQL.match(new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\$\\$;`));
  return m ? m[0] : "";
};

const RPCS = [
  "jr_student_institution_ids", "list_appointment_types", "list_careers_availability",
  "list_my_appointments", "list_institution_appointments", "book_appointment",
  "cancel_appointment", "set_appointment_status", "eki_student_briefing",
];

describe("file + ordering", () => {
  it("exists, timestamped, applies after the institutional migrations", () => {
    expect(FILE).toMatch(/^\d{14}_careers_appointments\.sql$/);
    const last = FILES.filter((f) => /institutional_/.test(f)).pop();
    expect(FILE.slice(0, 14) > last.slice(0, 14)).toBe(true);
  });
});

describe("tables — additive, no student table altered", () => {
  it("creates the three appointment tables with IF NOT EXISTS", () => {
    for (const t of ["appointment_types", "appointment_slots", "appointments"]) {
      expect(codeLower).toMatch(new RegExp(`create table if not exists public\\.${t} \\(`));
    }
  });
  it("references existing identities by FK, never duplicates them", () => {
    expect(codeLower).toMatch(/student_id\s+uuid not null references public\.profiles\(id\)/);
    expect(codeLower).toMatch(/application_id\s+uuid references public\.applications\(id\)/);
    expect(codeLower).toMatch(/institution_id\s+uuid not null references public\.institutions\(id\)/);
    expect(codeLower).not.toMatch(/create table[^;]*students\b/);
  });
  it("touches no existing student/institution table with ALTER / DROP / DELETE / UPDATE", () => {
    expect(codeLower).not.toMatch(/alter table public\.(profiles|applications|interviews|interview_reports|evaluations|competency_history|institutions|cohorts|cohort_members|institution_staff)\b/);
    expect(codeLower).not.toMatch(/drop table|truncate|delete from public\.|update public\.(profiles|applications|interviews)/);
  });
});

describe("double-booking is prevented at the database level", () => {
  it("one appointment per slot (slot_id UNIQUE)", () => {
    expect(codeLower).toMatch(/slot_id\s+uuid not null unique references public\.appointment_slots/);
  });
  it("a staff member cannot publish two overlapping open/booked slots (gist exclusion constraint)", () => {
    expect(codeLower).toMatch(/exclude using gist \(staff_id with =, tstzrange\(starts_at, ends_at\) with &&\)/);
    expect(codeLower).toMatch(/where \(status in \('open', 'booked'\)\)/);
  });
  it("book_appointment locks the slot row and re-checks it is open + future before inserting", () => {
    const b = fn("book_appointment");
    expect(b).toMatch(/from public\.appointment_slots where id = p_slot_id for update/);
    expect(b).toMatch(/v_slot\.status <> 'open'[\s\S]*?slot_taken/);
    expect(b).toMatch(/v_slot\.starts_at <= now\(\)[\s\S]*?slot_past/);
  });
});

describe("RLS — students never write; scope is institution-bound", () => {
  it("enables RLS on all three tables", () => {
    for (const t of ["appointment_types", "appointment_slots", "appointments"]) {
      expect(codeLower).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
    }
  });
  it("appointments has SELECT-only policies (student=own, staff=own institution) and NO write policy", () => {
    expect(SQL).toMatch(/create policy appointments_student_read on public\.appointments\s+for select using \(student_id = \(select auth\.uid\(\)\)\)/);
    expect(SQL).toMatch(/create policy appointments_staff_read on public\.appointments\s+for select using \(public\.jr_inst_role\(institution_id\) is not null\)/);
    expect(SQL).not.toMatch(/create policy \w+ on public\.appointments\s+for (all|insert|update|delete)/);
  });
  it("a student only sees OPEN, future slots for institutions they are linked to", () => {
    expect(SQL).toMatch(/create policy appointment_slots_student_read[\s\S]*?status = 'open' and starts_at > now\(\)[\s\S]*?jr_student_institution_ids\(\)/);
  });
  it("every create policy has a matching drop policy if exists", () => {
    for (const m of SQL.matchAll(/create policy (\w+)/g)) {
      expect(SQL).toMatch(new RegExp(`drop policy if exists ${m[1]}\\b`));
    }
  });
});

describe("every RPC is SECURITY DEFINER, search_path-pinned, and self-enforces authorisation", () => {
  for (const name of RPCS) {
    it(`${name}`, () => {
      const body = fn(name);
      expect(body, `${name} must be defined`).not.toBe("");
      expect(body).toMatch(/security definer/i);
      expect(body).toMatch(/set search_path to 'public'/i);
    });
  }
  it("book_appointment verifies the student↔institution link", () => {
    expect(fn("book_appointment")).toMatch(/v_slot\.institution_id in \(select public\.jr_student_institution_ids\(\)\)[\s\S]*?42501/);
  });
  it("book_appointment validates application ownership when one is passed", () => {
    expect(fn("book_appointment")).toMatch(/from public\.applications a where a\.id = p_application_id and a\.user_id = uid[\s\S]*?42501/);
  });
  it("cancel_appointment allows only the booking student or staff of the institution", () => {
    expect(fn("cancel_appointment")).toMatch(/v_ap\.student_id = uid or public\.jr_inst_role\(v_ap\.institution_id\) is not null/);
  });
  it("list_institution_appointments + set_appointment_status raise 42501 for a non-staff caller", () => {
    expect(fn("list_institution_appointments")).toMatch(/jr_inst_role\(p_institution_id\) is null[\s\S]*?42501/);
    expect(fn("set_appointment_status")).toMatch(/jr_inst_role\(v_ap\.institution_id\) is null[\s\S]*?42501/);
  });
});

describe("eki_student_briefing — the sensitive RPC", () => {
  const b = fn("eki_student_briefing");
  it("double-gates: staff of the institution AND the student is a current cohort member of it", () => {
    expect(b).toMatch(/if public\.jr_inst_role\(v_inst\) is null then[\s\S]*?42501/);
    expect(b).toMatch(/from public\.cohort_members cm[\s\S]*?c\.institution_id = v_inst and cm\.student_id = v_student[\s\S]*?42501/);
  });
  it("exposes NO raw answer / transcript", () => {
    expect(b).not.toMatch(/answer_text|answers\.answer|\btranscript\b/i);
  });
  it("scopes every read to the one appointment's student + institution (no cross-institution)", () => {
    expect(b).toMatch(/i\.user_id = v_student and i\.status = 'completed'/);
    expect(b).toMatch(/c\.institution_id = v_inst/);
  });
  it("uses the six controlled evaluation dimensions, not the free-text competency field", () => {
    for (const dim of ["relevance", "specificity", "structure", "evidence", "communication", "competency_demonstration"]) {
      expect(b).toContain(`'${dim}'`);
    }
    expect(b).not.toMatch(/q\.competency|e\.competency\b/);
  });
  it("only makes the 'repeated development area' statement with >= 2 recent interviews of support", () => {
    expect(b).toMatch(/d\.mean < c_target and o\.mean < c_target and d\.n_interviews >= 2/);
  });
});

describe("policy-merge follow-up (perf: one SELECT policy per table)", () => {
  const MERGE_FILE = FILES.find((f) => /careers_appointments_policy_merge\.sql$/.test(f));
  const MERGE = MERGE_FILE ? readFileSync(join(DIR, MERGE_FILE), "utf8") : "";
  it("exists and applies after the base careers migration", () => {
    expect(MERGE_FILE).toMatch(/^\d{14}_careers_appointments_policy_merge\.sql$/);
    expect(MERGE_FILE.slice(0, 14) > FILE.slice(0, 14)).toBe(true);
  });
  it("collapses the two SELECT policies on slots + appointments into one OR'd read policy", () => {
    expect(MERGE).toMatch(/drop policy if exists appointment_slots_staff_read[\s\S]*?drop policy if exists appointment_slots_student_read/);
    expect(MERGE).toMatch(/create policy appointment_slots_read on public\.appointment_slots\s+for select using \(\s*public\.jr_inst_role\(institution_id\) is not null[\s\S]*?jr_student_institution_ids/);
    expect(MERGE).toMatch(/create policy appointments_read on public\.appointments\s+for select using \(\s*student_id = \(select auth\.uid\(\)\)[\s\S]*?jr_inst_role/);
  });
  it("replaces every FOR ALL manage/write policy with command-scoped policies", () => {
    for (const p of ["appointment_types_write", "appointment_slots_manage"]) {
      expect(MERGE).toMatch(new RegExp(`drop policy if exists ${p}\\b`));
    }
    for (const t of ["appointment_types", "appointment_slots"]) {
      for (const cmd of ["insert", "update", "delete"]) {
        expect(MERGE).toMatch(new RegExp(`create policy ${t}_${cmd}[\\s\\S]*?for ${cmd}`));
      }
    }
    const mergeCode = MERGE.replace(/--[^\n]*/g, "");
    expect(mergeCode).not.toMatch(/for all\b/i);
  });
  it("writes still require staff (own slots) or an owner/admin", () => {
    for (const m of MERGE.matchAll(/create policy appointment_slots_(insert|update|delete)([\s\S]*?);/g)) {
      expect(m[0]).toMatch(/jr_inst_role\(institution_id\) is not null/);
      expect(m[0]).toMatch(/staff_id = \(select auth\.uid\(\)\) or public\.jr_inst_can_manage/);
    }
  });
});

describe("grants + seed", () => {
  it("revokes from public/anon and grants execute to authenticated for every RPC", () => {
    for (const name of RPCS) {
      expect(codeLower).toMatch(new RegExp(`'public\\.${name}\\(`));
    }
    expect(codeLower).toMatch(/revoke all on function %s from public, anon/);
    expect(codeLower).toMatch(/grant execute on function %s to authenticated/);
  });
  it("seeds the five global appointment types", () => {
    for (const k of ["interview_prep", "application_review", "cv_review", "career_guidance", "general_support"]) {
      expect(SQL).toContain(`'${k}'`);
    }
    expect(codeLower).toMatch(/insert into public\.appointment_types \(institution_id, key, label[\s\S]*?on conflict do nothing/);
  });
});
