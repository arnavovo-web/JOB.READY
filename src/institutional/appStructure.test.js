/* ================================================================== *
 * INSTITUTIONAL INSIGHTS — app-structure regression tests
 * Source-inspection (no DOM render), same convention as the student
 * suite. Guards: the /institutional route gate, the six dashboard
 * sections, the auth gate, k-anonymity plumbing, design isolation
 * from the student App.jsx, and the CSS discipline the student
 * App.cssUtilities guard enforces (applied here to theme.js).
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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
  it("every className referenced in the JSX is defined in theme.js (browser-parseable rule)", () => {
    const cssStart = THEME.indexOf("`");
    const css = THEME.slice(cssStart + 1, THEME.lastIndexOf("`")).replace(/\/\*[\s\S]*?\*\//g, "");
    const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)\s*\{/g)].map((m) => m[1]));
    const used = new Set();
    for (const m of APP.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      for (const tok of (m[1] || m[2] || "").split(/\s+/)) {
        if (tok && tok.startsWith("ii-")) used.add(tok);
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
    expect(APP).toMatch(/usage is deliberately not the headline/i);
  });
  it("routes each analytics section to a real api fetcher (no hard-coded numbers)", () => {
    for (const fn of ["getPerformance", "getCompetencies", "getCareerInsights", "getDevelopmentAreas", "getImprovement"]) {
      expect(APP).toMatch(new RegExp(`fetcher=\\{api\\.${fn}\\}`));
    }
  });
});

describe("auth gate", () => {
  it("has a distinct no-access state for a valid account with no institution", () => {
    expect(APP).toMatch(/no-access/);
    expect(APP).toMatch(/No institutional access/);
    expect(APP).toMatch(/getMyInstitutions/);
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
  it("api.js only writes institutional tables, and reads student data only via inst_* RPCs", () => {
    const fromCalls = [...API.matchAll(/\.from\(["'](\w+)["']\)/g)].map((m) => m[1]);
    const allowed = new Set(["institutions", "institution_organisations", "cohorts", "cohort_members", "institution_staff"]);
    for (const t of fromCalls) expect(allowed.has(t)).toBe(true);
    // any cross-into-student-data call must be an RPC named inst_* / get_my_institutions
    const rpcs = [...API.matchAll(/\.rpc\(["'](\w+)["']|rpc\(["'](\w+)["']/g)].map((m) => m[1] || m[2]).filter(Boolean);
    for (const r of rpcs) expect(/^(inst_|get_my_institutions|jr_inst_)/.test(r)).toBe(true);
  });
});
