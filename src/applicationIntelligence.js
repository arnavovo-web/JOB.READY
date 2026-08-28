/* ================================================================== *
 * PHASE 13A — APPLICATION INTELLIGENCE FOUNDATION
 * ------------------------------------------------------------------
 * A pure, deterministic module (same shape as methodology.js /
 * questionMix.js / interviewStrategy.js — no AI call, no web search, no
 * database, no React, never throws) that answers ONE question:
 *
 *     "What appears to matter for THIS specific application, based ONLY
 *      on the information the user has provided?"
 *
 * It is a SHARED context/priority layer. It is deliberately NOT:
 *   - the interview scheduler (methodology.js / adaptiveEngine.js own
 *     category selection, turn ordering and anchor sourcing — untouched),
 *   - the Interview Knowledge Layer (interviewKnowledge.js — still gated
 *     solely by the user's Question Mix; this module never feeds it),
 *   - Candidate State (candidateState.js — that is user-scoped evidence of
 *     what the candidate HAS done; this module is application-scoped
 *     understanding of what the application REQUIRES — two separate ideas).
 *
 * NO WEB RESEARCH, NO NEW AI CALL. The structured input this module
 * transforms comes from the SAME single interview_profile extraction call
 * App.jsx already makes, plus the invitation scanner's already-structured
 * output. If the user-provided material lacks company-specific context,
 * this module SAYS SO (coverage: "weak") rather than inventing values.
 *
 * ANTI-HALLUCINATION: every meaningful signal carries verbatim `evidence`.
 * A theme whose evidence is not a real substring of a provided source is
 * downgraded or dropped (same principle as App.jsx's filterEvidencedSignals).
 * ================================================================== */

// The ONLY import: questionMix.js, reused so the AI's canonical interview
// category -> user-facing dimension mapping is never re-implemented here.
import { questionMixTypeForCategory } from "./questionMix.js";

// ---- 13A.1 vocabulary ------------------------------------------------
export const APPLICATION_INTELLIGENCE_DIMENSIONS = ["technical", "behavioural", "motivational"];
export const CONTEXT_STRENGTH_LEVELS = ["strong", "moderate", "weak", "none"];
export const SIGNAL_SOURCES = ["job_description", "application_context", "invitation_email", "invitation_scanner", "role_type"];
export const SIGNAL_IMPORTANCE = ["high", "medium", "low"];
export const SIGNAL_CONFIDENCE = ["high", "medium", "low"];

// ---- local helpers -------------------------------------------------
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
function norm(v) {
  return str(v).trim().toLowerCase().replace(/\s+/g, " ");
}
function clampEnum(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}
// djb2 — the SAME non-cryptographic hash App.jsx uses for jd_profile_hash,
// so a source-change check here is consistent with the rest of the app.
export function hashApplicationSources({ company, role, jdText, invitationSignature } = {}) {
  const s = `${norm(company)} | ${norm(role)} | ${str(jdText).trim()} | ${str(invitationSignature).trim()}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// evidence -> confidence: verbatim quote present in a real source => at
// least "medium"; a quote we can't verify against any provided source =>
// "low" (kept, but flagged) ; no quote => "low".
function confidenceFromEvidence(evidence, sources, declared) {
  const e = str(evidence).trim();
  if (!e) return "low";
  const verified = arr(sources).some((src) => src && str(src).includes(e));
  if (!verified) return "low";
  if (declared === "explicit" || declared === "high") return "high";
  return "medium";
}
function importanceFromConfidence(confidence, declared) {
  if (declared === "high" || confidence === "high") return "high";
  if (confidence === "medium") return "medium";
  return "low";
}

function dimensionForCategory(category) {
  // questionMix.js owns the canonical category -> dimension mapping.
  // technical bucket -> "technical"; behavioural bucket -> "behavioural";
  // motivational bucket -> "motivational".
  return questionMixTypeForCategory(category) || "behavioural";
}

// ---- 13A.2 the profile assembler ----------------------------------
/**
 * buildApplicationIntelligence({ applicationId, company, role, jdText,
 *   interviewProfile, aiBlock, invitationDraft }) -> ApplicationIntelligenceProfile
 *
 * interviewProfile: App.jsx validateProfile()'s `interview_profile`
 *   (jd_requirements[] with verbatim evidence_quote + confidence + category;
 *   competencies[] with basis; technical_topics/behavioural_topics/
 *   commercial_topics; responsibilities). Already extracted — no new call.
 * aiBlock: the OPTIONAL `application_intelligence` block on the SAME
 *   interview_profile response ({ company_themes[], role_themes[],
 *   company_context_strength, role_context_strength }) — deterministically
 *   validated & cross-checked here; a missing block just means fewer themes.
 * invitationDraft: the invitation scanner's structured output when this
 *   application was built from an invitation, else null.
 *
 * Returns a stable, serialisable profile (never throws):
 *   {
 *     applicationId, sourceHash, generatedAt,
 *     technicalPriorities: [signal], behaviouralPriorities: [signal],
 *     motivationalPriorities: [signal],
 *     companyThemes: [theme], roleThemes: [theme],
 *     signals: [signal],                     // all priorities, flattened
 *     coverage: { technical, behavioural, motivationalRole, motivationalCompany },
 *     notes: [string]                        // plain-language limitations
 *   }
 * where signal = { label, dimension, importance, confidence, source, evidence }
 * and   theme  = { label, evidence, source, confidence }.
 */
export function buildApplicationIntelligence({
  applicationId, company, role, jdText, interviewProfile, aiBlock, invitationDraft,
} = {}) {
  const ip = interviewProfile && typeof interviewProfile === "object" ? interviewProfile : {};
  const inv = invitationDraft && typeof invitationDraft === "object" ? invitationDraft : null;

  // Every string we will accept a verbatim `evidence` quote against.
  const jd = str(jdText);
  const invText = inv
    ? [
        ...arr(inv.technical_topics), ...arr(inv.behavioural_topics), ...arr(inv.commercial_topics),
        ...arr(inv.mentioned_competencies), ...arr(inv.preparation_areas),
        str(inv.preparation_instructions), str(inv.next_steps),
        str(inv.company_evidence), str(inv.role_evidence), str(inv.stage_evidence),
      ].filter(Boolean).join("\n")
    : "";
  const sources = [jd, invText].filter(Boolean);

  const signalsByDim = { technical: [], behavioural: [], motivational: [] };
  const seen = new Set(); // dedupe by dimension+label

  const pushSignal = ({ label, dimension, source, evidence, declared }) => {
    const l = str(label).trim();
    if (!l || !APPLICATION_INTELLIGENCE_DIMENSIONS.includes(dimension)) return;
    const key = `${dimension}::${norm(l)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const confidence = confidenceFromEvidence(evidence, sources, declared);
    signalsByDim[dimension].push({
      label: l,
      dimension,
      importance: importanceFromConfidence(confidence, declared),
      confidence,
      source: clampEnum(source, SIGNAL_SOURCES, "job_description"),
      evidence: str(evidence).trim().slice(0, 300),
    });
  };

  // (a) jd_requirements — the richest source: verbatim evidence_quote +
  //     confidence + canonical category. category -> dimension via questionMix.js.
  for (const r of arr(ip.jd_requirements)) {
    const label = str(r?.requirement).trim();
    if (!label) continue;
    pushSignal({
      label,
      dimension: dimensionForCategory(r?.category),
      source: "job_description",
      evidence: r?.evidence_quote,
      declared: r?.confidence === "explicit" ? "high" : r?.confidence,
    });
  }

  // (b) competencies — behavioural themes; basis is provenance-ish (no verbatim
  //     quote), so these land at medium/low confidence unless the JD corroborates.
  for (const c of arr(ip.competencies)) {
    const label = str(c?.name).trim();
    if (!label) continue;
    const corroborated = jd && jd.toLowerCase().includes(label.toLowerCase());
    pushSignal({
      label,
      dimension: "behavioural",
      source: c?.basis === "general" ? "role_type" : "job_description",
      evidence: corroborated ? label : "",
      declared: c?.basis === "explicit" ? "high" : c?.basis === "inferred" ? "medium" : "low",
    });
  }

  // (c) topic lists — low-confidence hints unless the JD contains the phrase.
  const topicList = (list, dimension) => {
    for (const t of arr(list)) {
      const label = str(t).trim();
      if (!label) continue;
      const inJd = jd && jd.toLowerCase().includes(label.toLowerCase());
      pushSignal({ label, dimension, source: "job_description", evidence: inJd ? label : "", declared: "low" });
    }
  };
  topicList(ip.technical_topics, "technical");
  topicList(ip.behavioural_topics, "behavioural");
  topicList(ip.commercial_topics, dimensionForCategory("commercial_awareness"));

  // (d) responsibilities -> motivational ("why this role" grounding). Not a
  //     "requirement" per se, so low importance, but real role context.
  for (const resp of arr(ip.responsibilities)) {
    const label = str(resp).trim();
    if (!label) continue;
    pushSignal({
      label, dimension: "motivational", source: "job_description",
      evidence: jd && jd.includes(label) ? label : "", declared: "low",
    });
  }

  // (e) invitation-scanner topics -> explicit invitation-derived signals.
  if (inv) {
    const invTopic = (list, dimension, source) => {
      for (const t of arr(list)) {
        const label = str(t).trim();
        if (!label) continue;
        pushSignal({ label, dimension, source, evidence: label, declared: "medium" });
      }
    };
    invTopic(inv.technical_topics, "technical", "invitation_email");
    invTopic(inv.behavioural_topics, "behavioural", "invitation_email");
    invTopic(inv.commercial_topics, dimensionForCategory("commercial_awareness"), "invitation_email");
    invTopic(inv.mentioned_competencies, "behavioural", "invitation_scanner");
    // components the invitation explicitly listed corroborate the dimension itself.
    for (const comp of arr(inv.components)) {
      const dim = questionMixTypeForCategory(comp);
      if (!dim) continue;
      pushSignal({
        label: `Interview covers ${dim} content`,
        dimension: dim, source: "invitation_scanner",
        evidence: inv.components_source === "explicit" ? "components" : "",
        declared: inv.components_source === "explicit" ? "medium" : "low",
      });
    }
  }

  // ---- company / role themes (from the AI block, cross-checked) ----
  const themeFrom = (raw, sourceGuess) => {
    const label = str(raw?.theme ?? raw?.label).trim();
    if (!label) return null;
    const evidence = str(raw?.evidence).trim();
    const confidence = confidenceFromEvidence(evidence, sources, raw?.confidence);
    return { label, evidence: evidence.slice(0, 300), source: clampEnum(sourceGuess, SIGNAL_SOURCES, "job_description"), confidence };
  };
  const ab = aiBlock && typeof aiBlock === "object" ? aiBlock : {};
  const companyThemes = arr(ab.company_themes)
    .map((t) => themeFrom(t, "job_description"))
    .filter(Boolean)
    // A "company value" whose evidence we CANNOT verify verbatim against the
    // user's own provided materials is NOT presented as fact — it is dropped
    // entirely. confidence is "low" iff the quote was missing or unverifiable.
    // This is the anti-hallucination guarantee.
    .filter((t) => t.confidence !== "low");
  const roleThemes = arr(ab.role_themes)
    .map((t) => themeFrom(t, "job_description"))
    .filter(Boolean)
    .filter((t) => t.label);

  // motivational priorities also absorb any evidenced company theme (they are
  // the raw material for "why this company").
  for (const t of companyThemes) {
    pushSignal({ label: t.label, dimension: "motivational", source: t.source, evidence: t.evidence, declared: t.confidence });
  }

  // ---- 13A.3 coverage model (deterministic, explainable) ----
  const strengthOf = (list) => {
    const highs = list.filter((s) => s.confidence === "high").length;
    const meds = list.filter((s) => s.confidence === "medium").length;
    const any = list.length;
    if (highs >= 2) return "strong";
    if (highs >= 1 || meds >= 2) return "moderate";
    if (any >= 1) return "weak";
    return "none";
  };
  const verifiedCompanyThemes = companyThemes.filter((t) => t.confidence !== "low");
  const roleMotivational = signalsByDim.motivational.filter(
    (s) => s.label && !verifiedCompanyThemes.some((t) => norm(t.label) === norm(s.label))
  );

  const coverage = {
    technical: strengthOf(signalsByDim.technical),
    behavioural: strengthOf(signalsByDim.behavioural),
    motivationalRole: strengthOf(roleMotivational),
    // company context is "strong" ONLY with real, verified company-specific
    // themes — a bare company name never gets past "weak".
    motivationalCompany: verifiedCompanyThemes.length >= 2 ? "strong"
      : verifiedCompanyThemes.length === 1 ? "moderate"
      : companyThemes.length || str(company).trim() ? "weak" : "none",
  };

  const notes = [];
  if (coverage.motivationalCompany === "weak" || coverage.motivationalCompany === "none") {
    notes.push("Weak company-specific context: the provided materials give little beyond the company name. Downstream systems must not present assumed company values as fact.");
  }
  if (coverage.technical === "none") notes.push("No technical priorities were evidenced in the provided materials.");
  if (!str(jdText).trim() && !inv) notes.push("No job description / application context and no invitation were provided — priorities are role-type inference only.");

  const sortSignals = (list) => list.slice().sort((a, b) => rank(b) - rank(a));
  const rank = (s) =>
    ({ high: 3, medium: 2, low: 1 }[s.importance] || 0) * 2 + ({ high: 3, medium: 2, low: 1 }[s.confidence] || 0);

  const technicalPriorities = sortSignals(signalsByDim.technical);
  const behaviouralPriorities = sortSignals(signalsByDim.behavioural);
  const motivationalPriorities = sortSignals(signalsByDim.motivational);

  return {
    applicationId: applicationId != null ? str(applicationId) : null,
    sourceHash: hashApplicationSources({
      company, role, jdText,
      invitationSignature: inv ? JSON.stringify({ c: inv.company, r: inv.role, s: inv.stage, comp: inv.components, tt: inv.technical_topics, bt: inv.behavioural_topics }) : "",
    }),
    generatedAt: Date.now(),
    technicalPriorities,
    behaviouralPriorities,
    motivationalPriorities,
    companyThemes,
    roleThemes,
    signals: [...technicalPriorities, ...behaviouralPriorities, ...motivationalPriorities],
    coverage,
    notes,
  };
}

// ---- 13A.4 defensive validator (reading back from DB / a stored blob) ----
/**
 * validateApplicationIntelligence(raw) -> ApplicationIntelligenceProfile | null
 *
 * Coerce/clamp a persisted or externally-supplied profile into the exact
 * stable shape, dropping anything malformed. Returns null when `raw` has no
 * usable structure at all (a legacy application with nothing stored).
 */
export function validateApplicationIntelligence(raw) {
  if (!raw || typeof raw !== "object") return null;
  const sig = (s) => ({
    label: str(s?.label).slice(0, 200),
    dimension: clampEnum(s?.dimension, APPLICATION_INTELLIGENCE_DIMENSIONS, "behavioural"),
    importance: clampEnum(s?.importance, SIGNAL_IMPORTANCE, "low"),
    confidence: clampEnum(s?.confidence, SIGNAL_CONFIDENCE, "low"),
    source: clampEnum(s?.source, SIGNAL_SOURCES, "job_description"),
    evidence: str(s?.evidence).slice(0, 300),
  });
  const theme = (t) => ({
    label: str(t?.label).slice(0, 200),
    evidence: str(t?.evidence).slice(0, 300),
    source: clampEnum(t?.source, SIGNAL_SOURCES, "job_description"),
    confidence: clampEnum(t?.confidence, SIGNAL_CONFIDENCE, "low"),
  });
  const sigList = (l) => arr(l).map(sig).filter((s) => s.label);
  const cov = raw.coverage && typeof raw.coverage === "object" ? raw.coverage : {};
  const technicalPriorities = sigList(raw.technicalPriorities);
  const behaviouralPriorities = sigList(raw.behaviouralPriorities);
  const motivationalPriorities = sigList(raw.motivationalPriorities);
  const anyContent = technicalPriorities.length || behaviouralPriorities.length || motivationalPriorities.length
    || arr(raw.companyThemes).length || arr(raw.roleThemes).length;
  if (!anyContent && !raw.coverage && !raw.sourceHash) return null;
  return {
    applicationId: raw.applicationId != null ? str(raw.applicationId) : null,
    sourceHash: str(raw.sourceHash),
    generatedAt: num(raw.generatedAt, 0),
    technicalPriorities,
    behaviouralPriorities,
    motivationalPriorities,
    companyThemes: arr(raw.companyThemes).map(theme).filter((t) => t.label),
    roleThemes: arr(raw.roleThemes).map(theme).filter((t) => t.label),
    signals: sigList(raw.signals),
    coverage: {
      technical: clampEnum(cov.technical, CONTEXT_STRENGTH_LEVELS, "none"),
      behavioural: clampEnum(cov.behavioural, CONTEXT_STRENGTH_LEVELS, "none"),
      motivationalRole: clampEnum(cov.motivationalRole, CONTEXT_STRENGTH_LEVELS, "none"),
      motivationalCompany: clampEnum(cov.motivationalCompany, CONTEXT_STRENGTH_LEVELS, "none"),
    },
    notes: arr(raw.notes).map((n) => str(n)).filter(Boolean).slice(0, 8),
  };
}

/**
 * applicationIntelligenceIsStale(profile, currentSourceHash) -> boolean
 *
 * true when the persisted profile was generated from different source
 * material than what the application currently holds. App.jsx regenerates
 * on every analyseAndPlan, so this is mostly a defensive downstream check.
 */
export function applicationIntelligenceIsStale(profile, currentSourceHash) {
  if (!profile || typeof profile !== "object") return true;
  const stored = str(profile.sourceHash);
  const current = str(currentSourceHash);
  if (!stored || !current) return false; // can't tell -> assume usable
  return stored !== current;
}

// ---- 13A.5 coverage-aware summary for downstream (Classroom, later) ----
/**
 * canConfidentlyPersonalise(profile, area) -> boolean
 *
 * area ∈ "technical" | "behavioural" | "motivationalRole" | "motivationalCompany".
 * True when coverage for that area is "strong" or "moderate" — the signal a
 * future Classroom uses to decide whether it may speak about a company's
 * themes at all, or must stay generic.
 */
export function canConfidentlyPersonalise(profile, area) {
  const c = profile?.coverage?.[area];
  return c === "strong" || c === "moderate";
}

// ---- 13A.6 / 13B APPLICATION IMPORTANCE × CANDIDATE GAP = DEVELOPMENT PRIORITY --
/**
 * applicationDevelopmentPriorities(intelligence, candidateState, { limit } = {})
 *   -> [{ label, dimension, applicationImportance, candidateGap, priority, why,
 *         tested, gapKind, gapSummary, level, levelLabel, levelIcon, nextStep,
 *         evidence, source }]
 *
 * The ONE deterministic source of truth for application-specific development
 * priority. Phase 13B's Classroom recommendations CONSUME this — they do not
 * re-derive it. It combines:
 *   - applicationImportance: how much THIS application seems to care about a
 *     theme (from `intelligence`), and
 *   - candidateGap: how weak / unproven the candidate's evidence for that theme
 *     is (from candidateState.js's OWN already-computed per-competency data —
 *     never recomputed here).
 * priority = importance * gap. Sorted desc, bounded.
 *
 * Phase 13B distinction — NEVER conflate these:
 *   - gapKind "demonstrated" : the candidate HAS been assessed on this and the
 *       evidence was weak / contradictory / declining -> a real, shown gap (Case A).
 *   - gapKind "preparation"  : NO evidence either way yet -> an area to prepare,
 *       explicitly NOT "you are weak at this" (Case B).
 *   - gapKind "developing"   : already shown well -> keep it warm.
 *   - gapKind "mixed"        : partial / unclear evidence.
 *
 * DATA only. Never touches the scheduler, never selects interview categories,
 * never assigns a turn type or anchor source.
 */
const IMPORTANCE_WEIGHT = { high: 1, medium: 0.6, low: 0.3 };

// per-competency evidence (candidateState.js shape) -> gap magnitude + kind.
// A competency with no `tests` has never been assessed: maximum gap, but the
// kind is "preparation", NOT a demonstrated weakness.
function candidateGapDetail(info) {
  if (!info || !info.tests) return { score: 1, tested: false, kind: "preparation" };
  const strength = info.mostRecentEvidence?.strength;
  if (strength === "strong" || info.trend === "improving") return { score: 0.15, tested: true, kind: "developing" };
  if (strength === "weak" || strength === "contradictory" || info.trend === "declining") return { score: 0.85, tested: true, kind: "demonstrated" };
  return { score: 0.5, tested: true, kind: "mixed" };
}

function gapSummaryFor(kind, label) {
  const q = `"${label}"`;
  if (kind === "demonstrated") return `You have been asked about ${q} in an interview and the answers came out weak or inconsistent — this is a demonstrated gap with concrete room to improve.`;
  if (kind === "developing") return `You have already answered well on ${q} in an interview — keep it warm rather than treating it as a gap.`;
  if (kind === "mixed") return `Your interview evidence for ${q} is partial or mixed so far.`;
  return `You have not been asked about ${q} in an interview yet, so this is an area to prepare for this role — not a demonstrated weakness.`;
}

// priority level for the UI. Text label carries the meaning (accessibility:
// never colour alone); "Developing well" is reserved for genuinely-shown
// strengths, never for a low-priority preparation area.
function levelFor(priority, kind) {
  if (kind === "developing") return { level: "strength", levelLabel: "Developing well", levelIcon: "\u{1F7E2}" };
  // >0.6 so a medium-importance area the candidate simply has not been tested on
  // (weight 0.6 x gap 1 = 0.6) reads as "Recommended", not "High priority" —
  // only a high-importance area, or a genuine demonstrated gap, reaches red.
  if (priority > 0.6) return { level: "high", levelLabel: "High priority", levelIcon: "\u{1F534}" };
  if (priority >= 0.33) return { level: "recommended", levelLabel: "Recommended", levelIcon: "\u{1F7E0}" };
  return { level: "low", levelLabel: "Lower priority for now", levelIcon: "\u{1F7E2}" };
}

function nextStepFor(kind, dimension) {
  const area = dimension === "technical"
    ? "Study the underlying concept, then retest it in a practice interview."
    : dimension === "motivational"
      ? "Draft your 'why this role / why this firm' answer from your own materials, then practise it aloud."
      : "Prepare a concrete STAR example, then practise delivering it in an interview.";
  if (kind === "demonstrated") return `Open the matching lesson (or start a focused practice interview) and re-answer. ${area}`;
  if (kind === "developing") return `Light touch only — a quick refresher before the interview. ${area}`;
  return area;
}

export function applicationDevelopmentPriorities(intelligence, candidateState, { limit = 8 } = {}) {
  const prof = intelligence && typeof intelligence === "object" ? intelligence : {};
  const competencies = candidateState && typeof candidateState === "object" ? candidateState.competencies || {} : {};

  const all = [
    ...arr(prof.technicalPriorities), ...arr(prof.behaviouralPriorities), ...arr(prof.motivationalPriorities),
  ];
  const byLabel = new Map();
  for (const s of all) {
    if (!s || !s.label) continue;
    const w = IMPORTANCE_WEIGHT[s.importance] ?? 0.3;
    const prev = byLabel.get(norm(s.label));
    if (!prev || w > prev._w) {
      byLabel.set(norm(s.label), { ...s, _w: w });
    }
  }

  const out = [];
  for (const s of byLabel.values()) {
    const info = competencies[s.label] || competencies[str(s.label)];
    const gd = candidateGapDetail(info);
    const priority = Math.round(s._w * gd.score * 100) / 100;
    const lv = levelFor(priority, gd.kind);
    out.push({
      label: s.label,
      dimension: s.dimension,
      applicationImportance: s.importance,
      candidateGap: gd.score >= 0.7 ? "high" : gd.score >= 0.4 ? "moderate" : "low",
      priority,
      tested: gd.tested,
      gapKind: gd.kind,
      gapSummary: gapSummaryFor(gd.kind, s.label),
      level: lv.level,
      levelLabel: lv.levelLabel,
      levelIcon: lv.levelIcon,
      nextStep: nextStepFor(gd.kind, s.dimension),
      evidence: str(s.evidence).slice(0, 200),
      source: s.source || "job_description",
      why: `The application ${s.importance === "high" ? "clearly emphasises" : s.importance === "medium" ? "points to" : "touches on"} "${s.label}"${s.evidence ? ` ("${s.evidence.slice(0, 90)}")` : ""}; ${gd.kind === "demonstrated" ? "your interview answers on it have been weak or inconsistent" : gd.kind === "developing" ? "you have already shown this well" : gd.kind === "mixed" ? "your evidence for it is mixed" : "you have no interview evidence for it yet"}.`,
    });
  }
  return out.sort((a, b) => b.priority - a.priority).slice(0, Math.max(1, num(limit, 8)));
}

// ---- 13B.1 Classroom grouping (dumb wrapper; the UI stays presentational) ----
/**
 * classroomRecommendationGroups(intelligence, candidateState, { limit } = {})
 *   -> { technical:[rec], behavioural:[rec], motivational:[rec],
 *        all:[rec], limitedContext:boolean, hasAny:boolean }
 *
 * Pure regrouping of applicationDevelopmentPriorities() by question-type
 * dimension, so the Classroom UI never re-implements ranking or the
 * demonstrated-gap / preparation-area distinction. `limitedContext` is true
 * when the application's OWN coverage model says company/role context is thin —
 * it does NOT suppress recommendations, it only lets the UI say so.
 */
export function classroomRecommendationGroups(intelligence, candidateState, { limit = 9 } = {}) {
  const all = applicationDevelopmentPriorities(intelligence, candidateState, { limit });
  const groups = { technical: [], behavioural: [], motivational: [] };
  for (const r of all) (groups[r.dimension] || groups.behavioural).push(r);
  const cov = intelligence && typeof intelligence === "object" ? intelligence.coverage || {} : {};
  const thin = (v) => v === "weak" || v === "none" || v == null;
  const limitedContext = !intelligence || typeof intelligence !== "object"
    || (thin(cov.technical) && thin(cov.behavioural) && thin(cov.motivationalRole) && thin(cov.motivationalCompany));
  return { ...groups, all, limitedContext, hasAny: all.length > 0 };
}

// ---- 13B.2 cautious CV "experiences to explore" (Fact vs Suggestion) --------
const EXPLORE_STOPWORDS = new Set(
  ("the a an and or of to for in on at by with from your you our we able strong good great "
  + "excellent experience experiences skill skills ability abilities team teams work working "
  + "role about into as is are be been being this that these those there their them they it its "
  + "will can could would should may might have has had using used use across within very more most")
  .split(/\s+/)
);
function exploreTokens(text) {
  return str(text).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((t) => t.length >= 4 && !EXPLORE_STOPWORDS.has(t));
}

/**
 * experiencesToExplore({ candidateProfile, claims }, recommendations, { limit } = {})
 *   -> [{ recommendationLabel, dimension, fact, suggestion, sourceKind }]
 *
 * A DELIBERATELY cautious layer. For each top recommendation, look for a CV
 * line or extracted claim that shares real vocabulary with it and — if found —
 * surface it as a SUGGESTION to consider, never as proof.
 *   fact       : always `Your CV mentions: "<verbatim text>"`
 *   suggestion : always begins `Consider whether ...`
 * Fact and Suggestion are separate fields. The function never emits assertion
 * language ("this proves", "you are strong at", "demonstrates"). Returns [] when
 * there is no CV / claim material at all — it never says "you have no experience".
 */
export function experiencesToExplore({ candidateProfile, claims } = {}, recommendations, { limit = 4 } = {}) {
  const cp = candidateProfile && typeof candidateProfile === "object" ? candidateProfile : {};
  const entries = [];
  const addAll = (list, kind) => {
    for (const s of arr(list)) { const t = str(s).trim(); if (t) entries.push({ text: t, kind }); }
  };
  addAll(cp.experience, "experience");
  addAll(cp.leadership, "leadership");
  addAll(cp.achievements, "achievement");
  addAll(cp.behavioural_examples, "example");
  for (const c of arr(claims)) {
    const t = str(c?.claim_text ?? c?.claim).trim();
    if (t) entries.push({ text: t, kind: "claim" });
  }
  if (!entries.length) return [];
  const entryTok = entries.map((e) => ({ ...e, toks: new Set(exploreTokens(e.text)) }));

  const out = [];
  const usedEntry = new Set();
  for (const r of arr(recommendations)) {
    if (!r || !r.label) continue;
    const rToks = exploreTokens(`${r.label} ${r.evidence || ""}`);
    if (!rToks.length) continue;
    let best = null, bestScore = 0;
    for (let i = 0; i < entryTok.length; i++) {
      if (usedEntry.has(i)) continue;
      let shared = 0, longShared = false;
      for (const t of rToks) if (entryTok[i].toks.has(t)) { shared++; if (t.length >= 6) longShared = true; }
      if ((longShared || shared >= 2) && shared > bestScore) { best = i; bestScore = shared; }
    }
    if (best == null) continue;
    usedEntry.add(best);
    const e = entries[best];
    out.push({
      recommendationLabel: r.label,
      dimension: r.dimension || "behavioural",
      fact: `Your CV mentions: "${e.text.slice(0, 200)}"`,
      suggestion: `Consider whether this gives you a concrete, honest example you could draw on when preparing "${r.label}". Only use it if it genuinely fits.`,
      sourceKind: e.kind,
    });
    if (out.length >= Math.max(1, num(limit, 4))) break;
  }
  return out;
}

// ---- 13A.7 grounded lesson context (minimal Classroom integration) ----
/**
 * applicationIntelligenceLessonContext(profile, { dimension } = {}) -> string
 *
 * A short, EVIDENCE-BACKED block for the EXISTING classroom_lesson prompt.
 * It only ever states what the user's own materials contain (with verbatim
 * quotes), and frames CV connections as possibilities, never as proof —
 * matching Phase 10's required style. Empty string when there is nothing
 * verifiable to add (so a legacy / weak-context application is unaffected).
 */
export function applicationIntelligenceLessonContext(profile, { dimension } = {}) {
  if (!profile || typeof profile !== "object") return "";
  const themes = arr(profile.companyThemes).filter((t) => t.evidence && t.confidence !== "low");
  const roleThemes = arr(profile.roleThemes).filter((t) => t.evidence);
  const dimSignals = dimension && APPLICATION_INTELLIGENCE_DIMENSIONS.includes(dimension)
    ? arr(profile.signals).filter((s) => s.dimension === dimension && s.evidence && s.confidence !== "low")
    : [];
  const lines = [];
  if (themes.length) {
    lines.push(`Company themes the candidate's OWN application materials mention (quote verbatim, do not embellish): ${themes.slice(0, 4).map((t) => `"${t.evidence.slice(0, 120)}"`).join("; ")}.`);
  }
  if (roleThemes.length) {
    lines.push(`Role context from those materials: ${roleThemes.slice(0, 4).map((t) => t.label).join("; ")}.`);
  }
  if (dimSignals.length) {
    lines.push(`Priorities evidenced for this area: ${dimSignals.slice(0, 4).map((s) => s.label).join("; ")}.`);
  }
  if (!lines.length) return "";
  const companyWeak = profile.coverage?.motivationalCompany === "weak" || profile.coverage?.motivationalCompany === "none";
  return `\n\nAPPLICATION CONTEXT (from the user's own provided materials only — never invent company facts):\n${lines.join("\n")}\n${companyWeak ? "Company-specific context is weak — stay general about the company and do not assert unstated company values." : ""}\nWhen connecting to the candidate's experience, use possibility framing ("your experience at X may provide useful evidence for this — consider whether you can identify a genuine example where..."), never assertion ("your experience demonstrates this value").`;
}
