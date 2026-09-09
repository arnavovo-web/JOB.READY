/* ================================================================== *
 * EKI² — intelligence-platform UI blocks
 * ------------------------------------------------------------------
 * All deterministic except <BriefMe/>, which shows the deterministic
 * briefing instantly and only calls the (optional) AI layer on request.
 * Presentation only; classes from theme.js (.ii-*).
 * ================================================================== */
import React, { useMemo, useState } from "react";
import {
  TrendingUp, TrendingDown, Minus, ArrowRight, ArrowLeft, Users, Lock,
  Sparkles, CheckCircle2, Clock, BookOpen, Target, RefreshCw, ChevronRight,
} from "lucide-react";
import { MIN_COHORT_N, dimensionLabel } from "./taxonomy.js";
import { trajectoryMeta, trajectoryLine, dnaEvolutionLine } from "./trajectory.js";
import { planStatusMeta, itemKindLabel, suggestPlan, planToRpcArgs } from "./developmentPlan.js";
import { deterministicBriefing } from "./briefing.js";
import { programmeIntelligence } from "./programmes.js";
import { plainDimension } from "./present.js";
import * as api from "./api.js";
import { Btn, Card, SectionTitle, Alert, Spinner, EmptyState, Field } from "./ui.jsx";
import { SuggestedAction } from "./disclosure.jsx";
import { ArrangeSupportModal, MessageStudentsModal } from "./intervention.jsx";

const TONE = { good: "var(--ii-good)", warn: "var(--ii-warn)", bad: "var(--ii-bad)", neutral: "var(--ii-text-faint)" };
const dayLabel = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");

/* =================================================================
 * Trajectory — "Where is this student going?"
 * ================================================================= */
export function TrajectoryBlock({ trajectory, compact }) {
  const t = trajectory;
  if (!t || t.classification === "insufficient_data" || !(t.series || []).length) {
    return <p className="ii-text-sm ii-muted">Not enough completed practice yet to show a trajectory.</p>;
  }
  const m = trajectoryMeta(t.classification);
  const s = t.series;
  const min = Math.min(...s), max = Math.max(...s), span = Math.max(1, max - min);
  const pts = s.map((v, i) => `${(i / (s.length - 1)) * 100},${28 - ((v - min) / span) * 24 - 2}`).join(" ");
  return (
    <div className={compact ? "" : "ii-section"}>
      <div className="ii-spread" style={{ alignItems: "flex-end", gap: 12 }}>
        <div>
          <div className={`ii-verdict-word ii-verdict-${m.tone === "good" ? "good" : m.tone === "warn" ? "warn" : m.tone === "bad" ? "bad" : "warn"}`}
            style={{ fontSize: 24 }}>{m.label}</div>
          <p className="ii-text-sm ii-muted" style={{ margin: "4px 0 0" }}>{trajectoryLine(t)}</p>
        </div>
        <svg viewBox="0 0 100 28" preserveAspectRatio="none" style={{ width: 160, height: 40, flexShrink: 0 }}>
          <polyline points={pts} fill="none" stroke={TONE[m.tone] || TONE.warn} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      {!compact ? (
        <p className="ii-text-sm ii-muted" style={{ marginTop: 8, fontVariantNumeric: "tabular-nums" }}>
          Overall readiness: {s.join(" → ")}
        </p>
      ) : null}
    </div>
  );
}

/* =================================================================
 * Interview DNA evolution — "How has this student's profile changed?"
 * ================================================================= */
export function DnaEvolutionBlock({ evolution }) {
  const ev = evolution;
  if (!ev || !ev.hasData || !(ev.dimensions || []).length) {
    return <p className="ii-text-sm ii-muted">Interview DNA evolution needs at least two completed interviews.</p>;
  }
  const line = dnaEvolutionLine(ev);
  return (
    <div>
      {line ? <p className="ii-insight-figure" style={{ marginBottom: 12 }}>{line}</p> : null}
      <div className="ii-bars">
        {ev.dimensions.map((d) => {
          const up = (d.delta ?? 0) > 0, down = (d.delta ?? 0) < 0;
          return (
            <div className="ii-bar-track" key={d.key} style={{ marginBottom: 10 }}>
              <span className="ii-bar-label" title={d.label}>{d.label}</span>
              <span className="ii-bar-wrap ii-text-sm" style={{ fontVariantNumeric: "tabular-nums", color: "var(--ii-text-dim)" }}>
                {d.earliest} → <strong style={{ color: "var(--ii-navy)" }}>{d.latest}</strong>
              </span>
              <span className="ii-bar-tail">
                <span className={`ii-delta ii-delta-${up ? "good" : down ? "bad" : "neutral"}`}>
                  {up ? <TrendingUp size={11} /> : down ? <TrendingDown size={11} /> : <Minus size={11} />}
                  {up ? "+" : down ? "−" : ""}{Math.abs(Math.round(d.delta ?? 0))}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="ii-grid ii-grid-2" style={{ gap: 12, marginTop: 12 }}>
        {ev.strongestImprovement ? (
          <p className="ii-text-sm"><TrendingUp size={12} style={{ color: "var(--ii-good)" }} /> Strongest improvement: <strong>{dimensionLabel(ev.strongestImprovement)}</strong></p>
        ) : null}
        {ev.persistentWeakness ? (
          <p className="ii-text-sm"><Target size={12} style={{ color: "var(--ii-bad)" }} /> Persistent gap: <strong>{dimensionLabel(ev.persistentWeakness)}</strong></p>
        ) : null}
      </div>
    </div>
  );
}

/* =================================================================
 * Resource list
 * ================================================================= */
export function ResourceList({ resources, heading, note }) {
  if (!resources || !resources.length) {
    return <p className="ii-text-sm ii-muted">{note || "No matching resources yet."}</p>;
  }
  return (
    <div>
      {heading ? <SectionTitle>{heading}</SectionTitle> : null}
      {note ? <p className="ii-text-sm ii-muted" style={{ marginTop: -4, marginBottom: 10 }}>{note}</p> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {resources.map((r) => (
          <div key={r.id} className="ii-insight" style={{ "--ii-accent": "var(--ii-blue)", padding: "12px 16px", marginBottom: 0 }}>
            <div className="ii-spread">
              <strong className="ii-text-sm" style={{ color: "var(--ii-navy)" }}><BookOpen size={12} /> {r.title}</strong>
              <span className="ii-text-sm ii-muted">
                {r.competency ? dimensionLabel(r.competency) : "General"}{r.durationMinutes ? ` · ${r.durationMinutes} min` : ""}
              </span>
            </div>
            {r.description ? <p className="ii-text-sm ii-muted" style={{ margin: "4px 0 0" }}>{r.description}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* =================================================================
 * Intelligence queues — No Contact Yet / Stuck Students
 * ================================================================= */
function QueueTable({ students, extraCol, onOpenStudent, selected, onToggle }) {
  return (
    <div className="ii-roster">
      <div className="ii-roster-head">
        {onToggle ? <span className="ii-roster-check" /> : null}
        <span>Student</span>
        <span>Readiness</span>
        <span>{extraCol.label}</span>
        <span>Latest / trajectory</span>
        <span />
      </div>
      {students.map((s) => {
        const tm = trajectoryMeta(s.trajectory);
        return (
          <div key={s.student_id} className="ii-roster-row">
            {onToggle ? (
              <label className="ii-roster-check">
                <input type="checkbox" checked={selected.has(s.student_id)} onChange={() => onToggle(s.student_id)} aria-label={`Select ${s.name || "student"}`} />
              </label>
            ) : null}
            <button className="ii-roster-name" onClick={() => onOpenStudent(s.student_id)}>{s.name || "Student"} <ChevronRight size={13} /></button>
            <span className={`ii-tag ii-tag-${s.readiness_group === "ready" ? "good" : s.readiness_group === "developing" ? "warn" : "bad"}`}>
              {s.readiness_group === "ready" ? "Interview-ready" : s.readiness_group === "developing" ? "Developing" : "Needs support"}
            </span>
            <span className="ii-text-sm">{extraCol.render(s)}</span>
            <span className="ii-text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
              {s.latest_score ?? "—"} <span className={`ii-tag ii-tag-${tm.tone === "good" ? "good" : tm.tone === "bad" ? "bad" : "warn"}`}>{tm.label}</span>
            </span>
            <span />
          </div>
        );
      })}
    </div>
  );
}

export function InterventionQueuePanel({ ctx, kind, students, onBack, onOpenStudent }) {
  const isStuck = kind === "stuck";
  const list = useMemo(
    () => (students || []).filter((s) => (isStuck ? s.is_stuck : s.no_prior_contact)),
    [students, isStuck]
  );
  const [selected, setSelected] = useState(() => new Set());
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");
  const toggle = (id) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const chosen = list
    .filter((s) => selected.has(s.student_id))
    .map((s) => ({ student_id: s.student_id, name: s.name, readiness: s.readiness_group }));

  const extraCol = isStuck
    ? { label: "Repeated weak area", render: (s) => (s.main_development_area ? dimensionLabel(s.main_development_area) : "—") }
    : { label: "Gap from target", render: (s) => `${s.gap_from_target ?? "—"} pts · ${s.n_interviews} interviews` };

  return (
    <>
      {onBack ? (
        <button className="ii-btn ii-btn-ghost ii-btn-sm" style={{ marginBottom: 14 }} onClick={onBack}>
          <ArrowLeft size={13} /> Back
        </button>
      ) : null}
      <SectionTitle hint={`${list.length} student${list.length === 1 ? "" : "s"} · ${ctx.scopeLabel}`}>
        {isStuck ? "Stuck students" : "No contact yet"}
      </SectionTitle>
      <p className="ii-text-sm ii-muted" style={{ marginTop: -6, marginBottom: 14 }}>
        {isStuck
          ? "Practising repeatedly with limited recent improvement and a persistent development area. This is not a judgement about the student — targeted support tends to help most here."
          : "Enough practice to have a picture, below the interview-ready threshold, and no recorded careers appointment or outcome yet. Prioritised by how far below target and how much they have practised."}
      </p>
      {notice ? <div style={{ marginBottom: 12 }}><Alert tone="info">{notice}</Alert></div> : null}

      {!list.length ? (
        <Card><EmptyState title={isStuck ? "No students appear stuck in this scope" : "Every student below target has had some careers contact"}>
          Change the cohort or date filter to look wider.
        </EmptyState></Card>
      ) : (
        <>
          <QueueTable students={list} extraCol={extraCol} onOpenStudent={onOpenStudent} selected={selected} onToggle={toggle} />
          <div className="ii-roster-actions">
            <span className="ii-text-sm ii-muted">{chosen.length ? `${chosen.length} selected` : "Select students to act on"}</span>
            <span className="ii-nav-spacer" />
            <Btn size="sm" variant="ghost" disabled={chosen.length !== 1} onClick={() => setModal("arrange")}>Arrange support</Btn>
            <Btn size="sm" variant="primary" disabled={!chosen.length} onClick={() => setModal("message")}>Message student{chosen.length > 1 ? "s" : ""}</Btn>
          </div>
        </>
      )}

      {modal === "arrange" && chosen.length === 1 ? (
        <ArrangeSupportModal ctx={ctx} student={chosen[0]} onClose={() => setModal(null)}
          onDone={(m) => { setModal(null); setSelected(new Set()); setNotice(m); }} />
      ) : null}
      {modal === "message" && chosen.length ? (
        <MessageStudentsModal ctx={ctx} students={chosen} onClose={() => setModal(null)}
          onDone={(m) => { setModal(null); setSelected(new Set()); setNotice(m); }} />
      ) : null}
    </>
  );
}

/* =================================================================
 * Programme Employability Pulse
 * ================================================================= */
export function ProgrammePulseGrid({ pulse }) {
  const rows = pulse || [];
  const reportable = rows.filter((p) => !p.suppressed);
  if (!reportable.length) {
    return (
      <Card className="ii-section"><div className="ii-empty">
        <div className="ii-empty-icon"><Lock size={22} /></div>
        <h3 className="ii-h3">No programme has enough students to report on yet</h3>
        <p className="ii-text-sm" style={{ maxWidth: 460 }}>
          A programme needs at least {MIN_COHORT_N} assessed students before EKI² shows its pulse.
          {rows.length ? ` ${rows.length} programme(s) are below that threshold.` : ""}
        </p>
      </div></Card>
    );
  }
  return (
    <div className="ii-section" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {reportable.map((p) => (
        <div key={p.cohort_id} className="ii-insight" style={{ "--ii-accent": p.mean_readiness >= 70 ? "var(--ii-good)" : p.mean_readiness >= 55 ? "var(--ii-warn)" : "var(--ii-bad)", marginBottom: 0 }}>
          <div className="ii-spread">
            <h3 className="ii-insight-lead" style={{ fontSize: 15 }}>{p.name}</h3>
            <span className="ii-text-sm ii-muted">{p.assessed} assessed · mean {p.mean_readiness}</span>
          </div>
          <div className="ii-readbar" style={{ marginTop: 10, marginBottom: 8, height: 12 }}>
            <span className="ii-readbar-seg" style={{ width: `${p.pct_ready}%`, background: "var(--ii-good)" }} />
            <span className="ii-readbar-seg" style={{ width: `${p.pct_developing}%`, background: "var(--ii-warn)" }} />
            <span className="ii-readbar-seg" style={{ width: `${p.pct_needs}%`, background: "var(--ii-bad)" }} />
          </div>
          <p className="ii-text-sm ii-muted">
            {p.pct_ready}% interview-ready · {p.pct_developing}% developing · {p.pct_needs}% need support ·
            {" "}{p.careers_engagement_pct}% engaged with careers support
          </p>
          {p.weakest_competency ? (
            <p className="ii-insight-why" style={{ marginTop: 6 }}>
              Recurring development gap: <strong>{dimensionLabel(p.weakest_competency)}</strong>
              {p.weakest_competency_below_target_pct != null ? ` — ${p.weakest_competency_below_target_pct}% below target` : ""}.
              Strongest: {dimensionLabel(p.strongest_competency)}.
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* =================================================================
 * Programme-level intelligence — the "so what?" list
 * ================================================================= */
export function ProgrammeIntelligenceList({ env, onCta }) {
  const items = useMemo(() => programmeIntelligence(env), [env]);
  if (!items.length) {
    return <p className="ii-text-sm ii-muted">Nothing needs the careers team's attention at programme level right now.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {items.map((it, i) => (
        <section key={i} className="ii-insight" style={{ "--ii-accent": it.kind === "positive_movement" ? "var(--ii-good)" : "var(--ii-blue)", marginBottom: 0 }}>
          <h3 className="ii-insight-lead" style={{ fontSize: 14.5 }}>{it.headline}</h3>
          {it.detail ? <p className="ii-insight-why">{it.detail}</p> : null}
          {it.cta ? (
            <button className="ii-action-cta" onClick={() => onCta && onCta(it.cta.target)}>{it.cta.label} <ArrowRight size={13} /></button>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/* =================================================================
 * Follow-up queue
 * ================================================================= */
export function FollowUpQueue({ ctx, items, onReload, onOpenStudent }) {
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [msgFor, setMsgFor] = useState(null);

  async function markDone(it) {
    if (!it.appointment_id) { setNotice("This follow-up clears when the plan review is updated."); return; }
    setBusy(it.student_id);
    try { await api.markFollowUpDone(it.appointment_id); onReload && onReload(); }
    catch (e) { setNotice(e.message || "Couldn't update."); }
    setBusy("");
  }

  if (!items || !items.length) {
    return <Card><EmptyState title="No follow-ups due">Follow-ups appear here when an outcome flags one, a development-plan review date passes, or a student is still below target after support.</EmptyState></Card>;
  }
  return (
    <>
      {notice ? <div style={{ marginBottom: 12 }}><Alert tone="info">{notice}</Alert></div> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((it) => (
          <div key={it.student_id + it.reason_key} className="ii-insight" style={{ "--ii-accent": "var(--ii-warn)", marginBottom: 0 }}>
            <div className="ii-spread">
              <button className="ii-roster-name" onClick={() => onOpenStudent(it.student_id)}>{it.name || "Student"} <ChevronRight size={13} /></button>
              <span className="ii-text-sm ii-muted">Due {dayLabel(it.due_date)}</span>
            </div>
            <p className="ii-insight-why" style={{ marginTop: 4 }}>{it.reason}</p>
            <p className="ii-text-sm ii-muted">
              {it.previous_intervention ? `Previous: ${it.previous_intervention}` : ""}
              {it.last_contact_at ? ` · last contact ${dayLabel(it.last_contact_at)}` : ""}
              {it.current_readiness_group ? ` · now ${it.current_readiness_group === "ready" ? "interview-ready" : it.current_readiness_group === "developing" ? "developing" : "needs support"}` : ""}
            </p>
            <div className="ii-row-wrap" style={{ gap: 8, marginTop: 8 }}>
              <Btn size="sm" variant="ghost" onClick={() => setMsgFor({ student_id: it.student_id, name: it.name })}>Message</Btn>
              <Btn size="sm" variant="ghost" disabled={busy === it.student_id || !it.appointment_id} onClick={() => markDone(it)}>
                <CheckCircle2 size={12} /> Mark follow-up complete
              </Btn>
            </div>
          </div>
        ))}
      </div>
      {msgFor ? (
        <MessageStudentsModal ctx={ctx} students={[msgFor]} onClose={() => setMsgFor(null)}
          onDone={(m) => { setMsgFor(null); setNotice(m); }} />
      ) : null}
    </>
  );
}

/* =================================================================
 * Development plan — adviser-editable
 * ================================================================= */
export function DevelopmentPlanCard({ ctx, shaped, studentId, onSaved }) {
  const plan = shaped?.developmentPlan || null;
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(() => planFromShaped(plan, shaped));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [newItem, setNewItem] = useState("");

  async function save() {
    setBusy(true); setMsg("");
    try {
      await api.saveDevelopmentPlan(planToRpcArgs(ctx.institutionId, studentId, v, plan?.id));
      setEditing(false); setMsg("Plan saved."); onSaved && onSaved();
    } catch (e) { setMsg(e.message || "Couldn't save the plan."); }
    setBusy(false);
  }
  async function toggleItem(it) {
    try {
      await api.upsertDevelopmentPlanItem({ planId: plan.id, itemId: it.id, kind: it.kind, label: it.label,
        status: it.status === "done" ? "todo" : "done" });
      onSaved && onSaved();
    } catch (e) { setMsg(e.message || "Couldn't update the item."); }
  }
  async function addItem() {
    const label = newItem.trim();
    if (!label || !plan?.id) return;
    try { await api.upsertDevelopmentPlanItem({ planId: plan.id, kind: "action", label }); setNewItem(""); onSaved && onSaved(); }
    catch (e) { setMsg(e.message || "Couldn't add the item."); }
  }
  async function setStatus(status) {
    try { await api.setDevelopmentPlanStatus(plan.id, status); onSaved && onSaved(); }
    catch (e) { setMsg(e.message || "Couldn't update the status."); }
  }

  if (!plan && !editing) {
    const sug = suggestPlan(shaped);
    return (
      <Card className="ii-section">
        <SectionTitle>Development plan</SectionTitle>
        <p className="ii-text-sm ii-muted">No development plan yet. EKI² suggests one from this student's practice:</p>
        <div className="ii-insight" style={{ "--ii-accent": "var(--ii-blue)", marginTop: 10 }}>
          <strong className="ii-text-sm" style={{ color: "var(--ii-navy)" }}>{sug.title}</strong>
          <p className="ii-insight-why">{sug.description}</p>
          <ul className="ii-focuslist ii-focuslist-plain" style={{ marginTop: 8 }}>
            {sug.items.map((it, i) => <li key={i}><span className="ii-focus-main">{itemKindLabel(it.kind)}: </span>{it.label}</li>)}
          </ul>
        </div>
        <div className="ii-row-wrap" style={{ gap: 8, marginTop: 12 }}>
          <Btn size="sm" variant="accent" onClick={() => { setV({ ...sug, reviewDate: "" }); setEditing("suggest"); }}>Create this plan</Btn>
          <Btn size="sm" variant="ghost" onClick={() => { setV(blankPlan()); setEditing("blank"); }}>Start from scratch</Btn>
        </div>
        {msg ? <p className="ii-text-sm ii-muted" style={{ marginTop: 8 }}>{msg}</p> : null}
        <p className="ii-text-sm ii-muted" style={{ marginTop: 10 }}>The student sees their plan in JOB.READY. Adviser notes stay separate.</p>
      </Card>
    );
  }

  if (editing) {
    return (
      <Card className="ii-section">
        <SectionTitle>{plan ? "Edit development plan" : "New development plan"}</SectionTitle>
        <Field label="Priority development area">
          <select className="ii-input ii-select" value={v.developmentArea || ""} onChange={(e) => setV({ ...v, developmentArea: e.target.value || null })}>
            <option value="">None</option>
            {["relevance", "specificity", "structure", "evidence", "communication", "competency_demonstration"].map((k) => (
              <option key={k} value={k}>{dimensionLabel(k)}</option>
            ))}
          </select>
        </Field>
        <Field label="Title"><input className="ii-input" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Why (student-visible)"><textarea className="ii-input" rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <div className="ii-grid ii-grid-2" style={{ gap: 12 }}>
          <Field label="Target score"><input className="ii-input" type="number" min="0" max="100" value={v.goalTarget ?? ""} onChange={(e) => setV({ ...v, goalTarget: e.target.value })} /></Field>
          <Field label="Review date"><input className="ii-input" type="date" value={v.reviewDate || ""} onChange={(e) => setV({ ...v, reviewDate: e.target.value })} /></Field>
        </div>
        <div className="ii-row-wrap" style={{ gap: 8, marginTop: 6 }}>
          <Btn size="sm" variant="accent" disabled={busy || !v.title.trim()} onClick={save}>{busy ? "Saving…" : "Save plan"}</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Btn>
          {msg ? <span className="ii-text-sm ii-muted">{msg}</span> : null}
        </div>
        <p className="ii-text-sm ii-muted" style={{ marginTop: 8 }}>
          {v.items && v.items.length ? "Items are added after the plan is created." : ""}
        </p>
      </Card>
    );
  }

  const sm = planStatusMeta(plan.status);
  return (
    <Card className="ii-section">
      <div className="ii-spread">
        <SectionTitle>Development plan</SectionTitle>
        <span className={`ii-tag ii-tag-${sm.tone === "good" ? "good" : sm.tone === "warn" ? "warn" : "neutral"}`}>{sm.label}</span>
      </div>
      <strong className="ii-text-sm" style={{ color: "var(--ii-navy)" }}>{plan.title}</strong>
      {plan.description ? <p className="ii-insight-why" style={{ marginTop: 4 }}>{plan.description}</p> : null}
      <p className="ii-text-sm ii-muted" style={{ marginTop: 4 }}>
        {plan.developmentAreaLabel ? `Area: ${plan.developmentAreaLabel}. ` : ""}
        {plan.goalTarget != null ? `Target: ${plan.goalTarget}. ` : ""}
        {plan.reviewDate ? `Review: ${dayLabel(plan.reviewDate)}.` : ""}
      </p>
      {plan.items.length ? (
        <ul className="ii-focuslist ii-focuslist-plain" style={{ marginTop: 10 }}>
          {plan.items.map((it) => (
            <li key={it.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" checked={it.status === "done"} onChange={() => toggleItem(it)} style={{ marginTop: 3 }} />
              <span className={it.status === "done" ? "ii-muted" : ""} style={it.status === "done" ? { textDecoration: "line-through" } : undefined}>
                <span className="ii-focus-main">{itemKindLabel(it.kind)}: </span>{it.label}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ii-row" style={{ gap: 8, marginTop: 10 }}>
        <input className="ii-input ii-btn-sm" placeholder="Add an action…" value={newItem} onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addItem(); }} />
        <Btn size="sm" variant="ghost" onClick={addItem}>Add</Btn>
      </div>
      <div className="ii-row-wrap" style={{ gap: 8, marginTop: 12 }}>
        <Btn size="sm" variant="ghost" onClick={() => { setV(planFromShaped(plan, shaped)); setEditing("edit"); }}>Edit</Btn>
        {plan.status !== "completed"
          ? <Btn size="sm" variant="ghost" onClick={() => setStatus("completed")}><CheckCircle2 size={12} /> Mark complete</Btn>
          : <Btn size="sm" variant="ghost" onClick={() => setStatus("active")}>Reopen</Btn>}
        {msg ? <span className="ii-text-sm ii-muted">{msg}</span> : null}
      </div>
    </Card>
  );
}
function blankPlan() {
  return { developmentArea: null, title: "", description: "", goalTarget: "", resourceId: null, reviewDate: "", items: [] };
}
function planFromShaped(plan, shaped) {
  if (plan) {
    return {
      developmentArea: plan.developmentArea, title: plan.title, description: plan.description,
      goalTarget: plan.goalTarget ?? "", resourceId: plan.resourceId, reviewDate: plan.reviewDate || "", items: plan.items,
    };
  }
  return blankPlan();
}

/* =================================================================
 * Brief me — deterministic instantly; optional AI synthesis on request
 * ================================================================= */
export function BriefMe({ ctx, shaped, studentId, appointmentId }) {
  const det = useMemo(() => deterministicBriefing(shaped), [shaped]);
  const stored = shaped?.lastBriefing || null;
  const [view, setView] = useState(stored ? { focus: stored.focus, discussion: stored.discussion, generated_by: stored.generatedBy } : det);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function synth() {
    setBusy(true); setMsg("");
    try {
      const res = await api.requestAdviserBriefing({ institutionId: ctx.institutionId, studentId });
      if (res?.ok && res.focus) {
        setView({ focus: res.focus, discussion: res.discussion || [], generated_by: "ai", model: res.model });
        setMsg("Synthesised with AI. Review before use.");
      } else {
        setMsg(res?.reason === "ai_unavailable"
          ? "AI synthesis isn't configured — showing the deterministic briefing."
          : "AI synthesis unavailable — showing the deterministic briefing.");
      }
    } catch { setMsg("AI synthesis unavailable — showing the deterministic briefing."); }
    setBusy(false);
  }
  async function saveIt() {
    setBusy(true); setMsg("");
    try {
      await api.saveAdviserBriefing({
        p_institution_id: ctx.institutionId, p_student_id: studentId,
        p_briefing: view.focus, p_discussion_points: view.discussion || [],
        p_generated_by: view.generated_by === "ai" ? "ai" : "deterministic",
        p_model: view.model || null, p_appointment_id: appointmentId || null,
      });
      setMsg("Briefing saved to this student's record.");
    } catch (e) { setMsg(e.message || "Couldn't save the briefing."); }
    setBusy(false);
  }

  if (!open) {
    return (
      <div className="ii-section">
        <Btn size="sm" variant="primary" onClick={() => setOpen(true)}><Sparkles size={13} /> Brief me</Btn>
      </div>
    );
  }
  return (
    <Card className="ii-section">
      <div className="ii-spread">
        <SectionTitle>Suggested focus for today's session</SectionTitle>
        <span className="ii-text-sm ii-muted">{view.generated_by === "ai" ? "AI synthesis" : "Deterministic"}</span>
      </div>
      <p className="ii-insight-lead" style={{ fontSize: 14.5, fontWeight: 600 }}>{view.focus}</p>
      {(view.discussion || []).length ? (
        <>
          <SectionTitle style={{ marginTop: 12 }}>Suggested discussion</SectionTitle>
          <ul className="ii-focuslist ii-focuslist-plain">
            {view.discussion.map((d, i) => <li key={i}><span className="ii-focus-main">{d}</span></li>)}
          </ul>
        </>
      ) : null}
      <div className="ii-row-wrap" style={{ gap: 8, marginTop: 12 }}>
        <Btn size="sm" variant="ghost" disabled={busy} onClick={synth}><RefreshCw size={12} /> Use AI synthesis</Btn>
        <Btn size="sm" variant="accent" disabled={busy} onClick={saveIt}>Save briefing</Btn>
        <Btn size="sm" variant="ghost" onClick={() => setOpen(false)}>Hide</Btn>
        {msg ? <span className="ii-text-sm ii-muted">{msg}</span> : null}
      </div>
      <p className="ii-text-sm ii-muted" style={{ marginTop: 8 }}>
        Grounded in this student's recorded practice and previous sessions only — not a diagnosis, not a prediction.
      </p>
    </Card>
  );
}
