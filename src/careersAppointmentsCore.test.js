import { describe, it, expect } from "vitest";
import {
  slotsForType, groupSlotsByDay, canCancel, splitAppointments,
  canAdvance, bookingArgs, BOOKING_STEPS, studentStatusMeta,
  fmtTimeRange, fmtDayLong, canRespondToInvite, fmtRelative, unreadCount,
} from "./careersAppointmentsCore.js";

const future = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const past = (h) => new Date(Date.now() - h * 3600e3).toISOString();

// Anchored to a fixed local day so the "same day / next day" grouping does not
// depend on the wall-clock hour the suite happens to run at.
const dayAt = (dayOffset, hh, mm = 0) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 7 + dayOffset);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
};
const SLOTS = [
  { slot_id: "a", type_key: "interview_prep", starts_at: dayAt(0, 10), ends_at: dayAt(0, 10, 30), staff_name: "A. Adviser" },
  { slot_id: "b", type_key: null, starts_at: dayAt(0, 11), ends_at: dayAt(0, 11, 30), staff_name: "B. Adviser" },
  { slot_id: "c", type_key: "cv_review", starts_at: dayAt(1, 10), ends_at: dayAt(1, 10, 30) },
];

describe("slotsForType", () => {
  it("a typed slot only matches its own type; a null-type slot matches everything", () => {
    expect(slotsForType(SLOTS, "interview_prep").map((s) => s.slot_id)).toEqual(["a", "b"]);
    expect(slotsForType(SLOTS, "cv_review").map((s) => s.slot_id)).toEqual(["b", "c"]);
    expect(slotsForType(SLOTS, "career_guidance").map((s) => s.slot_id)).toEqual(["b"]);
  });
  it("no type chosen -> only the any-type slots", () => {
    expect(slotsForType(SLOTS, "").map((s) => s.slot_id)).toEqual(["b"]);
  });
  it("safe on junk", () => {
    expect(slotsForType(null, "x")).toEqual([]);
  });
});

describe("groupSlotsByDay", () => {
  it("groups + sorts by day then time", () => {
    const g = groupSlotsByDay(SLOTS);
    expect(g.length).toBe(2);
    expect(g[0].slots.map((s) => s.slot_id)).toEqual(["a", "b"]);
    expect(g[1].slots.map((s) => s.slot_id)).toEqual(["c"]);
    expect(g[0].label).toMatch(/\w+ \d+ \w+ \d{4}/);
  });
});

describe("canCancel", () => {
  it("only a booked, still-future appointment", () => {
    expect(canCancel({ status: "booked", starts_at: future(2) })).toBe(true);
    expect(canCancel({ status: "booked", starts_at: past(2) })).toBe(false);
    expect(canCancel({ status: "completed", starts_at: future(2) })).toBe(false);
    expect(canCancel({ status: "cancelled", starts_at: future(2) })).toBe(false);
    expect(canCancel(null)).toBe(false);
  });
});

describe("splitAppointments", () => {
  it("splits into invitations (future invited) / upcoming (future booked) / past (everything else)", () => {
    const list = [
      { id: 1, status: "booked", starts_at: future(10) },
      { id: 2, status: "booked", starts_at: past(10) },
      { id: 3, status: "completed", starts_at: past(5) },
      { id: 4, status: "cancelled", starts_at: future(5) },
      { id: 5, status: "invited", starts_at: future(20) },
      { id: 6, status: "invited", starts_at: past(20) },   // stale invite -> past
      { id: 7, status: "declined", starts_at: future(30) },
    ];
    const { invitations, upcoming, past: p } = splitAppointments(list);
    expect(invitations.map((a) => a.id)).toEqual([5]);
    expect(upcoming.map((a) => a.id)).toEqual([1]);
    expect(p.map((a) => a.id).sort()).toEqual([2, 3, 4, 6, 7]);
  });
});

describe("careers-support hub helpers", () => {
  it("canRespondToInvite — only a future, still-pending invitation", () => {
    expect(canRespondToInvite({ status: "invited", starts_at: future(3) })).toBe(true);
    expect(canRespondToInvite({ status: "invited", starts_at: past(3) })).toBe(false);
    expect(canRespondToInvite({ status: "booked", starts_at: future(3) })).toBe(false);
    expect(canRespondToInvite(null)).toBe(false);
  });
  it("fmtRelative — compact, deterministic buckets", () => {
    expect(fmtRelative(new Date(Date.now() - 30 * 1000).toISOString())).toBe("just now");
    expect(fmtRelative(new Date(Date.now() - 5 * 60000).toISOString())).toBe("5m ago");
    expect(fmtRelative(new Date(Date.now() - 3 * 3600e3).toISOString())).toBe("3h ago");
    expect(fmtRelative(new Date(Date.now() - 2 * 24 * 3600e3).toISOString())).toBe("2d ago");
    expect(fmtRelative(new Date(Date.now() - 20 * 24 * 3600e3).toISOString())).toMatch(/^\w+ \d+ \w+ \d{4}$/);
    expect(fmtRelative(null)).toBe("");
  });
  it("unreadCount — counts messages without read_at", () => {
    expect(unreadCount([{ read_at: null }, { read_at: "2026-01-01" }, {}])).toBe(2);
    expect(unreadCount([])).toBe(0);
    expect(unreadCount(null)).toBe(0);
  });
});

describe("booking wizard guard", () => {
  it("step order", () => {
    expect(BOOKING_STEPS).toEqual(["type", "slot", "details", "review"]);
  });
  it("type step needs a type; slot step needs a slot", () => {
    expect(canAdvance("type", {}).ok).toBe(false);
    expect(canAdvance("type", { typeKey: "cv_review" }).ok).toBe(true);
    expect(canAdvance("slot", { typeKey: "cv_review" }).ok).toBe(false);
    expect(canAdvance("slot", { typeKey: "cv_review", slotId: "c" }).ok).toBe(true);
  });
  it("details step rejects an over-long comment, else passes", () => {
    expect(canAdvance("details", { comment: "x".repeat(2001) }).ok).toBe(false);
    expect(canAdvance("details", { comment: "short" }).ok).toBe(true);
    expect(canAdvance("details", {}).ok).toBe(true);
  });
  it("bookingArgs maps a completed draft to RPC params, trimming / nulling empties", () => {
    expect(bookingArgs({ slotId: "s1", typeId: "t1", applicationId: "app1", comment: "  hi  " }))
      .toEqual({ p_slot_id: "s1", p_appointment_type_id: "t1", p_application_id: "app1", p_comment: "hi" });
    expect(bookingArgs({ slotId: "s1", comment: "   " }))
      .toEqual({ p_slot_id: "s1", p_appointment_type_id: null, p_application_id: null, p_comment: null });
  });
});

describe("status + formatting", () => {
  it("student status labels", () => {
    expect(studentStatusMeta("booked").label).toBe("Booked");
    expect(studentStatusMeta("no_show").label).toBe("Missed");
    expect(studentStatusMeta("invited").label).toBe("Invitation");
    expect(studentStatusMeta("declined").label).toBe("Declined");
    expect(studentStatusMeta("weird").label).toBe("weird");
  });
  it("time range + long day are deterministic", () => {
    const s = "2026-03-04T14:00:00.000Z", e = "2026-03-04T14:30:00.000Z";
    expect(fmtTimeRange(s, e)).toMatch(/^\d{2}:\d{2}–\d{2}:\d{2}$/);
    expect(fmtDayLong(s)).toMatch(/^\w+ \d+ \w+ 2026$/);
  });
});
