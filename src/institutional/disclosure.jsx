/* ================================================================== *
 * EKI² — insight-first presentational blocks
 * ------------------------------------------------------------------
 * Every EKI² analytical screen is built from these:
 *   OverviewCard  — the four "what matters" cards
 *   VerdictHeader — one calm word + one sentence + one figure
 *   InsightPanel  — insight → why → figure → suggested action → (evidence)
 *   Disclosure    — progressive disclosure ("Show the evidence")
 *   SuggestedAction, QuietStat, JourneyEntry
 * Presentation only. Classes come from theme.js (.ii-*).
 * ================================================================== */
import React, { useState } from "react";
import {
  ChevronRight, ChevronDown, ArrowRight, AlertTriangle, Eye, Lightbulb,
  CheckCircle2, Sparkles,
} from "lucide-react";

const BUCKET_ICON = { attention: AlertTriangle, watch: Eye, insight: Lightbulb, working: CheckCircle2 };
const TONE_ACCENT = { bad: "var(--ii-bad)", warn: "var(--ii-warn)", good: "var(--ii-good)", info: "var(--ii-blue)", neutral: "var(--ii-text-faint)" };

/* ---- progressive disclosure ---------------------------------- */
export function Disclosure({ summary = "Show the evidence", children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ii-disc">
      <button className="ii-disc-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {open ? "Hide the detail" : summary}
      </button>
      <div className="ii-disc-body" hidden={!open}>{open ? children : null}</div>
    </div>
  );
}

/* ---- suggested action -------------------------------------- */
export function SuggestedAction({ text, cta, onCta }) {
  if (!text) return null;
  return (
    <div className="ii-action">
      <span className="ii-action-label">Suggested action</span>
      <p className="ii-action-text">{text}</p>
      {cta ? (
        <button className="ii-action-cta" onClick={() => onCta && onCta(cta.target)}>
          {cta.label} <ArrowRight size={13} />
        </button>
      ) : null}
    </div>
  );
}

/* ---- the core insight unit -------------------------------- */
export function InsightPanel({ eyebrow, tone = "neutral", lead, why, figure, action, onCta, children, evidenceSummary }) {
  return (
    <section className="ii-insight" style={{ "--ii-accent": TONE_ACCENT[tone] || TONE_ACCENT.neutral }}>
      {eyebrow ? <div className="ii-insight-eyebrow">{eyebrow}</div> : null}
      <h3 className="ii-insight-lead">{lead}</h3>
      {why ? <p className="ii-insight-why">{why}</p> : null}
      {figure ? <p className="ii-insight-figure">{figure}</p> : null}
      {action ? <SuggestedAction text={action.text} cta={action.cta} onCta={onCta} /> : null}
      {children ? <Disclosure summary={evidenceSummary || "Show the evidence"}>{children}</Disclosure> : null}
    </section>
  );
}

/* ---- the four Overview cards ------------------------------ */
export function OverviewCard({ card, onOpen }) {
  const Icon = BUCKET_ICON[card.bucket] || Lightbulb;
  return (
    <button className={`ii-ovcard ii-ovcard-${card.tone}`} onClick={() => onOpen && onOpen(card.target)}>
      <span className="ii-ovcard-head">
        <Icon size={13} /> {card.label}
      </span>
      <span className="ii-ovcard-insight">{card.insight}</span>
      {card.figure ? <span className="ii-ovcard-figure">{card.figure}</span> : null}
      {card.actionText ? <span className="ii-ovcard-action">{card.actionText}</span> : null}
      <span className="ii-ovcard-link">View details <ArrowRight size={12} /></span>
    </button>
  );
}

/* ---- the big calm verdict line -------------------------- */
export function VerdictHeader({ question, verdict }) {
  return (
    <div className="ii-verdict">
      {question ? <p className="ii-verdict-q">{question}</p> : null}
      {verdict ? (
        <>
          <div className={`ii-verdict-word ii-verdict-${verdict.tone}`}>{verdict.word}</div>
          <p className="ii-verdict-sentence">{verdict.sentence}</p>
          {verdict.figure ? <p className="ii-verdict-figure">{verdict.figure}</p> : null}
        </>
      ) : null}
    </div>
  );
}

/* ---- a single quiet stat (label · word · one figure) --- */
export function QuietStat({ label, word, tone = "neutral", figure }) {
  return (
    <div className="ii-qstat">
      <span className="ii-qstat-label">{label}</span>
      <span className={`ii-qstat-word ii-qstat-${tone}`}>{word || "—"}</span>
      {figure ? <span className="ii-qstat-figure">{figure}</span> : null}
    </div>
  );
}

/* ---- a scannable careers-history entry ------------------ */
export function JourneyEntry({ dateLabel, typeLabel, statusLabel, statusTone, discussed, actionsAgreed, nextSteps, followUpRequired, extra }) {
  const [open, setOpen] = useState(false);
  const hasExtra = !!extra;
  return (
    <div className="ii-journey">
      <div className="ii-journey-head">
        <span className="ii-journey-type">{typeLabel}</span>
        <span className="ii-journey-date">{dateLabel}</span>
        {followUpRequired ? <span className="ii-tag ii-tag-warn">follow-up</span> : null}
        {statusLabel ? <span className={`ii-tag ii-tag-${statusTone || "neutral"}`}>{statusLabel}</span> : null}
      </div>
      {discussed ? <p className="ii-journey-line"><b>Discussed</b> {discussed}</p> : null}
      {actionsAgreed ? <p className="ii-journey-line"><b>Agreed</b> {actionsAgreed}</p> : null}
      {nextSteps ? <p className="ii-journey-line"><b>Next step</b> {nextSteps}</p> : null}
      {!discussed && !actionsAgreed && !nextSteps ? <p className="ii-journey-line ii-muted">No outcome recorded for this session.</p> : null}
      {hasExtra ? (
        <button className="ii-journey-more" onClick={() => setOpen((o) => !o)}>
          {open ? "Less" : "More"}
        </button>
      ) : null}
      {open && hasExtra ? <div className="ii-journey-extra">{extra}</div> : null}
    </div>
  );
}

/* ---- a plain "focus list" (numbered) ------------------- */
export function FocusList({ items, ordered = true, empty = "Nothing flagged — the cohort is broadly on track." }) {
  if (!items || !items.length) return <p className="ii-text-sm ii-muted">{empty}</p>;
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={ordered ? "ii-focuslist" : "ii-focuslist ii-focuslist-plain"}>
      {items.map((it, i) => (
        <li key={i}>
          <span className="ii-focus-main">{it.label}</span>
          {it.note ? <span className="ii-focus-note">{it.note}</span> : null}
        </li>
      ))}
    </Tag>
  );
}

export function SectionQuestion({ children }) {
  return <p className="ii-sectionq">{children}</p>;
}
