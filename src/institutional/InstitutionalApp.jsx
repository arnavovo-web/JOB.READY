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
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, BarChart3, Radar, Compass, Target, LineChart,
  Users, LogOut, Building2, ChevronDown, ShieldCheck, RefreshCw, Lock,
  CalendarClock, Clock, ArrowLeft, CheckCircle2, XCircle, Sparkles, Briefcase, MessageSquareText, Plus, Trash2,
} from "lucide-react";
import { INSTITUTIONAL_CSS } from "./theme.js";
import {
  MIN_COHORT_N, dimensionLabel, categoryLabel, roleFamilyLabel, stageLabel,
} from "./taxonomy.js";
import {
  getSession, signInWithPassword, signOut, onAuthStateChange,
} from "./supabaseClient.js";
import * as api from "./api.js";
import { summariseCohorts, emptyFilters, describeFilters } from "./analytics.js";
import {
  shapeBriefing, deriveBriefingSummary, groupAppointmentsByDay, statusMeta,
  bandTone, bandWord, dateTimeLabel, timeRange, repeatedDevelopmentSentence, trendSentence,
} from "./appointments.js";
import {
  deriveOverviewFindings, derivePerformanceFindings, deriveCompetencyFindings,
  deriveCareerFindings, deriveQuestionFindings, deriveImprovementFindings,
  deriveDevelopmentFindings, contractIssue, isLive, rankFindings,
} from "./insights.js";
import {
  Btn, Card, PageHeader, SectionTitle, Alert, EmptyState, Spinner, Field, AnonNote, Badge,
} from "./ui.jsx";
import {
  FindingList, ScoreBars, DistributionBar, DeltaBars, TrendLine,
  OpportunityList, KeyStatRow, CalloutPair,
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

/* ---- product identity --------------------------------------- */
export const EKI_FULL_NAME = "Employability Knowledge Intelligence Interface";
export const EKI_SHORT = "EKI²";

/* ---- nav model ---------------------------------------------- */
const NAV = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, group: "insights" },
  { key: "performance", label: "Performance", icon: BarChart3, group: "insights" },
  { key: "competencies", label: "Competencies", icon: Radar, group: "insights" },
  { key: "career", label: "Career Insights", icon: Compass, group: "insights" },
  { key: "development", label: "Development Areas", icon: Target, group: "insights" },
  { key: "improvement", label: "Improvement", icon: LineChart, group: "insights" },
  { key: "appointments", label: "Appointments", icon: CalendarClock, group: "work" },
  { key: "cohorts", label: "Cohorts & students", icon: Users, group: "manage" },
];

/* =================================================================
 * ROOT
 * ================================================================= */
export default function InstitutionalApp() {
  useInstitutionalStyle();
  useEffect(() => {
    const prev = document.title;
    document.title = `${EKI_SHORT} · JOB.READY`;
    return () => { document.title = prev; };
  }, []);

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
/** Left-hand identity panel shared by the sign-in and no-access screens. */
function AuthBrandPanel() {
  return (
    <div className="ii-authbrand">
      <div className="ii-authbrand-inner">
        <div className="ii-authbrand-kicker">JOB<span style={{ color: "#93b4ff" }}>.</span>READY</div>
        <h1 className="ii-authbrand-name">{EKI_FULL_NAME}</h1>
        <div className="ii-authbrand-short" aria-label="E K I squared">{EKI_SHORT}</div>
        <p className="ii-authbrand-blurb">
          The institutional interface for university careers and employability teams.
          Aggregated intelligence from your students' JOB.READY interview practice —
          and the appointment workflow that turns it into targeted support.
        </p>
        <ul className="ii-authbrand-points">
          <li><Radar size={13} /> Cohort competency &amp; readiness intelligence</li>
          <li><Target size={13} /> Ranked, evidence-based development areas</li>
          <li><CalendarClock size={13} /> Careers appointments with a per-student briefing</li>
        </ul>
      </div>
      <div className="ii-authbrand-foot">Access is provisioned per institution by JOB.READY.</div>
    </div>
  );
}

function SignIn({ onSubmit, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="ii-authsplit">
      <AuthBrandPanel />
      <div className="ii-authform-wrap">
        <form
          className="ii-authform ii-fade"
          onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSubmit(email.trim(), password); setBusy(false); }}
        >
          <p className="ii-eyebrow" style={{ marginBottom: 6 }}>{EKI_SHORT} — institutional sign in</p>
          <h2 className="ii-h1" style={{ marginBottom: 8 }}>Sign in to your workspace</h2>
          <p className="ii-text-sm" style={{ marginBottom: 22 }}>
            Use the JOB.READY account your institution registered with the careers team.
          </p>
          {error ? <div style={{ marginBottom: 14 }}><Alert tone="error">{error}</Alert></div> : null}
          <Field label="Work email">
            <input className="ii-input" type="email" required autoComplete="username"
              placeholder="you@university.ac.uk"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <input className="ii-input" type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Btn variant="accent" type="submit" disabled={busy} style={{ width: "100%", marginTop: 4 }}>
            {busy ? "Signing in…" : "Sign in"}
          </Btn>
          <p className="ii-text-sm ii-muted" style={{ marginTop: 18 }}>
            Trouble signing in? Contact your JOB.READY institutional partner.
          </p>
        </form>
      </div>
    </div>
  );
}

function NoAccess({ email, onSignOut }) {
  return (
    <div className="ii-authsplit">
      <AuthBrandPanel />
      <div className="ii-authform-wrap">
        <div className="ii-authform ii-fade">
          <div className="ii-empty-icon" style={{ marginBottom: 14 }}><ShieldCheck size={22} /></div>
          <h2 className="ii-h1" style={{ marginBottom: 8 }}>No workspace linked</h2>
          <p className="ii-text-sm" style={{ marginBottom: 6 }}>
            <strong>{email}</strong> is a valid JOB.READY account, but it isn't yet
            authorised for any institution's {EKI_SHORT} workspace.
          </p>
          <p className="ii-text-sm" style={{ marginBottom: 22 }}>
            Ask your institution's {EKI_SHORT} administrator, or your JOB.READY partner,
            to add you as a careers-team member.
          </p>
          <Btn variant="ghost" onClick={onSignOut}><LogOut size={14} /> Sign out</Btn>
        </div>
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
          <div style={{ lineHeight: 1.15 }}>
            <div className="ii-brand-eki" aria-label="E K I squared">{EKI_SHORT}</div>
            <div className="ii-brand-sub">JOB.READY · Employability Intelligence</div>
          </div>
        </div>
        <nav className="ii-nav">
          <div className="ii-nav-heading">Intelligence</div>
          {NAV.filter((n) => n.group === "insights").map((n) => (
            <NavLink key={n.key} item={n} active={view === n.key} onClick={() => setView(n.key)} />
          ))}
          <div className="ii-nav-heading" style={{ marginTop: 14 }}>Careers work</div>
          {NAV.filter((n) => n.group === "work").map((n) => (
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
            {!["cohorts", "appointments"].includes(view) ? (
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
          {view === "appointments" && <AppointmentsView ctx={ctx} />}
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

/* =================================================================
 * APPOINTMENTS  (careers-team schedule + student intelligence briefing)
 * ================================================================= */
const APPT_STATUS_FILTERS = [
  { key: "upcoming", label: "Upcoming", statuses: ["booked"], futureOnly: true },
  { key: "booked", label: "All booked", statuses: ["booked"] },
  { key: "completed", label: "Completed", statuses: ["completed"] },
  { key: "cancelled", label: "Cancelled/missed", statuses: ["cancelled", "no_show"] },
  { key: "all", label: "Everything", statuses: null },
];

function AppointmentsView({ ctx }) {
  const { institutionId, institution, userId } = ctx;
  const [tab, setTab] = useState("schedule");
  const [selected, setSelected] = useState(null); // appointment id

  if (selected) {
    return <AppointmentDetail ctx={ctx} appointmentId={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <>
      <PageHeader
        eyebrow="Careers work"
        title="Appointments"
        sub={`Students book careers appointments from JOB.READY. Open one to see a focused, authorised preparation briefing for that student — ${institution?.name || "your institution"} only.`}
        actions={
          <div className="ii-row" style={{ gap: 6 }}>
            <Btn size="sm" variant={tab === "schedule" ? "primary" : "ghost"} onClick={() => setTab("schedule")}>Schedule</Btn>
            <Btn size="sm" variant={tab === "availability" ? "primary" : "ghost"} onClick={() => setTab("availability")}>My availability</Btn>
          </div>
        }
      />
      {tab === "schedule"
        ? <ScheduleTab institutionId={institutionId} onOpen={setSelected} />
        : <AvailabilityTab institutionId={institutionId} userId={userId} />}
    </>
  );
}

function ScheduleTab({ institutionId, onOpen }) {
  const [statusKey, setStatusKey] = useState("upcoming");
  const [state, setState] = useState({ loading: true, rows: [], error: "" });

  const filter = APPT_STATUS_FILTERS.find((f) => f.key === statusKey) || APPT_STATUS_FILTERS[0];

  useEffect(() => {
    let dead = false;
    setState({ loading: true, rows: [], error: "" });
    const from = filter.futureOnly ? new Date(Date.now() - 6 * 3600e3).toISOString() : new Date(Date.now() - 400 * 24 * 3600e3).toISOString();
    const to = new Date(Date.now() + 120 * 24 * 3600e3).toISOString();
    api.listInstitutionAppointments(institutionId, { from, to, statuses: filter.statuses })
      .then((rows) => { if (!dead) setState({ loading: false, rows, error: "" }); })
      .catch((e) => { if (!dead) setState({ loading: false, rows: [], error: e.message || "Failed to load." }); });
    return () => { dead = true; };
  }, [institutionId, statusKey]);

  const groups = useMemo(() => groupAppointmentsByDay(state.rows), [state.rows]);

  return (
    <>
      <div className="ii-row-wrap ii-section" style={{ gap: 6 }}>
        {APPT_STATUS_FILTERS.map((f) => (
          <button key={f.key} className={`ii-chip ${statusKey === f.key ? "ii-chip-active" : ""}`} onClick={() => setStatusKey(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {state.loading ? <Spinner label="Loading the schedule…" />
        : state.error ? <Alert tone="error">{state.error}</Alert>
        : !groups.length ? (
          <Card><EmptyState title="No appointments here yet">
            When a student books a careers appointment from JOB.READY it appears here. Publish
            availability under <strong>My availability</strong> so students can book.
          </EmptyState></Card>
        ) : (
          <div className="ii-appt-days">
            {groups.map((g) => (
              <div key={g.key} className="ii-appt-day">
                <div className="ii-appt-daylabel">{g.label}</div>
                <div className="ii-appt-list">
                  {g.items.map((a) => {
                    const st = statusMeta(a.status);
                    return (
                      <button key={a.id} className="ii-appt-row" onClick={() => onOpen(a.id)}>
                        <span className="ii-appt-time"><Clock size={13} /> {timeRange(a.starts_at, a.ends_at)}</span>
                        <span className="ii-appt-student">{a.student_name || "Student"}</span>
                        <span className="ii-appt-type">{a.type_label}</span>
                        {a.has_application ? <span className="ii-badge ii-badge-info"><Briefcase size={11} /> application</span> : null}
                        <span className="ii-nav-spacer" />
                        <span className={`ii-badge ii-badge-${st.tone === "info" ? "info" : st.tone === "good" ? "good" : st.tone === "warn" ? "warn" : "neutral"}`}>{st.label}</span>
                        <span className="ii-appt-open">Open briefing →</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
    </>
  );
}

/* ---- the key screen: student intelligence briefing ------------- */
function AppointmentDetail({ ctx, appointmentId, onBack }) {
  const [state, setState] = useState({ loading: true, raw: null, error: "" });
  const [actionBusy, setActionBusy] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    setState({ loading: true, raw: null, error: "" });
    api.getStudentBriefing(appointmentId)
      .then((raw) => setState({ loading: false, raw, error: "" }))
      .catch((e) => setState({ loading: false, raw: null, error: e.message || "Couldn't load this briefing." }));
  }, [appointmentId]);
  useEffect(load, [load]);

  const shaped = useMemo(() => shapeBriefing(state.raw), [state.raw]);
  const summary = useMemo(() => deriveBriefingSummary(shaped), [shaped]);

  async function act(status) {
    setActionBusy(status); setNotice("");
    try {
      await api.setAppointmentStatus(appointmentId, status);
      setNotice(`Marked ${statusMeta(status).label.toLowerCase()}.`);
      load();
    } catch (e) { setNotice(e.message || "Couldn't update."); }
    setActionBusy("");
  }

  return (
    <>
      <button className="ii-btn ii-btn-ghost ii-btn-sm" style={{ marginBottom: 16 }} onClick={onBack}>
        <ArrowLeft size={13} /> Back to schedule
      </button>

      {state.loading ? <Spinner label="Preparing the briefing…" />
        : state.error ? <Alert tone="error">{state.error}</Alert>
        : !shaped ? <Alert tone="warn">No briefing data.</Alert>
        : (
          <>
            <PageHeader
              eyebrow="Appointment briefing"
              title={shaped.student.name || "Student briefing"}
              sub={`${shaped.appointment.typeLabel}${shaped.appointment.startsAt ? ` · ${dateTimeLabel(shaped.appointment.startsAt)}` : ""}`}
            />
            {notice ? <div style={{ marginBottom: 14 }}><Alert tone="info">{notice}</Alert></div> : null}

            <BriefingSummaryCard summary={summary} shaped={shaped} />

            <div className="ii-grid ii-grid-2 ii-section">
              <StudentOverviewCard shaped={shaped} />
              <ApplicationCard app={shaped.application} />
            </div>

            <InterviewDnaCard dna={shaped.dna} target={shaped.target} />

            <PatternsCard shaped={shaped} />

            <Card className="ii-section">
              <SectionTitle hint="does not notify the student">Mark this appointment</SectionTitle>
              <div className="ii-row-wrap" style={{ gap: 8 }}>
                <Btn size="sm" variant="ghost" disabled={actionBusy} onClick={() => act("completed")}><CheckCircle2 size={13} /> Completed</Btn>
                <Btn size="sm" variant="ghost" disabled={actionBusy} onClick={() => act("no_show")}><XCircle size={13} /> No-show</Btn>
                <Btn size="sm" variant="ghost" disabled={actionBusy} onClick={() => act("cancelled")}>Cancel appointment</Btn>
              </div>
            </Card>

            <p className="ii-anon-note">
              <Lock size={11} /> Authorised individual briefing. Derived from this student's JOB.READY
              interview practice and their own appointment note — no transcripts, nothing from other institutions.
            </p>
          </>
        )}
    </>
  );
}

function BriefingSummaryCard({ summary, shaped }) {
  return (
    <div className="ii-briefing ii-section">
      <div className="ii-briefing-head"><Sparkles size={14} /> Briefing</div>
      <div className="ii-briefing-grid">
        <BriefingRow label="Primary development area"
          value={summary.primaryDevelopmentArea
            ? `${summary.primaryDevelopmentArea.label} — ${summary.primaryDevelopmentArea.mean} (below ${summary.primaryDevelopmentArea.target})`
            : (summary.hasData ? "None below target" : "Not enough interview data yet")}
          tone={summary.primaryDevelopmentArea ? "bad" : "neutral"} />
        <BriefingRow label="Strongest area"
          value={summary.strongestArea ? `${summary.strongestArea.label} — ${summary.strongestArea.mean}` : "—"}
          tone={summary.strongestArea ? "good" : "neutral"} />
        <BriefingRow label="Relevant application"
          value={summary.relevantApplication
            ? [summary.relevantApplication.company, summary.relevantApplication.role].filter(Boolean).join(" — ")
            : "No specific application selected"} />
        <BriefingRow label="Student's reason for the appointment"
          value={summary.studentReason || "— (none given)"} wide />
      </div>
      {summary.repeatedConcern ? (
        <div className="ii-briefing-flag"><Target size={12} /> Repeated concern: {summary.repeatedConcern} has been below target across recent interviews.</div>
      ) : null}
    </div>
  );
}
function BriefingRow({ label, value, tone, wide }) {
  return (
    <div className={`ii-briefing-cell ${wide ? "ii-briefing-cell-wide" : ""}`}>
      <span className="ii-briefing-label">{label}</span>
      <span className={`ii-briefing-value ${tone === "bad" ? "ii-tone-bad" : tone === "good" ? "ii-tone-good" : ""}`}>{value}</span>
    </div>
  );
}

function StudentOverviewCard({ shaped }) {
  const s = shaped.student, a = shaped.appointment;
  return (
    <Card>
      <SectionTitle>Student overview</SectionTitle>
      <dl className="ii-kv">
        <div><dt>Name</dt><dd>{s.name || "—"}</dd></div>
        <div><dt>Institution</dt><dd>{s.institution || "—"}</dd></div>
        <div><dt>Cohort</dt><dd>{s.cohorts.length ? s.cohorts.join(", ") : "—"}</dd></div>
        <div><dt>Appointment</dt><dd>{a.typeLabel}</dd></div>
        <div><dt>When</dt><dd>{a.startsAt ? `${dateTimeLabel(a.startsAt)}${a.endsAt ? `–${timeRange(a.startsAt, a.endsAt).split(" – ")[1] || ""}` : ""}` : "—"}</dd></div>
        <div><dt>Status</dt><dd><span className={`ii-badge ii-badge-${statusMeta(a.status).tone === "info" ? "info" : statusMeta(a.status).tone === "good" ? "good" : "neutral"}`}>{statusMeta(a.status).label}</span></dd></div>
      </dl>
      {a.comment ? (
        <div className="ii-quote"><MessageSquareText size={13} /> <span>{a.comment}</span></div>
      ) : null}
    </Card>
  );
}

function ApplicationCard({ app }) {
  return (
    <Card>
      <SectionTitle>Application</SectionTitle>
      {!app ? (
        <p className="ii-text-sm ii-muted">No specific application selected for this appointment.</p>
      ) : (
        <dl className="ii-kv">
          <div><dt>Company</dt><dd>{app.company || "—"}</dd></div>
          <div><dt>Role</dt><dd>{app.role || "—"}</dd></div>
          <div><dt>Stage</dt><dd>{app.stage || "—"}</dd></div>
          <div><dt>Interview date</dt><dd>{app.interviewDate ? dateTimeLabel(app.interviewDate).split(" · ")[0] : "—"}</dd></div>
          <div><dt>Practice interviews</dt><dd>{app.practiceInterviews} completed for this application</dd></div>
        </dl>
      )}
    </Card>
  );
}

function InterviewDnaCard({ dna, target }) {
  return (
    <Card className="ii-section">
      <SectionTitle hint={dna.nInterviews ? `${dna.nInterviews} completed interview${dna.nInterviews === 1 ? "" : "s"} · overall ${dna.overallMean ?? "—"}` : null}>
        Interview DNA
      </SectionTitle>
      {!dna.hasEnoughData ? (
        <p className="ii-text-sm ii-muted">This student has not completed enough JOB.READY interviews to build an Interview DNA yet.</p>
      ) : (
        <div className="ii-grid ii-grid-2" style={{ gap: 16 }}>
          <div>
            <div className="ii-eyebrow" style={{ color: "var(--ii-good)", marginBottom: 8 }}>Strengths</div>
            {dna.strengths.length ? dna.strengths.map((x) => (
              <div key={x.key} className="ii-dna-line"><span>{x.label}</span><span className="ii-badge ii-badge-good">{x.mean} · strong</span></div>
            )) : <p className="ii-text-sm ii-muted">No dimension is at target yet.</p>}
          </div>
          <div>
            <div className="ii-eyebrow" style={{ color: "var(--ii-bad)", marginBottom: 8 }}>Development areas</div>
            {dna.development.length ? dna.development.map((x) => (
              <div key={x.key} className="ii-dna-line"><span>{x.label}</span><span className="ii-badge ii-badge-bad">{x.mean} · below {target}</span></div>
            )) : <p className="ii-text-sm ii-muted">Every dimension is at or above target.</p>}
          </div>
        </div>
      )}
      {dna.hasEnoughData ? (
        <div style={{ marginTop: 14 }}>
          <div className="ii-eyebrow" style={{ marginBottom: 8 }}>All six dimensions</div>
          <ScoreBars target={target} rows={dna.dimensions.map((d) => ({
            key: d.key, label: d.label, mean: d.mean, suppressed: false, n_students: 1, min_n: MIN_COHORT_N,
          }))} />
        </div>
      ) : null}
    </Card>
  );
}

function PatternsCard({ shaped }) {
  const repeated = repeatedDevelopmentSentence(shaped);
  const trend = trendSentence(shaped);
  const hard = shaped.patterns.hardestCategory;
  if (!repeated && !trend && !hard) return null;
  return (
    <Card className="ii-section">
      <SectionTitle hint="patterns, not individual results">What the pattern says</SectionTitle>
      <ul className="ii-pattern-list">
        {repeated ? <li className="ii-pattern ii-pattern-watch"><Target size={13} /> <strong>Repeated development area.</strong> {repeated}</li> : null}
        {trend ? <li className="ii-pattern"><LineChart size={13} /> <strong>Trend.</strong> {trend}</li> : null}
        {hard ? <li className="ii-pattern"><Radar size={13} /> <strong>Hardest question type.</strong> {hard.label} questions average {hard.mean} for this student.</li> : null}
      </ul>
    </Card>
  );
}

/* ---- availability (staff publishes bookable slots) ------------- */
function AvailabilityTab({ institutionId, userId }) {
  const [state, setState] = useState({ loading: true, slots: [], types: [], error: "" });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ date: "", start: "", end: "", typeId: "" });

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    Promise.all([api.listMySlots(institutionId, userId), api.listInstitutionAppointmentTypes(institutionId)])
      .then(([slots, types]) => setState({ loading: false, slots, types, error: "" }))
      .catch((e) => setState({ loading: false, slots: [], types: [], error: e.message || "Couldn't load availability." }));
  }, [institutionId, userId]);
  useEffect(load, [load]);

  async function addSlot(e) {
    e.preventDefault();
    if (!form.date || !form.start || !form.end) return;
    const startsAt = new Date(`${form.date}T${form.start}`);
    const endsAt = new Date(`${form.date}T${form.end}`);
    if (!(endsAt > startsAt)) { setNotice("End time must be after the start time."); return; }
    if (startsAt.getTime() <= Date.now()) { setNotice("Choose a time in the future."); return; }
    setBusy("add"); setNotice("");
    try {
      await api.createSlot(institutionId, userId, {
        startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
        appointmentTypeId: form.typeId || null,
      });
      setForm({ date: "", start: "", end: "", typeId: "" });
      setNotice("Slot published.");
      load();
    } catch (e) {
      setNotice(/exclusion|overlap|23P01/i.test(e.message) ? "That overlaps another slot you've published." : (e.message || "Couldn't publish the slot."));
    }
    setBusy("");
  }
  async function removeSlot(id) {
    setBusy(id); setNotice("");
    try { await api.deleteSlot(id); load(); }
    catch (e) { setNotice(e.message || "Couldn't remove that slot."); }
    setBusy("");
  }

  const now = Date.now();
  const upcoming = (state.slots || []).filter((s) => new Date(s.starts_at).getTime() > now);

  return (
    <>
      {notice ? <div style={{ marginBottom: 14 }}><Alert tone="info">{notice}</Alert></div> : null}
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <Card className="ii-section">
        <SectionTitle>Publish a slot</SectionTitle>
        <form onSubmit={addSlot} className="ii-row-wrap" style={{ gap: 12, alignItems: "flex-end" }}>
          <label style={{ display: "block" }}><span className="ii-label">Date</span>
            <input className="ii-input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          <label style={{ display: "block" }}><span className="ii-label">Start</span>
            <input className="ii-input" type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
          <label style={{ display: "block" }}><span className="ii-label">End</span>
            <input className="ii-input" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label>
          <label style={{ display: "block", minWidth: 190 }}><span className="ii-label">Appointment type</span>
            <select className="ii-input ii-select" value={form.typeId} onChange={(e) => setForm({ ...form, typeId: e.target.value })}>
              <option value="">Any type</option>
              {state.types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select></label>
          <Btn variant="accent" type="submit" disabled={busy === "add"}><Plus size={13} /> {busy === "add" ? "Publishing…" : "Publish"}</Btn>
        </form>
        <p className="ii-text-sm ii-muted" style={{ marginTop: 10 }}>
          Students in your institution's cohorts can book any open slot. Slots you publish can't overlap each other.
        </p>
      </Card>

      <Card>
        <SectionTitle hint={`${upcoming.length} upcoming`}>Your published slots</SectionTitle>
        {state.loading ? <Spinner />
          : !upcoming.length ? <EmptyState title="No upcoming slots">Publish one above so students can book time with you.</EmptyState>
          : (
            <div className="ii-appt-list">
              {upcoming.map((s) => {
                const t = state.types.find((x) => x.id === s.appointment_type_id);
                const st = statusMeta(s.status === "open" ? "booked" : s.status);
                return (
                  <div key={s.id} className="ii-appt-row" style={{ cursor: "default" }}>
                    <span className="ii-appt-time"><Clock size={13} /> {dateTimeLabel(s.starts_at)} · {timeRange(s.starts_at, s.ends_at)}</span>
                    <span className="ii-appt-type">{t ? t.label : "Any type"}</span>
                    <span className="ii-nav-spacer" />
                    <span className={`ii-badge ii-badge-${s.status === "booked" ? "info" : s.status === "open" ? "good" : "neutral"}`}>
                      {s.status === "open" ? "Open" : s.status === "booked" ? "Booked" : s.status}
                    </span>
                    {s.status === "open" ? (
                      <button className="ii-btn ii-btn-ghost ii-btn-sm" disabled={busy === s.id} onClick={() => removeSlot(s.id)}><Trash2 size={12} /></button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
      </Card>
    </>
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
