/* ================================================================== *
 * PHASE 36 — OPTIONAL INTERVIEW DATE + DASHBOARD COUNTDOWN
 * ------------------------------------------------------------------
 * SCOPE DECISION (see final report for the full audit): the repository
 * already has a fully-built, tested date/countdown engine from Phase 16A
 * — daysUntil / interviewCountdown / sortApplicationsByUpcoming /
 * partitionApplications / nearestUpcomingApplication (applicationSchedule.js,
 * see applicationSchedule.test.js), a real `applications.interview_date`
 * timestamptz column, and an existing edit form that writes it. What was
 * MISSING was (a) collecting the date at interview-setup time (wizard step
 * 1, alongside company/role) rather than only from the separate
 * Applications-pillar edit form, and (b) the Dashboard actually rendering
 * `nearestUpcomingApp` — it was computed and never used. This phase adds
 * exactly those two things, reusing the existing engine rather than
 * building a second, parallel one on interviews.config (which would have
 * been the more literal reading of the brief, but would directly violate
 * its own "no parallel sources of truth / no duplicate state" rule against
 * the schema that's actually there).
 *
 * The pure countdown MATH (daysUntil/interviewCountdown, including the
 * 1-day/today/past/invalid/DST-safety cases) is already covered in
 * applicationSchedule.test.js and is NOT re-tested here beyond the couple
 * of fixed-date examples the brief explicitly asks for — this file covers
 * what Phase 36 actually adds: the wizard field, its persistence, and the
 * Dashboard's use of the existing selection/wording engine.
 *
 * STRUCTURAL checks use the same source-text-inspection convention as
 * reportUX.test.js / applicationsAndRecommendations.test.js, since App() is
 * a React closure this node-environment test suite can't render directly.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  daysUntil, interviewCountdown, interviewDateToIso, nearestUpcomingApplication, partitionApplications,
} from "./applicationSchedule.js";

const SOURCE = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function slice(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found in App.jsx: ${startMarker}`);
  const end = SOURCE.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`end marker not found in App.jsx: ${endMarker}`);
  return SOURCE.slice(start, end);
}

const WIZARD_STEP_1 = slice('{wizardStep === 1 && (', '{wizardStep === 2 && (');
const CONFIRM_COMPANY_ROLE = slice("async function confirmCompanyRole() {", "async function handleFileUpload(");
const DASHBOARD = slice('{screen === "dashboard" && user && (', '{/* Phase 18: unfinished interviews.');

/* ============================== interviewDateToIso — pure, null-safe ============================== */
describe("interviewDateToIso — the single shared date -> timestamptz conversion", () => {
  it("a valid YYYY-MM-DD is anchored at 12:00Z (never a bare midnight that could shift a day west of UTC)", () => {
    expect(interviewDateToIso("2026-09-11")).toBe("2026-09-11T12:00:00Z");
  });
  it("blank / null / undefined -> null (the field is always optional)", () => {
    expect(interviewDateToIso("")).toBeNull();
    expect(interviewDateToIso(null)).toBeNull();
    expect(interviewDateToIso(undefined)).toBeNull();
  });
  it("malformed input -> null, never throws, never persists a garbage timestamp", () => {
    expect(interviewDateToIso("not-a-date")).toBeNull();
    expect(interviewDateToIso("2026-9-1")).toBeNull();
    expect(interviewDateToIso(12345)).toBeNull();
    expect(() => interviewDateToIso({})).not.toThrow();
  });
});

/* ============================== FEATURE 1 — the field itself ============================== */
describe("wizard step 1 — 'Interview date (Optional)' field", () => {
  it("exists as a real date input, labelled and helped, next to company/role", () => {
    expect(WIZARD_STEP_1).toMatch(/<input id="wizard-interview-date" type="date" value=\{interviewDateInput\}/);
    expect(WIZARD_STEP_1).toMatch(/Interview date <span[^>]*>\(Optional\)<\/span>/);
    expect(WIZARD_STEP_1).toContain("Add your interview date to track how long you have to prepare.");
  });

  it("is never required — the Continue button's disabled condition does not reference it", () => {
    const continueBtn = WIZARD_STEP_1.match(/disabled=\{!company \|\| !role\}/);
    expect(continueBtn).toBeTruthy();
    expect(WIZARD_STEP_1).not.toMatch(/disabled=\{[^}]*interviewDateInput[^}]*\}/);
  });

  it("shows no validation error for a blank date", () => {
    // the only message conditioned on interviewDateInput is the past-date advisory, which is
    // itself gated on a truthy (non-blank) value first
    expect(WIZARD_STEP_1).toMatch(/\{interviewDateInput && daysUntil\(interviewDateInput\) < 0 && \(/);
  });

  it("a past date shows a soft, non-blocking advisory (not an elaborate validation system)", () => {
    expect(WIZARD_STEP_1).toContain("Please select today or a future date.");
    // the advisory is a <p role="status">, not wired to any disabled= condition anywhere in step 1
    expect(WIZARD_STEP_1).toMatch(/role="status"[^>]*>Please select today or a future date\.<\/p>/);
  });
});

/* ============================== PERSISTENCE ============================== */
describe("confirmCompanyRole persists the date onto applications.interview_date", () => {
  it("both create and update branches pass interview_date through via the shared helper", () => {
    expect(CONFIRM_COMPANY_ROLE).toMatch(/const interviewDateIso = interviewDateToIso\(interviewDateInput\);/);
    expect(CONFIRM_COMPANY_ROLE).toMatch(/dbCreateApplication\(user\.id, \{[^}]*interview_date: interviewDateIso/);
    expect(CONFIRM_COMPANY_ROLE).toMatch(/dbUpdateApplication\(applicationId, \{[^}]*interview_date: interviewDateIso/);
  });

  it("local applications state is updated in both branches too — survives the SAME session's dashboard/history without a reload", () => {
    expect(CONFIRM_COMPANY_ROLE).toMatch(/setApplications\(\[\{ id: app\.id[^}]*interviewDate: interviewDateIso \}, \.\.\.applications\]\)/);
    expect(CONFIRM_COMPANY_ROLE).toMatch(/a\.id === applicationId \? \{ \.\.\.a, company: cleanCompany, role: cleanRole, interviewDate: interviewDateIso \}/);
  });

  it("a blank date never creates a broken value — interviewDateIso is null, not '' or 'undefined'", () => {
    expect(interviewDateToIso("")).toBeNull();
  });

  it("does not touch interviews.config or dbCreateInterview — the date lives on the application, not a second/parallel per-interview field", () => {
    const dbCreateInterviewFn = slice("async function dbCreateInterview(", "async function dbInsertQuestion(");
    expect(dbCreateInterviewFn).not.toMatch(/interview_date/);
  });

  it("saveApplicationForm (the pre-existing Applications-pillar edit form) uses the SAME shared helper — one source of truth for the conversion, not a duplicate", () => {
    const fnStart = SOURCE.indexOf("async function saveApplicationForm() {");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = SOURCE.indexOf("\n  }\n", fnStart) + 5;
    const fn = SOURCE.slice(fnStart, fnEnd);
    expect(fn).toMatch(/const dateIso = interviewDateToIso\(f\.date\);/);
  });
});

/* ============================== COUNTDOWN CALCULATION — fixed-date examples ============================== */
describe("countdown calculation — deterministic, injected fixed 'today' (no real system clock)", () => {
  const TODAY = new Date("2026-09-01T10:00:00Z");

  it("the brief's own worked example: today 2026-09-01, interview 2026-09-11 -> 10 days", () => {
    expect(daysUntil("2026-09-11", TODAY)).toBe(10);
    expect(interviewCountdown("2026-09-11", TODAY)).toMatchObject({ status: "upcoming", days: 10, label: "Interview in 10 days", isUpcoming: true });
  });
  it("a future date", () => {
    expect(interviewCountdown("2026-09-04", TODAY)).toMatchObject({ status: "soon", days: 3, isUpcoming: true });
  });
  it("exactly 1 day away — singular wording", () => {
    expect(interviewCountdown("2026-09-02", TODAY)).toMatchObject({ status: "tomorrow", days: 1, label: "Interview tomorrow" });
    expect(interviewCountdown("2026-09-02", TODAY).label).not.toMatch(/1 days/);
  });
  it("today — never '0 days to go'", () => {
    const c = interviewCountdown("2026-09-01", TODAY);
    expect(c).toMatchObject({ status: "today", days: 0, isUpcoming: true });
    expect(c.label).not.toMatch(/0 days/);
  });
  it("a past date — not shown as upcoming, never a negative day count in the wording", () => {
    const c = interviewCountdown("2026-08-29", TODAY);
    expect(c.status).toBe("past");
    expect(c.isUpcoming).toBe(false);
    expect(c.label).not.toMatch(/-\d/);
  });
  it("invalid / empty date -> 'none', never throws", () => {
    expect(interviewCountdown("", TODAY)).toMatchObject({ status: "none", isUpcoming: false });
    expect(interviewCountdown("not-a-real-date", TODAY)).toMatchObject({ status: "none", isUpcoming: false });
    expect(interviewCountdown(undefined, TODAY)).toMatchObject({ status: "none", isUpcoming: false });
  });
  it("across a real DST boundary (UK clocks change 2026-10-25) — still a clean calendar-day integer, not a fractional/off-by-one from the clock shift", () => {
    // daysUntil operates purely on calendar Y/M/D components (see applicationSchedule.js), never
    // on a raw millisecond delta — so this holds regardless of which timezone the test runner is
    // actually in, which is the whole point of Part 5's "calendar-day, not raw ms" rule.
    const beforeChange = new Date("2026-10-20T10:00:00Z");
    expect(daysUntil("2026-10-27", beforeChange)).toBe(7);
    expect(Number.isInteger(daysUntil("2026-10-27", beforeChange))).toBe(true);
  });
});

/* ============================== MULTIPLE INTERVIEWS — nearest upcoming wins ============================== */
describe("multiple applications — the Dashboard shows the nearest upcoming one", () => {
  // Same shape as `applicationsWithInterviews` — id/company/role/interviewDate is all
  // nearestUpcomingApplication actually reads.
  const NOW = new Date("2026-09-01T10:00:00Z");
  const iso = (d) => `${d}T12:00:00Z`;

  it("the brief's own worked example: A 15 days away, B 3 days away, C no date -> B wins", () => {
    const apps = [
      { id: "a", company: "Interview A Co", role: "Analyst", interviewDate: iso("2026-09-16") }, // 15 days
      { id: "b", company: "Interview B Co", role: "Analyst", interviewDate: iso("2026-09-04") }, // 3 days
      { id: "c", company: "Interview C Co", role: "Analyst", interviewDate: null },
    ];
    const nearest = nearestUpcomingApplication(apps, NOW);
    expect(nearest.id).toBe("b");
  });

  it("interviews with no date are ignored", () => {
    const apps = [{ id: "x", company: "X", role: "Y", interviewDate: null }];
    expect(nearestUpcomingApplication(apps, NOW)).toBeNull();
  });

  it("interviews with a past date are ignored", () => {
    const apps = [{ id: "x", company: "X", role: "Y", interviewDate: iso("2026-08-01") }];
    expect(nearestUpcomingApplication(apps, NOW)).toBeNull();
  });

  it("today's interview counts as upcoming and can win", () => {
    const apps = [
      { id: "future", company: "Future Co", role: "Y", interviewDate: iso("2026-09-10") },
      { id: "today", company: "Today Co", role: "Y", interviewDate: iso("2026-09-01") },
    ];
    expect(nearestUpcomingApplication(apps, NOW).id).toBe("today");
  });

  it("a tie on the same nearest date breaks deterministically (application id order), never randomly", () => {
    const apps = [
      { id: "z-app", company: "Z", role: "Y", interviewDate: iso("2026-09-05") },
      { id: "a-app", company: "A", role: "Y", interviewDate: iso("2026-09-05") },
    ];
    const run1 = nearestUpcomingApplication(apps, NOW);
    const run2 = nearestUpcomingApplication(apps.slice().reverse(), NOW);
    expect(run1.id).toBe(run2.id); // same winner regardless of input order
  });
});

/* ============================== NO-DATE DASHBOARD BEHAVIOUR ============================== */
describe("Dashboard renders nothing date-related when there is no upcoming interview date", () => {
  it("nearestUpcomingApplication -> null when no application has ever had a date", () => {
    expect(nearestUpcomingApplication([], new Date())).toBeNull();
    expect(nearestUpcomingApplication(
      [{ id: "a", company: "A", role: "B", interviewDate: null }, { id: "b", company: "C", role: "D", interviewDate: undefined }],
      new Date()
    )).toBeNull();
  });

  it("the Dashboard's countdown card is gated on nearestUpcomingApp — no unconditional card, no 'add a date' prompt", () => {
    expect(DASHBOARD).toMatch(/\{nearestUpcomingApp && \(\(\) => \{/);
    expect(DASHBOARD).not.toMatch(/No interview date/);
    expect(DASHBOARD).not.toMatch(/Add your interview date/);
  });

  it("the card reuses the existing interviewCountdown wording — no second/invented countdown label format", () => {
    expect(DASHBOARD).toMatch(/const cd = interviewCountdown\(nearestUpcomingApp\.interviewDate\);/);
    expect(DASHBOARD).toMatch(/\{cd\.label\}/);
  });
});

/* ============================== NO REGRESSIONS ============================== */
describe("no regressions — Phase 11/31 config fields and the resumable-interview section are untouched", () => {
  it("ivConfig still carries question_mix and technical_difficulty exactly as before", () => {
    expect(SOURCE).toMatch(/ivConfig\.question_mix = questionMixSelected;/);
    expect(SOURCE).toMatch(/ivConfig\.technical_difficulty = resolveTechnicalDifficulty\(technicalDifficulty\);/);
  });
  it("the resumable-interviews Dashboard section (Phase 18) still exists, right after the new countdown card, unmodified", () => {
    const cardIdx = SOURCE.indexOf("{nearestUpcomingApp && (() => {");
    const phase18Idx = SOURCE.indexOf("{/* Phase 18: unfinished interviews.");
    expect(cardIdx).toBeGreaterThan(-1);
    expect(phase18Idx).toBeGreaterThan(cardIdx);
    expect(phase18Idx - cardIdx).toBeLessThan(1200); // adjacent, not accidentally relocated elsewhere
    expect(SOURCE).toContain('{(resumableReady.length > 0 || resumableLegacy.length > 0) && (');
  });
});
