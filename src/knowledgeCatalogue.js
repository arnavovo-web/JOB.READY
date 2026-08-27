/* ================================================================== *
 * PHASE 9 — SCALABLE INTERVIEW KNOWLEDGE INFRASTRUCTURE: CATALOGUE DATA
 * ------------------------------------------------------------------
 * DATA ONLY. This module is the single canonical home for:
 *   - the small group -> domain taxonomy (KNOWLEDGE_DOMAIN_GROUPS)
 *   - the deterministic role/JD keyword -> domain map (KNOWLEDGE_DOMAINS)
 *   - the flat canonical concept catalogue (KNOWLEDGE_CONCEPTS)
 *
 * It contains NO logic: no domain resolution, no concept selection, no
 * prompt building, no scoring. Those live in interviewKnowledge.js, which
 * imports this file. Keeping the catalogue as inert, serialisable data is
 * the whole point of Phase 9 — it must stay easy to read, easy to extend
 * (a new concept is one object literal, no code change anywhere), easy to
 * diff in review, and trivially testable for integrity.
 *
 * This file imports NOTHING (see the purity test in knowledgeCatalogue.test.js).
 * The canonical category strings used in `categories` below are the exact
 * six from methodology.js's CATEGORIES — they are written as literals here
 * rather than imported so this stays a zero-dependency data module; the
 * integrity test cross-checks every one of them against methodology.js so
 * they can never silently drift.
 *
 *  -------------------------------------------------------------------
 *  CANONICAL CONCEPT SCHEMA (every entry in KNOWLEDGE_CONCEPTS)
 *  -------------------------------------------------------------------
 *  id                    unique, stable, snake_case. Never reused/renamed
 *                        once shipped (it's the anti-repetition key and a
 *                        relationship target).
 *  label                 human-readable, unique (case-insensitively) across
 *                        the WHOLE catalogue. Used VERBATIM as the competency
 *                        stamped on a knowledge-guided question, so it doubles
 *                        as the Candidate State lookup key — a collision would
 *                        corrupt evidence across unrelated domains.
 *  domain                a KNOWLEDGE_DOMAINS id. Flat reference (Phase 6
 *                        nested concepts inside domain.topics[]; Phase 9
 *                        flattens that — the catalogue is now one list).
 *  subdomain             free-text grouping label within the domain (Phase 6's
 *                        `topic.label`). Organisational only — never matched
 *                        against, never affects selection. Keeps a large
 *                        future catalogue navigable.
 *  categories            which of methodology.js's canonical categories this
 *                        concept can legitimately be tested under — i.e. which
 *                        interview COMPONENTS it belongs to. This is the
 *                        primary applicability filter and is unchanged in
 *                        meaning from Phase 6. Never includes motivation_fit
 *                        or behavioural_competency (canonical knowledge must
 *                        never leak into those turns).
 *  importance            canonical 3-point scale: "core" | "important" |
 *                        "specialist". Replaces Phase 6's hand-tuned integer
 *                        `priority`. "core" = universally foundational for the
 *                        domain; "important" = commonly tested; "specialist" =
 *                        only relevant to particular teams/contexts. Maps to a
 *                        base priority via IMPORTANCE_BASE_PRIORITY. importance
 *                        alone never overrides interview context, candidate
 *                        evidence, explicit invitation context, or the
 *                        scheduler — see interviewKnowledge.js.
 *  difficulty            "foundational" | "intermediate" | "advanced" — the
 *                        SAME enum App.jsx's batch pipeline already uses. Not
 *                        a second scale.
 *  keywords              lower-case phrases for deterministic JD-requirement
 *                        and explicit-invitation-topic matching. Specific
 *                        multi-word phrases, never bare generic words.
 *  applicableStages      OPTIONAL array of INTERVIEW_STAGES keys. Omitted or
 *                        empty => applies to every stage (the overwhelming
 *                        default). A non-empty list restricts the concept to
 *                        those stages ONLY when the caller supplies a stage —
 *                        callers that don't pass interview context are
 *                        completely unaffected (backwards compatible).
 *  applicableFormats     OPTIONAL array of INTERVIEW_FORMATS keys. Same
 *                        semantics as applicableStages.
 *  relatedConceptIds     OPTIONAL lightweight sibling links (ids in this same
 *                        catalogue). Declarative structure only — Phase 9 does
 *                        NOT run any graph algorithm over these. Exposed by
 *                        the selection API for future UI / future phases.
 *  prerequisiteConceptIds OPTIONAL lightweight "you'd normally understand X
 *                        first" links. Same rules as relatedConceptIds.
 *  archetypes            1-N natural-language question stems. The model still
 *                        owns HOW to ask; these only capture WHAT to test.
 *                        Never contain the concept id or any internal label.
 *
 *  Fields deliberately NOT added (the brief lists them as candidates, but
 *  nothing in the current or near-future architecture consumes them, and
 *  the brief explicitly warns against speculative overengineering):
 *  description, conceptType, commonMisconceptions, evidenceLevel,
 *  sourceMetadata, applicableRoles (role targeting is already handled by
 *  domain resolution + keywords), applicableComponents (that IS `categories`).
 * ================================================================== */

// ---- 9.1 importance scale -------------------------------------------------
export const IMPORTANCE_LEVELS = ["core", "important", "specialist"];

// Base priority contributed by importance alone, BEFORE any interview-context,
// JD, invitation, or candidate-evidence adjustment. Deliberately coarse (three
// values, not seven hand-tuned integers) — fine-grained ordering within an
// importance band falls back to catalogue declaration order, which is
// authored high-value-first within each domain/subdomain.
export const IMPORTANCE_BASE_PRIORITY = { core: 70, important: 55, specialist: 40 };

export const DIFFICULTY_LEVELS = ["foundational", "intermediate", "advanced"];

// ---- 9.2 group -> domain taxonomy --------------------------------------
// A shallow, deliberately small grouping over the existing 9 domains so a
// future large catalogue stays organisable. This is presentational/
// structural metadata ONLY — domain RESOLUTION (interviewKnowledge.js)
// still matches roleKeywords against the same 9 domains exactly as in
// Phase 6; groups are never matched against and never affect selection.
export const KNOWLEDGE_DOMAIN_GROUPS = [
  { id: "finance", label: "Finance", domainIds: ["investment_banking", "sales_and_trading", "private_equity", "accounting"] },
  { id: "technology", label: "Technology", domainIds: ["software_engineering", "data_science", "product_management"] },
  { id: "business", label: "Business", domainIds: ["consulting", "marketing"] },
];

// ---- 9.3 domains (resolution map) -------------------------------------
// id / label / roleKeywords are UNCHANGED from Phase 6 — domain resolution
// behaviour must not move. `group` is the only new field. roleKeywords are
// specific multi-word phrases (never bare "analyst") so substring matching
// stays precise. No two domains share a roleKeyword (integrity-tested).
export const KNOWLEDGE_DOMAINS = [
  { id: "investment_banking", label: "Investment Banking", group: "finance",
    roleKeywords: ["investment banking", "ib analyst", "equity capital markets", "debt capital markets", "leveraged finance", "m&a advisory", "mergers and acquisitions"] },
  { id: "sales_and_trading", label: "Sales & Trading", group: "finance",
    roleKeywords: ["sales and trading", "global markets", "fx trading", "fixed income trading", "equities trading", "trading desk", "market making"] },
  { id: "private_equity", label: "Private Equity", group: "finance",
    roleKeywords: ["private equity", "leveraged buyout", "lbo analyst", "portfolio company"] },
  { id: "consulting", label: "Management Consulting", group: "business",
    roleKeywords: ["management consulting", "strategy consulting", "case interview", "case study interview"] },
  { id: "accounting", label: "Accounting", group: "finance",
    roleKeywords: ["audit associate", "assurance associate", "chartered accountant", "acca", "tax advisory", "external audit"] },
  { id: "software_engineering", label: "Software Engineering", group: "technology",
    roleKeywords: ["software engineer", "backend developer", "frontend developer", "full stack developer", "software development engineer"] },
  { id: "data_science", label: "Data Science", group: "technology",
    roleKeywords: ["data scientist", "machine learning engineer", "ml engineer", "data science analyst"] },
  { id: "product_management", label: "Product Management", group: "technology",
    roleKeywords: ["product manager", "associate product manager", "product management"] },
  { id: "marketing", label: "Marketing", group: "business",
    roleKeywords: ["marketing", "brand management", "digital marketing", "growth marketing"] },
];

// ---- 9.4 canonical concept catalogue --------------------------------
// Flat list. Every Phase 6 concept is migrated VERBATIM (same id, label,
// keywords, difficulty, archetypes, categories) with `priority: <int>`
// replaced by `importance: <level>` on this mapping:
//   priority >= 65  -> "core"
//   priority 50-64  -> "important"
//   priority < 50   -> "specialist"
// A small number of genuinely high-value Investment Banking valuation/LBO
// concepts are added (marked NEW-P9) to (a) close obvious gaps the module's
// own docstring already cites — DCF references WACC and terminal value — and
// (b) exercise every new schema field (applicableStages, relationships,
// "specialist"/importance). This is NOT a catalogue expansion phase.
export const KNOWLEDGE_CONCEPTS = [
  /* ============ Investment Banking ============ */
  { id: "ib_three_statements", label: "Three financial statements", domain: "investment_banking", subdomain: "Accounting & Financial Statements",
    categories: ["technical_functional"], importance: "core", difficulty: "foundational",
    keywords: ["financial statements", "income statement", "balance sheet", "cash flow statement"],
    relatedConceptIds: ["ib_statement_linkage", "ib_working_capital", "ib_depreciation"], prerequisiteConceptIds: [],
    archetypes: [
      "Ask the candidate to name the three financial statements and briefly describe what each one shows.",
      "Ask how a specific transaction (e.g. buying equipment with cash) would flow through all three statements.",
    ] },
  { id: "ib_statement_linkage", label: "Statement linkage", domain: "investment_banking", subdomain: "Accounting & Financial Statements",
    categories: ["technical_functional"], importance: "core", difficulty: "intermediate",
    keywords: ["net income flows", "linkage", "retained earnings", "statements link"],
    relatedConceptIds: ["ib_three_statements", "ib_working_capital"], prerequisiteConceptIds: ["ib_three_statements"],
    archetypes: [
      "Ask the candidate to walk through how net income links the income statement to the balance sheet and cash flow statement.",
      "Give a scenario (e.g. a $10m increase in depreciation) and ask how it flows through all three statements.",
    ] },
  { id: "ib_working_capital", label: "Working capital", domain: "investment_banking", subdomain: "Accounting & Financial Statements",
    categories: ["technical_functional"], importance: "important", difficulty: "intermediate",
    keywords: ["working capital", "receivables", "payables", "inventory"],
    relatedConceptIds: ["ib_three_statements"], prerequisiteConceptIds: [],
    archetypes: ["Ask what working capital is and why an increase in it reduces free cash flow."] },
  { id: "ib_depreciation", label: "Depreciation & amortisation", domain: "investment_banking", subdomain: "Accounting & Financial Statements",
    categories: ["technical_functional"], importance: "important", difficulty: "foundational",
    keywords: ["depreciation", "amortisation", "capex", "non-cash"],
    relatedConceptIds: ["ib_three_statements"], prerequisiteConceptIds: [],
    archetypes: ["Ask why depreciation is added back in the cash flow statement despite reducing net income."] },
  { id: "ib_dcf", label: "DCF valuation", domain: "investment_banking", subdomain: "Valuation",
    categories: ["technical_functional"], importance: "core", difficulty: "advanced",
    keywords: ["dcf", "discounted cash flow", "wacc", "terminal value"],
    relatedConceptIds: ["ib_wacc", "ib_terminal_value", "ib_ev_vs_equity"], prerequisiteConceptIds: ["ib_three_statements"],
    archetypes: [
      "Ask the candidate to walk through, at a high level, how a DCF valuation is built.",
      "Ask what happens to a DCF valuation if the discount rate (WACC) increases, and why.",
    ] },
  { id: "ib_wacc", label: "WACC", domain: "investment_banking", subdomain: "Valuation", // NEW-P9
    categories: ["technical_functional"], importance: "core", difficulty: "intermediate",
    keywords: ["wacc", "weighted average cost of capital", "cost of equity", "cost of debt", "capm"],
    relatedConceptIds: ["ib_dcf", "ib_terminal_value"], prerequisiteConceptIds: [],
    archetypes: [
      "Ask the candidate to explain, at a high level, how WACC is calculated and what each component represents.",
      "Ask why a company's cost of equity is generally higher than its cost of debt.",
    ] },
  { id: "ib_terminal_value", label: "Terminal value", domain: "investment_banking", subdomain: "Valuation", // NEW-P9
    categories: ["technical_functional"], importance: "important", difficulty: "intermediate",
    keywords: ["terminal value", "gordon growth", "perpetuity growth", "exit multiple"],
    relatedConceptIds: ["ib_dcf", "ib_wacc"], prerequisiteConceptIds: ["ib_dcf"],
    archetypes: [
      "Ask the candidate to explain the two main methods for calculating terminal value in a DCF and their trade-offs.",
      "Ask roughly what proportion of a typical DCF's value sits in the terminal value, and why that matters.",
    ] },
  { id: "ib_trading_comps", label: "Trading comparables", domain: "investment_banking", subdomain: "Valuation",
    categories: ["technical_functional"], importance: "core", difficulty: "intermediate",
    keywords: ["trading comps", "comparable companies", "ev/ebitda"],
    relatedConceptIds: ["ib_precedent_transactions", "ib_ev_vs_equity"], prerequisiteConceptIds: [],
    archetypes: ["Ask how a trading comparables analysis is performed and what makes a company a good comparable."] },
  { id: "ib_precedent_transactions", label: "Precedent transactions", domain: "investment_banking", subdomain: "Valuation",
    categories: ["technical_functional"], importance: "important", difficulty: "intermediate",
    keywords: ["precedent transactions", "control premium", "deal comps"],
    relatedConceptIds: ["ib_trading_comps"], prerequisiteConceptIds: [],
    archetypes: ["Ask why precedent transaction multiples are usually higher than trading comps multiples."] },
  { id: "ib_ev_vs_equity", label: "Enterprise value vs equity value", domain: "investment_banking", subdomain: "Valuation",
    categories: ["technical_functional"], importance: "important", difficulty: "foundational",
    keywords: ["enterprise value", "equity value", "ev to equity bridge"],
    relatedConceptIds: ["ib_dcf", "ib_trading_comps"], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate to explain the difference between enterprise value and equity value, and how you bridge between them."] },
  { id: "ib_lbo_analysis", label: "LBO analysis", domain: "investment_banking", subdomain: "Valuation", // NEW-P9
    categories: ["technical_functional"], importance: "important", difficulty: "advanced",
    keywords: ["lbo analysis", "leveraged buyout model", "sponsor returns", "debt schedule"],
    applicableStages: ["technical", "final_round"],
    relatedConceptIds: ["pe_lbo_mechanics", "ib_wacc"], prerequisiteConceptIds: ["ib_dcf"],
    archetypes: [
      "Ask the candidate why a private equity buyer might be able to pay more for a business than a strategic buyer using an all-equity DCF.",
      "Ask, at a high level, how leverage amplifies equity returns in an LBO — and what the main risk of that is.",
    ] },
  { id: "ib_accretion_dilution", label: "Accretion/dilution", domain: "investment_banking", subdomain: "M&A",
    categories: ["technical_functional"], importance: "core", difficulty: "advanced",
    keywords: ["accretion", "dilution", "eps impact", "exchange ratio"],
    relatedConceptIds: ["ib_ev_vs_equity"], prerequisiteConceptIds: [],
    archetypes: [
      "Ask what makes an acquisition accretive or dilutive to the acquirer's EPS.",
      "Give a simplified acquirer/target P/E scenario and ask whether the deal would be accretive or dilutive.",
    ] },
  { id: "ib_synergies", label: "Synergies", domain: "investment_banking", subdomain: "M&A",
    categories: ["technical_functional", "commercial_awareness"], importance: "important", difficulty: "intermediate",
    keywords: ["synergies", "cost synergies", "revenue synergies"],
    relatedConceptIds: [], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate to distinguish cost synergies from revenue synergies and which are usually more reliable to underwrite."] },
  { id: "ib_purchase_accounting", label: "Purchase accounting", domain: "investment_banking", subdomain: "M&A",
    categories: ["technical_functional"], importance: "specialist", difficulty: "advanced",
    keywords: ["purchase accounting", "goodwill", "purchase price allocation"],
    relatedConceptIds: [], prerequisiteConceptIds: [],
    archetypes: ["Ask what goodwill represents and how it arises in an acquisition."] },
  { id: "ib_ma_rationale", label: "Recent M&A market context", domain: "investment_banking", subdomain: "M&A",
    categories: ["commercial_awareness"], importance: "important", difficulty: "intermediate",
    keywords: ["recent deal", "m&a activity", "deal rationale"],
    relatedConceptIds: [], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate to discuss a recent M&A deal they've followed and what the strategic rationale appeared to be."] },

  /* ============ Sales & Trading ============ */
  { id: "st_bond_pricing", label: "Bond pricing and yield", domain: "sales_and_trading", subdomain: "Markets",
    categories: ["technical_functional"], importance: "core", difficulty: "foundational",
    keywords: ["bond price", "yield", "coupon", "inverse relationship"],
    relatedConceptIds: ["st_duration_convexity"], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate to explain why bond prices and yields move inversely."] },
  { id: "st_duration_convexity", label: "Duration and convexity", domain: "sales_and_trading", subdomain: "Markets",
    categories: ["technical_functional"], importance: "important", difficulty: "advanced",
    keywords: ["duration", "convexity", "interest rate sensitivity"],
    relatedConceptIds: ["st_bond_pricing"], prerequisiteConceptIds: ["st_bond_pricing"],
    archetypes: ["Ask what duration measures and how convexity refines that estimate for larger rate moves."] },
  { id: "st_options_greeks", label: "Options and the Greeks", domain: "sales_and_trading", subdomain: "Markets",
    categories: ["technical_functional"], importance: "important", difficulty: "advanced",
    keywords: ["delta", "gamma", "vega", "theta", "options"],
    relatedConceptIds: [], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate to explain what delta measures for an option position."] },
  { id: "st_market_context", label: "Current market conditions", domain: "sales_and_trading", subdomain: "Markets",
    categories: ["commercial_awareness"], importance: "core", difficulty: "intermediate",
    keywords: ["central bank", "rate decision", "market volatility", "recent move"],
    relatedConceptIds: [], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate what's currently happening in a market they follow and how they'd position around it."] },

  /* ============ Private Equity ============ */
  { id: "pe_lbo_mechanics", label: "LBO mechanics", domain: "private_equity", subdomain: "LBO Mechanics",
    categories: ["technical_functional"], importance: "core", difficulty: "advanced",
    keywords: ["lbo", "leveraged buyout", "debt paydown"],
    relatedConceptIds: ["pe_returns_drivers", "pe_value_creation", "ib_lbo_analysis"], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate to walk through, at a high level, how a leveraged buyout generates returns."] },
  { id: "pe_returns_drivers", label: "Returns drivers (IRR/MOIC)", domain: "private_equity", subdomain: "LBO Mechanics",
    categories: ["technical_functional"], importance: "core", difficulty: "advanced",
    keywords: ["irr", "moic", "returns", "multiple expansion"],
    relatedConceptIds: ["pe_lbo_mechanics"], prerequisiteConceptIds: [],
    archetypes: ["Ask what the main drivers of returns are in a leveraged buyout (multiple expansion, deleveraging, EBITDA growth)."] },
  { id: "pe_value_creation", label: "Value creation levers", domain: "private_equity", subdomain: "LBO Mechanics",
    categories: ["technical_functional", "commercial_awareness"], importance: "important", difficulty: "intermediate",
    keywords: ["value creation", "operational improvement", "add-on acquisitions"],
    relatedConceptIds: ["pe_lbo_mechanics"], prerequisiteConceptIds: [],
    archetypes: ["Ask what a PE firm can actually do, operationally, to create value in a portfolio company beyond financial engineering."] },

  /* ============ Management Consulting ============ */
  { id: "consulting_profitability", label: "Profitability framework", domain: "consulting", subdomain: "Case Frameworks",
    categories: ["case_problem_solving", "situational_judgement"], importance: "core", difficulty: "foundational",
    keywords: ["profitability", "revenue minus cost", "profit decline"],
    relatedConceptIds: ["consulting_structuring"], prerequisiteConceptIds: [],
    archetypes: ["Pose a short profitability-decline scenario and ask how the candidate would structure their diagnosis."] },
  { id: "consulting_market_sizing", label: "Market sizing", domain: "consulting", subdomain: "Case Frameworks",
    categories: ["case_problem_solving", "situational_judgement"], importance: "core", difficulty: "intermediate",
    keywords: ["market sizing", "estimate the size", "top-down", "bottom-up"],
    relatedConceptIds: ["consulting_structuring"], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate to size a market (e.g. the market for umbrellas in a given city) and explain their approach."] },
  { id: "consulting_market_entry", label: "Market entry framework", domain: "consulting", subdomain: "Case Frameworks",
    categories: ["case_problem_solving", "situational_judgement"], importance: "important", difficulty: "intermediate",
    keywords: ["market entry", "should we enter", "new market"],
    relatedConceptIds: ["consulting_profitability"], prerequisiteConceptIds: [],
    archetypes: ["Pose a market-entry scenario and ask what factors the candidate would evaluate before recommending entry."] },
  { id: "consulting_structuring", label: "Structuring an ambiguous problem", domain: "consulting", subdomain: "Case Frameworks",
    categories: ["case_problem_solving", "situational_judgement"], importance: "important", difficulty: "foundational",
    keywords: ["structure the problem", "issue tree", "hypothesis"],
    relatedConceptIds: ["consulting_profitability", "consulting_market_sizing"], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate how they'd structure their thinking before diving into an ambiguous business problem."] },

  /* ============ Accounting ============ */
  { id: "acc_double_entry", label: "Double-entry bookkeeping", domain: "accounting", subdomain: "Core Accounting",
    categories: ["technical_functional"], importance: "core", difficulty: "foundational",
    keywords: ["double entry", "debits and credits", "journal entry"],
    relatedConceptIds: ["acc_revenue_recognition"], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate to explain double-entry bookkeeping with a simple example."] },
  { id: "acc_revenue_recognition", label: "Revenue recognition", domain: "accounting", subdomain: "Core Accounting",
    categories: ["technical_functional"], importance: "important", difficulty: "intermediate",
    keywords: ["revenue recognition", "when is revenue recognised"],
    relatedConceptIds: [], prerequisiteConceptIds: [],
    archetypes: ["Ask when revenue should be recognised for a multi-year service contract, and why."] },
  { id: "acc_deferred_tax", label: "Deferred tax", domain: "accounting", subdomain: "Core Accounting",
    categories: ["technical_functional"], importance: "specialist", difficulty: "advanced",
    keywords: ["deferred tax", "temporary difference"],
    relatedConceptIds: [], prerequisiteConceptIds: [],
    archetypes: ["Ask what a deferred tax liability represents and how it typically arises."] },
  { id: "acc_audit_risk", label: "Audit risk assessment", domain: "accounting", subdomain: "Core Accounting",
    categories: ["technical_functional", "situational_judgement"], importance: "important", difficulty: "intermediate",
    keywords: ["audit risk", "materiality", "control risk"],
    relatedConceptIds: [], prerequisiteConceptIds: [],
    archetypes: ["Ask how the candidate would assess audit risk and materiality for a new client engagement."] },

  /* ============ Software Engineering ============ */
  { id: "swe_big_o", label: "Time/space complexity (Big O)", domain: "software_engineering", subdomain: "Computer Science Fundamentals",
    categories: ["technical_functional"], importance: "core", difficulty: "foundational",
    keywords: ["big o", "time complexity", "space complexity"],
    relatedConceptIds: ["swe_data_structures"], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate to explain what Big O notation measures and give an example of an O(n log n) algorithm."] },
  { id: "swe_data_structures", label: "Data structure trade-offs", domain: "software_engineering", subdomain: "Computer Science Fundamentals",
    categories: ["technical_functional"], importance: "core", difficulty: "intermediate",
    keywords: ["data structure", "hash map", "array vs linked list"],
    relatedConceptIds: ["swe_big_o"], prerequisiteConceptIds: [],
    archetypes: ["Ask when the candidate would choose a hash map over an array, and what the trade-offs are."] },
  { id: "swe_system_design", label: "System design fundamentals", domain: "software_engineering", subdomain: "Computer Science Fundamentals",
    categories: ["technical_functional"], importance: "important", difficulty: "advanced",
    keywords: ["system design", "scalability", "load balancing", "caching"],
    relatedConceptIds: [], prerequisiteConceptIds: ["swe_data_structures"],
    archetypes: ["Ask the candidate to sketch, at a high level, how they'd design a system to handle a large increase in read traffic."] },
  { id: "swe_concurrency", label: "Concurrency basics", domain: "software_engineering", subdomain: "Computer Science Fundamentals",
    categories: ["technical_functional"], importance: "important", difficulty: "advanced",
    keywords: ["concurrency", "race condition", "thread safety"],
    relatedConceptIds: [], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate to explain what a race condition is and how it can be avoided."] },

  /* ============ Data Science ============ */
  { id: "ds_bias_variance", label: "Bias-variance trade-off", domain: "data_science", subdomain: "Statistics & ML",
    categories: ["technical_functional"], importance: "core", difficulty: "intermediate",
    keywords: ["bias variance", "overfitting", "underfitting"],
    relatedConceptIds: ["ds_overfitting"], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate to explain the bias-variance trade-off in their own words."] },
  { id: "ds_overfitting", label: "Overfitting & regularisation", domain: "data_science", subdomain: "Statistics & ML",
    categories: ["technical_functional"], importance: "important", difficulty: "intermediate",
    keywords: ["overfitting", "regularisation", "l1 l2"],
    relatedConceptIds: ["ds_bias_variance"], prerequisiteConceptIds: [],
    archetypes: ["Ask how the candidate would detect and address overfitting in a model."] },
  { id: "ds_ab_testing", label: "A/B testing", domain: "data_science", subdomain: "Statistics & ML",
    categories: ["technical_functional", "situational_judgement"], importance: "important", difficulty: "intermediate",
    keywords: ["a/b test", "statistical significance", "experiment design"],
    relatedConceptIds: [], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate to design an A/B test for a proposed product change and what they'd measure."] },
  { id: "ds_model_eval", label: "Model evaluation metrics", domain: "data_science", subdomain: "Statistics & ML",
    categories: ["technical_functional"], importance: "important", difficulty: "foundational",
    keywords: ["precision", "recall", "f1 score", "auc"],
    relatedConceptIds: [], prerequisiteConceptIds: [],
    archetypes: ["Ask when the candidate would prioritise precision over recall, and give an example."] },

  /* ============ Product Management ============ */
  { id: "pm_prioritisation", label: "Prioritisation framework", domain: "product_management", subdomain: "Product Sense",
    categories: ["situational_judgement", "case_problem_solving"], importance: "core", difficulty: "foundational",
    keywords: ["prioritise", "roadmap", "impact vs effort"],
    relatedConceptIds: ["pm_metrics"], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate how they'd prioritise a backlog of competing feature requests."] },
  { id: "pm_metrics", label: "Defining success metrics", domain: "product_management", subdomain: "Product Sense",
    categories: ["situational_judgement", "case_problem_solving"], importance: "important", difficulty: "intermediate",
    keywords: ["success metrics", "north star metric", "kpi"],
    relatedConceptIds: ["pm_prioritisation"], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate what metrics they'd track to know whether a new feature was successful."] },
  { id: "pm_launch_strategy", label: "Product launch strategy", domain: "product_management", subdomain: "Product Sense",
    categories: ["situational_judgement"], importance: "important", difficulty: "intermediate",
    keywords: ["launch strategy", "go to market", "rollout"],
    relatedConceptIds: [], prerequisiteConceptIds: [],
    archetypes: ["Ask how the candidate would approach launching a new feature to minimise risk."] },

  /* ============ Marketing ============ */
  { id: "mkt_mix", label: "Marketing mix (4Ps)", domain: "marketing", subdomain: "Marketing Fundamentals",
    categories: ["technical_functional", "situational_judgement"], importance: "important", difficulty: "foundational",
    keywords: ["marketing mix", "4ps", "product price place promotion"],
    relatedConceptIds: ["mkt_segmentation"], prerequisiteConceptIds: [],
    archetypes: ["Ask the candidate to apply the marketing mix (4Ps) to a product of their choice."] },
  { id: "mkt_segmentation", label: "Customer segmentation", domain: "marketing", subdomain: "Marketing Fundamentals",
    categories: ["technical_functional", "situational_judgement"], importance: "important", difficulty: "intermediate",
    keywords: ["segmentation", "target audience", "customer persona"],
    relatedConceptIds: ["mkt_mix"], prerequisiteConceptIds: [],
    archetypes: ["Ask how the candidate would segment the customer base for a given product."] },
  { id: "mkt_roi", label: "Campaign measurement & ROI", domain: "marketing", subdomain: "Marketing Fundamentals",
    categories: ["technical_functional"], importance: "important", difficulty: "intermediate",
    keywords: ["campaign roi", "conversion rate", "attribution"],
    relatedConceptIds: [], prerequisiteConceptIds: [],
    archetypes: ["Ask how the candidate would measure whether a marketing campaign was successful."] },
];
