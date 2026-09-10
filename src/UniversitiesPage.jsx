import React from "react";
import {
  ArrowLeft, ArrowRight, ChevronRight, CalendarClock, Target, Radar,
  LineChart, Users, GraduationCap, ShieldCheck, MessageSquare, ClipboardList,
  Sparkles, BookOpen, TrendingUp, Layers, CheckCircle2, UserCheck, Building2,
} from "lucide-react";

/* ==================================================================== *
 * JOB.READY FOR UNIVERSITIES  —  public B2B landing page for EKI²
 * -------------------------------------------------------------------- *
 * Presentation only. Lazy-loaded by App.jsx (screen === "universities")
 * so it never enters the student bundle and runs no Supabase query.
 *
 * It reuses the EKI² PRODUCT LANGUAGE and dashboard patterns, rendered
 * here from small static replicas fed CLEARLY SYNTHETIC data — no real
 * student rows, no live analytics, no import of the institutional tree.
 *
 * Positioning rules honoured throughout:
 *   • EKI² is JOB.READY's institutional product, not a separate company.
 *   • We measure interview readiness, practice performance, development
 *     and careers engagement — never predicted employment outcomes.
 *   • No fabricated certifications, adoption figures or testimonials.
 *   • Every number below is labelled illustrative / synthetic.
 * ==================================================================== */

const MAXW = 1080;
const SYNTHETIC = "Illustrative dashboard · synthetic data";

/* ---- tiny local primitives (no coupling to App.jsx internals) ------ */

function Btn({ children, onClick, variant = "primary", style }) {
  const base = {
    fontFamily: "var(--font)", fontSize: 14.5, fontWeight: 600, border: "none",
    cursor: "pointer", padding: "13px 24px", borderRadius: "var(--r-sm)",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
  };
  const variants = {
    primary: { background: "var(--blue)", color: "#fff", boxShadow: "0 16px 36px -14px rgba(37,99,235,0.5)" },
    onDark: { background: "#fff", color: "var(--navy)" },
    ghostDark: { background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.22)" },
    secondary: { background: "#fff", color: "var(--navy)", border: "1.5px solid var(--border)" },
  };
  return (
    <button type="button" className="jr-btn" onClick={onClick} style={{ ...base, ...(variants[variant] || variants.primary), ...style }}>
      {children}
    </button>
  );
}

function Eyebrow({ children, tone = "var(--blue)" }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.11em", textTransform: "uppercase", color: tone, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function Section({ children, tone = "plain", style, id }) {
  const bg =
    tone === "navy" ? "var(--navy)"
    : tone === "surface" ? "var(--card)"
    : "transparent";
  const border = tone === "surface" || tone === "navy" ? "1px solid var(--border)" : "none";
  return (
    <section id={id} style={{ background: bg, borderTop: border, borderBottom: tone === "surface" ? border : "none", ...style }}>
      <div style={{ maxWidth: MAXW, margin: "0 auto", padding: "clamp(52px, 8vw, 84px) 24px" }}>
        {children}
      </div>
    </section>
  );
}

function H2({ children, light = false, style }) {
  return (
    <h2 style={{ fontSize: "clamp(24px, 4vw, 33px)", lineHeight: 1.2, fontWeight: 800, letterSpacing: "-0.02em", color: light ? "#fff" : "var(--navy)", margin: 0, textWrap: "balance", ...style }}>
      {children}
    </h2>
  );
}

function Lede({ children, light = false, style }) {
  return (
    <p style={{ fontSize: "clamp(14.5px, 1.8vw, 16.5px)", lineHeight: 1.65, color: light ? "rgba(255,255,255,0.82)" : "var(--text-dim)", margin: "14px 0 0", maxWidth: 640, ...style }}>
      {children}
    </p>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", padding: 22, boxShadow: "var(--shadow-sm)", ...style }}>
      {children}
    </div>
  );
}

function SyntheticTag({ light = false }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: light ? "rgba(255,255,255,0.5)" : "var(--text-faint)", marginTop: 12 }}>
      {SYNTHETIC}
    </div>
  );
}

/* ---- synthetic EKI² dashboard replicas ----------------------------- */

const READINESS = [
  { key: "ready", label: "Interview-ready", pct: 34, color: "#0F9D6E" },
  { key: "developing", label: "Developing", pct: 47, color: "#2563EB" },
  { key: "needs", label: "Needs support", pct: 19, color: "#D97706" },
];

function ReadinessDistribution({ compact = false }) {
  return (
    <div>
      <div style={{ display: "flex", height: compact ? 14 : 18, borderRadius: 999, overflow: "hidden", border: "1px solid var(--border)" }}>
        {READINESS.map((s) => (
          <div key={s.key} style={{ width: `${s.pct}%`, background: s.color }} aria-label={`${s.label} ${s.pct}%`} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 10 }}>
        {READINESS.map((s) => (
          <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-dim)", fontWeight: 600 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color }} /> {s.label} · {s.pct}%
          </span>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-faint)", marginTop: 8 }}>212 students assessed this term</div>
    </div>
  );
}

function Sparkline({ points, stroke = "var(--blue)", width = 168, height = 44 }) {
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(height - ((p - min) / span) * (height - 8) - 4).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: "block" }}>
      <path d={d} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={(i * step).toFixed(1)} cy={(height - ((p - min) / span) * (height - 8) - 4).toFixed(1)} r={i === points.length - 1 ? 3.5 : 2} fill={stroke} />
      ))}
    </svg>
  );
}

function InsightCard({ lead, why, figure, tone = "var(--blue)" }) {
  return (
    <div style={{ borderLeft: `3px solid ${tone}`, padding: "4px 0 4px 16px" }}>
      <div style={{ fontSize: 15.5, fontWeight: 700, color: "var(--navy)", lineHeight: 1.4 }}>{lead}</div>
      {why ? <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.55, marginTop: 6 }}>{why}</div> : null}
      {figure ? <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--navy)", marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{figure}</div> : null}
    </div>
  );
}

function HeroDashboard() {
  return (
    <div style={{ borderRadius: 20, padding: 1.5, background: "linear-gradient(135deg, rgba(37,99,235,0.55), rgba(124,58,237,0.5) 54%, rgba(56,189,248,0.34))", boxShadow: "0 30px 70px -24px rgba(16,24,40,0.45)" }}>
      <div style={{ background: "var(--card)", borderRadius: 18, padding: "clamp(18px, 3vw, 26px)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-faint)" }}>EKI² · Overview</div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--blue-dark)", background: "var(--highlight)", padding: "3px 9px", borderRadius: 999 }}>Finance &amp; Consulting 2026</div>
        </div>

        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-dim)", marginBottom: 8 }}>How interview-ready are our students?</div>
        <ReadinessDistribution compact />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 20 }}>
          <div style={{ background: "var(--surface-sunken)", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-faint)" }}>No contact yet</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)", marginTop: 4 }}>7</div>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>may benefit from first-time support</div>
          </div>
          <div style={{ background: "var(--surface-sunken)", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-faint)" }}>Follow-ups due</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)", marginTop: 4 }}>4</div>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>agreed actions to check in on</div>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-faint)", marginBottom: 8 }}>Key institutional insight</div>
          <InsightCard
            lead="Evidence is the most common development area across three programmes."
            why="Structured answers have improved this term; supporting answers with specific examples has not moved at the same rate."
            figure="Evidence below target for 41% of assessed students"
          />
        </div>
        <SyntheticTag />
      </div>
    </div>
  );
}

/* ---- loop / step data -------------------------------------------- */

const LOOP = [
  { n: "01", title: "Students practice", body: "Students complete AI-powered interview practice through JOB.READY.", icon: MessageSquare },
  { n: "02", title: "EKI² understands", body: "Practice data becomes structured employability intelligence.", icon: Radar },
  { n: "03", title: "Careers teams identify", body: "EKI² highlights readiness patterns, development areas, students needing support and programme-level opportunities.", icon: Target },
  { n: "04", title: "Careers teams intervene", body: "Message students, arrange appointments and provide targeted support.", icon: CalendarClock },
  { n: "05", title: "Students develop", body: "Students receive development plans, resources and targeted practice.", icon: BookOpen },
  { n: "06", title: "EKI² measures progress", body: "Track trajectory, Interview DNA, follow-up and development over time.", icon: LineChart },
  { n: "07", title: "Institutions learn", body: "Programme-level intelligence reveals recurring employability patterns.", icon: Building2 },
];

const INTERVENTION_STEPS = ["Identify", "Message", "Arrange support", "Meet", "Record outcome", "Follow up", "Measure development"];

const AUDIENCES = [
  { role: "Careers Directors", body: "Understand institution-wide patterns and where intervention may be needed.", icon: Building2 },
  { role: "Careers Advisers", body: "Arrive at student conversations with the context already assembled.", icon: UserCheck },
  { role: "Employability Teams", body: "Identify recurring development needs and target interventions.", icon: Target },
  { role: "Students", body: "Understand their own development and receive targeted support.", icon: GraduationCap },
  { role: "Programme Leaders", body: "Understand programme-level employability development patterns.", icon: Layers },
];

const WHY = [
  { title: "From data to action", body: "Most analytics show what happened. EKI² connects each insight to a specific intervention — message, appointment, development plan, follow-up." },
  { title: "From isolated practice to longitudinal development", body: "Interview DNA and trajectory track change across repeated practice, rather than treating every interview as a separate event." },
  { title: "From individual support to institutional intelligence", body: "The same evidence rolls up from one student, to a programme, to institution-wide employability patterns." },
  { title: "Built around intervention", body: "Every screen ends in something a careers team can do: identify, act, follow up, measure." },
];

const TRUST = [
  "Institution-scoped access — staff see only their own institution's students.",
  "Role-based staff access for careers-team members.",
  "Student-level access controls — a student sees only their own data.",
  "Protected adviser information — internal notes and outcomes are staff-only and never shown to students.",
  "Aggregate privacy controls on institutional analytics.",
  "k-anonymised institutional and programme analytics, with small groups suppressed rather than shown.",
];

const ONBOARDING = [
  { n: "1", title: "Connect your institution", body: "Set up your institution and staff access." },
  { n: "2", title: "Bring students into JOB.READY", body: "Students begin interview practice." },
  { n: "3", title: "EKI² starts building intelligence", body: "Practice activity creates structured employability insight." },
  { n: "4", title: "Careers teams intervene", body: "Identify students and provide targeted support." },
  { n: "5", title: "Measure development", body: "Track student and programme-level change over time." },
];

const PROGRAMME_PULSE = [
  { programme: "Computer Science", ready: 63, weakest: "Commercial awareness", trajectory: "Improving" },
  { programme: "Economics", ready: 51, weakest: "Evidence", trajectory: "Stable" },
  { programme: "Finance", ready: 48, weakest: "Evidence", trajectory: "Mixed" },
];

/* ---- page ------------------------------------------------------- */

export default function UniversitiesPage({ onDemo, onExplore, onBack }) {
  const stepArrow = (
    <div style={{ display: "flex", justifyContent: "center", color: "var(--text-faint)", padding: "2px 0" }}>
      <ChevronRight size={16} style={{ transform: "rotate(90deg)" }} aria-hidden="true" />
    </div>
  );

  return (
    <div className="jr-fade">
      {/* ============ HERO ============ */}
      <div className="jr-landing-hero">
        <div style={{ maxWidth: MAXW, margin: "0 auto", padding: "clamp(40px, 7vw, 68px) 24px clamp(32px, 5vw, 48px)" }}>
          <button type="button" onClick={onBack} className="jr-btn" style={{ background: "transparent", border: "none", color: "var(--text-dim)", fontFamily: "var(--font)", fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 4px", marginBottom: 22 }}>
            <ArrowLeft size={14} /> Back to JOB.READY
          </button>

          <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 40, alignItems: "center" }}>
            <div>
              <Eyebrow>JOB.READY for universities</Eyebrow>
              <h1 style={{ fontSize: "clamp(30px, 5.2vw, 46px)", lineHeight: 1.14, fontWeight: 800, letterSpacing: "-0.03em", margin: "8px 0 16px", color: "var(--navy)", textWrap: "balance" }}>
                Turn interview practice into employability intelligence.
              </h1>
              <p style={{ fontSize: "clamp(14.5px, 2vw, 17px)", color: "var(--text-dim)", lineHeight: 1.65, maxWidth: 540 }}>
                EKI² turns students' JOB.READY interview practice into actionable intelligence for
                university Careers &amp; Employability teams. Students practise. EKI² identifies patterns.
                Careers teams intervene. Students develop. Institutions learn.
              </p>
              <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.6, maxWidth: 540, marginTop: 12 }}>
                EKI² measures interview readiness, practice performance, development and careers
                engagement. It does not claim to predict hiring outcomes or graduate employment.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 26 }}>
                <Btn onClick={onDemo}>Book a university demo <ChevronRight size={16} /></Btn>
                <Btn variant="secondary" onClick={onExplore}>Explore EKI² <ArrowRight size={15} /></Btn>
              </div>
            </div>
            <HeroDashboard />
          </div>
        </div>
      </div>

      {/* ============ THE LOOP IN ONE LINE ============ */}
      <Section tone="surface" style={{ background: "var(--surface-sunken)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10, textAlign: "center" }}>
          {["Students practice", "EKI² identifies patterns", "Careers teams intervene", "Students develop", "Institutions learn"].map((t, i, arr) => (
            <React.Fragment key={t}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)" }}>{t}</span>
              {i < arr.length - 1 ? <span style={{ color: "var(--text-faint)" }}>→</span> : null}
            </React.Fragment>
          ))}
        </div>
      </Section>

      {/* ============ FROM PRACTICE TO INTERVENTION (the loop) ============ */}
      <Section>
        <div style={{ maxWidth: 620, marginBottom: 40 }}>
          <Eyebrow tone="var(--violet)">The EKI² ecosystem</Eyebrow>
          <H2>From practice to intervention</H2>
          <Lede>
            EKI² is a closed-loop employability system, not a dashboard. Each stage feeds the next.
          </Lede>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 14 }}>
          {LOOP.map((s) => (
            <Card key={s.n} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--blue)", fontVariantNumeric: "tabular-nums" }}>{s.n}</span>
                <span style={{ width: 38, height: 38, borderRadius: 10, background: "var(--highlight)", color: "var(--blue-dark)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <s.icon size={18} aria-hidden="true" />
                </span>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--navy)", marginBottom: 4 }}>{s.title}</div>
                <div style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.6 }}>{s.body}</div>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* ============ WALKTHROUGH: SEE WHERE STUDENTS STAND ============ */}
      <Section tone="surface" id="walkthrough">
        <div style={{ maxWidth: 620, marginBottom: 36 }}>
          <Eyebrow>Product walkthrough</Eyebrow>
          <H2>See where students stand</H2>
          <Lede>
            Understand where students are in their interview readiness and identify where Careers
            teams may need to focus. This is practice performance — not an employment prediction.
          </Lede>
        </div>
        <Card style={{ padding: "clamp(20px, 3vw, 30px)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-dim)", marginBottom: 12 }}>Performance — how interview-ready are our students?</div>
          <ReadinessDistribution />
          <SyntheticTag />
        </Card>
      </Section>

      {/* ============ IDENTIFY STUDENTS WHO NEED SUPPORT ============ */}
      <Section>
        <div style={{ maxWidth: 620, marginBottom: 32 }}>
          <Eyebrow tone="var(--violet)">Identify</Eyebrow>
          <H2>Find the students who need support first</H2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 18 }}>
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--tint-warning)", color: "var(--tint-warning-fg)", display: "flex", alignItems: "center", justifyContent: "center" }}><Users size={15} /></span>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--navy)" }}>No Contact Yet</div>
            </div>
            <div style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.6 }}>
              Identify students who may benefit from Careers support but have not yet had a recorded intervention.
            </div>
            <div style={{ background: "var(--surface-sunken)", borderRadius: 12, padding: "14px 16px", margin: "14px 0" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "var(--navy)" }}>7 students</div>
              <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>may benefit from first-time support</div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {["Review students", "Message", "Arrange support"].map((a) => (
                <span key={a} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--blue-dark)", background: "var(--highlight)", padding: "6px 11px", borderRadius: 999 }}>{a}</span>
              ))}
            </div>
          </Card>
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--tint-info)", color: "var(--tint-info-fg)", display: "flex", alignItems: "center", justifyContent: "center" }}><LineChart size={15} /></span>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--navy)" }}>Stuck Students</div>
            </div>
            <div style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.6 }}>
              Identify students who are practising repeatedly without meaningful recent improvement.
            </div>
            <div style={{ background: "var(--surface-sunken)", borderRadius: 12, padding: "14px 16px", margin: "14px 0", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: "var(--navy)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em" }}>42 → 51 → 58 → 58 → 59</span>
              <Sparkline points={[42, 51, 58, 58, 59]} stroke="var(--warn)" width={120} height={36} />
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>An intervention opportunity, not a judgement — language stays measured ("appears to be stuck", "limited recent improvement").</div>
          </Card>
        </div>
      </Section>

      {/* ============ STUDENT CAREERS PROFILE ============ */}
      <Section tone="navy">
        <div style={{ maxWidth: 620, marginBottom: 30 }}>
          <Eyebrow tone="#93b4ff">Understand the individual student</Eyebrow>
          <H2 light>The Student Careers Profile</H2>
          <Lede light>
            One of EKI²'s most powerful capabilities. An adviser opens a single screen and the
            student's history is already assembled — nothing to reconstruct by hand.
          </Lede>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 10 }}>
          {[
            "Current readiness", "Strengths", "Development areas",
            "Application context", "Interview history", "Trajectory",
            "Previous Careers support", "Appointment outcomes", "Development plan",
            "Relevant resources",
          ].map((t) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px 13px" }}>
              <CheckCircle2 size={14} style={{ color: "#93b4ff", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#E2E8F0" }}>{t}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ============ INTERVIEW DNA + TRAJECTORY ============ */}
      <Section>
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 20 }}>
          <Card>
            <Eyebrow tone="var(--violet)">Interview DNA</Eyebrow>
            <H2 style={{ fontSize: "clamp(19px, 2.6vw, 23px)" }}>See how a student's interview profile changes over time</H2>
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { dim: "Evidence", from: 43, to: 61 },
                { dim: "Structure", from: 49, to: 65 },
                { dim: "Communication", from: 58, to: 62 },
              ].map((r) => (
                <div key={r.dim} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--navy)" }}>{r.dim}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                    {r.from} <ArrowRight size={12} style={{ verticalAlign: "middle" }} /> <span style={{ color: r.to - r.from >= 8 ? "var(--good)" : "var(--navy)" }}>{r.to}</span>
                    <span style={{ fontSize: 11.5, color: "var(--good)", marginLeft: 6 }}>+{r.to - r.from}</span>
                  </span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6, marginTop: 14 }}>
              EKI² makes development visible, rather than treating each interview as an isolated event.
            </div>
            <SyntheticTag />
          </Card>
          <Card>
            <Eyebrow tone="var(--teal)">Student Trajectory</Eyebrow>
            <H2 style={{ fontSize: "clamp(19px, 2.6vw, 23px)" }}>Not only where a student is — where their practice is heading</H2>
            <div style={{ background: "var(--surface-sunken)", borderRadius: 12, padding: "16px", margin: "16px 0", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: "var(--navy)", fontVariantNumeric: "tabular-nums" }}>48 → 53 → 57 → 61 → 64</span>
              <Sparkline points={[48, 53, 57, 61, 64]} stroke="var(--good)" width={150} height={40} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {["Improving", "Stable", "Plateauing", "Declining", "Insufficient data"].map((c) => (
                <span key={c} style={{ fontSize: 12, fontWeight: 700, color: c === "Improving" ? "#fff" : "var(--text-dim)", background: c === "Improving" ? "var(--good)" : "var(--surface-sunken)", border: "1px solid var(--border)", padding: "5px 10px", borderRadius: 999 }}>{c}</span>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 12 }}>
              Classifications use documented thresholds applied consistently to every student.
            </div>
          </Card>
        </div>
      </Section>

      {/* ============ INTERVENTION LOOP ============ */}
      <Section tone="surface">
        <div style={{ maxWidth: 620, marginBottom: 30 }}>
          <Eyebrow tone="var(--violet)">Intervene</Eyebrow>
          <H2>EKI² closes the gap between analytics and action</H2>
          <Lede>Every insight ends in something a careers team can do — using the existing messaging, appointment and outcome workflows.</Lede>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {INTERVENTION_STEPS.map((s, i, arr) => (
            <React.Fragment key={s}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--navy)", background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: 999, padding: "9px 15px" }}>{s}</span>
              {i < arr.length - 1 ? <ArrowRight size={14} style={{ color: "var(--text-faint)" }} /> : null}
            </React.Fragment>
          ))}
        </div>
      </Section>

      {/* ============ DEVELOPMENT PLANS + RESOURCES ============ */}
      <Section>
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 20 }}>
          <Card>
            <Eyebrow>The student experience</Eyebrow>
            <H2 style={{ fontSize: "clamp(19px, 2.6vw, 23px)" }}>Personalised Development Plans</H2>
            <div style={{ marginTop: 16, borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
              {[
                ["Priority", "Evidence"],
                ["Current status", "Developing"],
                ["Recommended action", "Complete evidence-based answer exercise"],
                ["Practice", "2 targeted interview questions"],
                ["Target", "70"],
                ["Status", "In progress"],
              ].map(([k, v], i) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 14px", background: i % 2 ? "var(--surface-sunken)" : "var(--card)", fontSize: 13 }}>
                  <span style={{ color: "var(--text-dim)", fontWeight: 600 }}>{k}</span>
                  <span style={{ color: "var(--navy)", fontWeight: 700, textAlign: "right" }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6, marginTop: 14 }}>
              EKI² turns institutional insight into an actionable student development journey — reviewed and edited by advisers.
            </div>
          </Card>
          <Card>
            <Eyebrow tone="var(--teal)">Targeted resources</Eyebrow>
            <H2 style={{ fontSize: "clamp(19px, 2.6vw, 23px)" }}>Recommended from a student's observed development needs</H2>
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                ["Evidence gap", "STAR answer guide"],
                ["Structure gap", "Structured interview response exercise"],
                ["Commercial awareness gap", "Commercial awareness practice"],
              ].map(([gap, res]) => (
                <div key={gap} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", background: "var(--surface-sunken)", borderRadius: 10 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--warn)" }}>{gap}</span>
                  <ArrowRight size={13} style={{ color: "var(--text-faint)" }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--navy)" }}>{res}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-faint)", marginTop: 12 }}>
              Recommendations are matched deterministically from development areas — not generated per student by AI.
            </div>
          </Card>
        </div>
      </Section>

      {/* ============ AI CAREERS ADVISER BRIEFING ============ */}
      <Section tone="navy">
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 32, alignItems: "center" }}>
          <div>
            <Eyebrow tone="#93b4ff"><Sparkles size={12} style={{ verticalAlign: "middle", marginRight: 4 }} /> AI Careers Adviser Briefing</Eyebrow>
            <H2 light>Less time reconstructing history. More time supporting the student.</H2>
            <Lede light>
              EKI² brings together the student's existing evidence — readiness, trajectory, Interview DNA,
              previous sessions — and synthesises a concise briefing for the adviser. The AI works only
              from structured EKI² intelligence. It does not independently diagnose students, and every
              other figure in EKI² is produced without AI.
            </Lede>
          </div>
          <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 16, padding: 22 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "#93b4ff", marginBottom: 10 }}>Suggested focus for today's session</div>
            <p style={{ fontSize: 14, lineHeight: 1.7, color: "#E2E8F0", margin: 0 }}>
              This student has improved from 48 to 61 across recent practice. Structure has improved
              significantly, while Evidence remains the main development area. The previous session
              focused on answer structure, so today's session could focus on producing stronger
              evidence-based examples.
            </p>
            <SyntheticTag light />
          </div>
        </div>
      </Section>

      {/* ============ FOLLOW-UP ============ */}
      <Section>
        <div style={{ maxWidth: 620, marginBottom: 28 }}>
          <Eyebrow tone="var(--violet)">Follow-up</Eyebrow>
          <H2>Never lose the thread</H2>
          <Lede>
            EKI² surfaces follow-ups due, previous interventions, agreed actions, review dates,
            students returning to practice and students still below target.
          </Lede>
        </div>
        <Card style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)" }}>4 follow-ups due</div>
            <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>derived from outcomes and development-plan review dates — no separate task system</div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {["Message", "Arrange appointment", "Complete follow-up"].map((a) => (
              <span key={a} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--blue-dark)", background: "var(--highlight)", padding: "7px 12px", borderRadius: 999 }}>{a}</span>
            ))}
          </div>
        </Card>
      </Section>

      {/* ============ PROGRAMME EMPLOYABILITY PULSE ============ */}
      <Section tone="surface">
        <div style={{ maxWidth: 620, marginBottom: 28 }}>
          <Eyebrow>From individual to programme</Eyebrow>
          <H2>Programme Employability Pulse</H2>
          <Lede>Understand where employability support may be most valuable across programmes.</Lede>
        </div>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 460 }}>
              <thead>
                <tr style={{ background: "var(--surface-sunken)", textAlign: "left" }}>
                  <th style={{ padding: "12px 16px", fontWeight: 700, color: "var(--text-dim)" }}>Programme</th>
                  <th style={{ padding: "12px 16px", fontWeight: 700, color: "var(--text-dim)", textAlign: "right" }}>Interview-ready</th>
                  <th style={{ padding: "12px 16px", fontWeight: 700, color: "var(--text-dim)" }}>Weakest competency</th>
                  <th style={{ padding: "12px 16px", fontWeight: 700, color: "var(--text-dim)" }}>Trajectory</th>
                </tr>
              </thead>
              <tbody>
                {PROGRAMME_PULSE.map((r) => (
                  <tr key={r.programme} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "12px 16px", fontWeight: 700, color: "var(--navy)" }}>{r.programme}</td>
                    <td style={{ padding: "12px 16px", fontWeight: 800, color: "var(--navy)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.ready}%</td>
                    <td style={{ padding: "12px 16px", color: "var(--text-dim)" }}>{r.weakest}</td>
                    <td style={{ padding: "12px 16px", color: "var(--text-dim)" }}>{r.trajectory}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "10px 16px", fontSize: 11.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-faint)", borderTop: "1px solid var(--border)" }}>
            {SYNTHETIC} · programmes below the minimum group size are suppressed, not shown
          </div>
        </Card>
        <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6, marginTop: 14, maxWidth: 640 }}>
          Alongside interview-ready share, each programme shows its strongest and weakest
          competency, trajectory, {"careers engagement"} and recurring development needs.
        </div>
      </Section>

      {/* ============ PROGRAMME-LEVEL INTELLIGENCE ============ */}
      <Section>
        <div style={{ maxWidth: 620, marginBottom: 30 }}>
          <Eyebrow tone="var(--violet)">The institutional strategic layer</Eyebrow>
          <H2>Programme-Level Intelligence</H2>
          <Lede>
            Move from student-level intervention, to programme-level insight, to institutional strategy.
            These figures describe interview readiness and development — not graduate employment.
          </Lede>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 14 }}>
          {[
            { lead: "Finance students show a recurring Evidence development gap.", tone: "var(--warn)" },
            { lead: "Evidence is the most common development area across three programmes.", tone: "var(--warn)" },
            { lead: "14 students moved from Developing to Interview-ready this term.", tone: "var(--good)" },
            { lead: "6 careers follow-ups are currently due.", tone: "var(--blue)" },
          ].map((x) => (
            <Card key={x.lead}><InsightCard lead={x.lead} tone={x.tone} /></Card>
          ))}
        </div>
        <SyntheticTag />
      </Section>

      {/* ============ BUILT FOR ... ============ */}
      <Section tone="surface">
        <div style={{ maxWidth: 620, marginBottom: 32 }}>
          <Eyebrow>Who it's for</Eyebrow>
          <H2>Built for the people who support student employability</H2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 14 }}>
          {AUDIENCES.map((a) => (
            <Card key={a.role} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, background: "var(--highlight)", color: "var(--blue-dark)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <a.icon size={17} aria-hidden="true" />
              </span>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--navy)" }}>{a.role}</div>
              <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6 }}>{a.body}</div>
            </Card>
          ))}
        </div>
      </Section>

      {/* ============ WHY EKI² ============ */}
      <Section>
        <div style={{ maxWidth: 620, marginBottom: 32 }}>
          <Eyebrow tone="var(--violet)">Why EKI²</Eyebrow>
          <H2>Analytics show what happened. EKI² connects insight to intervention.</H2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 14 }}>
          {WHY.map((w) => (
            <Card key={w.title}>
              <div style={{ fontSize: 15.5, fontWeight: 800, color: "var(--navy)", marginBottom: 6 }}>{w.title}</div>
              <div style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.65 }}>{w.body}</div>
            </Card>
          ))}
        </div>
      </Section>

      {/* ============ SECURITY / TRUST ============ */}
      <Section tone="navy">
        <div style={{ maxWidth: 640 }}>
          <Eyebrow tone="#93b4ff"><ShieldCheck size={12} style={{ verticalAlign: "middle", marginRight: 4 }} /> Trust</Eyebrow>
          <H2 light>Designed for institutional data boundaries</H2>
          <Lede light>
            EKI² is built around institution-scoped access and layered privacy controls. The points
            below describe how the system is architected — they are not legal guarantees or
            certifications.
          </Lede>
          <ul style={{ listStyle: "none", padding: 0, margin: "22px 0 0", display: "flex", flexDirection: "column", gap: 12 }}>
            {TRUST.map((t) => (
              <li key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, color: "#E2E8F0", lineHeight: 1.6 }}>
                <ShieldCheck size={15} style={{ color: "#93b4ff", flexShrink: 0, marginTop: 2 }} />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* ============ ONBOARDING ============ */}
      <Section tone="surface">
        <div style={{ maxWidth: 620, marginBottom: 32 }}>
          <Eyebrow>Implementation</Eyebrow>
          <H2>Getting started with JOB.READY + EKI²</H2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {ONBOARDING.map((s, i) => (
            <React.Fragment key={s.n}>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px" }}>
                <span style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 999, background: "var(--navy)", color: "#fff", fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{s.n}</span>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--navy)" }}>{s.title}</div>
                  <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6, marginTop: 2 }}>{s.body}</div>
                </div>
              </div>
              {i < ONBOARDING.length - 1 ? stepArrow : null}
            </React.Fragment>
          ))}
        </div>
      </Section>

      {/* ============ FINAL CTA ============ */}
      <div className="jr-landing-cta" style={{ padding: "clamp(60px, 10vw, 92px) 24px", textAlign: "center" }}>
        <h2 style={{ position: "relative", fontSize: "clamp(23px, 4.4vw, 34px)", fontWeight: 800, color: "#fff", marginBottom: 14, letterSpacing: "-0.02em", textWrap: "balance", maxWidth: 660, margin: "0 auto 14px" }}>
          Ready to turn interview practice into employability intelligence?
        </h2>
        <p style={{ position: "relative", color: "#AFC4E6", fontSize: 15.5, marginBottom: 28, maxWidth: 540, marginLeft: "auto", marginRight: "auto" }}>
          See how JOB.READY and EKI² could work within your Careers &amp; Employability team.
        </p>
        <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
          <Btn onClick={onDemo} variant="onDark">Book a university demo <ChevronRight size={16} /></Btn>
          <Btn onClick={onDemo} variant="ghostDark">Talk to us</Btn>
        </div>
      </div>
    </div>
  );
}
