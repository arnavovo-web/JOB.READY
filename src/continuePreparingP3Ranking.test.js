/* ================================================================== *
 * PHASE 15B — P3 CROSS-APPLICATION RANKING
 * ------------------------------------------------------------------
 * P3 must compare recommendation priority ACROSS every eligible
 * application, not return "the newest application's top rec".
 *
 * applicationDevelopmentPriorities is mocked here so each application's
 * recommendation priority is controlled directly — the real engine
 * currently yields a uniform priority for every high+preparation item
 * (importance "high" x gap 1.0 = 1.0), which would make a
 * priority-0.62-vs-0.99 scenario impossible to express otherwise. The
 * gates themselves (level === "high", gapKind === "preparation") are
 * still exercised with real values.
 * ================================================================== */
import { describe, it, expect, vi } from "vitest";

vi.mock("./applicationIntelligence.js", () => ({
  // returns whatever recs the test attached to this application's intelligence blob
  applicationDevelopmentPriorities: (intel) => (intel && intel.__recs) || [],
}));

const { pickContinuePreparing } = await import("./continuePreparing.js");

const rec = (over) => ({ label: "Accretion / dilution", dimension: "technical", level: "high", gapKind: "preparation", priority: 1, ...over });
const app = (over) => ({ id: "app", company: "Co", role: "Role", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", applicationIntelligence: { __recs: [rec()] }, ...over });
const runP3 = (applications) => pickContinuePreparing({ developmentModules: [], moduleProgress: [], classroomTopics: [], applications, candidateState: {} })[0];

describe("P3 — recommendation.priority dominates application recency (critical regression)", () => {
  it("App A created today (priority 0.62) LOSES to App B created last week (priority 0.99)", () => {
    const A = app({ id: "app-A", company: "Acme", createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z",
      applicationIntelligence: { __recs: [rec({ label: "A-topic", priority: 0.62 })] } });
    const B = app({ id: "app-B", company: "Beta", createdAt: "2026-08-21T00:00:00.000Z", updatedAt: "2026-08-21T00:00:00.000Z",
      applicationIntelligence: { __recs: [rec({ label: "B-topic", priority: 0.99 })] } });
    // pass A first (as the "newest, would previously win" one)
    const winner = runP3([A, B]);
    expect(winner.kind).toBe("prepare_recommendation");
    expect(winner.applicationId).toBe("app-B");
    expect(winner.title).toBe("B-topic");
    expect(winner.evidenceType).toBe("preparation");
    expect(winner.sublabel).toMatch(/important for your beta/i);
    expect(winner.sublabel).not.toMatch(/weakness/i);
  });

  it("result is identical whichever order the applications are supplied in", () => {
    const A = app({ id: "app-A", applicationIntelligence: { __recs: [rec({ label: "A", priority: 0.62 })] } });
    const B = app({ id: "app-B", applicationIntelligence: { __recs: [rec({ label: "B", priority: 0.99 })] } });
    expect(runP3([A, B]).applicationId).toBe("app-B");
    expect(runP3([B, A]).applicationId).toBe("app-B");
  });
});

describe("P3 — tie-break chain when priorities are equal", () => {
  const mk = (id, over) => app({ id, company: id, applicationIntelligence: { __recs: [rec({ label: `${id}-label`, priority: 1, ...(over && over.rec) })] }, ...(over && over.app) });

  it("equal priority -> newer application.updated_at wins", () => {
    const older = mk("app-older", { app: { createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-05T00:00:00.000Z" } });
    const newer = mk("app-newer", { app: { createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" } });
    expect(runP3([older, newer]).applicationId).toBe("app-newer");
    expect(runP3([newer, older]).applicationId).toBe("app-newer");
  });

  it("equal priority + equal updated_at -> newer application.created_at wins", () => {
    const older = mk("app-older", { app: { createdAt: "2026-08-01T00:00:00.000Z", updatedAt: null } });
    const newer = mk("app-newer", { app: { createdAt: "2026-08-19T00:00:00.000Z", updatedAt: null } });
    expect(runP3([older, newer]).applicationId).toBe("app-newer");
    expect(runP3([newer, older]).applicationId).toBe("app-newer");
  });

  it("equal priority + equal timestamps -> recommendation.label ASC wins", () => {
    const z = mk("app-1", { rec: { label: "zzz-topic" }, app: { createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" } });
    const a = mk("app-2", { rec: { label: "aaa-topic" }, app: { createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" } });
    expect(runP3([z, a]).title).toBe("aaa-topic");
    expect(runP3([a, z]).title).toBe("aaa-topic");
  });

  it("equal priority + equal timestamps + equal label -> application.id ASC wins (total order, no array dependence)", () => {
    const ts = { createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" };
    const bbb = app({ id: "app-bbb", company: "B", applicationIntelligence: { __recs: [rec({ label: "same", priority: 1 })] }, ...ts });
    const aaa = app({ id: "app-aaa", company: "A", applicationIntelligence: { __recs: [rec({ label: "same", priority: 1 })] }, ...ts });
    expect(runP3([bbb, aaa]).applicationId).toBe("app-aaa");
    expect(runP3([aaa, bbb]).applicationId).toBe("app-aaa");
  });
});

describe("P3 — gates still enforced", () => {
  it("a demonstrated (non-preparation) recommendation is never eligible for P3", () => {
    const A = app({ id: "app-A", applicationIntelligence: { __recs: [rec({ priority: 5, gapKind: "demonstrated" })] } });
    expect(runP3([A])).toBeUndefined();
  });
  it("a non-high-level recommendation is never eligible for P3", () => {
    const A = app({ id: "app-A", applicationIntelligence: { __recs: [rec({ priority: 5, level: "recommended" })] } });
    expect(runP3([A])).toBeUndefined();
  });
  it("an application with no intelligence contributes nothing", () => {
    const A = { id: "app-A", company: "Co", role: "R", applicationIntelligence: null };
    const B = app({ id: "app-B", applicationIntelligence: { __recs: [rec({ label: "B", priority: 0.7 })] } });
    expect(runP3([A, B]).applicationId).toBe("app-B");
  });
});
