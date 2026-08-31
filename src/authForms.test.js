/* ================================================================== *
 * PHASE 23 — AUTH UX HELPERS: UNIT TESTS
 * ------------------------------------------------------------------
 * authForms.js is pure (no React / Supabase / network / DOM), so the
 * show/hide-password mapping, the reset-form validation, the redirect
 * strategy and the recovery-link classification are all testable
 * without rendering a component or sending a real reset email.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  PASSWORD_MIN_LENGTH,
  passwordInputType, visibilityToggleLabel, nextVisibility,
  validateEmailForReset, validateNewPassword,
  passwordResetRedirectTo, classifyAuthRedirect,
  resetEmailSentMessage, expiredLinkMessage, friendlyAuthError,
} from "./authForms.js";

const SRC = readFileSync(new URL("./authForms.js", import.meta.url), "utf8");

describe("authForms.js is a pure, offline module", () => {
  it("no React / Supabase / network / DOM / logging of secrets", () => {
    expect(SRC).not.toMatch(/from ["']react["']|supabase|createClient|fetch\(|XMLHttpRequest|console\.(log|info|warn|error)/);
  });
  it("never references a hardcoded deploy host", () => {
    expect(SRC).not.toMatch(/vercel\.app|https?:\/\/[a-z0-9-]+\.(com|app|dev|io)\b/i);
  });
});

/* ---------------- show / hide password ---------------- */
describe("password visibility mapping", () => {
  it("hidden => type 'password' and label 'Show password'", () => {
    expect(passwordInputType(false)).toBe("password");
    expect(visibilityToggleLabel(false)).toBe("Show password");
  });
  it("visible => type 'text' and label 'Hide password'", () => {
    expect(passwordInputType(true)).toBe("text");
    expect(visibilityToggleLabel(true)).toBe("Hide password");
  });
  it("toggling only ever flips the flag (password starts masked)", () => {
    let v = false;                         // initial state: masked
    expect(passwordInputType(v)).toBe("password");
    v = nextVisibility(v);                 // click "Show password"
    expect(passwordInputType(v)).toBe("text");
    v = nextVisibility(v);                 // click "Hide password"
    expect(passwordInputType(v)).toBe("password");
  });
  it("the mapping only ever yields the two valid input types", () => {
    for (const v of [true, false, 1, 0, null, undefined, "x"]) {
      expect(["text", "password"]).toContain(passwordInputType(v));
    }
  });
});

/* ---------------- new-password validation ---------------- */
describe("validateNewPassword — matching + length (shared by sign-up and reset)", () => {
  it("rejects empty", () => {
    expect(validateNewPassword("", "")).toMatchObject({ ok: false });
  });
  it(`rejects shorter than ${PASSWORD_MIN_LENGTH}`, () => {
    const r = validateNewPassword("short", "short");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(new RegExp(`${PASSWORD_MIN_LENGTH}`));
  });
  it("rejects a mismatch between password and confirmation", () => {
    const r = validateNewPassword("longenough1", "longenough2");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/match/i);
  });
  it("accepts a long-enough matching pair", () => {
    expect(validateNewPassword("correcthorse", "correcthorse")).toEqual({ ok: true, error: "" });
  });
  it("never throws on non-string input", () => {
    expect(() => validateNewPassword(null, undefined)).not.toThrow();
    expect(() => validateNewPassword(12345678, 12345678)).not.toThrow();
  });
});

/* ---------------- reset-request email validation ---------------- */
describe("validateEmailForReset", () => {
  it("rejects blank", () => {
    expect(validateEmailForReset("   ").ok).toBe(false);
  });
  it("rejects an obvious non-email", () => {
    expect(validateEmailForReset("not-an-email").ok).toBe(false);
    expect(validateEmailForReset("foo@bar").ok).toBe(false);
  });
  it("accepts a normal address", () => {
    expect(validateEmailForReset("alex@university.ac.uk")).toEqual({ ok: true, error: "" });
  });
});

/* ---------------- redirect URL strategy ---------------- */
describe("passwordResetRedirectTo — origin-based, no hardcoded host", () => {
  it("returns the exact origin it is given (local, preview, production)", () => {
    expect(passwordResetRedirectTo("http://localhost:5173")).toBe("http://localhost:5173");
    expect(passwordResetRedirectTo("https://job-ready-git-feat-x.vercel.app")).toBe("https://job-ready-git-feat-x.vercel.app");
    expect(passwordResetRedirectTo("https://app.jobready.example")).toBe("https://app.jobready.example");
  });
  it("strips a trailing slash", () => {
    expect(passwordResetRedirectTo("https://app.jobready.example/")).toBe("https://app.jobready.example");
  });
  it("returns '' for a missing / non-http origin so the caller omits the option", () => {
    expect(passwordResetRedirectTo("")).toBe("");
    expect(passwordResetRedirectTo(null)).toBe("");
    expect(passwordResetRedirectTo("ftp://nope")).toBe("");
    expect(passwordResetRedirectTo("about:blank")).toBe("");
  });
});

/* ---------------- recovery-link classification ---------------- */
describe("classifyAuthRedirect — valid vs expired vs errored vs none", () => {
  it("a valid recovery return (type=recovery in the hash)", () => {
    expect(classifyAuthRedirect("#access_token=abc&type=recovery&expires_in=3600", "").kind).toBe("recovery");
  });
  it("a valid recovery return (type=recovery in the query string / PKCE)", () => {
    expect(classifyAuthRedirect("", "?type=recovery&code=xyz").kind).toBe("recovery");
  });
  it("an EXPIRED / used link (error_code=otp_expired)", () => {
    const r = classifyAuthRedirect("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", "");
    expect(r.kind).toBe("expired_link");
  });
  it("an access_denied with an 'invalid or expired' description still classifies as expired", () => {
    const r = classifyAuthRedirect("#error=access_denied&error_description=Email+link+is+invalid+or+has+expired", "");
    expect(r.kind).toBe("expired_link");
  });
  it("a generic auth error is surfaced as 'error', not swallowed", () => {
    const r = classifyAuthRedirect("#error=server_error&error_description=Unexpected+failure", "");
    expect(r.kind).toBe("error");
  });
  it("a normal page load with no auth params => 'none'", () => {
    expect(classifyAuthRedirect("", "").kind).toBe("none");
    expect(classifyAuthRedirect("#", "?foo=bar").kind).toBe("none");
  });
  it("never throws on odd input", () => {
    expect(() => classifyAuthRedirect(null, undefined)).not.toThrow();
    expect(() => classifyAuthRedirect({}, [])).not.toThrow();
  });
});

/* ---------------- user-facing copy ---------------- */
describe("copy helpers", () => {
  it("resetEmailSentMessage does NOT confirm whether the account exists (non-enumerating)", () => {
    const m = resetEmailSentMessage();
    expect(m).toMatch(/if an account exists/i);
    expect(m).not.toMatch(/we (have|'ve) sent you an email\b(?!.*if)/i);
  });
  it("expiredLinkMessage explains + points to the next step", () => {
    const m = expiredLinkMessage();
    expect(m).toMatch(/expired|already been used/i);
    expect(m).toMatch(/email/i);
  });
  it("friendlyAuthError maps common raw errors and passes through the rest", () => {
    expect(friendlyAuthError("TypeError: Failed to fetch")).toMatch(/connection/i);
    expect(friendlyAuthError("For security purposes, you can only request this after 41 seconds")).toMatch(/wait/i);
    expect(friendlyAuthError("Invalid login credentials")).toMatch(/incorrect email or password/i);
    expect(friendlyAuthError("")).toBe("Something went wrong. Please try again.");
    expect(friendlyAuthError("Some already-friendly sentence.")).toBe("Some already-friendly sentence.");
  });
});
