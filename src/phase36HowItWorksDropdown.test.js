/* ================================================================== *
 * PHASE 36 — "HOW IT WORKS" PRODUCT-DISCOVERY DROPDOWN + `how` SCREEN
 * REDESIGN
 * ------------------------------------------------------------------
 * Structural guards, source-level (node test env, no DOM) — the same
 * idiom as phase32LandingPageRedesign.test.js / phase34LandingAtmosphere
 * .test.js. Covers:
 *
 *   - Navigation: the "How it works" trigger exists, the desktop dropdown
 *     opens via hover AND click, Overview routes to `how`, Escape closes
 *     it, feature items are keyboard-reachable (onFocus mirrors
 *     onMouseEnter), click-outside is implemented;
 *   - Product accuracy: every feature named in the dropdown/how-screen
 *     maps to a real screen/section elsewhere in the app — nothing
 *     invented;
 *   - The `how` screen: hero, seven numbered journey steps, feature
 *     discovery section and final CTA are all present;
 *   - CTA: the public acquisition CTAs read "Start practising for free"
 *     and still route to the real sign-up flow;
 *   - Accessibility: aria-haspopup/aria-expanded, menu/menuitem roles,
 *     decorative visuals aria-hidden, mobile accordion uses aria-expanded
 *     too (no hover dependency);
 *   - Regression: landing page + universities screen unchanged, legal
 *     footer still present on `how`, no fabricated marketing claims, no
 *     new dependency.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const slice = (start, end) => {
  const s = SRC.indexOf(start);
  const e = SRC.indexOf(end, s + start.length);
  if (s === -1 || e === -1) throw new Error(`markers not found: ${start} .. ${end}`);
  return SRC.slice(s, e);
};

// The dropdown data + components block (categories, previews, visuals, the
// desktop mega-menu and the mobile accordion).
const DROPDOWN = slice('PHASE 36 — "HOW IT WORKS" PRODUCT-DISCOVERY DROPDOWN', 'PHASE 36 — "HOW IT WORKS" PAGE');
// The redesigned `how` screen's own presentational component.
const HOWPAGE = slice('function HowItWorksPage(', 'function NavBar(');
// NavBar itself (desktop nav, mobile accordion, both public CTAs).
const NAVBAR = slice('function NavBar(', 'class ErrorBoundary');
// The `how` screen block inside App().
const HOW_SCREEN = slice('{screen === "how" && (', '{screen === "universities" && (');
// The landing screen block inside App() (for the hero/final CTA regression checks).
const LANDING_SCREEN = slice('{screen === "landing" && (', '{/* ---------------- HOW / UNIVERSITIES');
const TOKENS = slice("const TOKENS = `", "const MODEL =");

/* ---------------------------------------------------------------- *
 * 1. Navigation
 * ---------------------------------------------------------------- */
describe("Phase 36 — dropdown navigation", () => {
  it("the public nav's 'How it works' item is a dropdown/menu trigger, not a plain link", () => {
    expect(NAVBAR).toContain("<HowItWorksDesktopMenu");
    expect(NAVBAR).toContain("<HowItWorksMobileSection");
    expect(DROPDOWN).toMatch(/How it works/);
    expect(DROPDOWN).toContain("ChevronDown");
  });

  it("desktop: opens on hover AND supports click (never hover-only)", () => {
    expect(DROPDOWN).toMatch(/onMouseEnter=\{\(\) => \{ clearCloseTimer\(\); setIsHovering\(true\); \}\}/);
    expect(DROPDOWN).toMatch(/onMouseLeave=\{scheduleClose\}/);
    expect(DROPDOWN).toMatch(/onClick=\{\(\) => setIsPinned\(\(v\) => !v\)\}/);
    expect(DROPDOWN).toMatch(/aria-haspopup="true"/);
    expect(DROPDOWN).toMatch(/aria-expanded=\{open\}/);
  });

  it("trigger and panel share one hoverable wrapper (pointer stays 'inside' moving from trigger to panel)", () => {
    // Both the trigger <button> and the panel live inside the same
    // `wrapRef` div that carries the hover handlers — there is no separate
    // hoverable region the pointer has to jump across.
    const wrapperBlock = DROPDOWN.slice(DROPDOWN.indexOf("<div ref={wrapRef}"), DROPDOWN.indexOf("function HowItWorksMobileSection"));
    expect(wrapperBlock).toContain("data-howdrop-trigger");
    expect(wrapperBlock).toContain("jr-howdrop-panel");
  });

  it("Overview is visually separated and routes to the existing `how` screen", () => {
    expect(DROPDOWN).toMatch(/✦ Overview/);
    expect(DROPDOWN).toContain('target: "how"');
    expect(DROPDOWN).toMatch(/onClick=\{\(\) => navigate\("how"\)\}/);
  });

  it("Escape closes the desktop menu and click-outside is implemented", () => {
    expect(DROPDOWN).toMatch(/e\.key === "Escape"/);
    expect(DROPDOWN).toMatch(/document\.addEventListener\("mousedown", onDocClick\)/);
    expect(DROPDOWN).toMatch(/!wrapRef\.current\.contains\(e\.target\)/);
  });

  /* ---------------------------------------------------------------- *
   * Bug fix — click-to-pin (dropdown stayed open only while literally
   * hovered; a click could never pin it open long enough to reach the
   * panel). `open` is now `isHovering || isPinned`, two independent
   * booleans, rather than one boolean written by both hover and click.
   * ---------------------------------------------------------------- */
  describe("click-to-pin persistence", () => {
    // The desktop menu's own function body, isolated from the mobile
    // accordion and the preview-panel/visual helpers above it.
    const MENU = DROPDOWN.slice(
      DROPDOWN.indexOf("function HowItWorksDesktopMenu"),
      DROPDOWN.indexOf("function HowItWorksMobileSection")
    );

    it("open is derived from two independent booleans, not one hover-and-click-shared flag", () => {
      expect(MENU).toMatch(/const \[isHovering, setIsHovering\] = useState\(false\)/);
      expect(MENU).toMatch(/const \[isPinned, setIsPinned\] = useState\(false\)/);
      expect(MENU).toMatch(/const open = isHovering \|\| isPinned/);
    });

    it("1. hovering the trigger opens the dropdown (mouseenter on the shared wrapper sets isHovering)", () => {
      expect(MENU).toMatch(/onMouseEnter=\{\(\) => \{ clearCloseTimer\(\); setIsHovering\(true\); \}\}/);
    });

    it("2. moving from trigger to panel cannot close it — leaving schedules a debounced close instead of closing immediately, and re-entering cancels it before it fires", () => {
      // Exactly one onMouseLeave in the whole component, on the outer
      // wrapper that contains both the trigger and the panel. `.jr-howdrop-
      // panel` renders offset from `wrapRef` (see the CSS comment in the
      // component), so there is a real, unavoidable geometric gap between
      // the trigger's own box and the panel's rendered position; crossing
      // it genuinely leaves `wrapRef`. A short scheduled close — cancelled
      // by the mouseenter that fires the instant the pointer lands back
      // inside `wrapRef` — bridges that gap instead of unmounting the panel
      // mid-transit (confirmed by browser QA: without this, a real cursor
      // move from trigger to panel raced the unmount and lost).
      const leaveHandlers = MENU.match(/onMouseLeave=/g) || [];
      expect(leaveHandlers.length).toBe(1);
      expect(MENU).toMatch(/onMouseLeave=\{scheduleClose\}/);
      expect(MENU).toMatch(/function scheduleClose\(\) \{ clearCloseTimer\(\); closeTimerRef\.current = setTimeout\(\(\) => setIsHovering\(false\), 200\); \}/);
      expect(MENU).toMatch(/function clearCloseTimer\(\) \{ if \(closeTimerRef\.current\) \{ clearTimeout\(closeTimerRef\.current\); closeTimerRef\.current = null; \} \}/);
      // Critically, the close path (immediate or scheduled) never touches
      // isPinned — scoped to just the scheduleClose/clearCloseTimer bodies,
      // not the whole rest of the component (which legitimately calls
      // setIsPinned elsewhere, e.g. the trigger's own onClick).
      const scheduleCloseBody = MENU.slice(MENU.indexOf("function scheduleClose"), MENU.indexOf("useEffect(() => () => clearCloseTimer()"));
      expect(scheduleCloseBody).not.toMatch(/setIsPinned/);
    });

    it("3. clicking the trigger pins the dropdown open — the click handler touches only isPinned, never isHovering", () => {
      expect(MENU).toMatch(/onClick=\{\(\) => setIsPinned\(\(v\) => !v\)\}/);
      expect(MENU).not.toMatch(/onClick=\{\(\) => setIsPinned[^}]*setIsHovering/);
    });

    it("4. once pinned, the pointer leaving the trigger/panel does not close it (isPinned is untouched by the hover/close-timer path)", () => {
      // Restated from #2/#3: neither hover handler, nor the scheduled close
      // itself, ever writes isPinned — so a pinned-open menu has no code
      // path that un-pins it on mouseleave, immediately or after the delay.
      expect(MENU).not.toMatch(/onMouseEnter=\{\(\) => \{[^}]*setIsPinned/);
      expect(MENU).not.toMatch(/setTimeout\(\(\) => \{?[^)]*setIsPinned/);
    });

    it("5. clicking the trigger again un-pins it (the same toggle as the first click)", () => {
      // setIsPinned((v) => !v) is a toggle: the second click flips true -> false.
      expect((MENU.match(/setIsPinned\(\(v\) => !v\)/g) || []).length).toBe(1);
    });

    it("6. clicking outside clears both isHovering and isPinned (and cancels any pending debounced close)", () => {
      const outsideClickBlock = MENU.slice(MENU.indexOf("function onDocClick"), MENU.indexOf("function onKey"));
      expect(outsideClickBlock).toMatch(/!wrapRef\.current\.contains\(e\.target\)/);
      expect(outsideClickBlock).toMatch(/clearCloseTimer\(\)/);
      expect(outsideClickBlock).toMatch(/setIsHovering\(false\)/);
      expect(outsideClickBlock).toMatch(/setIsPinned\(false\)/);
    });

    it("7. Escape clears both isHovering and isPinned, cancels any pending debounced close, and returns focus to the trigger", () => {
      const escapeBlock = MENU.slice(MENU.indexOf("function onKey"), MENU.indexOf("document.addEventListener"));
      expect(escapeBlock).toMatch(/e\.key === "Escape"/);
      expect(escapeBlock).toMatch(/clearCloseTimer\(\)/);
      expect(escapeBlock).toMatch(/setIsHovering\(false\)/);
      expect(escapeBlock).toMatch(/setIsPinned\(false\)/);
      expect(escapeBlock).toMatch(/data-howdrop-trigger.*focus\(\)/s);
    });

    it("navigating away (Overview or any feature) also clears both and cancels any pending debounced close, so the menu never reopens stuck", () => {
      expect(MENU).toMatch(/function navigate\(target\) \{ clearCloseTimer\(\); setIsHovering\(false\); setIsPinned\(false\); setScreen\(target\); \}/);
    });

    it("aria-expanded reflects the combined open state, not either flag alone", () => {
      expect(MENU).toMatch(/aria-expanded=\{open\}/);
      expect(MENU).not.toMatch(/aria-expanded=\{isHovering\}/);
      expect(MENU).not.toMatch(/aria-expanded=\{isPinned\}/);
    });

    it("8. existing feature navigation is unaffected by the hover/pin split — items still route through the same navigate() helper", () => {
      expect(MENU).toContain('onClick={() => navigate("how")}');
      expect(MENU).toContain('onClick={() => navigate("login")}');
      expect(MENU).toMatch(/onMouseEnter=\{\(\) => setActiveKey\(previewKey\)\} onFocus=\{\(\) => setActiveKey\(previewKey\)\}/);
    });
  });

  it("feature navigation is keyboard accessible — focus mirrors hover, not hover-only", () => {
    // Every feature button gets both onMouseEnter and onFocus wired to the
    // same preview-activation call, so tabbing through with a keyboard
    // reveals the same information a mouse hover does.
    expect(DROPDOWN).toMatch(/onMouseEnter=\{\(\) => setActiveKey\(previewKey\)\} onFocus=\{\(\) => setActiveKey\(previewKey\)\}/);
  });

  it("the active feature is never indicated by colour alone (weight + icon + background all change)", () => {
    expect(DROPDOWN).toMatch(/fontWeight: isActive \? 700 : 500/);
    expect(DROPDOWN).toMatch(/isActive && <CheckCircle2/);
  });

  it("mobile gets its own tap-only accordion — not the desktop mega-menu squeezed onto mobile", () => {
    const MOBILE = DROPDOWN.slice(DROPDOWN.indexOf("function HowItWorksMobileSection"));
    expect(MOBILE).not.toContain("onMouseEnter");
    expect(MOBILE).not.toContain("onMouseLeave");
    expect(MOBILE).toMatch(/aria-expanded=\{sectionOpen\}/);
    expect(MOBILE).toMatch(/aria-expanded=\{catOpen\}/);
    expect(MOBILE).toMatch(/aria-expanded=\{featOpen\}/);
  });
});

/* ---------------------------------------------------------------- *
 * 2. Product accuracy — every advertised feature is real
 * ---------------------------------------------------------------- */
describe("Phase 36 — product accuracy", () => {
  const advertisedFeatures = [
    "AI Mock Interviews", "Invitation Analysis", "Question Mix & Difficulty",
    "Classroom", "Development Modules", "Flashcards", "Quizzes & Knowledge Checks",
    "Personalised Feedback", "Progress Tracking", "Interview DNA", "Interview Memory",
    "Applications", "Application Intelligence", "Assessment Centre",
  ];
  it("every category feature named in the dropdown is present", () => {
    for (const label of advertisedFeatures) expect(DROPDOWN).toContain(label);
  });

  it("every dropdown feature maps to a real, existing screen or in-app concept", () => {
    // Real setScreen() destinations these features correspond to.
    for (const dest of ['"dashboard"', '"applications"', '"classroom"', '"ac_home"', '"progress"']) {
      expect(SRC).toContain(`setScreen(${dest})`);
    }
    // Interview DNA / Interview Memory are real sections of the authenticated
    // `progress` screen, not invented labels — confirmed by real UI usage
    // outside the marketing copy (i.e. more than just the dropdown/how page).
    const dnaHits = (SRC.match(/Interview DNA/g) || []).length;
    const memoryHits = (SRC.match(/Interview Memory/g) || []).length;
    expect(dnaHits).toBeGreaterThan((DROPDOWN.match(/Interview DNA/g) || []).length + (HOWPAGE.match(/Interview DNA/g) || []).length);
    expect(memoryHits).toBeGreaterThan((DROPDOWN.match(/Interview Memory/g) || []).length + (HOWPAGE.match(/Interview Memory/g) || []).length);
  });

  it("the Assessment Centre preview/visual uses only the real exercise types", () => {
    const realTypes = ["Case Study", "Group Exercise", "Presentation", "Written Exercise", "Inbox Exercise"];
    for (const t of realTypes) expect(DROPDOWN).toContain(t);
    const assessmentVisual = DROPDOWN.slice(DROPDOWN.indexOf('if (type === "assessment") {'), DROPDOWN.indexOf("return null"));
    expect(assessmentVisual).not.toMatch(/Panel Interview|Video Interview|Aptitude Test/i);
  });

  it("every feature CTA (except Overview) routes to the real sign-up flow — no fabricated preview destination", () => {
    expect(DROPDOWN).toMatch(/onClick=\{\(\) => navigate\("login"\)\}/);
    expect(DROPDOWN).toContain('onNavigate(preview.target || "login")');
  });
});

/* ---------------------------------------------------------------- *
 * 3. The redesigned `how` screen
 * ---------------------------------------------------------------- */
describe("Phase 36 — `how` screen redesign", () => {
  it("is wired from the existing `screen === \"how\"` block and keeps the legal footer", () => {
    expect(HOW_SCREEN).toContain("<HowItWorksPage");
    expect(HOW_SCREEN).toMatch(/onStart=\{\(\) => setScreen\("login"\)\}/);
    expect(HOW_SCREEN).toMatch(/onBack=\{\(\) => setScreen\("landing"\)\}/);
    expect(HOW_SCREEN).toContain("<LegalFooter");
  });

  it("has the specified hero copy", () => {
    expect(HOWPAGE).toContain("How JOB.READY works");
    expect(HOWPAGE).toContain("From application to interview-ready.");
    expect(HOWPAGE).toContain("Understand what you're preparing for. Learn what you're missing. Practise realistically. Improve with every attempt.");
  });

  it("has all seven numbered journey steps with real feature callouts", () => {
    const titles = [
      "Add your opportunity",
      "Understand what you need to prepare",
      "Learn what you're missing",
      "Practise realistically",
      "Learn from every answer",
      "Track your improvement",
      "Prepare for the complete recruitment process",
    ];
    for (const t of titles) expect(HOWPAGE).toContain(t);
    for (const n of ["01", "02", "03", "04", "05", "06", "07"]) expect(HOWPAGE).toContain(`n: "${n}"`);
  });

  it("step 03 uses visually varied learning cards, not a plain bullet list", () => {
    expect(HOWPAGE).toContain('visual: "learning-cards"');
    expect(HOWPAGE).toContain('<HowPreviewVisual type="modules" />');
    expect(HOWPAGE).toContain('<HowPreviewVisual type="flashcard" />');
    expect(HOWPAGE).toContain('<HowPreviewVisual type="quiz" />');
  });

  it("step 07 uses only the real Assessment Centre exercise types (via the shared visual)", () => {
    expect(HOWPAGE).toContain('visual: "assessment"');
  });

  it("has a feature discovery section grouped into the requested stages", () => {
    expect(HOWPAGE).toContain("Everything in one preparation platform.");
    for (const g of ["Prepare", "Learn", "Practise", "Improve", "Track", "Perform"]) {
      expect(HOWPAGE).toContain(`group: "${g}"`);
    }
  });

  it("has the specified final CTA copy and button", () => {
    expect(HOWPAGE).toContain("Your preparation shouldn't stop at a question generator.");
    expect(HOWPAGE).toContain("Prepare with your opportunity in mind. Learn what you're missing. Practise realistically. Improve with every attempt.");
    expect(HOWPAGE).toMatch(/Start practising for free.*ChevronRight/s);
  });

  it("introduces no unsupported pricing claim", () => {
    expect(HOWPAGE).not.toMatch(/free forever|no credit card|unlimited free|premium plan|subscription (tier|discount)/i);
  });
});

/* ---------------------------------------------------------------- *
 * 4. CTA copy — "Start practising for free"
 * ---------------------------------------------------------------- */
describe("Phase 36 — public acquisition CTA copy", () => {
  it("the nav (desktop + mobile), landing hero, landing final CTA and `how` screen all say 'Start practising for free'", () => {
    const hits = (SRC.match(/Start practising for free/g) || []).length;
    expect(hits).toBeGreaterThanOrEqual(5);
  });

  it("no public acquisition CTA still reads the old copy", () => {
    expect(SRC).not.toMatch(/>Start practising<\/Btn>/);
    expect(SRC).not.toMatch(/>Start preparing\s*</);
  });

  it("the nav CTAs still route to the real sign-up flow", () => {
    expect(NAVBAR).toMatch(/Start practising for free<\/Btn>/);
    expect((NAVBAR.match(/setScreen\("login"\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("the landing hero + final CTA still invoke onStart (unchanged routing)", () => {
    expect((LANDING_SCREEN.match(/onStart=\{\(\) => setScreen\("login"\)\}/) || []).length).toBeGreaterThanOrEqual(1);
  });
});

/* ---------------------------------------------------------------- *
 * 5. Accessibility
 * ---------------------------------------------------------------- */
describe("Phase 36 — accessibility", () => {
  it("the desktop panel and its items carry menu/menuitem roles", () => {
    expect(DROPDOWN).toContain('role="menu"');
    expect(DROPDOWN).toContain('role="menuitem"');
  });

  it("decorative preview visuals are aria-hidden", () => {
    const visualFn = DROPDOWN.slice(DROPDOWN.indexOf("function HowPreviewVisual"), DROPDOWN.indexOf("function HowItWorksPreviewPanel"));
    // every branch that returns a decorative box is aria-hidden
    const decorativeDivs = (visualFn.match(/<div aria-hidden="true"/g) || []).length;
    expect(decorativeDivs).toBeGreaterThanOrEqual(6);
  });

  it("illustrative/sample numbers are labelled as such", () => {
    expect(DROPDOWN).toMatch(/Illustrative preview · sample data/);
  });

  it("global focus-visible styling still covers plain buttons (dropdown trigger/items included)", () => {
    expect(TOKENS).toMatch(/button:focus-visible,\s*a:focus-visible\{[^}]*outline:\s*2px solid var\(--blue\)/);
  });

  it("mobile accordion never depends on hover and uses real, focusable <button> elements", () => {
    const MOBILE = DROPDOWN.slice(DROPDOWN.indexOf("function HowItWorksMobileSection"));
    // Every interactive row is a <button type="button">, not a clickable span/div.
    const buttonCount = (MOBILE.match(/<button type="button"/g) || []).length;
    expect(buttonCount).toBeGreaterThanOrEqual(3);
  });
});

/* ---------------------------------------------------------------- *
 * 6. Regression
 * ---------------------------------------------------------------- */
describe("Phase 36 — regression", () => {
  it("the landing page still renders from the existing screen + component", () => {
    expect(SRC).toContain('{screen === "landing" && (');
    expect(LANDING_SCREEN).toContain("<LandingPage");
  });

  it("'For universities' is unaffected — still a plain link, still routes correctly", () => {
    expect(NAVBAR).toMatch(/label: "For universities", to: "universities"/);
    expect(SRC).toContain('{screen === "universities" && (');
  });

  it("every authenticated nav link is unchanged (dashboard/applications/classroom/ac_home/progress)", () => {
    expect(NAVBAR).toContain('{ label: "Dashboard", to: "dashboard" }');
    expect(NAVBAR).toContain('{ label: "Applications", to: "applications" }');
    expect(NAVBAR).toContain('{ label: "Classroom", to: "classroom" }');
    expect(NAVBAR).toContain('{ label: "Assessment Centre", to: "ac_home" }');
    expect(NAVBAR).toContain('{ label: "Progress", to: "progress" }');
  });

  it("no fabricated marketing claims were introduced (dropdown + how screen)", () => {
    const banned = [
      /testimonial/i, /\d[,.]?\d*\+?\s*(students|universities|companies) (use|trust)/i,
      /hired\b/i, /guarantee/i, /university partnership/i, /\d+%\s*(more likely|success|higher)/i,
    ];
    for (const re of banned) {
      expect(DROPDOWN).not.toMatch(re);
      expect(HOWPAGE).not.toMatch(re);
    }
  });

  it("no new dependency was introduced", () => {
    expect(Object.keys(PKG.dependencies).sort()).toEqual(["lucide-react", "mammoth", "react", "react-dom"]);
  });

  it("the dropdown/how-screen components stay presentation-only — no Supabase, no AI calls", () => {
    // Checks actual usage, not the bare word, so a comment documenting the
    // absence of backend calls can't itself trip the assertion.
    expect(DROPDOWN).not.toMatch(/supabase\.|callClaude\(/i);
    expect(HOWPAGE).not.toMatch(/supabase\.|callClaude\(/i);
  });
});
