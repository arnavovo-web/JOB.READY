/* ================================================================== *
 * PHASE 6 — UNIVERSAL INTERVIEW KNOWLEDGE LAYER
 * ------------------------------------------------------------------
 * A pure, deterministic module (same pattern as methodology.js /
 * candidateIntelligence.js / candidateState.js / interviewStrategy.js)
 * that answers ONE question the rest of the architecture never could:
 * "what canonical knowledge/concepts should reasonably be tested for
 * THIS type of interview?" — e.g. an Investment Banking technical round
 * has a fairly predictable universe (three statements, DCF, comps,
 * accretion/dilution...) that a generic JD/CV-personalised engine has
 * no way to know about on its own.
 *
 * This module makes NO AI calls, performs NO web search, touches NO
 * database, and NEVER throws on malformed/missing input — every
 * function defensively degrades to an inert/empty result, same
 * contract every other pure module in this codebase already follows.
 * A degraded result (no domain match, no applicable category, no
 * candidate state) simply means "the existing architecture behaves
 * exactly as it did before this module existed" — never a crash, never
 * a fabricated concept.
 *
 *   Interview configuration (stage/format/pipeline, from App.jsx's
 *   existing INTERVIEW_STAGES/INTERVIEW_FORMATS/resolveInterviewConfig
 *   — NOT duplicated here)
 *           |
 *           v
 *   isKnowledgeLayerApplicable() — the explicit, deterministic gate.
 *   Reads the SCHEDULER's own already-decided category (methodology.js/
 *   adaptiveEngine.js, untouched) as its primary signal — it does not
 *   independently guess "is this a technical moment", it trusts the
 *   scheduler's category decision, which is already stage/format/JD-
 *   aware. A HireVue-style (independent_batch) interview never reaches
 *   this gate in the first place: this module is only ever consulted
 *   from buildQuestionGenerationPrompt (Call 2), which the batch
 *   pipeline never calls at all (see buildQuestionBatchPrompt, wholly
 *   separate) — the gate's own pipeline check is a second, explicit,
 *   testable layer of the same protection, not the only one.
 *           |
 *           v
 *   resolveKnowledgeDomain() — deterministic keyword matching over
 *   ALREADY-EXTRACTED interview_profile fields (role/division/
 *   responsibilities/required_skills/preferred_skills/technical_topics/
 *   commercial_topics/jd_requirements) — no new AI call, no raw JD
 *   re-parsing. A generic/unmatched role correctly resolves to no
 *   domain, which alone is enough to make the whole layer inert for
 *   that interview, independent of the category gate above.
 *           |
 *           v
 *   buildKnowledgeGuidance() — ranks that domain's concepts (filtered to
 *   the scheduler's own category) by: baseline importance, whether the
 *   JD specifically emphasises it (jd_requirements intersection), and —
 *   critically — EXISTING Candidate State (candidateState.js's own
 *   already-computed per-competency .tests/.trend/.mostRecentEvidence,
 *   keyed by the EXACT SAME free-text competency label this module
 *   stamps going forward). This is deliberately not a parallel
 *   intelligence system: an "unseen" concept and a "demonstrated
 *   strongly" one are read directly off the same structure
 *   candidateState.js already produces for every other competency.
 *           |
 *           v
 *   App.jsx's buildQuestionGenerationPrompt turns the returned structured
 *   guidance into a short prompt paragraph for Call 2 — category/
 *   turn_type/anchor_source remain entirely the scheduler's; this module
 *   only ever influences the ONE thing a "normal" turn's content
 *   generation already owned before this module existed: the specific
 *   competency label Call 2's question targets.
 * ================================================================== */

// Reuses methodology.js's own canonical taxonomy — same import pattern
// candidateIntelligence.js/candidateState.js/interviewStrategy.js already
// use (`import { ACTIVE_CATEGORIES, mapLegacyCategory } from "./methodology.js"`)
// — never a second/duplicate taxonomy, and never at risk of silently
// drifting from methodology.js's own category strings.
import { CATEGORIES, mapLegacyCategory } from "./methodology.js";

// ---- local, self-contained helpers ----
function str(v, fallback = "") {
  return typeof v === "string" ? v : (v == null ? fallback : String(v));
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ---- 6.1 the categories the knowledge layer may ever apply to ----------
// Derived by EXCLUSION from methodology.js's own CATEGORIES, not a hardcoded
// inclusion list — canonical domain knowledge (DCF, big-O, case frameworks...)
// must never leak into a motivation or behavioural turn, regardless of
// domain/JD match, but any OTHER category methodology.js defines (now or in
// the future) is eligible by default. Exclusion, not inclusion, is the
// deliberate choice: a hardcoded inclusion list would silently exclude a
// future new category by omission; this can only ever silently miss
// EXCLUDING one, a strictly safer failure direction for "should knowledge
// ever apply here".
export const KNOWLEDGE_ELIGIBLE_CATEGORIES = CATEGORIES.filter(
  (c) => c !== "motivation_fit" && c !== "behavioural_competency"
);

// ---- 6.2 applicability gate --------------------------------------------
/**
 * isKnowledgeLayerApplicable({ pipeline, category, domain })
 *
 * pipeline: the resolved interview config's pipeline ("adaptive_turn" |
 *   "independent_batch" | anything else/legacy). Only "adaptive_turn" can
 *   ever be applicable — a HireVue-style (independent_batch) interview
 *   already never calls buildQuestionGenerationPrompt at all (it uses the
 *   wholly separate buildQuestionBatchPrompt/generateQuestionBatch), so
 *   this check is a second, explicit, independently-testable guarantee of
 *   the same protection, not the only one.
 * category: the SCHEDULER's own already-decided category for this turn
 *   (methodology.js/adaptiveEngine.js, untouched) — the primary signal.
 *   Trusting the scheduler's decision (rather than re-deriving "is this a
 *   technical moment" independently) is deliberate: a rare technical_
 *   functional turn inside an otherwise-behavioural recruiter screen is
 *   itself already a bounded, deterministic, stage/envelope-aware decision
 *   (see methodology.js's STAGE_METHODOLOGY) — this module simply asks "if
 *   the scheduler decided THIS turn is technical, is there canonical
 *   knowledge worth drawing on", never "should this turn be technical".
 * domain: resolveKnowledgeDomain()'s output — null means no confident
 *   role/JD match, which alone makes the layer inert regardless of category.
 *
 * Deterministic, pure, explainable: three independent AND-ed conditions,
 * no AI, no heuristics beyond the ones already named above.
 */
export function isKnowledgeLayerApplicable({ pipeline, category, domain } = {}) {
  if (pipeline !== "adaptive_turn") return false;
  if (!domain) return false;
  // Normalized via the SAME mapLegacyCategory every other consumer of the scheduler's category
  // decision already uses (candidateState.js/candidateIntelligence.js/interviewStrategy.js) —
  // defensive only, since the scheduler's own category is already canonical by the time it
  // reaches here; never a second category-mapping implementation.
  if (!KNOWLEDGE_ELIGIBLE_CATEGORIES.includes(mapLegacyCategory(category))) return false;
  return true;
}

// ---- 6.3 knowledge catalogue --------------------------------------------
// A deliberately REPRESENTATIVE initial set, not an exhaustive world model —
// proves the architecture across genuinely different knowledge universes
// (finance, consulting, tech, product, marketing) per the design brief.
// Extensible: adding a domain/topic/concept requires no code change, only a
// new entry below. roleKeywords are specific multi-word phrases (never bare
// generic words like "analyst") so resolveKnowledgeDomain's substring match
// stays precise rather than firing on incidental overlap. Every concept
// declares which of KNOWLEDGE_ELIGIBLE_CATEGORIES it belongs to — most
// technical concepts sit under technical_functional; a handful of
// market-context concepts also (or only) sit under commercial_awareness.
// difficulty reuses the SAME "foundational|intermediate|advanced" enum
// App.jsx's own batch pipeline already uses (see App.jsx's DIFFS) — not a
// second scale. `label` is used VERBATIM as the competency stamped on a
// knowledge-guided question, so it doubles as the Candidate State lookup
// key — see buildKnowledgeGuidance below.
export const KNOWLEDGE_DOMAINS = [
  {
    id: "investment_banking",
    label: "Investment Banking",
    roleKeywords: ["investment banking", "ib analyst", "equity capital markets", "debt capital markets", "leveraged finance", "m&a advisory", "mergers and acquisitions"],
    topics: [
      {
        label: "Accounting & Financial Statements",
        concepts: [
          { id: "ib_three_statements", label: "Three financial statements", categories: ["technical_functional"], difficulty: "foundational", priority: 70, keywords: ["financial statements", "income statement", "balance sheet", "cash flow statement"], archetypes: [
            "Ask the candidate to name the three financial statements and briefly describe what each one shows.",
            "Ask how a specific transaction (e.g. buying equipment with cash) would flow through all three statements.",
          ] },
          { id: "ib_statement_linkage", label: "Statement linkage", categories: ["technical_functional"], difficulty: "intermediate", priority: 65, keywords: ["net income flows", "linkage", "retained earnings", "statements link"], archetypes: [
            "Ask the candidate to walk through how net income links the income statement to the balance sheet and cash flow statement.",
            "Give a scenario (e.g. a $10m increase in depreciation) and ask how it flows through all three statements.",
          ] },
          { id: "ib_working_capital", label: "Working capital", categories: ["technical_functional"], difficulty: "intermediate", priority: 55, keywords: ["working capital", "receivables", "payables", "inventory"], archetypes: [
            "Ask what working capital is and why an increase in it reduces free cash flow.",
          ] },
          { id: "ib_depreciation", label: "Depreciation & amortisation", categories: ["technical_functional"], difficulty: "foundational", priority: 50, keywords: ["depreciation", "amortisation", "capex", "non-cash"], archetypes: [
            "Ask why depreciation is added back in the cash flow statement despite reducing net income.",
          ] },
        ],
      },
      {
        label: "Valuation",
        concepts: [
          { id: "ib_dcf", label: "DCF valuation", categories: ["technical_functional"], difficulty: "advanced", priority: 75, keywords: ["dcf", "discounted cash flow", "wacc", "terminal value"], archetypes: [
            "Ask the candidate to walk through, at a high level, how a DCF valuation is built.",
            "Ask what happens to a DCF valuation if the discount rate (WACC) increases, and why.",
          ] },
          { id: "ib_trading_comps", label: "Trading comparables", categories: ["technical_functional"], difficulty: "intermediate", priority: 65, keywords: ["trading comps", "comparable companies", "ev/ebitda"], archetypes: [
            "Ask how a trading comparables analysis is performed and what makes a company a good comparable.",
          ] },
          { id: "ib_precedent_transactions", label: "Precedent transactions", categories: ["technical_functional"], difficulty: "intermediate", priority: 55, keywords: ["precedent transactions", "control premium", "deal comps"], archetypes: [
            "Ask why precedent transaction multiples are usually higher than trading comps multiples.",
          ] },
          { id: "ib_ev_vs_equity", label: "Enterprise value vs equity value", categories: ["technical_functional"], difficulty: "foundational", priority: 60, keywords: ["enterprise value", "equity value", "ev to equity bridge"], archetypes: [
            "Ask the candidate to explain the difference between enterprise value and equity value, and how you bridge between them.",
          ] },
        ],
      },
      {
        label: "M&A",
        concepts: [
          { id: "ib_accretion_dilution", label: "Accretion/dilution", categories: ["technical_functional"], difficulty: "advanced", priority: 65, keywords: ["accretion", "dilution", "eps impact", "exchange ratio"], archetypes: [
            "Ask what makes an acquisition accretive or dilutive to the acquirer's EPS.",
            "Give a simplified acquirer/target P/E scenario and ask whether the deal would be accretive or dilutive.",
          ] },
          { id: "ib_synergies", label: "Synergies", categories: ["technical_functional", "commercial_awareness"], difficulty: "intermediate", priority: 50, keywords: ["synergies", "cost synergies", "revenue synergies"], archetypes: [
            "Ask the candidate to distinguish cost synergies from revenue synergies and which are usually more reliable to underwrite.",
          ] },
          { id: "ib_purchase_accounting", label: "Purchase accounting", categories: ["technical_functional"], difficulty: "advanced", priority: 45, keywords: ["purchase accounting", "goodwill", "purchase price allocation"], archetypes: [
            "Ask what goodwill represents and how it arises in an acquisition.",
          ] },
          { id: "ib_ma_rationale", label: "Recent M&A market context", categories: ["commercial_awareness"], difficulty: "intermediate", priority: 55, keywords: ["recent deal", "m&a activity", "deal rationale"], archetypes: [
            "Ask the candidate to discuss a recent M&A deal they've followed and what the strategic rationale appeared to be.",
          ] },
        ],
      },
    ],
  },
  {
    id: "sales_and_trading",
    label: "Sales & Trading",
    roleKeywords: ["sales and trading", "global markets", "fx trading", "fixed income trading", "equities trading", "trading desk", "market making"],
    topics: [
      {
        label: "Markets",
        concepts: [
          { id: "st_bond_pricing", label: "Bond pricing and yield", categories: ["technical_functional"], difficulty: "foundational", priority: 65, keywords: ["bond price", "yield", "coupon", "inverse relationship"], archetypes: [
            "Ask the candidate to explain why bond prices and yields move inversely.",
          ] },
          { id: "st_duration_convexity", label: "Duration and convexity", categories: ["technical_functional"], difficulty: "advanced", priority: 60, keywords: ["duration", "convexity", "interest rate sensitivity"], archetypes: [
            "Ask what duration measures and how convexity refines that estimate for larger rate moves.",
          ] },
          { id: "st_options_greeks", label: "Options and the Greeks", categories: ["technical_functional"], difficulty: "advanced", priority: 55, keywords: ["delta", "gamma", "vega", "theta", "options"], archetypes: [
            "Ask the candidate to explain what delta measures for an option position.",
          ] },
          { id: "st_market_context", label: "Current market conditions", categories: ["commercial_awareness"], difficulty: "intermediate", priority: 65, keywords: ["central bank", "rate decision", "market volatility", "recent move"], archetypes: [
            "Ask the candidate what's currently happening in a market they follow and how they'd position around it.",
          ] },
        ],
      },
    ],
  },
  {
    id: "private_equity",
    label: "Private Equity",
    roleKeywords: ["private equity", "leveraged buyout", "lbo analyst", "portfolio company"],
    topics: [
      {
        label: "LBO Mechanics",
        concepts: [
          { id: "pe_lbo_mechanics", label: "LBO mechanics", categories: ["technical_functional"], difficulty: "advanced", priority: 75, keywords: ["lbo", "leveraged buyout", "debt paydown"], archetypes: [
            "Ask the candidate to walk through, at a high level, how a leveraged buyout generates returns.",
          ] },
          { id: "pe_returns_drivers", label: "Returns drivers (IRR/MOIC)", categories: ["technical_functional"], difficulty: "advanced", priority: 65, keywords: ["irr", "moic", "returns", "multiple expansion"], archetypes: [
            "Ask what the main drivers of returns are in a leveraged buyout (multiple expansion, deleveraging, EBITDA growth).",
          ] },
          { id: "pe_value_creation", label: "Value creation levers", categories: ["technical_functional", "commercial_awareness"], difficulty: "intermediate", priority: 55, keywords: ["value creation", "operational improvement", "add-on acquisitions"], archetypes: [
            "Ask what a PE firm can actually do, operationally, to create value in a portfolio company beyond financial engineering.",
          ] },
        ],
      },
    ],
  },
  {
    id: "consulting",
    label: "Management Consulting",
    roleKeywords: ["management consulting", "strategy consulting", "case interview", "case study interview"],
    topics: [
      {
        label: "Case Frameworks",
        concepts: [
          { id: "consulting_profitability", label: "Profitability framework", categories: ["case_problem_solving", "situational_judgement"], difficulty: "foundational", priority: 70, keywords: ["profitability", "revenue minus cost", "profit decline"], archetypes: [
            "Pose a short profitability-decline scenario and ask how the candidate would structure their diagnosis.",
          ] },
          { id: "consulting_market_sizing", label: "Market sizing", categories: ["case_problem_solving", "situational_judgement"], difficulty: "intermediate", priority: 65, keywords: ["market sizing", "estimate the size", "top-down", "bottom-up"], archetypes: [
            "Ask the candidate to size a market (e.g. the market for umbrellas in a given city) and explain their approach.",
          ] },
          { id: "consulting_market_entry", label: "Market entry framework", categories: ["case_problem_solving", "situational_judgement"], difficulty: "intermediate", priority: 55, keywords: ["market entry", "should we enter", "new market"], archetypes: [
            "Pose a market-entry scenario and ask what factors the candidate would evaluate before recommending entry.",
          ] },
          { id: "consulting_structuring", label: "Structuring an ambiguous problem", categories: ["case_problem_solving", "situational_judgement"], difficulty: "foundational", priority: 60, keywords: ["structure the problem", "issue tree", "hypothesis"], archetypes: [
            "Ask the candidate how they'd structure their thinking before diving into an ambiguous business problem.",
          ] },
        ],
      },
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    roleKeywords: ["audit associate", "assurance associate", "chartered accountant", "acca", "tax advisory", "external audit"],
    topics: [
      {
        label: "Core Accounting",
        concepts: [
          { id: "acc_double_entry", label: "Double-entry bookkeeping", categories: ["technical_functional"], difficulty: "foundational", priority: 65, keywords: ["double entry", "debits and credits", "journal entry"], archetypes: [
            "Ask the candidate to explain double-entry bookkeeping with a simple example.",
          ] },
          { id: "acc_revenue_recognition", label: "Revenue recognition", categories: ["technical_functional"], difficulty: "intermediate", priority: 60, keywords: ["revenue recognition", "when is revenue recognised"], archetypes: [
            "Ask when revenue should be recognised for a multi-year service contract, and why.",
          ] },
          { id: "acc_deferred_tax", label: "Deferred tax", categories: ["technical_functional"], difficulty: "advanced", priority: 45, keywords: ["deferred tax", "temporary difference"], archetypes: [
            "Ask what a deferred tax liability represents and how it typically arises.",
          ] },
          { id: "acc_audit_risk", label: "Audit risk assessment", categories: ["technical_functional", "situational_judgement"], difficulty: "intermediate", priority: 55, keywords: ["audit risk", "materiality", "control risk"], archetypes: [
            "Ask how the candidate would assess audit risk and materiality for a new client engagement.",
          ] },
        ],
      },
    ],
  },
  {
    id: "software_engineering",
    label: "Software Engineering",
    roleKeywords: ["software engineer", "backend developer", "frontend developer", "full stack developer", "software development engineer"],
    topics: [
      {
        label: "Computer Science Fundamentals",
        concepts: [
          { id: "swe_big_o", label: "Time/space complexity (Big O)", categories: ["technical_functional"], difficulty: "foundational", priority: 70, keywords: ["big o", "time complexity", "space complexity"], archetypes: [
            "Ask the candidate to explain what Big O notation measures and give an example of an O(n log n) algorithm.",
          ] },
          { id: "swe_data_structures", label: "Data structure trade-offs", categories: ["technical_functional"], difficulty: "intermediate", priority: 65, keywords: ["data structure", "hash map", "array vs linked list"], archetypes: [
            "Ask when the candidate would choose a hash map over an array, and what the trade-offs are.",
          ] },
          { id: "swe_system_design", label: "System design fundamentals", categories: ["technical_functional"], difficulty: "advanced", priority: 60, keywords: ["system design", "scalability", "load balancing", "caching"], archetypes: [
            "Ask the candidate to sketch, at a high level, how they'd design a system to handle a large increase in read traffic.",
          ] },
          { id: "swe_concurrency", label: "Concurrency basics", categories: ["technical_functional"], difficulty: "advanced", priority: 50, keywords: ["concurrency", "race condition", "thread safety"], archetypes: [
            "Ask the candidate to explain what a race condition is and how it can be avoided.",
          ] },
        ],
      },
    ],
  },
  {
    id: "data_science",
    label: "Data Science",
    roleKeywords: ["data scientist", "machine learning engineer", "ml engineer", "data science analyst"],
    topics: [
      {
        label: "Statistics & ML",
        concepts: [
          { id: "ds_bias_variance", label: "Bias-variance trade-off", categories: ["technical_functional"], difficulty: "intermediate", priority: 65, keywords: ["bias variance", "overfitting", "underfitting"], archetypes: [
            "Ask the candidate to explain the bias-variance trade-off in their own words.",
          ] },
          { id: "ds_overfitting", label: "Overfitting & regularisation", categories: ["technical_functional"], difficulty: "intermediate", priority: 55, keywords: ["overfitting", "regularisation", "l1 l2"], archetypes: [
            "Ask how the candidate would detect and address overfitting in a model.",
          ] },
          { id: "ds_ab_testing", label: "A/B testing", categories: ["technical_functional", "situational_judgement"], difficulty: "intermediate", priority: 60, keywords: ["a/b test", "statistical significance", "experiment design"], archetypes: [
            "Ask the candidate to design an A/B test for a proposed product change and what they'd measure.",
          ] },
          { id: "ds_model_eval", label: "Model evaluation metrics", categories: ["technical_functional"], difficulty: "foundational", priority: 50, keywords: ["precision", "recall", "f1 score", "auc"], archetypes: [
            "Ask when the candidate would prioritise precision over recall, and give an example.",
          ] },
        ],
      },
    ],
  },
  {
    id: "product_management",
    label: "Product Management",
    roleKeywords: ["product manager", "associate product manager", "product management"],
    topics: [
      {
        label: "Product Sense",
        concepts: [
          { id: "pm_prioritisation", label: "Prioritisation framework", categories: ["situational_judgement", "case_problem_solving"], difficulty: "foundational", priority: 65, keywords: ["prioritise", "roadmap", "impact vs effort"], archetypes: [
            "Ask the candidate how they'd prioritise a backlog of competing feature requests.",
          ] },
          { id: "pm_metrics", label: "Defining success metrics", categories: ["situational_judgement", "case_problem_solving"], difficulty: "intermediate", priority: 55, keywords: ["success metrics", "north star metric", "kpi"], archetypes: [
            "Ask the candidate what metrics they'd track to know whether a new feature was successful.",
          ] },
          { id: "pm_launch_strategy", label: "Product launch strategy", categories: ["situational_judgement"], difficulty: "intermediate", priority: 50, keywords: ["launch strategy", "go to market", "rollout"], archetypes: [
            "Ask how the candidate would approach launching a new feature to minimise risk.",
          ] },
        ],
      },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    roleKeywords: ["marketing", "brand management", "digital marketing", "growth marketing"],
    topics: [
      {
        label: "Marketing Fundamentals",
        concepts: [
          { id: "mkt_mix", label: "Marketing mix (4Ps)", categories: ["technical_functional", "situational_judgement"], difficulty: "foundational", priority: 55, keywords: ["marketing mix", "4ps", "product price place promotion"], archetypes: [
            "Ask the candidate to apply the marketing mix (4Ps) to a product of their choice.",
          ] },
          { id: "mkt_segmentation", label: "Customer segmentation", categories: ["technical_functional", "situational_judgement"], difficulty: "intermediate", priority: 60, keywords: ["segmentation", "target audience", "customer persona"], archetypes: [
            "Ask how the candidate would segment the customer base for a given product.",
          ] },
          { id: "mkt_roi", label: "Campaign measurement & ROI", categories: ["technical_functional"], difficulty: "intermediate", priority: 55, keywords: ["campaign roi", "conversion rate", "attribution"], archetypes: [
            "Ask how the candidate would measure whether a marketing campaign was successful.",
          ] },
        ],
      },
    ],
  },
];

const DOMAIN_MATCH_MIN_SCORE = 1;

/**
 * resolveKnowledgeDomain(interviewProfile)
 *
 * interviewProfile: profile.interview_profile (validateProfile's own shape —
 *   role, division, responsibilities, required_skills, preferred_skills,
 *   technical_topics, commercial_topics, jd_requirements). Deliberately
 *   reuses fields the interview_profile AI call already extracts — no new
 *   AI call, no raw-JD re-parsing.
 *
 * Deterministic substring keyword matching, case-insensitive. Returns the
 * best-scoring domain (most roleKeyword hits) when it clears
 * DOMAIN_MATCH_MIN_SCORE, otherwise null — a generic/unmatched role
 * correctly resolves to "no domain", the same safe default as every other
 * degradation path in this module. Ties break on KNOWLEDGE_DOMAINS' own
 * declared order (first strictly-greater score wins, same first-wins
 * convention methodology.js's ACTIVE_CATEGORIES iteration already uses).
 */
export function resolveKnowledgeDomain(interviewProfile) {
  const ip = interviewProfile && typeof interviewProfile === "object" ? interviewProfile : {};
  const haystackParts = [
    str(ip.role), str(ip.division),
    ...arr(ip.responsibilities).map((s) => str(s)),
    ...arr(ip.required_skills).map((s) => str(s)),
    ...arr(ip.preferred_skills).map((s) => str(s)),
    ...arr(ip.technical_topics).map((s) => str(s)),
    ...arr(ip.commercial_topics).map((s) => str(s)),
    ...arr(ip.jd_requirements).map((r) => `${str(r?.requirement)} ${str(r?.evidence_quote)}`),
  ];
  const haystack = haystackParts.join(" ").toLowerCase();
  if (!haystack.trim()) return null;

  let best = null;
  let bestScore = 0;
  for (const domain of KNOWLEDGE_DOMAINS) {
    let score = 0;
    for (const kw of domain.roleKeywords) {
      if (haystack.includes(kw.toLowerCase())) score += 1;
    }
    if (score > bestScore) { bestScore = score; best = domain; }
  }
  return bestScore >= DOMAIN_MATCH_MIN_SCORE ? best : null;
}

/**
 * getDomainConcepts(domain, category)
 *
 * Flattens a domain's topic/concept tree into a single list, filtered to
 * concepts relevant to the given (scheduler-decided) category. Each
 * returned concept carries its parent topic's label for context. Never
 * throws: a missing/malformed domain or category returns [].
 */
export function getDomainConcepts(domain, category) {
  if (!domain || !Array.isArray(domain.topics)) return [];
  const normalizedCategory = mapLegacyCategory(category);
  const out = [];
  for (const topic of domain.topics) {
    for (const concept of arr(topic?.concepts)) {
      if (concept && arr(concept.categories).includes(normalizedCategory)) {
        out.push({ ...concept, topicLabel: str(topic?.label) });
      }
    }
  }
  return out;
}

// ---- 6.4 candidate-state-aware priority -----------------------------
// Reuses candidateState.js's OWN already-computed per-competency fields
// (.tests / .trend / .mostRecentEvidence.strength) — this module never
// recomputes evidence strength/trend itself, per the "do not build a
// parallel Candidate State" constraint. A concept whose label has never
// been asked (no entry in candidateState.competencies, or .tests === 0)
// is "not yet tested" — the strongest priority signal, same convention
// candidateIntelligence.js/interviewStrategy.js already use for an
// unknown/never-tested category.
const RECENT_STRENGTH_ADJUSTMENT = { strong: -50, moderate: -20, weak: 25, contradictory: 30 };
const TREND_ADJUSTMENT = { declining: 15, improving: -10 };
// Bounded, same rationale as interviewStrategy.js's STRATEGY_NUDGE_CAP /
// candidateIntelligence.js's MAX_RECOMMENDED_PROBES: a JD-emphasised topic
// gets a meaningful nudge, never enough to make baseline priority
// irrelevant on its own.
const JD_BOOST = 20;
const MAX_GUIDANCE_CONCEPTS = 4;

function jdBoostFor(concept, jdRequirements) {
  const reqText = arr(jdRequirements).map((r) => `${str(r?.requirement)} ${str(r?.evidence_quote)}`).join(" ").toLowerCase();
  if (!reqText.trim()) return 0;
  const hit = arr(concept.keywords).some((kw) => reqText.includes(str(kw).toLowerCase()));
  return hit ? JD_BOOST : 0;
}

function scoreConcept(concept, candidateState, jdRequirements) {
  const info = candidateState?.competencies?.[concept.label];
  const jdBoost = jdBoostFor(concept, jdRequirements);
  if (!info || !info.tests) {
    return { score: clamp(concept.priority + jdBoost, 0, 200), statusLabel: "not yet tested", tests: 0 };
  }
  const recentStrength = info.mostRecentEvidence?.strength;
  const strengthAdj = RECENT_STRENGTH_ADJUSTMENT[recentStrength] ?? 0;
  const trendAdj = TREND_ADJUSTMENT[info.trend] ?? 0;
  const score = clamp(concept.priority + jdBoost + strengthAdj + trendAdj, 0, 200);
  let statusLabel;
  if (recentStrength === "strong" || info.trend === "improving") statusLabel = "demonstrated strongly";
  else if (recentStrength === "weak" || recentStrength === "contradictory" || info.trend === "declining") statusLabel = "weak — worth revisiting";
  else statusLabel = "tested, moderate evidence";
  return { score, statusLabel, tests: info.tests };
}

function pickArchetype(concept, testCount) {
  const archetypes = arr(concept.archetypes).map((a) => str(a));
  if (!archetypes.length) return `Ask a natural interview question testing "${concept.label}".`;
  return archetypes[testCount % archetypes.length];
}

/**
 * buildKnowledgeGuidance({ domain, category, pipeline, candidateState,
 *   transcript, jdRequirements })
 *
 * The single structured output this module exists to produce. Returns
 * null whenever the layer isn't applicable OR the domain has no concepts
 * for this category OR every relevant concept has already been asked this
 * interview (never fabricates guidance from nothing). Otherwise returns:
 *   { domainLabel, priorityConcepts: [{ label, statusLabel }],
 *     targetConcept: { label, archetype } }
 *
 * transcript: this interview's OWN turns so far (App.jsx's live shape,
 *   [{ question: { competency }, ... }]) — used ONLY to exclude a concept
 *   already asked THIS interview (hard exclusion, not merely
 *   deprioritisation: "do not repeat a recently asked question" is a hard
 *   requirement, not a preference). Cross-interview history (whether a
 *   concept was tested in a DIFFERENT past interview) comes from
 *   candidateState instead, which naturally persists across interviews —
 *   no separate "recently tested" store needed.
 * jdRequirements: profile.interview_profile.jd_requirements — reused
 *   verbatim, never re-extracted.
 *
 * Never throws: any malformed input degrades to null.
 */
export function buildKnowledgeGuidance({ domain, category, pipeline, candidateState, transcript, jdRequirements } = {}) {
  if (!isKnowledgeLayerApplicable({ pipeline, category, domain })) return null;
  const concepts = getDomainConcepts(domain, category);
  if (!concepts.length) return null;

  const askedThisInterview = new Set(
    arr(transcript).map((t) => str(t?.question?.competency).toLowerCase()).filter(Boolean)
  );
  const candidates = concepts.filter((c) => !askedThisInterview.has(str(c.label).toLowerCase()));
  if (!candidates.length) return null;

  const scored = candidates
    .map((concept) => ({ concept, ...scoreConcept(concept, candidateState, jdRequirements) }))
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, MAX_GUIDANCE_CONCEPTS);
  const target = top[0];
  return {
    domainLabel: str(domain.label),
    priorityConcepts: top.map((s) => ({ label: s.concept.label, statusLabel: s.statusLabel })),
    targetConcept: { label: target.concept.label, archetype: pickArchetype(target.concept, target.tests) },
  };
}
