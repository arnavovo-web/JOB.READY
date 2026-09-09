/* ================================================================== *
 * INSTITUTIONAL INSIGHTS — insight derivation
 * ------------------------------------------------------------------
 * Turns the raw k-anonymised aggregates from the inst_* RPCs into
 * ranked, plain-English FINDINGS the dashboard can show as sentences
 * ("Evidence is the cohort's biggest development opportunity").
 *
 * HARD RULE: every finding is a deterministic restatement of numbers
 * already in the envelope. No causal language, no claim the data does
 * not directly support, no invented figure. If a section is suppressed
 * or empty, the derivation returns a single neutral "not enough data"
 * finding (or []), never a guess.
 *
 * Pure + dependency-light (only taxonomy.js labels). Fully unit-tested
 * in insights.test.js without a database.
 * ================================================================== */

import {
  MIN_COHORT_N, dimensionLabel, categoryLabel, roleFamilyLabel, readinessMeta,
} from "./taxonomy.js";

/* severity ranking for sorting a mixed list, worst first */
const SEV_RANK = { critical: 0, watch: 1, neutral: 2, positive: 3 };
export const SEVERITIES = Object.keys(SEV_RANK);

function finding(section, severity, headline, detail, evidence) {
  return { id: `${section}:${headline}`.slice(0, 120), section, severity, headline, detail: detail || "", evidence: evidence || {} };
}

/** Sign-aware "N points" phrase. */
function pts(n) {
  const v = Math.round(Math.abs(Number(n)));
  return `${v} point${v === 1 ? "" : "s"}`;
}
function signed(n) {
  const v = Number(n);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 10) / 10)}`;
}

/** True when an envelope came back usable (not the api.js "pending" stub). */
export function isLive(env) {
  return !!env && env.supported === true && Number(env.min_n) === MIN_COHORT_N;
}

/** Contract check surfaced as a limitation string, or null. */
export function contractIssue(env) {
  if (!env) return "No response from the analytics engine.";
  if (env.supported !== true) return "The analytics engine is not deployed yet.";
  if (Number(env.min_n) !== MIN_COHORT_N) {
    return `Reporting threshold mismatch (engine ${env.min_n}, app ${MIN_COHORT_N}).`;
  }
  return null;
}

function scopeNote(env) {
  const s = env?.scope || {};
  return {
    students_in_scope: s.students_in_scope ?? null,
    students_with_data: s.students_with_data ?? null,
  };
}

function notEnough(section, env, whatFor) {
  const s = scopeNote(env);
  return [finding(
    section, "neutral",
    `Not enough data to report ${whatFor}`,
    `Cohort figures need at least ${MIN_COHORT_N} students with interview data in the selected scope`
      + (s.students_with_data != null ? ` (currently ${s.students_with_data}).` : "."),
    { min_n: MIN_COHORT_N, ...s }
  )];
}

/* ================================================================= *
 * COMPETENCIES
 * ================================================================= */
export function deriveCompetencyFindings(env) {
  if (!isLive(env)) return [];
  const dims = (env.dimensions || []).filter((d) => !d.suppressed && d.mean != null);
  if (dims.length < 2) return notEnough("competencies", env, "competency performance");

  const sorted = [...dims].sort((a, b) => b.mean - a.mean);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  const target = env.readiness_target ?? 70;
  const compAvg = env.competency_average;
  const out = [];

  out.push(finding(
    "competencies", "positive",
    `${dimensionLabel(strongest.key)} is the cohort's strongest competency`,
    `Cohort mean ${strongest.mean}${compAvg != null ? `, ${pts(strongest.mean - compAvg)} above the competency average (${compAvg})` : ""}.`,
    { key: strongest.key, mean: strongest.mean, competency_average: compAvg }
  ));

  const belowTarget = weakest.mean < target;
  out.push(finding(
    "competencies", belowTarget ? "critical" : "watch",
    `${dimensionLabel(weakest.key)} is the cohort's weakest competency`,
    `Cohort mean ${weakest.mean}`
      + (belowTarget ? `, ${pts(target - weakest.mean)} below the interview-ready threshold (${target})` : "")
      + `. ${weakest.pct_at_or_above_target ?? 0}% of students reach the threshold here.`,
    { key: weakest.key, mean: weakest.mean, target, pct_at_or_above_target: weakest.pct_at_or_above_target }
  ));

  const material = dims.filter((d) => d.materially_below);
  if (material.length) {
    const names = material.map((d, i) => (i === 0 ? dimensionLabel(d.key) : dimensionLabel(d.key).toLowerCase()));
    out.push(finding(
      "competencies", "watch",
      `${names.length === 1 ? `${names[0]} is` : `${names.slice(0, -1).join(", ")} and ${names.slice(-1)} are`} materially below the cohort's competency average`,
      `At least ${env.material_gap_points ?? 4} points below the ${compAvg}-point average across the six dimensions.`,
      { keys: material.map((d) => d.key), competency_average: compAvg, material_gap_points: env.material_gap_points }
    ));
  }

  const spread = strongest.mean - weakest.mean;
  if (spread >= 15) {
    out.push(finding(
      "competencies", "neutral",
      `Competency performance is uneven`,
      `A ${pts(spread)} spread between ${dimensionLabel(strongest.key)} (${strongest.mean}) and ${dimensionLabel(weakest.key)} (${weakest.mean}).`,
      { spread, strongest: strongest.key, weakest: weakest.key }
    ));
  }
  return out;
}

/* ================================================================= *
 * DEVELOPMENT AREAS  (the synthesis)
 * ================================================================= */
export function deriveDevelopmentFindings(env, improvementEnv) {
  if (!isLive(env)) return [];
  const opps = env.opportunities || [];
  if (!opps.length) return notEnough("development", env, "development opportunities");

  const improveByKey = improvementDeltaIndex(improvementEnv);
  const label = (o) => (o.kind === "question_category" ? `${categoryLabel(o.key)} questions` : dimensionLabel(o.key));
  const out = [];

  const top = opps[0];
  out.push(finding(
    "development", "critical",
    `${label(top)} is the cohort's biggest development opportunity`,
    `Cohort mean ${top.cohort_mean} — ${top.pct_below_target}% of reportable students score below interview-ready, `
      + `an average gap of ${pts(top.gap_vs_target)}`
      + improvingClause(top, improveByKey) + ".",
    { ...top, improvement_delta: improveByKey[top.key] ?? null }
  ));

  for (const o of opps.slice(1, 4)) {
    out.push(finding(
      "development", "watch",
      `${label(o)}: ${o.pct_below_target}% of students below interview-ready`,
      `Cohort mean ${o.cohort_mean}, a ${pts(o.gap_vs_target)} gap${improvingClause(o, improveByKey)}.`,
      { ...o, improvement_delta: improveByKey[o.key] ?? null }
    ));
  }
  return out;
}

function improvementDeltaIndex(improvementEnv) {
  const idx = {};
  if (!isLive(improvementEnv)) return idx;
  for (const d of improvementEnv.by_dimension || []) {
    if (!d.suppressed && d.mean_delta != null) idx[d.key] = d.mean_delta;
  }
  return idx;
}
function improvingClause(opp, improveByKey) {
  if (opp.kind !== "competency") return "";
  const delta = improveByKey[opp.key];
  if (delta == null) return "";
  const eps = 3;
  if (delta >= eps) return `, and it is improving with repeated practice (${signed(delta)} on average)`;
  if (delta <= -eps) return `, and it is not improving with repeated practice (${signed(delta)} on average)`;
  return `, and it is broadly flat with repeated practice`;
}

/* ================================================================= *
 * IMPROVEMENT
 * ================================================================= */
export function deriveImprovementFindings(env) {
  if (!isLive(env)) return [];
  const o = env.overall || {};
  const s = env.scope || {};
  const eps = env.improve_epsilon ?? 3;
  const out = [];

  if (o.suppressed || o.mean_delta == null) {
    out.push(finding(
      "improvement", "neutral",
      `Not enough repeated practice to measure improvement`,
      `Improvement is measured per student across their own interviews. `
        + `${s.students_with_repeat_practice ?? 0} student(s) have completed more than one interview in scope; `
        + `${MIN_COHORT_N} are needed.`,
      { min_n: MIN_COHORT_N, students_with_repeat_practice: s.students_with_repeat_practice ?? 0 }
    ));
    return out;
  }

  const sev = o.mean_delta >= eps ? "positive" : o.mean_delta <= -eps ? "watch" : "neutral";
  out.push(finding(
    "improvement", sev,
    o.mean_delta >= eps
      ? `Students improve with repeated interview practice`
      : o.mean_delta <= -eps
        ? `Repeated practice is not translating into higher scores`
        : `Repeated practice shows little score movement`,
    `Across ${o.n_students} students with more than one interview, the average change from first to latest is ${signed(o.mean_delta)} points `
      + `(median ${signed(o.median_delta)}). ${o.pct_improving}% improved by ${eps}+ points; ${o.pct_declining}% declined.`,
    { ...o, improve_epsilon: eps }
  ));

  const dims = (env.by_dimension || []).filter((d) => !d.suppressed && d.mean_delta != null);
  if (dims.length) {
    const best = [...dims].sort((a, b) => b.mean_delta - a.mean_delta)[0];
    if (best.mean_delta >= eps) {
      out.push(finding(
        "improvement", "positive",
        `Improvement is strongest in ${dimensionLabel(best.key)}`,
        `${signed(best.mean_delta)} points on average across repeated practice; ${best.pct_improving}% of students improved here.`,
        { key: best.key, mean_delta: best.mean_delta, pct_improving: best.pct_improving }
      ));
    }
    const worst = [...dims].sort((a, b) => a.mean_delta - b.mean_delta)[0];
    if (worst.mean_delta <= -eps) {
      out.push(finding(
        "improvement", "watch",
        `${dimensionLabel(worst.key)} is not improving with practice`,
        `${signed(worst.mean_delta)} points on average across repeated practice.`,
        { key: worst.key, mean_delta: worst.mean_delta }
      ));
    }
  }
  return out;
}

/* ================================================================= *
 * PERFORMANCE
 * ================================================================= */
export function derivePerformanceFindings(env) {
  if (!isLive(env)) return [];
  const o = env.overall || {};
  if (o.suppressed || o.mean == null) return notEnough("performance", env, "interview performance");
  const target = env.readiness_target ?? 70;
  const out = [];

  const pct = o.pct_at_or_above_target ?? 0;
  out.push(finding(
    "performance", pct >= 50 ? "positive" : pct >= 25 ? "neutral" : "watch",
    `${pct}% of students score at interview-ready or better`,
    `Cohort mean ${o.mean}, median ${o.median} across ${o.n_students} students and ${o.n_interviews} completed interviews `
      + `(middle half ${o.p25}–${o.p75}).`,
    { ...o, target }
  ));

  const dist = env.distribution;
  if (dist && !dist.suppressed) {
    const priority = (dist.buckets || []).find((b) => b.label === "priority");
    if (priority && dist.n) {
      const p = Math.round((priority.count / dist.n) * 100);
      if (p >= 15) {
        out.push(finding(
          "performance", p >= 33 ? "watch" : "neutral",
          `${p}% of students are in the priority band`,
          `${priority.count} of ${dist.n} students score below 45 on average — the group most in need of support.`,
          { priority_count: priority.count, n: dist.n, pct: p }
        ));
      }
    }
  }

  const stages = (env.by_stage || []).filter((s) => !s.suppressed && s.mean != null);
  const first = stages.find((s) => s.key === "first_round");
  const final = stages.find((s) => s.key === "final_round");
  if (first && final) {
    const gap = final.mean - first.mean;
    if (Math.abs(gap) >= 8) {
      out.push(finding(
        "performance", gap < 0 ? "watch" : "neutral",
        gap < 0
          ? `Performance drops at the final round`
          : `Performance holds up into the final round`,
        `Final-round mean ${final.mean} vs first-round mean ${first.mean} (${signed(gap)}).`,
        { first_round: first.mean, final_round: final.mean, gap }
      ));
    }
  }
  return out;
}

/* ================================================================= *
 * CAREER INSIGHTS
 * ================================================================= */
export function deriveCareerFindings(env) {
  if (!isLive(env)) return [];
  const fams = (env.families || []).filter((f) => !f.suppressed && f.mean != null);
  const s = env.scope || {};

  if (!fams.length) {
    return [finding(
      "career", "neutral",
      `No career path has enough students to report on yet`,
      `${env.families_total ?? 0} career path(s) appear in the data; none yet has ${MIN_COHORT_N} students with interview activity.`,
      { families_total: env.families_total ?? 0, min_n: MIN_COHORT_N }
    )];
  }
  const out = [];
  const sorted = [...fams].sort((a, b) => a.mean - b.mean);
  const lowest = sorted[0];
  const highest = sorted[sorted.length - 1];
  const crossMean = env.cross_family_mean;

  if (fams.length === 1) {
    out.push(finding(
      "career", "neutral",
      `Only the ${roleFamilyLabel(lowest.key)} path has enough students to report on`,
      `${lowest.n_students} students, ${lowest.n_interviews} interviews, cohort mean ${lowest.mean}`
        + (lowest.gap_vs_target > 0 ? ` (${pts(lowest.gap_vs_target)} below interview-ready).` : "."),
      { key: lowest.key, ...lowest }
    ));
    return out;
  }

  if (crossMean != null && lowest.mean < crossMean) {
    out.push(finding(
      "career", lowest.gap_vs_target > 0 ? "watch" : "neutral",
      `${roleFamilyLabel(lowest.key)} is the cohort's weakest career path`,
      `Cohort mean ${lowest.mean}, ${pts(crossMean - lowest.mean)} below the ${crossMean}-point average across reportable paths`
        + (lowest.gap_vs_target > 0 ? ` and ${pts(lowest.gap_vs_target)} below interview-ready.` : "."),
      { key: lowest.key, mean: lowest.mean, cross_family_mean: crossMean, gap_vs_target: lowest.gap_vs_target }
    ));
  }
  const spread = highest.mean - lowest.mean;
  if (spread >= 8) {
    out.push(finding(
      "career", "neutral",
      `Preparedness varies by career path`,
      `Students targeting ${roleFamilyLabel(highest.key)} average ${highest.mean}; those targeting ${roleFamilyLabel(lowest.key)} average ${lowest.mean} (${pts(spread)} apart).`,
      { highest: highest.key, lowest: lowest.key, spread }
    ));
  }
  return out;
}

/* ================================================================= *
 * QUESTION / CATEGORY PERFORMANCE
 * ================================================================= */
export function deriveQuestionFindings(env) {
  if (!isLive(env)) return [];
  const cats = (env.categories || []).filter((c) => !c.suppressed && c.mean != null);
  if (!cats.length) return notEnough("questions", env, "question-category performance");

  const sorted = [...cats].sort((a, b) => a.mean - b.mean);
  const hardest = sorted[0];
  const easiest = sorted[sorted.length - 1];
  const out = [];

  out.push(finding(
    "questions", hardest.gap_vs_target > 0 ? "watch" : "neutral",
    `${categoryLabel(hardest.key)} questions cause the cohort the most difficulty`,
    `Cohort mean ${hardest.mean} across ${hardest.n_answers} answers`
      + (hardest.gap_vs_target > 0 ? `, ${pts(hardest.gap_vs_target)} below interview-ready.` : ".")
      + (env.cross_category_mean != null ? ` Category average is ${env.cross_category_mean}.` : ""),
    { key: hardest.key, mean: hardest.mean, gap_vs_target: hardest.gap_vs_target, cross_category_mean: env.cross_category_mean }
  ));

  const spread = easiest.mean - hardest.mean;
  if (spread >= 10) {
    out.push(finding(
      "questions", "neutral",
      `${categoryLabel(easiest.key)} questions are the cohort's strongest`,
      `Cohort mean ${easiest.mean}, ${pts(spread)} above ${categoryLabel(hardest.key)}.`,
      { easiest: easiest.key, hardest: hardest.key, spread }
    ));
  }
  return out;
}

/* ================================================================= *
 * OVERVIEW — curated executive summary across sections
 * ================================================================= */
export function deriveOverviewFindings(sections) {
  const { overview, competencies, improvement, developmentAreas, performance } = sections || {};
  const out = [];

  // 1. Readiness headline
  if (isLive(overview)) {
    const perf = overview.performance;
    if (perf && !perf.suppressed) {
      const pct = perf.pct_at_or_above_target ?? 0;
      out.push(finding(
        "overview", pct >= 50 ? "positive" : pct >= 25 ? "neutral" : "watch",
        `${pct}% of students are interview-ready`,
        `Cohort mean ${perf.mean_overall}, median ${perf.median_overall} across ${perf.n_students} students with interview data `
          + `(${overview.activity?.coverage_pct ?? "—"}% of the cohort has practised).`,
        { pct_at_or_above_target: pct, mean: perf.mean_overall, coverage_pct: overview.activity?.coverage_pct }
      ));
    } else {
      out.push(...notEnough("overview", overview, "cohort interview readiness"));
    }
  }

  // 2. Biggest development opportunity (from the synthesis)
  const devFindings = deriveDevelopmentFindings(developmentAreas, improvement);
  const topDev = devFindings.find((f) => f.severity === "critical");
  if (topDev) out.push({ ...topDev, section: "overview" });

  // 3. Improvement headline
  const impFindings = deriveImprovementFindings(improvement);
  if (impFindings[0]) out.push({ ...impFindings[0], section: "overview" });

  // 4. Strongest competency (a positive to balance)
  if (isLive(competencies)) {
    const compFindings = deriveCompetencyFindings(competencies);
    const strong = compFindings.find((f) => f.severity === "positive");
    if (strong) out.push({ ...strong, section: "overview" });
  }

  return dedupe(out);
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((f) => {
    const k = f.headline;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ================================================================= *
 * Generic helpers for the UI
 * ================================================================= */

/** Sort a findings list worst-first for display. */
export function rankFindings(list) {
  return [...(list || [])].sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));
}

/** One-line summary of a section for compact cards. */
export function sectionHeadline(section, findings) {
  const ranked = rankFindings(findings);
  return ranked.length ? ranked[0].headline : null;
}

export const DERIVERS = {
  overview: deriveOverviewFindings,
  performance: derivePerformanceFindings,
  competencies: deriveCompetencyFindings,
  career: deriveCareerFindings,
  questions: deriveQuestionFindings,
  improvement: deriveImprovementFindings,
  development: deriveDevelopmentFindings,
};
