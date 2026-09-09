/* ================================================================== *
 * EKI² — Performance → intervention workflow wiring (source inspection)
 * ------------------------------------------------------------------
 * The distribution stays aggregate + k-anonymised; the roster is the
 * authorised drill-in; the actions (arrange support / message) reuse the
 * existing appointment + a minimal message model; and the student sees
 * those communications in the normal JOB.READY Careers Support screen,
 * with NO institutional terminology / branding.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), "utf8");
const INTV = read("intervention.jsx");
const API = read("api.js");
const APP = read("InstitutionalApp.jsx");
const STUDENT = readFileSync(join(HERE, "..", "careersAppointments.jsx"), "utf8");
const CORE = readFileSync(join(HERE, "..", "careersAppointmentsCore.js"), "utf8");

describe("intervention.jsx — distribution + roster", () => {
  it("the readiness distribution is one clean segmented bar + three group cards", () => {
    expect(INTV).toMatch(/function ReadinessDistribution/);
    expect(INTV).toMatch(/ii-readbar/);
    expect(INTV).toMatch(/READINESS_GROUPS\.map/);
    expect(INTV).toMatch(/onOpenGroup\(g\.key\)/);
    expect(INTV).toMatch(/\{assessed\} student\{assessed === 1/);   // "N students assessed" line
  });
  it("hides the distribution (k-anonymity) when it is suppressed / no one assessed", () => {
    expect(INTV).toMatch(/dist\.suppressed \|\| !assessed/);
    expect(INTV).toMatch(/Not enough students assessed/);
    expect(INTV).toMatch(/MIN_COHORT_N/);
  });
  it("frames the numbers as practice performance, not an employability prediction", () => {
    expect(INTV).toMatch(/not a prediction of employment outcomes/i);
  });
  it("the roster drills into ONE readiness group and supports selection + open-profile", () => {
    expect(INTV).toMatch(/function RosterPanel/);
    expect(INTV).toMatch(/roster\?\.students \|\| \[\]\)\.filter\(\(s\) => s\.readiness === groupKey\)/);
    expect(INTV).toMatch(/Main development area/);
    expect(INTV).toMatch(/Latest practice/);
    expect(INTV).toMatch(/onOpenStudent\(s\.student_id\)/);
  });
  it("'Arrange support' is one student at a time; 'Message' works for one or many", () => {
    expect(INTV).toMatch(/disabled=\{chosen\.length !== 1\}/);        // arrange -> single
    expect(INTV).toMatch(/disabled=\{!chosen\.length\}/);            // message -> 1+
    expect(INTV).toMatch(/one student at a time/i);
  });
  it("the arrange-support modal invites into an EXISTING open slot the staff member owns", () => {
    expect(INTV).toMatch(/function ArrangeSupportModal/);
    expect(INTV).toMatch(/api\.listMySlots\(ctx\.institutionId, ctx\.userId\)/);
    expect(INTV).toMatch(/api\.inviteToAppointment\(/);
    expect(INTV).toMatch(/Reason for the student \(shown to them\)/);
    expect(INTV).toMatch(/not an adviser note/i);
  });
  it("the message modal never exposes analytics / notes / other students", () => {
    expect(INTV).toMatch(/function MessageStudentsModal/);
    expect(INTV).toMatch(/api\.sendCareersMessage\(/);
    expect(INTV).toMatch(/never see analytics, adviser notes, or other students/i);
  });
});

describe("api.js — new gated RPC wrappers", () => {
  for (const [fn, rpcName] of [
    ["getReadinessRoster", "eki_readiness_roster"],
    ["getStudentSnapshot", "eki_student_snapshot"],
    ["inviteToAppointment", "eki_invite_to_appointment"],
    ["sendCareersMessage", "send_careers_message"],
    ["listStudentMessages", "eki_list_student_messages"],
  ]) {
    it(`${fn} -> ${rpcName}`, () => {
      expect(API).toMatch(new RegExp(`export async function ${fn}`));
      expect(API).toMatch(new RegExp(`rpc\\("${rpcName}"`));
    });
  }
  it("the roster wrapper passes institution + cohort + date-range scope", () => {
    const block = API.slice(API.indexOf("export async function getReadinessRoster"), API.indexOf("export async function getStudentSnapshot"));
    expect(block).toMatch(/p_institution_id: institutionId/);
    expect(block).toMatch(/p_cohort_ids: filters\?\.cohortIds/);
    expect(block).toMatch(/p_from: filters\?\.from/);
    expect(block).toMatch(/p_to: filters\?\.to/);
  });
});

describe("InstitutionalApp — Performance is an intervention workflow", () => {
  it("Performance fetches BOTH the roster and the legacy analytics; distribution is primary", () => {
    const perf = APP.slice(APP.indexOf("function PerformanceView"), APP.indexOf("function StudentCareersProfileView"));
    expect(perf).toMatch(/useSection\(api\.getReadinessRoster, ctx\)/);
    expect(perf).toMatch(/useSection\(api\.getPerformance, ctx\)/);
    expect(perf).toMatch(/<ReadinessDistribution roster=/);
    expect(perf).toMatch(/drill\.mode === "roster"/);
    expect(perf).toMatch(/drill\.mode === "profile"/);
    // the drill-in resets when the scope filter changes (no stale cross-scope students)
    expect(perf).toMatch(/\[ctx\.institutionId, ctx\.filters\]\)/);
  });
  it("the student profile opened from the roster reuses the same profile view (no duplicate model)", () => {
    const prof = APP.slice(APP.indexOf("function StudentCareersProfileView"));
    expect(prof).toMatch(/api\.getStudentSnapshot\(ctx\.institutionId, studentId\)/);
    expect(prof).toMatch(/shapeCareersProfile\(state\.raw\)/);
    expect(prof).toMatch(/<PreviousSupportCard/);
    expect(prof).toMatch(/<CareersJourney/);
    expect(prof).toMatch(/<ArrangeSupportModal/);
    expect(prof).toMatch(/<MessageStudentsModal/);
    // no outcome form / mark-status here — there is no appointment
    expect(prof).not.toMatch(/<OutcomeForm/);
  });
});

describe("student Careers Support becomes the communication hub — JOB.READY branding intact", () => {
  it("loads invitations + messages alongside appointments", () => {
    expect(STUDENT).toMatch(/rpc\("list_my_careers_messages"\)/);
    expect(STUDENT).toMatch(/rpc\("respond_to_appointment_invitation"/);
    expect(STUDENT).toMatch(/rpc\("mark_careers_message_read"/);
  });
  it("shows Action needed / Messages / Upcoming appointments / Previous support", () => {
    expect(STUDENT).toMatch(/Action needed/);
    expect(STUDENT).toMatch(/Messages/);
    expect(STUDENT).toMatch(/Upcoming appointments/);
    expect(STUDENT).toMatch(/Previous support/);
  });
  it("an invitation shows the careers-team reason and Accept / Decline", () => {
    expect(STUDENT).toMatch(/function InvitationCard/);
    expect(STUDENT).toMatch(/Reason from your careers team/);
    expect(STUDENT).toMatch(/onRespond\(a\.id, true\)/);
    expect(STUDENT).toMatch(/onRespond\(a\.id, false\)/);
  });
  it("no institutional / EKI² terminology leaks into the student screen (comments + import paths aside)", () => {
    const code = STUDENT
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/^import .*$/gm, "");
    expect(code).not.toMatch(/EKI²|EKI2|k-anonym|readiness distribution|institutional insights/i);
    // still the student design system, never the institutional one
    expect(code).toMatch(/jr-/);
    expect(code).not.toMatch(/className=["'`{][^"'`]*\bii-/);
  });
  it("the 3-way split + invite/message helpers are pure and covered", () => {
    expect(CORE).toMatch(/const invitations = \[\], upcoming = \[\], past = \[\]/);
    expect(CORE).toMatch(/export function canRespondToInvite/);
    expect(CORE).toMatch(/export function unreadCount/);
  });
});
