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
 *                        catalogue). Declarative structure only — no graph
 *                        algorithm runs over these. Exposed by the selection
 *                        API for future UI / future phases.
 *  prerequisiteConceptIds OPTIONAL lightweight "you'd normally understand X
 *                        first" links. Same rules as relatedConceptIds.
 *  archetypes            1-N natural-language question stems. The model still
 *                        owns HOW to ask; these only capture WHAT to test.
 *                        Never contain the concept id or any internal label.
 *
 *  -------------------------------------------------------------------
 *  PHASE 10A ADDITIONS (all OPTIONAL, all backwards compatible — a concept
 *  without them behaves exactly as in Phase 9)
 *  -------------------------------------------------------------------
 *  sharedWithDomains     OPTIONAL array of OTHER KNOWLEDGE_DOMAINS ids this
 *                        concept also legitimately belongs to. A genuinely
 *                        canonical concept (DCF, EV vs equity value, the
 *                        three statements, deferred tax) that is tested in
 *                        more than one domain's interview keeps ONE home
 *                        `domain` + this list, instead of being duplicated
 *                        under a second id/label. Selection treats the
 *                        concept as in domain D when D === domain OR D is in
 *                        this list. Omitted => single-domain (the default).
 *  domainArchetypes      OPTIONAL { [domainId]: [stems...] }. Domain-specific
 *                        question guidance for a shared concept — e.g. DCF
 *                        framed as "explain the mechanics" for IB vs
 *                        "evaluate the returns implications" for PE. When a
 *                        selection runs for a domain that has an entry here,
 *                        those stems are used instead of `archetypes`.
 *  misconceptions        OPTIONAL array (kept to <=3, each one short phrase)
 *                        of "candidates commonly get this wrong" notes. The
 *                        prompt builder surfaces at most two, for the TARGET
 *                        concept only — never a per-priority-concept list —
 *                        so the prompt stays bounded as the catalogue grows.
 *                        Concise, never an essay.
 *
 *  Fields still deliberately NOT added (nothing consumes them; the brief
 *  warns against speculative overengineering): description, conceptType
 *  (subdomain already groups concepts), evidenceLevel, sourceMetadata
 *  (research provenance is documented in docs/PHASE10A_FINANCE_KNOWLEDGE_RESEARCH.md,
 *  not per-row), applicableRoles (domain resolution + keywords already do
 *  role targeting), applicableComponents (that IS `categories`).
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

// ---- 9.4 / 10A canonical concept catalogue --------------------------------
// Flat list. Phase 6 concepts were migrated verbatim; Phase 9 added 3 IB
// valuation concepts (marked NEW-P9).
//
// PHASE 10A — research-backed finance expansion (marked NEW-P10A). Curated
// against multiple recognised interview-preparation sources (see
// docs/PHASE10A_FINANCE_KNOWLEDGE_RESEARCH.md) for four finance domains:
// Investment Banking, Private Equity, Sales & Trading, Accounting. Each new
// entry is a CANONICAL concept — knowledge a candidate is expected to
// understand, from which the AI can generate many different questions — not
// a hardcoded question. Concepts genuinely shared across finance domains
// (DCF, EV vs equity value, EBITDA, the three statements, deferred tax,
// ratio analysis...) are represented ONCE with `sharedWithDomains` +
// per-domain `domainArchetypes`, never duplicated. Desk/team-specialist
// topics carry `importance: "specialist"` and, where appropriate,
// `applicableStages` so a generic screen never draws them in.
export const KNOWLEDGE_CONCEPTS = [
  /* ============ Investment Banking ============ */
  { id: "ib_three_statements", label: "Three financial statements", domain: "investment_banking", subdomain: "Accounting & Financial Statements",
    categories: ["technical_functional"], importance: "core", difficulty: "foundational",
    keywords: ["financial statements", "income statement", "balance sheet", "cash flow statement"],
    sharedWithDomains: ["accounting"], // NEW-P10A: the same canonical concept, not an "acc_" duplicate
    relatedConceptIds: ["ib_statement_linkage", "ib_working_capital", "ib_depreciation"], prerequisiteConceptIds: [],
    misconceptions: ["Confusing cash movements with profit", "Forgetting the balance sheet must always balance"],
    archetypes: [
      "Ask the candidate to name the three financial statements and briefly describe what each one shows.",
      "Ask how a specific transaction (e.g. buying equipment with cash) would flow through all three statements.",
    ],
    domainArchetypes: {
      accounting: [
        "Ask the candidate to explain the purpose of each primary financial statement and how they relate to one another.",
        "Ask how the cash flow statement is built from the income statement and the movement in balance sheet items.",
      ],
    } },
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
    sharedWithDomains: ["accounting"], // NEW-P10A
    relatedConceptIds: ["ib_three_statements"], prerequisiteConceptIds: [],
    misconceptions: ["Treating depreciation as a cash outflow in the period", "Confusing depreciation with an asset impairment"],
    archetypes: ["Ask why depreciation is added back in the cash flow statement despite reducing net income."],
    domainArchetypes: {
      accounting: [
        "Ask the candidate to compare straight-line and reducing-balance depreciation and when each is appropriate.",
        "Ask how an impairment of a non-current asset differs from ordinary depreciation.",
      ],
    } },
  { id: "ib_dcf", label: "DCF valuation", domain: "investment_banking", subdomain: "Valuation",
    categories: ["technical_functional"], importance: "core", difficulty: "advanced",
    keywords: ["dcf", "discounted cash flow", "wacc", "terminal value"],
    sharedWithDomains: ["private_equity"], // NEW-P10A: same concept, PE frames it around ability-to-pay / returns
    relatedConceptIds: ["ib_wacc", "ib_terminal_value", "ib_ev_vs_equity", "ib_unlevered_fcf"], prerequisiteConceptIds: ["ib_three_statements"],
    misconceptions: ["Discounting levered cash flows at WACC", "Assuming the terminal value is a small part of the answer"],
    archetypes: [
      "Ask the candidate to walk through, at a high level, how a DCF valuation is built.",
      "Ask what happens to a DCF valuation if the discount rate (WACC) increases, and why.",
    ],
    domainArchetypes: {
      private_equity: [
        "Ask how a sponsor would use a DCF or ability-to-pay analysis to frame a maximum entry price, and how that differs from a strategic buyer's view.",
        "Ask what a DCF tells a financial buyer that an LBO returns analysis does not, and vice versa.",
      ],
    } },
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
    keywords: ["enterprise value", "equity value", "ev to equity bridge", "net debt bridge"],
    sharedWithDomains: ["private_equity"], // NEW-P10A
    relatedConceptIds: ["ib_dcf", "ib_trading_comps", "ib_multiples"], prerequisiteConceptIds: [],
    misconceptions: ["Adding cash instead of subtracting it in the bridge", "Thinking a bigger company by equity value always has a bigger enterprise value"],
    archetypes: ["Ask the candidate to explain the difference between enterprise value and equity value, and how you bridge between them."],
    domainArchetypes: {
      private_equity: [
        "Ask the candidate to bridge from purchase enterprise value to the sponsor's equity cheque in a buyout, including debt, cash and fees.",
        "Ask why a PE firm cares about enterprise value at entry but equity value at exit.",
      ],
    } },
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
    keywords: ["deferred tax", "temporary difference", "deferred tax liability", "book tax difference"],
    sharedWithDomains: ["investment_banking"], // NEW-P10A: a recurring (if less common) IB accounting question, esp. in an M&A context
    relatedConceptIds: ["acc_provisions"], prerequisiteConceptIds: [],
    misconceptions: ["Confusing a deferred tax liability with tax actually owed to the authorities", "Assuming book and tax depreciation are always the same"],
    archetypes: ["Ask what a deferred tax liability represents and how it typically arises."],
    domainArchetypes: {
      investment_banking: [
        "Ask how a deferred tax liability can arise from a write-up of assets in an acquisition, and what it means for the combined company.",
        "Ask why book and tax treatment of depreciation can diverge and create a deferred tax balance.",
      ],
    } },
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

  /* ================================================================== *
   * PHASE 10A — RESEARCH-BACKED FINANCE EXPANSION (all NEW-P10A)
   * Curated against multiple recognised interview-prep sources — see
   * docs/PHASE10A_FINANCE_KNOWLEDGE_RESEARCH.md. Appended (not interleaved)
   * so the diff is a clean add and Phase 6/9 concepts keep their catalogue
   * index (the deterministic within-band tie-break — older, more
   * foundational concepts still win ties).
   * ================================================================== */

  /* ------------------ Investment Banking (NEW-P10A) ------------------ */
  { id: "ib_cash_vs_profit", label: "Cash vs profit", domain: "investment_banking", subdomain: "Accounting & Financial Statements",
    categories: ["technical_functional"], importance: "core", difficulty: "foundational",
    keywords: ["cash versus profit", "profit but no cash", "profitable but insolvent", "cash conversion"],
    relatedConceptIds: ["ib_three_statements", "ib_working_capital"], prerequisiteConceptIds: [],
    misconceptions: ["Assuming a profitable company cannot run out of cash", "Treating net income as cash generated in the period"],
    archetypes: [
      "Ask the candidate how a company can be profitable on the income statement yet run out of cash.",
      "Ask what the main reasons are for a gap between a company's net income and its operating cash flow.",
    ] },
  { id: "ib_ebitda", label: "EBITDA and adjustments", domain: "investment_banking", subdomain: "Valuation",
    categories: ["technical_functional"], importance: "core", difficulty: "foundational",
    keywords: ["ebitda", "adjusted ebitda", "ebitda add-backs", "operating profitability proxy"],
    sharedWithDomains: ["private_equity"],
    relatedConceptIds: ["ib_dcf", "ib_trading_comps", "ib_multiples"], prerequisiteConceptIds: [],
    misconceptions: ["Treating EBITDA as a cash flow figure", "Ignoring capex, working capital and taxes when relying on EBITDA"],
    archetypes: [
      "Ask the candidate what EBITDA is meant to approximate and where it can be misleading.",
      "Ask why two companies with identical EBITDA can have very different free cash flow.",
    ],
    domainArchetypes: {
      private_equity: [
        "Ask why sponsors anchor so heavily on EBITDA and entry/exit multiples, and which add-backs they scrutinise in diligence.",
      ],
    } },
  { id: "ib_unlevered_fcf", label: "Unlevered free cash flow", domain: "investment_banking", subdomain: "Valuation",
    categories: ["technical_functional"], importance: "core", difficulty: "intermediate",
    keywords: ["unlevered free cash flow", "free cash flow to the firm", "cash flow before financing", "ufcf build"],
    sharedWithDomains: ["private_equity"],
    relatedConceptIds: ["ib_dcf", "ib_wacc", "ib_working_capital"], prerequisiteConceptIds: ["ib_three_statements"],
    misconceptions: ["Subtracting interest expense when building an unlevered figure", "Forgetting to adjust for capex and working capital changes"],
    archetypes: [
      "Ask the candidate to walk through building unlevered free cash flow from operating profit.",
      "Ask why interest is excluded from unlevered free cash flow but included in the levered version.",
    ],
    domainArchetypes: {
      private_equity: [
        "Ask the candidate to build the free cash flow available for debt paydown in an LBO and which line items matter most.",
      ],
    } },
  { id: "ib_multiples", label: "Valuation multiples", domain: "investment_banking", subdomain: "Valuation",
    categories: ["technical_functional"], importance: "core", difficulty: "foundational",
    keywords: ["valuation multiple", "ev/ebitda multiple", "price to earnings multiple", "ev/ebit", "ev/revenue", "which multiple to use"],
    sharedWithDomains: ["private_equity"],
    relatedConceptIds: ["ib_trading_comps", "ib_ebitda", "ib_ev_vs_equity"], prerequisiteConceptIds: [],
    misconceptions: ["Comparing an equity multiple with an enterprise multiple", "Using P/E across companies with very different leverage"],
    archetypes: [
      "Ask the candidate why EV/EBITDA is often preferred to P/E, and when P/E is still the right choice.",
      "Ask what it means when a company trades at a premium multiple to its peers.",
    ] },
  { id: "ib_valuation_methods", label: "Choosing a valuation methodology", domain: "investment_banking", subdomain: "Valuation",
    categories: ["technical_functional"], importance: "important", difficulty: "foundational",
    keywords: ["valuation methodologies", "which valuation method", "intrinsic versus relative valuation", "which approach gives the highest value"],
    relatedConceptIds: ["ib_dcf", "ib_trading_comps", "ib_precedent_transactions", "ib_multiples"], prerequisiteConceptIds: [],
    misconceptions: ["Believing one method produces the single correct value", "Mixing up intrinsic (DCF) and relative (comps) approaches"],
    archetypes: [
      "Ask the candidate to compare the main valuation methodologies and when each is most appropriate.",
      "Ask which valuation approach typically produces the highest value and why.",
    ] },
  { id: "ib_ma_process", label: "M&A deal process", domain: "investment_banking", subdomain: "M&A",
    categories: ["technical_functional"], importance: "important", difficulty: "foundational",
    keywords: ["sell-side process", "buy-side process", "m&a auction", "deal timeline", "due diligence phase"],
    relatedConceptIds: ["ib_ma_rationale", "ib_accretion_dilution"], prerequisiteConceptIds: [],
    misconceptions: ["Confusing the sell-side and buy-side advisory roles", "Thinking the bank sets the price rather than advising on it"],
    archetypes: [
      "Ask the candidate to outline the main stages of a sell-side M&A process.",
      "Ask what an advisor actually does for a client during a competitive auction.",
    ] },
  { id: "ib_sources_and_uses", label: "Sources and uses", domain: "investment_banking", subdomain: "M&A",
    categories: ["technical_functional"], importance: "important", difficulty: "intermediate",
    keywords: ["sources and uses", "sources and uses of funds", "funding a transaction", "uses of funds"],
    sharedWithDomains: ["private_equity"],
    relatedConceptIds: ["ib_lbo_analysis", "ib_accretion_dilution", "pe_paper_lbo"], prerequisiteConceptIds: [],
    misconceptions: ["Leaving transaction fees out of the uses", "Forgetting that sources must equal uses"],
    archetypes: [
      "Ask the candidate what goes into the sources and uses table for an acquisition.",
      "Ask how the equity contribution is derived once debt and other sources are set.",
    ],
    domainArchetypes: {
      private_equity: [
        "Ask the candidate to lay out the sources and uses for a simple buyout and derive the sponsor equity cheque.",
      ],
    } },
  { id: "ib_capital_markets", label: "Capital markets and the IPO process", domain: "investment_banking", subdomain: "Capital Markets",
    categories: ["technical_functional", "commercial_awareness"], importance: "important", difficulty: "intermediate",
    keywords: ["ipo process", "equity capital markets", "debt capital markets", "primary issuance", "bookbuilding"],
    relatedConceptIds: ["ib_ev_vs_equity", "ib_ma_rationale"], prerequisiteConceptIds: [],
    misconceptions: ["Confusing a primary capital raise with a secondary share sale", "Judging an IPO only by the first-day price move"],
    archetypes: [
      "Ask the candidate to walk through the main steps of taking a company public.",
      "Ask when a company would raise debt rather than equity, and what that choice signals.",
    ] },

  /* ------------------ Private Equity (NEW-P10A) ------------------ */
  { id: "pe_investment_thesis", label: "Investment thesis", domain: "private_equity", subdomain: "Investment Process",
    categories: ["technical_functional", "commercial_awareness"], importance: "core", difficulty: "foundational",
    keywords: ["investment thesis", "why is this a good investment", "angle on the deal", "value creation plan"],
    relatedConceptIds: ["pe_value_creation", "pe_commercial_dd", "pe_lbo_candidate"], prerequisiteConceptIds: [],
    misconceptions: ["Listing generic strengths instead of a differentiated angle", "Ignoring how the sponsor specifically improves the business"],
    archetypes: [
      "Ask the candidate to pitch, in a few sentences, the investment thesis for a company they know.",
      "Ask what would make them pass on an otherwise attractive-looking business.",
    ] },
  { id: "pe_lbo_candidate", label: "Ideal LBO candidate", domain: "private_equity", subdomain: "Investment Process",
    categories: ["technical_functional"], importance: "core", difficulty: "foundational",
    keywords: ["ideal lbo candidate", "good buyout target", "stable predictable cash flows", "what makes a company a good lbo"],
    relatedConceptIds: ["pe_lbo_mechanics", "pe_commercial_dd"], prerequisiteConceptIds: [],
    misconceptions: ["Prioritising high growth over cash flow stability", "Overlooking cyclicality and customer concentration"],
    archetypes: [
      "Ask the candidate what characteristics make a company a strong leveraged buyout candidate.",
      "Ask which industries tend to be poor LBO candidates and why.",
    ] },
  { id: "pe_leverage_debt", label: "Leverage and debt structure", domain: "private_equity", subdomain: "Returns & Leverage",
    categories: ["technical_functional"], importance: "important", difficulty: "intermediate",
    keywords: ["leverage ratio", "debt to ebitda", "senior and subordinated debt", "interest coverage", "debt covenants", "debt tranches"],
    relatedConceptIds: ["pe_returns_drivers", "pe_lbo_mechanics"], prerequisiteConceptIds: [],
    misconceptions: ["Assuming more leverage is always better for equity returns", "Ignoring refinancing and covenant risk"],
    archetypes: [
      "Ask the candidate how a sponsor decides how much debt to put on a buyout.",
      "Ask what limits how much leverage a lender will provide.",
    ] },
  { id: "pe_entry_exit_multiple", label: "Entry and exit multiples", domain: "private_equity", subdomain: "Returns & Leverage",
    categories: ["technical_functional"], importance: "important", difficulty: "intermediate",
    keywords: ["entry multiple", "exit multiple", "multiple expansion", "multiple contraction", "purchase multiple assumption"],
    relatedConceptIds: ["pe_returns_drivers", "ib_multiples"], prerequisiteConceptIds: [],
    misconceptions: ["Relying on multiple expansion as a base-case return driver", "Assuming you exit at the entry multiple with no justification"],
    archetypes: [
      "Ask the candidate how the entry and exit multiple assumptions drive an LBO's returns.",
      "Ask when it is reasonable to assume multiple expansion at exit.",
    ] },
  { id: "pe_paper_lbo", label: "Paper LBO", domain: "private_equity", subdomain: "Returns & Leverage",
    categories: ["technical_functional", "case_problem_solving"], importance: "important", difficulty: "intermediate",
    keywords: ["paper lbo", "paper lbo walkthrough", "quick irr estimate", "back of the envelope buyout"],
    applicableStages: ["first_round", "technical", "final_round"],
    relatedConceptIds: ["pe_returns_drivers", "ib_sources_and_uses"], prerequisiteConceptIds: ["pe_lbo_mechanics"],
    misconceptions: ["Chasing precision instead of a clean approximation", "Forgetting to subtract debt paydown when computing exit equity"],
    archetypes: [
      "Give a short one-paragraph buyout scenario and ask the candidate to estimate the IRR and MOIC without a calculator.",
      "Ask the candidate to talk through the steps of a paper LBO at a high level.",
    ] },
  { id: "pe_commercial_dd", label: "Commercial due diligence", domain: "private_equity", subdomain: "Investment Process",
    categories: ["technical_functional", "commercial_awareness"], importance: "important", difficulty: "intermediate",
    keywords: ["commercial due diligence", "market diligence", "customer concentration risk", "competitive positioning", "diligence red flags"],
    relatedConceptIds: ["pe_investment_thesis", "pe_lbo_candidate"], prerequisiteConceptIds: [],
    misconceptions: ["Treating diligence as only a financial and legal exercise", "Missing demand-side risks such as churn or concentration"],
    archetypes: [
      "Ask the candidate what questions commercial due diligence tries to answer about a target.",
      "Ask what red flags in a target's customer base would concern them.",
    ] },
  { id: "pe_management_assessment", label: "Management team assessment", domain: "private_equity", subdomain: "Investment Process",
    categories: ["technical_functional", "situational_judgement"], importance: "specialist", difficulty: "intermediate",
    keywords: ["management team assessment", "backing the management team", "management incentive plan", "equity rollover"],
    applicableStages: ["first_round", "final_round"],
    relatedConceptIds: ["pe_value_creation"], prerequisiteConceptIds: [],
    misconceptions: ["Assuming existing management is always retained", "Ignoring how incentives align management with the sponsor"],
    archetypes: [
      "Ask the candidate how a sponsor assesses whether to back the existing management team.",
      "Ask why management equity rollover and incentive plans matter in a buyout.",
    ] },
  { id: "pe_exit_strategy", label: "Exit strategy", domain: "private_equity", subdomain: "Returns & Leverage",
    categories: ["technical_functional", "commercial_awareness"], importance: "important", difficulty: "intermediate",
    keywords: ["exit strategy", "strategic sale", "secondary buyout", "ipo exit", "holding period"],
    relatedConceptIds: ["pe_returns_drivers", "pe_entry_exit_multiple"], prerequisiteConceptIds: [],
    misconceptions: ["Assuming an IPO is always the best exit route", "Ignoring how holding period trades IRR against MOIC"],
    archetypes: [
      "Ask the candidate what exit routes a sponsor considers and what drives the choice.",
      "Ask how the planned exit shapes decisions made at entry.",
    ] },
  { id: "pe_irr_vs_moic", label: "IRR vs MOIC", domain: "private_equity", subdomain: "Returns & Leverage",
    categories: ["technical_functional"], importance: "core", difficulty: "intermediate",
    keywords: ["irr versus moic", "time value of returns", "cash on cash return", "annualised return versus money multiple"],
    relatedConceptIds: ["pe_returns_drivers", "pe_exit_strategy"], prerequisiteConceptIds: [],
    misconceptions: ["Assuming a higher MOIC always means a higher IRR", "Ignoring the effect of holding period and interim distributions"],
    archetypes: [
      "Ask the candidate to explain the difference between IRR and MOIC and when the two disagree.",
      "Ask how an early dividend recapitalisation affects IRR versus MOIC.",
    ] },
  { id: "pe_fund_economics", label: "Fund economics (fees and carry)", domain: "private_equity", subdomain: "Fund",
    categories: ["technical_functional", "commercial_awareness"], importance: "important", difficulty: "foundational",
    keywords: ["management fee", "carried interest", "two and twenty", "general partner and limited partner", "hurdle rate", "fund structure"],
    relatedConceptIds: ["pe_returns_drivers"], prerequisiteConceptIds: [],
    misconceptions: ["Confusing carried interest with the management fee", "Forgetting the hurdle rate that must be cleared before carry"],
    archetypes: [
      "Ask the candidate how a private equity fund makes money for its partners.",
      "Ask what a hurdle rate is and why limited partners insist on one.",
    ] },

  /* ------------------ Sales & Trading (NEW-P10A) ------------------ */
  { id: "st_macro_drivers", label: "Macro drivers of markets", domain: "sales_and_trading", subdomain: "Macro & Rates",
    categories: ["commercial_awareness", "technical_functional"], importance: "core", difficulty: "foundational",
    keywords: ["monetary policy", "fiscal policy", "inflation data", "growth and unemployment data", "macro drivers"],
    relatedConceptIds: ["st_central_banks", "st_market_context"], prerequisiteConceptIds: [],
    misconceptions: ["Treating a single data release as decisive", "Ignoring what the market has already priced in"],
    archetypes: [
      "Ask the candidate which macroeconomic indicators they watch most closely and why.",
      "Ask how a surprise inflation print might move rates, equities and the currency.",
    ] },
  { id: "st_central_banks", label: "Central bank policy", domain: "sales_and_trading", subdomain: "Macro & Rates",
    categories: ["commercial_awareness", "technical_functional"], importance: "core", difficulty: "intermediate",
    keywords: ["central bank policy", "interest rate decision", "quantitative easing", "forward guidance", "policy rate"],
    relatedConceptIds: ["st_macro_drivers", "st_yield_curve"], prerequisiteConceptIds: [],
    misconceptions: ["Confusing conventional rate policy with asset purchases", "Assuming a rate hike always strengthens the currency"],
    archetypes: [
      "Ask the candidate to explain how a central bank rate change transmits through to the wider economy.",
      "Ask what quantitative easing is trying to achieve and through what channels.",
    ] },
  { id: "st_yield_curve", label: "Yield curve", domain: "sales_and_trading", subdomain: "Macro & Rates",
    categories: ["technical_functional"], importance: "core", difficulty: "intermediate",
    keywords: ["yield curve", "inverted yield curve", "curve steepening", "curve flattening", "term structure of rates"],
    relatedConceptIds: ["st_bond_pricing", "st_central_banks"], prerequisiteConceptIds: [],
    misconceptions: ["Reading an inversion as an immediate recession", "Confusing the level of rates with the slope of the curve"],
    archetypes: [
      "Ask the candidate what the shape of the yield curve tells you about market expectations.",
      "Ask what it means when the curve steepens versus flattens.",
    ] },
  { id: "st_fx_basics", label: "FX fundamentals", domain: "sales_and_trading", subdomain: "Macro & Rates",
    categories: ["technical_functional"], importance: "important", difficulty: "intermediate",
    keywords: ["exchange rate drivers", "interest rate differential", "currency pair", "carry trade", "purchasing power parity"],
    relatedConceptIds: ["st_central_banks", "st_macro_drivers"], prerequisiteConceptIds: [],
    misconceptions: ["Assuming higher rates always mean a stronger currency", "Ignoring risk sentiment and positioning"],
    archetypes: [
      "Ask the candidate what drives the value of one currency against another.",
      "Ask how a carry trade works and what risk it carries.",
    ] },
  { id: "st_bid_ask_making", label: "Bid-ask spread and market making", domain: "sales_and_trading", subdomain: "Market Structure & Risk",
    categories: ["technical_functional"], importance: "core", difficulty: "foundational",
    keywords: ["bid ask spread", "market making", "provide liquidity", "two-way price", "inventory risk"],
    relatedConceptIds: ["st_market_context", "st_risk_measures"], prerequisiteConceptIds: [],
    misconceptions: ["Thinking a market maker mainly takes directional bets", "Ignoring inventory and adverse-selection risk"],
    archetypes: [
      "Ask the candidate how a market maker makes money from the bid-ask spread.",
      "Ask how a market maker should adjust their quote after taking on a large position.",
    ] },
  { id: "st_risk_measures", label: "Trading risk measures", domain: "sales_and_trading", subdomain: "Market Structure & Risk",
    categories: ["technical_functional"], importance: "important", difficulty: "intermediate",
    keywords: ["value at risk", "position limits", "stop loss discipline", "pnl attribution", "risk budget"],
    relatedConceptIds: ["st_options_greeks", "st_bid_ask_making"], prerequisiteConceptIds: [],
    misconceptions: ["Reading value at risk as a worst-case loss", "Ignoring liquidity and tail risk"],
    archetypes: [
      "Ask the candidate what value at risk measures and where it falls short.",
      "Ask how a desk should think about position limits and stop-losses.",
    ] },
  { id: "st_expected_value", label: "Expected value and probability", domain: "sales_and_trading", subdomain: "Market Structure & Risk",
    categories: ["technical_functional", "case_problem_solving"], importance: "important", difficulty: "foundational",
    keywords: ["expected value", "probability reasoning", "fair value of a bet", "risk-neutral thinking", "payoff and probability"],
    relatedConceptIds: ["st_trade_idea", "st_risk_measures"], prerequisiteConceptIds: [],
    misconceptions: ["Confusing expected value with the most likely outcome", "Ignoring low-probability, high-impact outcomes"],
    archetypes: [
      "Pose a simple game with a payoff and probabilities and ask the candidate for its fair value.",
      "Ask the candidate how they would decide whether a given bet is worth taking.",
    ] },
  { id: "st_asset_classes", label: "Asset class fundamentals", domain: "sales_and_trading", subdomain: "Products",
    categories: ["technical_functional"], importance: "core", difficulty: "foundational",
    keywords: ["asset classes", "equities and fixed income", "fx and commodities", "credit and rates", "cross-asset"],
    relatedConceptIds: ["st_bond_pricing", "st_macro_drivers"], prerequisiteConceptIds: [],
    misconceptions: ["Assuming asset classes always move independently", "Confusing a bond's coupon with its yield"],
    archetypes: [
      "Ask the candidate which asset class interests them most and how it behaves differently from the others.",
      "Ask how equities and government bonds typically respond to a growth scare.",
    ] },
  { id: "st_equities_basics", label: "Equities fundamentals", domain: "sales_and_trading", subdomain: "Products",
    categories: ["technical_functional"], importance: "important", difficulty: "foundational",
    keywords: ["equity index", "dividend and buyback", "market capitalisation", "equity beta", "earnings and multiples"],
    relatedConceptIds: ["st_asset_classes"], prerequisiteConceptIds: [],
    misconceptions: ["Treating price as the same thing as value", "Assuming a headline index is equally weighted"],
    archetypes: [
      "Ask the candidate what moves an individual stock versus the whole market.",
      "Ask how a share buyback differs from a dividend for shareholders.",
    ] },
  { id: "st_trade_idea", label: "Structuring a trade idea", domain: "sales_and_trading", subdomain: "Trading Approach",
    categories: ["commercial_awareness", "situational_judgement"], importance: "core", difficulty: "intermediate",
    keywords: ["trade idea", "express a market view", "trade catalyst", "risk reward on a trade", "position sizing"],
    relatedConceptIds: ["st_market_context", "st_risk_measures"], prerequisiteConceptIds: [],
    misconceptions: ["Pitching a view with no catalyst or time horizon", "Not saying how the trade would be sized or stopped out"],
    archetypes: [
      "Ask the candidate to pitch a trade idea, including the catalyst, the risk and how they would size it.",
      "Ask what would make them cut the trade.",
    ] },
  { id: "st_derivatives", label: "Derivatives fundamentals", domain: "sales_and_trading", subdomain: "Products",
    categories: ["technical_functional"], importance: "specialist", difficulty: "advanced",
    keywords: ["forwards and futures", "swaps", "call and put options", "payoff diagram", "hedging with derivatives"],
    applicableStages: ["technical", "final_round"],
    relatedConceptIds: ["st_options_greeks", "st_risk_measures"], prerequisiteConceptIds: [],
    misconceptions: ["Confusing a forward (obligation) with an option (right)", "Ignoring margin and counterparty considerations"],
    archetypes: [
      "Ask the candidate to sketch the payoff of a call option at expiry and explain it.",
      "Ask how a company might use a forward or swap to hedge a specific risk.",
    ] },
  { id: "st_credit_spreads", label: "Credit spreads", domain: "sales_and_trading", subdomain: "Products",
    categories: ["technical_functional"], importance: "specialist", difficulty: "advanced",
    keywords: ["credit spread", "credit default swap", "default risk premium", "spread duration", "investment grade versus high yield"],
    applicableStages: ["technical", "final_round"],
    relatedConceptIds: ["st_bond_pricing", "st_yield_curve"], prerequisiteConceptIds: [],
    misconceptions: ["Attributing all spread moves to default risk", "Ignoring liquidity and technical drivers of spreads"],
    archetypes: [
      "Ask the candidate what a credit spread compensates an investor for.",
      "Ask what typically happens to credit spreads when equity markets sell off.",
    ] },
  { id: "st_structured_products", label: "Structured products", domain: "sales_and_trading", subdomain: "Products",
    categories: ["technical_functional"], importance: "specialist", difficulty: "advanced",
    keywords: ["structured product", "structured note", "capital protected note", "autocallable", "client hedging solution"],
    applicableStages: ["technical", "final_round"],
    relatedConceptIds: ["st_derivatives"], prerequisiteConceptIds: [],
    misconceptions: ["Assuming capital protection is free", "Ignoring the embedded optionality and how it is priced"],
    archetypes: [
      "Ask the candidate why a client might buy a structured note rather than the underlying directly.",
      "Ask where the cost of a capital-protected product actually comes from.",
    ] },

  /* ------------------ Accounting (NEW-P10A) ------------------ */
  { id: "acc_accruals", label: "Accruals and the matching concept", domain: "accounting", subdomain: "Financial Reporting",
    categories: ["technical_functional"], importance: "core", difficulty: "foundational",
    keywords: ["accruals concept", "matching principle", "accrual versus cash accounting", "prepayments and accruals"],
    relatedConceptIds: ["acc_revenue_recognition", "acc_double_entry"], prerequisiteConceptIds: [],
    misconceptions: ["Equating profit with cash received", "Recognising an expense when it is paid rather than when it is incurred"],
    archetypes: [
      "Ask the candidate to explain the accruals concept with a simple example.",
      "Ask how a prepayment and an accrual each affect the financial statements.",
    ] },
  { id: "acc_ratios", label: "Financial ratio analysis", domain: "accounting", subdomain: "Financial Reporting",
    categories: ["technical_functional"], importance: "important", difficulty: "foundational",
    keywords: ["financial ratio analysis", "current ratio", "return on equity", "gearing ratio", "gross margin", "interest cover"],
    sharedWithDomains: ["investment_banking"],
    relatedConceptIds: ["ib_three_statements"], prerequisiteConceptIds: [],
    misconceptions: ["Reading a ratio with no benchmark or trend", "Ignoring how accounting policy choices distort comparability"],
    archetypes: [
      "Ask the candidate which ratios they would look at first to assess a company's health, and why.",
      "Ask how two companies with the same profit margin could still be very different investments.",
    ] },
  { id: "acc_inventory", label: "Inventory valuation", domain: "accounting", subdomain: "Financial Reporting",
    categories: ["technical_functional"], importance: "important", difficulty: "intermediate",
    keywords: ["inventory valuation", "fifo", "weighted average cost", "lower of cost and net realisable value", "stock count"],
    relatedConceptIds: ["acc_revenue_recognition"], prerequisiteConceptIds: [],
    misconceptions: ["Believing last-in-first-out is permitted under IFRS", "Carrying inventory at selling price rather than the lower of cost and NRV"],
    archetypes: [
      "Ask the candidate how inventory should be valued at the balance sheet date.",
      "Ask how the choice of cost formula affects reported profit when prices are rising.",
    ] },
  { id: "acc_provisions", label: "Provisions and contingencies", domain: "accounting", subdomain: "Financial Reporting",
    categories: ["technical_functional"], importance: "important", difficulty: "intermediate",
    keywords: ["provision recognition", "contingent liability", "onerous contract", "restructuring provision", "constructive obligation"],
    relatedConceptIds: ["acc_deferred_tax"], prerequisiteConceptIds: [],
    misconceptions: ["Confusing a provision with a contingent liability", "Providing for future operating losses"],
    archetypes: [
      "Ask the candidate what conditions must be met before a provision can be recognised.",
      "Ask how a provision differs from a contingent liability in the accounts.",
    ] },
  { id: "acc_leases", label: "Lease accounting", domain: "accounting", subdomain: "Financial Reporting",
    categories: ["technical_functional"], importance: "specialist", difficulty: "advanced",
    keywords: ["lease accounting", "right-of-use asset", "lease liability", "operating versus finance lease", "ifrs 16"],
    relatedConceptIds: ["ib_depreciation"], prerequisiteConceptIds: [],
    misconceptions: ["Thinking operating leases stay off balance sheet under IFRS 16", "Ignoring the front-loaded expense profile of a lease"],
    archetypes: [
      "Ask the candidate how a lessee accounts for a lease under current standards.",
      "Ask what changed when leases moved onto the balance sheet.",
    ] },
  { id: "acc_reporting_standards", label: "Financial reporting frameworks", domain: "accounting", subdomain: "Financial Reporting",
    categories: ["technical_functional"], importance: "important", difficulty: "foundational",
    keywords: ["ifrs versus us gaap", "principles-based standards", "rules-based standards", "reporting framework", "accounting policy choice"],
    relatedConceptIds: ["acc_revenue_recognition", "acc_leases"], prerequisiteConceptIds: [],
    misconceptions: ["Assuming IFRS and US GAAP always give the same numbers", "Thinking principles-based means there are no rules"],
    archetypes: [
      "Ask the candidate to explain the difference between principles-based and rules-based standards.",
      "Ask why the same transaction can be reported differently under two frameworks.",
    ] },
  { id: "acc_materiality", label: "Materiality", domain: "accounting", subdomain: "Audit",
    categories: ["technical_functional", "situational_judgement"], importance: "core", difficulty: "foundational",
    keywords: ["materiality", "performance materiality", "materiality benchmark", "quantitative and qualitative materiality"],
    relatedConceptIds: ["acc_audit_risk"], prerequisiteConceptIds: [],
    misconceptions: ["Treating materiality as a purely numerical cut-off", "Setting materiality once and never revisiting it"],
    archetypes: [
      "Ask the candidate how an auditor decides what is material for a given client.",
      "Ask for an example of something quantitatively small that would still be material.",
    ] },
  { id: "acc_audit_assertions", label: "Audit assertions and procedures", domain: "accounting", subdomain: "Audit",
    categories: ["technical_functional"], importance: "important", difficulty: "intermediate",
    keywords: ["audit assertions", "existence and completeness", "valuation assertion", "substantive procedures", "test of controls"],
    relatedConceptIds: ["acc_audit_risk", "acc_materiality"], prerequisiteConceptIds: [],
    misconceptions: ["Confusing tests of controls with substantive procedures", "Believing a sample gives absolute assurance"],
    archetypes: [
      "Ask the candidate what assertions they are testing when they audit a revenue balance.",
      "Ask the difference between a test of controls and a substantive procedure.",
    ] },
  { id: "acc_internal_controls", label: "Internal controls", domain: "accounting", subdomain: "Audit",
    categories: ["technical_functional", "situational_judgement"], importance: "important", difficulty: "intermediate",
    keywords: ["internal control environment", "segregation of duties", "control deficiency", "controls testing", "management override"],
    relatedConceptIds: ["acc_audit_assertions", "acc_audit_risk"], prerequisiteConceptIds: [],
    misconceptions: ["Assuming controls remove rather than reduce risk", "Overlooking management override of controls"],
    archetypes: [
      "Ask the candidate why segregation of duties matters and give an example.",
      "Ask how an auditor responds when a key control is found to be missing.",
    ] },
  { id: "acc_going_concern", label: "Going concern", domain: "accounting", subdomain: "Audit",
    categories: ["technical_functional", "situational_judgement"], importance: "important", difficulty: "intermediate",
    keywords: ["going concern assessment", "material uncertainty", "liquidity and solvency indicators", "twelve month assessment"],
    relatedConceptIds: ["acc_audit_risk"], prerequisiteConceptIds: [],
    misconceptions: ["Treating going concern as only about current-year losses", "Assuming a going concern issue always means a modified opinion"],
    archetypes: [
      "Ask the candidate what indicators would make them question whether a company is a going concern.",
      "Ask what the accounts look like if the going concern basis no longer applies.",
    ] },
  { id: "acc_audit_opinion", label: "Audit opinion types", domain: "accounting", subdomain: "Audit",
    categories: ["technical_functional"], importance: "specialist", difficulty: "intermediate",
    keywords: ["audit opinion", "unqualified opinion", "qualified opinion", "adverse opinion", "disclaimer of opinion", "emphasis of matter"],
    relatedConceptIds: ["acc_going_concern", "acc_audit_assertions"], prerequisiteConceptIds: [],
    misconceptions: ["Confusing a qualified opinion with an adverse one", "Thinking an emphasis-of-matter paragraph changes the opinion"],
    archetypes: [
      "Ask the candidate to describe the main types of audit opinion and when each is issued.",
      "Ask what a qualified 'except for' opinion is telling the reader.",
    ] },
];
