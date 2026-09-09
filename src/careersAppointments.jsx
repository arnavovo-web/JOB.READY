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
  Building2, User, Briefcase, Mail, BellRing, TrendingUp, TrendingDown, Minus, BookOpen, Target,
} from "lucide-react";
import { getSupabase } from "./institutional/supabaseClient.js";
import { dimensionLabel } from "./institutional/taxonomy.js";
import {
  BOOKING_STEPS, canAdvance, bookingArgs, slotsForType, groupSlotsByDay,
  splitAppointments, canCancel, canRespondToInvite, studentStatusMeta,
  fmtDayLong, fmtTime, fmtTimeRange, fmtDateTime, fmtRelative, unreadCount,
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
  const [messages, setMessages] = useState([]);
  const [development, setDevelopment] = useState(null);
  const [respondBusy, setRespondBusy] = useState("");

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
      const [t, av, m, msg, dev] = await Promise.all([
        rpc("list_appointment_types"),
        rpc("list_careers_availability"),
        rpc("list_my_appointments"),
        rpc("list_my_careers_messages"),
        rpc("eki_my_development").catch(() => null),
      ]);
      // de-dupe types by key (an institution's own label wins over the global)
      const byKey = new Map();
      for (const x of Array.isArray(t) ? t : []) {
        if (!byKey.has(x.key) || x.institution_id) byKey.set(x.key, x);
      }
      setTypes([...byKey.values()].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
      setSlots(Array.isArray(av) ? av : []);
      setMine(Array.isArray(m) ? m : []);
      setMessages(Array.isArray(msg) ? msg : []);
      setDevelopment(dev && typeof dev === "object" ? dev : null);
      setPhase("ready");
    } catch (e) {
      setError(e.message || "Couldn't load careers appointments.");
      setPhase("error");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { invitations, upcoming, past } = useMemo(() => splitAppointments(mine), [mine]);
  const hasAvailability = slots.length > 0;

  async function respondToInvite(id, accept) {
    setRespondBusy(id);
    try {
      await rpc("respond_to_appointment_invitation", { p_appointment_id: id, p_accept: accept });
      const m = await rpc("list_my_appointments");
      setMine(Array.isArray(m) ? m : []);
    } catch (e) { setError(e.message || "Couldn't respond to the invitation."); }
    setRespondBusy("");
  }
  async function markRead(id) {
    setMessages((prev) => prev.map((m) => (m.id === id && !m.read_at ? { ...m, read_at: new Date().toISOString() } : m)));
    try { await rpc("mark_careers_message_read", { p_message_id: id }); } catch { /* best-effort */ }
  }

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
          invitations={invitations} upcoming={upcoming} past={past} messages={messages} development={development}
          hasAvailability={hasAvailability}
          onBook={startBooking} onCancel={cancel} cancelBusy={cancelBusy}
          onRespond={respondToInvite} respondBusy={respondBusy} onMarkRead={markRead}
          error={error}
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

function ListView({ invitations, upcoming, past, messages, development, hasAvailability, onBook, onCancel, cancelBusy, onRespond, respondBusy, onMarkRead, error }) {
  const unread = unreadCount(messages);
  const nothing = !invitations.length && !upcoming.length && !past.length && !messages.length && !hasAvailability;

  return (
    <>
      {error ? <div className="jr-alert jr-alert-error" style={{ marginBottom: 16 }}>{error}</div> : null}
      <div className="flex items-center gap-2" style={{ justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap" }}>
        <h3 className="jr-h2">Careers support</h3>
        <Btn variant="accent" onClick={onBook} disabled={!hasAvailability}>
          <CalendarClock size={14} /> Book an appointment
        </Btn>
      </div>

      {nothing ? (
        <div className="jr-card" style={{ padding: 28 }}>
          <div className="jr-empty">
            <div className="jr-empty-icon"><CalendarClock size={22} /></div>
            <h3 className="jr-h3">No careers activity yet</h3>
            <p className="jr-text-sm" style={{ maxWidth: 420 }}>
              Your university hasn't opened any careers appointment slots in JOB.READY yet, or
              you're not linked to a participating careers team. Check back soon.
            </p>
          </div>
        </div>
      ) : (
        <>
          {invitations.length ? (
            <section style={{ marginBottom: 26 }}>
              <h4 className="jr-h3" style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 7 }}>
                <BellRing size={15} /> Action needed
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {invitations.map((a) => (
                  <InvitationCard key={a.id} a={a} onRespond={onRespond} busy={respondBusy === a.id} />
                ))}
              </div>
            </section>
          ) : null}

          {messages.length ? (
            <section style={{ marginBottom: 26 }}>
              <h4 className="jr-h3" style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 7 }}>
                <Mail size={15} /> Messages{unread ? <span className="jr-badge jr-badge-info">{unread} new</span> : null}
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {messages.map((m) => <MessageCard key={m.id} m={m} onMarkRead={onMarkRead} />)}
              </div>
            </section>
          ) : null}

          <section style={{ marginBottom: 26 }}>
            <h4 className="jr-h3" style={{ marginBottom: 10 }}>Upcoming appointments</h4>
            {upcoming.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {upcoming.map((a) => <AppointmentCard key={a.id} a={a} onCancel={onCancel} cancelBusy={cancelBusy} />)}
              </div>
            ) : (
              <p className="jr-text-sm">
                You have no upcoming appointments.{hasAvailability ? " Use “Book an appointment” to arrange one." : ""}
              </p>
            )}
          </section>

          {development ? <MyDevelopment dev={development} /> : null}

          {past.length ? (
            <section>
              <h4 className="jr-h3" style={{ marginBottom: 10 }}>Previous support</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {past.map((a) => <AppointmentCard key={a.id} a={a} onCancel={onCancel} cancelBusy={cancelBusy} />)}
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

const TRAJ_STUDENT = {
  improving: "You're improving with practice.",
  stable: "Your practice scores are broadly stable.",
  plateauing: "Your recent scores have levelled off — a new focus could help.",
  declining: "Your recent scores have dipped a little.",
  insufficient_data: "Do a few more practice interviews to see your trajectory.",
};

function MyDevelopment({ dev }) {
  const traj = dev.trajectory || {};
  const ev = dev.dna_evolution || {};
  const plan = dev.development_plan || null;
  const resources = dev.recommended_resources || [];
  const cardBase = { padding: 14, display: "flex", flexDirection: "column", gap: 6 };

  return (
    <section style={{ marginBottom: 26 }}>
      <h4 className="jr-h3" style={{ marginBottom: 10 }}>My development</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

        <div className="jr-card" style={cardBase}>
          <span style={{ fontWeight: 800, color: "var(--navy)", fontSize: 13 }}>My trajectory</span>
          <p className="jr-text-sm" style={{ margin: 0 }}>{TRAJ_STUDENT[traj.classification] || TRAJ_STUDENT.insufficient_data}</p>
          {(traj.series || []).length >= 2 ? (
            <p className="jr-text-sm" style={{ margin: 0, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
              Overall readiness: {traj.series.join(" → ")}
            </p>
          ) : null}
        </div>

        {ev.has_data ? (
          <div className="jr-card" style={cardBase}>
            <span style={{ fontWeight: 800, color: "var(--navy)", fontSize: 13 }}>How my Interview DNA has changed</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
              {(ev.dimensions || []).map((d) => {
                const up = (d.delta ?? 0) > 0, down = (d.delta ?? 0) < 0;
                return (
                  <div key={d.key} className="jr-text-sm" style={{ display: "flex", justifyContent: "space-between", fontVariantNumeric: "tabular-nums" }}>
                    <span>{dimensionLabel(d.key)}</span>
                    <span style={{ color: up ? "var(--good)" : down ? "var(--bad)" : "var(--text-faint)" }}>
                      {d.earliest} → {d.latest} {up ? <TrendingUp size={11} /> : down ? <TrendingDown size={11} /> : <Minus size={11} />}
                      {" "}{up ? "+" : down ? "−" : ""}{Math.abs(Math.round(d.delta ?? 0))}
                    </span>
                  </div>
                );
              })}
            </div>
            {ev.strongest_improvement ? (
              <p className="jr-text-sm" style={{ margin: "4px 0 0", color: "var(--text-dim)" }}>
                <TrendingUp size={12} /> Biggest gain: <strong>{dimensionLabel(ev.strongest_improvement)}</strong>
                {ev.persistent_weakness ? <> · <Target size={12} /> keep working on <strong>{dimensionLabel(ev.persistent_weakness)}</strong></> : null}
              </p>
            ) : null}
          </div>
        ) : null}

        {plan ? (
          <div className="jr-card" style={cardBase}>
            <span style={{ fontWeight: 800, color: "var(--navy)", fontSize: 13 }}>My development plan</span>
            <span style={{ fontWeight: 700, color: "var(--navy)", fontSize: 13 }}>{plan.title}</span>
            {plan.description ? <p className="jr-text-sm" style={{ margin: 0, color: "var(--text-dim)" }}>{plan.description}</p> : null}
            <p className="jr-text-sm" style={{ margin: 0, color: "var(--text-faint)" }}>
              {plan.development_area ? `Priority: ${dimensionLabel(plan.development_area)}. ` : ""}
              {plan.goal_target != null ? `Target: move toward ${plan.goal_target}. ` : ""}
              Status: {plan.status === "completed" ? "Completed" : plan.status === "in_progress" ? "In progress" : "Not started"}.
            </p>
            {(plan.items || []).length ? (
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {plan.items.map((it) => (
                  <li key={it.id} className="jr-text-sm" style={{ color: it.status === "done" ? "var(--text-faint)" : "var(--navy)", textDecoration: it.status === "done" ? "line-through" : "none" }}>
                    {it.label}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {resources.length ? (
          <div className="jr-card" style={cardBase}>
            <span style={{ fontWeight: 800, color: "var(--navy)", fontSize: 13 }}>Recommended for you</span>
            {resources[0]?.competency ? (
              <p className="jr-text-sm" style={{ margin: 0, color: "var(--text-dim)" }}>
                Your biggest current development area is <strong>{dimensionLabel(resources[0].competency)}</strong>. Try:
              </p>
            ) : null}
            {resources.slice(0, 3).map((r) => (
              <div key={r.id} className="jr-text-sm" style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                <BookOpen size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                <span><strong>{r.title}</strong>{r.duration_minutes ? ` · ${r.duration_minutes} min` : ""}
                  {r.description ? <span style={{ color: "var(--text-dim)" }}> — {r.description}</span> : null}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function InvitationCard({ a, onRespond, busy }) {
  return (
    <div className="jr-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 9, borderColor: "var(--blue)" }}>
      <div className="flex items-center gap-2" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 800, color: "var(--navy)", fontSize: 14 }}>Careers appointment invitation</span>
        <span className="jr-badge jr-badge-info">Invitation</span>
      </div>
      <div style={{ fontWeight: 700, color: "var(--navy)", fontSize: 13.5 }}>{a.type_label}</div>
      <div className="jr-text-sm" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Clock size={13} /> {a.starts_at ? `${fmtDateTime(a.starts_at)}${a.ends_at ? `–${fmtTime(a.ends_at)}` : ""}` : "Time to be confirmed"}
      </div>
      {a.institution_name ? (
        <div className="jr-text-sm" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Building2 size={13} /> {a.institution_name}{a.invited_by_name ? ` · ${a.invited_by_name}` : ""}
        </div>
      ) : null}
      {a.invite_message ? (
        <div style={{ display: "flex", gap: 7, alignItems: "flex-start", background: "var(--surface-sunken)", borderRadius: "var(--r-sm)", padding: "9px 11px", fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
          <MessageSquareText size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span><strong style={{ color: "var(--navy)" }}>Reason from your careers team:</strong> {a.invite_message}</span>
        </div>
      ) : null}
      <div className="flex items-center gap-2" style={{ marginTop: 2 }}>
        <Btn variant="accent" onClick={() => onRespond(a.id, true)} disabled={busy} style={{ fontSize: 12.5, padding: "7px 13px" }}>
          <Check size={13} /> {busy ? "…" : "Accept"}
        </Btn>
        <Btn onClick={() => onRespond(a.id, false)} disabled={busy} style={{ fontSize: 12.5, padding: "7px 13px" }}>
          <X size={12} /> Decline
        </Btn>
      </div>
    </div>
  );
}

function MessageCard({ m, onMarkRead }) {
  const unread = !m.read_at;
  return (
    <div className="jr-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6, background: unread ? "var(--highlight)" : "#fff" }}
      onClick={() => unread && onMarkRead(m.id)}>
      <div className="flex items-center gap-2" style={{ justifyContent: "space-between" }}>
        <span style={{ fontWeight: 700, color: "var(--navy)", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          {unread ? <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--blue)", display: "inline-block" }} /> : null}
          {m.sender_name || "Careers Team"}{m.institution_name ? ` · ${m.institution_name}` : ""}
        </span>
        <span className="jr-text-sm" style={{ color: "var(--text-faint)" }}>{fmtRelative(m.created_at)}</span>
      </div>
      <p className="jr-text-sm" style={{ margin: 0, lineHeight: 1.5, color: "var(--text-dim)" }}>{m.body}</p>
      {m.related_appointment ? (
        <div className="jr-text-sm" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-faint)" }}>
          <CalendarClock size={12} /> Related: {m.related_appointment.type_label}
          {m.related_appointment.starts_at ? ` · ${fmtDateTime(m.related_appointment.starts_at)}` : ""}
        </div>
      ) : null}
    </div>
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
