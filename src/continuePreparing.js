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
 *   applications:       [{ id, company, role, applicationIntelligence }],
 *   candidateState:      candidateState.js output (for applicationDevelopmentPriorities),
 * }
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
  const inProgress = modules
    .map((m) => ({ m, p: progressByModule.get(str(m && m.id)) }))
    .filter(({ p }) => p && (num(p.attempts) > 0 || num(p.flashcards_seen) > 0 || arr(p.retry_answers).length > 0))
    .filter(({ p }) => num(p.best_coverage, 0) < DEVELOPED_COVERAGE_BAR)
    .sort((a, b) => new Date(b.p.updated_at || 0) - new Date(a.p.updated_at || 0));
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
  const demonstratedUndeveloped = topics
    .filter((t) => t && t.lastInterviewId && !developedTopicIds.has(str(t.id)))
    .filter((t) => {
      const s = arr(t.scores);
      const latest = s.length ? num(s[s.length - 1], 0) : 0;
      return latest < DEMONSTRATED_SCORE_BAR;
    })
    .sort((a, b) => {
      const as = arr(a.scores), bs = arr(b.scores);
      const al = as.length ? num(as[as.length - 1]) : 0;
      const bl = bs.length ? num(bs[bs.length - 1]) : 0;
      if (al !== bl) return al - bl; // weakest first
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    });
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
  const cs = (state && state.candidateState) || {};
  for (const app of apps) {
    if (!app || !app.applicationIntelligence) continue;
    let recs = [];
    try { recs = applicationDevelopmentPriorities(app.applicationIntelligence, cs, { limit: 12 }); }
    catch (e) { recs = []; }
    const top = recs.find((r) => r.level === "high" && r.gapKind === "preparation");
    if (!top) continue;
    // if a topic for this label already exists in this application it is
    // already surfaced in the Classroom — don't double-surface it here.
    if (classroomTopicMatch(topics, top.label, str(app.id))) continue;
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
 * redoConceptUnion(module) -> [{ label, accepted_terms }]
 *
 * The de-duplicated union of every learning item's expected_concepts. This is
 * the deterministic marking target when the student re-answers the ORIGINAL
 * interview question (writtenQuiz.js markWrittenQuiz consumes this shape). No AI.
 */
export function redoConceptUnion(module) {
  const seen = new Set();
  const out = [];
  for (const item of arr(module && module.learning_items)) {
    for (const c of arr(item && item.expected_concepts)) {
      const label = str(c && c.label).trim();
      if (!label) continue;
      const key = norm(label);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label, accepted_terms: arr(c && c.accepted_terms).map((t) => str(t)).filter(Boolean) });
    }
  }
  return out;
}
