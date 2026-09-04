/* ================================================================== *
 * PHASE 27 — APPLICATION SHELL & NAVIGATION (STRUCTURAL, over App.jsx)
 * ------------------------------------------------------------------
 * Phase 27 wraps the product in a consistent shell: a small set of
 * content widths (via the Phase 26 `.jr-page*` primitives), a premium
 * navigation active state, and a shared page-header treatment on the
 * flagship screens. It must NOT change routing, navigation destinations,
 * the public/authenticated split, or any feature behaviour. The test env
 * is node (no DOM), so these are source-level guards.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const TOKENS = (() => {
  const s = SRC.indexOf("const TOKENS = `");
  return SRC.slice(s, SRC.indexOf("`;", s));
})();
const NAVBAR = SRC.slice(SRC.indexOf("function NavBar("), SRC.indexOf("class ErrorBoundary"));

describe("Phase 27 — the shell defines a small, intentional set of content widths", () => {
  it("keeps exactly three .jr-page width tiers, each a distinct max-width", () => {
    const page = TOKENS.match(/\.jr-page\{[^}]*max-width:\s*(\d+)px/);
    const narrow = TOKENS.match(/\.jr-page-narrow\{[^}]*max-width:\s*(\d+)px/);
    const wide = TOKENS.match(/\.jr-page-wide\{[^}]*max-width:\s*(\d+)px/);
    expect(page).toBeTruthy();
    expect(narrow).toBeTruthy();
    expect(wide).toBeTruthy();
    const widths = [page[1], narrow[1], wide[1]].map(Number);
    expect(new Set(widths).size).toBe(3);            // all distinct
    expect(widths[1]).toBeLessThan(widths[0]);       // narrow < standard
    expect(widths[0]).toBeLessThan(widths[2]);       // standard < wide
  });

  it(".jr-page keeps a flat 24px side gutter and an easing top gutter", () => {
    expect(TOKENS).toMatch(/\.jr-page\{[^}]*padding:\s*clamp\([^)]*\)\s*24px/);
  });

  it("the flagship + flow screens actually adopt the shell container", () => {
    const adoptions = SRC.match(/className="jr-fade jr-page(?: jr-page-narrow)?"/g) || [];
    expect(adoptions.length).toBeGreaterThanOrEqual(18);
    // the old bespoke per-screen container literal is fully gone
    expect(SRC).not.toMatch(/className="jr-fade" style=\{\{ maxWidth: \d+, margin: "0 auto", padding: "44px 24px" \}\}/);
  });

  it("focused forms use the narrow tier", () => {
    const narrow = SRC.match(/className="jr-fade jr-page jr-page-narrow"/g) || [];
    expect(narrow.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Phase 27 — navigation destinations and the public/authenticated split are unchanged", () => {
  it("authenticated nav points at exactly the five product sections", () => {
    const li = NAVBAR.indexOf("const links = user");
    const authed = NAVBAR.slice(li, li + 500);
    for (const dest of ['to: "dashboard"', 'to: "applications"', 'to: "classroom"', 'to: "ac_home"', 'to: "progress"']) {
      expect(authed).toContain(dest);
    }
    // public nav after fix(landing): "How it works" + "Pricing" (the
    // "For universities" tab was removed; its screen + route still exist)
    expect(authed).toContain('to: "how"');
    expect(authed).toContain('to: "pricing"');
    expect(authed).not.toContain('to: "universities"');
    // the split is still a single `user ?` ternary
    expect(authed).toMatch(/const links = user\s*\?/);
  });

  it("still routes via setScreen with no new navigation mechanism", () => {
    expect(NAVBAR).toMatch(/onClick=\{\(\) => setScreen\(l\.to\)\}/);
    expect(NAVBAR).toMatch(/setScreen\(user \? "dashboard" : "landing"\)/);
    // no react-router / history pushState introduced in the nav
    expect(NAVBAR).not.toMatch(/react-router|createBrowserRouter|history\.push|useNavigate/);
  });

  it("the mobile menu is still gated behind the hamburger, so there is never a double nav", () => {
    expect(NAVBAR).toMatch(/\{!isMobile && \(/);
    expect(NAVBAR).toMatch(/\{isMobile && menuOpen && \(/);
    // exactly two <nav aria-label="Main"> in source (desktop + mobile), only one renders at a time
    expect((NAVBAR.match(/<nav aria-label="Main"/g) || []).length).toBe(2);
  });

  it("showNav still lists the same screens (no screen silently loses its chrome)", () => {
    const m = SRC.match(/const showNav = \[([^\]]+)\]\.includes\(screen\)/);
    expect(m).toBeTruthy();
    for (const s of ["landing", "login", "dashboard", "applications", "progress", "classroom", "ac_home", "report", "lesson"]) {
      expect(m[1]).toContain(`"${s}"`);
    }
  });
});

describe("Phase 27 — premium but restrained nav active state", () => {
  it("uses a subtle highlight fill + weight shift for the current section (no heavy block/border/animation)", () => {
    expect(NAVBAR).toMatch(/const active = screen === l\.to/);
    expect(NAVBAR).toMatch(/background: active \? "var\(--highlight\)" : "transparent"/);
    expect(NAVBAR).toMatch(/fontWeight: active \? 600 : 500/);
    expect(NAVBAR).not.toMatch(/border(Bottom)?: active/);   // no aggressive underline/box
  });
});

describe("Phase 27 — flagship page headers adopt the shared treatment", () => {
  it("Dashboard and Applications use .jr-page-header + .jr-h1", () => {
    const dash = SRC.slice(SRC.indexOf('screen === "dashboard" && user'), SRC.indexOf('screen === "dashboard" && user') + 900);
    const apps = SRC.slice(SRC.indexOf('screen === "applications" && user'), SRC.indexOf('screen === "applications" && user') + 900);
    for (const block of [dash, apps]) {
      expect(block).toContain('className="jr-page-header"');
      expect(block).toContain('<h2 className="jr-h1">');
    }
  });
});

describe("Phase 27 — no regression to earlier phases", () => {
  it("Phase 23/23A auth flow markers are intact", () => {
    for (const marker of [
      '<PasswordInput id="signin-password"', '<PasswordInput id="reset-password"',
      "Forgot password?", "Set a new password", "expiredLinkMessage",
    ]) {
      expect(SRC).toContain(marker);
    }
  });
  it("Phase 26 foundation classes are still defined", () => {
    for (const cls of [".jr-input", ".jr-btn:disabled", ".jr-alert", ".jr-badge", ".jr-h1"]) {
      expect(TOKENS).toMatch(new RegExp(cls.replace(/[.]/g, "\\.") + "[\\s,{:]"));
    }
  });
});
