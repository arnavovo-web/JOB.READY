/* ================================================================== *
 * EKI² — Performance → intervention workflow
 * ------------------------------------------------------------------
 *   readiness distribution  ->  drill into a group  ->  authorised
 *   student roster  ->  open profile / arrange support / message.
 *
 * The distribution is aggregate analytics and stays k-anonymised
 * (hidden when fewer than MIN_COHORT_N students are assessed). The
 * roster is the AUTHORISED individual-identification workflow — it is
 * only reachable by a deliberate drill-in and only returns students of
 * the caller's own institution (server-enforced in eki_readiness_roster).
 * Presentation only; classes come from theme.js (.ii-*).
 * ================================================================== */
import React, { useEffect, useMemo, useState } from "react";
import {
  Users, ArrowRight, ArrowLeft, X, CalendarPlus, MessageSquareText, Check,
  ChevronRight, Lock,
} from "lucide-react";
import { MIN_COHORT_N, READINESS_GROUPS, readinessGroupMeta, dimensionLabel } from "./taxonomy.js";
import { readinessRecommendation } from "./present.js";
import * as api from "./api.js";
import { Btn, Card, SectionTitle, Alert, Spinner, EmptyState } from "./ui.jsx";
import { SuggestedAction } from "./disclosure.jsx";

const TONE_VAR = { good: "var(--ii-good)", warn: "var(--ii-warn)", bad: "var(--ii-bad)", neutral: "var(--ii-text-faint)" };

/* =================================================================
 * 1 — the readiness distribution (primary answer on Performance)
 * ================================================================= */
export function ReadinessDistribution({ roster, onOpenGroup }) {
  const dist = roster?.distribution;
  const assessed = dist?.assessed ?? 0;
  const groups = dist?.groups || [];
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));

  if (!dist || dist.suppressed || !assessed) {
    return (
      <Card className="ii-section">
        <div className="ii-empty">
          <div className="ii-empty-icon"><Lock size={22} /></div>
          <h3 className="ii-h3">Not enough students assessed to show a readiness breakdown</h3>
          <p className="ii-text-sm" style={{ maxWidth: 460 }}>
            A readiness distribution needs at least {MIN_COHORT_N} students with completed practice
            interviews in the selected scope{assessed ? ` — currently ${assessed}` : ""}. This protects
            individual students. Widen the date range or select more cohorts.
          </p>
        </div>
      </Card>
    );
  }

  const rec = readinessRecommendation(dist);

  return (
    <div className="ii-section">
      <div className="ii-readbar">
        {READINESS_GROUPS.map((g) => {
          const row = byKey[g.key] || { count: 0, pct: 0 };
          if (!row.count) return null;
          return (
            <span key={g.key} className="ii-readbar-seg" title={`${g.label}: ${row.count} (${row.pct}%)`}
              style={{ width: `${row.pct}%`, background: TONE_VAR[g.tone] }} />
          );
        })}
      </div>

      <div className="ii-readcards">
        {READINESS_GROUPS.map((g) => {
          const row = byKey[g.key] || { count: 0, pct: 0 };
          return (
            <button key={g.key} className={`ii-readcard ii-readcard-${g.tone}`} onClick={() => onOpenGroup(g.key)}>
              <span className="ii-readcard-label">{g.label}</span>
              <span className="ii-readcard-pct">{row.pct}%</span>
              <span className="ii-readcard-blurb">{g.blurb}</span>
              <span className="ii-readcard-link">{row.count} student{row.count === 1 ? "" : "s"} <ArrowRight size={12} /></span>
            </button>
          );
        })}
      </div>

      <p className="ii-text-sm ii-muted" style={{ marginTop: 4 }}>
        <Users size={12} /> {assessed} student{assessed === 1 ? "" : "s"} assessed · practice performance, not a prediction of employment outcomes
      </p>

      {rec ? (
        <section className="ii-insight" style={{ "--ii-accent": "var(--ii-blue)", marginTop: 18 }}>
          <div className="ii-insight-eyebrow">Where should we focus?</div>
          <h3 className="ii-insight-lead">{rec.headline}</h3>
          {rec.body ? <p className="ii-insight-why">{rec.body}</p> : null}
          <SuggestedAction text="Consider targeted careers support for the students who would benefit most."
            cta={{ label: rec.cta ? `${rec.cta.label} →` : null }}
            onCta={rec.cta ? () => onOpenGroup(rec.cta.group) : undefined} />
        </section>
      ) : null}
    </div>
  );
}

/* =================================================================
 * 2 — the readiness-group roster (authorised drill-in)
 * ================================================================= */
export function RosterPanel({ ctx, roster, groupKey, onBack, onOpenStudent }) {
  const meta = readinessGroupMeta(groupKey);
  const students = useMemo(
    () => (roster?.students || []).filter((s) => s.readiness === groupKey),
    [roster, groupKey]
  );
  const [selected, setSelected] = useState(() => new Set());
  const [modal, setModal] = useState(null); // 'arrange' | 'message' | null
  const [notice, setNotice] = useState("");

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const allIds = students.map((s) => s.student_id);
  const allChecked = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(allIds));

  const chosen = students.filter((s) => selected.has(s.student_id));

  return (
    <>
      <button className="ii-btn ii-btn-ghost ii-btn-sm" style={{ marginBottom: 14 }} onClick={onBack}>
        <ArrowLeft size={13} /> Back to readiness
      </button>

      <SectionTitle hint={`${students.length} student${students.length === 1 ? "" : "s"} · ${ctx.scopeLabel}`}>
        Students · {meta.label}
      </SectionTitle>
      <p className="ii-text-sm ii-muted" style={{ marginTop: -6, marginBottom: 14 }}>
        {meta.blurb} Decide who to intervene with — open a profile, arrange an appointment, or send a message.
      </p>

      {notice ? <div style={{ marginBottom: 12 }}><Alert tone="info">{notice}</Alert></div> : null}

      {!students.length ? (
        <Card><EmptyState title="No students in this group for the current scope">
          Change the cohort or date filter to see students here.
        </EmptyState></Card>
      ) : (
        <>
          <div className="ii-roster">
            <div className="ii-roster-head">
              <label className="ii-roster-check">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" />
              </label>
              <span>Student</span>
              <span>Readiness</span>
              <span>Main development area</span>
              <span>Latest practice</span>
              <span />
            </div>
            {students.map((s) => {
              const rm = readinessGroupMeta(s.readiness);
              return (
                <div key={s.student_id} className="ii-roster-row">
                  <label className="ii-roster-check">
                    <input type="checkbox" checked={selected.has(s.student_id)} onChange={() => toggle(s.student_id)}
                      aria-label={`Select ${s.name || "student"}`} />
                  </label>
                  <button className="ii-roster-name" onClick={() => onOpenStudent(s.student_id)}>
                    {s.name || "Student"} <ChevronRight size={13} />
                  </button>
                  <span className={`ii-tag ii-tag-${rm.tone === "good" ? "good" : rm.tone === "warn" ? "warn" : "bad"}`}>{rm.label}</span>
                  <span className="ii-text-sm">{s.main_development_area ? dimensionLabel(s.main_development_area) : "—"}</span>
                  <span className="ii-text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {s.latest_score ?? "—"}{s.mean_score != null ? <span className="ii-muted"> · avg {s.mean_score}</span> : null}
                  </span>
                  <span />
                </div>
              );
            })}
          </div>

          <div className="ii-roster-actions">
            <span className="ii-text-sm ii-muted">
              {chosen.length ? `${chosen.length} selected` : "Select students to act on"}
            </span>
            <span className="ii-nav-spacer" />
            <Btn size="sm" variant="ghost" disabled={chosen.length !== 1} onClick={() => setModal("arrange")}>
              <CalendarPlus size={13} /> Arrange support
            </Btn>
            <Btn size="sm" variant="primary" disabled={!chosen.length} onClick={() => setModal("message")}>
              <MessageSquareText size={13} /> Message student{chosen.length > 1 ? "s" : ""}
            </Btn>
          </div>
          <p className="ii-text-sm ii-muted" style={{ marginTop: 8 }}>
            “Arrange support” books one specific slot, so it is one student at a time. To reach several students,
            send a message asking them to book.
          </p>
        </>
      )}

      {modal === "arrange" && chosen.length === 1 ? (
        <ArrangeSupportModal ctx={ctx} student={chosen[0]}
          onClose={() => setModal(null)}
          onDone={(msg) => { setModal(null); setSelected(new Set()); setNotice(msg); }} />
      ) : null}
      {modal === "message" && chosen.length ? (
        <MessageStudentsModal ctx={ctx} students={chosen}
          onClose={() => setModal(null)}
          onDone={(msg) => { setModal(null); setSelected(new Set()); setNotice(msg); }} />
      ) : null}
    </>
  );
}

/* =================================================================
 * 3 — modals
 * ================================================================= */
function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="ii-modal-scrim" onClick={onClose}>
      <div className="ii-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="ii-modal-head">
          <h3 className="ii-h3" style={{ margin: 0 }}>{title}</h3>
          <button className="ii-modal-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="ii-modal-body">{children}</div>
        {footer ? <div className="ii-modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ArrangeSupportModal({ ctx, student, onClose, onDone }) {
  const [state, setState] = useState({ loading: true, slots: [], types: [], error: "" });
  const [typeId, setTypeId] = useState("");
  const [slotId, setSlotId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let dead = false;
    Promise.all([
      api.listMySlots(ctx.institutionId, ctx.userId),
      api.listInstitutionAppointmentTypes(ctx.institutionId),
    ])
      .then(([slots, types]) => { if (!dead) setState({ loading: false, slots, types, error: "" }); })
      .catch((e) => { if (!dead) setState({ loading: false, slots: [], types: [], error: e.message || "Couldn't load your availability." }); });
    return () => { dead = true; };
  }, [ctx.institutionId, ctx.userId]);

  const now = Date.now();
  const openSlots = (state.slots || [])
    .filter((s) => s.status === "open" && new Date(s.starts_at).getTime() > now)
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));

  async function send() {
    if (!slotId) { setErr("Choose one of your open slots."); return; }
    setBusy(true); setErr("");
    try {
      const res = await api.inviteToAppointment({
        slotId, studentId: student.student_id,
        appointmentTypeId: typeId || null,
        message: message.trim() || null,
      });
      if (!res?.ok) {
        setErr(res?.reason === "slot_taken" ? "That slot was just taken. Pick another."
          : res?.reason === "slot_past" ? "That slot is in the past."
          : res?.reason === "invalid_type" ? "That appointment type isn't available."
          : "Couldn't send the invitation.");
        setBusy(false);
        return;
      }
      onDone(`Invitation sent to ${student.name || "the student"}. They'll see it in JOB.READY Careers Support.`);
    } catch (e) {
      setErr(e.message || "Couldn't send the invitation.");
      setBusy(false);
    }
  }

  return (
    <Modal title={`Arrange support · ${student.name || "student"}`} onClose={onClose}
      footer={
        <>
          <Btn size="sm" variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn size="sm" variant="accent" disabled={busy || state.loading} onClick={send}>
            {busy ? "Sending…" : <>Send invitation <Check size={13} /></>}
          </Btn>
        </>
      }>
      {state.loading ? <Spinner label="Loading your availability…" /> : state.error ? <Alert tone="error">{state.error}</Alert> : (
        <>
          {err ? <div style={{ marginBottom: 12 }}><Alert tone="error">{err}</Alert></div> : null}
          <label className="ii-field">
            <span className="ii-label">Appointment type</span>
            <select className="ii-input ii-select" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">Any type</option>
              {state.types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="ii-field">
            <span className="ii-label">Your open slots</span>
            {!openSlots.length ? (
              <p className="ii-text-sm ii-muted">
                You have no open future slots. Publish availability under <strong>Appointments → My availability</strong> first.
              </p>
            ) : (
              <select className="ii-input ii-select" value={slotId} onChange={(e) => setSlotId(e.target.value)}>
                <option value="">Choose a slot…</option>
                {openSlots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {new Date(s.starts_at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="ii-field">
            <span className="ii-label">Reason for the student (shown to them)</span>
            <textarea className="ii-input" rows={3} maxLength={2000} value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. We'd like to help you strengthen your evidence-based interview answers." />
          </label>
          <p className="ii-text-sm ii-muted">
            This creates a normal appointment the student can accept or decline in JOB.READY. It is not an adviser note.
          </p>
        </>
      )}
    </Modal>
  );
}

export function MessageStudentsModal({ ctx, students, onClose, onDone }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    const text = body.trim();
    if (!text) { setErr("Write a short message."); return; }
    setBusy(true); setErr("");
    try {
      let ok = 0;
      for (const s of students) {
        const res = await api.sendCareersMessage({ institutionId: ctx.institutionId, studentId: s.student_id, body: text });
        if (res?.ok) ok += 1;
      }
      onDone(`Message sent to ${ok} student${ok === 1 ? "" : "s"}. They'll see it in JOB.READY Careers Support.`);
    } catch (e) {
      setErr(e.message || "Couldn't send the message.");
      setBusy(false);
    }
  }

  return (
    <Modal title={students.length === 1 ? `Message ${students[0].name || "student"}` : `Message ${students.length} students`}
      onClose={onClose}
      footer={
        <>
          <Btn size="sm" variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn size="sm" variant="primary" disabled={busy} onClick={send}>{busy ? "Sending…" : <>Send <Check size={13} /></>}</Btn>
        </>
      }>
      {err ? <div style={{ marginBottom: 12 }}><Alert tone="error">{err}</Alert></div> : null}
      <label className="ii-field">
        <span className="ii-label">Message</span>
        <textarea className="ii-input" rows={5} maxLength={4000} value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="e.g. We noticed you may benefit from some extra interview practice. Please book a careers appointment when you can." />
      </label>
      <p className="ii-text-sm ii-muted">
        The student sees this in Careers Support. They never see analytics, adviser notes, or other students —
        just this message.
      </p>
    </Modal>
  );
}
