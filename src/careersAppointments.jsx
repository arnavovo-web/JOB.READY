/* ================================================================== *
 * JOB.READY (student) — Careers appointment booking
 * ------------------------------------------------------------------
 * A self-contained screen rendered by App.jsx when screen === "careers".
 * Lets a student book time with their university careers team; the
 * adviser sees the booking (and a focused briefing) in EKI². No student
 * data model is duplicated — everything goes through the SECURITY
 * DEFINER RPCs from 20260909180000_careers_appointments.sql via the
 * shared browser Supabase client.
 *
 * Uses the student app's own .jr-* design tokens (injected globally by
 * App.jsx), so it needs no stylesheet of its own.
 * ================================================================== */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock, ArrowLeft, ArrowRight, Clock, Check, X, MessageSquareText,
  Building2, User, Briefcase,
} from "lucide-react";
import { getSupabase } from "./institutional/supabaseClient.js";
import {
  BOOKING_STEPS, canAdvance, bookingArgs, slotsForType, groupSlotsByDay,
  splitAppointments, canCancel, studentStatusMeta, fmtDayLong, fmtTime,
  fmtTimeRange, fmtDateTime,
} from "./careersAppointmentsCore.js";

async function rpc(name, args) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc(name, args || {});
  if (error) throw new Error(error.message || `${name} failed`);
  return data;
}

const STEP_LABELS = { type: "Type", slot: "Time", details: "Details", review: "Confirm" };

export default function CareersAppointmentsScreen({ user, applications = [], onBack }) {
  const [phase, setPhase] = useState("loading"); // loading | ready | error
  const [error, setError] = useState("");
  const [types, setTypes] = useState([]);
  const [slots, setSlots] = useState([]);
  const [mine, setMine] = useState([]);

  const [mode, setMode] = useState("list"); // list | book | confirm
  const [step, setStep] = useState("type");
  const [draft, setDraft] = useState({ typeKey: "", typeId: null, slotId: null, applicationId: "", comment: "" });
  const [stepError, setStepError] = useState("");
  const [booking, setBooking] = useState(false);
  const [confirmed, setConfirmed] = useState(null); // the just-booked appointment (from list_my_appointments)
  const [cancelBusy, setCancelBusy] = useState("");

  const load = useCallback(async () => {
    setPhase("loading"); setError("");
    try {
      const [t, av, m] = await Promise.all([
        rpc("list_appointment_types"),
        rpc("list_careers_availability"),
        rpc("list_my_appointments"),
      ]);
      // de-dupe types by key (an institution's own label wins over the global)
      const byKey = new Map();
      for (const x of Array.isArray(t) ? t : []) {
        if (!byKey.has(x.key) || x.institution_id) byKey.set(x.key, x);
      }
      setTypes([...byKey.values()].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
      setSlots(Array.isArray(av) ? av : []);
      setMine(Array.isArray(m) ? m : []);
      setPhase("ready");
    } catch (e) {
      setError(e.message || "Couldn't load careers appointments.");
      setPhase("error");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { upcoming, past } = useMemo(() => splitAppointments(mine), [mine]);
  const hasAvailability = slots.length > 0;

  function startBooking() {
    setDraft({ typeKey: "", typeId: null, slotId: null, applicationId: "", comment: "" });
    setStep("type"); setStepError(""); setMode("book");
  }
  function next() {
    const v = canAdvance(step, draft);
    if (!v.ok) { setStepError(v.reason); return; }
    setStepError("");
    const i = BOOKING_STEPS.indexOf(step);
    if (i < BOOKING_STEPS.length - 1) setStep(BOOKING_STEPS[i + 1]);
  }
  function back() {
    setStepError("");
    const i = BOOKING_STEPS.indexOf(step);
    if (i > 0) setStep(BOOKING_STEPS[i - 1]);
    else setMode("list");
  }
  async function confirmBooking() {
    setBooking(true); setStepError("");
    try {
      const res = await rpc("book_appointment", bookingArgs(draft));
      if (!res?.ok) {
        setStepError(
          res?.reason === "slot_taken" ? "Sorry — someone just booked that slot. Choose another time."
          : res?.reason === "slot_past" ? "That slot is no longer in the future."
          : res?.reason === "invalid_type" ? "That appointment type isn't available."
          : "Couldn't book that appointment. Please try again."
        );
        setBooking(false);
        return;
      }
      const m = await rpc("list_my_appointments");
      const list = Array.isArray(m) ? m : [];
      setMine(list);
      setConfirmed(list.find((a) => a.id === res.appointment_id) || null);
      setMode("confirm");
    } catch (e) {
      setStepError(e.message || "Couldn't book that appointment.");
    }
    setBooking(false);
  }
  async function cancel(id) {
    setCancelBusy(id);
    try {
      await rpc("cancel_appointment", { p_appointment_id: id });
      const m = await rpc("list_my_appointments");
      setMine(Array.isArray(m) ? m : []);
    } catch (e) { setError(e.message || "Couldn't cancel."); }
    setCancelBusy("");
  }

  /* ---------------- render ---------------- */
  return (
    <div className="jr-fade jr-page">
      <Btn onClick={onBack} style={{ marginBottom: 16, padding: "6px 4px" }}><ArrowLeft size={14} /> Dashboard</Btn>
      <div className="jr-page-header">
        <div className="jr-page-header-text">
          <h2 className="jr-h1">Careers support</h2>
          <div className="jr-text" style={{ marginTop: 4 }}>
            Book time with your university careers team. What you share here helps them prepare for your appointment.
          </div>
        </div>
      </div>

      {phase === "loading" && <div className="jr-text-sm" style={{ padding: "20px 0" }}>Loading…</div>}
      {phase === "error" && <div className="jr-alert jr-alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      {phase === "ready" && mode === "list" && (
        <ListView
          upcoming={upcoming} past={past} hasAvailability={hasAvailability}
          onBook={startBooking} onCancel={cancel} cancelBusy={cancelBusy} error={error}
        />
      )}

      {phase === "ready" && mode === "book" && (
        <BookingWizard
          step={step} draft={draft} setDraft={setDraft} types={types} slots={slots}
          applications={applications} stepError={stepError} booking={booking}
          onNext={next} onBack={back} onConfirm={confirmBooking}
        />
      )}

      {phase === "ready" && mode === "confirm" && (
        <ConfirmationView appt={confirmed} onDone={() => { setMode("list"); setConfirmed(null); load(); }} />
      )}
    </div>
  );
}

/* ---- small shared bits (reuse App.jsx's .jr-* classes) --------- */
function Btn({ children, variant = "ghost", style, ...rest }) {
  const base = { display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 700, fontSize: 13.5,
    padding: "9px 15px", borderRadius: "var(--r-sm)", border: "1px solid transparent", cursor: "pointer",
    fontFamily: "var(--font)" };
  const v = variant === "accent" ? { background: "var(--blue)", color: "#fff" }
    : variant === "primary" ? { background: "var(--navy)", color: "#fff" }
    : { background: "#fff", color: "var(--navy)", border: "1px solid var(--border)" };
  return <button className="jr-btn" style={{ ...base, ...v, ...style }} {...rest}>{children}</button>;
}
function StatusBadge({ status }) {
  const m = studentStatusMeta(status);
  const cls = m.tone === "success" ? "jr-badge-success" : m.tone === "warning" ? "jr-badge-warning"
    : m.tone === "info" ? "jr-badge-info" : "jr-badge-neutral";
  return <span className={`jr-badge ${cls}`}>{m.label}</span>;
}

function AppointmentCard({ a, onCancel, cancelBusy }) {
  return (
    <div className="jr-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="flex items-center gap-2" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 800, color: "var(--navy)", fontSize: 14 }}>{a.type_label}</span>
        <StatusBadge status={a.status} />
      </div>
      <div className="jr-text-sm" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Clock size={13} /> {a.starts_at ? `${fmtDateTime(a.starts_at)}${a.ends_at ? `–${fmtTime(a.ends_at)}` : ""}` : "Time to be confirmed"}
      </div>
      {a.institution_name ? <div className="jr-text-sm" style={{ display: "flex", alignItems: "center", gap: 6 }}><Building2 size={13} /> {a.institution_name}{a.staff_name ? ` · ${a.staff_name}` : ""}</div> : null}
      {a.application ? <div className="jr-text-sm" style={{ display: "flex", alignItems: "center", gap: 6 }}><Briefcase size={13} /> {[a.application.company, a.application.role].filter(Boolean).join(" — ")}</div> : null}
      {a.student_comment ? (
        <div style={{ display: "flex", gap: 7, alignItems: "flex-start", background: "var(--surface-sunken)", borderRadius: "var(--r-sm)", padding: "9px 11px", fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
          <MessageSquareText size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{a.student_comment}</span>
        </div>
      ) : null}
      {canCancel(a) ? (
        <div><Btn onClick={() => onCancel(a.id)} disabled={cancelBusy === a.id} style={{ fontSize: 12.5, padding: "6px 11px" }}>
          <X size={12} /> {cancelBusy === a.id ? "Cancelling…" : "Cancel"}
        </Btn></div>
      ) : null}
    </div>
  );
}

function ListView({ upcoming, past, hasAvailability, onBook, onCancel, cancelBusy, error }) {
  return (
    <>
      {error ? <div className="jr-alert jr-alert-error" style={{ marginBottom: 16 }}>{error}</div> : null}
      <div className="flex items-center gap-2" style={{ justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap" }}>
        <h3 className="jr-h2">Your appointments</h3>
        <Btn variant="accent" onClick={onBook} disabled={!hasAvailability}>
          <CalendarClock size={14} /> Book an appointment
        </Btn>
      </div>

      {!hasAvailability && !upcoming.length && !past.length ? (
        <div className="jr-card" style={{ padding: 28 }}>
          <div className="jr-empty">
            <div className="jr-empty-icon"><CalendarClock size={22} /></div>
            <h3 className="jr-h3">No careers appointments available yet</h3>
            <p className="jr-text-sm" style={{ maxWidth: 420 }}>
              Your university hasn't opened any careers appointment slots in JOB.READY yet, or
              you're not linked to a participating careers team. Check back soon.
            </p>
          </div>
        </div>
      ) : (
        <>
          {upcoming.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
              {upcoming.map((a) => <AppointmentCard key={a.id} a={a} onCancel={onCancel} cancelBusy={cancelBusy} />)}
            </div>
          ) : (
            <p className="jr-text-sm" style={{ marginBottom: 24 }}>
              You have no upcoming appointments.{hasAvailability ? " Use “Book an appointment” to arrange one." : ""}
            </p>
          )}

          {past.length ? (
            <>
              <h3 className="jr-h3" style={{ marginBottom: 10 }}>Past &amp; cancelled</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {past.map((a) => <AppointmentCard key={a.id} a={a} onCancel={onCancel} cancelBusy={cancelBusy} />)}
              </div>
            </>
          ) : null}
        </>
      )}
    </>
  );
}

function Stepper({ step }) {
  return (
    <div className="flex items-center gap-2" style={{ marginBottom: 20, flexWrap: "wrap" }}>
      {BOOKING_STEPS.map((s, i) => {
        const active = s === step;
        const done = BOOKING_STEPS.indexOf(step) > i;
        return (
          <span key={s} className="flex items-center gap-2">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700,
              color: active ? "var(--navy)" : done ? "var(--good)" : "var(--text-faint)" }}>
              <span style={{ width: 18, height: 18, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, background: active ? "var(--navy)" : done ? "var(--good)" : "var(--track)", color: active || done ? "#fff" : "var(--text-faint)" }}>
                {done ? <Check size={11} /> : i + 1}
              </span>
              {STEP_LABELS[s]}
            </span>
            {i < BOOKING_STEPS.length - 1 ? <span style={{ color: "var(--text-faint)" }}>›</span> : null}
          </span>
        );
      })}
    </div>
  );
}

function BookingWizard({ step, draft, setDraft, types, slots, applications, stepError, booking, onNext, onBack, onConfirm }) {
  const typeSlots = useMemo(() => slotsForType(slots, draft.typeKey), [slots, draft.typeKey]);
  const dayGroups = useMemo(() => groupSlotsByDay(typeSlots), [typeSlots]);
  const chosenSlot = slots.find((s) => s.slot_id === draft.slotId) || null;
  const chosenType = types.find((t) => t.key === draft.typeKey) || null;
  const chosenApp = applications.find((a) => a.id === draft.applicationId) || null;

  return (
    <div className="jr-card" style={{ padding: 22 }}>
      <Stepper step={step} />
      {stepError ? <div className="jr-alert jr-alert-error" style={{ marginBottom: 14 }}>{stepError}</div> : null}

      {step === "type" && (
        <div>
          <h3 className="jr-h3" style={{ marginBottom: 12 }}>What do you need help with?</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {types.map((t) => (
              <label key={t.key} className="jr-card-interactive" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px",
                border: `1.5px solid ${draft.typeKey === t.key ? "var(--blue)" : "var(--border)"}`, borderRadius: "var(--r-sm)", cursor: "pointer" }}>
                <input type="radio" name="apptype" checked={draft.typeKey === t.key}
                  onChange={() => setDraft({ ...draft, typeKey: t.key, typeId: t.id, slotId: null })} style={{ marginTop: 3 }} />
                <span>
                  <span style={{ display: "block", fontWeight: 700, color: "var(--navy)", fontSize: 13.5 }}>{t.label}</span>
                  {t.description ? <span className="jr-text-sm">{t.description}</span> : null}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {step === "slot" && (
        <div>
          <h3 className="jr-h3" style={{ marginBottom: 12 }}>Choose a time</h3>
          {!typeSlots.length ? (
            <p className="jr-text-sm">No open slots for this appointment type right now. Go back and pick another type, or check again later.</p>
          ) : dayGroups.map((g) => (
            <div key={g.key} style={{ marginBottom: 16 }}>
              <div className="jr-meta" style={{ marginBottom: 8 }}>{g.label}</div>
              <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                {g.slots.map((s) => (
                  <button key={s.slot_id} onClick={() => setDraft({ ...draft, slotId: s.slot_id })}
                    className="jr-btn" style={{ fontSize: 12.5, fontWeight: 700, padding: "8px 12px", borderRadius: "var(--r-sm)",
                      border: `1.5px solid ${draft.slotId === s.slot_id ? "var(--blue)" : "var(--border)"}`,
                      background: draft.slotId === s.slot_id ? "var(--highlight)" : "#fff", color: "var(--navy)", cursor: "pointer" }}>
                    {fmtTimeRange(s.starts_at, s.ends_at)}{s.staff_name ? ` · ${s.staff_name}` : ""}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {step === "details" && (
        <div>
          <h3 className="jr-h3" style={{ marginBottom: 12 }}>Add context (optional)</h3>
          {applications.length ? (
            <label style={{ display: "block", marginBottom: 14 }}>
              <span className="jr-label">Is this about a specific application?</span>
              <select className="jr-input jr-select" value={draft.applicationId}
                onChange={(e) => setDraft({ ...draft, applicationId: e.target.value })}>
                <option value="">Not about a specific application</option>
                {applications.map((a) => (
                  <option key={a.id} value={a.id}>{[a.company, a.role].filter(Boolean).join(" — ") || "Untitled application"}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label style={{ display: "block" }}>
            <span className="jr-label">Anything the adviser should know?</span>
            <textarea className="jr-input jr-textarea" rows={4} maxLength={2000} value={draft.comment}
              onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
              placeholder={"e.g. I have an upcoming Goldman Sachs interview and want help with commercial awareness."} />
          </label>
          <p className="jr-text-sm" style={{ marginTop: 8 }}>This is shared with your careers team so they can prepare. You can leave it blank.</p>
        </div>
      )}

      {step === "review" && (
        <div>
          <h3 className="jr-h3" style={{ marginBottom: 12 }}>Confirm your appointment</h3>
          <ReviewRow label="Type" value={chosenType?.label || "—"} />
          <ReviewRow label="When" value={chosenSlot ? `${fmtDayLong(chosenSlot.starts_at)} · ${fmtTimeRange(chosenSlot.starts_at, chosenSlot.ends_at)}` : "—"} />
          <ReviewRow label="Careers team" value={chosenSlot?.staff_name || chosenSlot?.institution_name || "Your university careers team"} />
          <ReviewRow label="Application" value={chosenApp ? [chosenApp.company, chosenApp.role].filter(Boolean).join(" — ") : "Not linked"} />
          <ReviewRow label="Your note" value={draft.comment?.trim() || "— (none)"} />
        </div>
      )}

      <div className="flex items-center gap-2" style={{ justifyContent: "space-between", marginTop: 22 }}>
        <Btn onClick={onBack}><ArrowLeft size={13} /> Back</Btn>
        {step === "review"
          ? <Btn variant="accent" onClick={onConfirm} disabled={booking}>{booking ? "Booking…" : "Book appointment"} <Check size={14} /></Btn>
          : <Btn variant="primary" onClick={onNext}>Continue <ArrowRight size={13} /></Btn>}
      </div>
    </div>
  );
}
function ReviewRow({ label, value }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <span className="jr-meta" style={{ flex: "0 0 120px" }}>{label}</span>
      <span style={{ fontSize: 13.5, color: "var(--navy)", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function ConfirmationView({ appt, onDone }) {
  return (
    <div className="jr-card" style={{ padding: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span className="jr-icon-badge jr-ib-good"><Check size={16} /></span>
        <h3 className="jr-h2">Appointment booked</h3>
      </div>
      {appt ? (
        <>
          <ReviewRow label="Type" value={appt.type_label} />
          <ReviewRow label="When" value={appt.starts_at ? `${fmtDayLong(appt.starts_at)} · ${fmtTimeRange(appt.starts_at, appt.ends_at)}` : "—"} />
          <ReviewRow label="Careers team" value={appt.staff_name || appt.institution_name || "Your university careers team"} />
          <ReviewRow label="Application" value={appt.application ? [appt.application.company, appt.application.role].filter(Boolean).join(" — ") : "Not linked"} />
          <ReviewRow label="Your note" value={appt.student_comment || "— (none)"} />
          <ReviewRow label="Status" value={studentStatusMeta(appt.status).label} />
        </>
      ) : <p className="jr-text-sm">Your appointment is booked. It'll show in “Your appointments”.</p>}
      <p className="jr-text-sm" style={{ marginTop: 14 }}>
        Your careers team can now see this and will prepare using your JOB.READY practice history. You can cancel any time before the appointment.
      </p>
      <div style={{ marginTop: 16 }}><Btn variant="primary" onClick={onDone}>Done</Btn></div>
    </div>
  );
}
