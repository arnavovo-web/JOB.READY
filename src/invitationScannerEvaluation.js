/* ================================================================== *
 * PHASE 8 — INTERVIEW INVITATION SCANNER: AUTOMATED VALIDATION HARNESS
 * ------------------------------------------------------------------
 * Turns "we manually tested a few examples" into a repeatable, automated
 * evaluation: REALISTIC EMAIL CORPUS -> EXTRACTION -> EXPECTED RESULTS ->
 * VALIDATION -> PASS/FAIL REPORT -> REGRESSION PROTECTION.
 *
 * This module is pure evaluation/comparison logic — it does not call the
 * AI itself and does not duplicate the Phase 7 scanner's own extraction
 * logic. It is fed the output of the REAL, unmodified validateInvitationExtraction
 * (App.jsx) — either a hand-authored "simulated AI output" (deterministic,
 * src/invitationScannerEvaluation.test.js) or a genuine live AI response
 * (optional, src/invitationScannerLiveEvaluation.test.js) — and only
 * compares that real output against each fixture's expected result.
 *
 * Never imported by App.jsx (see the module-purity test in
 * invitationScannerEvaluation.test.js) — this is test/evaluation
 * tooling only, not part of the shipped application bundle.
 * ================================================================== */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FIXTURES_DIR = fileURLToPath(new URL("./test-fixtures/interview-invitations/", import.meta.url));

/** listInvitationFixtureIds() — every fixture id (basename before ".email.txt"/".expected.json"), sorted. */
export function listInvitationFixtureIds() {
  const files = readdirSync(FIXTURES_DIR);
  const ids = files.filter((f) => f.endsWith(".email.txt")).map((f) => f.slice(0, -".email.txt".length));
  return ids.sort();
}

/** loadInvitationFixture(id) — { id, emailText, expected } for one fixture. */
export function loadInvitationFixture(id) {
  const emailText = readFileSync(path.join(FIXTURES_DIR, `${id}.email.txt`), "utf8");
  const expected = JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${id}.expected.json`), "utf8"));
  return { id, emailText, expected };
}

/** loadAllInvitationFixtures() — every fixture in the corpus, sorted by id. */
export function loadAllInvitationFixtures() {
  return listInvitationFixtureIds().map(loadInvitationFixture);
}

/* ---------------- semantic matching helpers (§5: exact for canonical enums, normalized for free text) ---------------- */

function normalizeText(s) {
  return String(s == null ? "" : s).toLowerCase().trim().replace(/[’']/g, "'").replace(/[^a-z0-9'&\s-]/g, " ").replace(/\s+/g, " ").trim();
}

// Loose singular/plural-tolerant containment: "financial statement" should match "financial statements".
function containsNormalized(haystack, needle) {
  const h = normalizeText(haystack);
  const n = normalizeText(needle);
  if (!n) return true;
  if (h.includes(n)) return true;
  if (n.endsWith("s") && h.includes(n.slice(0, -1))) return true;
  if (!n.endsWith("s") && h.includes(`${n}s`)) return true;
  return false;
}

function asAnyOf(expectedValue) {
  return Array.isArray(expectedValue) ? expectedValue : [expectedValue];
}

// Exact match against ANY of the acceptable canonical values (never fuzzy — §5 "use exact matching for canonical enums").
function enumFieldVerdict(actual, expectedValue) {
  const options = asAnyOf(expectedValue);
  return options.includes(actual) ? "PASS" : "FAIL";
}

// Case/whitespace-normalized equality (or containment) for free-text identity fields (company/role/division/team).
function freeTextFieldVerdict(actual, expectedValue) {
  const options = asAnyOf(expectedValue);
  const a = normalizeText(actual);
  return options.some((opt) => {
    const e = normalizeText(opt);
    if (!e && !a) return true;
    if (!e || !a) return false;
    return a === e || a.includes(e) || e.includes(a);
  }) ? "PASS" : "FAIL";
}

// Numeric field with optional {min,max} range or exact-number-with-tolerance.
function numberFieldVerdict(actual, expectedValue, tolerance = 10) {
  const n = typeof actual === "number" ? actual : 0;
  if (expectedValue && typeof expectedValue === "object" && !Array.isArray(expectedValue)) {
    const { min = -Infinity, max = Infinity } = expectedValue;
    return n >= min && n <= max ? "PASS" : "FAIL";
  }
  const options = asAnyOf(expectedValue);
  return options.some((opt) => Math.abs(n - opt) <= tolerance) ? "PASS" : "FAIL";
}

// Set-equality (order-insensitive) for the components array — a canonical-enum array field.
// expectedValue is always a flat array of canonical component keys (never wrapped in an
// "any-of" — components is inherently a set already, unlike the scalar enum fields above).
function componentsFieldVerdict(actual, expectedValue) {
  const expectedSet = new Set(Array.isArray(expectedValue) ? expectedValue : []);
  const actualSet = new Set(Array.isArray(actual) ? actual : []);
  if (expectedSet.size !== actualSet.size) return "FAIL";
  for (const v of expectedSet) if (!actualSet.has(v)) return "FAIL";
  return "PASS";
}

const FIELD_KIND = {
  company: "freeText", company_source: "enum",
  role: "freeText", role_source: "enum",
  division: "freeText", team: "freeText",
  stage: "enum", stage_source: "enum",
  format: "enum", format_source: "enum",
  duration_minutes: "number",
  components: "components",
};

/**
 * evaluateInvitationField(fieldName, actualValue, expectedValue, { optional })
 *
 * Compares ONE field. Returns "PASS", "EXPECTED_VARIATION" (mismatch on a
 * field the fixture explicitly marked optional/loosely-specified — never
 * silently dropped, always visible in the report), or "FAIL" (a field the
 * fixture requires to be correct, and it wasn't — including the critical
 * "must stay unknown/empty" case, which is just a normal expected value).
 */
export function evaluateInvitationField(fieldName, actualValue, expectedValue, { optional = false } = {}) {
  const kind = FIELD_KIND[fieldName] || "freeText";
  let verdict;
  if (kind === "enum") verdict = enumFieldVerdict(actualValue, expectedValue);
  else if (kind === "number") verdict = numberFieldVerdict(actualValue, expectedValue);
  else if (kind === "components") verdict = componentsFieldVerdict(actualValue, expectedValue);
  else verdict = freeTextFieldVerdict(actualValue, expectedValue);
  if (verdict === "FAIL" && optional) verdict = "EXPECTED_VARIATION";
  return { field: fieldName, actual: actualValue, expected: expectedValue, verdict };
}

/**
 * evaluateInvitationTopics(validated, fixture)
 *
 * §5/§6: the anti-hallucination content check. topicsMustInclude tokens must
 * each appear (normalized) somewhere in the extraction's own topic/competency/
 * preparation fields — a genuinely-stated topic the extraction missed is a
 * real FAIL, not a stylistic variation. topicsMustNotInclude tokens must
 * appear NOWHERE in those same fields, with ZERO tolerance — this is the
 * hallucination guard the whole harness exists to protect (§20: "do not make
 * tests so permissive that they become meaningless").
 */
export function evaluateInvitationTopics(validated, fixture) {
  const v = validated || {};
  const haystack = [
    ...(v.technical_topics || []), ...(v.behavioural_topics || []), ...(v.commercial_topics || []),
    ...(v.mentioned_competencies || []), ...(v.preparation_areas || []), v.preparation_instructions || "",
  ].join(" | ");
  const mustInclude = fixture.topicsMustInclude || [];
  const mustNotInclude = fixture.topicsMustNotInclude || [];
  const missing = mustInclude.filter((t) => !containsNormalized(haystack, t));
  const hallucinated = mustNotInclude.filter((t) => containsNormalized(haystack, t));
  return {
    verdict: missing.length === 0 && hallucinated.length === 0 ? "PASS" : "FAIL",
    missing, hallucinated, haystack,
  };
}

/**
 * evaluateInvitationFixture(fixture, validatedExtraction)
 *
 * The core comparison: one fixture's expected result vs. one REAL, already-
 * validateInvitationExtraction()-processed extraction. Produces a per-field
 * breakdown (grouped into identity/config/logistics/content per §4) plus an
 * overall verdict. Never throws on a malformed/partial extraction — every
 * comparison degrades to a FAIL field result, never an exception, mirroring
 * the same "never crash on bad AI output" contract validateInvitationExtraction
 * itself already guarantees.
 */
export function evaluateInvitationFixture(fixture, validatedExtraction) {
  const v = validatedExtraction || {};
  const exp = fixture.expected || {};
  const optionalSet = new Set(fixture.expected?.optionalFields || []);

  const identityFields = ["company", "company_source", "role", "role_source", "division", "team"];
  const configFields = ["stage", "stage_source", "format", "format_source", "components"];
  const logisticsFields = ["duration_minutes"];

  function evalGroup(fields) {
    return fields
      .filter((f) => Object.prototype.hasOwnProperty.call(exp.expect || {}, f))
      .map((f) => evaluateInvitationField(f, v[f], exp.expect[f], { optional: optionalSet.has(f) }));
  }

  const identity = evalGroup(identityFields);
  const config = evalGroup(configFields);
  const logistics = evalGroup(logisticsFields);
  const content = evaluateInvitationTopics(v, exp);

  const allFieldResults = [...identity, ...config, ...logistics];
  const hasFail = allFieldResults.some((r) => r.verdict === "FAIL") || content.verdict === "FAIL";
  const hasVariation = allFieldResults.some((r) => r.verdict === "EXPECTED_VARIATION");

  return {
    id: fixture.id,
    sector: exp.sector || null,
    verdict: hasFail ? "FAIL" : hasVariation ? "EXPECTED_VARIATION" : "PASS",
    identity, config, logistics, content,
    reasons: [
      ...allFieldResults.filter((r) => r.verdict !== "PASS").map((r) => `${r.field}: expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)} (${r.verdict})`),
      ...(content.missing.length ? [`content: missing required topic(s): ${content.missing.join(", ")}`] : []),
      ...(content.hallucinated.length ? [`content: HALLUCINATED forbidden term(s): ${content.hallucinated.join(", ")}`] : []),
    ],
  };
}

/* ---------------- aggregate report (§15/§19) ---------------- */

const CATEGORY_GROUPS = {
  Identity: (e) => e.identity,
  Stage: (e) => e.config.filter((r) => r.field === "stage" || r.field === "stage_source"),
  Format: (e) => e.config.filter((r) => r.field === "format" || r.field === "format_source"),
  "Interview type (components)": (e) => e.config.filter((r) => r.field === "components"),
  Logistics: (e) => e.logistics,
};

function pctPass(results) {
  if (!results.length) return null;
  const passish = results.filter((r) => r.verdict === "PASS" || r.verdict === "EXPECTED_VARIATION").length;
  return Math.round((passish / results.length) * 100);
}

/**
 * buildInvitationEvaluationReport(evaluations)
 *
 * §15/§19: aggregates a list of evaluateInvitationFixture() results into the
 * summary a human (or CI) needs at a glance — total/passed/expected-variation/
 * failed counts, per-category accuracy, and the specific fixtures that failed
 * and why. "Passed" here always means the harness's own comparison logic
 * against the fixture corpus — for the deterministic suite that measures the
 * validator/matcher/report code itself; for the live evaluation command
 * (src/invitationScannerLiveEvaluation.test.js) it also reflects genuine
 * real-AI extraction quality.
 */
export function buildInvitationEvaluationReport(evaluations) {
  const total = evaluations.length;
  const passed = evaluations.filter((e) => e.verdict === "PASS").length;
  const expectedVariation = evaluations.filter((e) => e.verdict === "EXPECTED_VARIATION").length;
  const failed = evaluations.filter((e) => e.verdict === "FAIL").length;

  const byCategory = {};
  for (const [label, selector] of Object.entries(CATEGORY_GROUPS)) {
    const allResults = evaluations.flatMap(selector);
    byCategory[label] = pctPass(allResults);
  }
  const contentResults = evaluations.map((e) => e.content);
  byCategory["Content / topics"] = contentResults.length
    ? Math.round((contentResults.filter((c) => c.verdict === "PASS").length / contentResults.length) * 100)
    : null;
  byCategory["False-inference protection"] = contentResults.length
    ? Math.round((contentResults.filter((c) => c.hallucinated.length === 0).length / contentResults.length) * 100)
    : null;

  const failures = evaluations.filter((e) => e.verdict !== "PASS").map((e) => ({ id: e.id, verdict: e.verdict, reasons: e.reasons }));

  return { total, passed, expectedVariation, failed, byCategory, failures };
}

/** formatInvitationEvaluationReport(report) — the human-readable text block (§15's example format). */
export function formatInvitationEvaluationReport(report) {
  const lines = [];
  lines.push("INTERVIEW INVITATION EVALUATION");
  lines.push("");
  lines.push(`Total fixtures: ${report.total}`);
  lines.push("");
  lines.push(`Passed: ${report.passed}`);
  lines.push(`Expected variations: ${report.expectedVariation}`);
  lines.push(`Failed: ${report.failed}`);
  lines.push("");
  lines.push("By category:");
  for (const [label, pct] of Object.entries(report.byCategory)) {
    lines.push(`${label}: ${pct === null ? "n/a" : `${pct}%`}`);
  }
  if (report.failures.length) {
    lines.push("");
    lines.push("Failures:");
    for (const f of report.failures) {
      lines.push(`- [${f.verdict}] ${f.id}`);
      for (const reason of f.reasons) lines.push(`    ${reason}`);
    }
  }
  return lines.join("\n");
}
