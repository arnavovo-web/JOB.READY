/* ================================================================== *
 * JOB.READY — INSTITUTIONAL INSIGHTS
 * ------------------------------------------------------------------
 * A separate B2B React tree, mounted at /institutional by src/main.jsx.
 * It shares nothing with the student App.jsx except the design language
 * (re-declared under `.ii-*` in theme.js) and the Supabase project.
 *
 * Milestone 1 (this file): auth gate + institution/cohort foundation +
 * the full dashboard shell (Overview, Performance, Competencies, Career
 * Insights, Development Areas, Improvement) + a working Cohorts & students
 * setup area. The six analytics sections render an honest "pending" state
 * until the Milestone 2 analytics engine is deployed — no placeholder
 * numbers.
 * ================================================================== */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard, BarChart3, Radar, Compass, Target, LineChart,
  Users, LogOut, Building2, ChevronDown, ShieldCheck, RefreshCw, Lock,
} from "lucide-react";
import { INSTITUTIONAL_CSS } from "./theme.js";
import {
  MIN_COHORT_N, dimensionLabel, categoryLabel, roleFamilyLabel, readinessMeta, stageLabel,
} from "./taxonomy.js";
import {
  getSession, signInWithPassword, signOut, onAuthStateChange,
} from "./supabaseClient.js";
import * as api from "./api.js";
import {
  summariseCohorts, emptyFilters, describeFilters,
} from "./analytics.js";
import {
  deriveOverviewFindings, derivePerformanceFindings, deriveCompetencyFindings,
  deriveCareerFindings, deriveQuestionFindings, deriveImprovementFindings,
  deriveDevelopmentFindings, contractIssue, isLive, rankFindings,
} from "./insights.js";
import {
  Btn, Card, PageHeader, SectionTitle, Stat, Alert, EmptyState, Spinner,
  Field, AnonNote, Badge,
} from "./ui.jsx";
import {
  FindingList, ScoreBars, DistributionBar, DeltaBars, TrendLine,
  OpportunityList, SuppressedBlock, KeyStatRow, CalloutPair,
} from "./charts.jsx";

/* ---- style injection (once) ----------------------------------- */
let styleInjected = false;
function useInstitutionalStyle() {
  useEffect(() => {
    if (styleInjected) return;
    const el = document.createElement("style");
    el.dataset.iiStyle = "1";
    el.textContent = INSTITUTIONAL_CSS;
    document.head.appendChild(el);
    styleInjected = true;
  }, []);
}

/* ---- nav model ---------------------------------------------- */
const NAV = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, group: "insights" },
  { key: "performance", label: "Performance", icon: BarChart3, group: "insights" },
  { key: "competencies", label: "Competencies", icon: Radar, group: "insights" },
  { key: "career", label: "Career Insights", icon: Compass, group: "insights" },
  { key: "development", label: "Development Areas", icon: Target, group: "insights" },
  { key: "improvement", label: "Improvement", icon: LineChart, group: "insights" },
  { key: "cohorts", label: "Cohorts & students", icon: Users, group: "manage" },
];

/* =================================================================
 * ROOT
 * ================================================================= */
export default function InstitutionalApp() {
  useInstitutionalStyle();

  const [phase, setPhase] = useState("loading"); // loading | signin | no-access | ready
  const [session, setSession] = useState(null);
  const [institutions, setInstitutions] = useState([]);
  const [activeInstId, setActiveInstId] = useState(null);
  const [authError, setAuthError] = useState("");

  const bootstrap = useCallback(async () => {
    try {
      const s = await getSession();
      if (!s) { setSession(null); setPhase("signin"); return; }
      setSession(s);
      const insts = await api.getMyInstitutions();
      setInstitutions(insts);
      if (!insts.length) { setPhase("no-access"); return; }
      setActiveInstId((prev) => prev || insts[0].institution_id);
      setPhase("ready");
    } catch (e) {
      setAuthError(e.message || "Something went wrong loading your account.");
      setPhase("signin");
    }
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);
  useEffect(() => {
    let cleanup;
    onAuthStateChange((s) => {
      setSession(s);
      if (!s) { setInstitutions([]); setActiveInstId(null); setPhase("signin"); }
    }).then((fn) => { cleanup = fn; });
    return () => { if (cleanup) cleanup(); };
  }, []);

  async function handleSignIn(email, password) {
    setAuthError("");
    try {
      await signInWithPassword(email, password);
      setPhase("loading");
      await bootstrap();
    } catch (e) {
      setAuthError(e.message || "Sign in failed.");
    }
  }

  async function handleSignOut() {
    await signOut();
    setPhase("signin");
  }

  if (phase === "loading") {
    return <div className="ii-root"><Spinner label="Loading Institutional Insights…" /></div>;
  }
  if (phase === "signin") {
    return <div className="ii-root"><SignIn onSubmit={handleSignIn} error={authError} /></div>;
  }
  if (phase === "no-access") {
    return (
      <div className="ii-root">
        <NoAccess email={session?.user?.email} onSignOut={handleSignOut} />
      </div>
    );
  }

  const activeInst = institutions.find((i) => i.institution_id === activeInstId) || institutions[0];
  return (
    <div className="ii-root">
      <Shell
        institutions={institutions}
        activeInst={activeInst}
        onSwitchInstitution={setActiveInstId}
        onSignOut={handleSignOut}
        userEmail={session?.user?.email}
        userId={session?.user?.id}
      />
    </div>
  );
}

/* =================================================================
 * AUTH SURFACES
 * ================================================================= */
function SignIn({ onSubmit, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="ii-authwrap">
      <form
        className="ii-authcard ii-fade"
        onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSubmit(email.trim(), password); setBusy(false); }}
      >
        <div className="ii-brand" style={{ marginBottom: 6 }}>
          <span className="ii-brand-mark">JR</span>
          <span>JOB<span style={{ color: "var(--ii-blue)" }}>.</span>READY</span>
        </div>
        <p className="ii-brand-sub" style={{ color: "var(--ii-text-faint)", marginBottom: 20 }}>Institutional Insights</p>
        <h1 className="ii-h2" style={{ marginBottom: 6 }}>Sign in</h1>
        <p className="ii-text-sm" style={{ marginBottom: 20 }}>
          Use your JOB.READY staff account. Access is granted per institution by JOB.READY.
        </p>
        {error ? <div style={{ marginBottom: 14 }}><Alert tone="error">{error}</Alert></div> : null}
        <Field label="Work email">
          <input className="ii-input" type="email" required autoComplete="username"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input className="ii-input" type="password" required autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Btn variant="accent" type="submit" disabled={busy} style={{ width: "100%", marginTop: 4 }}>
          {busy ? "Signing in…" : "Sign in"}
        </Btn>
      </form>
    </div>
  );
}

function NoAccess({ email, onSignOut }) {
  return (
    <div className="ii-authwrap">
      <div className="ii-authcard ii-fade" style={{ textAlign: "center" }}>
        <div className="ii-empty-icon" style={{ margin: "0 auto 14px" }}><ShieldCheck size={22} /></div>
        <h1 className="ii-h2" style={{ marginBottom: 8 }}>No institutional access</h1>
        <p className="ii-text-sm" style={{ marginBottom: 6 }}>
          <strong>{email}</strong> is a valid JOB.READY account, but it isn’t linked to any
          institution’s Insights workspace yet.
        </p>
        <p className="ii-text-sm" style={{ marginBottom: 20 }}>
          Ask your JOB.READY contact to add you as staff for your institution.
        </p>
        <Btn variant="ghost" onClick={onSignOut}><LogOut size={14} /> Sign out</Btn>
      </div>
    </div>
  );
}

/* =================================================================
 * SHELL
 * ================================================================= */
function Shell({ institutions, activeInst, onSwitchInstitution, onSignOut, userEmail, userId }) {
  const [view, setView] = useState("overview");
  const [filters, setFilters] = useState(emptyFilters());

  // config data for the active institution (cohorts / orgs / members)
  const [config, setConfig] = useState({ loading: true, cohorts: [], organisations: [], members: [], error: "" });

  const loadConfig = useCallback(async (institutionId) => {
    setConfig((c) => ({ ...c, loading: true, error: "" }));
    try {
      const [cohorts, organisations, members] = await Promise.all([
        api.listCohorts(institutionId),
        api.listOrganisations(institutionId),
        api.listCohortMembers(institutionId),
      ]);
      setConfig({ loading: false, cohorts, organisations, members, error: "" });
    } catch (e) {
      setConfig({ loading: false, cohorts: [], organisations: [], members: [], error: e.message || "Couldn't load cohorts." });
    }
  }, []);

  useEffect(() => {
    if (activeInst?.institution_id) {
      loadConfig(activeInst.institution_id);
      setFilters(emptyFilters());
    }
  }, [activeInst?.institution_id, loadConfig]);

  const cohortSummary = useMemo(
    () => summariseCohorts(config.cohorts, config.members, config.organisations),
    [config.cohorts, config.members, config.organisations]
  );

  const canManage = activeInst?.role === "owner" || activeInst?.role === "admin";
  const ctx = {
    institution: activeInst,
    institutionId: activeInst?.institution_id,
    filters, setFilters,
    config, cohortSummary, canManage, userId,
    scopeLabel: describeFilters(filters, cohortSummary),
    reloadConfig: () => loadConfig(activeInst.institution_id),
  };

  return (
    <div className="ii-shell">
      <aside className="ii-sidebar">
        <div className="ii-brand">
          <span className="ii-brand-mark">JR</span>
          <div style={{ lineHeight: 1.1 }}>
            <div>JOB<span style={{ color: "var(--ii-blue)" }}>.</span>READY</div>
            <div className="ii-brand-sub">Insights</div>
          </div>
        </div>
        <nav className="ii-nav">
          {NAV.filter((n) => n.group === "insights").map((n) => (
            <NavLink key={n.key} item={n} active={view === n.key} onClick={() => setView(n.key)} />
          ))}
        </nav>
        <div className="ii-nav-spacer" />
        <nav className="ii-nav">
          {NAV.filter((n) => n.group === "manage").map((n) => (
            <NavLink key={n.key} item={n} active={view === n.key} onClick={() => setView(n.key)} />
          ))}
        </nav>
      </aside>

      <div className="ii-main">
        <div className="ii-topbar">
          <InstitutionSwitcher
            institutions={institutions}
            active={activeInst}
            onSwitch={onSwitchInstitution}
          />
          <div className="ii-row-wrap">
            {view !== "cohorts" ? (
              <CohortFilter cohortSummary={cohortSummary} filters={filters} onChange={setFilters} />
            ) : null}
            <span className="ii-text-sm ii-muted" title={userEmail}>{userEmail}</span>
            <Btn size="sm" variant="ghost" onClick={onSignOut}><LogOut size={13} /> Sign out</Btn>
          </div>
        </div>

        <div className="ii-content ii-fade" key={view}>
          {config.error ? <div style={{ marginBottom: 16 }}><Alert tone="error">{config.error}</Alert></div> : null}
          {view === "overview" && <OverviewView ctx={ctx} />}
          {view === "performance" && <PerformanceView ctx={ctx} />}
          {view === "competencies" && <CompetenciesView ctx={ctx} />}
          {view === "career" && <CareerView ctx={ctx} />}
          {view === "development" && <DevelopmentView ctx={ctx} />}
          {view === "improvement" && <ImprovementView ctx={ctx} />}
          {view === "cohorts" && <CohortsView ctx={ctx} />}
        </div>
      </div>
    </div>
  );
}

function NavLink({ item, active, onClick }) {
  const Icon = item.icon;
  return (
    <button className={`ii-navlink ${active ? "ii-navlink-active" : ""}`} onClick={onClick}>
      <Icon size={16} /> {item.label}
    </button>
  );
}

function InstitutionSwitcher({ institutions, active, onSwitch }) {
  const [open, setOpen] = useState(false);
  const single = institutions.length <= 1;
  return (
    <div style={{ position: "relative" }}>
      <button
        className="ii-btn ii-btn-ghost ii-btn-sm"
        onClick={() => !single && setOpen((o) => !o)}
        style={{ cursor: single ? "default" : "pointer" }}
      >
        <Building2 size={14} />
        <span style={{ fontWeight: 800 }}>{active?.name || "—"}</span>
        <Badge tone="neutral">{active?.role}</Badge>
        {!single ? <ChevronDown size={14} /> : null}
      </button>
      {open && !single ? (
        <div className="ii-card" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30, padding: 6, minWidth: 240 }}>
          {institutions.map((i) => (
            <button key={i.institution_id}
              className={`ii-navlink ${i.institution_id === active?.institution_id ? "ii-navlink-active" : ""}`}
              style={{ color: "var(--ii-text)" }}
              onClick={() => { onSwitch(i.institution_id); setOpen(false); }}>
              <Building2 size={14} /> {i.name}
              <span className="ii-nav-spacer" />
              <span className="ii-text-sm ii-muted">{i.role}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CohortFilter({ cohortSummary, filters, onChange }) {
  const [open, setOpen] = useState(false);
  const rows = cohortSummary?.rows || [];
  const selected = filters.cohortIds || [];
  const toggle = (id) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange({ ...filters, cohortIds: next.length ? next : null });
  };
  return (
    <div style={{ position: "relative" }}>
      <button className="ii-btn ii-btn-ghost ii-btn-sm" onClick={() => setOpen((o) => !o)}>
        <Users size={13} />
        {selected.length ? `${selected.length} cohort${selected.length > 1 ? "s" : ""}` : "All cohorts"}
        <ChevronDown size={13} />
      </button>
      {open ? (
        <div className="ii-card" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30, padding: 10, minWidth: 260, maxHeight: 320, overflowY: "auto" }}>
          <div className="ii-spread" style={{ marginBottom: 8 }}>
            <span className="ii-eyebrow">Filter cohorts</span>
            <button className="ii-btn ii-btn-ghost ii-btn-sm" onClick={() => onChange({ ...filters, cohortIds: null })}>Clear</button>
          </div>
          {rows.length === 0 ? <p className="ii-text-sm ii-muted">No cohorts yet.</p> : null}
          {rows.map((r) => (
            <label key={r.id} className="ii-row" style={{ padding: "6px 2px", cursor: "pointer" }}>
              <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
              <span className="ii-text-sm" style={{ flex: 1 }}>{r.name}</span>
              <span className="ii-text-sm ii-muted">{r.linkedStudents}</span>
            </label>
          ))}
          <hr className="ii-divider" style={{ margin: "10px 0" }} />
          <DateRange filters={filters} onChange={onChange} />
        </div>
      ) : null}
    </div>
  );
}

function DateRange({ filters, onChange }) {
  return (
    <div>
      <span className="ii-eyebrow">Date range</span>
      <div className="ii-row" style={{ marginTop: 6, gap: 8 }}>
        <input className="ii-input ii-btn-sm" type="date" value={filters.from || ""}
          onChange={(e) => onChange({ ...filters, from: e.target.value || null })} />
        <span className="ii-text-sm ii-muted">→</span>
        <input className="ii-input ii-btn-sm" type="date" value={filters.to || ""}
          onChange={(e) => onChange({ ...filters, to: e.target.value || null })} />
      </div>
    </div>
  );
}

/* =================================================================
 * SECTION SCAFFOLDING
 * ================================================================= */

/** Fetch one analytics section for the current scope; re-runs on filter change. */
function useSection(fetcher, ctx) {
  const { institutionId, filters } = ctx;
  const [state, setState] = useState({ loading: true, env: null, error: "" });
  useEffect(() => {
    let dead = false;
    setState({ loading: true, env: null, error: "" });
    fetcher(institutionId, { cohortIds: filters.cohortIds, from: filters.from, to: filters.to })
      .then((env) => { if (!dead) setState({ loading: false, env, error: "" }); })
      .catch((e) => { if (!dead) setState({ loading: false, env: null, error: e.message || "Failed to load." }); });
    return () => { dead = true; };
  }, [institutionId, filters, fetcher]);
  return state;
}

/** Fetch every section in one parallel round (Overview synthesis). */
function useAllSections(ctx) {
  const { institutionId, filters } = ctx;
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  useEffect(() => {
    let dead = false;
    setState({ loading: true, data: null, error: "" });
    api.getAllAnalytics(institutionId, { cohortIds: filters.cohortIds, from: filters.from, to: filters.to })
      .then((data) => { if (!dead) setState({ loading: false, data, error: "" }); })
      .catch((e) => { if (!dead) setState({ loading: false, data: null, error: e.message || "Failed to load." }); });
    return () => { dead = true; };
  }, [institutionId, filters]);
  return state;
}

function SectionHeader({ eyebrow, title, sub, ctx }) {
  const scope = ctx.scopeLabel;
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} sub={sub} />
      <div className="ii-spread" style={{ marginBottom: 18 }}>
        <span className="ii-badge ii-badge-neutral"><Users size={12} /> {scope}</span>
        <span className="ii-anon-note" style={{ marginTop: 0 }}><Lock size={11} /> aggregated · groups under {MIN_COHORT_N} students hidden</span>
      </div>
    </>
  );
}

function LoadState({ label }) { return <Spinner label={label} />; }

function ContractOrError({ error, env }) {
  const issue = error || contractIssue(env);
  if (!issue) return null;
  return <Alert tone={error ? "error" : "warn"}>{issue}</Alert>;
}

/** Shown when a section's headline metric is withheld or empty. */
function NoData({ env, whatFor }) {
  const s = env?.scope || {};
  return (
    <Card>
      <div className="ii-empty">
        <div className="ii-empty-icon"><Lock size={22} /></div>
        <h3 className="ii-h3">Not enough data to report {whatFor}</h3>
        <p className="ii-text-sm" style={{ maxWidth: 460 }}>
          Cohort figures need at least {MIN_COHORT_N} students with interview data in the selected
          scope{s.students_with_data != null ? ` — currently ${s.students_with_data}` : ""}. This protects
          individual students. Add more students to a cohort, widen the date range, or select more cohorts.
        </p>
      </div>
    </Card>
  );
}

/* =================================================================
 * OVERVIEW  — executive summary across every section
 * ================================================================= */
function OverviewView({ ctx }) {
  const { institution, cohortSummary } = ctx;
  const { loading, data, error } = useAllSections(ctx);
  const t = cohortSummary.totals;

  const findings = useMemo(() => {
    if (!data) return [];
    return rankFindings(deriveOverviewFindings({
      overview: data.overview, competencies: data.competencies, improvement: data.improvement,
      developmentAreas: data.developmentAreas, performance: data.performance,
    }));
  }, [data]);

  const ov = data?.overview;
  const perf = ov?.performance;
  const act = ov?.activity;

  return (
    <>
      <PageHeader
        eyebrow="Executive summary"
        title={`How prepared are ${institution?.name || "your"} students for interviews?`}
        sub="What your students' interview practice reveals about their employability — and where support would move the needle. Usage is shown, but it is not the headline."
      />
      <div className="ii-spread" style={{ marginBottom: 18 }}>
        <span className="ii-badge ii-badge-neutral"><Users size={12} /> {ctx.scopeLabel}</span>
        <span className="ii-anon-note" style={{ marginTop: 0 }}><Lock size={11} /> aggregated · groups under {MIN_COHORT_N} students hidden</span>
      </div>

      {loading ? <LoadState label="Building the executive summary…" /> : (
        <>
          <ContractOrError error={error} env={ov} />

          {perf && !perf.suppressed ? (
            <KeyStatRow stats={[
              { label: "Interview-ready", value: `${perf.pct_at_or_above_target ?? 0}%`,
                sub: `mean ${perf.mean_overall} · median ${perf.median_overall}`,
                tone: (perf.pct_at_or_above_target ?? 0) >= 50 ? "good" : (perf.pct_at_or_above_target ?? 0) >= 25 ? "warn" : "bad" },
              { label: "Students with data", value: perf.n_students, sub: `of ${ov?.scope?.students_in_scope ?? "—"} in scope` },
              { label: "Practised", value: act?.coverage_pct != null ? `${act.coverage_pct}%` : "—",
                sub: `${act?.completed_interviews ?? 0} interviews` },
              { label: "Cohorts", value: t.cohorts, sub: t.pendingInvites ? `${t.pendingInvites} invites pending` : "all linked" },
            ]} />
          ) : (
            <KeyStatRow stats={[
              { label: "Linked students", value: t.distinctLinkedStudents, sub: `${t.pendingInvites} pending` },
              { label: "Cohorts", value: t.cohorts },
              { label: "Organisations", value: ctx.config.organisations.length },
              { label: "Reporting threshold", value: MIN_COHORT_N, unit: "min", sub: "students / group" },
            ]} />
          )}

          <Card className="ii-section">
            <SectionTitle hint="derived from this scope's interview data">What the data is telling you</SectionTitle>
            {findings.length
              ? <FindingList findings={findings} />
              : <p className="ii-text-sm ii-muted">
                  {t.cohorts === 0
                    ? "No cohorts yet — add students in Cohorts & students to begin."
                    : `Not enough students with interview data yet (need ${MIN_COHORT_N} per group). Findings appear as cohorts build up practice history.`}
                </p>}
          </Card>

          {data && isLive(data.developmentAreas) && (data.developmentAreas.opportunities || []).length ? (
            <Card className="ii-section">
              <SectionTitle hint="ranked by gap × students affected">Where to focus first</SectionTitle>
              <OpportunityList
                items={topOpportunities(data.developmentAreas, data.improvement, 3)}
                target={data.developmentAreas.readiness_target}
              />
              <p className="ii-text-sm ii-muted" style={{ marginTop: 12 }}>
                Full ranking and per-area detail in <strong>Development Areas</strong>.
              </p>
            </Card>
          ) : null}

          <p className="ii-anon-note"><Lock size={11} /> Every figure is aggregated across students. Any group with fewer than {MIN_COHORT_N} students with data is hidden.</p>
        </>
      )}
    </>
  );
}

function topOpportunities(devEnv, improvementEnv, n) {
  const improveIdx = {};
  if (isLive(improvementEnv)) {
    for (const d of improvementEnv.by_dimension || []) {
      if (!d.suppressed && d.mean_delta != null) improveIdx[d.key] = d.mean_delta;
    }
  }
  return (devEnv.opportunities || []).slice(0, n).map((o) => {
    const label = o.kind === "question_category" ? `${categoryLabel(o.key)} questions` : dimensionLabel(o.key);
    const delta = o.kind === "competency" ? improveIdx[o.key] : undefined;
    let improvingLabel, improvingTone;
    if (delta != null) {
      if (delta >= 3) { improvingLabel = `improving ${delta > 0 ? "+" : ""}${Math.round(delta * 10) / 10}`; improvingTone = "good"; }
      else if (delta <= -3) { improvingLabel = `declining ${Math.round(delta * 10) / 10}`; improvingTone = "bad"; }
      else { improvingLabel = "flat with practice"; improvingTone = "neutral"; }
    }
    return { ...o, label, improvingLabel, improvingTone };
  });
}

/* =================================================================
 * PERFORMANCE
 * ================================================================= */
function PerformanceView({ ctx }) {
  const { loading, env, error } = useSection(api.getPerformance, ctx);
  const findings = useMemo(() => (env ? rankFindings(derivePerformanceFindings(env)) : []), [env]);

  return (
    <>
      <SectionHeader ctx={ctx} eyebrow="Interview performance"
        title="Performance"
        sub="How your students actually perform in practice interviews — overall scores, the spread across the cohort, and how it breaks down by round, format and over time." />
      {loading ? <LoadState label="Loading performance…" /> : (
        <>
          <ContractOrError error={error} env={env} />
          {env && isLive(env) && env.overall && !env.overall.suppressed ? (
            <>
              <FindingList findings={findings} />
              <KeyStatRow stats={[
                { label: "Cohort mean", value: env.overall.mean, sub: `median ${env.overall.median}` },
                { label: "Interview-ready", value: `${env.overall.pct_at_or_above_target}%`,
                  tone: env.overall.pct_at_or_above_target >= 50 ? "good" : env.overall.pct_at_or_above_target >= 25 ? "warn" : "bad" },
                { label: "Middle half", value: `${env.overall.p25}–${env.overall.p75}` },
                { label: "Interviews", value: env.overall.n_interviews, sub: `${env.overall.n_students} students` },
              ]} />

              <Card className="ii-section">
                <SectionTitle>Distribution</SectionTitle>
                <DistributionBar
                  n={env.distribution?.n}
                  min={MIN_COHORT_N}
                  segments={(env.distribution?.buckets || []).map((b) => ({
                    label: bandLabel(b.label), count: b.count,
                    tone: b.label === "strong" || b.label === "solid" ? "good" : b.label === "developing" ? "warn" : "bad",
                  }))}
                />
              </Card>

              <div className="ii-grid ii-grid-2 ii-section">
                <Card>
                  <SectionTitle>By interview round</SectionTitle>
                  <ScoreBars target={env.readiness_target} rows={(env.by_stage || []).map((s) => ({
                    key: s.key, label: stageLabel(s.key), mean: s.mean, suppressed: s.suppressed,
                    n_students: s.n_students, min_n: MIN_COHORT_N,
                  }))} />
                </Card>
                <Card>
                  <SectionTitle>By format</SectionTitle>
                  <ScoreBars target={env.readiness_target} rows={(env.by_format || []).map((s) => ({
                    key: s.key, label: formatLabel(s.key), mean: s.mean, suppressed: s.suppressed,
                    n_students: s.n_students, min_n: MIN_COHORT_N,
                  }))} />
                </Card>
              </div>

              <Card className="ii-section">
                <SectionTitle hint="reportable months only">Trend over time</SectionTitle>
                <TrendLine points={env.trend_monthly} target={env.readiness_target} />
              </Card>
            </>
          ) : <NoData env={env} whatFor="interview performance" />}
          <AnonNote min={MIN_COHORT_N} />
        </>
      )}
    </>
  );
}

/* =================================================================
 * COMPETENCIES
 * ================================================================= */
function CompetenciesView({ ctx }) {
  const { loading, env, error } = useSection(api.getCompetencies, ctx);
  const findings = useMemo(() => (env ? rankFindings(deriveCompetencyFindings(env)) : []), [env]);

  const dims = (env?.dimensions || []);
  const reportable = dims.filter((d) => !d.suppressed && d.mean != null);
  const sorted = [...reportable].sort((a, b) => b.mean - a.mean);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];

  return (
    <>
      <SectionHeader ctx={ctx} eyebrow="Competency performance"
        title="Competencies"
        sub="Cohort strength across the six competency dimensions every interview answer is scored on. Each bar is the mean of students' own averages, so no one student dominates." />
      {loading ? <LoadState label="Loading competencies…" /> : (
        <>
          <ContractOrError error={error} env={env} />
          {env && isLive(env) && reportable.length >= 2 ? (
            <>
              <FindingList findings={findings} />
              {strongest && weakest ? (
                <div className="ii-section">
                  <CalloutPair
                    strong={{ label: dimensionLabel(strongest.key),
                      detail: `Cohort mean ${strongest.mean}${env.competency_average != null ? ` — ${Math.abs(Math.round(strongest.mean - env.competency_average))} pts above the competency average` : ""}.` }}
                    weak={{ label: dimensionLabel(weakest.key),
                      detail: `Cohort mean ${weakest.mean} — ${Math.max(0, Math.round((env.readiness_target ?? 70) - weakest.mean))} pts below interview-ready.` }}
                  />
                </div>
              ) : null}
              <Card className="ii-section">
                <SectionTitle hint={env.competency_average != null ? `competency average ${env.competency_average}` : null}>
                  Six-dimension breakdown
                </SectionTitle>
                <ScoreBars target={env.readiness_target} rows={dims.map((d) => ({
                  key: d.key, label: dimensionLabel(d.key), mean: d.mean, suppressed: d.suppressed,
                  n_students: d.n_students, min_n: MIN_COHORT_N,
                  deltaLabel: d.delta_vs_competency_avg != null
                    ? `${d.delta_vs_competency_avg > 0 ? "+" : ""}${d.delta_vs_competency_avg} vs avg` : null,
                  deltaTone: d.materially_below ? "bad" : d.delta_vs_competency_avg > 0 ? "good" : "neutral",
                }))} />
              </Card>
            </>
          ) : <NoData env={env} whatFor="competency performance" />}
          <AnonNote min={MIN_COHORT_N} />
        </>
      )}
    </>
  );
}

/* =================================================================
 * CAREER INSIGHTS
 * ================================================================= */
function CareerView({ ctx }) {
  const { loading, env, error } = useSection(api.getCareerInsights, ctx);
  const findings = useMemo(() => (env ? rankFindings(deriveCareerFindings(env)) : []), [env]);
  const fams = env?.families || [];
  const reportable = fams.filter((f) => !f.suppressed && f.mean != null);

  return (
    <>
      <SectionHeader ctx={ctx} eyebrow="Career-path performance"
        title="Career Insights"
        sub="How prepared students are for each career path they are practising for. Paths are inferred from the role behind each interview — a documented keyword heuristic, not a definitive classification." />
      {loading ? <LoadState label="Loading career insights…" /> : (
        <>
          <ContractOrError error={error} env={env} />
          {env && isLive(env) ? (
            <>
              <FindingList findings={findings} emptyLabel="No career path has enough students with interview data to report on yet." />
              {reportable.length ? (
                <Card className="ii-section">
                  <SectionTitle hint={env.cross_family_mean != null ? `average across reportable paths ${env.cross_family_mean}` : null}>
                    Performance by career path
                  </SectionTitle>
                  <ScoreBars target={env.readiness_target} rows={fams.map((f) => ({
                    key: f.key, label: roleFamilyLabel(f.key), mean: f.mean, suppressed: f.suppressed,
                    n_students: f.n_students, min_n: MIN_COHORT_N,
                    deltaLabel: f.delta_vs_cross_family != null
                      ? `${f.delta_vs_cross_family > 0 ? "+" : ""}${f.delta_vs_cross_family} vs avg` : null,
                    deltaTone: f.delta_vs_cross_family < 0 ? "bad" : f.delta_vs_cross_family > 0 ? "good" : "neutral",
                  }))} />
                  <p className="ii-text-sm ii-muted" style={{ marginTop: 10 }}>
                    {env.families_reportable} of {env.families_total} career paths meet the {MIN_COHORT_N}-student reporting threshold.
                  </p>
                </Card>
              ) : (
                <NoData env={env} whatFor="career-path performance" />
              )}
            </>
          ) : <NoData env={env} whatFor="career-path performance" />}
          <AnonNote min={MIN_COHORT_N} />
        </>
      )}
    </>
  );
}

/* =================================================================
 * DEVELOPMENT AREAS
 * ================================================================= */
function DevelopmentView({ ctx }) {
  const dev = useSection(api.getDevelopmentAreas, ctx);
  const imp = useSection(api.getImprovement, ctx);
  const qp = useSection(api.getQuestionPerformance, ctx);
  const loading = dev.loading || imp.loading;
  const findings = useMemo(
    () => (dev.env ? rankFindings(deriveDevelopmentFindings(dev.env, imp.env)) : []),
    [dev.env, imp.env]
  );
  const qFindings = useMemo(() => (qp.env ? rankFindings(deriveQuestionFindings(qp.env)) : []), [qp.env]);

  return (
    <>
      <SectionHeader ctx={ctx} eyebrow="Cohort development opportunities"
        title="Development Areas"
        sub="The specific, recurring things holding students back — competency dimensions and question types where the cohort is below interview-ready — ranked by how far below and how many students are affected." />
      {loading ? <LoadState label="Loading development areas…" /> : (
        <>
          <ContractOrError error={dev.error} env={dev.env} />
          {dev.env && isLive(dev.env) && (dev.env.opportunities || []).length ? (
            <>
              <FindingList findings={findings} />
              <Card className="ii-section">
                <SectionTitle hint={dev.env.method ? "gap × share of students below interview-ready" : null}>
                  Ranked opportunities
                </SectionTitle>
                <OpportunityList
                  items={topOpportunities(dev.env, imp.env, 20)}
                  target={dev.env.readiness_target}
                />
              </Card>
              {qFindings.length ? (
                <Card className="ii-section">
                  <SectionTitle hint="canonical question categories">Which question types are hardest</SectionTitle>
                  <FindingList findings={qFindings} compact />
                  {isLive(qp.env) ? (
                    <div style={{ marginTop: 12 }}>
                      <ScoreBars target={qp.env.readiness_target} rows={(qp.env.categories || []).map((c) => ({
                        key: c.key, label: categoryLabel(c.key), mean: c.mean, suppressed: c.suppressed,
                        n_students: c.n_students, min_n: MIN_COHORT_N,
                      }))} />
                    </div>
                  ) : null}
                </Card>
              ) : null}
            </>
          ) : <NoData env={dev.env} whatFor="development opportunities" />}
          <AnonNote min={MIN_COHORT_N} />
        </>
      )}
    </>
  );
}

/* =================================================================
 * IMPROVEMENT
 * ================================================================= */
function ImprovementView({ ctx }) {
  const { loading, env, error } = useSection(api.getImprovement, ctx);
  const findings = useMemo(() => (env ? rankFindings(deriveImprovementFindings(env)) : []), [env]);
  const o = env?.overall;
  const s = env?.scope || {};

  return (
    <>
      <SectionHeader ctx={ctx} eyebrow="Improvement over repeated practice"
        title="Improvement"
        sub="Whether students get better as they practise more. Measured per student first — the change from their first interview to their latest — then averaged. It is never a comparison of two arbitrary interviews." />
      {loading ? <LoadState label="Loading improvement…" /> : (
        <>
          <ContractOrError error={error} env={env} />
          {env && isLive(env) && o && !o.suppressed ? (
            <>
              <FindingList findings={findings} />
              <KeyStatRow stats={[
                { label: "Avg change (first → latest)", value: `${o.mean_delta > 0 ? "+" : ""}${o.mean_delta}`, unit: "pts",
                  tone: o.mean_delta >= 3 ? "good" : o.mean_delta <= -3 ? "bad" : "neutral" },
                { label: "Median change", value: `${o.median_delta > 0 ? "+" : ""}${o.median_delta}`, unit: "pts" },
                { label: "Improving", value: `${o.pct_improving}%`, tone: o.pct_improving >= 50 ? "good" : "warn" },
                { label: "Students measured", value: o.n_students, sub: `${s.students_with_repeat_practice} practised repeatedly` },
              ]} />
              <Card className="ii-section">
                <SectionTitle hint="change across repeated practice, per dimension">By competency dimension</SectionTitle>
                <DeltaBars rows={(env.by_dimension || []).map((d) => ({
                  key: d.key, label: dimensionLabel(d.key), delta: d.mean_delta, suppressed: d.suppressed,
                  n_students: d.n_students, min_n: MIN_COHORT_N,
                }))} />
              </Card>
              <p className="ii-text-sm ii-muted">{env.method}</p>
            </>
          ) : (
            <Card>
              <div className="ii-empty">
                <div className="ii-empty-icon"><LineChart size={22} /></div>
                <h3 className="ii-h3">Not enough repeated practice to measure improvement</h3>
                <p className="ii-text-sm" style={{ maxWidth: 480 }}>
                  Improvement is measured within each student, across their own interviews.
                  {" "}{s.students_with_repeat_practice ?? 0} student{(s.students_with_repeat_practice ?? 0) === 1 ? " has" : "s have"} completed
                  more than one interview in this scope; {MIN_COHORT_N} are needed to report a cohort figure.
                </p>
              </div>
            </Card>
          )}
          <AnonNote min={MIN_COHORT_N} />
        </>
      )}
    </>
  );
}

function bandLabel(k) {
  return { strong: "Strong (75+)", solid: "Solid (60–74)", developing: "Developing (45–59)", priority: "Priority (<45)" }[k] || k;
}
function formatLabel(k) {
  return {
    asynchronous_video: "Async video", live_conversational: "Live conversation",
    technical: "Technical", unspecified: "Unspecified",
  }[k] || k;
}

/* =================================================================
 * COHORTS & STUDENTS (fully functional in Milestone 1)
 * ================================================================= */
function CohortsView({ ctx }) {
  const { config, cohortSummary, canManage, institutionId, reloadConfig, userId } = ctx;
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const [newCohort, setNewCohort] = useState({ name: "", academicYear: "", graduationYear: "", organisationId: "" });
  const [newOrg, setNewOrg] = useState({ name: "", kind: "society" });
  const [addTo, setAddTo] = useState({ cohortId: "", emails: "" });

  async function doCreateCohort(e) {
    e.preventDefault();
    if (!newCohort.name.trim()) return;
    setBusy("cohort"); setNotice("");
    try {
      await api.createCohort(institutionId, {
        name: newCohort.name.trim(),
        organisationId: newCohort.organisationId || null,
        academicYear: newCohort.academicYear.trim() || null,
        graduationYear: newCohort.graduationYear ? Number(newCohort.graduationYear) : null,
      });
      setNewCohort({ name: "", academicYear: "", graduationYear: "", organisationId: "" });
      setNotice("Cohort created.");
      await reloadConfig();
    } catch (err) { setNotice(err.message || "Couldn't create cohort."); }
    setBusy("");
  }

  async function doCreateOrg(e) {
    e.preventDefault();
    if (!newOrg.name.trim()) return;
    setBusy("org"); setNotice("");
    try {
      await api.createOrganisation(institutionId, { name: newOrg.name.trim(), kind: newOrg.kind });
      setNewOrg({ name: "", kind: "society" });
      setNotice("Organisation created.");
      await reloadConfig();
    } catch (err) { setNotice(err.message || "Couldn't create organisation."); }
    setBusy("");
  }

  async function doAddMembers(e) {
    e.preventDefault();
    const emails = addTo.emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!addTo.cohortId || !emails.length) return;
    setBusy("members"); setNotice("");
    try {
      const { added, linked } = await api.addCohortMembersByEmail(institutionId, addTo.cohortId, emails, userId);
      setAddTo({ cohortId: "", emails: "" });
      setNotice(`Added ${added} member${added === 1 ? "" : "s"}. ${linked} linked to an existing JOB.READY account now; the rest link automatically when they sign up.`);
      await reloadConfig();
    } catch (err) { setNotice(err.message || "Couldn't add members."); }
    setBusy("");
  }

  async function doReconcile() {
    setBusy("reconcile"); setNotice("");
    try {
      const { linked } = await api.reconcileCohortMembers(institutionId);
      setNotice(linked ? `Linked ${linked} newly-registered student${linked === 1 ? "" : "s"}.` : "No new students to link.");
      await reloadConfig();
    } catch (err) { setNotice(err.message || "Couldn't reconcile."); }
    setBusy("");
  }

  return (
    <>
      <PageHeader
        eyebrow="Setup"
        title="Cohorts &amp; students"
        sub="Define your cohorts and add students by email. Each student connects to their existing JOB.READY account — Institutional Insights never creates a second student record."
        actions={canManage ? (
          <Btn size="sm" variant="ghost" onClick={doReconcile} disabled={busy === "reconcile"}>
            <RefreshCw size={13} /> {busy === "reconcile" ? "Linking…" : "Link new sign-ups"}
          </Btn>
        ) : null}
      />

      {notice ? <div style={{ marginBottom: 16 }}><Alert tone="info">{notice}</Alert></div> : null}
      {!canManage ? <div style={{ marginBottom: 16 }}><Alert tone="info">Your role is <strong>{ctx.institution.role}</strong> — read-only. Ask an admin to change the roster.</Alert></div> : null}

      <Card className="ii-section">
        <SectionTitle hint={`${cohortSummary.totals.distinctLinkedStudents} students linked · ${cohortSummary.totals.pendingInvites} pending`}>
          Cohorts
        </SectionTitle>
        {config.loading ? <Spinner /> : cohortSummary.rows.length === 0 ? (
          <EmptyState title="No cohorts yet">Create one below to start.</EmptyState>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ii-text-faint)" }}>
                  <th style={{ padding: "8px 10px" }}>Cohort</th>
                  <th style={{ padding: "8px 10px" }}>Organisation</th>
                  <th style={{ padding: "8px 10px" }}>Year</th>
                  <th style={{ padding: "8px 10px" }}>Linked</th>
                  <th style={{ padding: "8px 10px" }}>Pending</th>
                  <th style={{ padding: "8px 10px" }}>Reportable</th>
                </tr>
              </thead>
              <tbody>
                {cohortSummary.rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--ii-border)" }}>
                    <td style={{ padding: "10px", fontWeight: 700 }}>{r.name}</td>
                    <td style={{ padding: "10px" }}>{r.organisation || <span className="ii-muted">—</span>}</td>
                    <td style={{ padding: "10px" }}>{r.academicYear || r.graduationYear || <span className="ii-muted">—</span>}</td>
                    <td style={{ padding: "10px" }} className="ii-mono-num">{r.linkedStudents}</td>
                    <td style={{ padding: "10px" }} className="ii-mono-num">{r.pendingInvites || 0}</td>
                    <td style={{ padding: "10px" }}>
                      {r.belowThreshold
                        ? <Badge tone="neutral">n&lt;{MIN_COHORT_N}</Badge>
                        : <Badge tone="good">yes</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canManage ? (
        <div className="ii-grid ii-grid-2 ii-section">
          <Card>
            <SectionTitle>New cohort</SectionTitle>
            <form onSubmit={doCreateCohort}>
              <Field label="Name"><input className="ii-input" value={newCohort.name}
                onChange={(e) => setNewCohort({ ...newCohort, name: e.target.value })}
                placeholder="e.g. BSc Economics 2026" /></Field>
              <div className="ii-grid ii-grid-2" style={{ gap: 12 }}>
                <Field label="Academic year"><input className="ii-input" value={newCohort.academicYear}
                  onChange={(e) => setNewCohort({ ...newCohort, academicYear: e.target.value })}
                  placeholder="2025/26" /></Field>
                <Field label="Graduation year"><input className="ii-input" type="number" value={newCohort.graduationYear}
                  onChange={(e) => setNewCohort({ ...newCohort, graduationYear: e.target.value })}
                  placeholder="2026" /></Field>
              </div>
              <Field label="Organisation / society (optional)">
                <select className="ii-input ii-select" value={newCohort.organisationId}
                  onChange={(e) => setNewCohort({ ...newCohort, organisationId: e.target.value })}>
                  <option value="">— none —</option>
                  {config.organisations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </Field>
              <Btn variant="accent" type="submit" disabled={busy === "cohort"}>
                {busy === "cohort" ? "Creating…" : "Create cohort"}
              </Btn>
            </form>
          </Card>

          <Card>
            <SectionTitle>New organisation / society</SectionTitle>
            <form onSubmit={doCreateOrg}>
              <Field label="Name"><input className="ii-input" value={newOrg.name}
                onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
                placeholder="e.g. Investment Banking Society" /></Field>
              <Field label="Kind">
                <select className="ii-input ii-select" value={newOrg.kind}
                  onChange={(e) => setNewOrg({ ...newOrg, kind: e.target.value })}>
                  <option value="society">Society</option>
                  <option value="department">Department</option>
                  <option value="careers_service">Careers service</option>
                  <option value="programme">Programme</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Btn variant="accent" type="submit" disabled={busy === "org"}>
                {busy === "org" ? "Creating…" : "Create organisation"}
              </Btn>
            </form>
          </Card>

          <Card style={{ gridColumn: "1 / -1" }}>
            <SectionTitle hint="One per line, or comma-separated">Add students to a cohort</SectionTitle>
            <form onSubmit={doAddMembers}>
              <Field label="Cohort">
                <select className="ii-input ii-select" value={addTo.cohortId}
                  onChange={(e) => setAddTo({ ...addTo, cohortId: e.target.value })}>
                  <option value="">— choose —</option>
                  {config.cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Student emails">
                <textarea className="ii-input" rows={5} value={addTo.emails}
                  onChange={(e) => setAddTo({ ...addTo, emails: e.target.value })}
                  placeholder={"alex@university.ac.uk\njordan@university.ac.uk"} />
              </Field>
              <p className="ii-text-sm ii-muted" style={{ marginBottom: 12 }}>
                Emails that already have a JOB.READY account link immediately. The rest are held
                as pending invites and link automatically when the student signs up with that email.
                No email is sent from here.
              </p>
              <Btn variant="accent" type="submit" disabled={busy === "members"}>
                {busy === "members" ? "Adding…" : "Add students"}
              </Btn>
            </form>
          </Card>
        </div>
      ) : null}
    </>
  );
}
