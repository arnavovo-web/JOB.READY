/* ================================================================== *
 * PHASE 14 — DETERMINISTIC WRITTEN-QUIZ MARKING
 * ------------------------------------------------------------------
 * A pure, deterministic module (same shape as questionMix.js /
 * applicationIntelligence.js — no AI call, no network, no React, no
 * database, never throws). It marks a free-response quiz answer by
 * CONCEPT COVERAGE against the machine-readable `expected_concepts`
 * that the ONE Development Module generation call already produced.
 *
 * It does NOT try to "understand" the answer. It answers exactly one
 * question per expected concept: "did the student's answer actually
 * express this idea?" — using phrase matching over a normalised token
 * stream, plus any generator-supplied accepted terms.
 *
 * ANTI-FALSE-POSITIVE: a multi-word concept is only credited when ALL
 * of its content tokens appear close together (or as an exact run) —
 * one incidental shared keyword in an unrelated sentence never credits
 * a concept. ANTI-FALSE-NEGATIVE: case / punctuation / whitespace are
 * normalised, light plural + "cashflow"->"cash flow" folding is applied,
 * and the generator's `accepted_terms` provide explicit synonyms.
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

// light morphology: fold a few well-known finance/tech compound spellings
// and collapse simple trailing-plural forms so "cash flows" ~ "cash flow".
function foldText(raw) {
  return str(raw)
    .toLowerCase()
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

// does the ordered token run `needle` appear contiguously in `hay`?
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
  const windowSize = needle.length * 2 + 4;
  // greedy: for every occurrence of the first token, see whether the other
  // tokens each have an occurrence within [start, start + windowSize].
  for (const start of positions[0]) {
    let ok = true;
    for (let k = 1; k < positions.length; k++) {
      if (!positions[k].some((p) => Math.abs(p - start) <= windowSize)) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * conceptPhrases(concept) -> [tokenArray, ...]
 * The concept label plus every accepted term, each as a content-token array.
 * Dedups and drops empties.
 */
function conceptPhrases(concept) {
  const raw = [str(concept?.label), ...arr(concept?.accepted_terms).map((t) => str(t))];
  const seen = new Set();
  const out = [];
  for (const phrase of raw) {
    const toks = contentTokens(phrase);
    if (!toks.length) continue;
    const key = toks.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(toks);
  }
  return out;
}

/**
 * conceptIsCovered(answerTokens, concept) -> boolean
 * Covered iff any of the concept's phrases appears as an exact contiguous
 * run OR (for multi-token phrases) all its tokens appear within a bounded
 * window. A single-token phrase must appear as a whole token.
 */
function conceptIsCovered(answerTokens, concept) {
  for (const phrase of conceptPhrases(concept)) {
    if (hasContiguousRun(answerTokens, phrase)) return true;
    if (phrase.length >= 2 && hasProximityRun(answerTokens, phrase)) return true;
  }
  return false;
}

/**
 * markWrittenQuiz(answerText, expectedConcepts, { }) ->
 *   { answered, covered: [label], missing: [label], coverage: { n, total }, ratio }
 *
 * Pure. Never throws. No AI. `expectedConcepts` is
 * [{ label, accepted_terms?: string[] }] straight from a persisted
 * Development Module learning item. An empty / whitespace answer covers
 * nothing. `covered` / `missing` preserve the concepts' declared order.
 */
export function markWrittenQuiz(answerText, expectedConcepts) {
  const concepts = arr(expectedConcepts)
    .map((c) => ({ label: str(c?.label).trim(), accepted_terms: arr(c?.accepted_terms).map((t) => str(t)) }))
    .filter((c) => c.label);
  const total = concepts.length;
  const trimmed = str(answerText).trim();
  const answered = trimmed.length > 0;

  const covered = [];
  const missing = [];
  if (answered) {
    const answerTokens = contentTokens(trimmed);
    for (const c of concepts) {
      if (conceptIsCovered(answerTokens, c)) covered.push(c.label);
      else missing.push(c.label);
    }
  } else {
    for (const c of concepts) missing.push(c.label);
  }

  const n = covered.length;
  return {
    answered,
    covered,
    missing,
    coverage: { n, total },
    ratio: total ? Math.round((n / total) * 100) / 100 : 0,
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
