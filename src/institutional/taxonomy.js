/* ================================================================== *
 * INSTITUTIONAL INSIGHTS — canonical analytics taxonomies
 * ------------------------------------------------------------------
 * Pure, dependency-free. These mirror the vocabularies the STUDENT
 * platform already writes into the database (verified by direct
 * inspection of the live project 2026-09-09). The institutional
 * analytics aggregate on THESE, never on free-text AI fields.
 *
 * Nothing here calls the DB or React — it is imported by both the
 * data-access layer (api.js) and the presentation shaping (analytics.js),
 * and is covered by taxonomy.test.js.
 * ================================================================== */

/* ---- k-anonymity ------------------------------------------------- *
 * No cohort-level figure is ever shown for a group with fewer than
 * this many contributing STUDENTS. Every inst_* analytics RPC applies
 * the same threshold server-side; the UI also guards on it defensively.
 */
export const MIN_COHORT_N = 5;

/* ---- The competency axis --------------------------------------- *
 * The six fixed evaluation dimensions every answer is scored on
 * (evaluations table, 0-100) and every interview report breaks down
 * (interview_reports.breakdown). This is the ONLY competency vocabulary
 * that is controlled end-to-end — the per-question `competency` string
 * is AI-generated free text ("Analytical rigour", "Analytical Thinking",
 * ...) and is used only as a secondary, clearly-labelled "themes" view.
 *
 * Note the historical naming split: the per-answer `evaluations` column
 * is `clarity`; the report `breakdown` and `competency_history` call the
 * same dimension `communication`. `CANONICAL_DIMENSION` maps both to one
 * key so a mixed-source aggregate stays coherent.
 */
export const COMPETENCY_DIMENSIONS = [
  { key: "relevance", label: "Relevance", blurb: "Answering the actual question asked" },
  { key: "specificity", label: "Specificity", blurb: "Concrete detail over generalities" },
  { key: "structure", label: "Structure", blurb: "A clear, followable narrative" },
  { key: "evidence", label: "Evidence", blurb: "Backing claims with real examples" },
  { key: "communication", label: "Communication", blurb: "Clear, concise, confident delivery" },
  { key: "competency_demonstration", label: "Competency demonstration", blurb: "Showing the trait the question targets" },
];

const DIMENSION_ALIASES = {
  clarity: "communication",
  communication: "communication",
};

/** Normalise an evaluation/breakdown field name to a canonical dimension key. */
export function canonicalDimension(name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  if (DIMENSION_ALIASES[n]) return DIMENSION_ALIASES[n];
  return COMPETENCY_DIMENSIONS.some((d) => d.key === n) ? n : null;
}

export function dimensionLabel(key) {
  const k = canonicalDimension(key) || key;
  const found = COMPETENCY_DIMENSIONS.find((d) => d.key === k);
  return found ? found.label : String(key || "");
}

/* ---- Question categories ------------------------------------- *
 * The canonical six-category methodology taxonomy (matches
 * methodology.js CATEGORIES in the student app). Raw
 * interview_questions.category rows use a slightly older set
 * (`cv_behavioural`, `role_specific`, `technical`, ...) — LEGACY_CATEGORY
 * normalises them, exactly as the student app's mapLegacyCategory does.
 */
export const QUESTION_CATEGORIES = [
  { key: "motivation_fit", label: "Motivation & fit" },
  { key: "behavioural_competency", label: "Behavioural / competency" },
  { key: "situational_judgement", label: "Situational judgement" },
  { key: "technical_functional", label: "Technical / functional" },
  { key: "commercial_awareness", label: "Commercial awareness" },
  { key: "case_problem_solving", label: "Case & problem solving" },
];

const LEGACY_CATEGORY = {
  motivation_fit: "motivation_fit",
  cv_behavioural: "behavioural_competency",
  behavioural_competency: "behavioural_competency",
  role_specific: "technical_functional",
  technical: "technical_functional",
  technical_functional: "technical_functional",
  commercial_awareness: "commercial_awareness",
  situational_judgement: "situational_judgement",
  case_problem_solving: "case_problem_solving",
};

/** Normalise a raw category string to the canonical taxonomy (unknown -> behavioural_competency). */
export function canonicalCategory(category) {
  if (category && QUESTION_CATEGORIES.some((c) => c.key === category)) return category;
  return LEGACY_CATEGORY[category] || "behavioural_competency";
}

export function categoryLabel(key) {
  const k = QUESTION_CATEGORIES.find((c) => c.key === key);
  return k ? k.label : String(key || "");
}

/* ---- Interview stage / format ------------------------------- */
export const INTERVIEW_STAGES = [
  { key: "recruiter_screen", label: "Recruiter screen" },
  { key: "first_round", label: "First round" },
  { key: "technical", label: "Technical" },
  { key: "final_round", label: "Final round" },
];
export function stageLabel(key) {
  const s = INTERVIEW_STAGES.find((x) => x.key === key);
  return s ? s.label : (key ? String(key) : "Unspecified");
}

/* ---- Readiness ladder -------------------------------------- *
 * interview_reports.readiness / interviews.readiness. Ordered worst -> best.
 */
export const READINESS_LEVELS = [
  { key: "not_ready", label: "Not ready", score: 0, tone: "bad" },
  { key: "needs_improvement", label: "Needs improvement", score: 1, tone: "warn" },
  { key: "interview_ready", label: "Interview ready", score: 2, tone: "good" },
  { key: "strong", label: "Strong", score: 3, tone: "good" },
];
export function readinessMeta(key) {
  return READINESS_LEVELS.find((r) => r.key === key) || { key: key || "unknown", label: "Unknown", score: null, tone: "neutral" };
}

/* ---- Score banding (shared 0-100 -> qualitative) ----------- */
export function scoreBand(score) {
  if (score == null || Number.isNaN(score)) return { key: "none", label: "No data", tone: "neutral" };
  if (score >= 75) return { key: "strong", label: "Strong", tone: "good" };
  if (score >= 60) return { key: "solid", label: "Solid", tone: "good" };
  if (score >= 45) return { key: "developing", label: "Developing", tone: "warn" };
  return { key: "priority", label: "Priority", tone: "bad" };
}

/* ---- Career-path role families ---------------------------- *
 * applications.company / applications.role are free text. This is an
 * EXPLICIT, DOCUMENTED heuristic — keyword match on the role string,
 * then company as a weak fallback — not a claim of a clean taxonomy.
 * `classifyRole` returns { key, label, confident } so the UI can show an
 * "approx." marker on low-confidence groupings and an "Other / unclassified"
 * bucket is always available.
 */
export const ROLE_FAMILIES = [
  { key: "ib", label: "Investment banking", kw: ["investment bank", "m&a", "mergers", "ib ", "ibd", "leveraged finance", "dcm", "ecm", "coverage"] },
  { key: "markets", label: "Markets, sales & trading", kw: ["sales & trading", "sales and trading", "s&t", "global markets", "trading", "trader", "quant", "structuring", "fixed income", "equities desk"] },
  { key: "pe_pc", label: "Private equity & principal investing", kw: ["private equity", "principal investment", "buyout", "growth equity", "venture capital", "vc ", "private credit"] },
  { key: "am_wm", label: "Asset & wealth management", kw: ["asset management", "wealth management", "portfolio manag", "investment management", "fund manag"] },
  { key: "consulting", label: "Management consulting", kw: ["consult", "strategy&", "advisory", "business analyst"] },
  { key: "swe", label: "Software engineering", kw: ["software engineer", "software developer", "swe", "backend", "frontend", "full stack", "full-stack", "platform engineer", "mobile engineer"] },
  { key: "data", label: "Data & analytics", kw: ["data scien", "data analyst", "machine learning", "ml engineer", "analytics", "data engineer"] },
  { key: "product", label: "Product management", kw: ["product manager", "product management", "associate product", "apm"] },
  { key: "finance_corp", label: "Corporate finance & accounting", kw: ["financial analyst", "corporate finance", "fp&a", "accounting", "audit", "treasury", "actuar"] },
  { key: "marketing", label: "Marketing & commercial", kw: ["marketing", "brand", "commercial graduate", "sales graduate", "account executive"] },
  { key: "ops_grad", label: "Operations & graduate schemes", kw: ["operations", "supply chain", "graduate scheme", "graduate programme", "rotational", "management trainee"] },
];

export function classifyRole(role, company) {
  const r = String(role || "").toLowerCase();
  const c = String(company || "").toLowerCase();
  if (!r && !c) return { key: "unclassified", label: "Other / unclassified", confident: false };
  for (const fam of ROLE_FAMILIES) {
    if (fam.kw.some((k) => r.includes(k.trim()))) return { key: fam.key, label: fam.label, confident: true };
  }
  // weak company-based fallback for a handful of unambiguous names
  const COMPANY_HINT = {
    "goldman sachs": "ib", "morgan stanley": "ib", "jpmorgan": "markets", "j.p. morgan": "markets",
    "blackstone": "pe_pc", "kkr": "pe_pc", "apollo": "pe_pc", "carlyle": "pe_pc",
    "mckinsey": "consulting", "bain": "consulting", "bcg": "consulting", "boston consulting": "consulting",
    "google": "swe", "meta": "swe", "amazon": "swe", "microsoft": "swe", "netflix": "swe",
  };
  for (const [name, key] of Object.entries(COMPANY_HINT)) {
    if (c.includes(name)) {
      const fam = ROLE_FAMILIES.find((f) => f.key === key);
      return { key, label: fam ? fam.label : key, confident: false };
    }
  }
  return { key: "unclassified", label: "Other / unclassified", confident: false };
}

export function roleFamilyLabel(key) {
  if (key === "unclassified") return "Other / unclassified";
  const f = ROLE_FAMILIES.find((x) => x.key === key);
  return f ? f.label : String(key || "");
}
