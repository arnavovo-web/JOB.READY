/* ================================================================== *
 * INSTITUTIONAL INSIGHTS — data-visualisation primitives
 * ------------------------------------------------------------------
 * Pure inline-SVG / flexbox. No charting library (CSP + no-deps).
 * Everything is theme-driven via the .ii-* CSS custom properties, and
 * every component degrades to a clear "hidden — n<k" / "no data" state
 * rather than drawing a misleading empty chart.
 * ================================================================== */
import React from "react";
import { Lock, TrendingUp, TrendingDown, Minus, ArrowRight, AlertTriangle, CheckCircle2, Info, Flame } from "lucide-react";
import { Suppressed } from "./ui.jsx";

const TONE_COLOR = {
  good: "var(--ii-good)", warn: "var(--ii-warn)", bad: "var(--ii-bad)",
  neutral: "var(--ii-text-faint)", blue: "var(--ii-blue)",
};
function bandTone(score, target = 70) {
  if (score == null) return "neutral";
  if (score >= target) return "good";
  if (score >= target - 15) return "warn";
  return "bad";
}

/* ---------- findings ------------------------------------------------ */
const SEV_META = {
  critical: { cls: "ii-badge-bad", Icon: Flame, label: "Priority" },
  watch: { cls: "ii-badge-warn", Icon: AlertTriangle, label: "Watch" },
  positive: { cls: "ii-badge-good", Icon: CheckCircle2, label: "Strength" },
  neutral: { cls: "ii-badge-neutral", Icon: Info, label: "Note" },
};

export function FindingCard({ finding, compact }) {
  const m = SEV_META[finding.severity] || SEV_META.neutral;
  const Icon = m.Icon;
  return (
    <div className={`ii-finding ii-finding-${finding.severity}`}>
      <span className={`ii-finding-tag ${m.cls}`}><Icon size={12} /> {m.label}</span>
      <div style={{ minWidth: 0 }}>
        <div className="ii-finding-head">{finding.headline}</div>
        {!compact && finding.detail ? <div className="ii-finding-detail">{finding.detail}</div> : null}
      </div>
    </div>
  );
}

export function FindingList({ findings, compact, emptyLabel = "No findings for the current scope." }) {
  if (!findings || !findings.length) {
    return <p className="ii-text-sm ii-muted" style={{ padding: "8px 0" }}>{emptyLabel}</p>;
  }
  return (
    <div className="ii-findings">
      {findings.map((f) => <FindingCard key={f.id} finding={f} compact={compact} />)}
    </div>
  );
}

/* ---------- competency / category bar chart ---------------------- *
 * rows: [{ key, label, mean, target, deltaLabel?, tone?, suppressed?, n_students }]
 * Draws a 0-100 track with a target marker; suppressed rows show a lock.
 */
export function ScoreBars({ rows, target = 70, unit = "" }) {
  const reportable = rows.filter((r) => !r.suppressed && r.mean != null);
  if (!reportable.length) {
    return <SuppressedBlock n={rows.reduce((s, r) => s + (r.n_students || 0), 0)} min={rows[0]?.min_n} />;
  }
  return (
    <div className="ii-bars">
      {rows.map((r) => (
        <div className="ii-bar-track" key={r.key} style={{ marginBottom: 12 }}>
          <span className="ii-bar-label" title={r.label}>{r.label}</span>
          <span className="ii-bar-wrap">
            <span className="ii-meter" style={{ position: "relative" }}>
              {r.suppressed || r.mean == null ? null : (
                <span className={`ii-meter-fill ii-meter-fill-${r.tone || bandTone(r.mean, target)}`}
                  style={{ width: `${Math.max(2, Math.min(100, r.mean))}%` }} />
              )}
              <span className="ii-meter-target" style={{ left: `${target}%` }} title={`Interview-ready ${target}`} />
            </span>
          </span>
          <span className="ii-bar-tail">
            {r.suppressed || r.mean == null
              ? <Suppressed n={r.n_students} min={r.min_n} />
              : <><span className="ii-bar-val">{Math.round(r.mean)}{unit}</span>
                  {r.deltaLabel ? <span className={`ii-delta ii-delta-${r.deltaTone || "neutral"}`}>{r.deltaLabel}</span> : null}</>}
          </span>
        </div>
      ))}
      <div className="ii-legend"><span className="ii-legend-target" /> interview-ready ({target})</div>
    </div>
  );
}

/* ---------- segmented distribution bar --------------------------- *
 * segments: [{ label, count, tone }]  — renders one stacked bar + a legend.
 */
export function DistributionBar({ segments, n, min }) {
  if (!segments || !segments.length || !n) {
    return <SuppressedBlock n={n} min={min} />;
  }
  const total = segments.reduce((s, x) => s + (x.count || 0), 0) || 1;
  return (
    <div>
      <div className="ii-distbar">
        {segments.map((s, i) => (
          <span key={i} className="ii-distbar-seg"
            style={{ width: `${(s.count / total) * 100}%`, background: TONE_COLOR[s.tone] || "var(--ii-blue)" }}
            title={`${s.label}: ${s.count}`} />
        ))}
      </div>
      <div className="ii-distlegend">
        {segments.map((s, i) => (
          <span key={i} className="ii-distlegend-item">
            <span className="ii-dot" style={{ background: TONE_COLOR[s.tone] || "var(--ii-blue)" }} />
            {s.label} <strong>{s.count}</strong>
            <span className="ii-muted"> ({Math.round((s.count / total) * 100)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- diverging delta bars (improvement) ------------------ *
 * rows: [{ key, label, delta, suppressed, n_students }]  centered on 0
 */
export function DeltaBars({ rows, maxAbs = 15, unit = "pts" }) {
  const live = rows.filter((r) => !r.suppressed && r.delta != null);
  if (!live.length) return <SuppressedBlock n={rows.reduce((s, r) => s + (r.n_students || 0), 0)} min={rows[0]?.min_n} />;
  const cap = Math.max(maxAbs, ...live.map((r) => Math.abs(r.delta)));
  return (
    <div className="ii-deltabars">
      {rows.map((r) => {
        if (r.suppressed || r.delta == null) {
          return (
            <div className="ii-deltarow" key={r.key}>
              <span className="ii-bar-label">{r.label}</span>
              <span className="ii-deltatrack"><span className="ii-deltamid" /></span>
              <span className="ii-bar-tail"><Suppressed n={r.n_students} min={r.min_n} /></span>
            </div>
          );
        }
        const pct = (Math.abs(r.delta) / cap) * 50;
        const up = r.delta > 0;
        return (
          <div className="ii-deltarow" key={r.key}>
            <span className="ii-bar-label" title={r.label}>{r.label}</span>
            <span className="ii-deltatrack">
              <span className="ii-deltamid" />
              <span className={`ii-deltafill ${up ? "ii-deltafill-up" : "ii-deltafill-down"}`}
                style={{ left: up ? "50%" : `${50 - pct}%`, width: `${pct}%` }} />
            </span>
            <span className="ii-bar-tail">
              <span className={`ii-delta ii-delta-${up ? "good" : r.delta < 0 ? "bad" : "neutral"}`}>
                {up ? <TrendingUp size={11} /> : r.delta < 0 ? <TrendingDown size={11} /> : <Minus size={11} />}
                {up ? "+" : r.delta < 0 ? "−" : ""}{Math.abs(Math.round(r.delta * 10) / 10)} {unit}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- monthly trend (inline SVG sparkline-ish) ----------- *
 * points: [{ month, mean, suppressed }]  — draws only the reportable run.
 */
export function TrendLine({ points, target = 70, height = 90 }) {
  const live = (points || []).filter((p) => !p.suppressed && p.mean != null);
  if (live.length < 2) {
    return <p className="ii-text-sm ii-muted">Not enough reportable months to show a trend{points && points.length ? ` (${live.length} of ${points.length}).` : "."}</p>;
  }
  const w = 100, h = height;
  const xs = live.map((_, i) => (i / (live.length - 1)) * w);
  const ys = live.map((p) => h - (Math.max(0, Math.min(100, p.mean)) / 100) * h);
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const tgtY = h - (target / 100) * h;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="ii-trend" role="img" aria-label="Monthly cohort mean score">
        <line x1="0" x2={w} y1={tgtY} y2={tgtY} className="ii-trend-target" />
        <path d={`${d} L${w},${h} L0,${h} Z`} className="ii-trend-area" />
        <path d={d} className="ii-trend-line" />
        {xs.map((x, i) => <circle key={i} cx={x} cy={ys[i]} r="1.6" className="ii-trend-dot" />)}
      </svg>
      <div className="ii-trend-axis">
        <span>{live[0].month}</span>
        <span className="ii-muted">cohort mean · interview-ready {target}</span>
        <span>{live[live.length - 1].month}</span>
      </div>
    </div>
  );
}

/* ---------- ranked opportunity list --------------------------- *
 * items: [{ kind, key, label, cohort_mean, gap_vs_target, pct_below_target,
 *           opportunity_score, improvingLabel?, improvingTone? }]
 */
export function OpportunityList({ items, target = 70 }) {
  if (!items || !items.length) {
    return <p className="ii-text-sm ii-muted">No development opportunities meet the reporting threshold for this scope.</p>;
  }
  return (
    <ol className="ii-opps">
      {items.map((o, i) => (
        <li key={`${o.kind}:${o.key}`} className="ii-opp">
          <span className="ii-opp-rank">{i + 1}</span>
          <span className="ii-opp-body">
            <span className="ii-opp-head">
              <strong>{o.label}</strong>
              <span className="ii-badge ii-badge-neutral">{o.kind === "question_category" ? "question type" : "competency"}</span>
              {o.improvingLabel ? <span className={`ii-delta ii-delta-${o.improvingTone || "neutral"}`}>{o.improvingLabel}</span> : null}
            </span>
            <span className="ii-opp-meter">
              <span className="ii-meter" style={{ position: "relative", flex: 1 }}>
                <span className="ii-meter-fill ii-meter-fill-bad" style={{ width: `${Math.max(2, Math.min(100, o.cohort_mean))}%` }} />
                <span className="ii-meter-target" style={{ left: `${target}%` }} />
              </span>
              <span className="ii-bar-val">{Math.round(o.cohort_mean)}</span>
            </span>
            <span className="ii-opp-facts ii-text-sm ii-muted">
              {o.pct_below_target}% of students below interview-ready · {Math.round(o.gap_vs_target)}-point gap
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ---------- small helpers ----------------------------------- */
export function SuppressedBlock({ n, min }) {
  return (
    <div className="ii-suppressed-block">
      <Lock size={14} />
      <span>Hidden to protect individual students — fewer than {min || 5} with data in this group{n != null ? ` (${n}).` : "."}</span>
    </div>
  );
}

export function KeyStatRow({ stats }) {
  return (
    <div className="ii-grid ii-grid-4 ii-section">
      {stats.map((s) => (
        <div className="ii-stat" key={s.label}>
          <span className="ii-stat-label">{s.label}</span>
          <div className="ii-row" style={{ alignItems: "baseline", gap: 5 }}>
            <span className="ii-stat-value" style={s.tone ? { color: TONE_COLOR[s.tone] } : undefined}>
              {s.value == null || s.value === "" ? "—" : s.value}
            </span>
            {s.unit ? <span className="ii-stat-unit">{s.unit}</span> : null}
          </div>
          {s.sub ? <span className="ii-stat-sub">{s.sub}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function CalloutPair({ strong, weak }) {
  return (
    <div className="ii-grid ii-grid-2" style={{ gap: 14 }}>
      <div className="ii-callout ii-callout-good">
        <span className="ii-eyebrow" style={{ color: "var(--ii-good)" }}><TrendingUp size={12} /> Strongest</span>
        {strong ? <><div className="ii-h3" style={{ marginTop: 6 }}>{strong.label}</div>
          <div className="ii-text-sm">{strong.detail}</div></> : <div className="ii-text-sm ii-muted">Not reportable.</div>}
      </div>
      <div className="ii-callout ii-callout-bad">
        <span className="ii-eyebrow" style={{ color: "var(--ii-bad)" }}><ArrowRight size={12} /> Biggest gap</span>
        {weak ? <><div className="ii-h3" style={{ marginTop: 6 }}>{weak.label}</div>
          <div className="ii-text-sm">{weak.detail}</div></> : <div className="ii-text-sm ii-muted">Not reportable.</div>}
      </div>
    </div>
  );
}
