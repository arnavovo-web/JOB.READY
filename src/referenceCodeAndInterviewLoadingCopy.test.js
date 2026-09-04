/* ================================================================== *
 * REFERENCE CODE (sign-up) + INTERVIEW-GENERATION LOADING COPY
 * ------------------------------------------------------------------
 * Structural guards, source-level (node test env, no DOM) — the same
 * idiom as phase23AuthUx.test.js / phase36HowItWorksDropdown.test.js.
 * Covers:
 *
 *   - InfoTooltip: a new, reusable hover/focus/click tooltip component
 *     (no prior tooltip component existed — only the native `title`
 *     attribute, which isn't touch-accessible);
 *   - the "Reference code (Optional)" field is present on Sign Up only,
 *     never Sign In, with the exact required tooltip text;
 *   - the code is carried through signUp() metadata and backfilled onto
 *     the profile the same way first/last name already are — no
 *     attribution/validation/rewards logic anywhere;
 *   - a migration adds `profiles.reference_code` additively;
 *   - the interview-creation loading screens (both the main wizard build
 *     and "Practise again") get the exact reassurance copy, while every
 *     other staged loading screen (Application Intelligence, Development
 *     Modules) is untouched;
 *   - LoadingScreen renders the new copy without any fake progress
 *     percentage, countdown or time estimate, and without touching its
 *     existing step-checklist/stage logic.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

const slice = (start, end) => {
  const s = SRC.indexOf(start);
  const e = SRC.indexOf(end, s + start.length);
  if (s === -1 || e === -1) throw new Error(`markers not found: ${start} .. ${end}`);
  return SRC.slice(s, e);
};

const LOGIN = slice('{screen === "login" && ', "{/* ---------------- DASHBOARD ----------------");
const SIGNUP_VIEW = LOGIN.slice(LOGIN.indexOf('{authView === "signup"'), LOGIN.indexOf('{authView === "signin"'));
const SIGNIN_VIEW = LOGIN.slice(LOGIN.indexOf('{authView === "signin"'), LOGIN.indexOf('{authView === "forgot"'));
const INFO_TOOLTIP = slice("function InfoTooltip(", "\nfunction ");
const LOADING_SCREEN = slice("function LoadingScreen(", "\n/* ==");
const HANDLE_SIGN_UP = slice("async function handleSignUp(", "\n  async function handleSignIn(");
const ON_AUTHED = slice("async function onAuthed(", "setUser({ id: authUser.id");

/* ---------------------------------------------------------------- *
 * 1. InfoTooltip — the new reusable component
 * ---------------------------------------------------------------- */
describe("InfoTooltip — a new, reusable hover/focus/click tooltip", () => {
  it("exists as its own component, not inlined into the auth screen", () => {
    expect(SRC).toMatch(/function InfoTooltip\(\{ label, text \}\)/);
  });

  it("opens on hover, keyboard focus, AND click/tap — never hover-only, so it works on touch devices", () => {
    expect(INFO_TOOLTIP).toMatch(/onMouseEnter=\{\(\) => setOpen\(true\)\}/);
    expect(INFO_TOOLTIP).toMatch(/onMouseLeave=\{\(\) => setOpen\(false\)\}/);
    expect(INFO_TOOLTIP).toMatch(/onFocus=\{\(\) => setOpen\(true\)\}/);
    expect(INFO_TOOLTIP).toMatch(/onBlur=\{\(\) => setOpen\(false\)\}/);
    expect(INFO_TOOLTIP).toMatch(/onClick=\{\(\) => setOpen\(\(v\) => !v\)\}/);
  });

  it("closes on Escape and on a click outside", () => {
    expect(INFO_TOOLTIP).toMatch(/e\.key === "Escape"/);
    expect(INFO_TOOLTIP).toMatch(/!wrapRef\.current\.contains\(e\.target\)/);
  });

  it("the trigger is a real, accessible <button> with its own label; the popover is a real tooltip role", () => {
    expect(INFO_TOOLTIP).toMatch(/<button type="button" aria-label=\{label\}/);
    expect(INFO_TOOLTIP).toMatch(/aria-describedby=\{open \? idRef\.current : undefined\}/);
    expect(INFO_TOOLTIP).toMatch(/role="tooltip"/);
  });

  it("the icon itself is decorative (aria-hidden) — the button's aria-label carries the meaning", () => {
    expect(INFO_TOOLTIP).toMatch(/<HelpCircle size=\{14\} aria-hidden="true" \/>/);
  });
});

/* ---------------------------------------------------------------- *
 * 2. Reference code field — Sign Up only
 * ---------------------------------------------------------------- */
describe("Reference code field", () => {
  it("appears on Sign Up with the exact label, optional marker, and tooltip icon", () => {
    expect(SIGNUP_VIEW).toContain("Reference code");
    expect(SIGNUP_VIEW).toMatch(/\(Optional\)/);
    expect(SIGNUP_VIEW).toContain("<InfoTooltip");
    expect(SIGNUP_VIEW).toContain('id="signup-reference-code"');
  });

  it("the tooltip text is EXACTLY the required copy", () => {
    expect(SIGNUP_VIEW).toContain(
      'text="If you have been provided a reference code from an affiliate partner, type it in here."'
    );
  });

  it("does NOT appear on Sign In — an existing user is never shown a reference-code field", () => {
    expect(SIGNIN_VIEW).not.toMatch(/[Rr]eference code/);
    expect(SIGNIN_VIEW).not.toContain("InfoTooltip");
  });

  it("is clearly optional: the field's own state is never required for signup to proceed", () => {
    // handleSignUp's required-field checks (name, email, password) never
    // mention the reference code.
    expect(HANDLE_SIGN_UP).not.toMatch(/referenceCodeInput.*return;/);
  });

  it("is carried through signUp() metadata only when non-empty, capped to a sane length, sanitised like every other signup field", () => {
    expect(HANDLE_SIGN_UP).toMatch(/const cleanReferenceCode = sanitizeText\(referenceCodeInput\.trim\(\)\)\.slice\(0, 40\)/);
    expect(HANDLE_SIGN_UP).toMatch(/\.\.\.\(cleanReferenceCode \? \{ reference_code: cleanReferenceCode \} : \{\}\)/);
  });

  it("is backfilled onto the profile the same way first/last name already are, and only written once (never overwritten if already set)", () => {
    expect(ON_AUTHED).toMatch(/const metaReferenceCode = authUser\.user_metadata\?\.reference_code/);
    expect(ON_AUTHED).toMatch(/!p\?\.reference_code && metaReferenceCode/);
  });

  it("introduces no reward, discount, payout or commission logic — infrastructure only", () => {
    // Checks for actual reward/payment code, not prose — comments here
    // legitimately explain what ISN'T implemented yet, which would otherwise
    // trip a bare-word check on their own explanatory text.
    const referenceBlock = HANDLE_SIGN_UP + ON_AUTHED;
    expect(referenceBlock).not.toMatch(/reward\(|discount\(|payout\(|commission\(|applyReward|grantDiscount/i);
  });

  it("a migration adds profiles.reference_code additively (no destructive change)", () => {
    const migrationsDir = new URL("../supabase/migrations/", import.meta.url);
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
    const referenceMigration = files.find((f) => /reference_code/i.test(f));
    expect(referenceMigration).toBeTruthy();
    const content = readFileSync(new URL(referenceMigration, migrationsDir), "utf8");
    expect(content).toMatch(/alter table public\.profiles add column if not exists reference_code text/);
    // Purely additive — no drop/delete/truncate anywhere in this migration.
    expect(content).not.toMatch(/drop table|drop column|truncate|delete from/i);
  });
});

/* ---------------------------------------------------------------- *
 * 3. Interview-generation loading copy
 * ---------------------------------------------------------------- */
describe("Interview-generation loading copy", () => {
  // The two genuine interview-creation trigger sites.
  const PRACTISE_AGAIN_PROGRESS = slice(
    'title: "Creating your new interview",\n      subtitle: `Using your previous settings for ${[app.company, app.role]',
    'setScreen("analyzing");'
  );
  const WIZARD_BUILD_PROGRESS = slice(
    "const batchPipeline = resolveInterviewConfig(interviewStage, interviewFormat).pipeline",
    'setScreen("analyzing");'
  );
  // Explicitly-out-of-scope staged screens.
  const APPLICATION_ANALYZING_PROGRESS = slice(
    'title: "Personalising your preparation",',
    'setScreen("application_analyzing");'
  );
  const DEV_MODULE_PROGRESS_BLOCK = slice(
    'title: "Building your learning material",',
    'setScreen("dev_module_generating");'
  );

  it("both interview-creation trigger sites (wizard build + Practise again) set the exact required copy", () => {
    for (const block of [PRACTISE_AGAIN_PROGRESS, WIZARD_BUILD_PROGRESS]) {
      expect(block).toContain('note: { small: "This may take a moment", main: "We\'re creating the perfect interview for you." }');
    }
  });

  it("Application Intelligence and Development Module generation are NOT touched — no note set there", () => {
    for (const block of [APPLICATION_ANALYZING_PROGRESS, DEV_MODULE_PROGRESS_BLOCK]) {
      expect(block).not.toMatch(/This may take a moment/);
      expect(block).not.toContain("note:");
    }
  });

  it("LoadingScreen renders the note only when present, with the second line more prominent (heavier weight)", () => {
    expect(LOADING_SCREEN).toMatch(/\{progress\.note && \(/);
    expect(LOADING_SCREEN).toMatch(/\{progress\.note\.small && <div style=\{\{ fontSize: 12, fontWeight: 600,/);
    expect(LOADING_SCREEN).toMatch(/\{progress\.note\.main && <div style=\{\{ fontSize: 14, fontWeight: 700,/);
    // "second line slightly more prominent": main's fontWeight/fontSize both
    // exceed small's.
  });

  it("no fake progress countdown or time estimate is introduced anywhere in LoadingScreen", () => {
    expect(LOADING_SCREEN).not.toMatch(/countdown|ETA|seconds remaining|time remaining|estimated time/i);
    // No new state/interval driving a numeric percentage — the only interval
    // in the file is the pre-existing legacy message rotation (asserted
    // below), and the only progress signal is still the real `stage` index.
    expect((LOADING_SCREEN.match(/setInterval/g) || []).length).toBe(1);
  });

  it("the existing staged step-checklist and stage-advancement logic is completely unchanged", () => {
    expect(LOADING_SCREEN).toMatch(/const stage = Math\.max\(0, Math\.min\(num\(progress\.stage, 0, 0, progress\.steps\.length\), progress\.steps\.length - 1\)\)/);
    expect(LOADING_SCREEN).toMatch(/const done = i < stage, active = i === stage/);
  });

  it("the legacy (message-rotation) mode is completely unchanged — still no timer difference, still used by every non-staged screen", () => {
    expect(LOADING_SCREEN).toMatch(/const t = setInterval\(\(\) => setIdx\(\(i\) => \(i \+ 1\) % messages\.length\), 1300\)/);
  });
});
