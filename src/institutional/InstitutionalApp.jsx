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
  Users, LogOut, Building2, ChevronDown, ShieldCheck, RefreshCw,
} from "lucide-react";
import { INSTITUTIONAL_CSS } from "./theme.js";
import { MIN_COHORT_N } from "./taxonomy.js";
import {
  getSession, signInWithPassword, signOut, onAuthStateChange,
} from "./supabaseClient.js";
import * as api from "./api.js";
import {
  summariseCohorts, emptyFilters, describeFilters,
} from "./analytics.js";
import {
  Btn, Card, PageHeader, SectionTitle, Stat, Alert, EmptyState, Spinner,
  PendingMetric, Field, AnonNote, Badge,
} from "./ui.jsx";

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
          {view === "performance" && <AnalyticsView ctx={ctx} title="Performance" eyebrow="Interview performance"
            sub="How your students actually perform in practice interviews — overall scores, readiness, and how that splits by round, format and cohort."
            metricName="Interview-performance analytics" fetcher={api.getPerformance} />}
          {view === "competencies" && <AnalyticsView ctx={ctx} title="Competencies" eyebrow="Competency performance"
            sub="Cohort strength across the six competency dimensions every answer is scored on, with the strongest and weakest areas surfaced."
            metricName="Competency analytics" fetcher={api.getCompetencies} />}
          {view === "career" && <AnalyticsView ctx={ctx} title="Career Insights" eyebrow="Career-path performance"
            sub="Where students are applying and how prepared they are for each career path, based on the roles behind their practice interviews."
            metricName="Career-path analytics" fetcher={api.getCareerInsights} />}
          {view === "development" && <AnalyticsView ctx={ctx} title="Development Areas" eyebrow="Cohort development opportunities"
            sub="The specific, recurring things holding your students back — ranked by how many students they affect and how far below target they are."
            metricName="Development-opportunity analytics" fetcher={api.getDevelopmentAreas} />}
          {view === "improvement" && <AnalyticsView ctx={ctx} title="Improvement" eyebrow="Improvement over repeated practice"
            sub="Whether students get better as they practise more — measured per student first, then averaged, so it is never a comparison of arbitrary interviews."
            metricName="Improvement analytics" fetcher={api.getImprovement} />}
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
 * OVERVIEW
 * ================================================================= */
function OverviewView({ ctx }) {
  const { cohortSummary, config, institution, filters } = ctx;
  const t = cohortSummary.totals;

  return (
    <>
      <PageHeader
        eyebrow="Executive summary"
        title={`How prepared are ${institution?.name || "your"} students for interviews?`}
        sub="A single view of your students' interview readiness and where preparation support would move the needle. Usage is deliberately not the headline — this answers what practice reveals about employability."
      />

      {config.loading ? <Spinner label="Loading foundation…" /> : (
        <>
          <div className="ii-section ii-grid ii-grid-4">
            <Stat label="Cohorts" value={t.cohorts} />
            <Stat label="Linked students" value={t.distinctLinkedStudents}
              sub={t.pendingInvites ? `${t.pendingInvites} invite${t.pendingInvites > 1 ? "s" : ""} pending` : "all invites linked"} />
            <Stat label="Organisations / societies" value={config.organisations.length} />
            <Stat label="Reporting threshold" value={MIN_COHORT_N} unit="min"
              sub="students per group" />
          </div>

          <Card className="ii-section">
            <SectionTitle hint={describeFilters(filters, cohortSummary)}>Interview readiness</SectionTitle>
            <EmptyState title="Readiness analytics arrive in Milestone 2">
              Overall interview performance, readiness distribution, strongest and weakest
              competencies and cohort development opportunities are computed by the
              server-side analytics engine (Milestone 2). The institutional foundation —
              institutions, organisations, cohorts and the link to existing JOB.READY
              student accounts — is in place now.
            </EmptyState>
            <AnonNote min={MIN_COHORT_N} />
          </Card>

          {t.cohorts === 0 ? (
            <Alert tone="info">
              No cohorts yet. Go to <strong>Cohorts &amp; students</strong> to create your first
              cohort and add students by email — they connect automatically to their existing
              JOB.READY accounts.
            </Alert>
          ) : t.distinctLinkedStudents < MIN_COHORT_N ? (
            <Alert tone="warn">
              Only {t.distinctLinkedStudents} student{t.distinctLinkedStudents === 1 ? "" : "s"} linked
              so far. Cohort figures stay hidden until at least {MIN_COHORT_N} students in a group have
              interview data, to protect individual students.
            </Alert>
          ) : null}
        </>
      )}
    </>
  );
}

/* =================================================================
 * GENERIC ANALYTICS VIEW (Milestone 2 fills these in)
 * ================================================================= */
function AnalyticsView({ ctx, title, eyebrow, sub, metricName, fetcher }) {
  const { institutionId, filters, cohortSummary } = ctx;
  const [state, setState] = useState({ loading: true, data: null, error: "" });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, data: null, error: "" });
    fetcher(institutionId, {
      cohortIds: filters.cohortIds, from: filters.from, to: filters.to,
    }).then((data) => {
      if (!cancelled) setState({ loading: false, data, error: "" });
    }).catch((e) => {
      if (!cancelled) setState({ loading: false, data: null, error: e.message || "Failed to load." });
    });
    return () => { cancelled = true; };
  }, [institutionId, filters, fetcher]);

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} sub={sub} />
      <div className="ii-spread" style={{ marginBottom: 14 }}>
        <span className="ii-text-sm ii-muted">{describeFilters(filters, cohortSummary)}</span>
      </div>
      {state.loading ? <Spinner label={`Loading ${title.toLowerCase()}…`} />
        : state.error ? <Alert tone="error">{state.error}</Alert>
        : <PendingMetric what={metricName} />}
      <div style={{ marginTop: 14 }}><AnonNote min={MIN_COHORT_N} /></div>
    </>
  );
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
