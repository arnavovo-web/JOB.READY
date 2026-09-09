/* ================================================================== *
 * EKI² — student trajectory + Interview DNA evolution (pure)
 * ------------------------------------------------------------------
 * The ONE trajectory engine. `classifyTrajectory` mirrors the SQL
 * `jr_classify_trajectory` exactly so the frontend and the database
 * never disagree. Everything downstream (Stuck Students, DNA Evolution,
 * Development Plans, Adviser Briefing, Programme Intelligence) reads
 * these functions — no per-feature recalculation.
 *
 * Thresholds (documented, deterministic):
 *   TRAJ_MIN_POINTS   3   — below this: "insufficient data"
 *   IMPROVE_DELTA     6   — gained >= 6 overall AND still rising (recent >= +2)
 *   DECLINE_DELTA     6   — lost >= 6 overall OR sharp recent drop (recent <= -4)
 *   PLATEAU_SPAN      4   — last-3 scores within 4 pts AND flat recently -> plateau
 * Pure. Tested in trajectory.test.js.
 * ================================================================== */
import { dimensionLabel } from "./taxonomy.js";

export const TRAJ_MIN_POINTS = 3;
export const TRAJ_IMPROVE_DELTA = 6;
export const TRAJ_DECLINE_DELTA = 6;
export const TRAJ_RECENT_RISE = 2;
export const TRAJ_RECENT_DROP = -4;
export const TRAJ_PLATEAU_SPAN = 4;
export const TRAJ_RECENT_EPS = 3;

/**
 * Classify an ordered score series (oldest → newest) into one of
 * improving | stable | plateauing | declining | insufficient_data.
 */
export function classifyTrajectory(series) {
  const s = (series || []).filter((x) => x != null && !Number.isNaN(Number(x))).map(Number);
  const n = s.length;
  if (n < TRAJ_MIN_POINTS) return "insufficient_data";
  const first = s[0];
  const last = s[n - 1];
  const overall = last - first;
  const recentIdx = Math.max(0, n - 3);
  const recentDelta = last - s[recentIdx];
  const last3 = s.slice(Math.max(0, n - 3));
  const last3Span = Math.max(...last3) - Math.min(...last3);

  if (overall >= TRAJ_IMPROVE_DELTA && recentDelta >= TRAJ_RECENT_RISE) return "improving";
  if (overall <= -TRAJ_DECLINE_DELTA || recentDelta <= TRAJ_RECENT_DROP) return "declining";
  if (n >= 4 && Math.abs(recentDelta) < TRAJ_RECENT_EPS && last3Span < TRAJ_PLATEAU_SPAN) return "plateauing";
  return "stable";
}

export const TRAJECTORY_META = {
  improving: { label: "Improving", tone: "good", verb: "is improving with practice" },
  stable: { label: "Stable", tone: "neutral", verb: "is broadly stable" },
  plateauing: { label: "Plateauing", tone: "warn", verb: "appears to have plateaued despite continued practice" },
  declining: { label: "Declining", tone: "bad", verb: "has slipped in recent practice" },
  insufficient_data: { label: "Not enough data", tone: "neutral", verb: "does not have enough completed practice to show a direction" },
};
export function trajectoryMeta(key) {
  return TRAJECTORY_META[key] || TRAJECTORY_META.insufficient_data;
}

/** Shape the raw `trajectory` block from a snapshot / my-development payload. */
export function shapeTrajectory(raw) {
  if (!raw || typeof raw !== "object") return { classification: "insufficient_data", series: [] };
  const series = Array.isArray(raw.series) ? raw.series.map(Number) : [];
  return {
    classification: raw.classification || (series.length ? classifyTrajectory(series) : "insufficient_data"),
    series,
    firstScore: raw.first_score ?? (series[0] ?? null),
    latestScore: raw.latest_score ?? (series[series.length - 1] ?? null),
    overallDelta: raw.overall_delta ?? (series.length >= 2 ? series[series.length - 1] - series[0] : null),
    recentDelta: raw.recent_delta ?? null,
    nInterviews: raw.n_interviews ?? series.length,
  };
}

/** A factual one-liner for the trajectory (never causal). */
export function trajectoryLine(t) {
  const m = trajectoryMeta(t?.classification);
  if (t?.classification === "insufficient_data") return "Not enough completed practice yet to show a direction.";
  if (t?.firstScore != null && t?.latestScore != null && t.firstScore !== t.latestScore) {
    const dir = t.latestScore > t.firstScore ? "from" : "from";
    return `Overall readiness ${dir} ${t.firstScore} to ${t.latestScore} across ${t.nInterviews} interviews — ${m.label.toLowerCase()}.`;
  }
  return `Overall practice ${m.verb}.`;
}

/* ---- Interview DNA evolution ---------------------------------- */
export function shapeDnaEvolution(raw) {
  if (!raw || !raw.has_data) return { hasData: false, dimensions: [] };
  const dims = (raw.dimensions || []).map((d) => ({
    key: d.key, label: dimensionLabel(d.key),
    earliest: d.earliest, latest: d.latest, delta: d.delta,
    nPoints: d.n_points ?? null,
  }));
  return {
    hasData: true,
    dimensions: dims,
    strongestImprovement: raw.strongest_improvement || null,
    persistentWeakness: raw.persistent_weakness || null,
  };
}

/** "Evidence rose 18 points; Structure is the persistent gap." — factual. */
export function dnaEvolutionLine(ev) {
  if (!ev?.hasData) return null;
  const up = [...(ev.dimensions || [])].sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0];
  const bits = [];
  if (up && up.delta > 0) bits.push(`${up.label} rose ${Math.round(up.delta)} point${Math.round(up.delta) === 1 ? "" : "s"}`);
  if (ev.persistentWeakness) bits.push(`${dimensionLabel(ev.persistentWeakness)} remains the persistent gap`);
  return bits.length ? bits.join("; ") + "." : null;
}
