/* ================================================================== *
 * EKI² — presentation layer
 * ------------------------------------------------------------------
 * Turns the analytical FINDINGS from insights.js into the language a
 * careers adviser actually uses:
 *
 *   DATA  →  INSIGHT (plain sentence)
 *         →  WHY it matters (one clause)
 *         →  ONE supporting figure (only where it helps a decision)
 *         →  SUGGESTED ACTION (deterministic, grounded)
 *         →  EVIDENCE (charts, one level deeper)
 *
 * HARD RULES (inherited from insights.js):
 *   * Every string is a deterministic restatement of the finding — no
 *     new numbers, no causal language, nothing the data doesn't support.
 *   * A suppressed / insufficient-data finding produces NO action and no
 *     figure — just its honest sentence.
 *
 * Pure. Depends only on taxonomy.js + insights.js. Unit-tested in
 * present.test.js — no DB, no React.
 * ================================================================== */

import { dimensionLabel, categoryLabel, roleFamilyLabel } from "./taxonomy.js";
import { rankFindings } from "./insights.js";

/* ---- careers-team language for the analytical severities ---------- */
export const SEVERITY_UX = {
  critical: { bucket: "attention", label: "Needs attention", tone: "bad" },
  watch: { bucket: "watch", label: "Keep an eye on", tone: "warn" },
  neutral: { bucket: "insight", label: "Key insight", tone: "info" },
  positive: { bucket: "working", label: "What’s working", tone: "good" },
};
export function severityUx(sev) {
  return SEVERITY_UX[sev] || SEVERITY_UX.neutral;
}

/* ---- plain-English phrasing for the six competency dimensions ----- *
 * verb  — "Students find it hardest to <verb>."
 * noun  — "…strongest at <noun>."
 * skill — "practice on <skill>"
 */
const DIMENSION_PLAIN = {
  relevance:   { verb: "answer the exact question they are asked", noun: "answering the question directly", skill: "answering the question directly" },
  specificity: { verb: "give concrete detail instead of generalities", noun: "giving concrete detail", skill: "adding concrete detail to answers" },
  structure:   { verb: "organise an answer into a clear, followable shape", noun: "structuring their answers", skill: "structuring answers (e.g. STAR)" },
  evidence:    { verb: "back answers with specific, real examples", noun: "using specific evidence", skill: "structuring evidence-based answers" },
  communication: { verb: "keep answers clear and concise", noun: "clear, concise delivery", skill: "concise, confident delivery" },
  competency_demonstration: { verb: "clearly show the skill each question is testing", noun: "demonstrating the target skill", skill: "demonstrating the skill each question targets" },
};
export function plainDimension(key, form = "noun") {
  const p = DIMENSION_PLAIN[key];
  return p ? p[form] : dimensionLabel(key).toLowerCase();
}

/* ---- 0-100 → one calm word ------------------------------------- */
export function bandWord(score, target = 70) {
  if (score == null || Number.isNaN(Number(score))) return null;
  const n = Number(score);
  if (n >= 78) return "Strong";
  if (n >= target) return "Solid";
  if (n >= target - 18) return "Developing";
  return "Priority";
}
export function bandTone(word) {
  return { Strong: "good", Solid: "good", Developing: "warn", Priority: "bad" }[word] || "neutral";
}

function pts(n) {
  const v = Math.round(Math.abs(Number(n)));
  return `${v} pt${v === 1 ? "" : "s"}`;
}
function signedPts(n) {
  const v = Math.round(Number(n) * 10) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)} pts`;
}

/* ================================================================= *
 * humanize(finding) → { lead, why, figure, tone }
 * ================================================================= */
export function humanize(finding) {
  if (!finding) return { lead: "", why: "", figure: null, tone: "neutral" };
  const e = finding.evidence || {};
  const tone = severityUx(finding.severity).tone;
  const fallback = { lead: finding.headline, why: finding.detail || "", figure: null, tone };

  switch (finding.section) {
    /* ---------- performance ---------- */
    case "performance": {
      if (finding.headline.includes("interview-ready or better")) {
        const pct = e.pct_at_or_above_target ?? 0;
        const below = e.target != null && e.mean != null && e.mean < e.target;
        return {
          lead: pct >= 50 ? "Most students are reaching interview-ready standard."
              : pct >= 25 ? "Students are making progress towards interview readiness."
              : "Most students are not yet interview-ready.",
          why: below ? `The cohort averages ${e.mean}, ${pts(e.target - e.mean)} below the interview-ready threshold.`
                     : "The cohort is at or above the interview-ready threshold on average.",
          figure: `${pct}% interview-ready`,
          tone,
        };
      }
      if (finding.headline.includes("priority band")) {
        return { lead: "A group of students needs urgent support.",
          why: `${e.pct}% of students score well below the readiness threshold.`,
          figure: `${e.pct}% in the priority group`, tone };
      }
      if (finding.headline.includes("final round")) {
        return { lead: e.gap < 0 ? "Students lose ground between first and final round." : "Students hold up well into the final round.",
          why: `First-round average ${e.first_round}, final-round average ${e.final_round}.`,
          figure: `${signedPts(e.gap)} at final round`, tone };
      }
      return fallback;
    }

    /* ---------- competencies ---------- */
    case "competencies": {
      if (finding.headline.includes("strongest competency")) {
        return { lead: `Students are strongest at ${plainDimension(e.key, "noun")}.`,
          why: e.competency_average != null ? `Ahead of the cohort's own competency average.` : "",
          figure: e.competency_average != null ? `${pts(e.mean - e.competency_average)} above average` : `mean ${e.mean}`,
          tone };
      }
      if (finding.headline.includes("weakest competency")) {
        return { lead: `Students find it hardest to ${plainDimension(e.key, "verb")}.`,
          why: e.mean < (e.target ?? 70) ? "This is the cohort's largest single development gap." : "",
          figure: e.mean < (e.target ?? 70) ? `${pts((e.target ?? 70) - e.mean)} below interview-ready` : `mean ${e.mean}`,
          tone };
      }
      if (finding.headline.includes("materially below")) {
        const names = (e.keys || []).map((k, i) => (i === 0 ? dimensionLabel(k) : dimensionLabel(k).toLowerCase()));
        return { lead: `${names.join(" and ")} sit noticeably behind the cohort's other competencies.`,
          why: "Worth a targeted push alongside the main development area.",
          figure: `${e.material_gap_points ?? 4}+ pts below the competency average`, tone };
      }
      if (finding.headline.includes("uneven")) {
        return { lead: "Competency strength is uneven across the cohort.",
          why: `A wide gap between the strongest and weakest area.`,
          figure: `${pts(e.spread)} spread`, tone };
      }
      return fallback;
    }

    /* ---------- development ---------- */
    case "development": {
      const isCat = e.kind === "question_category";
      if (finding.headline.includes("biggest development opportunity")) {
        return {
          lead: isCat
            ? `${categoryLabel(e.key)} questions are where students struggle most.`
            : `Students are consistently weaker when they need to ${plainDimension(e.key, "verb")}.`,
          why: "This is the largest cohort development opportunity.",
          figure: `${pts(e.gap_vs_target)} below interview-ready · ${e.pct_below_target}% of students affected`,
          tone,
        };
      }
      return {
        lead: isCat ? `${categoryLabel(e.key)} questions are a development gap for most students.`
                    : `${dimensionLabel(e.key)} is a development gap for most students.`,
        why: "",
        figure: `${e.pct_below_target}% below interview-ready`,
        tone,
      };
    }

    /* ---------- career ---------- */
    case "career": {
      if (finding.headline.includes("weakest career path")) {
        return { lead: `Students targeting ${roleFamilyLabel(e.key)} are the least prepared.`,
          why: e.cross_family_mean != null ? `Behind the average across career paths.` : "",
          figure: e.cross_family_mean != null ? `${pts(e.cross_family_mean - e.mean)} below the cross-path average` : `mean ${e.mean}`,
          tone };
      }
      if (finding.headline.includes("varies by career path")) {
        return { lead: "How ready students are depends a lot on their target career path.",
          why: "", figure: `${pts(e.spread)} between the strongest and weakest path`, tone };
      }
      return fallback; // "only one path…" / "no path has enough students…" — honest, no figure
    }

    /* ---------- improvement ---------- */
    case "improvement": {
      if (finding.headline.includes("improve with repeated")) {
        return { lead: "Students who practise more get measurably better.",
          why: "Average change from a student's first interview to their latest.",
          figure: `${signedPts(e.mean_delta)} · ${e.pct_improving}% improve`, tone };
      }
      if (finding.headline.includes("not translating")) {
        return { lead: "Extra practice isn't lifting scores yet.",
          why: "", figure: `${signedPts(e.mean_delta)} on average`, tone };
      }
      if (finding.headline.includes("strongest in")) {
        return { lead: `Improvement is strongest in ${plainDimension(e.key, "noun")}.`,
          why: "", figure: `${signedPts(e.mean_delta)} with practice`, tone };
      }
      if (finding.headline.includes("is not improving with practice")) {
        return { lead: `${dimensionLabel(e.key)} isn't shifting with repeated practice.`,
          why: "", figure: `${signedPts(e.mean_delta)}`, tone };
      }
      return fallback; // not enough repeat practice — honest
    }

    /* ---------- questions ---------- */
    case "questions": {
      if (finding.headline.includes("most difficulty")) {
        return { lead: `${categoryLabel(e.key)} questions are the hardest for the cohort.`,
          why: e.gap_vs_target > 0 ? "Below interview-ready standard on this question type." : "",
          figure: e.gap_vs_target > 0 ? `${pts(e.gap_vs_target)} below interview-ready` : `mean ${e.mean}`, tone };
      }
      return fallback;
    }

    default:
      return fallback;
  }
}

/* ================================================================= *
 * suggestedAction(finding) → { text, cta:{label,target} } | null
 * ----------------------------------------------------------------- *
 * Deterministic. Only where an insight naturally leads to a careers
 * intervention. Never for suppressed / insufficient-data / neutral-
 * informational findings, and never for a "what's working" positive
 * unless it's a genuine "keep doing X".
 * ================================================================= */
const APPT_CTA = { label: "Review appointments", target: "appointments" };

export function suggestedAction(finding) {
  if (!finding) return null;
  const e = finding.evidence || {};
  const sev = finding.severity;

  switch (finding.section) {
    case "development": {
      if (sev === "critical") {
        const text = e.kind === "question_category"
          ? `Point students at more ${categoryLabel(e.key)} practice questions on JOB.READY, and use appointments to rehearse them.`
          : `Run targeted practice on ${plainDimension(e.key, "skill")}, or direct students to more interview practice on JOB.READY.`;
        return { text, cta: APPT_CTA };
      }
      if (sev === "watch") {
        const label = e.kind === "question_category" ? `${categoryLabel(e.key)} questions` : dimensionLabel(e.key);
        return { text: `Keep an eye on ${label}; consider a group session if it persists.`, cta: APPT_CTA };
      }
      return null;
    }
    case "competencies": {
      if (sev === "critical" || (sev === "watch" && finding.headline.includes("weakest"))) {
        return { text: `Focus preparation support on ${plainDimension(e.key, "skill")}.`, cta: APPT_CTA };
      }
      if (sev === "watch" && finding.headline.includes("materially below")) {
        return { text: `Add a light touch on ${(e.keys || []).map(dimensionLabel).join(" and ")} alongside the main development area.`, cta: APPT_CTA };
      }
      return null;
    }
    case "performance": {
      if (finding.headline.includes("interview-ready or better") && sev === "watch") {
        return { text: "Prioritise interview-preparation appointments for the students furthest from the threshold.", cta: APPT_CTA };
      }
      if (finding.headline.includes("priority band")) {
        return { text: "Reach out to the priority group directly and offer preparation appointments.", cta: APPT_CTA };
      }
      if (finding.headline.includes("final round") && e.gap < 0) {
        return { text: "Use appointments to rehearse final-round and partner-level questions.", cta: APPT_CTA };
      }
      return null;
    }
    case "career": {
      if (sev === "watch" && finding.headline.includes("weakest career path")) {
        return { text: `Target preparation support at the ${roleFamilyLabel(e.key)} route — for example route-specific mock interviews.`, cta: APPT_CTA };
      }
      return null;
    }
    case "improvement": {
      if (sev === "positive" && finding.headline.includes("improve with repeated")) {
        return { text: "Keep encouraging repeated practice — it is measurably working.", cta: null };
      }
      if (sev === "watch" && finding.headline.includes("not translating")) {
        return { text: "Check how students are practising; repetition alone isn't lifting scores.", cta: APPT_CTA };
      }
      return null;
    }
    case "questions": {
      if (sev === "watch") {
        return { text: `Direct students to more ${categoryLabel(e.key)} practice on JOB.READY.`, cta: APPT_CTA };
      }
      return null;
    }
    default:
      return null;
  }
}

/* ================================================================= *
 * overviewCards(sections) → up to 4 cards, one per bucket
 * ----------------------------------------------------------------- *
 * sections is the api.getAllAnalytics map. Uses the SAME per-section
 * derivers as everywhere else. Each card is deliberately minimal:
 *   { bucket, label, tone, insight, figure, actionText, target, findingId }
 * `target` is the page to open for "View details →".
 * ================================================================= */
const SECTION_PAGE = {
  performance: "performance", competencies: "competencies", career: "career",
  development: "development", questions: "development", improvement: "improvement",
};

export function overviewCards(sections, derivers) {
  const d = derivers || {};
  const all = [];
  const push = (list, sectionKey) => {
    for (const f of list || []) all.push({ ...f, _page: SECTION_PAGE[sectionKey] || sectionKey });
  };
  push(d.derivePerformanceFindings?.(sections?.performance), "performance");
  push(d.deriveCompetencyFindings?.(sections?.competencies), "competencies");
  push(d.deriveCareerFindings?.(sections?.career), "career");
  push(d.deriveDevelopmentFindings?.(sections?.developmentAreas, sections?.improvement), "development");
  push(d.deriveQuestionFindings?.(sections?.questions), "questions");
  push(d.deriveImprovementFindings?.(sections?.improvement), "improvement");

  // drop pure "not enough data" placeholders — the page shows its own honest state
  const real = all.filter((f) => !/not enough (data|repeat)/i.test(f.headline)
    && !/no career path has enough/i.test(f.headline)
    && !/only the .* path has enough/i.test(f.headline));

  const pick = (sev, prefer) => {
    const pool = rankFindings(real.filter((f) => f.severity === sev));
    if (!pool.length) return null;
    if (prefer) {
      const p = pool.find((f) => prefer(f));
      if (p) return p;
    }
    return pool[0];
  };

  const chosen = [
    pick("critical", (f) => f.section === "development"),
    pick("watch"),
    pick("neutral"),
    pick("positive", (f) => f.section === "improvement"),
  ].filter(Boolean);

  // de-dupe by headline (a dev-critical can also surface as a competency-critical)
  const seen = new Set();
  return chosen.filter((f) => (seen.has(f.headline) ? false : (seen.add(f.headline), true)))
    .map((f) => {
      const ux = severityUx(f.severity);
      const h = humanize(f);
      const act = suggestedAction(f);
      return {
        bucket: ux.bucket, label: ux.label, tone: ux.tone,
        insight: h.lead, figure: h.figure,
        actionText: act ? act.text : null,
        target: f._page,
        findingId: f.id,
      };
    });
}

/* ================================================================= *
 * verdictFor(kind, env, findings) → { word, tone, sentence, figure }
 * The big calm interpretation line at the top of Performance /
 * Competencies. Returns null when the section is suppressed/empty.
 * ================================================================= */
export function verdictFor(kind, env, findings) {
  const ranked = rankFindings(findings || []);
  const top = ranked.find((f) => !/not enough|no career path|only the/i.test(f.headline)) || null;

  if (kind === "performance") {
    const o = env?.overall;
    if (!o || o.suppressed || o.mean == null) return null;
    const target = env.readiness_target ?? 70;
    const word = bandWord(o.mean, target);
    const h = top ? humanize(top) : null;
    return {
      word, tone: bandTone(word),
      sentence: h?.lead || "Interview readiness across the cohort.",
      figure: o.mean < target ? `Cohort average ${o.mean} — ${pts(target - o.mean)} below interview-ready`
                              : `Cohort average ${o.mean} — at interview-ready standard`,
    };
  }

  if (kind === "competencies") {
    const avg = env?.competency_average;
    if (avg == null) return null;
    const target = env.readiness_target ?? 70;
    const word = bandWord(avg, target);
    const dims = (env.dimensions || []).filter((x) => !x.suppressed && x.mean != null).sort((a, b) => b.mean - a.mean);
    const strong = dims[0], weak = dims[dims.length - 1];
    return {
      word, tone: bandTone(word),
      sentence: strong && weak
        ? `Students are strongest at ${plainDimension(strong.key, "noun")} and need most support with ${plainDimension(weak.key, "verb")}.`
        : "Competency strength across the six dimensions.",
      figure: `Competency average ${avg}`,
    };
  }

  return null;
}

/* ---- a compact "one word + one line" for any section header ----- */
export function sectionVerdictLine(findings) {
  const ranked = rankFindings(findings || []);
  const top = ranked[0];
  if (!top) return null;
  const h = humanize(top);
  return { lead: h.lead, figure: h.figure, tone: h.tone };
}
