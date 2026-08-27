/* ================================================================== *
 * PHASE 9 — SCALABLE INTERVIEW KNOWLEDGE INFRASTRUCTURE (LOGIC / API)
 * ------------------------------------------------------------------
 * Phase 6 introduced a "universal interview knowledge layer": for an
 * interview type with a predictable knowledge universe (an Investment
 * Banking technical round -> three statements, DCF, comps, accretion/
 * dilution...) it decides what canonical concepts are worth testing, which
 * a purely JD/CV-personalised engine has no way to know on its own.
 *
 * Phase 9 keeps every Phase 6 guarantee and makes the layer SCALABLE and
 * STRUCTURED for substantial future growth:
 *
 *   1. DATA / LOGIC SEPARATION. The catalogue itself (domains, groups, the
 *      flat canonical concept list with the Phase 9 schema) now lives in
 *      knowledgeCatalogue.js — inert, serialisable, zero-dependency data.
 *      THIS module is pure logic: domain resolution, the applicability
 *      gate, the deterministic concept-selection API, and the compact
 *      guidance object the prompt builder consumes.
 *
 *   2. INTERVIEW-CONTEXT APPLICABILITY. Selection can now narrow on the
 *      interview's STAGE and FORMAT (via each concept's optional
 *      applicableStages / applicableFormats). A caller that supplies no
 *      stage/format is completely unaffected — every migrated Phase 6
 *      concept is unrestricted, so behaviour is byte-identical unless a
 *      concept opts in to a restriction.
 *
 *   3. EXPLICIT INVITATION CONTEXT. When the interview was built from a
 *      scanned invitation, the topics the email EXPLICITLY named can boost
 *      the concepts they match. Inferred context (just "an Investment
 *      Banking interview") produces NO explicit topics and therefore NO
 *      boost — the explicit-vs-inferred boundary Phase 7/8 protect is
 *      preserved exactly: this layer never treats an inferred domain as an
 *      explicitly-mentioned concept.
 *
 *   4. EXPLAINABILITY. selectKnowledgeConcepts() returns, per concept, the
 *      bounded priority it computed AND the human-readable reasons it was
 *      selected ("Core concept for Investment Banking", "JD relevance",
 *      "explicit invitation topic: valuation", "candidate weakness —
 *      worth revisiting"). Deterministic and inspectable.
 *
 * UNCHANGED FROM PHASE 6 (hard guarantees, all still tested):
 *   - NO AI call, NO web search, NO database, NO React. Zero new AI calls.
 *   - NEVER decides category / turn_type / anchor_source — the scheduler
 *     (methodology.js + adaptiveEngine.js) owns those, untouched.
 *   - NEVER applies to a HireVue-style (independent_batch) interview: the
 *     gate requires pipeline === "adaptive_turn", AND the batch pipeline
 *     never calls the prompt builder that consults this module at all.
 *   - NEVER applies to a motivation_fit / behavioural_competency turn.
 *   - NEVER throws: every function degrades to an inert/empty result on
 *     malformed or missing input.
 *   - NEVER a parallel Candidate State: it reads candidateState.js's OWN
 *     already-computed per-competency .tests / .trend / .mostRecentEvidence,
 *     it never recomputes evidence.
 *   - The concept `label` is used verbatim as the stamped competency, so it
 *     is also the Candidate State lookup key.
 * ================================================================== */

// Two imports, both data/taxonomy, neither with any behaviour of its own:
//  - methodology.js: the canonical category taxonomy (never a second copy).
//  - knowledgeCatalogue.js: the Phase 9 catalogue data (never inlined here).
// This module still imports NOTHING that makes its own decisions — not
// adaptiveEngine.js, candidateState.js, candidateIntelligence.js or
// interviewStrategy.js — it only ever RECEIVES their output as plain args.
import { CATEGORIES, mapLegacyCategory } from "./methodology.js";
import {
  KNOWLEDGE_DOMAINS, KNOWLEDGE_DOMAIN_GROUPS, KNOWLEDGE_CONCEPTS,
  IMPORTANCE_LEVELS, IMPORTANCE_BASE_PRIORITY,
} from "./knowledgeCatalogue.js";

export { KNOWLEDGE_DOMAINS, KNOWLEDGE_DOMAIN_GROUPS, KNOWLEDGE_CONCEPTS, IMPORTANCE_LEVELS };

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
function norm(v) {
  return str(v).trim().toLowerCase();
}

// ---- 9.5 the categories the knowledge layer may ever apply to ---------
// Derived by EXCLUSION from methodology.js's own CATEGORIES, not a hardcoded
// inclusion list — canonical domain knowledge (DCF, big-O, case frameworks...)
// must never leak into a motivation or behavioural turn, but any OTHER
// category methodology.js defines (now or in future) is eligible by default.
// Exclusion is the safer failure direction: it can only ever miss EXCLUDING
// one, never silently exclude a legitimate future category.
export const KNOWLEDGE_ELIGIBLE_CATEGORIES = CATEGORIES.filter(
  (c) => c !== "motivation_fit" && c !== "behavioural_competency"
);

// ---- 9.6 bounded priority signal constants --------------------------
// Every adjustment a signal can make to a concept's priority is declared
// here, so "can any single signal dominate indefinitely?" is answerable by
// reading one block. Base priority comes from importance (three coarse
// values). Each adjustment is small relative to the gap between importance
// bands (15), so importance still matters — but no single signal, and no
// stack of them, can pin the same concept as the target every turn:
// a concept asked THIS interview is HARD-excluded regardless of score.
const JD_BOOST = 20;                 // JD requirement keyword intersection
const INVITATION_TOPIC_BOOST = 30;   // topic the invitation email EXPLICITLY named
const RECENT_STRENGTH_ADJUSTMENT = { strong: -45, moderate: -18, weak: 25, contradictory: 30 };
const TREND_ADJUSTMENT = { declining: 15, improving: -10 };
const PRIORITY_MIN = 0;
const PRIORITY_MAX = 200;
export const MAX_GUIDANCE_CONCEPTS = 4;

const IMPORTANCE_RANK = { core: 3, important: 2, specialist: 1 };

// Pre-index the flat catalogue once (module load) for O(1) id lookups and a
// stable declaration-order index used as the final deterministic tie-break.
const CONCEPT_BY_ID = new Map();
KNOWLEDGE_CONCEPTS.forEach((c, i) => CONCEPT_BY_ID.set(c.id, { concept: c, index: i }));

/** getConceptById(id) — the canonical concept object, or null. Never throws. */
export function getConceptById(id) {
  const hit = CONCEPT_BY_ID.get(str(id));
  return hit ? hit.concept : null;
}

/** basePriorityFor(concept) — importance -> base priority, defensive default "important". */
function basePriorityFor(concept) {
  const level = IMPORTANCE_LEVELS.includes(concept?.importance) ? concept.importance : "important";
  return IMPORTANCE_BASE_PRIORITY[level] ?? IMPORTANCE_BASE_PRIORITY.important;
}

// ---- 9.7 applicability gate ----------------------------------------
/**
 * isKnowledgeLayerApplicable({ pipeline, category, domain, technicalMixEnabled })
 *
 * AND-ed conditions (all must hold):
 *   - pipeline === "adaptive_turn" (a HireVue-style independent_batch
 *     interview never reaches here anyway — this is a second, explicit,
 *     independently-testable layer of the same protection).
 *   - Phase 11: technicalMixEnabled !== false — i.e. the user's Question Mix
 *     on the Build Interview screen INCLUDES "Technical Knowledge". Passing
 *     `false` here makes the Technical Knowledge Layer completely
 *     unavailable, regardless of role, JD, domain match or interview stage.
 *     `undefined` (a caller that predates Phase 11, or a legacy interview
 *     with no stored question_mix) is treated as enabled — pre-Phase-11
 *     behaviour is preserved for those.
 *   - domain is a resolved domain object (null => no confident role/JD
 *     match => layer inert).
 *   - the SCHEDULER's own already-decided category (normalised through the
 *     same mapLegacyCategory every other consumer uses) is knowledge-
 *     eligible — never motivation_fit / behavioural_competency.
 * Deterministic, pure, explainable. Never throws.
 */
export function isKnowledgeLayerApplicable({ pipeline, category, domain, technicalMixEnabled } = {}) {
  if (pipeline !== "adaptive_turn") return false;
  if (technicalMixEnabled === false) return false;
  if (!domain || !domain.id) return false;
  if (!KNOWLEDGE_ELIGIBLE_CATEGORIES.includes(mapLegacyCategory(category))) return false;
  return true;
}

// ---- 9.8 domain resolution ---------------------------------------
const DOMAIN_MATCH_MIN_SCORE = 1;

/**
 * resolveKnowledgeDomain(interviewProfile)
 *
 * UNCHANGED from Phase 6. Deterministic, case-insensitive substring
 * matching of each domain's roleKeywords against ALREADY-EXTRACTED
 * interview_profile fields (role/division/responsibilities/required_skills/
 * preferred_skills/technical_topics/commercial_topics/jd_requirements) —
 * no new AI call, no raw-JD re-parsing. Returns the best-scoring domain
 * when it clears DOMAIN_MATCH_MIN_SCORE, else null (a generic/unmatched
 * role correctly resolves to "no domain"). Ties break on KNOWLEDGE_DOMAINS'
 * declared order (first strictly-greater score wins).
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

/** domainGroup(domainOrId) — the KNOWLEDGE_DOMAIN_GROUPS entry a domain belongs to, or null. */
export function domainGroup(domainOrId) {
  const id = typeof domainOrId === "string" ? domainOrId : domainOrId?.id;
  if (!id) return null;
  return KNOWLEDGE_DOMAIN_GROUPS.find((g) => g.domainIds.includes(id)) || null;
}

// ---- 9.9 interview-context filters --------------------------------
// A concept with no applicableStages (or an empty one) applies to every
// stage. A non-empty list restricts it — but ONLY when the caller actually
// supplies a stage. Callers that don't pass interview context (every
// pre-Phase-9 caller, and every test that omits it) see no filtering at
// all: full backwards compatibility. Same rules for applicableFormats.
function contextAllows(list, value) {
  const allowed = arr(list);
  if (!allowed.length) return true;   // unrestricted concept
  if (!value) return true;            // caller supplied no context to filter on
  return allowed.includes(value);
}
function conceptMatchesInterviewContext(concept, stage, format) {
  return contextAllows(concept.applicableStages, stage) && contextAllows(concept.applicableFormats, format);
}

// ---- 10A.1 shared (multi-domain) concepts -------------------------
// Phase 10A: a genuinely canonical concept (DCF, EV vs equity value, the
// three statements, deferred tax...) can legitimately belong to more than
// one domain's interview. Rather than duplicate it under a second id/label
// (which would fragment Candidate State and risk near-duplicate drift), the
// concept keeps ONE home `domain` plus an optional `sharedWithDomains` list.
// A concept is "in" domain D when D is its home domain OR D is in that list.
// question guidance can still differ per domain — see pickArchetype's
// domainArchetypes handling below.
function conceptInDomain(concept, domainId) {
  return concept.domain === domainId || arr(concept.sharedWithDomains).includes(domainId);
}

/**
 * getDomainConcepts(domain, category, { stage, format } = {})
 *
 * Phase 6 signature preserved (the third arg is optional and new). Returns
 * the flat catalogue filtered to: this domain, this (scheduler-decided,
 * legacy-normalised) category, and — when supplied — this stage/format.
 * Each returned concept is a shallow copy carrying `topicLabel` (Phase 6
 * alias of `subdomain`) for backwards compatibility. Never throws.
 */
export function getDomainConcepts(domain, category, { stage, format } = {}) {
  if (!domain || !domain.id) return [];
  const normalizedCategory = mapLegacyCategory(category);
  const out = [];
  for (const concept of KNOWLEDGE_CONCEPTS) {
    if (!conceptInDomain(concept, domain.id)) continue;
    if (!arr(concept.categories).includes(normalizedCategory)) continue;
    if (!conceptMatchesInterviewContext(concept, stage, format)) continue;
    out.push({ ...concept, topicLabel: str(concept.subdomain) });
  }
  return out;
}

// ---- 9.10 explicit invitation context -----------------------------
/**
 * normalizeInvitationContext(raw)
 *
 * Coerces whatever the caller passes into the strict internal shape
 *   { explicitTopics: string[], explicitComponents: string[] }
 * `explicitTopics` are lower-cased free-text tokens the invitation email
 * EXPLICITLY named (technical/commercial topics, competencies, preparation
 * areas — all extracted under Phase 7's "never infer a topic the email
 * doesn't name" rule and guarded by Phase 8's hallucination fixtures).
 * `explicitComponents` are canonical categories the email explicitly said
 * the interview covers. A missing/malformed value degrades to empty — and
 * empty means "no explicit invitation signal", i.e. exactly the pre-Phase-9
 * behaviour, never a fabricated topic.
 */
export function normalizeInvitationContext(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const explicitTopics = Array.from(
    new Set(arr(r.explicitTopics).map((t) => norm(t)).filter((t) => t.length >= 3))
  );
  const explicitComponents = arr(r.explicitComponents)
    .map((c) => mapLegacyCategory(str(c)))
    .filter((c) => KNOWLEDGE_ELIGIBLE_CATEGORIES.includes(c));
  return { explicitTopics, explicitComponents };
}

// A concept "matches" an explicit invitation topic when that topic token
// appears in the concept's label or any of its keywords (either direction
// of containment — "valuation" matches "DCF valuation"; "financial
// modelling" matches keyword "financial modelling"). This never asserts the
// email named the CONCEPT — only that it named this TOPIC, which is the
// thing actually being echoed in the reason string.
function invitationTopicMatch(concept, explicitTopics) {
  if (!explicitTopics.length) return null;
  const hay = [norm(concept.label), ...arr(concept.keywords).map((k) => norm(k))];
  for (const topic of explicitTopics) {
    if (hay.some((h) => h && (h.includes(topic) || topic.includes(h)))) return topic;
  }
  return null;
}

function jdKeywordMatch(concept, jdRequirements) {
  const reqText = arr(jdRequirements)
    .map((r) => `${str(r?.requirement)} ${str(r?.evidence_quote)}`)
    .join(" ")
    .toLowerCase();
  if (!reqText.trim()) return false;
  return arr(concept.keywords).some((kw) => reqText.includes(norm(kw)));
}

// ---- 9.11 candidate-state-aware scoring --------------------------
// Reads candidateState.js's OWN already-computed per-competency fields
// (.tests / .trend / .mostRecentEvidence.strength) keyed by the concept's
// verbatim label — never recomputes evidence. A concept whose label has
// never been asked (no entry, or .tests === 0) is "not yet tested" — the
// strongest priority signal, same convention the rest of the architecture
// uses for a never-tested competency.
// statusLabel strings are STABLE (asserted verbatim by tests and surfaced,
// via the prompt builder, to Call 2) — do not reword casually.
function candidateStateContribution(concept, candidateState) {
  const info = candidateState && typeof candidateState === "object"
    ? candidateState.competencies?.[concept.label]
    : null;
  if (!info || !info.tests) {
    return { delta: 0, statusLabel: "not yet tested", tests: 0, reason: "no candidate evidence yet" };
  }
  const recentStrength = info.mostRecentEvidence?.strength;
  const strengthAdj = RECENT_STRENGTH_ADJUSTMENT[recentStrength] ?? 0;
  const trendAdj = TREND_ADJUSTMENT[info.trend] ?? 0;
  let statusLabel;
  let reason;
  if (recentStrength === "strong" || info.trend === "improving") {
    statusLabel = "demonstrated strongly";
    reason = "already well evidenced — lower priority";
  } else if (recentStrength === "weak" || recentStrength === "contradictory" || info.trend === "declining") {
    statusLabel = "weak — worth revisiting";
    reason = "candidate weakness — worth revisiting";
  } else {
    statusLabel = "tested, moderate evidence";
    reason = "some evidence — moderate priority";
  }
  return { delta: strengthAdj + trendAdj, statusLabel, tests: info.tests, reason };
}

// Phase 10A: a shared concept may carry domain-specific question guidance
// (`domainArchetypes: { [domainId]: [...] }`) — e.g. DCF framed as "explain
// the mechanics" for Investment Banking vs "evaluate the returns
// implications" for Private Equity. When guidance exists for the interview's
// domain it is used; otherwise the concept's default `archetypes` apply.
// Nothing changes for a concept with no domainArchetypes (the vast majority).
function pickArchetype(concept, testCount, domainId) {
  const domainSpecific = concept.domainArchetypes && domainId
    ? arr(concept.domainArchetypes[domainId]).map((a) => str(a)).filter(Boolean)
    : [];
  const pool = domainSpecific.length ? domainSpecific : arr(concept.archetypes).map((a) => str(a)).filter(Boolean);
  if (!pool.length) return `Ask a natural interview question testing "${concept.label}".`;
  return pool[testCount % pool.length];
}

function importanceLabel(concept) {
  const level = IMPORTANCE_LEVELS.includes(concept?.importance) ? concept.importance : "important";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

/**
 * scoreConcept(concept, ctx)
 *
 * Deterministic. Returns the full explainable record for one concept:
 *   { id, label, subdomain, importance, difficulty, priority, statusLabel,
 *     tests, reasons: string[], relatedConceptIds, prerequisiteConceptIds,
 *     misconceptions: string[], archetype }
 * `priority` is the bounded [0,200] score; `reasons` explains every signal
 * that moved it. `misconceptions` (Phase 10A, <=3, may be empty) are the
 * concise "candidates commonly get this wrong" notes the prompt builder can
 * surface for the target concept only.
 */
function scoreConcept(concept, { domainId, domainLabel, normalizedCategory, candidateState, jdRequirements, inv }) {
  const base = basePriorityFor(concept);
  const reasons = [`${importanceLabel(concept)} concept for ${domainLabel}`];

  const jdHit = jdKeywordMatch(concept, jdRequirements);
  if (jdHit) reasons.push("JD relevance");

  const invTopic = invitationTopicMatch(concept, inv.explicitTopics);
  if (invTopic) reasons.push(`explicit invitation topic: ${invTopic}`);

  if (inv.explicitComponents.includes(normalizedCategory)) {
    reasons.push("interview explicitly covers this component");
  }

  const cs = candidateStateContribution(concept, candidateState);
  reasons.push(cs.reason);

  const priority = clamp(
    base + (jdHit ? JD_BOOST : 0) + (invTopic ? INVITATION_TOPIC_BOOST : 0) + cs.delta,
    PRIORITY_MIN, PRIORITY_MAX
  );

  return {
    id: concept.id,
    label: concept.label,
    subdomain: str(concept.subdomain),
    importance: IMPORTANCE_LEVELS.includes(concept.importance) ? concept.importance : "important",
    difficulty: str(concept.difficulty),
    priority,
    statusLabel: cs.statusLabel,
    tests: cs.tests,
    reasons,
    relatedConceptIds: arr(concept.relatedConceptIds).slice(),
    prerequisiteConceptIds: arr(concept.prerequisiteConceptIds).slice(),
    misconceptions: arr(concept.misconceptions).map((m) => str(m)).filter(Boolean).slice(0, 3),
    archetype: pickArchetype(concept, cs.tests, domainId),
  };
}

// ---- 9.12 the concept selection API -----------------------------
/**
 * selectKnowledgeConcepts({
 *   domain, category, pipeline, stage, format,
 *   candidateState, jdRequirements, invitationContext, transcript, limit
 * })
 *
 * The single deterministic entry point for "which canonical concepts are
 * worth testing on THIS scheduler-selected turn, and why". Structured
 * enough for three consumers: the prompt builder (buildKnowledgeGuidance
 * below), tests, and any future UI.
 *
 * Pipeline:
 *   gate (isKnowledgeLayerApplicable) ->
 *   filter catalogue to domain + category + (stage/format if supplied) ->
 *   HARD-exclude any concept already asked THIS interview (transcript) ->
 *   score each remaining concept (importance base + JD + explicit
 *     invitation topic + candidate-state delta, all bounded) ->
 *   sort by (priority desc, importance rank desc, catalogue order asc) ->
 *   take `limit` (default MAX_GUIDANCE_CONCEPTS).
 *
 * Always returns a stable shape (never throws, never null):
 *   { applicable, domainId, domainLabel, groupId, category,
 *     concepts: [...scored records...], excludedAskedThisInterview: [labels] }
 * `applicable:false` (with concepts:[]) whenever the gate fails — the
 * caller treats that identically to "no guidance".
 */
export function selectKnowledgeConcepts({
  domain, category, pipeline, stage, format, technicalMixEnabled,
  candidateState, jdRequirements, invitationContext, transcript, limit,
} = {}) {
  const group = domainGroup(domain);
  const emptyResult = {
    applicable: false,
    domainId: domain?.id || null,
    domainLabel: str(domain?.label),
    groupId: group?.id || null,
    category: mapLegacyCategory(category),
    concepts: [],
    excludedAskedThisInterview: [],
  };
  if (!isKnowledgeLayerApplicable({ pipeline, category, domain, technicalMixEnabled })) return emptyResult;

  const normalizedCategory = mapLegacyCategory(category);
  const inv = normalizeInvitationContext(invitationContext);
  const domainLabel = str(domain.label);

  const pool = KNOWLEDGE_CONCEPTS.filter(
    (c) =>
      conceptInDomain(c, domain.id) &&
      arr(c.categories).includes(normalizedCategory) &&
      conceptMatchesInterviewContext(c, stage, format)
  );

  const base = { ...emptyResult, applicable: true };
  if (!pool.length) return base;

  const askedThisInterview = new Set(
    arr(transcript).map((t) => norm(t?.question?.competency)).filter(Boolean)
  );
  const excludedAskedThisInterview = [];
  const scored = [];
  for (const concept of pool) {
    if (askedThisInterview.has(norm(concept.label))) {
      excludedAskedThisInterview.push(concept.label);
      continue;
    }
    scored.push(scoreConcept(concept, { domainId: domain.id, domainLabel, normalizedCategory, candidateState, jdRequirements, inv }));
  }
  if (!scored.length) return { ...base, excludedAskedThisInterview };

  scored.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (IMPORTANCE_RANK[b.importance] !== IMPORTANCE_RANK[a.importance]) {
      return IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance];
    }
    return (CONCEPT_BY_ID.get(a.id)?.index ?? 0) - (CONCEPT_BY_ID.get(b.id)?.index ?? 0);
  });

  const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : MAX_GUIDANCE_CONCEPTS;
  return {
    applicable: true,
    domainId: domain.id,
    domainLabel,
    groupId: group?.id || null,
    category: normalizedCategory,
    concepts: scored.slice(0, n),
    excludedAskedThisInterview,
  };
}

// ---- 9.13 compact guidance for the prompt builder ----------------
/**
 * buildKnowledgeGuidance({ domain, category, pipeline, stage, format,
 *   candidateState, transcript, jdRequirements, invitationContext })
 *
 * Phase 6 output contract PRESERVED exactly (App.jsx + the Phase 6 test
 * suite depend on it):
 *   null  whenever the layer isn't applicable OR no concept survives
 *         filtering/exclusion (never fabricates guidance from nothing).
 *   else  { domainLabel,
 *           priorityConcepts: [{ label, statusLabel, reasons }],   // <= MAX_GUIDANCE_CONCEPTS
 *           targetConcept:    { label, archetype, misconceptions } }
 *
 * `reasons` on each priorityConcept (Phase 9) and `misconceptions` on the
 * targetConcept (Phase 10A, always an array, may be empty) are the only
 * additive fields — every other key is unchanged. Built entirely on top of
 * selectKnowledgeConcepts so there is exactly one selection code path.
 * stage/format/invitationContext are all OPTIONAL: omitting them reproduces
 * Phase 6 behaviour (aside from the always-present empty misconceptions[]).
 * Phase 11: `technicalMixEnabled: false` returns null unconditionally — the
 * user's Question Mix did not include Technical Knowledge, so the layer is
 * completely unavailable. `undefined` = enabled (legacy / pre-Phase-11).
 */
export function buildKnowledgeGuidance({
  domain, category, pipeline, stage, format, technicalMixEnabled,
  candidateState, transcript, jdRequirements, invitationContext,
} = {}) {
  const selection = selectKnowledgeConcepts({
    domain, category, pipeline, stage, format, technicalMixEnabled,
    candidateState, jdRequirements, invitationContext, transcript,
    limit: MAX_GUIDANCE_CONCEPTS,
  });
  if (!selection.applicable || !selection.concepts.length) return null;

  const target = selection.concepts[0];
  return {
    domainLabel: selection.domainLabel,
    priorityConcepts: selection.concepts.map((c) => ({
      label: c.label,
      statusLabel: c.statusLabel,
      reasons: c.reasons.slice(),
    })),
    targetConcept: {
      label: target.label,
      archetype: target.archetype,
      misconceptions: arr(target.misconceptions).slice(),
    },
  };
}
