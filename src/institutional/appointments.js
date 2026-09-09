/* ================================================================== *
 * EKI² — Careers Appointments: pure shaping
 * ------------------------------------------------------------------
 * Transforms the eki_student_briefing / list_institution_appointments
 * RPC output for display, and derives the top-of-page "Appointment
 * briefing" sentences. Every statement here is a restatement of a
 * number or the student's own comment — nothing invented, no advice.
 * Dependency-light (taxonomy labels only). Tested in appointments.test.js.
 * ================================================================== */

import { dimensionLabel, categoryLabel } from "./taxonomy.js";

export const APPOINTMENT_STATUS = {
  booked:    { label: "Booked",    tone: "info" },
  completed: { label: "Completed", tone: "good" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  no_show:   { label: "No-show",   tone: "warn" },
};
export function statusMeta(s) {
  return APPOINTMENT_STATUS[s] || { label: s || "—", tone: "neutral" };
}

const BAND_TONE = { strong: "good", solid: "good", developing: "warn", priority: "bad" };
const BAND_WORD = { strong: "strong", solid: "on track", developing: "developing", priority: "below target" };
export function bandTone(b) { return BAND_TONE[b] || "neutral"; }
export function bandWord(b) { return BAND_WORD[b] || b || ""; }

/* ---- date / time helpers (locale-free, deterministic) ---------- */
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function d(x) { return x instanceof Date ? x : new Date(x); }
function hhmm(x) {
  const t = d(x);
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}
export function dayLabel(x) {
  const t = d(x);
  return `${DAYS[t.getDay()]} ${t.getDate()} ${MONTHS[t.getMonth()]}`;
}
export function dayKey(x) {
  const t = d(x);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
export function timeRange(startISO, endISO) {
  if (!startISO) return "";
  return endISO ? `${hhmm(startISO)} – ${hhmm(endISO)}` : hhmm(startISO);
}
export function dateTimeLabel(startISO) {
  return startISO ? `${dayLabel(startISO)} · ${hhmm(startISO)}` : "";
}
export function isFuture(iso) {
  return !!iso && d(iso).getTime() > Date.now();
}

/* ---- schedule grouping --------------------------------------- */
export function groupAppointmentsByDay(list) {
  const byDay = new Map();
  for (const a of list || []) {
    const k = a.starts_at ? dayKey(a.starts_at) : "unknown";
    if (!byDay.has(k)) byDay.set(k, { key: k, label: a.starts_at ? dayLabel(a.starts_at) : "Unscheduled", items: [] });
    byDay.get(k).items.push(a);
  }
  return [...byDay.values()]
    .sort((x, y) => x.key.localeCompare(y.key))
    .map((g) => ({ ...g, items: g.items.sort((x, y) => String(x.starts_at).localeCompare(String(y.starts_at))) }));
}

export function splitUpcomingPast(list) {
  const up = [], past = [];
  for (const a of list || []) {
    (isFuture(a.starts_at) && a.status === "booked" ? up : past).push(a);
  }
  up.sort((x, y) => String(x.starts_at).localeCompare(String(y.starts_at)));
  past.sort((x, y) => String(y.starts_at).localeCompare(String(x.starts_at)));
  return { upcoming: up, past };
}

/* ================================================================= *
 * BRIEFING — shape + derive
 * ================================================================= */

/** Normalise the eki_student_briefing envelope into a display model. */
export function shapeBriefing(raw) {
  if (!raw || typeof raw !== "object") return null;
  const dna = raw.interview_dna || {};
  const dims = (dna.dimensions || []).map((x) => ({
    key: x.key, label: dimensionLabel(x.key), mean: x.mean, band: x.band,
    belowTarget: !!x.below_target, tone: bandTone(x.band),
  }));
  const strengths = (dna.strengths || []).map((x) => ({ key: x.key, label: dimensionLabel(x.key), mean: x.mean }));
  const development = (dna.development_areas || []).map((x) => ({ key: x.key, label: dimensionLabel(x.key), mean: x.mean }));
  const p = raw.patterns || {};
  return {
    generatedAt: raw.generated_at,
    target: raw.target ?? 70,
    student: {
      name: raw.student?.name || null,
      institution: raw.student?.institution_name || null,
      cohorts: Array.isArray(raw.student?.cohorts) ? raw.student.cohorts : [],
    },
    appointment: {
      id: raw.appointment?.id,
      status: raw.appointment?.status,
      typeLabel: raw.appointment?.type_label || "Careers appointment",
      startsAt: raw.appointment?.starts_at || null,
      endsAt: raw.appointment?.ends_at || null,
      comment: raw.appointment?.student_comment || null,
    },
    application: raw.application && typeof raw.application === "object" ? {
      company: raw.application.company || null,
      role: raw.application.role || null,
      stage: raw.application.stage || null,
      interviewDate: raw.application.interview_date || null,
      createdAt: raw.application.created_at || null,
      practiceInterviews: raw.application.practice_interviews ?? 0,
    } : null,
    dna: {
      nInterviews: dna.n_completed_interviews ?? 0,
      hasEnoughData: !!dna.has_enough_data,
      overallMean: dna.overall_mean ?? null,
      dimensions: dims,
      strengths,
      development,
    },
    patterns: {
      repeatedDevelopmentArea: p.repeated_development_area ? {
        key: p.repeated_development_area.key,
        label: dimensionLabel(p.repeated_development_area.key),
        overallMean: p.repeated_development_area.overall_mean,
        recentMean: p.repeated_development_area.recent_mean,
        recentInterviews: p.repeated_development_area.recent_interviews,
      } : null,
      performanceTrend: p.performance_trend ? {
        first: p.performance_trend.first,
        latest: p.performance_trend.latest,
        delta: p.performance_trend.delta,
        nInterviews: p.performance_trend.n_interviews,
      } : null,
      hardestCategory: p.hardest_question_category ? {
        key: p.hardest_question_category.key,
        label: categoryLabel(p.hardest_question_category.key),
        mean: p.hardest_question_category.mean,
      } : null,
    },
  };
}

/**
 * The top-of-page "Appointment briefing" — four factual lines the adviser can
 * absorb in seconds. Returns { primaryDevelopmentArea, strongestArea,
 * relevantApplication, studentReason, hasData }. Every field is null when the
 * data does not support it — never a fabricated fill-in.
 */
export function deriveBriefingSummary(shaped) {
  if (!shaped) return { hasData: false };
  const dna = shaped.dna || {};
  const primary = dna.development?.[0] || null;
  const strong = dna.strengths?.[0] || null;
  const app = shaped.application;
  return {
    hasData: dna.hasEnoughData,
    nInterviews: dna.nInterviews,
    primaryDevelopmentArea: primary
      ? { label: primary.label, mean: primary.mean, target: shaped.target }
      : null,
    strongestArea: strong
      ? { label: strong.label, mean: strong.mean }
      : null,
    relevantApplication: app && (app.company || app.role)
      ? { company: app.company, role: app.role, stage: app.stage }
      : null,
    studentReason: shaped.appointment?.comment || null,
    repeatedConcern: shaped.patterns?.repeatedDevelopmentArea
      ? shaped.patterns.repeatedDevelopmentArea.label
      : null,
    trend: shaped.patterns?.performanceTrend || null,
  };
}

/** Human sentence for the repeated development-area pattern (or null). */
export function repeatedDevelopmentSentence(shaped) {
  const r = shaped?.patterns?.repeatedDevelopmentArea;
  if (!r) return null;
  return `${r.label} has been below target across the student's last ${r.recentInterviews} interviews `
    + `(recent average ${r.recentMean}, overall ${r.overallMean}).`;
}

/** Human sentence for the improvement trend (or null). */
export function trendSentence(shaped) {
  const t = shaped?.patterns?.performanceTrend;
  if (!t) return null;
  const dir = t.delta > 2 ? "risen" : t.delta < -2 ? "fallen" : "held roughly steady";
  const by = Math.abs(t.delta) >= 3 ? ` by ${Math.abs(t.delta)} points` : "";
  return `Overall interview score has ${dir}${by} across ${t.nInterviews} completed interviews (${t.first} → ${t.latest}).`;
}

/* ================================================================= *
 * CAREERS RELATIONSHIP HISTORY
 * ================================================================= */

/**
 * Shape the eki_student_careers_profile envelope: everything shapeBriefing
 * produces, PLUS the current appointment's own outcome, previous_support,
 * chronological history[], and longitudinal[] statements.
 */
export function shapeCareersProfile(raw) {
  const base = shapeBriefing(raw);
  if (!base) return null;
  return {
    ...base,
    currentOutcome: raw?.current_outcome && typeof raw.current_outcome === "object"
      ? {
          discussed: raw.current_outcome.discussed || "",
          actionsAgreed: raw.current_outcome.actions_agreed || "",
          nextSteps: raw.current_outcome.next_steps || "",
          followUpRequired: !!raw.current_outcome.follow_up_required,
          followUpNotes: raw.current_outcome.follow_up_notes || "",
          createdAt: raw.current_outcome.created_at || null,
          updatedAt: raw.current_outcome.updated_at || null,
          updatedByName: raw.current_outcome.updated_by_name || null,
        }
      : null,
    previousSupport: shapePreviousSupport(raw?.previous_support),
    history: (Array.isArray(raw?.history) ? raw.history : []).map(shapeHistoryEntry),
    longitudinal: (Array.isArray(raw?.longitudinal) ? raw.longitudinal : []).map(shapeLongitudinal),
  };
}

function shapePreviousSupport(p) {
  if (!p || typeof p !== "object") return null;
  return {
    appointmentId: p.appointment_id,
    startsAt: p.starts_at || null,
    daysAgo: p.days_ago ?? null,
    typeLabel: p.type_label || "Careers appointment",
    adviserName: p.adviser_name || null,
    status: p.status || null,
    studentComment: p.student_comment || null,
    keyDevelopmentArea: p.key_development_area ? dimensionLabel(p.key_development_area) : null,
    hasOutcome: !!p.has_outcome,
    actionAgreed: p.actions_agreed || null,
    nextSteps: p.next_steps || null,
    followUpRequired: !!p.follow_up_required,
  };
}

function shapeHistoryEntry(h) {
  return {
    appointmentId: h.appointment_id,
    startsAt: h.starts_at || null,
    status: h.status || null,
    typeLabel: h.type_label || "Careers appointment",
    adviserName: h.adviser_name || null,
    studentComment: h.student_comment || null,
    hasOutcome: !!h.has_outcome,
    discussed: h.discussed || null,
    actionsAgreed: h.actions_agreed || null,
    nextSteps: h.next_steps || null,
    followUpRequired: !!h.follow_up_required,
    followUpNotes: h.follow_up_notes || null,
    outcomeUpdatedAt: h.outcome_updated_at || null,
    outcomeBy: h.outcome_by || null,
  };
}

function shapeLongitudinal(l) {
  return {
    kind: l.kind,
    priorAppointmentId: l.prior_appointment_id,
    priorDate: l.prior_date || null,
    priorType: l.prior_type || null,
    beforeMean: l.before_mean ?? null,
    afterMean: l.after_mean ?? null,
    delta: l.delta ?? null,
    nBefore: l.n_before ?? 0,
    nAfter: l.n_after ?? 0,
  };
}

/**
 * The "Previous careers support" context block model for the current
 * appointment's header. Returns null when there is no prior appointment —
 * the UI then shows "No previous careers appointments" (never fabricated).
 */
export function previousSupportModel(shaped) {
  const p = shaped?.previousSupport;
  if (!p) return null;
  const rows = [];
  if (p.daysAgo != null) rows.push({ label: "Last appointment", value: `${p.daysAgo} day${p.daysAgo === 1 ? "" : "s"} ago${p.adviserName ? ` · ${p.adviserName}` : ""}` });
  rows.push({ label: "Focus", value: p.typeLabel });
  if (p.keyDevelopmentArea) rows.push({ label: "Key development area then", value: p.keyDevelopmentArea });
  if (p.actionAgreed) rows.push({ label: "Action agreed", value: p.actionAgreed });
  if (p.nextSteps) rows.push({ label: "Recommended next steps", value: p.nextSteps });
  rows.push({ label: "Follow-up required", value: p.followUpRequired ? "Yes" : "No" });
  return { hasOutcome: p.hasOutcome, studentComment: p.studentComment, rows };
}

/**
 * Factual longitudinal statement — NEVER causal. Only produced from a
 * longitudinal entry the RPC already validated (prior appointment has an
 * outcome, and there is ≥1 completed interview on each side of it).
 */
export function longitudinalStatement(l) {
  if (!l || l.delta == null) return null;
  const dir = l.delta > 0 ? "increased" : l.delta < 0 ? "decreased" : "was unchanged";
  const amt = l.delta === 0 ? "" : ` by ${Math.abs(l.delta)} point${Math.abs(l.delta) === 1 ? "" : "s"}`;
  return `Interview performance ${dir}${amt} following the previous recorded intervention `
    + `(mean ${l.beforeMean} across ${l.nBefore} interview${l.nBefore === 1 ? "" : "s"} before, `
    + `${l.afterMean} across ${l.nAfter} after).`;
}

/** Empty / prefilled adviser-outcome form values. */
export function outcomeFormValues(shaped) {
  const o = shaped?.currentOutcome;
  return {
    discussed: o?.discussed || "",
    actionsAgreed: o?.actionsAgreed || "",
    nextSteps: o?.nextSteps || "",
    followUpRequired: !!o?.followUpRequired,
    followUpNotes: o?.followUpNotes || "",
  };
}
export function outcomeFormToRpcArgs(appointmentId, v) {
  return {
    p_appointment_id: appointmentId,
    p_discussed: emptyToNull(v.discussed),
    p_actions_agreed: emptyToNull(v.actionsAgreed),
    p_next_steps: emptyToNull(v.nextSteps),
    p_follow_up_required: !!v.followUpRequired,
    p_follow_up_notes: emptyToNull(v.followUpNotes),
  };
}
function emptyToNull(s) { const t = (s || "").trim(); return t ? t : null; }
