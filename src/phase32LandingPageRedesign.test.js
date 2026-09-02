/* ================================================================== *
 * PHASE 32 — LANDING PAGE PRODUCT SHOWCASE + CONVERSION REDESIGN
 * ------------------------------------------------------------------
 * Structural guards over the redesigned public landing page. The test
 * env is node (no DOM), so these are source-level checks — deliberately
 * tolerant of copy tweaks, strict on the things that matter:
 *
 *   - the landing page still renders from the existing `screen ===
 *     "landing"` public screen, and its CTAs still use the existing
 *     screen-based navigation (login / how / universities);
 *   - the Phase 30 legal footer is still rendered inside the landing block;
 *   - every product capability advertised on the page maps to a REAL,
 *     inspected feature elsewhere in the app — nothing invented;
 *   - no fake social proof: no testimonials, user counts, success rates,
 *     hiring guarantees, employer endorsements or university partnerships;
 *   - the landing components are presentation-only: no state, no effects,
 *     no Supabase, no callClaude, no new AI request type;
 *   - the required information architecture (hero, toolkit, how-it-works,
 *     interview showcase, learning, Assessment Centre, progress, final CTA)
 *     is present.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

const slice = (start, end) => {
  const s = SRC.indexOf(start);
  const e = SRC.indexOf(end, s + start.length);
  if (s === -1 || e === -1) throw new Error(`markers not found: ${start} .. ${end}`);
  return SRC.slice(s, e);
};

// The presentational landing component (LandingBand helper through the end of LandingPage).
const LANDING = slice("function LandingBand(", "\nfunction App() {");
// The landing screen block inside App().
const LANDING_SCREEN = slice('{screen === "landing" && (', "{/* ---------------- HOW / UNIVERSITIES");

/* ---------------------------------------------------------------- *
 * 1. Integration — still the same public screen + navigation
 * ---------------------------------------------------------------- */
describe("Phase 32 — landing page integration", () => {
  it("still renders from the existing `screen === \"landing\"` block", () => {
    expect(SRC).toContain('{screen === "landing" && (');
    expect(LANDING_SCREEN).toContain("<LandingPage");
  });

  it("the primary CTA is wired to the existing sign-in / sign-up screen", () => {
    // App passes a navigation callback into the presentational component…
    expect(LANDING_SCREEN).toMatch(/onStart=\{\(\) => setScreen\("login"\)\}/);
    // …and the component's CTAs invoke it (hero + final CTA at least).
    expect((LANDING.match(/onClick=\{onStart\}/g) || []).length).toBeGreaterThanOrEqual(2);
    // Phase 36: public acquisition CTA copy unified to "Start practising for
    // free" across the nav, hero, final CTA and `how` screen — see
    // phase36HowItWorksDropdown.test.js for the full CTA-copy audit.
    expect(LANDING).toMatch(/Start practising for free/);
  });

  it("the 'how it works' and 'for universities' public screens are still reachable from the page", () => {
    expect(LANDING_SCREEN).toMatch(/onHow=\{\(\) => setScreen\("how"\)\}/);
    expect(LANDING_SCREEN).toMatch(/onUniversities=\{\(\) => setScreen\("universities"\)\}/);
    expect(LANDING).toMatch(/onClick=\{onHow\}/);
    expect(LANDING).toMatch(/onClick=\{onUniversities\}/);
    expect(SRC).toContain('{screen === "how" && (');
    expect(SRC).toContain('{screen === "universities" && (');
  });

  it("the sign-in entry point (NavBar) is untouched", () => {
    expect(SRC).toMatch(/setScreen\(user \? "dashboard" : "landing"\)/);
    expect(SRC).toMatch(/\{ label: "How it works", to: "how" \}/);
  });

  it("the Phase 30 legal footer is still rendered inside the landing block", () => {
    expect(LANDING_SCREEN).toContain("<LegalFooter openLegal={openLegal} />");
    expect((SRC.match(/<LegalFooter openLegal=\{openLegal\} \/>/g) || []).length).toBeGreaterThanOrEqual(5);
  });
});

/* ---------------------------------------------------------------- *
 * 2. Product accuracy — advertised == real, no invented features
 * ---------------------------------------------------------------- */
describe("Phase 32 — every advertised capability is a real, inspected feature", () => {
  // [phrase shown on the landing page]  ->  [proof it exists elsewhere in the app]
  const claims = [
    ["adaptive interview", /pipeline === "independent_batch"|adaptive_turn/],
    ["fixed-length set", /independent_batch/],
    ["question mix", /QUESTION_MIX_OPTIONS|question_mix/],
    ["evaluated against the competencies", /requestType: "interview_turn_evaluate"|validateEvaluation/],
    ["Interview history", /interviewList/],
    ["Classroom", /screen === "classroom"/],
    ["development modules", /screen === "dev_module"|developmentModule/],
    ["flashcards", /devView === "flashcards"/],
    ["quiz", /quizOrder|last_quiz/],
    ["knowledge check", /written[_ ]?check|writtenQuiz/i],
    ["Assessment Centre", /EXERCISE_TYPES|screen === "ac_home"/],
    ["Case Study", /"Case Study"|key: "case"/],
    ["Group Exercise", /"Group Exercise"|key: "group"/],
    ["Inbox Exercise", /"Inbox Exercise"|key: "inbox"/],
    ["Interview DNA", /Interview DNA/],
    ["Interview Memory", /memoryLog/],
    ["invitation", /screen === "invitation_paste"|invitation_extraction/],
    ["Application Intelligence", /application_intelligence|buildApplicationIntelligence/],
    ["career claims", /candidateClaims|candidate_claims/],
    ["job description", /jdText|job_description/],
    ["readiness", /readiness/],
  ];
  for (const [phrase, proof] of claims) {
    it(`"${phrase}" is shown on the page and backed by real code`, () => {
      expect(LANDING.toLowerCase()).toContain(phrase.toLowerCase());
      expect(SRC).toMatch(proof);
    });
  }
});

describe("Phase 32 — no fabricated social proof or outcome claims", () => {
  const banned = [
    /guarantee[ds]? (you )?(a )?(job|offer|interview)/i,
    /get(ting)? you hired/i,
    /\bland (your|the) (dream )?job\b/i,
    /thousands of (students|users|candidates)/i,
    /\bmillions? of\b/i,
    /\d+\s*%\s*(more likely|success|higher|increase|of users|of candidates)/i,
    /\b\d[\d,]*\s*(students|users|candidates|universities|interviews practised) (trust|use|choose)/i,
    /trusted by/i,
    /\bas seen (in|on)\b/i,
    /testimonial/i,
    /\brated \d(\.\d)?\s*\/\s*5\b/i,
    /partnered with .* universit/i,
  ];
  for (const re of banned) {
    it(`does not contain: ${re}`, () => {
      expect(LANDING).not.toMatch(re);
    });
  }
  it("preview panels with numbers are labelled as illustrative sample data", () => {
    expect(LANDING).toMatch(/Illustrative preview · sample data/);
    // every RingScore / bar chart preview sits near an 'Illustrative' caption
    expect((LANDING.match(/[Ii]llustrative/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

/* ---------------------------------------------------------------- *
 * 3. Protected systems — the landing redesign stays inert
 * ---------------------------------------------------------------- */
describe("Phase 32 — landing components are presentation-only", () => {
  it("no state, effects, refs or handlers of their own beyond the injected nav callbacks", () => {
    expect(LANDING).not.toMatch(/useState|useEffect|useRef|useMemo|useCallback/);
  });
  it("no Supabase, storage, fetch or auth access from the landing components", () => {
    expect(LANDING).not.toMatch(/supabase|getSupabase|createClient|localStorage|sessionStorage|\bfetch\(|signInWithPassword|signUp\(/);
  });
  it("no AI calls and no new AI request type introduced by the landing components", () => {
    expect(LANDING).not.toMatch(/callClaude|requestType|ai-generate/);
  });
  it("introduces no new callClaude requestType strings anywhere in the file", () => {
    const types = [...new Set([...SRC.matchAll(/requestType:\s*"([a-z_]+)"/g)].map((m) => m[1]))].sort();
    expect(types).toEqual([
      "assessment_centre", "assessment_centre_scenario", "classroom_lesson", "development_module",
      "interview_batch_evaluation", "interview_profile", "interview_question_batch", "interview_report",
      "interview_turn_evaluate", "interview_turn_generate", "invitation_extraction",
    ].sort());
  });
  it("does not add a new dependency — landing icons come from the existing lucide-react import", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    // The dependency set as it stood before Phase 32. If this ever needs to change,
    // it must be a deliberate, reviewed edit — not a side effect of a landing tweak.
    expect(Object.keys(deps).sort()).toEqual(
      ["@vitejs/plugin-react", "lucide-react", "mammoth", "react", "react-dom", "vite", "vitest"].sort()
    );
    expect(deps["lucide-react"]).toBeTruthy();
  });
});

/* ---------------------------------------------------------------- *
 * 4. Information architecture — the required story is present
 * ---------------------------------------------------------------- */
describe("Phase 32 — required landing sections are present", () => {
  it("a strong hero with the outcome headline and both CTAs", () => {
    expect(LANDING).toMatch(/Walk into your next interview ready\./);
    expect(LANDING).toMatch(/See how it works/);
    expect(LANDING).toMatch(/<h1\b/);
  });
  it("an outcome / value-proposition section distinct from the hero", () => {
    expect(LANDING).toMatch(/More than practice/);
  });
  it("a full product toolkit section", () => {
    expect(LANDING).toMatch(/Everything you need to prepare for the opportunity ahead\./);
  });
  it("a 'how it works' journey with numbered steps", () => {
    expect(LANDING).toMatch(/From application to interview-ready\./);
    expect(LANDING).toMatch(/"01"[\s\S]*"02"[\s\S]*"03"[\s\S]*"04"/);
  });
  it("an AI interview product showcase", () => {
    expect(LANDING).toMatch(/Practise like the interview is real\./);
  });
  it("a feedback / improvement section", () => {
    expect(LANDING).toMatch(/Know exactly what to improve next\./);
  });
  it("a learning section that is explicitly not just interview practice", () => {
    expect(LANDING).toMatch(/Don't just practise\. Learn what you're missing\./);
  });
  it("an Assessment Centre section listing the real exercise types", () => {
    expect(LANDING).toMatch(/Prepare for more than the interview\./);
    for (const t of ["Case Study", "Group Exercise", "Presentation", "Written Exercise", "Inbox Exercise"]) {
      expect(LANDING).toContain(t);
    }
  });
  it("a progress / long-term improvement section", () => {
    expect(LANDING).toMatch(/See the progress you're actually making\./);
  });
  it("a student-problem section", () => {
    expect(LANDING).toMatch(/Preparation shouldn't mean guessing what to do next\./);
  });
  it("a compact full-toolkit inventory", () => {
    expect(LANDING).toMatch(/const inventory = \[/);
  });
  it("a strong final CTA", () => {
    expect(LANDING).toMatch(/Your next interview deserves more than a Google search\./);
  });
});

/* ---------------------------------------------------------------- *
 * 5. Accessibility hygiene
 * ---------------------------------------------------------------- */
describe("Phase 32 — accessibility basics", () => {
  it("uses one real <h1> and real <h2> section headings", () => {
    expect((LANDING.match(/<h1\b/g) || []).length).toBe(1);
    expect(LANDING).toMatch(/<h2 /);
  });
  it("actions are real <Btn> buttons, not clickable text spans", () => {
    expect(LANDING).toMatch(/<Btn variant="accent" onClick=\{onStart\}/);
  });
  it("decorative visual composition is hidden from assistive tech", () => {
    expect(LANDING).toMatch(/aria-hidden="true"/);
  });
  it("competency state is conveyed by a text label, not colour alone", () => {
    expect(LANDING).toMatch(/text: "Needs work"/);
    expect(LANDING).toMatch(/text: "Strong"/);
  });
});
