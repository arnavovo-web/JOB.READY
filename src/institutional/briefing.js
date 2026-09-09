/* ================================================================== *
 * EKI² — AI Careers Adviser Briefing (deterministic core + AI payload)
 * ------------------------------------------------------------------
 * The deterministic system gathers the facts; the AI layer only
 * SYNTHESISES them into fluent prose. This module is the deterministic
 * half — it works with NO AI and is what the "Brief me" button shows
 * instantly. `briefingFacts()` also produces the compact structured
 * payload the Edge Function sends to the model (never raw student data,
 * never a transcript).
 *
 * HARD RULES (also enforced in the Edge Function prompt):
 *   - only stated facts; never infer unsupported personal information
 *   - no diagnosis, no causal claims, no employment-outcome prediction
 *   - distinguish evidence ("has") from suggestion ("could")
 * Pure. Tested in briefing.test.js.
 * ================================================================== */
import { dimensionLabel } from "./taxonomy.js";
import { plainDimension } from "./present.js";

const TRAJ_PHRASE = {
  improving: "is improving with practice",
  stable: "is broadly stable",
  plateauing: "appears to have plateaued despite continued practice",
  declining: "has slipped in recent practice",
  insufficient_data: "does not have enough completed practice yet to show a direction",
};

/** Compact, model-safe fact set from a shaped careers profile / snapshot. */
export function briefingFacts(shaped) {
  if (!shaped) return null;
  const dna = shaped.dna || {};
  const traj = shaped.trajectory || {};
  const ev = shaped.dnaEvolution || {};
  const prev = shaped.previousSupport || null;
  const rep = shaped.patterns?.repeatedDevelopmentArea || null;
  const strength = dna.strengths?.[0] || null;
  const weakness = dna.development?.[0] || null;
  return {
    student_name: shaped.student?.name || null,
    n_interviews: dna.nInterviews ?? traj.nInterviews ?? 0,
    latest_overall: dna.overallMean ?? traj.latestScore ?? null,
    target: shaped.target ?? 70,
    trajectory: traj.classification || "insufficient_data",
    trajectory_first: traj.firstScore ?? null,
    trajectory_latest: traj.latestScore ?? null,
    trajectory_delta: traj.overallDelta ?? null,
    strongest_competency: strength ? dimensionLabel(strength.key) : null,
    weakest_competency: weakness ? dimensionLabel(weakness.key) : null,
    weakest_competency_key: weakness ? weakness.key : null,
    repeated_weakness: rep ? dimensionLabel(rep.key) : null,
    repeated_weakness_interviews: rep ? rep.recentInterviews : null,
    strongest_improvement: ev.strongestImprovement ? dimensionLabel(ev.strongestImprovement) : null,
    persistent_weakness: ev.persistentWeakness ? dimensionLabel(ev.persistentWeakness) : null,
    previous_appointments: (shaped.history || []).length,
    last_focus: prev ? prev.typeLabel : null,
    last_actions_agreed: prev ? prev.actionAgreed || null : null,
    last_follow_up_required: prev ? !!prev.followUpRequired : false,
    is_stuck: !!shaped.flags?.isStuck,
    no_prior_contact: !!shaped.flags?.noPriorContact,
    recommended_resources: (shaped.recommendedResources || []).map((r) => r.title).slice(0, 3),
    application: shaped.application
      ? [shaped.application.company, shaped.application.role].filter(Boolean).join(" — ") || null
      : null,
  };
}

/**
 * Deterministic briefing — a restatement of the facts, no synthesis magic.
 * Returns { focus, discussion, generated_by: "deterministic" }.
 */
export function deterministicBriefing(shaped) {
  const f = briefingFacts(shaped);
  if (!f || !f.n_interviews) {
    return {
      focus: "This student has not completed enough JOB.READY practice interviews yet to build an interview picture. "
           + "Use today's session to understand their goals and point them at relevant practice.",
      discussion: ["Understand what the student is preparing for", "Agree a first set of practice interviews"],
      generated_by: "deterministic",
    };
  }

  const parts = [];
  // trajectory sentence (evidence)
  if (f.trajectory === "improving" && f.trajectory_first != null && f.trajectory_latest != null) {
    parts.push(`This student has improved from ${f.trajectory_first} to ${f.trajectory_latest} across their recent practice`);
  } else if (f.trajectory_latest != null) {
    parts.push(`This student's overall practice score ${TRAJ_PHRASE[f.trajectory] || "is recorded"} (latest ${f.trajectory_latest})`);
  } else {
    parts.push(`This student's practice ${TRAJ_PHRASE[f.trajectory] || "is recorded"}`);
  }
  if (f.strongest_improvement) parts[parts.length - 1] += `, with the strongest improvement in ${f.strongest_improvement}`;
  parts[parts.length - 1] += ".";

  // weakness sentence (evidence)
  if (f.repeated_weakness) {
    parts.push(`${f.repeated_weakness} remains the main development area and has appeared across the last ${f.repeated_weakness_interviews || "few"} interviews.`);
  } else if (f.weakest_competency) {
    parts.push(`${f.weakest_competency} is currently their weakest interview dimension.`);
  }

  // previous-session context (evidence) + a suggestion (clearly "could")
  if (f.previous_appointments > 0) {
    parts.push(f.last_focus
      ? `The previous session focused on ${f.last_focus.toLowerCase()}.`
      : `There ${f.previous_appointments === 1 ? "has been one previous session" : `have been ${f.previous_appointments} previous sessions`}.`);
  } else if (f.no_prior_contact) {
    parts.push("This is their first recorded careers contact.");
  }
  if (f.weakest_competency_key) {
    parts.push(`Today's session could focus on ${plainDimension(f.weakest_competency_key, "skill")}.`);
  }

  const discussion = [];
  if (f.weakest_competency_key === "evidence") {
    discussion.push("Review one recent evidence-based answer together");
    discussion.push("Identify a stronger, more specific example");
  } else if (f.weakest_competency) {
    discussion.push(`Review a recent answer that tested ${f.weakest_competency.toLowerCase()}`);
    discussion.push(`Agree one concrete change to make on ${f.weakest_competency.toLowerCase()}`);
  }
  discussion.push("Run one targeted practice question and review it");
  if (f.last_follow_up_required) discussion.push("Check progress on the action agreed last time");

  return { focus: parts.join(" "), discussion, generated_by: "deterministic" };
}

/** The strict instruction the AI layer must follow (also embedded server-side). */
export const BRIEFING_AI_RULES = [
  "Use ONLY the facts provided in the JSON. Do not add any fact, number, name or detail that is not present.",
  "Do not infer personal information, background, or intent that is not stated.",
  "Do not diagnose the student and do not claim any intervention caused a change.",
  "Do not predict employment or graduate outcomes.",
  "Distinguish what the data shows (\"has\", \"is\") from what you suggest (\"could\", \"might\").",
  "Keep it to one short paragraph (max ~70 words) plus 2–4 short discussion points.",
  "Plain, supportive, adviser-facing language. No headings inside the paragraph.",
].join(" ");
