/* ================================================================== *
 * PHASE 18 — RESUMABLE IN-PROGRESS INTERVIEWS
 * ------------------------------------------------------------------
 * Pure, deterministic, OFFLINE. No AI, no `callClaude`, no `ai-generate`,
 * no DB client, no React, no timers. Given the already-persisted rows for
 * one unfinished interview, it reconstructs the exact React `interview`
 * state the live flow expects — or reports, safely, that the interview
 * cannot be reconstructed (legacy row with no persisted profile, no
 * questions, malformed data). It NEVER throws.
 *
 * The one persistence change Phase 18 relies on: analyseAndPlan now writes
 *   config.profile        = { interview_profile, candidate_profile, opening_question }
 *   config.max_questions   = the adaptive completion target (the wizard "Length")
 * onto the interviews.config jsonb column at creation. No migration — that
 * column already exists and already carries question_mix / invitationContext.
 * A row without config.profile is a legacy in_progress interview and is
 * reported as NOT resumable (reason "no_profile") rather than crashing or
 * falsely promising resume.
 *
 * Resuming = persistence read + this deterministic reconstruction. Zero AI.
 * If the interruption happened inside the adaptive Call-2 gap (the answer to
 * the last question is persisted but its follow-up was never generated), the
 * reconstructed state carries `pendingRecovery`, and the EXISTING
 * regenerateNextQuestion affordance handles the single generation call on the
 * user's explicit click — that click is not "resume".
 * ================================================================== */

function str(v, f = "") { return typeof v === "string" ? v : v == null ? f : String(v); }
function arr(v) { return Array.isArray(v) ? v : []; }
function num(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function parseTs(v) {
  if (v == null) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

const BATCH_PIPELINE = "independent_batch";

// A normalized question row is "answered" only when the caller explicitly
// folded an answer row into it (answered === true). Anything else — no answer,
// a malformed row, a stray boolean — counts as unanswered.
function hasAnswer(q) { return !!(q && q.answered === true); }

function hydrateAdaptiveQuestion(q) {
  const m = q && q.metadata && typeof q.metadata === "object" ? q.metadata : {};
  return {
    dbId: q.id,
    questionNumber: num(q.question_number, 0),
    text: str(q.question_text),
    category: q.category || null,
    competency: q.competency || null,
    anchor_source: q.anchor_source ?? null,
    turn_type: m.turn_type ?? q.turn_type ?? null,
  };
}
function hydrateBatchQuestion(q) {
  const m = q && q.metadata && typeof q.metadata === "object" ? q.metadata : {};
  return {
    dbId: q.id,
    questionNumber: num(q.question_number, 0),
    text: str(q.question_text),
    category: q.category || null,
    competency: q.competency || null,
    anchor_source: q.anchor_source ?? null,
    difficulty: m.difficulty || null,
    is_technical: !!m.is_technical,
    role_relevance: m.role_relevance || null,
    expected_answer_characteristics: m.expected_answer_characteristics || null,
    prepSeconds: Number.isFinite(q.prep_seconds) ? q.prep_seconds : null,
    answerSeconds: Number.isFinite(q.answer_seconds) ? q.answer_seconds : null,
  };
}
function hydrateEvaluation(ev) {
  if (!ev || typeof ev !== "object") return null;
  return {
    relevance: num(ev.relevance), specificity: num(ev.specificity), structure: num(ev.structure),
    evidence: num(ev.evidence), clarity: num(ev.clarity), competency_demonstration: num(ev.competency_demonstration),
    strengths: arr(ev.strengths), issues: arr(ev.issues),
  };
}

function notResumable(reason) {
  return {
    resumable: false, reason, pipeline: null, screen: null, needsFinish: false,
    answeredCount: 0, totalQuestions: 0, interview: null, profile: null,
  };
}

/**
 * reconstructInterviewState({ interviewRow, questions, meta }, now?) -> {
 *   resumable, reason, pipeline, screen, needsFinish,
 *   answeredCount, totalQuestions, interview, profile
 * }
 *
 * `questions` — NORMALIZED array (caller flattens the Supabase nested read), each:
 *   { id, question_number, question_text, category, competency, anchor_source,
 *     metadata, prep_seconds, answer_seconds,
 *     answered: boolean, answer_text, time_expired, answer_id, evaluation }
 * `meta` — { company, role, stageLabel, formatLabel } resolved by the caller
 *   (labels come from App.jsx catalogs; kept out of this pure module).
 */
export function reconstructInterviewState(input, now = Date.now()) {
  try {
    const { interviewRow, questions, meta } = input && typeof input === "object" ? input : {};
    const row = interviewRow && typeof interviewRow === "object" ? interviewRow : null;
    if (!row || !row.id) return notResumable("malformed");
    if (str(row.status) === "completed") return notResumable("already_complete");

    const config = row.config && typeof row.config === "object" ? row.config : null;
    const persistedProfile = config && config.profile && typeof config.profile === "object" ? config.profile : null;
    if (!persistedProfile || !persistedProfile.interview_profile) return notResumable("no_profile");

    const qs = arr(questions).slice().sort((a, b) => num(a.question_number) - num(b.question_number));
    if (!qs.length) return notResumable("no_questions");

    const m = meta && typeof meta === "object" ? meta : {};
    const pipeline = str(config.pipeline) === BATCH_PIPELINE ? BATCH_PIPELINE : "adaptive_turn";
    const base = {
      id: row.id,
      applicationId: row.application_id || null,
      company: str(m.company),
      role: str(m.role),
      stage: row.stage || config.stage || null,
      format: row.format || config.format || null,
      stageLabel: m.stageLabel || null,
      formatLabel: m.formatLabel || null,
      startedAt: parseTs(row.started_at) || parseTs(row.created_at) || now,
      config,
      methodologyDistribution: row.methodology_distribution || null,
      status: "in_progress",
    };

    const answeredCount = qs.filter(hasAnswer).length;

    return pipeline === BATCH_PIPELINE
      ? reconstructBatch(base, qs, persistedProfile, answeredCount)
      : reconstructAdaptive(base, qs, persistedProfile, config, answeredCount);
  } catch (e) {
    return notResumable("malformed");
  }
}

// ---------------------------------------------------------------- adaptive
function reconstructAdaptive(base, qs, persistedProfile, config, answeredCount) {
  // completion target: the wizard "Length", persisted on config.max_questions.
  // Fallback for a row written before this field existed: the number of
  // questions already generated (so the interview can at least be finished).
  const maxQuestions = Math.max(1, num(config.max_questions, qs.length));

  const transcript = qs.filter(hasAnswer).map((q) => ({
    question: hydrateAdaptiveQuestion(q),
    answer: str(q.answer_text),
    evaluation: hydrateEvaluation(q.evaluation) || {},
  }));

  const firstUnanswered = qs.find((q) => !hasAnswer(q)) || null;
  const lastQ = qs[qs.length - 1];
  const out = {
    resumable: true, reason: "ok", pipeline: "adaptive_turn", screen: "interview",
    needsFinish: false, answeredCount, totalQuestions: qs.length, profile: persistedProfile,
  };

  // Case 1 — a generated-but-unanswered question exists: resume straight to it.
  if (firstUnanswered) {
    out.interview = { ...base, maxQuestions, transcript, currentQuestion: hydrateAdaptiveQuestion(firstUnanswered), pendingRecovery: null };
    return out;
  }

  // Every generated question is answered.
  // Case 2 — that's also the target count: nothing left to ask, but status is
  // still in_progress (a completion that never persisted). Route to finish.
  if (answeredCount >= maxQuestions) {
    out.needsFinish = true;
    out.interview = { ...base, maxQuestions, transcript, currentQuestion: null, pendingRecovery: null };
    return out;
  }

  // Case 3 — Call-2 gap: the last question is answered, more are due, but the
  // follow-up was never generated. Restore pendingRecovery; the EXISTING
  // regenerateNextQuestion affordance makes the one generation call on the
  // user's explicit click (that click is not "resume").
  const pending = lastQ && lastQ.metadata && lastQ.metadata.pending_next_decision;
  out.interview = {
    ...base, maxQuestions, transcript, currentQuestion: null,
    pendingRecovery: {
      questionId: lastQ ? lastQ.id : null,
      decision: (pending && pending.decision) || null,
      genInput: (pending && pending.genInput) || null,
      targetedClaimId: null,
    },
  };
  return out;
}

// ------------------------------------------------------------------- batch
function reconstructBatch(base, qs, persistedProfile, answeredCount) {
  const questions = qs.map(hydrateBatchQuestion);
  // batch answers are submitted strictly in order; currentIndex = how many are in.
  const answers = qs.filter(hasAnswer).map((q) => ({
    questionDbId: q.id,
    answerDbId: q.answer_id != null ? q.answer_id : null,
    text: str(q.answer_text),
    timeExpired: !!q.time_expired,
  }));
  const currentIndex = answers.length;
  return {
    resumable: true, reason: "ok", pipeline: "independent_batch",
    screen: "async_interview", needsFinish: currentIndex >= questions.length,
    answeredCount, totalQuestions: qs.length, profile: persistedProfile,
    interview: {
      ...base,
      cvBackground: null, // caller fills via cvBackgroundSummary(profile.candidate_profile)
      questions,
      currentIndex,
      answers,
    },
  };
}

/**
 * sortResumableInterviews(list, now?) -> new array. Deterministic, no scoring:
 *   1. application has a FUTURE interview_date -> nearest date first
 *   2. otherwise                               -> interview createdAt DESC
 *      (interviews has no updated_at column, so "most recently active" is
 *       approximated by creation time — documented fallback)
 *   3. final stable tie-break                  -> interview id ASC
 * Each item carries { id, interviewDate|null, createdAt }.
 */
export function sortResumableInterviews(list, now = Date.now()) {
  const d = new Date(now);
  const startOfToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const rank = (r) => {
    const t = parseTs(r && r.interviewDate);
    if (t != null && t >= startOfToday) return { bucket: 0, key: t };
    return { bucket: 1, key: -(parseTs(r && r.createdAt) || 0) }; // newer first
  };
  return arr(list).slice().sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra.bucket !== rb.bucket) return ra.bucket - rb.bucket;
    if (ra.key !== rb.key) return ra.key - rb.key;
    const ia = str(a && a.id), ib = str(b && b.id);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

/**
 * summariseResumable(row, counts, app) -> lightweight card metadata (pure).
 * Builds the Dashboard / Application "Continue your interview" surfaces
 * without loading any transcript. `counts` = { total, answered }.
 */
export function summariseResumable(row, counts, app) {
  const config = row && row.config && typeof row.config === "object" ? row.config : {};
  const pipeline = str(config.pipeline) === BATCH_PIPELINE ? BATCH_PIPELINE : "adaptive_turn";
  const { target, approximate } = resumableTarget(config, pipeline, counts && counts.total);
  return {
    id: row.id,
    applicationId: row.application_id || null,
    company: str(app && app.company),
    role: str(app && app.role),
    stage: row.stage || config.stage || null,
    pipeline,
    answeredCount: num(counts && counts.answered, 0),
    // raw count of questions GENERATED so far — kept for any consumer that
    // genuinely needs it; NOT the display denominator (see targetQuestions).
    totalQuestions: num(counts && counts.total, 0),
    // the configured interview target for the progress denominator (Phase 20)
    targetQuestions: target,
    targetApproximate: approximate,
    createdAt: row.created_at || null,
    interviewDate: (app && app.interview_date) || null,
    hasProfile: !!(config.profile && config.profile.interview_profile),
  };
}

/**
 * resumableTarget(config, pipeline, generatedCount) -> { target, approximate }
 *
 * The single canonical, deterministic source for a resumable interview's
 * DISPLAY denominator ("N of ~12 answered"). The number of questions generated
 * so far is NEVER the target when a configured target exists — it is only a
 * last-resort fallback for a legacy/corrupt row with no usable config.
 *
 *  adaptive_turn:
 *    config.max_questions  — the user's chosen "Length" (Short 5 / Medium 8 /
 *      Long 10); written on every interview created since Phase 18; the value the
 *      deterministic ending rule (isInterviewComplete) actually uses.
 *    config.question_count — stage default fallback for a pre-Phase-18 row.
 *    generatedCount        — genuine last resort (config entirely absent).
 *    -> always `approximate: true` — the adaptive engine can end a turn early or
 *       late by one, and the live interview screen already renders "of ~N".
 *
 *  independent_batch:
 *    config.question_count — the EXACT number the batch generator produces and
 *      persists up front (== generatedCount once generation completes).
 *    generatedCount        — last resort.
 *    -> `approximate: false` — batch length is fixed and exact.
 *
 * `applications.interview_length` is deliberately NOT consulted: it lives on the
 * application row, is overwritten by every later interview built for that
 * application, and therefore does not describe any one specific interview.
 */
export function resumableTarget(config, pipeline, generatedCount) {
  const c = config && typeof config === "object" ? config : {};
  const n = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.round(x) : 0; };
  const gen = n(generatedCount);
  if (str(pipeline) === BATCH_PIPELINE) {
    return { target: n(c.question_count) || gen || 0, approximate: false };
  }
  return { target: n(c.max_questions) || n(c.question_count) || gen || 0, approximate: true };
}

/**
 * resumableProgressLabel(summary) -> "3 of ~12 questions answered"
 * The ONE place the resumable-interview progress sentence is built, so the
 * Dashboard card, the Application-workspace card, and the resume/start-new
 * screen can never disagree. Uses the CONFIGURED target (targetQuestions), not
 * the number generated so far; "~" only when the target is approximate
 * (adaptive). Falls back to "?" for a legacy/corrupt row with no known target.
 */
export function resumableProgressLabel(summary) {
  const s = summary && typeof summary === "object" ? summary : {};
  const answered = num(s.answeredCount, 0);
  const t = num(s.targetQuestions, 0);
  const shown = t > 0 ? `${s.targetApproximate ? "~" : ""}${t}` : "?";
  return `${answered} of ${shown} question${t === 1 ? "" : "s"} answered`;
}
