/* ================================================================== *
 * EKI² — development plans (deterministic generation + shaping)
 * ================================================================== */
import { describe, it, expect } from "vitest";
import {
  planStatusMeta, itemKindLabel, shapeDevelopmentPlan, suggestPlan,
  planToRpcArgs, planStudentSummary,
} from "./developmentPlan.js";

const SHAPED = {
  target: 70,
  dna: { development: [{ key: "evidence", mean: 44 }, { key: "structure", mean: 58 }], strengths: [{ key: "communication", mean: 74 }] },
  recommendedResources: [{ id: "r1", title: "Building stronger evidence-based interview answers" }],
};

describe("suggestPlan — deterministic from signals", () => {
  it("targets the weakest dimension with a grounded goal and 3 items", () => {
    const p = suggestPlan(SHAPED);
    expect(p.developmentArea).toBe("evidence");
    expect(p.title).toMatch(/Priority — Evidence/);
    expect(p.goalTarget).toBe(70);            // max(target, round(44+15)=59) -> 70
    expect(p.resourceId).toBe("r1");
    expect(p.items).toHaveLength(3);
    expect(p.items[0]).toMatchObject({ kind: "resource" });
    expect(p.items.some((i) => i.kind === "practice")).toBe(true);
    expect(p.items.some((i) => i.kind === "goal")).toBe(true);
  });
  it("no weakness -> a keep-going plan, no fabricated area", () => {
    const p = suggestPlan({ target: 70, dna: { development: [], strengths: [] }, recommendedResources: [] });
    expect(p.developmentArea).toBe(null);
    expect(p.items.length).toBeGreaterThan(0);
  });
});

describe("planToRpcArgs", () => {
  it("maps an edited form to the RPC parameter names, nulling empties", () => {
    const args = planToRpcArgs("inst1", "stu1", {
      title: "  Priority — Evidence  ", developmentArea: "evidence", description: "  x  ",
      goalTarget: "70", resourceId: "r1", reviewDate: "2026-10-01",
    }, "plan9");
    expect(args).toEqual({
      p_institution_id: "inst1", p_student_id: "stu1", p_title: "Priority — Evidence",
      p_development_area: "evidence", p_description: "x", p_goal_target: 70,
      p_resource_id: "r1", p_review_date: "2026-10-01", p_plan_id: "plan9",
    });
    expect(planToRpcArgs("i", "s", { title: "t", goalTarget: "" }).p_goal_target).toBe(null);
  });
});

describe("shaping + labels", () => {
  it("shapeDevelopmentPlan normalises the raw block", () => {
    const p = shapeDevelopmentPlan({
      id: "p1", development_area: "evidence", title: "T", description: "D", goal_target: 70,
      status: "in_progress", review_date: "2026-10-01",
      items: [{ id: "i1", kind: "practice", label: "do it", status: "todo" }],
    });
    expect(p.developmentAreaLabel).toBe("Evidence");
    expect(p.items[0].label).toBe("do it");
    expect(planStatusMeta("in_progress").label).toBe("In progress");
    expect(itemKindLabel("resource")).toBe("Resource");
  });
  it("shapeDevelopmentPlan(null) -> null", () => {
    expect(shapeDevelopmentPlan(null)).toBe(null);
  });
  it("planStudentSummary is a plain one-liner", () => {
    const s = planStudentSummary(shapeDevelopmentPlan({ id: "p", development_area: "evidence", title: "T", goal_target: 70, status: "active", items: [] }));
    expect(s).toMatch(/Priority: Evidence/);
    expect(s).toMatch(/Target: move toward 70/);
    expect(s).toMatch(/Status: Not started/);
  });
});
