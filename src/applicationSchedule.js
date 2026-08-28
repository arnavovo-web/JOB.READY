/* ================================================================== *
 * PHASE 16A — APPLICATION INTERVIEW-DATE SCHEDULE HELPERS
 * ------------------------------------------------------------------
 * Pure, deterministic, offline (no AI, no DB, no React, no timers, never
 * throws). Turns an optional interview date on an Application into:
 *   - a plain-text countdown ("Interview in 3 days", never colour alone);
 *   - an ordering (nearest future interview first; no-date and past-date
 *     applications are "other", never treated as upcoming);
 *   - the nearest genuinely-upcoming Application.
 *
 * NOTE: this stores + computes date status ONLY. JOB.READY has no
 * notification / reminder delivery mechanism — nothing here sends or
 * schedules anything.
 * ================================================================== */

// calendar-day difference: floor both instants to local midnight, then diff.
// Returns integer days (negative = in the past, 0 = today). null if unparseable.
export function daysUntil(dateValue, now = new Date()) {
  if (dateValue == null || dateValue === "") return null;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const n = now instanceof Date ? now : new Date(now);
  const b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return Math.round((a - b) / 86400000);
}

/**
 * interviewCountdown(dateValue, now?) ->
 *   { status, days, label, isUpcoming }
 *
 * status:  "none"    — no date set
 *          "today"   — the interview is today
 *          "tomorrow"
 *          "soon"    — 2..6 days
 *          "upcoming"— 7+ days
 *          "past"    — the date is behind us (still editable; NOT "complete")
 * label:   human text, e.g. "Interview in 3 days" / "Interview today" /
 *          "Interview date has passed". Empty string when status "none".
 * isUpcoming: true only for today / tomorrow / soon / upcoming.
 */
export function interviewCountdown(dateValue, now = new Date()) {
  const days = daysUntil(dateValue, now);
  if (days == null) return { status: "none", days: null, label: "", isUpcoming: false };
  if (days < 0) return { status: "past", days, label: "Interview date has passed", isUpcoming: false };
  if (days === 0) return { status: "today", days: 0, label: "Interview today", isUpcoming: true };
  if (days === 1) return { status: "tomorrow", days: 1, label: "Interview tomorrow", isUpcoming: true };
  if (days === 7) return { status: "upcoming", days: 7, label: "Interview in 1 week", isUpcoming: true };
  if (days >= 14) {
    const weeks = Math.round(days / 7);
    return { status: "upcoming", days, label: `Interview in ${weeks} weeks`, isUpcoming: true };
  }
  const status = days <= 6 ? "soon" : "upcoming";
  return { status, days, label: `Interview in ${days} days`, isUpcoming: true };
}

// internal: the sort key. Genuinely-upcoming applications sort first by
// nearest date; everything else (no date, or past date) sorts after, and
// among "other" a stable id keeps the order deterministic.
function upcomingRank(app, now) {
  const days = daysUntil(app && app.interviewDate, now);
  if (days != null && days >= 0) return { bucket: 0, days };
  return { bucket: 1, days: Number.POSITIVE_INFINITY };
}

/**
 * sortApplicationsByUpcoming(apps, now?) -> apps (new array)
 * Deterministic TOTAL order:
 *   1. genuinely-upcoming (future / today) — nearest date first
 *   2. everything else (no date, or past date) — unchanged relative order,
 *      then application id ASC as the final stable tie-break.
 */
export function sortApplicationsByUpcoming(apps, now = new Date()) {
  const list = Array.isArray(apps) ? apps.slice() : [];
  return list.sort((a, b) => {
    const ra = upcomingRank(a, now), rb = upcomingRank(b, now);
    if (ra.bucket !== rb.bucket) return ra.bucket - rb.bucket;
    if (ra.bucket === 0 && ra.days !== rb.days) return ra.days - rb.days;
    // stable within a day, and within "other": application id ASC (unique)
    const ida = String((a && a.id) || ""), idb = String((b && b.id) || "");
    return ida < idb ? -1 : ida > idb ? 1 : 0;
  });
}

/**
 * partitionApplications(apps, now?) -> { upcoming: [...], other: [...] }
 * `upcoming` = future/today interview date, nearest first.
 * `other`    = no date, or a past date (a past date is NOT "upcoming").
 */
export function partitionApplications(apps, now = new Date()) {
  const sorted = sortApplicationsByUpcoming(apps, now);
  const upcoming = [], other = [];
  for (const app of sorted) {
    const days = daysUntil(app && app.interviewDate, now);
    (days != null && days >= 0 ? upcoming : other).push(app);
  }
  return { upcoming, other };
}

/**
 * nearestUpcomingApplication(apps, now?) -> app | null
 * The single application whose future interview date is nearest.
 */
export function nearestUpcomingApplication(apps, now = new Date()) {
  return partitionApplications(apps, now).upcoming[0] || null;
}
