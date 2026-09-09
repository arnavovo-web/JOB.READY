/* ================================================================== *
 * EKI² — programme-level intelligence (pure synthesis)
 * ------------------------------------------------------------------
 * Turns the deterministic payloads (eki_programme_pulse +
 * eki_student_intelligence summary/movement + follow-up count) into the
 * institutional "so what?" list: programme opportunities, common
 * development gaps, engagement gaps, intervention opportunities,
 * follow-up pressure, positive movement.
 *
 * Every figure comes straight from a payload — nothing invented, no
 * employment-outcome claims. Suppressed programmes are skipped.
 * Pure. Tested in programmes.test.js.
 * ================================================================== */
import { dimensionLabel } from "./taxonomy.js";

const CTA_PERFORMANCE = { label: "Review students", target: "performance" };
const CTA_DEV = { label: "See development areas", target: "development" };
const CTA_APPTS = { label: "Review follow-ups", target: "appointments" };

/** Reportable programmes only, sorted worst-readiness first. */
export function reportableProgrammes(pulse) {
  return (pulse || [])
    .filter((p) => p && !p.suppressed && p.assessed != null)
    .sort((a, b) => (a.mean_readiness ?? 0) - (b.mean_readiness ?? 0));
}

/**
 * The institutional attention list.
 * `env` = { pulse, summary, movement, followUpCount }
 * Returns [{ kind, headline, detail, cta }] — deterministic, ranked.
 */
export function programmeIntelligence(env) {
  const pulse = reportableProgrammes(env?.pulse);
  const summary = env?.summary || {};
  const movement = env?.movement || {};
  const out = [];

  // 1. the single most concentrated programme development gap
  const withGap = pulse
    .filter((p) => p.weakest_competency && p.weakest_competency_below_target_pct != null)
    .sort((a, b) => (b.weakest_competency_below_target_pct ?? 0) - (a.weakest_competency_below_target_pct ?? 0));
  if (withGap.length) {
    const p = withGap[0];
    out.push({
      kind: "programme_opportunity",
      headline: `${p.name}: ${p.weakest_competency_below_target_pct}% of students are below target for ${dimensionLabel(p.weakest_competency)}`,
      detail: `This is the most concentrated development gap across the programmes reporting. A group workshop on ${dimensionLabel(p.weakest_competency).toLowerCase()} could reach several students at once.`,
      cta: CTA_DEV,
    });
  }

  // 2. a competency that is the weakest area in multiple programmes
  const weakCounts = {};
  for (const p of pulse) if (p.weakest_competency) weakCounts[p.weakest_competency] = (weakCounts[p.weakest_competency] || 0) + 1;
  const common = Object.entries(weakCounts).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0];
  if (common) {
    out.push({
      kind: "competency_trend",
      headline: `${dimensionLabel(common[0])} is the most common development area across ${common[1]} programmes`,
      detail: "A shared resource or a cross-programme session could address it efficiently.",
      cta: CTA_DEV,
    });
  }

  // 3. engagement gap — strong readiness, low careers engagement
  const engGap = pulse
    .filter((p) => (p.pct_ready ?? 0) >= 50 && (p.careers_engagement_pct ?? 0) < 25)
    .sort((a, b) => (a.careers_engagement_pct ?? 0) - (b.careers_engagement_pct ?? 0))[0];
  if (engGap) {
    out.push({
      kind: "engagement_gap",
      headline: `${engGap.name} has strong interview readiness but low careers engagement (${engGap.careers_engagement_pct}%)`,
      detail: "These students are doing well in practice but rarely booking careers support — worth a light-touch outreach.",
      cta: CTA_PERFORMANCE,
    });
  }

  // 4. intervention opportunity — students practising without improvement
  if ((summary.stuck ?? 0) > 0) {
    out.push({
      kind: "intervention_opportunity",
      headline: `${summary.stuck} student${summary.stuck === 1 ? " is" : "s are"} practising repeatedly without meaningful improvement`,
      detail: "Targeted one-to-one support tends to help most here.",
      cta: CTA_PERFORMANCE,
    });
  } else if ((summary.no_contact ?? 0) > 0) {
    out.push({
      kind: "intervention_opportunity",
      headline: `${summary.no_contact} student${summary.no_contact === 1 ? "" : "s"} below target ${summary.no_contact === 1 ? "has" : "have"} had no recorded careers contact`,
      detail: "A first appointment or a message could open the conversation.",
      cta: CTA_PERFORMANCE,
    });
  }

  // 5. follow-up pressure
  if ((env?.followUpCount ?? 0) > 0) {
    out.push({
      kind: "follow_up_pressure",
      headline: `${env.followUpCount} student follow-up${env.followUpCount === 1 ? " is" : "s are"} currently due`,
      detail: "Clearing these keeps interventions from stalling.",
      cta: CTA_APPTS,
    });
  }

  // 6. positive movement
  const moved = (movement.developing_to_ready ?? 0) + (movement.needs_support_to_developing ?? 0);
  if (moved > 0) {
    const toReady = movement.developing_to_ready ?? 0;
    out.push({
      kind: "positive_movement",
      headline: toReady > 0
        ? `${toReady} student${toReady === 1 ? "" : "s"} moved into Interview-ready this period`
        : `${moved} student${moved === 1 ? "" : "s"} moved up a readiness group this period`,
      detail: "Practice is translating into readiness for this group.",
      cta: null,
    });
  }

  return out;
}

/** One headline line for the Overview "key institutional insight" slot. */
export function topInstitutionalInsight(env) {
  const list = programmeIntelligence(env);
  const priority = ["programme_opportunity", "intervention_opportunity", "competency_trend", "engagement_gap", "follow_up_pressure", "positive_movement"];
  for (const k of priority) {
    const hit = list.find((x) => x.kind === k);
    if (hit) return hit;
  }
  return list[0] || null;
}
