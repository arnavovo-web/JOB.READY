/* ================================================================== *
 * INSTITUTIONAL INSIGHTS — pure analytics shaping
 * ------------------------------------------------------------------
 * Dependency-free transforms over data already fetched by api.js.
 * NO DB calls, NO React. The heavy cohort-vs-database aggregation is
 * done server-side by the Milestone 2 `inst_*` RPCs (so raw student
 * rows never reach the browser); this module shapes their k-anonymised
 * output for display, and shapes the config-table data (cohorts /
 * members) the foundation already exposes.
 * ================================================================== */

import {
  MIN_COHORT_N, COMPETENCY_DIMENSIONS, canonicalDimension, dimensionLabel, scoreBand,
} from "./taxonomy.js";

/* ---------- cohort / membership shaping (Milestone 1) ------------- */

/**
 * Group flat cohort_members rows by cohort and summarise. `cohorts` and
 * `organisations` are the config rows from api.listCohorts / listOrganisations.
 */
export function summariseCohorts(cohorts, members, organisations) {
  const orgById = new Map((organisations || []).map((o) => [o.id, o]));
  const byCohort = new Map();
  for (const m of members || []) {
    if (!byCohort.has(m.cohort_id)) byCohort.set(m.cohort_id, []);
    byCohort.get(m.cohort_id).push(m);
  }
  const rows = (cohorts || []).map((c) => {
    const ms = byCohort.get(c.id) || [];
    const linked = ms.filter((m) => m.student_id && m.status !== "removed").length;
    const invited = ms.filter((m) => !m.student_id && m.status === "invited").length;
    return {
      id: c.id,
      name: c.name,
      organisation: c.organisation_id ? (orgById.get(c.organisation_id)?.name || null) : null,
      academicYear: c.academic_year || null,
      graduationYear: c.graduation_year || null,
      linkedStudents: linked,
      pendingInvites: invited,
      totalMembers: linked + invited,
      belowThreshold: linked < MIN_COHORT_N,
    };
  });
  const totals = rows.reduce(
    (acc, r) => ({
      cohorts: acc.cohorts + 1,
      linkedStudents: acc.linkedStudents + r.linkedStudents,
      pendingInvites: acc.pendingInvites + r.pendingInvites,
    }),
    { cohorts: 0, linkedStudents: 0, pendingInvites: 0 }
  );
  // A student may sit in multiple cohorts — count distinct linked students too.
  totals.distinctLinkedStudents = new Set(
    (members || []).filter((m) => m.student_id && m.status !== "removed").map((m) => m.student_id)
  ).size;
  return { rows, totals };
}

/* ---------- analytics-envelope helpers (Milestone 2 output) ------- */

/** Is this an api.js "unsupported" envelope rather than real data? */
export function isUnsupported(res) {
  return !res || res.supported === false || res.reason === "analytics_engine_pending";
}

/** Standard reasons a group/metric can be withheld or absent. */
export const LIMITATION = {
  ANALYTICS_PENDING: "The analytics engine (Milestone 2) is not deployed yet.",
  BELOW_K: `Hidden: fewer than ${MIN_COHORT_N} students with data in this group.`,
  NO_DATA: "No completed interviews match the current filters.",
  METRIC_UNSUPPORTED_BY_SCHEMA: "The database does not currently capture what this metric needs — see notes.",
};

/**
 * Normalise a server competency block { relevance, specificity, ... } (any of
 * the 6 canonical keys, plus `clarity` alias) into an ordered array for the
 * competency chart, dropping keys with null/withheld values but keeping the
 * canonical order.
 */
export function shapeCompetencyScores(block) {
  if (!block || typeof block !== "object") return [];
  const merged = {};
  for (const [k, v] of Object.entries(block)) {
    const key = canonicalDimension(k);
    if (!key) continue;
    if (v == null || Number.isNaN(Number(v))) continue;
    // if both `clarity` and `communication` are present, prefer the later/explicit one
    merged[key] = Number(v);
  }
  return COMPETENCY_DIMENSIONS
    .filter((d) => merged[d.key] != null)
    .map((d) => ({
      key: d.key,
      label: dimensionLabel(d.key),
      blurb: d.blurb,
      score: Math.round(merged[d.key]),
      band: scoreBand(merged[d.key]),
    }));
}

/** Rank shaped competency scores; return strongest / weakest slices. */
export function strengthsAndWeaknesses(shaped, count = 3) {
  const sorted = [...shaped].sort((a, b) => b.score - a.score);
  return {
    strongest: sorted.slice(0, count),
    weakest: sorted.slice(-count).reverse(),
  };
}

/**
 * Turn a server distribution { buckets:[{label,count}], n } into chart rows
 * with percentages, suppressing the whole distribution if n < MIN_COHORT_N.
 */
export function shapeDistribution(dist) {
  if (!dist || !Array.isArray(dist.buckets)) return { suppressed: true, reason: LIMITATION.NO_DATA, rows: [], n: 0 };
  const n = Number(dist.n || dist.buckets.reduce((s, b) => s + (b.count || 0), 0));
  if (n < MIN_COHORT_N) return { suppressed: true, reason: LIMITATION.BELOW_K, rows: [], n };
  return {
    suppressed: false,
    n,
    rows: dist.buckets.map((b) => ({
      label: b.label,
      count: b.count || 0,
      pct: n ? Math.round(((b.count || 0) / n) * 100) : 0,
      tone: b.tone || null,
    })),
  };
}

/* ---------- filter state ---------------------------------------- */

export function emptyFilters() {
  return { cohortIds: null, from: null, to: null };
}

export function filtersToRpcArgs(filters) {
  return {
    cohortIds: filters?.cohortIds && filters.cohortIds.length ? filters.cohortIds : null,
    from: filters?.from || null,
    to: filters?.to || null,
  };
}

export function describeFilters(filters, cohortSummary) {
  const parts = [];
  if (filters?.cohortIds && filters.cohortIds.length) {
    const names = (cohortSummary?.rows || [])
      .filter((r) => filters.cohortIds.includes(r.id))
      .map((r) => r.name);
    parts.push(names.length <= 2 ? names.join(" + ") : `${names.length} cohorts`);
  } else {
    parts.push("All cohorts");
  }
  if (filters?.from || filters?.to) {
    parts.push(`${filters.from || "…"} → ${filters.to || "now"}`);
  } else {
    parts.push("All time");
  }
  return parts.join(" · ");
}
