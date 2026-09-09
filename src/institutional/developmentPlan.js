/* ================================================================== *
 * EKI² — personalised development plans (pure)
 * ------------------------------------------------------------------
 * Deterministic plan generation rules + shaping. A plan is a careers
 * development plan, not a task manager: one priority development area,
 * a goal, a recommended action, a resource, a target, a status.
 * Pure. Tested in developmentPlan.test.js.
 * ================================================================== */
import { dimensionLabel } from "./taxonomy.js";
import { plainDimension } from "./present.js";

export const PLAN_STATUS = {
  active: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "warn" },
  completed: { label: "Completed", tone: "good" },
  archived: { label: "Archived", tone: "neutral" },
};
export function planStatusMeta(s) {
  return PLAN_STATUS[s] || { label: s || "—", tone: "neutral" };
}

const ITEM_KIND = {
  resource: "Resource", practice: "Practice", goal: "Goal", action: "Action",
};
export function itemKindLabel(k) {
  return ITEM_KIND[k] || k;
}

/** Shape the raw `development_plan` block. */
export function shapeDevelopmentPlan(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: raw.id,
    developmentArea: raw.development_area || null,
    developmentAreaLabel: raw.development_area ? dimensionLabel(raw.development_area) : null,
    title: raw.title || "",
    description: raw.description || "",
    goalTarget: raw.goal_target ?? null,
    status: raw.status || "active",
    resourceId: raw.resource_id || null,
    reviewDate: raw.review_date || null,
    completedAt: raw.completed_at || null,
    items: (Array.isArray(raw.items) ? raw.items : []).map((it) => ({
      id: it.id, kind: it.kind, label: it.label, status: it.status || "todo",
    })),
  };
}

/**
 * Deterministic default plan from a shaped careers profile / snapshot.
 * Returns { developmentArea, title, description, goalTarget, resourceId, items[] }
 * where items are { kind, label } (no ids — for creation).
 */
export function suggestPlan(shaped) {
  const dna = shaped?.dna || {};
  const weakest = dna.development?.[0] || null;
  const rec = (shaped?.recommendedResources || [])[0] || null;
  const target = shaped?.target ?? 70;

  if (!weakest) {
    return {
      developmentArea: null,
      title: "Keep interview practice going",
      description: "No single dimension is below the interview-ready threshold. Keep practising across formats and rounds.",
      goalTarget: null,
      resourceId: null,
      items: [
        { kind: "practice", label: "Complete 2 mixed practice interviews" },
        { kind: "goal", label: "Maintain all six dimensions at or above interview-ready" },
      ],
    };
  }

  const area = weakest.key;
  const label = dimensionLabel(area);
  const goal = Math.min(100, Math.max(target, Math.round(weakest.mean + 15)));
  return {
    developmentArea: area,
    title: `Priority — ${label}`,
    description: `Recent practice shows ${label} remains below the student's other interview dimensions `
      + `(currently around ${weakest.mean}). Focused work on ${plainDimension(area, "skill")} should move it up.`,
    goalTarget: goal,
    resourceId: rec ? rec.id : null,
    items: [
      rec ? { kind: "resource", label: `Complete: ${rec.title}` } : { kind: "action", label: `Practise ${plainDimension(area, "skill")}` },
      { kind: "practice", label: "Complete 2 targeted interview questions on this area" },
      { kind: "goal", label: `Move ${label} toward ${goal}` },
    ],
  };
}

/** RPC args for save_development_plan from a suggestion / edited form. */
export function planToRpcArgs(institutionId, studentId, v, planId) {
  return {
    p_institution_id: institutionId,
    p_student_id: studentId,
    p_title: (v.title || "").trim(),
    p_development_area: v.developmentArea || null,
    p_description: v.description ? v.description.trim() : null,
    p_goal_target: v.goalTarget != null && v.goalTarget !== "" ? Number(v.goalTarget) : null,
    p_resource_id: v.resourceId || null,
    p_review_date: v.reviewDate || null,
    p_plan_id: planId || null,
  };
}

/** Student-facing plan summary line. */
export function planStudentSummary(plan) {
  if (!plan) return null;
  const meta = planStatusMeta(plan.status);
  const area = plan.developmentAreaLabel ? `Priority: ${plan.developmentAreaLabel}. ` : "";
  const goal = plan.goalTarget != null ? `Target: move toward ${plan.goalTarget}. ` : "";
  return `${area}${goal}Status: ${meta.label}.`;
}
