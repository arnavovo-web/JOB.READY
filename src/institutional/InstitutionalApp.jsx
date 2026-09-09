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
  CalendarClock, Clock, ArrowLeft, ArrowRight, CheckCircle2, XCircle, Briefcase, MessageSquareText,
  Plus, Trash2, History, Save, TrendingUp,
} from "lucide-react";
import { INSTITUTIONAL_CSS } from "./theme.js";
import {
  MIN_COHORT_N, dimensionLabel, categoryLabel, roleFamilyLabel, stageLabel,
  readinessGroupMeta,
} from "./taxonomy.js";
import {
  getSession, signInWithPassword, signOut, onAuthStateChange,
} from "./supabaseClient.js";
import * as api from "./api.js";
import { summariseCohorts, emptyFilters, describeFilters } from "./analytics.js";
import {
  shapeCareersProfile, deriveBriefingSummary, groupAppointmentsByDay, statusMeta,
  dateTimeLabel, timeRange, repeatedDevelopmentSentence, trendSentence,
  previousSupportModel, longitudinalStatement, outcomeFormValues, outcomeFormToRpcArgs, dayLabel,
} from "./appointments.js";
import * as insights from "./insights.js";
import {
  overviewCards, humanize, suggestedAction,
  plainDimension, bandWord as presentBandWord, bandTone as presentBandTone,
} from "./present.js";
import {
  Disclosure, SuggestedAction, InsightPanel, OverviewCard,
  QuietStat, JourneyEntry, FocusList, SectionQuestion,
} from "./disclosure.jsx";
import {
  derivePerformanceFindings, deriveCompetencyFindings,
  deriveCareerFindings, deriveQuestionFindings, deriveImprovementFindings,
  deriveDevelopmentFindings, contractIssue, isLive, rankFindings,
} from "./insights.js";
import {
  Btn, Card, PageHeader, SectionTitle, Alert, EmptyState, Spinner, Field, AnonNote, Badge,
} from "./ui.jsx";
import {
  ScoreBars, DistributionBar, DeltaBars, TrendLine, OpportunityList,
} from "./charts.jsx";
import {
  ReadinessDistribution, RosterPanel, ArrangeSupportModal, MessageStudentsModal,
} from "./intervention.jsx";
import {
  InterventionQueuePanel, ProgrammePulseGrid, ProgrammeIntelligenceList, FollowUpQueue,
  DevelopmentPlanCard, BriefMe, TrajectoryBlock, DnaEvolutionBlock, ResourceList,
} from "./intelligence.jsx";
import { topInstitutionalInsight } from "./programmes.js";

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
    goTo: setView,
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
  { key: "invited", label: "Invited (awaiting reply)", statuses: ["invited"] },
  { key: "booked", label: "All booked", statuses: ["booked"] },
  { key: "completed", label: "Completed", statuses: ["completed"] },
  { key: "cancelled", label: "Cancelled/missed", statuses: ["cancelled", "no_show", "declined"] },
  { key: "all", label: "Everything", statuses: null },
];

function AppointmentsView({ ctx }) {
  const { institutionId, institution, userId } = ctx;
  const [tab, setTab] = useState("schedule");
  const [selected, setSelected] = useState(null); // appointment id
  const [studentSel, setStudentSel] = useState(null); // student id (from follow-ups)
  const follow = useSection(api.getFollowUpQueue, ctx);

  if (studentSel) {
    return <StudentCareersProfileView ctx={ctx} studentId={studentSel} onBack={() => setStudentSel(null)} />;
  }
  if (selected) {
    return <AppointmentDetail ctx={ctx} appointmentId={selected} onBack={() => setSelected(null)} />;
  }

  const fuCount = Array.isArray(follow.env) ? follow.env.length : 0;

  return (
    <>
      <PageHeader
        eyebrow="Careers work"
        title="Appointments"
        actions={
          <div className="ii-row" style={{ gap: 6 }}>
            <Btn size="sm" variant={tab === "schedule" ? "primary" : "ghost"} onClick={() => setTab("schedule")}>Schedule</Btn>
            <Btn size="sm" variant={tab === "followups" ? "primary" : "ghost"} onClick={() => setTab("followups")}>Follow-ups{fuCount ? ` (${fuCount})` : ""}</Btn>
            <Btn size="sm" variant={tab === "availability" ? "primary" : "ghost"} onClick={() => setTab("availability")}>My availability</Btn>
          </div>
        }
      />
      <SectionQuestion>
        {tab === "schedule"
          ? `Who am I seeing, when, and why are they coming? Open any appointment for that student's careers profile — ${institution?.name || "your institution"} only.`
          : tab === "followups"
            ? "Where does a previous intervention need another step?"
            : "Publish the times students can book with you."}
      </SectionQuestion>
      {tab === "schedule"
        ? <ScheduleTab institutionId={institutionId} onOpen={setSelected} />
        : tab === "followups"
          ? (follow.loading ? <LoadState label="Loading follow-ups…" />
            : <FollowUpQueue ctx={ctx} items={follow.env || []} onReload={follow.reload}
                onOpenStudent={(id) => setStudentSel(id)} />)
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
                    const reason = (a.comment_preview || "").trim();
                    return (
                      <button key={a.id} className="ii-appt-row" onClick={() => onOpen(a.id)}>
                        <span className="ii-appt-time"><Clock size={13} /> {timeRange(a.starts_at, a.ends_at)}</span>
                        <span className="ii-appt-student">{a.student_name || "Student"}</span>
                        <span className="ii-appt-type">{a.type_label}</span>
                        <span className="ii-appt-reason" title={reason || undefined}>
                          {reason || <span className="ii-muted">No reason given</span>}
                          {a.has_application ? <span className="ii-badge ii-badge-info" style={{ marginLeft: 6 }}><Briefcase size={11} /> application</span> : null}
                        </span>
                        <span className={`ii-badge ii-badge-${st.tone === "info" ? "info" : st.tone === "good" ? "good" : st.tone === "warn" ? "warn" : "neutral"}`}>{st.label}</span>
                        <span className="ii-appt-open">Open profile →</span>
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
    api.getStudentCareersProfile(appointmentId)
      .then((raw) => setState({ loading: false, raw, error: "" }))
      .catch((e) => setState({ loading: false, raw: null, error: e.message || "Couldn't load this student careers profile." }));
  }, [appointmentId]);
  useEffect(load, [load]);

  const shaped = useMemo(() => shapeCareersProfile(state.raw), [state.raw]);
  const summary = useMemo(() => deriveBriefingSummary(shaped), [shaped]);
  const prev = useMemo(() => previousSupportModel(shaped), [shaped]);

  async function act(status) {
    setActionBusy(status); setNotice("");
    try {
      await api.setAppointmentStatus(appointmentId, status);
      setNotice(`Marked ${statusMeta(status).label.toLowerCase()}.`);
      load();
    } catch (e) { setNotice(e.message || "Couldn't update."); }
    setActionBusy("");
  }

  const focusItems = useMemo(() => {
    if (!shaped) return [];
    const dev = (shaped.dna?.development || []).slice(0, 3).map((x) => ({
      label: `Help them ${plainDimension(x.key, "verb")}`,
      note: `Currently ${x.mean} · interview-ready is ${shaped.target}`,
    }));
    const rep = shaped.patterns?.repeatedDevelopmentArea;
    if (rep && !dev.some((d) => d.label.includes(plainDimension(rep.key, "verb")))) {
      dev.push({ label: `Address ${rep.label.toLowerCase()}`, note: `Below target across the last ${rep.recentInterviews} interviews` });
    }
    return dev;
  }, [shaped]);

  const strengthItems = useMemo(
    () => (shaped?.dna?.strengths || []).slice(0, 3).map((x) => ({ label: x.label, note: `Averaging ${x.mean}` })),
    [shaped]
  );

  return (
    <>
      <button className="ii-btn ii-btn-ghost ii-btn-sm" style={{ marginBottom: 16 }} onClick={onBack}>
        <ArrowLeft size={13} /> Back to schedule
      </button>

      {state.loading ? <Spinner label="Preparing the student careers profile…" />
        : state.error ? <Alert tone="error">{state.error}</Alert>
        : !shaped ? <Alert tone="warn">No profile data.</Alert>
        : (
          <>
            <PageHeader
              eyebrow="Student careers profile"
              title={shaped.student.name || "Student careers profile"}
              sub={`${shaped.appointment.typeLabel}${shaped.appointment.startsAt ? ` · ${dateTimeLabel(shaped.appointment.startsAt)}` : ""}${shaped.student.institution ? ` · ${shaped.student.institution}` : ""}${shaped.student.cohorts.length ? ` · ${shaped.student.cohorts.join(", ")}` : ""}`}
            />
            {notice ? <div style={{ marginBottom: 14 }}><Alert tone="info">{notice}</Alert></div> : null}

            {shaped.student.id ? <BriefMe ctx={ctx} shaped={shaped} studentId={shaped.student.id} appointmentId={appointmentId} /> : null}

            {/* 1 — why they're here */}
            <div className="ii-section">
              <SectionTitle>Why they're here</SectionTitle>
              {shaped.appointment.comment
                ? <p className="ii-profile-why">“{shaped.appointment.comment}”</p>
                : <p className="ii-text-sm ii-muted">The student didn't add a reason when booking. {summary.hasData ? "Use their development areas below to steer the conversation." : ""}</p>}
              {shaped.flags?.isStuck || shaped.flags?.noPriorContact ? (
                <p className="ii-text-sm ii-muted" style={{ marginTop: 8 }}>
                  {shaped.flags.noPriorContact ? "First recorded careers contact. " : ""}
                  {shaped.flags.isStuck ? "Flagged as stuck — limited recent improvement despite practice." : ""}
                </p>
              ) : null}
              {summary.relevantApplication ? (
                <p className="ii-text-sm ii-muted" style={{ marginTop: 8 }}>
                  <Briefcase size={12} /> In context of an application to{" "}
                  <strong>{[summary.relevantApplication.company, summary.relevantApplication.role].filter(Boolean).join(" — ")}</strong>
                  {summary.relevantApplication.stage ? ` (${summary.relevantApplication.stage})` : ""}.
                </p>
              ) : null}
            </div>

            {/* 2 — what to focus on / what's already working */}
            {summary.hasData ? (
              <div className="ii-grid ii-grid-2 ii-section">
                <section className="ii-insight" style={{ "--ii-accent": "var(--ii-bad)" }}>
                  <div className="ii-insight-eyebrow">What to focus on</div>
                  <FocusList items={focusItems} ordered empty="No dimension is below the interview-ready threshold." />
                </section>
                <section className="ii-insight" style={{ "--ii-accent": "var(--ii-good)" }}>
                  <div className="ii-insight-eyebrow">What they're already good at</div>
                  <FocusList items={strengthItems} ordered={false} empty="No dimension is at the interview-ready threshold yet — keep encouragement broad." />
                </section>
              </div>
            ) : (
              <Card className="ii-section">
                <p className="ii-text-sm ii-muted" style={{ margin: 0 }}>
                  This student hasn't completed enough JOB.READY practice interviews to build an interview picture yet.
                  Use the appointment to understand their goals and point them at relevant practice.
                </p>
              </Card>
            )}

            {/* 3 — trajectory + development plan */}
            <div className="ii-section">
              <SectionTitle>Trajectory — where is this student going?</SectionTitle>
              <TrajectoryBlock trajectory={shaped.trajectory} />
            </div>
            {shaped.student.id ? <DevelopmentPlanCard ctx={ctx} shaped={shaped} studentId={shaped.student.id} onSaved={load} /> : null}
            {(shaped.recommendedResources || []).length ? (
              <div className="ii-section">
                <ResourceList resources={shaped.recommendedResources} heading="Recommended resources for this student"
                  note="Matched to their current development area." />
              </div>
            ) : null}

            {/* 4 — the careers journey so far */}
            <PreviousSupportCard prev={prev} />
            <CareersJourney history={shaped.history} longitudinal={shaped.longitudinal} />

            {/* 5 — record this appointment's outcome */}
            <OutcomeForm appointmentId={appointmentId} shaped={shaped} onSaved={load} />

            {/* 6 — interview performance detail, deliberately lower */}
            <div className="ii-section">
              <SectionTitle>Interview performance</SectionTitle>
              <p className="ii-text-sm ii-muted" style={{ marginTop: -4 }}>
                {shaped.dna.hasEnoughData
                  ? `${shaped.dna.nInterviews} completed interview${shaped.dna.nInterviews === 1 ? "" : "s"} · overall ${shaped.dna.overallMean ?? "—"} against an interview-ready mark of ${shaped.target}.`
                  : "Not enough completed interviews yet to break this down."}
              </p>
              {shaped.dna.hasEnoughData ? (
                <Disclosure summary="Show Interview DNA + how it has changed">
                  <InterviewDnaCard dna={shaped.dna} target={shaped.target} />
                  {shaped.dnaEvolution?.hasData ? (
                    <div style={{ marginTop: 16 }}>
                      <SectionTitle>How the profile has changed</SectionTitle>
                      <DnaEvolutionBlock evolution={shaped.dnaEvolution} />
                    </div>
                  ) : null}
                  <PatternsCard shaped={shaped} />
                  <ApplicationCard app={shaped.application} />
                </Disclosure>
              ) : null}
            </div>

            <Card className="ii-section">
              <SectionTitle hint="does not notify the student">Mark this appointment</SectionTitle>
              <div className="ii-row-wrap" style={{ gap: 8 }}>
                <Btn size="sm" variant="ghost" disabled={actionBusy} onClick={() => act("completed")}><CheckCircle2 size={13} /> Completed</Btn>
                <Btn size="sm" variant="ghost" disabled={actionBusy} onClick={() => act("no_show")}><XCircle size={13} /> No-show</Btn>
                <Btn size="sm" variant="ghost" disabled={actionBusy} onClick={() => act("cancelled")}>Cancel appointment</Btn>
              </div>
            </Card>

            <p className="ii-anon-note">
              <Lock size={11} /> Authorised, institution-scoped record. Interview intelligence is derived from
              this student's JOB.READY practice; adviser notes are internal institutional data the student cannot see.
              No transcripts, nothing from other institutions.
            </p>
          </>
        )}
    </>
  );
}

/** The student's careers-support history as one continuous, scannable journey. */
function CareersJourney({ history, longitudinal }) {
  const entries = useMemo(
    () => [...(history || [])].sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))),
    [history]
  );
  const longText = (longitudinal || []).map(longitudinalStatement).filter(Boolean);

  return (
    <div className="ii-section">
      <SectionTitle hint={entries.length ? `${entries.length} previous appointment${entries.length === 1 ? "" : "s"} at your institution` : null}>
        Careers journey
      </SectionTitle>
      {!entries.length ? (
        <p className="ii-text-sm ii-muted">This is the student's first recorded careers appointment at your institution.</p>
      ) : (
        <div className="ii-journeylist">
          {entries.map((h) => {
            const st = statusMeta(h.status);
            return (
              <JourneyEntry
                key={h.appointmentId}
                dateLabel={h.startsAt ? dayLabel(h.startsAt) : "—"}
                typeLabel={h.typeLabel}
                statusLabel={st.label}
                statusTone={st.tone}
                discussed={h.hasOutcome ? h.discussed : null}
                actionsAgreed={h.hasOutcome ? h.actionsAgreed : null}
                nextSteps={h.hasOutcome ? h.nextSteps : null}
                followUpRequired={h.followUpRequired}
                extra={
                  (h.studentComment || h.followUpNotes || h.adviserName || h.outcomeUpdatedAt) ? (
                    <>
                      {h.studentComment ? <p className="ii-journey-line"><b>Their reason</b> “{h.studentComment}”</p> : null}
                      {h.followUpNotes ? <p className="ii-journey-line"><b>Follow-up</b> {h.followUpNotes}</p> : null}
                      {h.adviserName || h.outcomeUpdatedAt ? (
                        <p className="ii-text-sm ii-muted">
                          {h.adviserName ? `Adviser: ${h.adviserName}` : ""}
                          {h.adviserName && h.outcomeUpdatedAt ? " · " : ""}
                          {h.outcomeUpdatedAt ? `Recorded ${dateTimeLabel(h.outcomeUpdatedAt).split(" · ")[0]}` : ""}
                        </p>
                      ) : null}
                    </>
                  ) : null
                }
              />
            );
          })}
        </div>
      )}
      {longText.length ? (
        <div className="ii-journey-longitudinal">
          {longText.map((s, i) => (
            <p key={i} className="ii-text-sm"><TrendingUp size={13} /> {s}</p>
          ))}
          <p className="ii-text-sm ii-muted">Factual change over time — not a causal claim.</p>
        </div>
      ) : null}
    </div>
  );
}

function PreviousSupportCard({ prev }) {
  return (
    <div className="ii-prevsupport ii-section">
      <div className="ii-briefing-head"><History size={14} /> Previous careers support</div>
      {!prev ? (
        <p className="ii-text-sm" style={{ margin: 0 }}>No previous careers appointments for this student at your institution.</p>
      ) : (
        <>
          <div className="ii-briefing-grid">
            {prev.rows.map((r) => (
              <div className="ii-briefing-cell" key={r.label}>
                <span className="ii-briefing-label">{r.label}</span>
                <span className="ii-briefing-value">{r.value}</span>
              </div>
            ))}
          </div>
          {prev.studentComment ? (
            <div className="ii-quote" style={{ marginTop: 12 }}>
              <MessageSquareText size={13} /> <span>Their reason last time: “{prev.studentComment}”</span>
            </div>
          ) : null}
          {!prev.hasOutcome ? (
            <p className="ii-text-sm ii-muted" style={{ marginTop: 10 }}>No outcome was recorded for that appointment.</p>
          ) : null}
        </>
      )}
    </div>
  );
}

function OutcomeForm({ appointmentId, shaped, onSaved }) {
  const [v, setV] = useState(() => outcomeFormValues(shaped));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const o = shaped?.currentOutcome;

  useEffect(() => { setV(outcomeFormValues(shaped)); }, [shaped]);

  async function save() {
    setBusy(true); setMsg("");
    try {
      const res = await api.saveAppointmentOutcome(outcomeFormToRpcArgs(appointmentId, v));
      setMsg(res?.is_new ? "Outcome saved." : "Outcome updated.");
      onSaved && onSaved();
    } catch (e) { setMsg(e.message || "Couldn't save the outcome."); }
    setBusy(false);
  }

  return (
    <Card className="ii-section">
      <SectionTitle hint={o?.updatedAt ? `last updated ${dateTimeLabel(o.updatedAt).split(" · ")[0]}${o.updatedByName ? ` by ${o.updatedByName}` : ""}` : "not recorded yet"}>
        Appointment outcome
      </SectionTitle>
      <div className="ii-outcome-form">
        <label><span className="ii-label">What was discussed</span>
          <textarea className="ii-input" rows={3} value={v.discussed} onChange={(e) => setV({ ...v, discussed: e.target.value })} /></label>
        <label><span className="ii-label">Actions agreed</span>
          <textarea className="ii-input" rows={3} value={v.actionsAgreed} onChange={(e) => setV({ ...v, actionsAgreed: e.target.value })} /></label>
        <label><span className="ii-label">Recommended next steps</span>
          <textarea className="ii-input" rows={3} value={v.nextSteps} onChange={(e) => setV({ ...v, nextSteps: e.target.value })} /></label>
        <div className="ii-row" style={{ gap: 16, flexWrap: "wrap" }}>
          <label className="ii-row" style={{ gap: 8 }}>
            <input type="checkbox" checked={v.followUpRequired} onChange={(e) => setV({ ...v, followUpRequired: e.target.checked })} />
            <span className="ii-label" style={{ margin: 0 }}>Follow-up required</span>
          </label>
        </div>
        {v.followUpRequired ? (
          <label><span className="ii-label">Follow-up notes</span>
            <textarea className="ii-input" rows={2} value={v.followUpNotes} onChange={(e) => setV({ ...v, followUpNotes: e.target.value })} /></label>
        ) : null}
        <div className="ii-row-wrap" style={{ gap: 10, marginTop: 4 }}>
          <Btn variant="accent" onClick={save} disabled={busy}><Save size={13} /> {busy ? "Saving…" : (o ? "Update outcome" : "Save outcome")}</Btn>
          {msg ? <span className="ii-text-sm ii-muted">{msg}</span> : null}
        </div>
      </div>
      <p className="ii-text-sm ii-muted" style={{ marginTop: 12 }}>
        Internal institutional record — the student cannot see this. It becomes part of their careers history for the next adviser.
      </p>
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
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let dead = false;
    setState((s) => ({ loading: true, env: tick === 0 ? null : s.env, error: "" }));
    fetcher(institutionId, { cohortIds: filters.cohortIds, from: filters.from, to: filters.to })
      .then((env) => { if (!dead) setState({ loading: false, env, error: "" }); })
      .catch((e) => { if (!dead) setState({ loading: false, env: null, error: e.message || "Failed to load." }); });
    return () => { dead = true; };
  }, [institutionId, filters, fetcher, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
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

/** One-question section header — no chrome, no stat strip. */
function SectionHeader({ eyebrow, title, question, ctx }) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} />
      {question ? <SectionQuestion>{question}</SectionQuestion> : null}
      <div className="ii-anon-note" style={{ marginTop: -8, marginBottom: 18 }}>
        <Lock size={11} /> {ctx.scopeLabel} · aggregated, groups under {MIN_COHORT_N} students hidden
      </div>
    </>
  );
}

/** Compact "one insight → one figure → one action" line for the secondary findings. */
function SecondaryInsight({ finding, onCta }) {
  const h = humanize(finding);
  const act = suggestedAction(finding);
  return (
    <div className="ii-insight" style={{ "--ii-accent": ({ bad: "var(--ii-bad)", warn: "var(--ii-warn)", good: "var(--ii-good)", info: "var(--ii-blue)" }[h.tone] || "var(--ii-text-faint)") }}>
      <div className="ii-insight-eyebrow">{severityLabel(finding.severity)}</div>
      <h3 className="ii-insight-lead" style={{ fontSize: 14.5 }}>{h.lead}</h3>
      {h.figure ? <p className="ii-insight-figure">{h.figure}</p> : null}
      {act ? <SuggestedAction text={act.text} cta={act.cta} onCta={onCta} /> : null}
    </div>
  );
}
function severityLabel(sev) {
  return { critical: "Needs attention", watch: "Keep an eye on", neutral: "Key insight", positive: "What’s working" }[sev] || "Note";
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
 * OVERVIEW  — "What matters, and what should we do?"
 * ================================================================= */
function OverviewView({ ctx }) {
  const { institution, cohortSummary } = ctx;
  const { loading, data, error } = useAllSections(ctx);
  const intel = useSection(api.getStudentIntelligence, ctx);
  const pulse = useSection(api.getProgrammePulse, ctx);
  const follow = useSection(api.getFollowUpQueue, ctx);
  const t = cohortSummary.totals;

  const summary = intel.env?.summary || {};
  const movement = intel.env?.movement || {};
  const topInsight = useMemo(() => topInstitutionalInsight({
    pulse: pulse.env || [], summary, movement,
    followUpCount: Array.isArray(follow.env) ? follow.env.length : 0,
  }), [pulse.env, summary, movement, follow.env]);

  const cards = useMemo(() => (data ? overviewCards(data, insights) : []), [data]);
  const ov = data?.overview;
  const perf = ov?.performance;
  const readyPct = perf && !perf.suppressed ? (perf.pct_at_or_above_target ?? 0) : null;
  const readyWord = readyPct != null ? presentBandWord(perf.mean_overall, ov?.readiness_target ?? 70) : null;

  return (
    <>
      <PageHeader
        eyebrow="EKI² · Overview"
        title={`How prepared are ${institution?.name || "your"} students?`}
      />
      <SectionQuestion>The most important things to know right now — and what your team can do about them.</SectionQuestion>

      {loading ? <LoadState label="Preparing your briefing…" /> : (
        <>
          <ContractOrError error={error} env={ov} />

          {cards.length ? (
            <div className="ii-ovcards">
              {cards.map((c) => <OverviewCard key={c.bucket + c.findingId} card={c} onOpen={ctx.goTo} />)}
            </div>
          ) : (
            <Card className="ii-section">
              <div className="ii-empty">
                <div className="ii-empty-icon"><Lock size={22} /></div>
                <h3 className="ii-h3">Not enough interview data to brief you yet</h3>
                <p className="ii-text-sm" style={{ maxWidth: 460 }}>
                  {t.cohorts === 0
                    ? "Add cohorts and students under Cohorts & students to begin — insights appear as students practise."
                    : `Cohort insights need at least ${MIN_COHORT_N} students with interview data in a group. This protects individual students.`}
                </p>
              </div>
            </Card>
          )}

          {!intel.loading && (summary.no_contact || summary.stuck || (Array.isArray(follow.env) && follow.env.length) || topInsight) ? (
            <div className="ii-section">
              <SectionTitle>What needs attention</SectionTitle>
              {topInsight ? (
                <section className="ii-insight" style={{ "--ii-accent": topInsight.kind === "positive_movement" ? "var(--ii-good)" : "var(--ii-blue)" }}>
                  <div className="ii-insight-eyebrow">Key institutional insight</div>
                  <h3 className="ii-insight-lead" style={{ fontSize: 15 }}>{topInsight.headline}</h3>
                  {topInsight.detail ? <p className="ii-insight-why">{topInsight.detail}</p> : null}
                  {topInsight.cta ? <button className="ii-action-cta" onClick={() => ctx.goTo(topInsight.cta.target)}>{topInsight.cta.label} <ArrowRight size={13} /></button> : null}
                </section>
              ) : null}
              <div className="ii-qstats">
                {summary.no_contact ? <QuietStat label="No contact yet" word={`${summary.no_contact}`} tone="warn" figure="below target, no recorded support" /> : null}
                {summary.stuck ? <QuietStat label="Stuck" word={`${summary.stuck}`} tone="bad" figure="practising without improvement" /> : null}
                {Array.isArray(follow.env) && follow.env.length ? <QuietStat label="Follow-ups due" word={`${follow.env.length}`} tone="warn" figure="interventions to progress" /> : null}
                {(movement.developing_to_ready || movement.needs_support_to_developing)
                  ? <QuietStat label="Moved up a group" word={`${(movement.developing_to_ready || 0) + (movement.needs_support_to_developing || 0)}`} tone="good" figure="this period" /> : null}
              </div>
            </div>
          ) : null}

          {readyWord ? (
            <div className="ii-qstats">
              <QuietStat label="Interview readiness" word={readyWord} tone={presentBandTone(readyWord)} figure={`${readyPct}% interview-ready`} />
              <QuietStat label="Students with data" word={`${perf.n_students}`} figure={`of ${ov?.scope?.students_in_scope ?? "—"} in scope`} />
              <QuietStat label="Have practised" word={ov?.activity?.coverage_pct != null ? `${ov.activity.coverage_pct}%` : "—"} figure={`${ov?.activity?.completed_interviews ?? 0} interviews`} />
              <QuietStat label="Cohorts" word={`${t.cohorts}`} figure={t.pendingInvites ? `${t.pendingInvites} invites pending` : "all linked"} />
            </div>
          ) : null}

          <p className="ii-anon-note"><Lock size={11} /> Every figure is aggregated across students; any group under {MIN_COHORT_N} students is hidden.</p>
        </>
      )}
    </>
  );
}

/** Turn a section's ranked findings into a lead InsightPanel (+ its evidence) and secondary lines. */
function InsightLayout({ findings, onCta, evidence, evidenceSummary }) {
  const [lead, ...rest] = findings;
  if (!lead) return evidence || null;
  const h = humanize(lead);
  const act = suggestedAction(lead);
  return (
    <>
      <InsightPanel
        eyebrow={severityLabel(lead.severity)}
        tone={h.tone}
        lead={h.lead} why={h.why} figure={h.figure}
        action={act}
        onCta={onCta}
        evidenceSummary={evidenceSummary}
      >
        {evidence}
      </InsightPanel>
      {rest.filter((f) => humanize(f).lead && humanize(f).lead !== h.lead).slice(0, 3).map((f) => (
        <SecondaryInsight key={f.id} finding={f} onCta={onCta} />
      ))}
    </>
  );
}

/* =================================================================
 * PERFORMANCE — "Where are our students in their interview readiness?"
 * ----------------------------------------------------------------- *
 * Readiness distribution (aggregate, k-anonymised) -> drill into a
 * readiness group -> authorised student roster -> open the Student
 * Careers Profile / arrange support / message. The old cohort-wide
 * verdict and the detailed analytics move behind "Show the evidence".
 * ================================================================= */
function PerformanceView({ ctx }) {
  const perf = useSection(api.getPerformance, ctx);
  const roster = useSection(api.getReadinessRoster, ctx);
  const intel = useSection(api.getStudentIntelligence, ctx);
  const env = perf.env;
  const evLive = env && isLive(env) && env.overall && !env.overall.suppressed;
  const findings = useMemo(() => (env ? rankFindings(derivePerformanceFindings(env)) : []), [env]);
  const intelStudents = intel.env?.students || [];
  const summary = intel.env?.summary || {};

  const [drill, setDrill] = useState({ mode: "distribution", groupKey: null, studentId: null });
  useEffect(() => { setDrill({ mode: "distribution", groupKey: null, studentId: null }); }, [ctx.institutionId, ctx.filters]);

  const openStudent = (id) => setDrill((d) => ({ ...d, mode: "profile", studentId: id, from: d.mode }));

  if (drill.mode === "profile" && drill.studentId) {
    return (
      <StudentCareersProfileView ctx={ctx} studentId={drill.studentId}
        onBack={() => setDrill((d) => ({ ...d, mode: d.from || "roster", studentId: null }))} />
    );
  }
  if (drill.mode === "roster" && drill.groupKey) {
    return (
      <>
        <SectionHeader ctx={ctx} eyebrow="Performance" question="Who should we intervene with?" />
        <RosterPanel ctx={ctx} roster={roster.env} groupKey={drill.groupKey}
          onBack={() => setDrill({ mode: "distribution", groupKey: null, studentId: null })}
          onOpenStudent={(id) => setDrill((d) => ({ ...d, mode: "profile", studentId: id, from: "roster" }))} />
      </>
    );
  }
  if (drill.mode === "nocontact" || drill.mode === "stuck") {
    return (
      <>
        <SectionHeader ctx={ctx} eyebrow="Performance" question={drill.mode === "stuck" ? "Who is stuck despite practising?" : "Who needs a first careers conversation?"} />
        <InterventionQueuePanel ctx={ctx} kind={drill.mode} students={intelStudents}
          onBack={() => setDrill({ mode: "distribution", groupKey: null, studentId: null })}
          onOpenStudent={(id) => setDrill((d) => ({ ...d, mode: "profile", studentId: id, from: drill.mode }))} />
      </>
    );
  }

  return (
    <>
      <SectionHeader ctx={ctx} eyebrow="Performance" question="Where are our students in their interview readiness?" />
      {perf.loading || roster.loading ? <LoadState label="Loading readiness…" /> : (
        <>
          <ContractOrError error={roster.error || perf.error} env={env} />

          <ReadinessDistribution roster={roster.env}
            onOpenGroup={(k) => setDrill({ mode: "roster", groupKey: k, studentId: null })} />

          {!intel.loading && (summary.no_contact || summary.stuck) ? (
            <div className="ii-ovcards ii-section">
              {summary.no_contact ? (
                <button className="ii-ovcard ii-ovcard-warn" onClick={() => setDrill({ mode: "nocontact", groupKey: null, studentId: null })}>
                  <span className="ii-ovcard-head"><RefreshCw size={13} /> No contact yet</span>
                  <span className="ii-ovcard-insight">{summary.no_contact} student{summary.no_contact === 1 ? "" : "s"} below target with no recorded careers support</span>
                  <span className="ii-ovcard-link">Review students <ArrowRight size={12} /></span>
                </button>
              ) : null}
              {summary.stuck ? (
                <button className="ii-ovcard ii-ovcard-bad" onClick={() => setDrill({ mode: "stuck", groupKey: null, studentId: null })}>
                  <span className="ii-ovcard-head"><TrendingUp size={13} /> Stuck students</span>
                  <span className="ii-ovcard-insight">{summary.stuck} student{summary.stuck === 1 ? "" : "s"} practising with limited recent improvement</span>
                  <span className="ii-ovcard-link">Review support <ArrowRight size={12} /></span>
                </button>
              ) : null}
            </div>
          ) : null}

          {evLive ? (
            <Disclosure summary="Show the evidence">
              <div className="ii-qstats">
                <QuietStat label="Cohort average" word={`${env.overall.mean}`} figure={`median ${env.overall.median}`} />
                <QuietStat label="Interview-ready" word={`${env.overall.pct_at_or_above_target}%`} tone={env.overall.pct_at_or_above_target >= 50 ? "good" : env.overall.pct_at_or_above_target >= 25 ? "warn" : "bad"} />
                <QuietStat label="Middle half" word={`${env.overall.p25}–${env.overall.p75}`} />
                <QuietStat label="Interviews" word={`${env.overall.n_interviews}`} figure={`${env.overall.n_students} students`} />
              </div>
              {findings.length ? (
                <div className="ii-section">
                  {findings.slice(0, 3).map((f) => <SecondaryInsight key={f.id} finding={f} onCta={ctx.goTo} />)}
                </div>
              ) : null}
              <SectionTitle>Score distribution</SectionTitle>
              <DistributionBar n={env.distribution?.n} min={MIN_COHORT_N}
                segments={(env.distribution?.buckets || []).map((b) => ({
                  label: bandLabel(b.label), count: b.count,
                  tone: b.label === "strong" || b.label === "solid" ? "good" : b.label === "developing" ? "warn" : "bad",
                }))} />
              <div className="ii-grid ii-grid-2" style={{ marginTop: 20 }}>
                <div>
                  <SectionTitle>By interview round</SectionTitle>
                  <ScoreBars target={env.readiness_target} rows={(env.by_stage || []).map((s) => ({
                    key: s.key, label: stageLabel(s.key), mean: s.mean, suppressed: s.suppressed, n_students: s.n_students, min_n: MIN_COHORT_N }))} />
                </div>
                <div>
                  <SectionTitle>By format</SectionTitle>
                  <ScoreBars target={env.readiness_target} rows={(env.by_format || []).map((s) => ({
                    key: s.key, label: formatLabel(s.key), mean: s.mean, suppressed: s.suppressed, n_students: s.n_students, min_n: MIN_COHORT_N }))} />
                </div>
              </div>
              <div style={{ marginTop: 20 }}>
                <SectionTitle hint="reportable months only">Over time</SectionTitle>
                <TrendLine points={env.trend_monthly} target={env.readiness_target} />
              </div>
            </Disclosure>
          ) : null}
          <AnonNote min={MIN_COHORT_N} />
        </>
      )}
    </>
  );
}

/* ---- Student Careers Profile opened from the readiness roster ---- *
 * Same profile the adviser sees from an appointment, sourced for a
 * student who has no appointment yet (eki_student_snapshot). No outcome
 * form / mark-status (there is no appointment); adds "Arrange support"
 * and "Message student" so the readiness workflow leads to an action.
 * ================================================================= */
function StudentCareersProfileView({ ctx, studentId, onBack }) {
  const [state, setState] = useState({ loading: true, raw: null, error: "" });
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: s.raw == null }));
    api.getStudentSnapshot(ctx.institutionId, studentId)
      .then((raw) => setState({ loading: false, raw, error: "" }))
      .catch((e) => setState({ loading: false, raw: null, error: e.message || "Couldn't load this student's profile." }));
  }, [ctx.institutionId, studentId]);
  useEffect(() => { setState({ loading: true, raw: null, error: "" }); load(); }, [load]);

  const shaped = useMemo(() => shapeCareersProfile(state.raw), [state.raw]);
  const summary = useMemo(() => deriveBriefingSummary(shaped), [shaped]);
  const prev = useMemo(() => previousSupportModel(shaped), [shaped]);

  const focusItems = useMemo(() => {
    if (!shaped) return [];
    return (shaped.dna?.development || []).slice(0, 3).map((x) => ({
      label: `Help them ${plainDimension(x.key, "verb")}`,
      note: `Currently ${x.mean} · interview-ready is ${shaped.target}`,
    }));
  }, [shaped]);
  const strengthItems = useMemo(
    () => (shaped?.dna?.strengths || []).slice(0, 3).map((x) => ({ label: x.label, note: `Averaging ${x.mean}` })),
    [shaped]
  );
  const studentForModal = { student_id: studentId, name: shaped?.student?.name };

  return (
    <>
      <button className="ii-btn ii-btn-ghost ii-btn-sm" style={{ marginBottom: 16 }} onClick={onBack}>
        <ArrowLeft size={13} /> Back to students
      </button>

      {state.loading ? <Spinner label="Preparing the student careers profile…" />
        : state.error ? <Alert tone="error">{state.error}</Alert>
        : !shaped ? <Alert tone="warn">No profile data.</Alert>
        : (
          <>
            <PageHeader
              eyebrow="Student careers profile"
              title={shaped.student.name || "Student careers profile"}
              sub={`${shaped.student.institution || ""}${shaped.student.cohorts.length ? ` · ${shaped.student.cohorts.join(", ")}` : ""}`}
            />
            {notice ? <div style={{ marginBottom: 14 }}><Alert tone="info">{notice}</Alert></div> : null}

            <div className="ii-row-wrap ii-section" style={{ gap: 8 }}>
              <Btn size="sm" variant="accent" onClick={() => setModal("arrange")}><CalendarClock size={13} /> Arrange support</Btn>
              <Btn size="sm" variant="primary" onClick={() => setModal("message")}><MessageSquareText size={13} /> Message student</Btn>
            </div>

            <BriefMe ctx={ctx} shaped={shaped} studentId={studentId} />

            <div className="ii-section">
              <SectionTitle>Why they're here</SectionTitle>
              <p className="ii-text-sm ii-muted" style={{ margin: 0 }}>
                Opened from the readiness review.{" "}
                {shaped.flags?.noPriorContact ? "No recorded careers contact yet. " : ""}
                {shaped.flags?.isStuck ? "Appears stuck — limited recent improvement despite practice. " : ""}
                {summary.primaryDevelopmentArea
                  ? `Weakest area right now is ${summary.primaryDevelopmentArea.label.toLowerCase()} (${summary.primaryDevelopmentArea.mean}).`
                  : (summary.hasData ? "No dimension is below the interview-ready threshold." : "Not enough practice data yet to pinpoint a focus.")}
              </p>
            </div>

            {summary.hasData ? (
              <div className="ii-grid ii-grid-2 ii-section">
                <section className="ii-insight" style={{ "--ii-accent": "var(--ii-bad)" }}>
                  <div className="ii-insight-eyebrow">What to focus on</div>
                  <FocusList items={focusItems} ordered empty="No dimension is below the interview-ready threshold." />
                </section>
                <section className="ii-insight" style={{ "--ii-accent": "var(--ii-good)" }}>
                  <div className="ii-insight-eyebrow">What they're already good at</div>
                  <FocusList items={strengthItems} ordered={false} empty="No dimension is at the interview-ready threshold yet." />
                </section>
              </div>
            ) : (
              <Card className="ii-section">
                <p className="ii-text-sm ii-muted" style={{ margin: 0 }}>
                  This student hasn't completed enough JOB.READY practice interviews to build an interview picture yet.
                </p>
              </Card>
            )}

            <div className="ii-section">
              <SectionTitle>Trajectory — where is this student going?</SectionTitle>
              <TrajectoryBlock trajectory={shaped.trajectory} />
            </div>

            <DevelopmentPlanCard ctx={ctx} shaped={shaped} studentId={studentId} onSaved={load} />

            {(shaped.recommendedResources || []).length ? (
              <div className="ii-section">
                <ResourceList resources={shaped.recommendedResources} heading="Recommended resources for this student"
                  note={`Matched to their current development area${shaped.dnaEvolution?.persistentWeakness ? ` (${dimensionLabel(shaped.dnaEvolution.persistentWeakness)})` : ""}.`} />
              </div>
            ) : null}

            <PreviousSupportCard prev={prev} />
            <CareersJourney history={shaped.history} longitudinal={shaped.longitudinal} />

            <div className="ii-section">
              <SectionTitle>Interview performance</SectionTitle>
              <p className="ii-text-sm ii-muted" style={{ marginTop: -4 }}>
                {shaped.dna.hasEnoughData
                  ? `${shaped.dna.nInterviews} completed interview${shaped.dna.nInterviews === 1 ? "" : "s"} · overall ${shaped.dna.overallMean ?? "—"} against an interview-ready mark of ${shaped.target}.`
                  : "Not enough completed interviews yet to break this down."}
              </p>
              {shaped.dna.hasEnoughData ? (
                <Disclosure summary="Show Interview DNA + how it has changed">
                  <InterviewDnaCard dna={shaped.dna} target={shaped.target} />
                  {shaped.dnaEvolution?.hasData ? (
                    <div style={{ marginTop: 16 }}>
                      <SectionTitle>How the profile has changed</SectionTitle>
                      <DnaEvolutionBlock evolution={shaped.dnaEvolution} />
                    </div>
                  ) : null}
                  <PatternsCard shaped={shaped} />
                </Disclosure>
              ) : null}
            </div>

            <p className="ii-anon-note">
              <Lock size={11} /> Authorised, institution-scoped record for a student in your cohorts. Interview
              intelligence is derived from this student's JOB.READY practice; adviser notes stay internal. No transcripts,
              nothing from other institutions.
            </p>

            {modal === "arrange" ? (
              <ArrangeSupportModal ctx={ctx} student={studentForModal}
                onClose={() => setModal(null)}
                onDone={(m) => { setModal(null); setNotice(m); }} />
            ) : null}
            {modal === "message" ? (
              <MessageStudentsModal ctx={ctx} students={[studentForModal]}
                onClose={() => setModal(null)}
                onDone={(m) => { setModal(null); setNotice(m); }} />
            ) : null}
          </>
        )}
    </>
  );
}

/* =================================================================
 * COMPETENCIES — "Where are students strongest, and where do they need support?"
 * ================================================================= */
function CompetenciesView({ ctx }) {
  const { loading, env, error } = useSection(api.getCompetencies, ctx);
  const findings = useMemo(() => (env ? rankFindings(deriveCompetencyFindings(env)) : []), [env]);
  const dims = (env?.dimensions || []);
  const reportable = dims.filter((d) => !d.suppressed && d.mean != null);
  const sorted = [...reportable].sort((a, b) => b.mean - a.mean);
  const strongest = sorted[0], weakest = sorted[sorted.length - 1];
  const live = env && isLive(env) && reportable.length >= 2;
  const weakAction = live && weakest ? suggestedAction({ section: "competencies", severity: weakest.mean < (env.readiness_target ?? 70) ? "critical" : "watch", headline: "weakest competency", evidence: { key: weakest.key } }) : null;

  return (
    <>
      <SectionHeader ctx={ctx} eyebrow="Competencies" question="Where are students strongest, and where do they need support?" />
      {loading ? <LoadState label="Loading competencies…" /> : !live ? <><ContractOrError error={error} env={env} /><NoData env={env} whatFor="competency performance" /></> : (
        <>
          <ContractOrError error={error} env={env} />

          <div className="ii-grid ii-grid-2 ii-section">
            <section className="ii-insight" style={{ "--ii-accent": "var(--ii-good)" }}>
              <div className="ii-insight-eyebrow">Strongest area</div>
              <h3 className="ii-insight-lead">{dimensionLabel(strongest.key)}</h3>
              <p className="ii-insight-why">Students are best at {plainDimension(strongest.key, "noun")}.</p>
              <p className="ii-insight-figure">
                {env.competency_average != null ? `${Math.abs(Math.round(strongest.mean - env.competency_average))} pts above the cohort's competency average` : `Cohort mean ${strongest.mean}`}
              </p>
            </section>
            <section className="ii-insight" style={{ "--ii-accent": "var(--ii-bad)" }}>
              <div className="ii-insight-eyebrow">Development opportunity</div>
              <h3 className="ii-insight-lead">{dimensionLabel(weakest.key)}</h3>
              <p className="ii-insight-why">Students find it hardest to {plainDimension(weakest.key, "verb")}.</p>
              <p className="ii-insight-figure">{Math.max(0, Math.round((env.readiness_target ?? 70) - weakest.mean))} pts below interview-ready</p>
              {weakAction ? <SuggestedAction text={weakAction.text} cta={weakAction.cta} onCta={ctx.goTo} /> : null}
            </section>
          </div>

          <InsightLayout findings={findings} onCta={ctx.goTo} evidenceSummary="Show all six competencies"
            evidence={
              <>
                <SectionTitle hint={env.competency_average != null ? `competency average ${env.competency_average}` : null}>The six dimensions</SectionTitle>
                <ScoreBars target={env.readiness_target} rows={dims.map((d) => ({
                  key: d.key, label: dimensionLabel(d.key), mean: d.mean, suppressed: d.suppressed, n_students: d.n_students, min_n: MIN_COHORT_N,
                  deltaLabel: d.delta_vs_competency_avg != null ? `${d.delta_vs_competency_avg > 0 ? "+" : ""}${d.delta_vs_competency_avg} vs avg` : null,
                  deltaTone: d.materially_below ? "bad" : d.delta_vs_competency_avg > 0 ? "good" : "neutral",
                }))} />
              </>
            }
          />
          <AnonNote min={MIN_COHORT_N} />
        </>
      )}
    </>
  );
}

/* =================================================================
 * CAREER INSIGHTS — "What are we seeing across career paths?"
 * ================================================================= */
function CareerView({ ctx }) {
  const { loading, env, error } = useSection(api.getCareerInsights, ctx);
  const pulse = useSection(api.getProgrammePulse, ctx);
  const intel = useSection(api.getStudentIntelligence, ctx);
  const followUps = useSection(api.getFollowUpQueue, ctx);
  const findings = useMemo(() => (env ? rankFindings(deriveCareerFindings(env)) : []), [env]);
  const fams = env?.families || [];
  const reportable = fams.filter((f) => !f.suppressed && f.mean != null);
  const live = env && isLive(env);

  const intelEnv = useMemo(() => ({
    pulse: pulse.env || [],
    summary: intel.env?.summary || {},
    movement: intel.env?.movement || {},
    followUpCount: Array.isArray(followUps.env) ? followUps.env.length : 0,
  }), [pulse.env, intel.env, followUps.env]);

  return (
    <>
      <SectionHeader ctx={ctx} eyebrow="Career Insights" question="What should the careers team pay attention to?" />

      {!pulse.loading ? (
        <>
          <SectionTitle>What needs attention</SectionTitle>
          <ProgrammeIntelligenceList env={intelEnv} onCta={ctx.goTo} />
          <div style={{ marginTop: 24 }}>
            <SectionTitle>Programme employability pulse</SectionTitle>
            <ProgrammePulseGrid pulse={pulse.env || []} />
          </div>
        </>
      ) : <LoadState label="Loading programme intelligence…" />}

      <div style={{ marginTop: 8 }}>
      <SectionQuestion>How prepared are students for each career path they're practising for?</SectionQuestion>
      {loading ? <LoadState label="Loading career insights…" /> : !live ? <><ContractOrError error={error} env={env} /><NoData env={env} whatFor="career-path performance" /></> : (
        <>
          <ContractOrError error={error} env={env} />
          {!reportable.length ? (
            <Card>
              <div className="ii-empty">
                <div className="ii-empty-icon"><Compass size={22} /></div>
                <h3 className="ii-h3">No career path has enough students to report on yet</h3>
                <p className="ii-text-sm" style={{ maxWidth: 460 }}>
                  {(env.families_total ?? 0)} path(s) appear in the data; a path needs {MIN_COHORT_N} students with interview
                  activity before EKI² will report on it. This keeps individual students anonymous.
                </p>
              </div>
            </Card>
          ) : (
            <InsightLayout findings={findings} onCta={ctx.goTo} evidenceSummary="Show every career path"
              evidence={
                <>
                  <SectionTitle hint={env.cross_family_mean != null ? `average across reportable paths ${env.cross_family_mean}` : null}>Readiness by career path</SectionTitle>
                  <ScoreBars target={env.readiness_target} rows={fams.map((f) => ({
                    key: f.key, label: roleFamilyLabel(f.key), mean: f.mean, suppressed: f.suppressed, n_students: f.n_students, min_n: MIN_COHORT_N,
                    deltaLabel: f.delta_vs_cross_family != null ? `${f.delta_vs_cross_family > 0 ? "+" : ""}${f.delta_vs_cross_family} vs avg` : null,
                    deltaTone: f.delta_vs_cross_family < 0 ? "bad" : f.delta_vs_cross_family > 0 ? "good" : "neutral",
                  }))} />
                  <p className="ii-text-sm ii-muted" style={{ marginTop: 10 }}>
                    {env.families_reportable} of {env.families_total} paths meet the {MIN_COHORT_N}-student threshold.
                  </p>
                </>
              }
            />
          )}
          <AnonNote min={MIN_COHORT_N} />
        </>
      )}
      </div>
    </>
  );
}

/* =================================================================
 * DEVELOPMENT AREAS — "What should we help students with, and how?"
 * ================================================================= */
function DevelopmentView({ ctx }) {
  const dev = useSection(api.getDevelopmentAreas, ctx);
  const imp = useSection(api.getImprovement, ctx);
  const qp = useSection(api.getQuestionPerformance, ctx);
  const loading = dev.loading || imp.loading;
  const findings = useMemo(() => (dev.env ? rankFindings(deriveDevelopmentFindings(dev.env, imp.env)) : []), [dev.env, imp.env]);
  const qFindings = useMemo(() => (qp.env ? rankFindings(deriveQuestionFindings(qp.env)) : []), [qp.env]);
  const live = dev.env && isLive(dev.env) && (dev.env.opportunities || []).length;

  const topGapKey = (dev.env?.opportunities || []).find((o) => o.kind === "competency")?.key || null;
  const [resources, setResources] = useState([]);
  useEffect(() => {
    let dead = false;
    if (!topGapKey) { setResources([]); return; }
    api.listResources(ctx.institutionId, topGapKey).then((r) => { if (!dead) setResources(r); }).catch(() => {});
    return () => { dead = true; };
  }, [ctx.institutionId, topGapKey]);

  return (
    <>
      <SectionHeader ctx={ctx} eyebrow="Development Areas" question="What should we help students with — and how?" />
      {loading ? <LoadState label="Loading development areas…" /> : !live ? <><ContractOrError error={dev.error} env={dev.env} /><NoData env={dev.env} whatFor="development opportunities" /></> : (
        <>
          <ContractOrError error={dev.error} env={dev.env} />

          <InsightLayout findings={findings} onCta={ctx.goTo} evidenceSummary="Show the full ranking"
            evidence={
              <>
                <SectionTitle hint="ranked by gap × students affected">All development opportunities</SectionTitle>
                <OpportunityList items={topOpportunities(dev.env, imp.env, 20)} target={dev.env.readiness_target} />
                {qFindings.length && isLive(qp.env) ? (
                  <div style={{ marginTop: 20 }}>
                    <SectionTitle>Hardest question types</SectionTitle>
                    <ScoreBars target={qp.env.readiness_target} rows={(qp.env.categories || []).map((c) => ({
                      key: c.key, label: categoryLabel(c.key), mean: c.mean, suppressed: c.suppressed, n_students: c.n_students, min_n: MIN_COHORT_N }))} />
                  </div>
                ) : null}
              </>
            }
          />

          {resources.length ? (
            <div className="ii-section">
              <ResourceList resources={resources.map((r) => ({ ...r, durationMinutes: r.duration_minutes }))}
                heading={`Resources for the top gap${topGapKey ? ` — ${dimensionLabel(topGapKey)}` : ""}`}
                note="Point students at these from their development plan, or run a workshop for a whole cohort." />
              <p className="ii-text-sm ii-muted" style={{ marginTop: 8 }}>
                Where several students share this gap, an <strong>{topGapKey ? dimensionLabel(topGapKey) : "targeted"}</strong> workshop reaches them at once.
              </p>
            </div>
          ) : null}

          <p className="ii-text-sm ii-muted">
            EKI² can't identify individual students to you here — cohort figures stay aggregated. Use Performance → the readiness roster to work with students directly.
          </p>
          <AnonNote min={MIN_COHORT_N} />
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
 * IMPROVEMENT — "Are students getting better with practice?"
 * ================================================================= */
function ImprovementView({ ctx }) {
  const { loading, env, error } = useSection(api.getImprovement, ctx);
  const intel = useSection(api.getStudentIntelligence, ctx);
  const findings = useMemo(() => (env ? rankFindings(deriveImprovementFindings(env)) : []), [env]);
  const o = env?.overall;
  const s = env?.scope || {};
  const live = env && isLive(env) && o && !o.suppressed;
  const mv = intel.env?.movement || {};
  const sm = intel.env?.summary || {};

  return (
    <>
      <SectionHeader ctx={ctx} eyebrow="Improvement" question="Are students getting better with practice?" />

      {!intel.loading && intel.env ? (
        <div className="ii-section">
          <SectionTitle>Institutional movement this period</SectionTitle>
          <div className="ii-qstats">
            <QuietStat label="Moved into interview-ready" word={`${mv.developing_to_ready || 0}`} tone="good" />
            <QuietStat label="Moved up from needs-support" word={`${mv.needs_support_to_developing || 0}`} tone="good" />
            <QuietStat label="Slipped back a group" word={`${mv.slipped_back || 0}`} tone={mv.slipped_back ? "warn" : "neutral"} />
            <QuietStat label="Improving trajectory" word={`${sm.improving || 0}`} figure={`${sm.plateauing || 0} plateauing · ${sm.declining || 0} declining`} />
          </div>
          <p className="ii-text-sm ii-muted" style={{ marginTop: -4 }}>
            Movement compares each student's first and latest readiness group in this scope. Trajectory is the deterministic
            per-student classification used across EKI².
          </p>
        </div>
      ) : null}
      {loading ? <LoadState label="Loading improvement…" /> : !live ? (
        <>
          <ContractOrError error={error} env={env} />
          <Card>
            <div className="ii-empty">
              <div className="ii-empty-icon"><LineChart size={22} /></div>
              <h3 className="ii-h3">Not enough repeated practice to measure improvement</h3>
              <p className="ii-text-sm" style={{ maxWidth: 480 }}>
                Improvement is measured within each student. {s.students_with_repeat_practice ?? 0} student
                {(s.students_with_repeat_practice ?? 0) === 1 ? " has" : "s have"} practised more than once in this scope;
                {" "}{MIN_COHORT_N} are needed.
              </p>
            </div>
          </Card>
        </>
      ) : (
        <>
          <ContractOrError error={error} env={env} />
          <InsightLayout findings={findings} onCta={ctx.goTo} evidenceSummary="Show the per-dimension detail"
            evidence={
              <>
                <div className="ii-qstats">
                  <QuietStat label="Average change" word={`${o.mean_delta > 0 ? "+" : ""}${o.mean_delta} pts`} tone={o.mean_delta >= 3 ? "good" : o.mean_delta <= -3 ? "bad" : "neutral"} figure="first → latest interview" />
                  <QuietStat label="Median change" word={`${o.median_delta > 0 ? "+" : ""}${o.median_delta} pts`} />
                  <QuietStat label="Improving" word={`${o.pct_improving}%`} tone={o.pct_improving >= 50 ? "good" : "warn"} />
                  <QuietStat label="Measured" word={`${o.n_students}`} figure={`${s.students_with_repeat_practice} practised repeatedly`} />
                </div>
                <SectionTitle hint="change across repeated practice">By competency dimension</SectionTitle>
                <DeltaBars rows={(env.by_dimension || []).map((d) => ({
                  key: d.key, label: dimensionLabel(d.key), delta: d.mean_delta, suppressed: d.suppressed, n_students: d.n_students, min_n: MIN_COHORT_N }))} />
                <p className="ii-text-sm ii-muted" style={{ marginTop: 12 }}>{env.method}</p>
              </>
            }
          />
          <AnonNote min={MIN_COHORT_N} />
        </>
      )}
    </>
  );
}

function bandLabel(k) {
  return { strong: "Strong", solid: "Solid", developing: "Developing", priority: "Priority" }[k] || k;
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
