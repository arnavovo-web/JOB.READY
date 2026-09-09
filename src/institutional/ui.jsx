/* ================================================================== *
 * INSTITUTIONAL INSIGHTS — shared presentational primitives
 * Presentation only. No DB, no business logic. Classes come from
 * theme.js (INSTITUTIONAL_CSS), `.ii-*` namespace.
 * ================================================================== */
import React from "react";
import {
  TrendingUp, TrendingDown, Minus, Lock, Info, AlertTriangle, Inbox,
} from "lucide-react";

export function Btn({ variant = "ghost", size, children, className = "", ...rest }) {
  const cls = [
    "ii-btn",
    variant === "primary" ? "ii-btn-primary" : variant === "accent" ? "ii-btn-accent" : "ii-btn-ghost",
    size === "sm" ? "ii-btn-sm" : "",
    className,
  ].filter(Boolean).join(" ");
  return <button className={cls} {...rest}>{children}</button>;
}

export function Card({ children, padLg, className = "", ...rest }) {
  return (
    <div className={["ii-card", padLg ? "ii-card-pad-lg" : "", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

export function PageHeader({ eyebrow, title, sub, actions }) {
  return (
    <div className="ii-pagehead">
      <div className="ii-pagehead-title-row">
        <div style={{ minWidth: 0 }}>
          {eyebrow ? <p className="ii-eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</p> : null}
          <h1 className="ii-h1">{title}</h1>
          {sub ? <p className="ii-text" style={{ marginTop: 8, maxWidth: 620 }}>{sub}</p> : null}
        </div>
        {actions ? <div className="ii-row-wrap">{actions}</div> : null}
      </div>
    </div>
  );
}

export function SectionTitle({ children, hint }) {
  return (
    <div className="ii-spread" style={{ marginBottom: 12 }}>
      <h2 className="ii-h2">{children}</h2>
      {hint ? <span className="ii-text-sm ii-muted">{hint}</span> : null}
    </div>
  );
}

const TONE_TO_BADGE = { good: "ii-badge-good", warn: "ii-badge-warn", bad: "ii-badge-bad", info: "ii-badge-info", neutral: "ii-badge-neutral" };
export function Badge({ tone = "neutral", children }) {
  return <span className={`ii-badge ${TONE_TO_BADGE[tone] || "ii-badge-neutral"}`}>{children}</span>;
}

/** Direction chip for a delta. `value` is a signed number (points). */
export function DeltaChip({ value, unit = "pts", neutralBelow = 1 }) {
  if (value == null || Number.isNaN(value)) return <span className="ii-text-sm ii-muted">—</span>;
  const mag = Math.abs(value);
  if (mag < neutralBelow) {
    return <span className="ii-badge ii-badge-neutral"><Minus size={12} /> flat</span>;
  }
  const up = value > 0;
  return (
    <span className={`ii-badge ${up ? "ii-badge-good" : "ii-badge-bad"}`}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {up ? "+" : "−"}{mag.toFixed(mag < 10 ? 1 : 0)} {unit}
    </span>
  );
}

export function Stat({ label, value, unit, sub, small, tone }) {
  return (
    <div className="ii-stat">
      <span className="ii-stat-label">{label}</span>
      <div className="ii-row" style={{ alignItems: "baseline", gap: 6 }}>
        <span className={`ii-stat-value ${small ? "ii-stat-value-sm" : ""}`} style={tone === "bad" ? { color: "var(--ii-bad)" } : tone === "good" ? { color: "var(--ii-good)" } : undefined}>
          {value == null || value === "" ? "—" : value}
        </span>
        {unit ? <span className="ii-stat-unit">{unit}</span> : null}
      </div>
      {sub ? <span className="ii-stat-sub">{sub}</span> : null}
    </div>
  );
}

/** Horizontal labelled bar, 0-100. */
export function BarRow({ label, value, tone, suffix = "" }) {
  const v = value == null || Number.isNaN(value) ? null : Math.max(0, Math.min(100, value));
  const fillTone = tone === "good" ? "ii-meter-fill-good" : tone === "warn" ? "ii-meter-fill-warn" : tone === "bad" ? "ii-meter-fill-bad" : "";
  return (
    <div className="ii-bar-track" style={{ marginBottom: 10 }}>
      <span className="ii-bar-label" title={label}>{label}</span>
      <span className="ii-meter" style={{ flex: 1 }}>
        <span className={`ii-meter-fill ${fillTone}`} style={{ width: `${v == null ? 0 : v}%` }} />
      </span>
      <span className="ii-bar-val">{v == null ? "—" : `${Math.round(v)}${suffix}`}</span>
    </div>
  );
}

export function Alert({ tone = "info", children }) {
  const cls = tone === "warn" ? "ii-alert-warn" : tone === "error" ? "ii-alert-error" : "ii-alert-info";
  const Icon = tone === "warn" ? AlertTriangle : tone === "error" ? AlertTriangle : Info;
  return (
    <div className={`ii-alert ${cls}`}>
      <Icon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children, icon }) {
  const Icon = icon || Inbox;
  return (
    <div className="ii-empty">
      <div className="ii-empty-icon"><Icon size={22} /></div>
      <h3 className="ii-h3">{title}</h3>
      {children ? <p className="ii-text-sm" style={{ maxWidth: 420 }}>{children}</p> : null}
    </div>
  );
}

/**
 * Shown wherever a figure is withheld because the contributing group is
 * smaller than the k-anonymity threshold. Never render a real number here.
 */
export function Suppressed({ n, min }) {
  return (
    <span className="ii-badge ii-badge-neutral" title={`Hidden — fewer than ${min} students with data in this group`}>
      <Lock size={11} /> n&lt;{min}
    </span>
  );
}

export function AnonNote({ min }) {
  return (
    <p className="ii-anon-note">
      <Lock size={11} /> Aggregated across students. Any group with fewer than {min} students with data is hidden.
    </p>
  );
}

export function Spinner({ label }) {
  return (
    <div className="ii-loadwrap">
      <div className="ii-spinner" />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

/** A metric section that the analytics engine does not yet support. */
export function PendingMetric({ what }) {
  return (
    <Card>
      <EmptyState title="Arriving in the analytics engine" icon={Info}>
        {what} is wired to a real query and will populate once the Milestone 2 analytics
        engine is deployed. No placeholder numbers are shown.
      </EmptyState>
    </Card>
  );
}

export function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span className="ii-label">{label}</span>
      {children}
    </label>
  );
}
