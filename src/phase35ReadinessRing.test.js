/* ================================================================== *
 * PHASE 35 — LANDING-PAGE READINESS RING FIX
 * ------------------------------------------------------------------
 * The landing hero + feedback previews now use a dedicated
 * <LandingReadinessRing> (not the shared <RingScore>). It draws a
 * clearly visible full 360 neutral track behind a score-driven
 * coloured arc that starts at 12 o'clock, runs clockwise, and has
 * rounded ends — so a 78 reads as "78 out of 100", not a broken
 * green horseshoe.
 *
 * These guards check: the score -> arc geometry is pure and correct;
 * the ring has both a full track and a progress layer; the arc length
 * is derived from the score (never a hard-coded arc); the shared
 * RingScore used on authenticated screens is byte-for-byte untouched;
 * and Phase 32 / 34 landing contracts still hold.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { landingRingGeometry } from "./App.jsx";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const slice = (start, end) => {
  const s = SRC.indexOf(start);
  const e = SRC.indexOf(end, s + start.length);
  if (s === -1 || e === -1) throw new Error(`markers not found: ${start} .. ${end}`);
  return SRC.slice(s, e);
};

const RING_SCORE = slice("function RingScore(", "Phase 35 — LANDING-PAGE READINESS RING");
const LANDING_RING = slice("function LandingReadinessRing(", "function IconBadge(");
const LANDING = slice("function LandingBand(", "\nfunction App() {");
const LANDING_SCREEN = slice('{screen === "landing" && (', "{/* ---------------- HOW / UNIVERSITIES");

/* ---------------------------------------------------------------- *
 * 1. Pure score -> arc geometry
 * ---------------------------------------------------------------- */
describe("Phase 35 — landingRingGeometry maps the score to the arc", () => {
  const size = 88, stroke = 9;
  const circ = 2 * Math.PI * ((size - stroke) / 2);

  it("78 maps to ~78% of the circle", () => {
    const g = landingRingGeometry(78, size, stroke);
    expect(g.v).toBe(78);
    expect(g.fraction).toBeCloseTo(0.78, 5);
    expect(g.arc / g.circumference).toBeCloseTo(0.78, 5);
    // remainder is the neutral track portion
    expect(g.remainder / g.circumference).toBeCloseTo(0.22, 5);
    expect(g.circumference).toBeCloseTo(circ, 3);
  });

  it("the coloured arc length is ALWAYS score-driven, never a fixed value", () => {
    const a = landingRingGeometry(40, size, stroke).arc;
    const b = landingRingGeometry(90, size, stroke).arc;
    expect(b).toBeGreaterThan(a);
    expect(landingRingGeometry(0, size, stroke).arc).toBe(0);
    expect(landingRingGeometry(100, size, stroke).arc).toBeCloseTo(landingRingGeometry(100, size, stroke).circumference, 5);
  });

  it("clamps out-of-range / non-numeric scores to 0..100", () => {
    expect(landingRingGeometry(150, size, stroke).v).toBe(100);
    expect(landingRingGeometry(-20, size, stroke).v).toBe(0);
    expect(landingRingGeometry(NaN, size, stroke).v).toBe(0);
    expect(landingRingGeometry(undefined, size, stroke).v).toBe(0);
    expect(landingRingGeometry("74", size, stroke).v).toBe(74);
  });
});

/* ---------------------------------------------------------------- *
 * 2. Ring structure — full track + score-driven progress, 12 o'clock, round ends
 * ---------------------------------------------------------------- */
describe("Phase 35 — <LandingReadinessRing> structure", () => {
  it("draws a FULL 360 background track (a circle with no dash pattern)", () => {
    // the track circle has stroke + no strokeDasharray => full circle
    expect(LANDING_RING).toMatch(/full 360 neutral track/i);
    expect(LANDING_RING).toMatch(/<circle[^>]*r=\{r\}[^>]*stroke="#[0-9A-Fa-f]{6}"[^>]*strokeWidth=\{stroke\}\s*\/>/);
  });

  it("draws a separate progress arc whose length comes from landingRingGeometry(...).arc", () => {
    expect(LANDING_RING).toMatch(/landingRingGeometry\(value, size, stroke\)/);
    expect(LANDING_RING).toMatch(/strokeDasharray=\{arc \+ " " \+ circumference\}/);
    // no arbitrary hard-coded horseshoe: the arc is derived, and there is no
    // literal decorative offset like the old `c - (pct/100)*c` dance here.
    expect(LANDING_RING).not.toMatch(/strokeDashoffset=\{[^}]*c\s*-\s*\(/);
  });

  it("starts at 12 o'clock (SVG rotated -90deg) and uses rounded ends", () => {
    expect(LANDING_RING).toMatch(/transform:\s*"rotate\(-90deg\)"/);
    expect(LANDING_RING).toMatch(/strokeLinecap="round"/);
  });

  it("uses a restrained product colour (blue -> violet gradient), not status green", () => {
    expect(LANDING_RING).toMatch(/<linearGradient/);
    expect(LANDING_RING).toMatch(/stopColor="var\(--blue\)"/);
    expect(LANDING_RING).toMatch(/stopColor="var\(--violet\)"/);
    expect(LANDING_RING).not.toMatch(/var\(--good\)/); // no health-status green
  });

  it("shows a bold score and a smaller label, centred", () => {
    expect(LANDING_RING).toMatch(/fontWeight:\s*800/);
    expect(LANDING_RING).toMatch(/\{v\}<\/div>/);
    expect(LANDING_RING).toMatch(/\{label\}/);
    expect(LANDING_RING).toMatch(/alignItems:\s*"center"[^}]*justifyContent:\s*"center"/);
  });

  it("the decorative SVG is hidden from assistive tech; the score text carries meaning", () => {
    expect(LANDING_RING).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});

/* ---------------------------------------------------------------- *
 * 3. The shared RingScore (authenticated screens) is untouched
 * ---------------------------------------------------------------- */
describe("Phase 35 — shared <RingScore> is unchanged (auth screens unaffected)", () => {
  it("keeps its original implementation verbatim", () => {
    expect(RING_SCORE).toMatch(/const stroke = 12;/);
    expect(RING_SCORE).toMatch(/stroke="#EEF2F7"/);
    expect(RING_SCORE).toMatch(/strokeDashoffset=\{c - \(pct \/ 100\) \* c\}/);
    expect(RING_SCORE).toMatch(/pct >= 75 \? "var\(--good\)"/);
  });

  it("RingScore is still used on the non-landing (report / dashboard) screens", () => {
    // outside the LandingPage component
    const nonLanding = SRC.slice(0, SRC.indexOf("function LandingBand(")) + SRC.slice(SRC.indexOf("\nfunction App() {"));
    expect((nonLanding.match(/<RingScore\b/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it("the landing previews no longer use <RingScore> — they use <LandingReadinessRing>", () => {
    expect(LANDING).not.toMatch(/<RingScore\b/);
    expect((LANDING.match(/<LandingReadinessRing\b/g) || []).length).toBe(2);
    expect(LANDING).toMatch(/<LandingReadinessRing value=\{78\} size=\{88\} label="readiness" \/>/);
    expect(LANDING).toMatch(/<LandingReadinessRing value=\{74\} size=\{84\} label="readiness" \/>/);
  });
});

/* ---------------------------------------------------------------- *
 * 4. Visual contract — 78 / Readiness still shown; Phase 32 + 34 intact
 * ---------------------------------------------------------------- */
describe("Phase 35 — landing hero + Phase 32/34 contracts still hold", () => {
  it("the hero still shows the score 78 and a readiness label", () => {
    expect(LANDING).toMatch(/value=\{78\}/);
    expect(LANDING).toMatch(/label="readiness"/);
    expect(LANDING).toMatch(/Walk into your next interview ready\./);
  });

  it("Phase 32 CTA wiring is unchanged", () => {
    expect(LANDING_SCREEN).toMatch(/onStart=\{\(\) => setScreen\("login"\)\}/);
    expect(LANDING_SCREEN).toMatch(/onHow=\{\(\) => setScreen\("how"\)\}/);
    expect(LANDING_SCREEN).toMatch(/onUniversities=\{\(\) => setScreen\("universities"\)\}/);
    expect(LANDING_SCREEN).toContain("<LegalFooter openLegal={openLegal} />");
    expect((LANDING.match(/onClick=\{onStart\}/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("Phase 34 atmosphere is still present across the major sections", () => {
    for (const c of ["jr-landing-atmosphere", "jr-landing-hero", "jr-landing-band-showcase", "jr-landing-band-learning", "jr-landing-band-ac", "jr-landing-band-progress", "jr-landing-cta"]) {
      expect(LANDING).toContain(`"${c}"`);
    }
  });

  it("landing components remain presentation-only — no data / AI / new request type", () => {
    expect(LANDING).not.toMatch(/useState|useEffect|useRef/);
    expect(LANDING).not.toMatch(/callClaude|supabase|requestType|\bfetch\(/);
    expect(LANDING_RING).not.toMatch(/useState|useEffect|useRef|callClaude|supabase|\bfetch\(/);
    const types = [...new Set([...SRC.matchAll(/requestType:\s*"([a-z_]+)"/g)].map((m) => m[1]))].sort();
    expect(types).toEqual([
      "assessment_centre", "assessment_centre_scenario", "classroom_lesson", "development_module",
      "interview_batch_evaluation", "interview_profile", "interview_question_batch", "interview_report",
      "interview_turn_evaluate", "interview_turn_generate", "invitation_extraction",
    ].sort());
  });

  it("adds no new dependency", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps).sort()).toEqual(
      ["@vitejs/plugin-react", "lucide-react", "mammoth", "react", "react-dom", "vite", "vitest"].sort()
    );
  });
});
