/* ================================================================== *
 * PHASE 28 — SCREEN-LEVEL VISUAL CONSISTENCY (STRUCTURAL, over App.jsx)
 * ------------------------------------------------------------------
 * Phase 28 refines the five priority authenticated screens (Dashboard,
 * Applications, Classroom, Progress, Assessment Centre) onto the shared
 * Phase 26/27 design language: the .jr-page-header pattern, the .jr-meta
 * section-label scale, Alert / EmptyState, and lucide icons in place of
 * interface emoji. It must NOT change routing, handlers, gating, AI
 * calls, scoring or auth. The test env is node (no DOM), so these are
 * source-level guards against realistic regressions.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const between = (start, end) => {
  const s = SRC.indexOf(start);
  const e = SRC.indexOf(end, s + 1);
  if (s === -1 || e === -1) throw new Error(`markers not found: ${start} .. ${end}`);
  return SRC.slice(s, e);
};
const DASH = between('{screen === "dashboard" && user && (', "PHASE 16A — APPLICATIONS PILLAR");
const APPS = between('{screen === "applications" && user && (', "ADD / EDIT APPLICATION (no AI)");
const CLASSROOM = between('{screen === "classroom" && (', 'screen === "classroom_generating"');
const PROGRESS = between('{screen === "progress" && (', "CLASSROOM DASHBOARD");
const AC = between('{screen === "ac_home" && (', 'screen === "ac_generating"');

describe("Phase 28 — the five priority screens still exist and route the same way", () => {
  it("every priority screen block is present", () => {
    for (const s of ["dashboard", "applications", "classroom", "progress", "ac_home"]) {
      expect(SRC).toContain(`{screen === "${s}" && `);
    }
  });
  it("primary actions still call the exact same handlers (no behaviour change)", () => {
    expect(DASH).toMatch(/onClick=\{\(\) => startCreateFlow\(false\)\}/);          // Dashboard "New interview"
    expect(APPS).toMatch(/onClick=\{\(\) => openApplicationForm\(null\)\}/);       // Applications "Add Application"
    expect(CLASSROOM).toMatch(/guarded\(retrySaveModule\)/);                       // Classroom retry
    expect(CLASSROOM).toMatch(/guarded\(\(\) => openDevelopmentModule\(t\)\)/);    // Classroom "Start learning"
    expect(PROGRESS).toMatch(/onClick=\{\(\) => openInterviewReport\(iv, "progress"\)\}/);
    expect(AC).toMatch(/guarded\(\(\) => startAssessmentCentre\(t\.key\)\)/);
  });
  it("deterministic gating on the Progress screen is unchanged", () => {
    expect((PROGRESS.match(/\{interviewList\.length > 0 && \(/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(PROGRESS).toMatch(/Object\.entries\(globalCandidateState\?\.competencies \|\| \{\}\)/);
  });
  it("no priority screen introduces an AI call", () => {
    for (const block of [DASH, APPS, CLASSROOM, PROGRESS, AC]) {
      expect(block).not.toMatch(/callClaude|generate[A-Z]\w*\(|token_?budget/i);
    }
  });
});

describe("Phase 28 — screens adopt the shared shell header", () => {
  it("all five priority screens use .jr-page-header + .jr-h1", () => {
    for (const [name, block] of [["dashboard", DASH], ["applications", APPS], ["classroom", CLASSROOM], ["progress", PROGRESS], ["ac_home", AC]]) {
      expect(block, name).toContain('className="jr-page-header"');
      expect(block, name).toContain('<h2 className="jr-h1">');
    }
  });
  it("Classroom and Assessment Centre keep their identifying icon chip inside the header", () => {
    expect(CLASSROOM).toMatch(/jr-page-header[\s\S]{0,400}GraduationCap/);
    expect(AC).toMatch(/jr-page-header[\s\S]{0,400}Briefcase/);
  });
});

describe("Phase 28 — SectionHeading primitive is presentation-only", () => {
  it("is declared and used on the audited screens", () => {
    expect(SRC).toMatch(/function SectionHeading\(\{ icon: Icon, tone, children, style \}\)/);
    expect(PROGRESS).toContain("<SectionHeading");
  });
  it("carries no state, effects, handlers or IO of its own", () => {
    const block = SRC.slice(SRC.indexOf("function SectionHeading("), SRC.indexOf("function ScoreBar("));
    expect(block).not.toMatch(/useState|useEffect|useRef|onClick=|fetch\(|localStorage|supabase/);
  });
});

describe("Phase 28 — interface emoji replaced by lucide on the audited surfaces", () => {
  it("the Dashboard resume / continue-preparing cards no longer use 🎤 🔴 📚 as icons", () => {
    const region = DASH.slice(DASH.indexOf("resumableReady.map"), DASH.indexOf("perf?.weaknesses?.length > 0"));
    expect(region).not.toMatch(/[\u{1F3A4}\u{1F534}\u{1F4DA}]/u);
    // Phase 28 replaced the 🎤 emoji with a lucide <Mic>; Phase 29 then swapped
    // that for <History> ("resume", not audio — voice answers aren't a feature).
    // The contract here is unchanged: a lucide icon, never an emoji.
    expect(region).toMatch(/<History size=/);
    expect(region).toMatch(/continuePreparing\.evidenceType === "demonstrated"[\s\S]*?AlertCircle[\s\S]*?BookOpen/);
  });
  it("the Classroom recommendations heading no longer uses 🎯", () => {
    const region = CLASSROOM.slice(0, CLASSROOM.indexOf("Ranked by how much the role"));
    expect(region).not.toMatch(/\u{1F3AF}/u);
    expect(region).toMatch(/Recommended for your application/);
  });
});

describe("Phase 28 — status + empty states use the shared components", () => {
  it("Classroom surfaces the unsaved-module error through <Alert variant=\"error\">, retry handler intact", () => {
    expect(CLASSROOM).toMatch(/<Alert variant="error"[\s\S]*?guarded\(retrySaveModule\)/);
  });
  it("Applications and Classroom zero states use <EmptyState>", () => {
    expect(APPS).toMatch(/<EmptyState icon=\{Briefcase\}/);
    expect(CLASSROOM).toMatch(/interviewClassroom\.length === 0 \? \([\s\S]{0,200}<EmptyState/);
  });
});

describe("Phase 28 — accessibility of interactive content preserved", () => {
  it("the Progress score chart keeps keyboard activation and per-bar labelling", () => {
    expect(PROGRESS).toMatch(/onKeyDown=\{iv\.report \? \(e\) => \{ if \(e\.key === "Enter" \|\| e\.key === " "\)/);
    expect(PROGRESS).toMatch(/aria-label=\{`Attempt \$\{i \+ 1\}, \$\{iv\.company\}, score \$\{iv\.overall_score\}/);
  });
  it("Assessment Centre exercise cards are only interactive when a company+role is set", () => {
    // Phase 31 routed the card's onClick through an `onPick` handler (technical
    // exercises open a difficulty step first) — the company+role gate is unchanged:
    // onPick is `undefined` whenever !enabled, and both branches still gate on it.
    expect(AC).toMatch(/const onPick = !enabled \? undefined/);
    expect(AC).toMatch(/<Card key=\{t\.key\} onClick=\{onPick\}/);
    expect(AC).toMatch(/guarded\(\(\) => startAssessmentCentre\(t\.key\)\)/);
  });
  it("the AC recent-attempts and readiness rows keep role=button + onKeyDown", () => {
    expect(AC).toMatch(/role=\{a\.result \? "button" : undefined\}[\s\S]*?onKeyDown=\{a\.result \?/);
  });
});

describe("Phase 28 — earlier phases not regressed", () => {
  it("Phase 23/23A auth flow markers intact", () => {
    for (const m of ['<PasswordInput id="signin-password"', "Forgot password?", "expiredLinkMessage"]) {
      expect(SRC).toContain(m);
    }
  });
  it("Phase 26/27 primitives still declared", () => {
    for (const f of ["function Alert(", "function EmptyState(", "function PageHeader(", "function Btn(", "function Card("]) {
      expect(SRC).toContain(f);
    }
  });
});
