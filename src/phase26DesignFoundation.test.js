/* ================================================================== *
 * PHASE 26 — GLOBAL DESIGN FOUNDATION (STRUCTURAL, over src/App.jsx)
 * ------------------------------------------------------------------
 * Foundations only: this phase adds shared design tokens, a typography
 * scale, and opt-in `.jr-*` primitives + presentation-only React
 * components. It must NOT redesign feature screens and must NOT change
 * behaviour. The test env is node (no DOM), so these are source-level
 * assertions that the foundation exists, is additive (nothing the app
 * already relied on was removed), and introduces no new dependency.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const TOKENS = (() => {
  const start = SRC.indexOf("const TOKENS = `");
  const end = SRC.indexOf("`;", start);
  return SRC.slice(start, end);
})();

describe("Phase 26 — design tokens are added (and the existing ones are untouched)", () => {
  it("keeps every token the current build already depends on", () => {
    for (const t of ["--navy:", "--blue:", "--radius:14px", "--radius-sm:8px", "--shadow-sm:", "--font:"]) {
      expect(TOKENS).toContain(t);
    }
  });

  it("adds the new surface / status-tint / radius / motion / focus tokens", () => {
    for (const t of [
      "--surface:", "--surface-sunken:", "--track:",
      "--tint-success:", "--tint-warning:", "--tint-error:", "--tint-info:", "--tint-neutral:",
      "--r-xs:", "--r-sm:", "--r-md:", "--r-lg:", "--r-pill:",
      "--dur-fast:", "--dur:", "--ease:", "--focus-ring:",
    ]) {
      expect(TOKENS).toContain(t);
    }
  });

  it("normalises the document margin (foundation reset) without a global box-sizing reset", () => {
    expect(TOKENS).toMatch(/html,\s*body\s*\{\s*margin:\s*0/);
    // a global `* { box-sizing }` would silently reflow every existing screen — must stay scoped
    expect(TOKENS).not.toMatch(/\*\s*\{[^}]*box-sizing/);
  });

  it("adds no NEW external stylesheet / font / CDN dependency", () => {
    // the app has always had exactly one @import (the Inter web font) — Phase 26 must not add another
    const imports = TOKENS.match(/@import/g) || [];
    expect(imports.length).toBe(1);
    expect(TOKENS).toMatch(/@import url\('https:\/\/fonts\.googleapis\.com[^']*family=Inter/);
    expect(TOKENS).not.toMatch(/@font-face/);
    // any other url(https:…) reference (a second CDN asset) would be new
    const cdnUrls = TOKENS.match(/url\(\s*['"]?https?:/gi) || [];
    expect(cdnUrls.length).toBe(1); // just the font @import above
  });
});

describe("Phase 26 — shared primitive classes are defined in TOKENS", () => {
  const required = [
    // typography scale
    ".jr-h1", ".jr-h2", ".jr-h3", ".jr-text", ".jr-text-sm", ".jr-label", ".jr-help", ".jr-meta",
    // inputs / forms
    ".jr-input", ".jr-textarea", ".jr-select", ".jr-pwfield", ".jr-pwtoggle",
    // cards / surfaces
    ".jr-card-interactive",
    // status / feedback
    ".jr-alert", ".jr-alert-success", ".jr-alert-warning", ".jr-alert-error", ".jr-alert-info",
    ".jr-badge", ".jr-badge-neutral", ".jr-badge-dot",
    // layout primitives
    ".jr-page", ".jr-page-header", ".jr-section", ".jr-empty", ".jr-empty-icon",
  ];
  for (const cls of required) {
    it(`defines ${cls}`, () => {
      expect(TOKENS).toMatch(new RegExp(cls.replace(/[.]/g, "\\.") + "[\\s,{]"));
    });
  }

  it("defines button :disabled and :focus-visible states", () => {
    expect(TOKENS).toMatch(/\.jr-btn:disabled\s*\{[^}]*opacity/);
    expect(TOKENS).toMatch(/\.jr-btn:focus-visible\s*\{/);
  });

  it("gives the new controls a scoped box-sizing (not a global one)", () => {
    expect(TOKENS).toMatch(/\.jr-input[^{]*\{[^}]*box-sizing:\s*border-box/);
  });

  it("the .jr-select chevron is an inline data URI with no literal brace (keeps the CSS-guard parser happy)", () => {
    const m = TOKENS.match(/\.jr-select\s*\{([^}]*)\}/);
    expect(m).toBeTruthy();
    expect(m[1]).toContain("data:image/svg+xml");
    expect(m[1]).not.toContain("}");
  });
});

describe("Phase 26 — presentation-only shared components exist", () => {
  for (const fn of [
    "function Alert(", "function StatusBadge(", "function PageHeader(",
    "function EmptyState(", "function Field(", "function TextInput(",
    "function Textarea(", "function Select(",
  ]) {
    it(`declares ${fn}`, () => expect(SRC).toContain(fn));
  }

  it("Alert / StatusBadge carry no state, effects or handlers of their own", () => {
    const block = SRC.slice(SRC.indexOf("function Alert("), SRC.indexOf("function ScoreBar("));
    expect(block).not.toMatch(/useState|useEffect|useRef|onClick=|fetch\(|localStorage/);
  });
});

describe("Phase 26 — shared primitives are refined, not rebuilt", () => {
  const btn = SRC.slice(SRC.indexOf("function Btn("), SRC.indexOf("function Card("));
  const card = SRC.slice(SRC.indexOf("function Card("), SRC.indexOf("function LinkBtn("));

  it("Btn keeps its four original variants and adds a `danger` variant + className pass-through", () => {
    for (const v of ["primary:", "accent:", "secondary:", "ghost:", "danger:"]) expect(btn).toContain(v);
    expect(btn).toMatch(/className \? "jr-btn " \+ className : "jr-btn"/);
    expect(btn).toContain('padding: "12px 22px"'); // geometry unchanged
    expect(btn).toContain("disabled={disabled}"); // behaviour unchanged
  });

  it("Card keeps its default surface + keyboard handler and adds variant/className", () => {
    expect(card).toContain('borderRadius: "var(--radius)"');
    expect(card).toContain('e.key === "Enter"');
    expect(card).toMatch(/variant === "elevated"/);
    expect(card).toMatch(/jr-card-interactive/);
  });

  it("PasswordInput now renders through the shared .jr-pwfield composite", () => {
    const pw = SRC.slice(SRC.indexOf("function PasswordInput("), SRC.indexOf("function PasswordInput(") + 900);
    expect(pw).toContain('className="jr-pwfield"');
    expect(pw).toContain('className="jr-pwtoggle"');
    // Phase 23 accessibility contract still intact
    expect(pw).toContain("const [visible, setVisible] = useState(false)");
    expect(pw).toContain("type={passwordInputType(visible)}");
    expect(pw).toContain("aria-pressed={visible}");
  });
});

describe("Phase 26 — auth screens keep their Phase 23 behaviour", () => {
  it("still routes every auth password field through PasswordInput", () => {
    for (const id of ["signin-password", "signup-password", "signup-confirm-password", "reset-password", "reset-confirm-password"]) {
      expect(SRC).toContain(`<PasswordInput id="${id}"`);
    }
  });
  it("still carries the forgot-password / expired-link markers", () => {
    for (const marker of ["Forgot password?", "Check your email", "Set a new password", "expiredLinkMessage"]) {
      expect(SRC).toContain(marker);
    }
  });
});
