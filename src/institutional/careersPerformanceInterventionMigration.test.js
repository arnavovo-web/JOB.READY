/* ================================================================== *
 * EKI² — Performance → intervention → student communication migration
 * ------------------------------------------------------------------
 * Additive; every new RPC is SECURITY DEFINER + search_path-pinned +
 * self-authorising; the readiness roster is authorised individual
 * identification (staff-gated, institution-scoped) but the AGGREGATE
 * distribution still carries `suppressed` under MIN_COHORT_N; the
 * three information types (analytics / adviser notes / student-facing
 * messages) stay separate; students never write these tables directly.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "..", "supabase", "migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const FILE = FILES.find((f) => /careers_performance_intervention\.sql$/.test(f));
const SQL = FILE ? readFileSync(join(DIR, FILE), "utf8") : "";
const CODE = SQL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const codeLower = CODE.toLowerCase();
const fn = (name) => {
  const m = SQL.match(new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\$\\$;`));
  return m ? m[0] : "";
};

const RPCS = [
  "eki_readiness_roster", "eki_student_snapshot", "eki_invite_to_appointment",
  "respond_to_appointment_invitation", "send_careers_message", "list_my_careers_messages",
  "mark_careers_message_read", "eki_list_student_messages", "list_my_appointments",
  "list_institution_appointments",
];

describe("file + ordering", () => {
  it("exists, timestamped, applies after the relationship-history migration", () => {
    expect(FILE).toMatch(/^\d{14}_careers_performance_intervention\.sql$/);
    const prev = FILES.filter((f) => /careers_relationship_history/.test(f)).pop();
    expect(FILE.slice(0, 14) > prev.slice(0, 14)).toBe(true);
  });
});

describe("additive — no student-domain table dropped/truncated", () => {
  it("only ALTERs public.appointments (adds invite columns + widens the status check)", () => {
    expect(codeLower).toMatch(/alter table public\.appointments\s+add column if not exists invited_by/);
    expect(codeLower).not.toMatch(/drop table|truncate|delete from public\./);
    expect(codeLower).not.toMatch(/alter table public\.(profiles|interviews|evaluations|answers|interview_reports|cohort_members|institution_staff)\b/);
  });
  it("widens the appointments status domain with 'invited' and 'declined' only", () => {
    expect(codeLower).toMatch(/check \(status in \('invited', 'booked', 'cancelled', 'completed', 'no_show', 'declined'\)\)/);
  });
});

describe("careers_messages — student-facing communication, RLS complete, RPC-write-only", () => {
  it("is created IF NOT EXISTS with FKs to existing identities", () => {
    expect(codeLower).toMatch(/create table if not exists public\.careers_messages \(/);
    expect(codeLower).toMatch(/institution_id\s+uuid not null references public\.institutions\(id\)/);
    expect(codeLower).toMatch(/student_id\s+uuid not null references public\.profiles\(id\)/);
    expect(codeLower).toMatch(/sender_staff_id\s+uuid references public\.profiles\(id\)/);
  });
  it("RLS on; student reads ONLY their own; staff read their institution's; NO write policy", () => {
    expect(codeLower).toMatch(/alter table public\.careers_messages\s+enable row level security/);
    expect(SQL).toMatch(/create policy careers_messages_student_read on public\.careers_messages\s+for select using \(student_id = \(select auth\.uid\(\)\)\)/);
    expect(SQL).toMatch(/create policy careers_messages_staff_read on public\.careers_messages\s+for select using \(public\.jr_inst_role\(institution_id\) is not null\)/);
    expect(SQL).not.toMatch(/create policy \w+ on public\.careers_messages\s+for (all|insert|update|delete)/);
  });
  it("every create policy has a matching drop policy if exists", () => {
    for (const m of SQL.matchAll(/create policy (\w+) on public\.careers_messages/g)) {
      expect(SQL).toMatch(new RegExp(`drop policy if exists ${m[1]} on public\\.careers_messages`));
    }
  });
});

describe("every new RPC is SECURITY DEFINER, search_path-pinned, self-authorising", () => {
  for (const name of RPCS) {
    it(name, () => {
      const body = fn(name);
      expect(body, `${name} must be defined`).not.toBe("");
      expect(body).toMatch(/security definer/i);
      expect(body).toMatch(/set search_path to 'public'/i);
    });
  }
});

describe("eki_readiness_roster — authorised individual identification, k-anon on the aggregate", () => {
  const b = fn("eki_readiness_roster");
  it("is staff-gated + scope-gated via jr_inst_scope_student_ids (which raises 42501 for a non-staff caller)", () => {
    expect(b).toMatch(/jr_inst_scope_student_ids\(p_institution_id, p_cohort_ids\)/);
  });
  it("respects the selected cohort(s) + date range", () => {
    expect(b).toMatch(/p_from is null or coalesce\(i\.completed_at, i\.created_at\) >= p_from/);
    expect(b).toMatch(/p_to\s+is null or coalesce\(i\.completed_at, i\.created_at\) <= p_to/);
  });
  it("classifies against the established thresholds (70 / 55), not a new scoring system", () => {
    expect(b).toMatch(/c_target\s+constant int := 70/);
    expect(b).toMatch(/c_support_floor constant int := 55/);
    expect(b).toMatch(/ps\.ms >= c_target then 'ready'/);
    expect(b).toMatch(/ps\.ms >= c_support_floor then 'developing'/);
  });
  it("suppresses the AGGREGATE distribution below MIN_COHORT_N (5) even though the roster is authorised", () => {
    expect(b).toMatch(/c_min_n\s+constant int := 5/);
    expect(b).toMatch(/'suppressed', \(\(select n from assessed\) < c_min_n\)/);
  });
  it("exposes no transcript / no free-text competency", () => {
    expect(b).not.toMatch(/answer_text|\btranscript\b/i);
    expect(b).not.toMatch(/q\.competency|e\.competency\b/);
  });
});

describe("eki_student_snapshot — the profile without an appointment", () => {
  const b = fn("eki_student_snapshot");
  it("double-gates exactly like the briefing (staff of the institution AND a current cohort member)", () => {
    expect(b).toMatch(/if public\.jr_inst_role\(v_inst\) is null then[\s\S]*?42501/);
    expect(b).toMatch(/from public\.cohort_members cm[\s\S]*?c\.institution_id = v_inst and cm\.student_id = v_student[\s\S]*?42501/);
  });
  it("scopes history to this student + institution and exposes no transcript", () => {
    expect(b).toMatch(/ap\.student_id = v_student and ap\.institution_id = v_inst/);
    expect(b).not.toMatch(/answer_text|\btranscript\b/i);
  });
});

describe("staff invite -> student response (into the EXISTING appointment model)", () => {
  it("eki_invite_to_appointment is staff-gated AND double-gates the invited student", () => {
    const b = fn("eki_invite_to_appointment");
    expect(b).toMatch(/jr_inst_role\(v_slot\.institution_id\) is null[\s\S]*?42501/);
    expect(b).toMatch(/from public\.cohort_members cm[\s\S]*?cm\.student_id = p_student_id[\s\S]*?42501/);
    // creates an 'invited' row in appointments, not a second table
    expect(b).toMatch(/insert into public\.appointments \([\s\S]*?'invited', uid, now\(\), nullif\(btrim\(coalesce\(p_message/);
    expect(b).toMatch(/update public\.appointment_slots set status = 'booked'/);
  });
  it("respond_to_appointment_invitation is the student's own, and reopens the slot on decline", () => {
    const b = fn("respond_to_appointment_invitation");
    expect(b).toMatch(/v_ap\.student_id <> uid[\s\S]*?42501/);
    expect(b).toMatch(/v_ap\.status <> 'invited'[\s\S]*?already/);
    expect(b).toMatch(/status = 'declined'[\s\S]*?update public\.appointment_slots\s+set status = case when v_starts > now\(\) then 'open'/);
  });
});

describe("send_careers_message — deliberate, institution-scoped, never adviser notes", () => {
  const b = fn("send_careers_message");
  it("staff-gated AND the recipient must be a current cohort member of that institution", () => {
    expect(b).toMatch(/jr_inst_role\(p_institution_id\) is null[\s\S]*?42501/);
    expect(b).toMatch(/from public\.cohort_members cm[\s\S]*?cm\.student_id = p_student_id[\s\S]*?42501/);
  });
  it("a related appointment, if given, must belong to that student + institution", () => {
    expect(b).toMatch(/a\.id = p_related_appointment_id and a\.student_id = p_student_id and a\.institution_id = p_institution_id[\s\S]*?42501/);
  });
  it("mark_careers_message_read only touches the caller's own message", () => {
    expect(fn("mark_careers_message_read")).toMatch(/v_row\.student_id <> \(select auth\.uid\(\)\)[\s\S]*?42501/);
  });
  it("eki_list_student_messages (staff side) double-gates too", () => {
    const s = fn("eki_list_student_messages");
    expect(s).toMatch(/jr_inst_role\(p_institution_id\) is null[\s\S]*?42501/);
    expect(s).toMatch(/from public\.cohort_members cm[\s\S]*?cm\.student_id = p_student_id[\s\S]*?42501/);
  });
});

describe("student-visible invite context", () => {
  it("list_my_appointments returns the invite reason + who sent it, still the caller's own rows only", () => {
    const b = fn("list_my_appointments");
    expect(b).toMatch(/'invite_message', ap\.invite_message/);
    expect(b).toMatch(/'invited_by_name'/);
    expect(b).toMatch(/where ap\.student_id = \(select auth\.uid\(\)\)/);
  });
});

describe("grants", () => {
  it("revokes from public/anon and grants execute to authenticated for every new RPC", () => {
    for (const name of RPCS) {
      expect(codeLower).toMatch(new RegExp(`'public\\.${name}\\(`));
    }
    expect(codeLower).toMatch(/revoke all on function %s from public, anon/);
    expect(codeLower).toMatch(/grant execute on function %s to authenticated/);
  });
});
