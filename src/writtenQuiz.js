/* ================================================================== *
 * PHASE 14 / PHASE 21 — DETERMINISTIC WRITTEN-QUIZ MARKING
 * ------------------------------------------------------------------
 * A pure, deterministic module (same shape as questionMix.js /
 * applicationIntelligence.js — no AI call, no network, no React, no
 * database, never throws). It marks a free-response quiz answer by
 * CONCEPT COVERAGE against the machine-readable concept metadata that
 * the ONE Development Module generation call already produced.
 *
 * It does NOT try to "understand" the answer and it is NOT a semantic
 * model. It answers exactly one question per expected concept: "did the
 * student's answer actually express this idea?" — using phrase matching
 * over a normalised token stream, plus generator-supplied alternative
 * phrasings / aliases, conservative morphological folding, a small
 * abbreviation table, and (Phase 21) an optional generator-supplied
 * one-sentence `definition` as a tolerant fallback signal.
 *
 * ANTI-FALSE-POSITIVE (retained): a multi-word concept is only credited
 * when ALL of its content tokens appear close together (or as an exact
 * run) — one incidental shared keyword in an unrelated sentence never
 * credits a concept. Morphological folding for a SINGLE-token bare label
 * is only applied to distinctive (>=5 char) terms, so a short homonym
 * like "value" is never credited from "valued".
 *
 * ANTI-FALSE-NEGATIVE (Phase 21): case / punctuation / whitespace are
 * normalised; UK/US spelling is folded to one canonical form; a
 * conservative stemmer folds -ing/-ed/-s/-es/-ies/-ise↔-ize/-isation
 * etc.; a static abbreviation table plus per-concept `aliases` expand
 * synonyms/initialisms; and the concept `definition` gives a tolerant
 * secondary path when the label/aliases are not lexically present.
 *
 * BACKWARD COMPATIBLE: a legacy concept `{ label, accepted_terms }` is
 * accepted unchanged and is treated as a REQUIRED concept — identical
 * coverage semantics to before Phase 21. New keys (`concept`,
 * `accepted_phrasings`, `aliases`, `definition`, `required`) are all
 * additive and optional.
 * ================================================================== */

// ---- local helpers (never throw) ---------------------------------
function str(v, fallback = "") {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Small, conservative stopword set — only truly structural words. We do
// NOT strip negations or any content word.
const STOPWORDS = new Set(
  ("a an the of to in on at for and or but is are was were be been being it its as by with "
  + "from into that this these those we you your our i my me he she they them their there here "
  + "then than so if not no do does did has have had will would can could should may might "
  + "about over under between within across per via")
  .split(/\s+/)
);

// UK/US and common orthographic variants -> ONE canonical form (we pick the
// UK "-ise/-isation/-yse" family as canonical because the rest of the app is
// UK-spelled). Applied BEFORE tokenising so multi-word terms fold too.
function normaliseSpelling(raw) {
  return str(raw)
    .toLowerCase()
    .replace(/ization\b/g, "isation")
    .replace(/izations\b/g, "isations")
    .replace(/([a-z])ize\b/g, "$1ise")
    .replace(/([a-z])izes\b/g, "$1ises")
    .replace(/([a-z])izing\b/g, "$1ising")
    .replace(/([a-z])ized\b/g, "$1ised")
    .replace(/yze\b/g, "yse")
    .replace(/yzed\b/g, "ysed")
    .replace(/yzing\b/g, "ysing")
    .replace(/\bcolor/g, "colour")
    .replace(/\bfavor/g, "favour")
    .replace(/\bmodeling\b/g, "modelling")
    .replace(/\bmodeled\b/g, "modelled")
    .replace(/\blabor\b/g, "labour")
    .replace(/\bdefense\b/g, "defence")
    .replace(/\blicense\b/g, "licence");
}

// light morphology: fold a few well-known finance/tech compound spellings
// and collapse whitespace/punctuation.
function foldText(raw) {
  return normaliseSpelling(raw)
    .replace(/cash\s*flows?/g, "cash flow")
    .replace(/cashflows?/g, "cash flow")
    .replace(/free\s*cash\s*flow/g, "free cash flow")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function depluralize(t) {
  return t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t;
}
function tokenize(raw) {
  const folded = foldText(raw);
  if (!folded) return [];
  return folded.split(" ").map(depluralize).filter(Boolean);
}

// content tokens: normalised, de-pluralised, structural stopwords removed.
// Used for BOTH the answer haystack and every concept phrase, so contiguous
// and proximity matching operate on the same footing.
function contentTokens(raw) {
  return tokenize(raw).filter((t) => !STOPWORDS.has(t));
}

// ---- Phase 21: conservative stemmer -----------------------------------
// Purpose: let "amortised" match "amortisation", "projecting" match
// "projection". Deliberately shallow — no Porter cascade, no vowel/consonant
// gymnastics — because over-stemming is how false positives creep in. A stem
// is only USED for matching when the term is "distinctive" (see stemEligible).
function stem(token) {
  let t = String(token || "");
  if (t.length <= 3) return t;
  // -isation / -ization already folded to -isation by normaliseSpelling
  if (t.endsWith("isations")) t = t.slice(0, -8) + "ise";
  else if (t.endsWith("isation")) t = t.slice(0, -7) + "ise";
  else if (t.endsWith("ised")) t = t.slice(0, -4) + "ise";
  else if (t.endsWith("ising")) t = t.slice(0, -5) + "ise";
  else if (t.endsWith("ically")) t = t.slice(0, -6) + "ic";
  else if (t.endsWith("ally")) t = t.slice(0, -4);
  else if (t.endsWith("ies") && t.length > 4) t = t.slice(0, -3) + "y";
  else if (t.endsWith("sses")) t = t.slice(0, -2);
  else if (t.endsWith("ing") && t.length > 5) t = t.slice(0, -3);
  else if (t.endsWith("edly")) t = t.slice(0, -4);
  else if (t.endsWith("ed") && t.length > 4) t = t.slice(0, -2);
  else if (t.endsWith("es") && t.length > 4 && /(s|x|z|ch|sh)es$/.test(token)) t = t.slice(0, -2);
  else if (t.endsWith("ly") && t.length > 4) t = t.slice(0, -2);
  else if (t.endsWith("s") && t.length > 3) t = t.slice(0, -1);
  // final trailing-e drop so "value"/"valued"/"valuing" all -> "valu"
  if (t.length > 4 && t.endsWith("e")) t = t.slice(0, -1);
  return t;
}
// A term is "distinctive" enough to be matched via its stem when standing
// alone (single-token bare label). Short common words ("value", "asset",
// "risk") are NOT — they must match strictly.
function stemEligible(token) {
  return String(token || "").length >= 5;
}

// Static abbreviation / initialism table. Bidirectional: an entry expands to
// its long form AND the long form contracts to the abbreviation. Kept small
// and finance/tech-general; per-concept `aliases` cover the rest.
const ABBREVIATIONS = {
  dcf: "discounted cash flow",
  lbo: "leveraged buyout",
  wacc: "weighted average cost of capital",
  npv: "net present value",
  irr: "internal rate of return",
  roe: "return on equity",
  roi: "return on investment",
  roic: "return on invested capital",
  ebit: "earnings before interest and tax",
  ebitda: "earnings before interest tax depreciation and amortisation",
  eps: "earnings per share",
  pe: "price to earnings",
  capex: "capital expenditure",
  opex: "operating expenditure",
  cogs: "cost of goods sold",
  fcf: "free cash flow",
  ma: "mergers and acquisitions",
  ipo: "initial public offering",
  kpi: "key performance indicator",
  tam: "total addressable market",
  b2b: "business to business",
  b2c: "business to consumer",
  saas: "software as a service",
  api: "application programming interface",
  sql: "structured query language",
  crm: "customer relationship management",
  star: "situation task action result",
};
const ABBREV_BY_LONG = Object.fromEntries(
  Object.entries(ABBREVIATIONS).map(([k, v]) => [contentTokens(v).map(stem).join(" "), k])
);

// does the ordered token run `needle` appear contiguously in `hay`?
// (token equality is on the pre-canonicalised stream — see canonTokens.)
function hasContiguousRun(hay, needle) {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

// do ALL of `needle`'s tokens appear in `hay` within a bounded window of
// each other? (order-insensitive proximity — catches "cash flows in the
// future" for "future cash flow" without crediting one stray keyword.)
function hasProximityRun(hay, needle) {
  if (!needle.length) return false;
  if (needle.length === 1) return hay.includes(needle[0]);
  const positions = needle.map((tok) => {
    const idx = [];
    for (let i = 0; i < hay.length; i++) if (hay[i] === tok) idx.push(i);
    return idx;
  });
  if (positions.some((p) => p.length === 0)) return false;
  const windowSize = needle.length * 2 + 6;
  for (const start of positions[0]) {
    let ok = true;
    for (let k = 1; k < positions.length; k++) {
      if (!positions[k].some((p) => Math.abs(p - start) <= windowSize)) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

// Canonicalise a token stream for MULTI-word phrase matching: every token is
// reduced to its stem so "projecting"/"projection"/"projects" all collide.
// (Multi-word phrases carry their own anti-false-positive guard via the
// contiguity/proximity requirement, so stemming every token here is safe.)
function canonTokens(tokens) {
  return arr(tokens).map(stem);
}

/**
 * conceptPhrases(concept) -> { multi: [tokenArray,...], single: [token,...] }
 * Every surface form of the concept — canonical label/`concept`, each
 * `accepted_terms` / `accepted_phrasings` entry, each `aliases` entry, and
 * (bidirectionally) any abbreviation expansion — split into:
 *   multi  : phrases of >=2 content tokens (matched on the STEMMED stream)
 *   single : lone content tokens (matched strictly, unless stem-eligible)
 * Dedups and drops empties.
 */
function conceptPhrases(concept) {
  const raw = [
    str(concept?.concept) || str(concept?.label),
    ...arr(concept?.accepted_terms).map((t) => str(t)),
    ...arr(concept?.accepted_phrasings).map((t) => str(t)),
    ...arr(concept?.aliases).map((t) => str(t)),
  ];

  // bidirectional abbreviation expansion
  const expanded = [];
  for (const phrase of raw) {
    if (!phrase) continue;
    expanded.push(phrase);
    const key = foldText(phrase).replace(/\s+/g, "");
    if (ABBREVIATIONS[key]) expanded.push(ABBREVIATIONS[key]);
    const longKey = contentTokens(phrase).map(stem).join(" ");
    if (ABBREV_BY_LONG[longKey]) expanded.push(ABBREV_BY_LONG[longKey]);
  }

  const seenMulti = new Set();
  const seenSingle = new Set();
  const multi = [];
  const single = [];
  for (const phrase of expanded) {
    const toks = contentTokens(phrase);
    if (!toks.length) continue;
    if (toks.length === 1) {
      const k = toks[0];
      if (!seenSingle.has(k)) { seenSingle.add(k); single.push(k); }
    } else {
      const canon = canonTokens(toks);
      const key = canon.join(" ");
      if (!seenMulti.has(key)) { seenMulti.add(key); multi.push(canon); }
    }
  }
  return { multi, single };
}

// A concept `definition` is a one-sentence plain-words statement of the idea.
// It provides a tolerant SECONDARY signal: credit the concept when a strong
// majority of its DISTINCTIVE definition tokens (canonised, minus tokens that
// merely echo the label) are present in the answer within proximity. Guarded:
// needs >=3 distinctive matches, so a single overlap can never trigger it.
function definitionCovered(rawAnswerContentTokens, answerStems, concept) {
  const def = str(concept?.definition).trim();
  if (!def) return false;
  const labelStemSet = new Set(
    canonTokens(contentTokens(str(concept?.concept) || str(concept?.label)))
  );
  const defTokens = contentTokens(def).map(stem)
    .filter((t) => t.length >= 4 && !labelStemSet.has(t));
  const distinctive = [...new Set(defTokens)];
  if (distinctive.length < 3) return false;
  const answerSet = new Set(answerStems);
  const present = distinctive.filter((t) => answerSet.has(t));
  if (present.length < 3) return false;
  if (present.length / distinctive.length < 0.7) return false;
  // proximity guard: the matched definition tokens must not be scattered to
  // opposite ends of a long answer.
  return hasProximityRun(answerStems, present.slice(0, Math.min(present.length, 6)));
}

/**
 * conceptIsCovered(answerTokens, concept) -> boolean
 * answerTokens: strict content tokens of the answer (as produced by
 *   contentTokens). This function derives the stemmed stream itself.
 */
function conceptIsCovered(answerTokens, concept) {
  const answerStems = canonTokens(answerTokens);
  const { multi, single } = conceptPhrases(concept);

  for (const phrase of multi) {
    if (hasContiguousRun(answerStems, phrase)) return true;
    if (hasProximityRun(answerStems, phrase)) return true;
  }
  for (const tok of single) {
    // strict: the raw (de-pluralised, spelling-normalised) token is present
    if (answerTokens.includes(tok)) return true;
    // stem match ONLY for distinctive terms, so short homonyms stay strict
    if (stemEligible(tok) && answerStems.includes(stem(tok))) return true;
  }
  if (definitionCovered(answerTokens, answerStems, concept)) return true;
  return false;
}

// ---- concept object normalisation (accepts legacy + Phase 21 shapes) --
/**
 * normaliseConcept(c) -> { label, concept, accepted_terms, accepted_phrasings,
 *                          aliases, definition, required }  |  null
 * `label` (display) = concept ?? label. `required` defaults TRUE (legacy
 * `{label, accepted_terms}` -> required, unchanged coverage semantics).
 * Returns null when there is no usable label.
 */
export function normaliseConcept(c) {
  const src = c && typeof c === "object" ? c : {};
  const label = (str(src.concept).trim() || str(src.label).trim());
  if (!label) return null;
  const list = (v) => arr(v).map((t) => str(t)).map((t) => t.trim()).filter(Boolean).slice(0, 12);
  return {
    label,
    concept: label,
    accepted_terms: list(src.accepted_terms),
    accepted_phrasings: list(src.accepted_phrasings),
    aliases: list(src.aliases),
    definition: str(src.definition).trim().slice(0, 400),
    required: src.required === false ? false : true,
  };
}

/**
 * markWrittenQuiz(answerText, expectedConcepts) ->
 *   { answered,
 *     covered: [label], missing: [label],              // REQUIRED concepts
 *     coverage: { n, total },                          // REQUIRED concepts
 *     ratio,
 *     optionalCovered: [label], optionalMissing: [label] }   // supporting concepts
 *
 * Pure. Never throws. No AI. `expectedConcepts` may be the legacy
 * [{ label, accepted_terms? }] shape or the Phase 21
 * [{ concept, accepted_terms?, accepted_phrasings?, aliases?, definition?, required? }]
 * shape (freely mixed). An empty / whitespace answer covers nothing.
 * `covered` / `missing` preserve the concepts' declared order.
 */
export function markWrittenQuiz(answerText, expectedConcepts) {
  const all = arr(expectedConcepts).map(normaliseConcept).filter(Boolean);
  const required = all.filter((c) => c.required);
  const optional = all.filter((c) => !c.required);

  const trimmed = str(answerText).trim();
  const answered = trimmed.length > 0;
  const answerTokens = answered ? contentTokens(trimmed) : [];

  const covered = [];
  const missing = [];
  const optionalCovered = [];
  const optionalMissing = [];

  for (const c of required) {
    (answered && conceptIsCovered(answerTokens, c) ? covered : missing).push(c.label);
  }
  for (const c of optional) {
    (answered && conceptIsCovered(answerTokens, c) ? optionalCovered : optionalMissing).push(c.label);
  }

  const n = covered.length;
  const total = required.length;
  return {
    answered,
    covered,
    missing,
    coverage: { n, total },
    ratio: total ? Math.round((n / total) * 100) / 100 : 0,
    optionalCovered,
    optionalMissing,
  };
}

// verdict LABELS (text carries the meaning — never colour alone; never "wrong")
/**
 * coverageVerdict({ n, total }) -> { label, tone }
 * tone is an advisory hint only ("strong" | "partial" | "start" | "none").
 */
export function coverageVerdict(coverage) {
  const n = num(coverage?.n), total = num(coverage?.total);
  if (!total) return { label: "No key points to check", tone: "none" };
  if (n >= total) return { label: `You covered all ${total} key points`, tone: "strong" };
  if (n === 0) return { label: `You covered 0 of ${total} key points`, tone: "start" };
  const ratio = n / total;
  const tone = ratio >= 0.6 ? "strong" : ratio >= 0.34 ? "partial" : "start";
  return { label: `You covered ${n} of ${total} key points`, tone };
}
