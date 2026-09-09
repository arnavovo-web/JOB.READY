/* ================================================================== *
 * Careers appointments — student-app wiring (source inspection,
 * same convention as the other phase tests).
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(HERE, "App.jsx"), "utf8");
const SCREEN = readFileSync(join(HERE, "careersAppointments.jsx"), "utf8");

describe("student nav + routing", () => {
  it("adds a single 'Careers support' nav link -> screen 'careers', without a router", () => {
    const links = APP.slice(APP.indexOf("const links = user"), APP.indexOf("const links = user") + 500);
    expect(links).toContain('{ label: "Careers support", to: "careers" }');
    // still just a setScreen ternary, no react-router
    expect(links).toMatch(/const links = user\s*\?/);
    expect(APP).not.toMatch(/react-router|useNavigate/);
  });
  it("registers 'careers' in showNav so the app chrome renders", () => {
    const showNav = APP.slice(APP.indexOf("const showNav = ["), APP.indexOf("].includes(screen)"));
    expect(showNav).toMatch(/"careers"/);
  });
  it("renders CareersAppointmentsScreen only for a signed-in user, wired to real state", () => {
    expect(APP).toMatch(/screen === "careers" && user &&/);
    expect(APP).toMatch(/<CareersAppointmentsScreen[\s\S]*?user=\{user\}[\s\S]*?applications=\{applications\}/);
    expect(APP).toMatch(/^import CareersAppointmentsScreen from "\.\/careersAppointments\.jsx";/m);
  });
});

describe("the screen is self-contained and additive", () => {
  it("does not import the 12k-line App.jsx (no circular dependency)", () => {
    expect(SCREEN).not.toMatch(/from ["']\.\/App(\.jsx)?["']/);
  });
  it("talks to Supabase only through the shared browser client + the appointment RPCs", () => {
    expect(SCREEN).toMatch(/from "\.\/institutional\/supabaseClient\.js"/);
    const rpcs = [...SCREEN.matchAll(/rpc\(["'](\w+)["']/g)].map((m) => m[1]);
    const OK = /^(list_appointment_types|list_careers_availability|list_my_appointments|book_appointment|cancel_appointment|list_my_careers_messages|respond_to_appointment_invitation|mark_careers_message_read|eki_my_development)$/;
    for (const r of rpcs) expect(OK.test(r), `unexpected rpc ${r}`).toBe(true);
    // no direct table reads of student data from the student screen
    expect(SCREEN).not.toMatch(/\.from\(["'](interviews|evaluations|answers|interview_reports|profiles)["']\)/);
  });
  it("stores the student's optional comment with the booking (privacy: their words, their choice)", () => {
    expect(SCREEN).toMatch(/Anything the adviser should know\?/);
    expect(SCREEN).toMatch(/bookingArgs\(draft\)/);
    // comment is optional — the guard never requires it
    expect(readFileSync(join(HERE, "careersAppointmentsCore.js"), "utf8"))
      .toMatch(/case "details":[\s\S]*?return \{ ok: true \}/);
  });
  it("surfaces the four booking-confirmation facts + status", () => {
    for (const label of ["Type", "When", "Careers team", "Your note", "Status"]) {
      expect(SCREEN).toContain(`label="${label}"`);
    }
    expect(SCREEN).toMatch(/Appointment booked/);
  });
});

describe("student functionality is untouched elsewhere", () => {
  it("adds exactly one new authed nav destination (careers) and renames nothing", () => {
    const links = APP.slice(APP.indexOf("const links = user"), APP.indexOf("const links = user") + 500);
    for (const keep of ["Dashboard", "Applications", "Classroom", "Assessment Centre", "Progress"]) {
      expect(links).toContain(`label: "${keep}"`);
    }
  });
});
