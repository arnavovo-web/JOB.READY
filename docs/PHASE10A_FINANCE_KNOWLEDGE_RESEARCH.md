# Phase 10A — Research-backed finance interview knowledge expansion

**Scope:** curate the static interview knowledge catalogue (`src/knowledgeCatalogue.js`)
for four finance domains — Investment Banking, Private Equity, Sales & Trading,
Accounting — using development-time web research only. The shipped product performs
**no runtime web search, no new AI calls, no new database/vector store, no embeddings,
no RAG**. Research informed which *canonical concepts* to add; the existing Phase 9
selection engine and the existing question-generation AI call are unchanged.

## 1. Source categories consulted

Research cross-checked recurring concepts across several kinds of source rather than
relying on any single site. Findings are paraphrased; no substantial external text is
reproduced.

| Category | Examples used |
| --- | --- |
| Recognised interview-preparation / financial-training resources | Mergers & Inquisitions, Breaking Into Wall Street, Wall Street Prep, Corporate Finance Institute, Financial Edge |
| University / professional-body career resources | ICAEW careers guidance, ACCA technical articles |
| Aggregated question banks & guides | IGotAnOffer, Wall Street Oasis, sector interview guides |
| Candidate-experience discussion (supplementary only, never treated as universal) | forum threads referenced by the guides above for *frequency* signal, not as primary evidence |

A concept was only added if it recurred across **at least two independent source
categories**. Single-anecdote topics were rejected (see §5).

## 2. Domains researched

- **Investment Banking** — accounting foundations, valuation, M&A, LBO/leverage, capital markets.
- **Private Equity** — how PE interviews *differ* from IB: investment judgement, the paper-LBO
  format, returns attribution (IRR vs MOIC), leverage/debt structure, diligence, fund economics.
- **Sales & Trading** — core Global Markets knowledge (macro, central banks, yield curve,
  asset classes, market making, trade ideas) vs desk-specialist knowledge (derivatives,
  credit spreads, structured products).
- **Accounting** — separated financial reporting (accruals, inventory, provisions, leases,
  reporting frameworks, ratios) from audit (materiality, assertions, internal controls,
  going concern, opinion types).

## 3. Canonical concept selection methodology

Each candidate concept had to pass the Phase 10A granularity test:

> *Could multiple substantially different interview questions reasonably test this same
> underlying knowledge?*

- **Yes** → a canonical concept (e.g. "Enterprise value vs equity value", "Paper LBO",
  "Yield curve", "Materiality").
- **No** → it is a *question*, not a concept, and belongs under a broader concept
  (e.g. "walk me through a £10 depreciation increase" is a question generated from
  "Three financial statements" / "Depreciation & amortisation").

Concepts were then graded on the **existing Phase 9 importance scale** (no second
taxonomy was invented):

- `core` — repeatedly expected, foundational, broadly relevant in that domain.
- `important` — frequently relevant, depends on role / interview context.
- `specialist` — relevant only to particular desks, teams, or later-stage interviews.
  Specialist S&T derivatives-family concepts additionally carry
  `applicableStages: ["technical", "final_round"]` so a generic early screen never
  draws them in.

## 4. How shared concepts were handled

Finance domains overlap. Rather than duplicate a concept under `ib_dcf` / `pe_dcf`
(which would fragment Candidate State evidence and invite near-duplicate drift),
Phase 10A adds two **optional, backwards-compatible** schema fields:

- `sharedWithDomains: [domainId, …]` — the concept has one *home* `domain` plus the
  other domains whose interviews genuinely test the same knowledge. Selection treats
  the concept as "in" domain D when D is the home domain **or** D is in this list.
- `domainArchetypes: { [domainId]: [stem, …] }` — domain-specific question guidance for
  a shared concept. Example: **DCF** is framed as *"explain the mechanics and
  assumptions"* for Investment Banking and *"frame a maximum entry price / evaluate the
  returns implications"* for Private Equity.

Shared concepts in this phase:

| Concept | Home | Also applies to | Why |
| --- | --- | --- | --- |
| Three financial statements | IB | Accounting | Identical foundational knowledge |
| Depreciation & amortisation | IB | Accounting | Same concept; accounting adds impairment/method framing |
| DCF valuation | IB | Private Equity | Same method; PE frames it around ability-to-pay / returns |
| Enterprise value vs equity value | IB | Private Equity | Same bridge; PE frames it around the equity cheque |
| EBITDA and adjustments | IB | Private Equity | Same metric; PE scrutinises add-backs in diligence |
| Unlevered free cash flow | IB | Private Equity | Same build; PE frames it as cash for debt paydown |
| Sources and uses | IB | Private Equity | Same table; central to the paper LBO |
| Valuation multiples | IB | Private Equity | Same relative-valuation knowledge |
| Deferred tax | Accounting | Investment Banking | Recurring (if less common) IB accounting question, esp. in an M&A context |
| Financial ratio analysis | Accounting | Investment Banking | Same analytical toolkit |

PE keeps its **own** deeper `pe_lbo_mechanics` rather than sharing `ib_lbo_analysis`
(which stays IB-home, for "IB analysts should know LBO basics"); the two are
deliberately distinct in depth and framing and never co-occur in one domain's pool.

## 5. Major concepts deliberately excluded, and why

- **"Why investment banking / why this firm"** — a motivation-fit question, not
  canonical *knowledge*. The knowledge layer's gate already excludes `motivation_fit`
  and `behavioural_competency` turns, so such a concept could never be selected.
- **Every individual DCF input** (mid-year convention, stub periods, normalising capex,
  levered vs unlevered beta, size premium, …) — fragmentation. Covered by
  `ib_dcf` / `ib_wacc` / `ib_unlevered_fcf` / `ib_terminal_value`.
- **"Understanding the income statement" / "…the balance sheet" / "how financial
  statements work"** — these are the same canonical concept, kept as one
  ("Three financial statements") with statement linkage as its own concept.
- **Separate "goodwill" concept** — covered by `ib_purchase_accounting`.
- **Dividend recapitalisation as a standalone concept** — a value-creation lever,
  covered by `pe_value_creation` / `pe_exit_strategy`.
- **Firm-specific deal sheets / "know our recent deals"** — not static, not canonical;
  handled elsewhere by the JD/company context, not the knowledge layer.
- **Brainteasers as literal question banks** — excluded; the *reasoning* concept
  ("Expected value and probability") is included instead.
- **Highly exotic derivatives pricing (e.g. specific exotic payoffs, full option
  pricing model derivations)** — beyond the level of the interviews this product
  targets; `st_derivatives` / `st_structured_products` capture the interview-relevant
  layer and are stage-gated.
- **Tax/legal deal structuring detail, accounting for pensions/financial instruments in
  depth** — too specialist for the current catalogue; candidates for a later phase.

## 6. Outcome

- Concepts before Phase 10A: **44** (41 Phase 6 + 3 Phase 9).
- Concepts after Phase 10A: **86** — **+42 new canonical concepts**
  (IB +8, PE +10, Sales & Trading +13, Accounting +11), plus **10 concepts**
  gaining a second domain via `sharedWithDomains`.
- No Phase 6/9 concept was removed or relabelled. Labels are Candidate State keys, so
  they are immutable once shipped.
- Effective per-domain pool (home + shared-in): Investment Banking ≈ 25,
  Private Equity ≈ 20, Sales & Trading ≈ 17, Accounting ≈ 17.

## 7. Limitations of the research

- Sources are predominantly UK/US market and graduate/junior-hire oriented; the
  catalogue reflects that. Other geographies or lateral/senior hiring may weight
  concepts differently.
- Interview practice evolves (rate environment, deal activity, standard-setting). The
  catalogue captures *durable* canonical knowledge, not this quarter's hot topics —
  those are deliberately out of scope for a static layer.
- Frequency/importance grades are a curated judgement informed by cross-source
  agreement, not a quantitative study.
- "Recent deals / current market" style content is represented only as a *category of
  knowledge to test* (`ib_ma_rationale`, `st_market_context`), never as specific facts.

## 8. Remaining knowledge gaps (candidates for a later phase)

- Deeper accounting: financial instruments, pensions, consolidation/NCI, foreign
  currency translation, share-based payments.
- Restructuring / distressed, project finance, infrastructure, real estate finance.
- Asset management / equity research (distinct from S&T) as their own domain.
- Growth equity / venture as distinct from buyout PE.
- Quant / systematic trading as distinct from flow S&T.
- Non-UK/US reporting frameworks and market structure specifics.
