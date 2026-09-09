/* ================================================================== *
 * INSTITUTIONAL INSIGHTS — app-structure regression tests
 * Source-inspection (no DOM render), same convention as the student
 * suite. Guards: the /institutional route gate, the six dashboard
 * sections, the auth gate, k-anonymity plumbing, design isolation
 * from the student App.jsx, and the CSS discipline the student
 * App.cssUtilities guard enforces (applied here to theme.js).
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), "utf8");

const MAIN = readFileSync(join(HERE, "..", "main.jsx"), "utf8");
const APP = read("InstitutionalApp.jsx");
const THEME = read("theme.js");
const API = read("api.js");
const CLIENT = read("supabaseClient.js");

describe("route gate — /institutional is a separate tree", () => {
  it("src/main.jsx path-gates on /institutional", () => {
    expect(MAIN).toMatch(/\/institutional/);
    expect(MAIN).toMatch(/location\.pathname/);
  });
  it("keeps the student App as a plain static import (unchanged startup)", () => {
    expect(MAIN).toMatch(/^import App from "\.\/App\.jsx";/m);
  });
  it("code-splits the institutional tree via lazy()", () => {
    expect(MAIN).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/institutional\/InstitutionalApp\.jsx"\)\)/);
  });
});

describe("design + code isolation from the student monolith", () => {
  it("no institutional module imports from ../App.jsx", () => {
    for (const [name, src] of Object.entries({ APP, THEME, API, CLIENT })) {
      expect(src, `${name} must not import the student App.jsx`).not.toMatch(/from ["']\.\.\/App(\.jsx)?["']/);
    }
  });
  it("institutional CSS lives under its own .ii- namespace, not .jr-", () => {
    const classes = [...THEME.matchAll(/\.([a-zA-Z][\w-]*)\s*\{/g)].map((m) => m[1]);
    expect(classes.length).toBeGreaterThan(20);
    expect(classes.every((c) => c.startsWith("ii-"))).toBe(true);
  });
  it("theme.js declaration values contain no literal '}' (same guard as the student TOKENS)", () => {
    const cssStart = THEME.indexOf("`");
    const cssEnd = THEME.lastIndexOf("`");
    const css = THEME.slice(cssStart + 1, cssEnd);
    // strip /* */ comments first (a browser would)
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const decl of noComments.matchAll(/\{([^{}]*)\}/g)) {
      expect(decl[1]).not.toContain("}");
    }
  });
  it("every static className token in the institutional JSX has a rule in theme.js", () => {
    const css = THEME.slice(THEME.indexOf("`") + 1, THEME.lastIndexOf("`")).replace(/\/\*[\s\S]*?\*\//g, "");
    const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)\s*\{/g)].map((m) => m[1]));
    const sources = ["InstitutionalApp.jsx", "ui.jsx", "charts.jsx"].map((f) => read(f)).join("\n");
    const used = new Set();
    // className="a b c"  and  className={"a b c"}
    for (const m of sources.matchAll(/className=(?:"([^"]*)"|\{"([^"]*)"\})/g)) {
      for (const tok of (m[1] || m[2] || "").split(/\s+/)) if (tok.startsWith("ii-")) used.add(tok);
    }
    // literal segments of className={`ii-x ii-y ${expr}-suffix ...`} — a token
    // ending in "-" is a dynamic-class PREFIX (e.g. `ii-finding-${severity}`), not a real class
    for (const m of sources.matchAll(/className=\{`([^`]*)`\}/g)) {
      for (const seg of m[1].split(/\$\{[^}]*\}/)) {
        for (const tok of seg.split(/\s+/)) if (tok.startsWith("ii-") && !tok.endsWith("-")) used.add(tok);
      }
    }
    const missing = [...used].filter((c) => !defined.has(c)).sort();
    expect(missing).toEqual([]);
  });
});

describe("dashboard shell — the six insight sections + setup", () => {
  const SECTIONS = ["overview", "performance", "competencies", "career", "development", "improvement", "cohorts"];
  it("declares a NAV entry for every section", () => {
    for (const key of SECTIONS) {
      expect(APP).toMatch(new RegExp(`key:\\s*"${key}"`));
    }
  });
  it("labels the insight sections with the product's own vocabulary", () => {
    for (const label of ["Overview", "Performance", "Competencies", "Career Insights", "Development Areas", "Improvement", "Cohorts & students"]) {
      expect(APP).toContain(label);
    }
  });
  it("frames the hero question around employability, not usage", () => {
    expect(APP).toMatch(/how prepared are/i);
    // the Overview leads with careers-team language, not a usage stat strip
    expect(APP).toMatch(/overviewCards\(data, insights\)/);
    expect(APP).toMatch(/<OverviewCard /);
  });
  it("each section view fetches a real inst_* RPC via api (no hard-coded numbers)", () => {
    for (const [view, fn] of [
      ["PerformanceView", "getPerformance"], ["CompetenciesView", "getCompetencies"],
      ["CareerView", "getCareerInsights"], ["DevelopmentView", "getDevelopmentAreas"],
      ["ImprovementView", "getImprovement"],
    ]) {
      expect(APP, `${view} must exist`).toMatch(new RegExp(`function ${view}\\(`));
      expect(APP, `${view} must call api.${fn}`).toMatch(new RegExp(`useSection\\(api\\.${fn},`));
    }
    // Overview synthesises across every section
    expect(APP).toMatch(/useAllSections\(ctx\)/);
    expect(APP).toMatch(/getAllAnalytics/);
  });
  it("renders derived findings, not just raw metrics, in every analytics view", () => {
    for (const d of [
      "derivePerformanceFindings", "deriveCompetencyFindings",
      "deriveCareerFindings", "deriveQuestionFindings", "deriveImprovementFindings", "deriveDevelopmentFindings",
    ]) {
      expect(APP).toContain(d);
    }
    // the UX pass presents findings as human insight, not a raw chart-first list
    expect(APP).toMatch(/humanize\(/);
    expect(APP).toMatch(/<InsightLayout|<InsightPanel/);
    expect(APP).toMatch(/suggestedAction\(/);
  });
  it("shows k-anonymity states honestly — never a fabricated value where a group is suppressed", () => {
    expect(APP).toMatch(/isLive\(/);
    expect(APP).toMatch(/<NoData/);
    // the actual suppression rendering lives in charts.jsx (Suppressed / SuppressedBlock)
    expect(read("charts.jsx")).toMatch(/SuppressedBlock|Suppressed/);
    expect(read("charts.jsx")).toMatch(/fewer than \{min \|\| 5\}/);
  });
  it("Performance leads with the readiness distribution, not a single cohort-wide verdict", () => {
    // primary question is the distribution one
    expect(APP).toMatch(/Where are our students in their interview readiness\?/);
    expect(APP).toMatch(/getReadinessRoster/);
    expect(APP).toMatch(/<ReadinessDistribution/);
    // the old detailed analytics move behind progressive disclosure
    expect(APP).toMatch(/<Disclosure summary="Show the evidence">/);
    // drill-in: group -> roster -> student profile
    expect(APP).toMatch(/<RosterPanel/);
    expect(APP).toMatch(/<StudentCareersProfileView/);
    expect(APP).toMatch(/getStudentSnapshot/);
  });
});

describe("auth gate", () => {
  it("has a distinct no-access state for a valid account with no institution", () => {
    expect(APP).toMatch(/no-access/);
    expect(APP).toMatch(/No workspace linked/);
    expect(APP).toMatch(/getMyInstitutions/);
  });
  it("presents the EKI² brand on the sign-in / no-access screens", () => {
    expect(APP).toContain("EKI_FULL_NAME");
    expect(APP).toContain("EKI_SHORT");
    expect(APP).toMatch(/Employability Knowledge Intelligence Interface/);
    expect(APP).toMatch(/AuthBrandPanel/);
  });
  it("signs in with password against the shared Supabase auth", () => {
    expect(CLIENT).toMatch(/signInWithPassword/);
    expect(APP).toMatch(/signInWithPassword/);
  });
});

describe("k-anonymity is plumbed through the UI", () => {
  it("imports and references MIN_COHORT_N rather than a bare literal", () => {
    expect(APP).toMatch(/MIN_COHORT_N/);
    expect(read("ui.jsx")).toMatch(/Suppressed|AnonNote/);
  });
  it("every analytics RPC arg set is institution + cohort + date-range scoped", () => {
    expect(API).toMatch(/p_institution_id: institutionId/);
    expect(API).toMatch(/p_cohort_ids: filters\?\.cohortIds/);
    expect(API).toMatch(/p_from: filters\?\.from/);
    expect(API).toMatch(/p_to: filters\?\.to/);
  });
  it("api.js degrades a missing Milestone 2 function to an 'unsupported' envelope, not a crash", () => {
    expect(API).toMatch(/analytics_engine_pending/);
    expect(API).toMatch(/could not find the function|does not exist|schema cache/i);
  });
});

describe("no parallel student store in the data layer", () => {
  it("api.js only writes institutional / appointment config tables, and reaches student data only via gated RPCs", () => {
    const fromCalls = [...API.matchAll(/\.from\(["'](\w+)["']\)/g)].map((m) => m[1]);
    const allowed = new Set([
      "institutions", "institution_organisations", "cohorts", "cohort_members", "institution_staff",
      "appointment_slots", // careers availability — RLS: staff, own slots
    ]);
    for (const t of fromCalls) expect(allowed.has(t), `unexpected table write: ${t}`).toBe(true);
    // every RPC is a SECURITY DEFINER function that self-enforces institution-staff /
    // student-link authorisation — never a raw student table read from the client.
    const rpcs = [...API.matchAll(/\brpc\(["'](\w+)["']/g)].map((m) => m[1]);
    const RPC_OK = /^(inst_.+|get_my_institutions|jr_inst_.+|inst_reconcile_cohort_members|list_institution_appointments|eki_student_briefing|eki_student_careers_profile|eki_student_snapshot|eki_readiness_roster|eki_list_student_messages|eki_invite_to_appointment|send_careers_message|save_appointment_outcome|set_appointment_status|list_appointment_types)$/;
    for (const r of rpcs) expect(RPC_OK.test(r), `unexpected rpc: ${r}`).toBe(true);
  });
  it("the appointment RPCs the client calls are the authorised set (no direct student-table reads)", () => {
    for (const fn of ["list_institution_appointments", "eki_student_briefing", "set_appointment_status"]) {
      expect(API).toContain(fn);
    }
    // the eki_student_briefing SQL double-gates: staff of the institution AND the
    // student is a current cohort member of it
    const MIG = readFileSync(join(HERE, "..", "..", "supabase", "migrations",
      readdirSync(join(HERE, "..", "..", "supabase", "migrations")).find((f) => /careers_appointments\.sql$/.test(f))), "utf8");
    const briefing = MIG.slice(MIG.indexOf("function public.eki_student_briefing"));
    expect(briefing).toMatch(/jr_inst_role\(v_inst\) is null/);
    expect(briefing).toMatch(/cohort_members cm[\s\S]*?student_id = v_student/);
    expect(briefing).not.toMatch(/answer_text|transcript/i);
  });
});

describe("Student Careers Profile (relationship history)", () => {
  it("the appointment detail loads the full careers profile, not just the briefing", () => {
    expect(APP).toMatch(/api\.getStudentCareersProfile\(appointmentId\)/);
    expect(APP).toMatch(/shapeCareersProfile\(state\.raw\)/);
    expect(APP).toMatch(/eyebrow="Student careers profile"/);
  });
  it("renders the previous-support context, longitudinal statements, an editable outcome form and the careers journey", () => {
    for (const cmp of ["<PreviousSupportCard", "<CareersJourney", "<OutcomeForm"]) {
      expect(APP).toContain(cmp);
    }
    expect(APP).toMatch(/longitudinalStatement/);
    expect(APP).toMatch(/No previous careers appointments/);
    expect(APP).toMatch(/not a causal claim/);
  });
  it("orders the profile adviser-first: why they're here, what to focus on, then interview detail lower", () => {
    const iWhy = APP.indexOf("Why they're here");
    const iFocus = APP.indexOf("What to focus on");
    const iPerf = APP.indexOf("Interview performance</SectionTitle>");
    expect(iWhy).toBeGreaterThan(0);
    expect(iFocus).toBeGreaterThan(iWhy);
    expect(iPerf).toBeGreaterThan(iFocus);
    // the competency detail is behind progressive disclosure, not shown by default
    expect(APP).toMatch(/Show the competency detail/);
  });
  it("the outcome form captures the required fields and saves via the RPC", () => {
    for (const f of ["What was discussed", "Actions agreed", "Recommended next steps", "Follow-up required"]) {
      expect(APP).toContain(f);
    }
    expect(APP).toMatch(/api\.saveAppointmentOutcome\(outcomeFormToRpcArgs\(appointmentId, v\)\)/);
    expect(APP).toMatch(/the student cannot see this/);
  });
  it("the careers journey is one continuous, scannable record with collapsible entries", () => {
    expect(APP).toMatch(/function CareersJourney/);
    // sorted oldest -> newest so it reads as a journey
    expect(APP).toMatch(/sort\(\(a, b\) => String\(a\.startsAt\)\.localeCompare\(String\(b\.startsAt\)\)\)/);
    // each entry collapses its own detail
    expect(read("disclosure.jsx")).toMatch(/JourneyEntry/);
    expect(read("disclosure.jsx")).toMatch(/open \? "Less" : "More"/);
  });
  it("api.js exposes the two new gated RPC wrappers", () => {
    expect(API).toMatch(/export async function getStudentCareersProfile/);
    expect(API).toMatch(/export async function saveAppointmentOutcome/);
    expect(API).toMatch(/rpc\("eki_student_careers_profile"/);
    expect(API).toMatch(/rpc\("save_appointment_outcome"/);
  });
});
