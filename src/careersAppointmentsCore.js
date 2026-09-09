/* ================================================================== *
 * JOB.READY (student) — Careers appointment booking: pure helpers
 * ------------------------------------------------------------------
 * No React, no DB. Slot grouping, type-vs-slot matching, cancellation
 * eligibility and the booking-wizard step guard. Tested in
 * src/careersAppointmentsCore.test.js.
 * ================================================================== */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function asDate(x) { return x instanceof Date ? x : new Date(x); }

export function fmtTime(iso) {
  const t = asDate(iso);
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}
export function fmtTimeRange(startISO, endISO) {
  if (!startISO) return "";
  return endISO ? `${fmtTime(startISO)}–${fmtTime(endISO)}` : fmtTime(startISO);
}
export function fmtDayLong(iso) {
  const t = asDate(iso);
  return `${DAYS[t.getDay()]} ${t.getDate()} ${MONTHS[t.getMonth()]} ${t.getFullYear()}`;
}
export function fmtDateTime(iso) {
  return iso ? `${fmtDayLong(iso)} · ${fmtTime(iso)}` : "";
}
function dayKey(iso) {
  const t = asDate(iso);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export const STUDENT_STATUS = {
  invited:   { label: "Invitation", tone: "info" },
  booked:    { label: "Booked",     tone: "info" },
  completed: { label: "Completed",  tone: "success" },
  cancelled: { label: "Cancelled",  tone: "neutral" },
  declined:  { label: "Declined",   tone: "neutral" },
  no_show:   { label: "Missed",     tone: "warning" },
};
export function studentStatusMeta(s) {
  return STUDENT_STATUS[s] || { label: s || "—", tone: "neutral" };
}

/** A future, still-pending staff invitation the student can accept or decline. */
export function canRespondToInvite(appt) {
  return !!appt && appt.status === "invited" && !!appt.starts_at
    && asDate(appt.starts_at).getTime() > Date.now();
}

/** Compact "2h ago" / "3d ago" / date for careers-message timestamps. */
export function fmtRelative(iso) {
  if (!iso) return "";
  const then = asDate(iso).getTime();
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDayLong(iso);
}

/** How many of these careers messages are unread. */
export function unreadCount(messages) {
  return (messages || []).filter((m) => m && !m.read_at).length;
}

/**
 * Which of these open slots a student can pick for a chosen appointment type.
 * A slot with a fixed `type_key` only matches that type; a slot with no type
 * (staff takes anything) matches every type.
 */
export function slotsForType(slots, typeKey) {
  if (!Array.isArray(slots)) return [];
  if (!typeKey) return slots.filter((s) => !s.type_key);
  return slots.filter((s) => !s.type_key || s.type_key === typeKey);
}

/** Group open slots into day sections for the picker. */
export function groupSlotsByDay(slots) {
  const byDay = new Map();
  for (const s of slots || []) {
    if (!s.starts_at) continue;
    const k = dayKey(s.starts_at);
    if (!byDay.has(k)) byDay.set(k, { key: k, label: fmtDayLong(s.starts_at), slots: [] });
    byDay.get(k).slots.push(s);
  }
  return [...byDay.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((g) => ({ ...g, slots: g.slots.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at))) }));
}

/** A booked, still-future appointment can be cancelled by the student. */
export function canCancel(appt) {
  return !!appt && appt.status === "booked" && !!appt.starts_at && asDate(appt.starts_at).getTime() > Date.now();
}

/**
 * Three buckets for the student's Careers Support hub:
 *   invitations — a pending, still-future staff invitation (needs a reply)
 *   upcoming    — a future booked appointment
 *   past        — everything else (completed / cancelled / declined / past)
 */
export function splitAppointments(list) {
  const invitations = [], upcoming = [], past = [];
  for (const a of list || []) {
    const future = a.starts_at && asDate(a.starts_at).getTime() > Date.now();
    if (a.status === "invited" && future) invitations.push(a);
    else if (a.status === "booked" && future) upcoming.push(a);
    else past.push(a);
  }
  invitations.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  upcoming.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  past.sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at)));
  return { invitations, upcoming, past };
}

export const BOOKING_STEPS = ["type", "slot", "details", "review"];

/** Can the wizard advance from `step` given the current draft? -> { ok, reason } */
export function canAdvance(step, draft) {
  const dr = draft || {};
  switch (step) {
    case "type":
      return dr.typeKey ? { ok: true } : { ok: false, reason: "Choose an appointment type." };
    case "slot":
      return dr.slotId ? { ok: true } : { ok: false, reason: "Choose an available slot." };
    case "details":
      if (dr.comment && dr.comment.length > 2000) {
        return { ok: false, reason: "Keep your note under 2000 characters." };
      }
      return { ok: true };
    case "review":
      return { ok: true };
    default:
      return { ok: false, reason: "Unknown step." };
  }
}

/** Build the book_appointment RPC arguments from a completed draft. */
export function bookingArgs(draft) {
  const dr = draft || {};
  return {
    p_slot_id: dr.slotId || null,
    p_appointment_type_id: dr.typeId || null,
    p_application_id: dr.applicationId || null,
    p_comment: (dr.comment && dr.comment.trim()) ? dr.comment.trim() : null,
  };
}
