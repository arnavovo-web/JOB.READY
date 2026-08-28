/* ================================================================== *
 * PHASE 16A — applicationSchedule.js (behavioural)
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { daysUntil, interviewCountdown, sortApplicationsByUpcoming, partitionApplications, nearestUpcomingApplication } from "./applicationSchedule.js";

const NOW = new Date("2026-09-01T10:00:00Z");
const at = (isoDate) => isoDate;

describe("applicationSchedule.js is pure & offline", () => {
  it("no AI / DB / network / timers", () => {
    const src = new URL("./applicationSchedule.js", import.meta.url);
    const fs = require("node:fs").readFileSync(src, "utf8");
    expect(fs).not.toMatch(/callClaude|supabase|fetch\(|setTimeout|setInterval|from ["']react["']/);
  });
});

describe("daysUntil — calendar-day difference, null-safe", () => {
  it("today = 0, tomorrow = 1, past = negative", () => {
    expect(daysUntil("2026-09-01", NOW)).toBe(0);
    expect(daysUntil("2026-09-02", NOW)).toBe(1);
    expect(daysUntil("2026-08-25", NOW)).toBe(-7);
    expect(daysUntil("2026-09-11", NOW)).toBe(10);
  });
  it("null / empty / garbage -> null (never throws)", () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("", NOW)).toBeNull();
    expect(daysUntil("not-a-date", NOW)).toBeNull();
    expect(() => daysUntil(undefined)).not.toThrow();
  });
});

describe("interviewCountdown — plain-text wording", () => {
  it("covers every band with explicit text (not colour)", () => {
    expect(interviewCountdown(null, NOW)).toMatchObject({ status: "none", label: "", isUpcoming: false });
    expect(interviewCountdown("2026-09-01", NOW)).toMatchObject({ status: "today", label: "Interview today", isUpcoming: true });
    expect(interviewCountdown("2026-09-02", NOW)).toMatchObject({ status: "tomorrow", label: "Interview tomorrow", isUpcoming: true });
    expect(interviewCountdown("2026-09-04", NOW)).toMatchObject({ status: "soon", days: 3, label: "Interview in 3 days", isUpcoming: true });
    expect(interviewCountdown("2026-09-08", NOW)).toMatchObject({ days: 7, label: "Interview in 1 week", isUpcoming: true });
    expect(interviewCountdown("2026-09-09", NOW)).toMatchObject({ days: 8, label: "Interview in 8 days", isUpcoming: true });
    expect(interviewCountdown("2026-09-22", NOW)).toMatchObject({ label: "Interview in 3 weeks", isUpcoming: true });
  });
  it("a past date is 'past' — NOT upcoming, NOT 'complete'", () => {
    const c = interviewCountdown("2026-08-20", NOW);
    expect(c.status).toBe("past");
    expect(c.isUpcoming).toBe(false);
    expect(c.label).not.toMatch(/complete|done/i);
  });
});

describe("sortApplicationsByUpcoming / partition — nearest upcoming first, past ≠ upcoming", () => {
  const A = { id: "a", interviewDate: "2026-09-09" };   // in 8 days
  const B = { id: "b", interviewDate: "2026-09-03" };   // in 2 days
  const C = { id: "c", interviewDate: null };            // no date
  const D = { id: "d", interviewDate: "2026-08-10" };    // past

  it("order: nearest future first, then no-date / past", () => {
    const sorted = sortApplicationsByUpcoming([A, C, D, B], NOW).map((x) => x.id);
    expect(sorted.slice(0, 2)).toEqual(["b", "a"]);      // B (2d) before A (8d)
    expect(sorted.slice(2)).toEqual(["c", "d"]);         // "other": id ASC
  });

  it("partition puts past + no-date in `other`, never in `upcoming`", () => {
    const { upcoming, other } = partitionApplications([A, B, C, D], NOW);
    expect(upcoming.map((x) => x.id)).toEqual(["b", "a"]);
    expect(other.map((x) => x.id).sort()).toEqual(["c", "d"]);
  });

  it("nearestUpcomingApplication returns the soonest future one, or null", () => {
    expect(nearestUpcomingApplication([A, B, C, D], NOW).id).toBe("b");
    expect(nearestUpcomingApplication([C, D], NOW)).toBeNull();
    expect(nearestUpcomingApplication([], NOW)).toBeNull();
    expect(nearestUpcomingApplication(null, NOW)).toBeNull();
  });

  it("a today interview counts as upcoming (sorts before a future one)", () => {
    const T = { id: "t", interviewDate: "2026-09-01" };
    expect(nearestUpcomingApplication([A, T], NOW).id).toBe("t");
  });

  it("deterministic: identical result regardless of input order", () => {
    const f = sortApplicationsByUpcoming([A, B, C, D], NOW).map((x) => x.id);
    const r = sortApplicationsByUpcoming([D, C, B, A], NOW).map((x) => x.id);
    expect(f).toEqual(r);
  });

  it("never throws on malformed input", () => {
    expect(() => sortApplicationsByUpcoming([null, {}, { interviewDate: "x" }], NOW)).not.toThrow();
    expect(() => partitionApplications(undefined, NOW)).not.toThrow();
  });
});
