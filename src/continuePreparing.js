/* ================================================================== *
 * PHASE 15A — CLASSROOM TOPIC IDENTITY + RETURNING-USER "CONTINUE PREPARING"
 * ------------------------------------------------------------------
 * Pure, deterministic, offline (no AI, no DB, no React). Two jobs:
 *
 *  1. classroomTopicMatch — decides whether an incoming diagnosed topic is
 *     the SAME as an existing one. Identity = normalised topic name +
 *     application context. A weakness diagnosed for application A must never
 *     silently merge into application B's topic just because the labels match.
 *
 *  2. pickContinuePreparing — the single highest-value thing a returning user
 *     should resume, derived ONLY from data already persisted. Deterministic
 *     priority order:
 *        1  an in-progress Development Module
 *        2  a demonstrated development need not yet developed
 *        3  a high-priority application preparation recommendation
 *     It NEVER collapses a preparation area into a "weakness": every item
 *     carries evidenceType "demonstrated" (interview evidence exists) or
 *     "preparation" (important for the application, not yet tested).
 *
 *  Plus redoConceptUnion — the de-duplicated concept set a "redo the original
 *  interview question" answer is marked against (reuses writtenQuiz.js).
 * ================================================================== */
import { applicationDevelopmentPriorities } from "./applicationIntelligence.js";

function str(v, f = "") { return typeof v === "string" ? v : v == null ? f : String(v); }
function arr(v) { return Array.isArray(v) ? v : []; }
function num(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function norm(s) { return str(s).toLowerCase().replace(/[^a-z0-9]/g, ""); }
// epoch ms for a possibly-absent / malformed timestamp; unknown -> 0 (sorts last on DESC).
function timeMs(v) { const t = new Date(v || 0).getTime(); return Number.isFinite(t) ? t : 0; }

// ---- deterministic comparator chain ----
// Phase 15B: sorting inside every tier is a TOTAL order — the last key in each
// chain is a unique id, so the result never depends on DB query order, array
// insertion order, or a stable sort preserving an arbitrary source order.
function cmpChain(a, b, keys) {
  for (const k of keys) { const d = k(a, b); if (d) return d; }
  return 0;
}
const descNum = (get) => (a, b) => num(get(b), 0) - num(get(a), 0);
const ascNum = (get) => (a, b) => num(get(a), 0) - num(get(b), 0);
const descTime = (get) => (a, b) => timeMs(get(b)) - timeMs(get(a));
const ascStr = (get) => (a, b) => { const av = str(get(a)), bv = str(get(b)); return av < bv ? -1 : av > bv ? 1 : 0; };
const latestScore = (t) => { const s = arr(t && t.scores); return s.length ? num(s[s.length - 1], 0) : 0; };

/**
 * classroomTopicMatch(list, topicName, effectiveAppId) -> existing topic | null
 *
 * `effectiveAppId` is the application the incoming diagnosis belongs to
 * (an interview always has one; an assessment-centre exercise that did not
 * match a real application passes null). An existing topic matches ONLY when:
 *   - its application context is the SAME  (both the same app id, OR both
 *     null — the single "unscoped practice" bucket for legacy / no-application
 *     assessment-centre topics), AND
 *   - the normalised topic names overlap (exact, or one contains the other).
 *
 * This is the isolation rule: same label + different application => NOT a match
 * => a separate, application-scoped topic is created.
 */
export function classroomTopicMatch(list, topicName, effectiveAppId) {
  const target = norm(topicName);
  if (!target) return null;
  const wantApp = effectiveAppId || null;
  for (const x of arr(list)) {
    const xApp = (x && x.applicationId) || null;
    if (xApp !== wantApp) continue;
    const xn = norm(x && x.topic);
    if (!xn) continue;
    if (xn === target || xn.includes(target) || target.includes(xn)) return x;
  }
  return null;
}

// a module whose best written-quiz coverage reached this is "developing well",
// not "in progress" — it drops out of Priority 1.
const DEVELOPED_COVERAGE_BAR = 0.85;
// a diagnosed topic whose latest interview score is at/above this is not urgent
// enough to be Priority 2.
const DEMONSTRATED_SCORE_BAR = 70;

/**
 * pickContinuePreparing(state, { limit } = {}) -> [item]  (deterministic)
 *
 * state = {
 *   developmentModules: [{ id, topic_id, dimension, topic, source_interview_id }],
 *   moduleProgress:     [{ module_id, attempts, best_coverage, flashcards_seen, retry_answers, updated_at }],
 *   classroomTopics:    [{ id, topic, category, company, role, scores[], lastInterviewId, applicationId, updated_at }],
 *   applications:       [{ id, company, role, applicationIntelligence, createdAt?, updatedAt? }],
 *   candidateState:      candidateState.js output (for applicationDevelopmentPriorities),
 * }
 *
 * Ranking WITHIN each tier is a total order (Phase 15B) — every chain ends in a
 * unique id, so the result never depends on input array / DB query order.
 *
 * item = {
 *   kind: "resume_module" | "develop_demonstrated" | "prepare_recommendation",
 *   topicId: string | null,
 *   recommendation?: <applicationDevelopmentPriorities entry>,  // only for prepare_recommendation
 *   applicationId?: string,                                     // only for prepare_recommendation
 *   title, company, role,
 *   dimension: "technical" | "behavioural" | "motivational" | null,
 *   evidenceType: "demonstrated" | "preparation",
 *   sublabel: string,  // psychologically-correct copy — never calls a preparation area a weakness
 * }
 */
export function pickContinuePreparing(state, { limit = 1 } = {}) {
  const cap = Math.max(1, num(limit, 1));
  const modules = arr(state && state.developmentModules);
  const progressByModule = new Map(arr(state && state.moduleProgress).map((p) => [str(p && p.module_id), p]));
  const topics = arr(state && state.classroomTopics);
  const topicById = new Map(topics.map((t) => [str(t && t.id), t]));
  const apps = arr(state && state.applications);
  const developedTopicIds = new Set(modules.map((m) => str(m && m.topic_id)));

  const out = [];

  // ---- Priority 1: an in-progress Development Module -------------------------
  // Eligibility UNCHANGED from Phase 15A: a progress row exists AND there is some
  // meaningful activity AND best quiz coverage has not yet reached the "developing
  // well" bar. Only the RANKING changes (Phase 15B): depth of progress first,
  // recency later, unique id last.
  const inProgress = modules
    .map((m) => ({ m, p: progressByModule.get(str(m && m.id)) }))
    .filter(({ p }) => p && (num(p.attempts) > 0 || num(p.flashcards_seen) > 0 || arr(p.retry_answers).length > 0))
    .filter(({ p }) => num(p.best_coverage, 0) < DEVELOPED_COVERAGE_BAR)
    .sort((a, b) => cmpChain(a, b, [
      descNum(({ p }) => p.best_coverage),                 // 1 higher quiz coverage first
      descNum(({ p }) => p.attempts),                      // 2 more completed quiz attempts first
      descNum(({ p }) => p.flashcards_seen),               // 3 more flashcard progress first
      descNum(({ p }) => arr(p.retry_answers).length),     // 4 more redo practice first
      descTime(({ p }) => p.updated_at),                   // 5 most recently active next
      ascStr(({ m }) => m.id),                             // 6 stable unique id -> total order
    ]));
  for (const { m } of inProgress) {
    const t = topicById.get(str(m.topic_id));
    const demonstrated = !!(m.source_interview_id || (t && t.lastInterviewId));
    out.push({
      kind: "resume_module",
      topicId: str(m.topic_id),
      title: str(m.topic || (t && t.topic)),
      company: str(t && t.company),
      role: str(t && t.role),
      dimension: str(m.dimension) || null,
      evidenceType: demonstrated ? "demonstrated" : "preparation",
      sublabel: demonstrated
        ? "You started this. Based on your interview performance."
        : "You started this. Important to prepare for this application.",
    });
    if (out.length >= cap) return out;
  }

  // ---- Priority 2: a demonstrated development need not yet developed --------
  // Product semantics UNCHANGED (Phase 15B): weakest latest score first, then
  // most recently updated. Only the FINAL tie-break is now a stable unique id
  // (topic.id ASC) instead of leaning on array order.
  const demonstratedUndeveloped = topics
    .filter((t) => t && t.lastInterviewId && !developedTopicIds.has(str(t.id)))
    .filter((t) => latestScore(t) < DEMONSTRATED_SCORE_BAR)
    .sort((a, b) => cmpChain(a, b, [
      ascNum(latestScore),                    // 1 lowest latest score first (weakest)
      descTime((t) => t.updated_at),          // 2 most recently updated next
      ascStr((t) => t.id),                    // 3 stable unique id -> total order
    ]));
  for (const t of demonstratedUndeveloped) {
    out.push({
      kind: "develop_demonstrated",
      topicId: str(t.id),
      title: str(t.topic),
      company: str(t.company),
      role: str(t.role),
      dimension: null,
      evidenceType: "demonstrated",
      sublabel: "Based on your previous interview performance.",
    });
    if (out.length >= cap) return out;
  }

  // ---- Priority 3: a high-priority application preparation recommendation --
  // Phase 15B: rank ACROSS all applications. Build one candidate per eligible
  // application (its highest qualifying recommendation), then sort the full
  // cross-application list by recommendation priority first — the most important
  // preparation need wins, regardless of which application it belongs to.
  // Gates unchanged: level === "high" AND gapKind === "preparation" (demonstrated
  // weaknesses can never enter P3).
  const cs = (state && state.candidateState) || {};
  const p3Candidates = [];
  for (const app of apps) {
    if (!app || !app.applicationIntelligence) continue;
    let recs = [];
    try { recs = applicationDevelopmentPriorities(app.applicationIntelligence, cs, { limit: 12 }); }
    catch (e) { recs = []; }
    // recs are already priority-DESC ordered -> .find gives this app's HIGHEST
    // qualifying high+preparation recommendation.
    const top = recs.find((r) => r.level === "high" && r.gapKind === "preparation");
    if (!top) continue;
    // if a topic for this label already exists in this application it is already
    // surfaced in the Classroom — don't double-surface it here.
    if (classroomTopicMatch(topics, top.label, str(app.id))) continue;
    p3Candidates.push({ app, top });
  }
  p3Candidates.sort((a, b) => cmpChain(a, b, [
    descNum(({ top }) => top.priority),          // 1 most important preparation need wins
    descTime(({ app }) => app.updatedAt),        // 2 application.updated_at DESC (if available)
    descTime(({ app }) => app.createdAt),        // 3 application.created_at DESC
    ascStr(({ top }) => top.label),              // 4 recommendation label ASC
    ascStr(({ app }) => app.id),                 // 5 stable unique application id -> total order
  ]));
  for (const { app, top } of p3Candidates) {
    out.push({
      kind: "prepare_recommendation",
      topicId: null,
      recommendation: top,
      applicationId: str(app.id),
      title: str(top.label),
      company: str(app.company),
      role: str(app.role),
      dimension: str(top.dimension) || null,
      evidenceType: "preparation",
      sublabel: `Important for your ${str(app.company) || "application"}. You have not been tested on this yet.`,
    });
    if (out.length >= cap) return out;
  }

  return out;
}

/**
 * redoConceptUnion(module) -> [{ label, concept, accepted_terms, accepted_phrasings, aliases, definition, required }]
 *
 * The de-duplicated union of every learning item's expected_concepts. This is
 * the deterministic marking target when the student re-answers the ORIGINAL
 * interview question (writtenQuiz.js markWrittenQuiz consumes this shape). No AI.
 *
 * Phase 21: the richer concept keys (aliases / definition / accepted_phrasings /
 * required) are passed straight through so a redo answer is marked with the same
 * tolerance as the quiz. Legacy modules carry only { label, accepted_terms };
 * the extra fields simply come through empty/absent and markWrittenQuiz defaults
 * `required` to true — identical behaviour to before Phase 21.
 */
export function redoConceptUnion(module) {
  const seen = new Set();
  const out = [];
  const list = (v) => arr(v).map((t) => str(t)).filter(Boolean);
  for (const item of arr(module && module.learning_items)) {
    for (const c of arr(item && item.expected_concepts)) {
      const label = (str(c && c.concept).trim() || str(c && c.label).trim());
      if (!label) continue;
      const key = norm(label);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        label,
        concept: label,
        accepted_terms: list(c && c.accepted_terms),
        accepted_phrasings: list(c && c.accepted_phrasings),
        aliases: list(c && c.aliases),
        definition: str(c && c.definition).trim(),
        required: c && c.required === false ? false : true,
      });
    }
  }
  return out;
}
