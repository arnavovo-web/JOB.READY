/* ================================================================== *
 * PHASE 30 — LEGAL PAGES + POLICY INTEGRATION (structural)
 * ------------------------------------------------------------------
 * Guards that:
 *   - the Privacy Policy and Terms of Service exist, are structured,
 *     and carry every required section;
 *   - the wording stays tied to the ACTUAL repo (Supabase / Vercel /
 *     Anthropic; local storage not cookies; no analytics; self-service
 *     deletion/export not yet available) and invents no company details;
 *   - both pages are wired into the app as PUBLIC screens, linked from
 *     the landing / auth / footer, with a sign-up acknowledgement;
 *   - nothing about auth, AI, Supabase or routing behaviour changed.
 * Node env — source + pure-content assertions.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PRIVACY_POLICY } from "./legal/privacyPolicy.js";
import { TERMS_OF_SERVICE } from "./legal/termsOfService.js";
import { LEGAL_CONTACT, legalContactBlurb, hasResolvedLegalContact, formatLegalDate } from "./legal/legalContact.js";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const sectionText = (doc) =>
  doc.sections.flatMap((s) => [...(s.paragraphs || []), ...(s.list || []), ...(s.trailing || [])]).join("\n");
const headings = (doc) => doc.sections.map((s) => s.heading.toLowerCase());
const hasHeading = (doc, needle) => headings(doc).some((h) => h.includes(needle.toLowerCase()));

/* ------------------------------ content shape ------------------------------ */
describe("Phase 30 — the policy documents are structured and non-empty", () => {
  for (const [name, doc] of [["Privacy Policy", PRIVACY_POLICY], ["Terms of Service", TERMS_OF_SERVICE]]) {
    it(`${name} has a title, subtitle and a real list of sections`, () => {
      expect(typeof doc.title).toBe("string");
      expect(doc.title.length).toBeGreaterThan(0);
      expect(typeof doc.subtitle).toBe("string");
      expect(Array.isArray(doc.sections)).toBe(true);
      expect(doc.sections.length).toBeGreaterThanOrEqual(12);
    });
    it(`${name} sections each have a heading and real body content`, () => {
      for (const s of doc.sections) {
        expect(typeof s.heading).toBe("string");
        expect(s.heading.trim().length).toBeGreaterThan(2);
        const body = [...(s.paragraphs || []), ...(s.list || []), ...(s.trailing || [])];
        expect(body.length, `section "${s.heading}" is empty`).toBeGreaterThan(0);
        for (const line of body) { expect(typeof line).toBe("string"); expect(line.trim().length).toBeGreaterThan(0); }
      }
    });
    it(`${name} never leaves an unfilled "${"${P}"}" template token in its text`, () => {
      expect(sectionText(doc)).not.toContain("${P}");
      expect(sectionText(doc)).not.toContain("${LEGAL_CONTACT");
    });
  }
});

/* ------------------------------ required sections ------------------------------ */
describe("Phase 30 — Privacy Policy covers every required area", () => {
  for (const h of [
    "introduction", "information we collect", "how we use", "ai processing", "legal bases",
    "stored", "sharing", "international transfers", "retention", "your rights",
    "security", "children", "changes to this policy", "contact",
  ]) {
    it(`has a "${h}" section`, () => expect(hasHeading(PRIVACY_POLICY, h)).toBe(true));
  }
});

describe("Phase 30 — Terms of Service covers every required area", () => {
  for (const h of [
    "acceptance", "eligibility", "what job.ready provides", "ai-powered features", "your content",
    "acceptable use", "intellectual property", "no professional advice", "availability",
    "suspension and termination", "disclaimers", "limitation of liability", "changes to these terms",
    "governing law", "contact",
  ]) {
    it(`has a "${h}" section`, () => expect(hasHeading(TERMS_OF_SERVICE, h)).toBe(true));
  }
});

/* ------------------------------ accuracy to the repo ------------------------------ */
describe("Phase 30 — the wording matches what the code actually does", () => {
  const priv = sectionText(PRIVACY_POLICY);

  it("names only the third parties the app really uses", () => {
    for (const svc of ["Supabase", "Vercel", "Anthropic"]) expect(priv).toContain(svc);
    // services / trackers the repo has NO integration with must not be named as things we use
    for (const invented of ["Google Analytics", "Google Tag Manager", "Stripe", "PayPal", "Facebook Pixel",
      "Meta Pixel", "Mixpanel", "Segment", "Hotjar", "Amplitude", "advertising network", "advertising partners"]) {
      expect(priv).not.toContain(invented);
    }
    // it is fine (and correct) for the policy to say we do NOT advertise / do NOT set tracking cookies
    expect(priv).toMatch(/do not (sell|share) your personal information/i);
  });
  it("describes browser storage as an auth token in local storage, not app-set cookies", () => {
    expect(priv.toLowerCase()).toContain("local storage");
    expect(priv).not.toMatch(/we (use|set) (non-essential |analytics )?cookies/i);
  });
  it("is honest that self-service deletion and export are not built yet", () => {
    expect(priv).toMatch(/does not currently provide a way to delete your account/i);
    expect(priv).toMatch(/not built into the application yet|handle them manually/i);
  });
  it("invents no security certification and no fixed retention period", () => {
    expect(priv).not.toMatch(/ISO ?27001|SOC ?2|PCI[- ]DSS|Cyber Essentials/i);
    expect(priv).not.toMatch(/for (30|60|90|180) days|for \d+ (days|months|years)/i);
  });
  it("AI section warns output can be wrong and does not promise anything", () => {
    expect(priv).toMatch(/can be inaccurate, incomplete or out of date/i);
    expect(priv).not.toMatch(/guarantee(s|d)? (a|an|your) (job|offer|interview|outcome)/i);
  });
});

describe("Phase 30 — Terms are JOB.READY-specific and consumer-fair", () => {
  const terms = sectionText(TERMS_OF_SERVICE);

  it("does not guarantee employment, offers, success or accurate AI evaluations", () => {
    expect(terms).toMatch(/does not guarantee any interview outcome, job offer/i);
    expect(terms).not.toMatch(/we guarantee (you|that you will)/i);
  });
  it("keeps user content owned by the user (licence, not an ownership grab)", () => {
    expect(terms).toMatch(/You retain ownership of your content/i);
    expect(terms).toMatch(/permissions reasonably necessary to host, store, process and transmit/i);
    expect(terms).not.toMatch(/you (assign|transfer) (to us )?(all )?(your )?(rights|ownership)/i);
  });
  it("liability clause preserves rights that cannot be excluded by law", () => {
    expect(terms).toMatch(/Nothing in these Terms excludes or limits our liability where it would be unlawful/i);
    expect(terms).toMatch(/Consumer Rights Act 2015/);
    expect(terms).not.toMatch(/all liability is excluded|to the maximum extent, we exclude all/i);
  });
  it("frames itself as UK / England & Wales without an ugly end-user disclaimer", () => {
    expect(terms).toMatch(/laws of England and Wales/);
    expect(sectionText(TERMS_OF_SERVICE)).not.toMatch(/THIS IS NOT LEGAL ADVICE/i);
    expect(sectionText(PRIVACY_POLICY)).not.toMatch(/THIS IS NOT LEGAL ADVICE/i);
  });
});

/* ------------------------------ no invented business info ------------------------------ */
describe("Phase 30 — no company / contact details were invented", () => {
  it("LEGAL_CONTACT leaves every unconfirmed field null", () => {
    for (const k of ["legalEntityName", "registeredAddress", "companyNumber", "icoRegistrationNumber", "privacyContactEmail", "supportContactEmail"]) {
      expect(LEGAL_CONTACT[k], `${k} must not be invented`).toBeNull();
    }
    expect(hasResolvedLegalContact()).toBe(false);
  });
  it("the Contact section falls back to a clearly-identifiable placeholder", () => {
    const blurb = legalContactBlurb().join(" ");
    expect(blurb).toMatch(/before the service is made generally available/i);
    expect(blurb).not.toMatch(/@/);                       // no fake email address rendered
    expect(blurb).not.toMatch(/\bLtd\b|\bLimited\b|Street|Road|Avenue/); // no fake entity / address
  });
  it("formatLegalDate produces a readable UK date", () => {
    expect(formatLegalDate("2026-08-31")).toBe("31 August 2026");
  });
});

/* ------------------------------ app integration ------------------------------ */
describe("Phase 30 — legal pages are wired in as PUBLIC screens", () => {
  it("privacy + terms are in showNav and rendered without an auth guard", () => {
    const m = SRC.match(/const showNav = \[([^\]]+)\]\.includes\(screen\)/);
    expect(m[1]).toContain('"privacy"');
    expect(m[1]).toContain('"terms"');
    expect(SRC).toMatch(/\{screen === "privacy" && \(\s*<LegalPage doc=\{PRIVACY_POLICY\}/);
    expect(SRC).toMatch(/\{screen === "terms" && \(\s*<LegalPage doc=\{TERMS_OF_SERVICE\}/);
    // the render branches must NOT require a signed-in user
    expect(SRC).not.toMatch(/screen === "privacy" && user/);
    expect(SRC).not.toMatch(/screen === "terms" && user/);
  });
  it("existing authenticated screens keep their nav chrome", () => {
    const m = SRC.match(/const showNav = \[([^\]]+)\]\.includes\(screen\)/);
    for (const s of ["dashboard", "applications", "progress", "classroom", "ac_home", "report", "login", "landing"]) {
      expect(m[1]).toContain(`"${s}"`);
    }
  });
  it("LegalPage / LegalFooter / openLegal exist and stay presentation-only", () => {
    expect(SRC).toContain("function LegalPage(");
    expect(SRC).toContain("function LegalFooter(");
    expect(SRC).toMatch(/const openLegal = \(page\) => \{/);
    const block = SRC.slice(SRC.indexOf("function LegalFooter("), SRC.indexOf("function App() {"));
    expect(block).not.toMatch(/useState|useEffect|useRef|fetch\(|supabase|callClaude|signUp|resetPassword/);
  });
});

describe("Phase 30 — links are present in the public / auth UI", () => {
  it("the sign-up view carries an acknowledgement linking both documents", () => {
    const signup = SRC.slice(SRC.indexOf('authView === "signup"'), SRC.indexOf('authView === "signin"'));
    expect(signup).toMatch(/By creating an account, you agree to the/i);
    expect(signup).toMatch(/onClick=\{\(\) => openLegal\("terms"\)\}/);
    expect(signup).toMatch(/onClick=\{\(\) => openLegal\("privacy"\)\}/);
    // and the sign-up handler itself is untouched
    expect(signup).toMatch(/onClick=\{\(\) => guarded\(handleSignUp\)\}/);
  });
  it("a footer with both links appears on landing, sign-in and the marketing pages", () => {
    expect((SRC.match(/<LegalFooter openLegal=\{openLegal\} \/>/g) || []).length).toBeGreaterThanOrEqual(5);
    const landing = SRC.slice(SRC.indexOf('{screen === "landing" && ('), SRC.indexOf('{/* ---------------- HOW / UNIVERSITIES'));
    expect(landing).toContain("<LegalFooter openLegal={openLegal} />");
    const login = SRC.slice(SRC.indexOf('{screen === "login" && (()'), SRC.indexOf('{/* ---------------- LEGAL'));
    expect(login).toContain("<LegalFooter openLegal={openLegal} />");
  });
});

/* ------------------------------ protection ------------------------------ */
describe("Phase 30 — nothing about auth / AI / Supabase / scoring changed", () => {
  it("the legal content modules are inert (no React, network, DB or auth code)", () => {
    // Naming "Supabase" / "Anthropic" as providers in the prose is expected;
    // what must NOT appear is actual code that talks to them.
    for (const f of ["./legal/privacyPolicy.js", "./legal/termsOfService.js", "./legal/legalContact.js"]) {
      const t = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(t).not.toMatch(/from ["']react["']|createClient\(|\bfetch\(|callClaude|XMLHttpRequest|\.from\(["']|supabase\.auth/);
    }
  });
  it("Phase 23 auth markers and Phase 26/27/28/29 primitives are intact", () => {
    for (const m of [
      '<PasswordInput id="signup-password"', '<PasswordInput id="reset-password"', "Forgot password?",
      "expiredLinkMessage", "resetPasswordForEmail(", "signInWithPassword(",
      "function MetricCard(", "function FeaturedCard(", "function SectionHeading(", "function Alert(",
    ]) {
      expect(SRC).toContain(m);
    }
  });
  it("no AI call, Supabase query or migration was added by the legal screens", () => {
    const legalRender = SRC.slice(SRC.indexOf('{/* ---------------- LEGAL (public'), SRC.indexOf('{/* ---------------- DASHBOARD'));
    expect(legalRender).not.toMatch(/callClaude|\.from\(|supabase|auth\.|ALTER TABLE|create table/i);
  });
});
