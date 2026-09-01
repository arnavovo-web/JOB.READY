/* ================================================================== *
 * PHASE 34 — LANDING PAGE COLOUR, GRADIENT & ATMOSPHERIC POLISH
 * ------------------------------------------------------------------
 * Structural guards over the atmospheric layer added to the public
 * landing page. Node test env (no DOM) — source-level, deliberately
 * tolerant of exact gradient stops, strict on the design intent:
 *
 *   - a named, landing-specific atmosphere system exists (jr-landing-*
 *     classes) and every class used in the markup is a real CSS rule
 *     in the TOKENS stylesheet;
 *   - the hero has a dedicated decorative/atmospheric layer;
 *   - atmospheric colour is applied across SEVERAL major sections
 *     (hero, AI showcase, learning, Assessment Centre, progress, final
 *     CTA) — not just one gradient;
 *   - it stays restrained: most cards keep a plain surface, the palette
 *     is the product palette (navy / blue / violet / cyan) with a
 *     single warm accent reserved for the learning section;
 *   - explicit decorative DOM elements are aria-hidden;
 *   - nothing about Phase 32 regressed: CTA routes, presentational-only,
 *     no callClaude / Supabase / new request type / new dependency,
 *     no fabricated marketing.
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

const LANDING = slice("function LandingBand(", "function App() {");
const LANDING_SCREEN = slice('{screen === "landing" && (', "{/* ---------------- HOW / UNIVERSITIES");
// The TOKENS stylesheet (a template literal near the top of App.jsx).
const TOKENS = slice("const TOKENS = `", "const MODEL =");
// Just the Phase 34 atmosphere block inside TOKENS.
const ATMO_CSS = slice("Phase 34: landing-page atmospheric colour", "const MODEL =");

/* ---------------------------------------------------------------- *
 * 1. A named atmosphere system exists and is fully defined
 * ---------------------------------------------------------------- */
describe("Phase 34 — a named landing atmosphere system", () => {
  it("the landing page is wrapped in a dedicated atmosphere container", () => {
    expect(LANDING).toMatch(/<div className="jr-landing-atmosphere">/);
    expect(TOKENS).toMatch(/\.jr-landing-atmosphere\s*\{[^}]*overflow:\s*hidden/);
  });

  it("every jr-landing-* class used in the markup is a real CSS rule in TOKENS", () => {
    const used = new Set(
      [...LANDING.matchAll(/className="([^"]*)"/g)]
        .flatMap((m) => m[1].split(/\s+/))
        .filter((c) => c.startsWith("jr-landing"))
    );
    expect(used.size).toBeGreaterThanOrEqual(8);
    for (const cls of used) {
      expect(TOKENS, `missing CSS rule for .${cls}`).toMatch(
        new RegExp("\\." + cls.replace(/-/g, "\\-") + "\\s*[,{:]")
      );
    }
  });

  it("the atmosphere layers are painted with gradients, not solid fills", () => {
    expect((ATMO_CSS.match(/radial-gradient\(/g) || []).length).toBeGreaterThanOrEqual(12);
    expect(ATMO_CSS).toMatch(/linear-gradient\(/);
  });

  it("decorative layers are non-interactive and behind content", () => {
    expect(ATMO_CSS).toMatch(/pointer-events:\s*none/);
    expect(ATMO_CSS).toMatch(/z-index:\s*-1/);
  });
});

/* ---------------------------------------------------------------- *
 * 2. The hero gets the strongest treatment
 * ---------------------------------------------------------------- */
describe("Phase 34 — hero atmospheric layer", () => {
  it("the hero section carries a dedicated atmosphere class", () => {
    expect(LANDING).toMatch(/className="jr-landing-hero"/);
    // and that class actually establishes a layered gradient background
    expect(TOKENS).toMatch(/\.jr-landing-hero\s*\{[^}]*background-image:[^}]*radial-gradient/);
  });

  it("the hero product preview has decorative glow orbs, all aria-hidden", () => {
    const heroBlock = slice("SECTION 1 — HERO", "ROLE BAND");
    const orbs = heroBlock.match(/className="jr-landing-orb[^"]*"/g) || [];
    expect(orbs.length).toBeGreaterThanOrEqual(2);
    // each explicit decorative orb div is aria-hidden
    for (const m of heroBlock.matchAll(/<div aria-hidden="true" className="jr-landing-orb[^>]*>/g)) {
      expect(m[0]).toContain('aria-hidden="true"');
    }
    expect((heroBlock.match(/<div aria-hidden="true" className="jr-landing-orb/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("the hero preview is lifted onto a gradient frame", () => {
    expect(LANDING).toMatch(/className="jr-landing-frame"/);
    expect(TOKENS).toMatch(/\.jr-landing-frame\s*\{[^}]*linear-gradient/);
  });
});

/* ---------------------------------------------------------------- *
 * 3. Multiple visual moments — not just the hero
 * ---------------------------------------------------------------- */
describe("Phase 34 — atmosphere spans several major sections", () => {
  const sectionMarkers = [
    "jr-landing-hero",
    "jr-landing-band-showcase",
    "jr-landing-band-learning",
    "jr-landing-band-ac",
    "jr-landing-band-progress",
    "jr-landing-cta",
  ];
  for (const m of sectionMarkers) {
    it(`applies atmospheric treatment to "${m}"`, () => {
      expect(LANDING).toContain(`"${m}"`);
      expect(TOKENS).toMatch(new RegExp("\\." + m.replace(/-/g, "\\-") + "\\s*[,{:]"));
    });
  }

  it("the navy showcase section is a genuine visual moment (glow layers over navy)", () => {
    expect(TOKENS).toMatch(/\.jr-landing-band-showcase\s*\{[^}]*var\(--navy\)[^}]*radial-gradient/);
  });

  it("the final CTA is a rich navy → blue → violet destination with a light bloom", () => {
    expect(TOKENS).toMatch(/\.jr-landing-cta\s*\{[^}]*linear-gradient/);
    expect(TOKENS).toMatch(/\.jr-landing-cta::before\s*\{[^}]*radial-gradient/);
  });
});

/* ---------------------------------------------------------------- *
 * 4. Restraint — not a rainbow, warm accent contained to learning
 * ---------------------------------------------------------------- */
describe("Phase 34 — controlled, not chaotic", () => {
  it("most feature cards stay plain — atmosphere is on sections, not every card", () => {
    const totalCards = (LANDING.match(/<Card\b/g) || []).length;
    const cardsWithLandingClass = (LANDING.match(/<Card[^>]*className="[^"]*jr-landing/g) || []).length;
    expect(totalCards).toBeGreaterThan(8);
    expect(cardsWithLandingClass).toBe(0); // Cards are styled via props, never a landing-atmosphere class
  });

  it("the warm accent is reserved for the learning section only", () => {
    // amber appears in the learning band + its flashcard, and in TOKENS only for the learning band + the warm orb
    const amberHexHits = (LANDING.match(/245,\s*158,\s*11/g) || []).length; // rgba amber
    expect(amberHexHits).toBeGreaterThanOrEqual(1);
    const learningBlock = slice("SECTION 7 — LEARN", "SECTION 8 — ASSESSMENT CENTRE");
    expect(learningBlock).toMatch(/245,\s*158,\s*11/);
    // no amber wash on the analytical / interview sections
    const showcaseBlock = slice("SECTION 5 — AI INTERVIEW SHOWCASE", "SECTION 6 — FEEDBACK");
    expect(showcaseBlock).not.toMatch(/245,\s*158,\s*11/);
    const acBlock = slice("SECTION 8 — ASSESSMENT CENTRE", "SECTION 9 — PROGRESS");
    expect(acBlock).not.toMatch(/245,\s*158,\s*11/);
  });

  it("the atmosphere palette is the product palette (navy / blue / violet / cyan)", () => {
    // blue 37,99,235 · violet 124,58,237 · cyan 56,189,248 / 34,211,238
    expect(ATMO_CSS).toMatch(/37,\s*99,\s*235/);
    expect(ATMO_CSS).toMatch(/124,\s*58,\s*237/);
    expect(ATMO_CSS).toMatch(/(56,\s*189,\s*248|34,\s*211,\s*238)/);
  });

  it("no CSS animation was added for the atmosphere (static depth only)", () => {
    expect(ATMO_CSS).not.toMatch(/@keyframes|animation:/);
  });
});

/* ---------------------------------------------------------------- *
 * 5. Accessibility
 * ---------------------------------------------------------------- */
describe("Phase 34 — accessibility preserved", () => {
  it("explicit decorative DOM elements are aria-hidden", () => {
    for (const m of LANDING.matchAll(/<div[^>]*className="jr-landing-orb[^"]*"[^>]*>/g)) {
      expect(m[0], m[0]).toContain('aria-hidden="true"');
    }
  });

  it("competency state is still conveyed by a text label, not colour alone", () => {
    expect(LANDING).toMatch(/text: "Needs work"/);
    expect(LANDING).toMatch(/text: "Strong"/);
    expect(LANDING).toMatch(/text: "Improving"/);
  });

  it("illustrative sample-data labels are still present", () => {
    expect(LANDING).toMatch(/Illustrative preview · sample data/);
    expect((LANDING.match(/[Ii]llustrative/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

/* ---------------------------------------------------------------- *
 * 6. No Phase 32 regression
 * ---------------------------------------------------------------- */
describe("Phase 34 — Phase 32 functionality intact", () => {
  it("CTA navigation routes are unchanged", () => {
    expect(LANDING_SCREEN).toMatch(/onStart=\{\(\) => setScreen\("login"\)\}/);
    expect(LANDING_SCREEN).toMatch(/onHow=\{\(\) => setScreen\("how"\)\}/);
    expect(LANDING_SCREEN).toMatch(/onUniversities=\{\(\) => setScreen\("universities"\)\}/);
    expect((LANDING.match(/onClick=\{onStart\}/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(LANDING).toMatch(/onClick=\{onHow\}/);
    expect(LANDING).toMatch(/onClick=\{onUniversities\}/);
  });

  it("the legal footer is still rendered inside the landing block", () => {
    expect(LANDING_SCREEN).toContain("<LegalFooter openLegal={openLegal} />");
  });

  it("landing components remain presentation-only", () => {
    expect(LANDING).not.toMatch(/useState|useEffect|useRef|useMemo|useCallback/);
    expect(LANDING).not.toMatch(/supabase|getSupabase|createClient|localStorage|sessionStorage|\bfetch\(/);
    expect(LANDING).not.toMatch(/callClaude|requestType|ai-generate/);
  });

  it("introduces no new AI request type", () => {
    const types = [...new Set([...SRC.matchAll(/requestType:\s*"([a-z_]+)"/g)].map((m) => m[1]))].sort();
    expect(types).toEqual([
      "assessment_centre", "assessment_centre_scenario", "classroom_lesson", "development_module",
      "interview_batch_evaluation", "interview_profile", "interview_question_batch", "interview_report",
      "interview_turn_evaluate", "interview_turn_generate", "invitation_extraction",
    ].sort());
  });

  it("introduces no new dependency", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps).sort()).toEqual(
      ["@vitejs/plugin-react", "lucide-react", "mammoth", "react", "react-dom", "vite", "vitest"].sort()
    );
  });

  it("adds no fabricated social proof or outcome claims", () => {
    const banned = [
      /guarantee[ds]? (you )?(a )?(job|offer|interview)/i,
      /get(ting)? you hired/i,
      /\bland (your|the) (dream )?job\b/i,
      /thousands of (students|users|candidates)/i,
      /trusted by/i,
      /testimonial/i,
      /\d+\s*%\s*(more likely|success|higher)/i,
    ];
    for (const re of banned) expect(LANDING).not.toMatch(re);
  });

  it("all five Assessment Centre exercise types are still advertised", () => {
    for (const t of ["Case Study", "Group Exercise", "Presentation", "Written Exercise", "Inbox Exercise"]) {
      expect(LANDING).toContain(t);
    }
  });

  it("the core section headlines still read the same", () => {
    for (const h of [
      "Walk into your next interview ready.",
      "Everything you need to prepare for the opportunity ahead.",
      "Practise like the interview is real.",
      "Don't just practise. Learn what you're missing.",
      "Prepare for more than the interview.",
      "See the progress you're actually making.",
      "Your next interview deserves more than a Google search.",
    ]) {
      expect(LANDING).toContain(h);
    }
  });
});
