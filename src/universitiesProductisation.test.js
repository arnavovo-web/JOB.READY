/* ================================================================== *
 * JOB.READY — public website + auth productisation push
 * ------------------------------------------------------------------
 * Two-sided platform:  JOB.READY for Students  +  EKI² for Universities.
 *
 * Guards:
 *   1. /universities is a real lazy-loaded marketing page that runs NO
 *      Supabase query for a public visitor and never imports the
 *      institutional app tree.
 *   2. Its copy sells the EKI² ecosystem in product language and never
 *      overclaims employment outcomes / invents certifications or an
 *      email address.
 *   3. Login begins with an audience chooser (Student vs University).
 *      The student flow is unchanged.
 *   4. University sign-in routes into EKI² ONLY after the database
 *      (get_my_institutions -> institution_staff) confirms the account
 *      is authorised staff. The redirect is not an unconditional button.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(HERE, "App.jsx"), "utf8");
const UNI_RAW = readFileSync(join(HERE, "UniversitiesPage.jsx"), "utf8");
// strip comments before "no forbidden token" scans
const UNI = UNI_RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const slice = (src, a, b) => {
  const s = src.indexOf(a);
  const e = b ? src.indexOf(b, s + a.length) : src.length;
  return s === -1 ? "" : src.slice(s, e === -1 ? src.length : e);
};

/* ---------------------------------------------------------------- *
 * 1. /universities — lazy, self-contained, query-free
 * ---------------------------------------------------------------- */
describe("/universities route", () => {
  it("is a code-split lazy import, rendered under Suspense", () => {
    expect(APP).toMatch(/const UniversitiesPage = lazy\(\(\) => import\("\.\/UniversitiesPage\.jsx"\)\)/);
    const block = slice(APP, '{screen === "universities" && (', "{/* ---------------- PHASE 40: PRICING PAGE");
    expect(block).toMatch(/<Suspense\b/);
    expect(block).toMatch(/<UniversitiesPage\b/);
    expect(block).toMatch(/onDemo=/);
    expect(block).toMatch(/onExplore=/);
    expect(block).toMatch(/setScreen\("landing"\)/);   // onBack
  });

  it("the marketing page pulls in NO data layer and NO institutional tree", () => {
    expect(UNI).not.toMatch(/supabase|getSupabase|createClient|\bfetch\(|localStorage|sessionStorage/i);
    expect(UNI).not.toMatch(/\.\/institutional\/|InstitutionalApp|institutional\/api/);
    expect(UNI).not.toMatch(/useState|useEffect|useCallback|useRef/);   // presentation only
  });

  it("the demo CTA reuses the existing contact_messages sink (no invented email, no new backend)", () => {
    const block = slice(APP, '{screen === "universities" && (', "{/* ---------------- PHASE 40: PRICING PAGE");
    expect(block).toMatch(/openContact\(/);
    // openContact just opens the existing ContactDialog -> dbSubmitContactMessage
    expect(APP).toMatch(/const openContact = useCallback/);
    expect(APP).toMatch(/<ContactDialog[\s\S]*?onSubmit=\{dbSubmitContactMessage\}/);
    expect(UNI).not.toMatch(/@[a-z0-9.-]+\.(com|ac\.uk|io|org|co)/i);   // no fabricated address
  });
});

/* ---------------------------------------------------------------- *
 * 2. Sells the EKI² ecosystem, honestly
 * ---------------------------------------------------------------- */
describe("/universities copy", () => {
  it("positions EKI² as JOB.READY's institutional product", () => {
    expect(UNI).toMatch(/JOB\.READY for universities/i);
    expect(UNI).toMatch(/EKI²/);
    expect(UNI).toMatch(/Turn interview practice into employability intelligence/i);
    expect(UNI).toMatch(/Book a university demo/);
  });

  it("walks the full closed loop (01 → 07) and the core product surfaces", () => {
    for (const n of ["01", "02", "03", "04", "05", "06", "07"]) expect(UNI).toContain(`"${n}"`);
    for (const surface of [
      "No Contact Yet", "Stuck Students", "Student Careers Profile", "Interview DNA",
      "Student Trajectory", "Personalised Development Plans", "Programme Employability Pulse",
      "Programme-Level Intelligence", "AI Careers Adviser Briefing", "follow-up",
    ]) {
      expect(UNI.toLowerCase()).toContain(surface.toLowerCase());
    }
  });

  it("uses readiness/practice language, never employment-outcome claims", () => {
    expect(UNI).toMatch(/interview readiness/i);
    expect(UNI).toMatch(/practice performance/i);
    expect(UNI).toMatch(/careers engagement/i);
    // no "predicts who gets hired" style overclaim (a disclaimer that it does
    // NOT do this is fine — the promo-claim shape is what's banned)
    expect(UNI).not.toMatch(/\bpredicts\s+(which|who)\b/i);
    expect(UNI).not.toMatch(/we guarantee|guaranteed (a |an |your )?(job|offer|interview|placement|outcome)/i);
    expect(UNI).not.toMatch(/will be hired|get you hired|guarantees? graduate employment/i);
  });

  it("makes no fabricated certifications or adoption figures", () => {
    expect(UNI).not.toMatch(/ISO\s?\d{3,}|SOC\s?2|GDPR[- ]certified|Cyber Essentials certified/i);
    expect(UNI).not.toMatch(/\b\d[\d,]*\+?\s*(universities|institutions|students|advisers)\s+(use|trust|rely)/i);
    expect(UNI).not.toMatch(/testimonial|"\s*—\s*[A-Z][a-z]+ [A-Z][a-z]+,/);
  });

  it("labels every product visual as synthetic", () => {
    expect(UNI).toMatch(/synthetic data/i);
    expect(UNI).toMatch(/Interview-ready/);
    expect(UNI).toMatch(/Developing/);
    expect(UNI).toMatch(/Needs support/);
  });

  it("the trust section describes architecture, not legal guarantees", () => {
    expect(UNI).toMatch(/Designed for institutional data boundaries/i);
    expect(UNI).toMatch(/institution-scoped access/i);
    expect(UNI).toMatch(/k-anonymised/i);
    expect(UNI).toMatch(/not legal guarantees or\s*\n?\s*certifications/i);
  });
});

/* ---------------------------------------------------------------- *
 * 3. Login — audience chooser; student flow intact
 * ---------------------------------------------------------------- */
describe("audience-choice login", () => {
  const LOGIN = slice(APP, '{screen === "login" && ', "{/* ---------------- LEGAL (public, no auth)");

  it("opens on a Student vs University chooser", () => {
    expect(LOGIN).toMatch(/authView === "choose"/);
    expect(LOGIN).toMatch(/Welcome to JOB\.READY/);
    expect(LOGIN).toMatch(/Choose how you'd like to sign in/);
    expect(LOGIN).toMatch(/Continue as Student/);
    expect(LOGIN).toMatch(/Continue as University/);
    expect(LOGIN).toMatch(/goAuth\("signin"\)/);      // student -> existing flow
    expect(LOGIN).toMatch(/goAuth\("university"\)/);   // university -> EKI² flow
  });

  it("the existing student sign-in / sign-up / reset views are untouched", () => {
    for (const v of ['authView === "signup"', 'authView === "signin"', 'authView === "forgot"', 'authView === "reset"']) {
      expect(LOGIN).toContain(v);
    }
    // student sign-in still calls the shared post-auth handler
    expect(APP).toMatch(/async function handleSignIn\(\)[\s\S]*?await onAuthed\(data\.session\)/);
  });

  it("the public nav 'Log in' opens the chooser; 'Start practising for free' goes to sign-up", () => {
    const NAVBAR = slice(APP, "function NavBar(", "class ErrorBoundary");
    expect(NAVBAR).toMatch(/const openLogin = \(\) => \{ if \(setAuthView\) setAuthView\("choose"\); setScreen\("login"\); \}/);
    expect(NAVBAR).toMatch(/const openSignup = \(\) => \{ if \(setAuthView\) setAuthView\("signup"\); setScreen\("login"\); \}/);
    expect(NAVBAR).toMatch(/onClick=\{openLogin\}/);
    expect(NAVBAR).toMatch(/onClick=\{openSignup\}[^]*Start practising for free/);
  });
});

/* ---------------------------------------------------------------- *
 * 4. University auth — server is authoritative
 * ---------------------------------------------------------------- */
describe("university sign-in routes into EKI² only for authorised staff", () => {
  const FN = slice(APP, "async function handleUniversitySignIn()", "async function handleForgotPassword()");

  it("authenticates with the SAME Supabase password flow (no fake SSO implementation)", () => {
    expect(FN).toMatch(/signInWithPassword\(/);
    // future SSO may be MENTIONED in copy, but no SSO call is wired up yet
    expect(APP).not.toMatch(/signInWithSSO\(|createSSO\(|new SamlProvider|OIDCClient\(/);
  });

  it("asks the database (get_my_institutions -> institution_staff) before routing", () => {
    expect(FN).toMatch(/supabase\.rpc\("get_my_institutions"\)/);
    // redirect is GATED on the RPC result, not unconditional
    expect(FN).toMatch(/if \(institutions\.length > 0\) \{[\s\S]*?window\.location\.assign\("\/institutional"\)/);
    // the assign() is followed by an early return, before any non-staff handling
    expect(FN).toMatch(/window\.location\.assign\("\/institutional"\);\s*\n\s*return;/);
    // a non-staff account is NOT redirected — it shows the no-workspace panel
    expect(FN).toMatch(/setUniNoWorkspace\(true\)/);
  });

  it("routes the 'university' auth view to the dedicated <EkiAuth> env, not the student card", () => {
    const LOGIN = slice(APP, '{screen === "login" && ', "{/* ---------------- LEGAL (public, no auth)");
    // a ternary at the top of the login return: university -> EkiAuth, else the 420 card
    expect(LOGIN).toMatch(/authView === "university" \? \([\s\S]*?<EkiAuth\b/);
    expect(LOGIN).toMatch(/<Suspense fallback=\{<div style=\{\{ position: "fixed", inset: 0[^}]*background: "#0A0E1A"/);
    // the shared JOB.READY site nav is suppressed for this full-bleed environment
    expect(APP).toMatch(/showNav && !\(screen === "login" && authView === "university"\) && <NavBar/);
    // it is code-split, not in the student bundle
    expect(APP).toMatch(/const EkiAuth = lazy\(\(\) => import\("\.\/EkiAuth\.jsx"\)\)/);
    // wired to the unchanged auth backend + the no-bounce no-workspace state
    const eki = slice(LOGIN, "<EkiAuth", "/>");
    expect(eki).toMatch(/onSubmit=\{\(\) => guarded\(handleUniversitySignIn\)\}/);
    expect(eki).toMatch(/noWorkspace=\{uniNoWorkspace\}/);
    expect(eki).toMatch(/onReturn=\{\(\) => goAuth\("choose"\)\}/);
  });

  it("does NOT weaken the institutional gate — /institutional still self-authorises", () => {
    const INST = readFileSync(join(HERE, "institutional", "InstitutionalApp.jsx"), "utf8");
    expect(INST).toMatch(/api\.getMyInstitutions\(\)/);
    expect(INST).toMatch(/if \(!insts\.length\) \{ setPhase\("no-access"\)/);
  });
});

/* ---------------------------------------------------------------- *
 * 4b. The dedicated EKI² authentication environment
 * ---------------------------------------------------------------- */
describe("EkiAuth — a distinct premium institutional environment", () => {
  const RAW = readFileSync(join(HERE, "EkiAuth.jsx"), "utf8");
  const EKI = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("is presentation only — all state + handlers come from App via props", () => {
    // no auth calls of its own; App.handleUniversitySignIn stays the single gate
    expect(EKI).not.toMatch(/supabase|getSupabase|signInWithPassword|get_my_institutions|createClient/);
    expect(EKI).not.toMatch(/window\.location\.assign/);
  });

  it("prominently brands EKI² with the expanded name and a concise proposition", () => {
    expect(EKI).toMatch(/EKI<sup>2<\/sup>/);
    expect(EKI).toMatch(/Employability Knowledge Intelligence Interface/);
    expect(EKI).toMatch(/Institutional intelligence for student employability/);
    expect(EKI).toMatch(/eki-wordmark-lg\{ font-size:clamp\(/);   // the acronym is visually large
  });

  it("has a minimal app header ('A JOB.READY product'), not the site nav", () => {
    expect(EKI).toMatch(/A JOB\.READY product/);
    expect(EKI).not.toMatch(/How it works|Pricing|Start practising/);
  });

  it("shows illustrative signals, explicitly labelled synthetic", () => {
    expect(EKI).toMatch(/Readiness/);
    expect(EKI).toMatch(/Trajectory/);
    expect(EKI).toMatch(/Intervention/);
    expect(EKI).toMatch(/Illustrative interface signals .*synthetic data/);
  });

  it("uses institutional language, never student CTAs", () => {
    expect(EKI).toMatch(/Sign in to EKI/);
    expect(EKI).toMatch(/employability intelligence workspace/);
    expect(EKI).toMatch(/Return to JOB\.READY/);
    expect(EKI).not.toMatch(/Start practising|Prepare for your (next )?interview|Practice now|your next interview/i);
  });

  it("keeps the no-workspace outcome on this screen (demo / continue / sign out)", () => {
    expect(EKI).toMatch(/noWorkspace \?/);
    expect(EKI).toMatch(/No workspace linked yet/);
    expect(EKI).toMatch(/onBookDemo/);
    expect(EKI).toMatch(/onContinueStudent/);
    expect(EKI).toMatch(/onSignOut/);
  });

  it("is accessible: semantic form, labels, password toggle, focus + reduced-motion", () => {
    expect(EKI).toMatch(/<form[\s\S]*?onSubmit=\{\(e\) => \{ e\.preventDefault\(\); onSubmit\(\); \}\}/);
    expect(EKI).toMatch(/<label className="eki-label" htmlFor="eki-email"/);
    expect(EKI).toMatch(/<label className="eki-label" htmlFor="eki-password"/);
    expect(EKI).toMatch(/aria-pressed=\{show\}/);
    expect(EKI).toMatch(/aria-label=\{show \? "Hide password" : "Show password"\}/);
    expect(EKI).toMatch(/:focus-visible\{ outline:/);
    expect(EKI).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[\s\S]*?animation:none/);
  });

  it("is lightweight: no animation library, no image assets, CSS-only motion", () => {
    expect(RAW).not.toMatch(/from "(framer-motion|gsap|lottie|animejs|@react-spring)/);
    expect(EKI).not.toMatch(/\.(png|jpe?g|gif|webp)("|')/);
    expect(EKI).toMatch(/@keyframes eki/);
  });

  it("has a deliberate mobile composition (no huge desktop stack, no overflow)", () => {
    expect(EKI).toMatch(/@media \(max-width:900px\)\{[\s\S]*?grid-template-columns:1fr/);
    expect(EKI).toMatch(/\.eki-hero\{ order:1; \}/);       // brand first on mobile
    expect(EKI).toMatch(/\.eki-panelwrap\{[\s\S]*?order:2/);
  });
});

/* ---------------------------------------------------------------- *
 * 5. SEO / metadata
 * ---------------------------------------------------------------- */
describe("metadata", () => {
  it("index.html carries a description covering both products", () => {
    const HTML = readFileSync(join(HERE, "..", "index.html"), "utf8");
    expect(HTML).toMatch(/<meta\s+name="description"/);
    expect(HTML).toMatch(/EKI²/);
    expect(HTML).toMatch(/Careers & Employability/i);
    expect(HTML).toMatch(/<meta property="og:title" content="[^"]*Universities[^"]*"/);
  });

  it("the universities screen sets its own document title (no per-route SSR)", () => {
    expect(APP).toMatch(/screen === "universities"\s*\n?\s*\? "JOB\.READY for Universities \| EKI² Employability Intelligence"/);
  });
});
