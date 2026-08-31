/* ================================================================== *
 * PHASE 29 — PREMIUM VISUAL REDESIGN (STRUCTURAL, over src/App.jsx)
 * ------------------------------------------------------------------
 * Phase 29 lifts the authenticated product onto a premium surface
 * system: an ambient page wash, layered elevation, a radial readiness
 * metric, featured "intelligence" surfaces, coloured icon badges and a
 * deterministic progress meter. It must NOT change routing, handlers,
 * gating, AI calls, scoring or auth, and every derived number must come
 * from existing state (no invented metrics). Node env — source guards.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const TOKENS = (() => { const s = SRC.indexOf("const TOKENS = `"); return SRC.slice(s, SRC.indexOf("`;", s)); })();
const between = (a, b) => { const s = SRC.indexOf(a); const e = SRC.indexOf(b, s + 1); if (s < 0 || e < 0) throw new Error("markers: " + a); return SRC.slice(s, e); };
const DASH = between('{screen === "dashboard" && user && (', "PHASE 16A — APPLICATIONS PILLAR");
const APPS = between('{screen === "applications" && user && (', "ADD / EDIT APPLICATION (no AI)");
const PROGRESS = between('{screen === "progress" && (', "CLASSROOM DASHBOARD");
const INTERVIEW = between('{screen === "interview" && interview && (()', "PHASE 4B: ASYNC");
const REPORTBODY = SRC.slice(SRC.indexOf("function ReportBody("), SRC.indexOf("function AcScorecardBody("));

describe("Phase 29 — the premium token layer is additive", () => {
  it("keeps every token earlier phases depend on", () => {
    for (const t of ["--navy:", "--blue:", "--violet:", "--radius:14px", "--surface-sunken:", "--tint-success:", "--r-sm:", "--focus-ring:"]) {
      expect(TOKENS).toContain(t);
    }
  });
  it("adds surface / icon-badge / ring tokens", () => {
    for (const t of ["--featured-violet-bg:", "--featured-blue-bg:", "--ib-blue-bg:", "--ib-violet-fg:", "--ib-warn-bg:", "--shadow-xs:", "--ring-track:"]) {
      expect(TOKENS).toContain(t);
    }
  });
  it("elevation is layered (two shadow parts), not a single flat drop", () => {
    expect(TOKENS).toMatch(/--shadow-sm:[^;]*,[^;]*;/);
    expect(TOKENS).toMatch(/--shadow-md:[^;]*,[^;]*;/);
  });
  it("the body carries a subtle ambient wash and no external dependency was added", () => {
    expect(TOKENS).toMatch(/body\{[\s\S]*?background-image:[\s\S]*?radial-gradient/);
    expect((TOKENS.match(/@import/g) || []).length).toBe(1);           // still only the Inter font
    expect(TOKENS).not.toMatch(/@font-face|cdn\.|unpkg|jsdelivr/i);
  });
  it("defines the new presentation classes", () => {
    for (const c of [".jr-metric", ".jr-metric-value", ".jr-icon-badge", ".jr-ib-violet", ".jr-featured", ".jr-featured-blue", ".jr-progress", ".jr-progress-fill", ".jr-chartbar"]) {
      expect(TOKENS).toMatch(new RegExp(c.replace(/[.]/g, "\\.") + "[\\s,{:]"));
    }
  });
});

describe("Phase 29 — new primitives exist and stay presentation-only", () => {
  it("declares IconBadge / MetricCard / FeaturedCard / ProgressMeter", () => {
    for (const f of ["function IconBadge(", "function MetricCard(", "function FeaturedCard(", "function ProgressMeter("]) {
      expect(SRC).toContain(f);
    }
  });
  it("FeaturedCard mirrors Card's keyboard activation when interactive", () => {
    const fc = SRC.slice(SRC.indexOf("function FeaturedCard("), SRC.indexOf("function ProgressMeter("));
    expect(fc).toMatch(/role=\{interactive \? "button" : undefined\}/);
    expect(fc).toMatch(/e\.key === "Enter" \|\| e\.key === " "/);
  });
  it("ProgressMeter derives its width from value/max only — never an invented number", () => {
    const pm = SRC.slice(SRC.indexOf("function ProgressMeter("), SRC.indexOf("function ProgressMeter(") + 700);
    expect(pm).toMatch(/\(value \/ max\) \* 100/);
    expect(pm).toMatch(/role="progressbar"/);
    expect(pm).not.toMatch(/Math\.random|fetch\(|\+ *12|this week/);
  });
  it("the primitives carry no state, effects or IO", () => {
    const block = SRC.slice(SRC.indexOf("function IconBadge("), SRC.indexOf("function ProgressMeter(") + 800);
    expect(block).not.toMatch(/useState|useEffect|useRef|fetch\(|localStorage|supabase/);
  });
});

describe("Phase 29 — Dashboard is the reference implementation", () => {
  it("uses the metric / radial / featured / progress language", () => {
    expect(DASH).toContain("<MetricCard");
    expect(DASH).toContain("<RingScore");
    expect(DASH).toContain("<FeaturedCard");
    expect(DASH).toContain("<ProgressMeter");
  });
  it("the resume progress meter is fed real interview counts, gated on a known target", () => {
    expect(DASH).toMatch(/r\.targetQuestions > 0 && \(/);
    expect(DASH).toMatch(/<ProgressMeter value=\{r\.answeredCount\} max=\{r\.targetQuestions\}/);
    expect(DASH).toContain("{resumableProgressLabel(r)}");                // the honest label is kept
  });
  it("primary actions and shell markers are unchanged", () => {
    expect(DASH).toMatch(/onClick=\{\(\) => startCreateFlow\(false\)\}/);
    expect(DASH).toMatch(/onClick=\{\(\) => guarded\(\(\) => resumeInterviewById\(r\.id\)\)\}/);
    expect(DASH).toContain('className="jr-page-header"');
    expect(DASH).toContain('<h2 className="jr-h1">');
  });
  it("no AI call introduced on the Dashboard", () => {
    expect(DASH).not.toMatch(/callClaude|token_?budget/i);
  });
});

describe("Phase 29 — Applications reads as a command centre", () => {
  it("application rows are interactive cards that open the workspace", () => {
    expect(APPS).toMatch(/<Card key=\{app\.id\} onClick=\{\(\) => openApplication\(app\)\}/);
  });
  it("the countdown + partition wiring is unchanged", () => {
    expect(APPS).toMatch(/interviewCountdown\(app\.interviewDate\)/);
    expect(APPS).toContain("{cd.label}");
    expect(APPS).toContain("Upcoming interviews");
  });
});

describe("Phase 29 — Progress analytics feel like a product", () => {
  it("Interview DNA is grouped onto a featured surface", () => {
    const dna = PROGRESS.slice(PROGRESS.indexOf("Your Interview DNA"), PROGRESS.indexOf("Recommended next practice"));
    expect(dna).toContain("<FeaturedCard");
  });
  it("the score chart keeps its data, click + keyboard behaviour and gains a deterministic improvement highlight", () => {
    expect(PROGRESS).toMatch(/onClick=\{\(\) => openInterviewReport\(iv, "progress"\)\}/);
    expect(PROGRESS).toMatch(/e\.key === "Enter" \|\| e\.key === " "/);
    expect(PROGRESS).toMatch(/aria-label=\{`Attempt \$\{i \+ 1\}/);
    expect(PROGRESS).toMatch(/iv\.overall_score > interviewList\[0\]\.overall_score/);   // real improvement, not invented
  });
});

describe("Phase 29 — Report headline + Interview alignment", () => {
  it("the report score headline is a featured surface, still fed claimsTested", () => {
    expect(REPORTBODY).toContain("<FeaturedCard");
    expect(REPORTBODY).toMatch(/claimsTested/);
    expect(REPORTBODY).toMatch(/\{claimsTested\.length > 0 && \(/);       // still conditional, no placeholder
  });
  it("the interview answer field adopts the shared input foundation; submit logic untouched", () => {
    expect(INTERVIEW).toMatch(/className="jr-input jr-textarea"/);
    expect(INTERVIEW).toMatch(/onClick=\{\(\) => guarded\(submitAnswer\)\} disabled=\{!answerInput\.trim\(\)\}/);
  });
});

describe("Phase 29 — earlier phases not regressed", () => {
  it("Phase 23/26/27/28 primitives + auth markers intact", () => {
    for (const m of [
      '<PasswordInput id="signin-password"', "Forgot password?", "expiredLinkMessage",
      "function SectionHeading(", "function Alert(", "function EmptyState(", "function MetricCard(",
    ]) expect(SRC).toContain(m);
    for (const c of [".jr-page", ".jr-page-header", ".jr-h1", ".jr-input", ".jr-alert", ".jr-badge"]) {
      expect(TOKENS).toMatch(new RegExp(c.replace(/[.]/g, "\\.") + "[\\s,{:]"));
    }
  });
});
