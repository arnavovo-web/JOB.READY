/* ================================================================== *
 * PHASE 23 — AUTH UX WIRING (STRUCTURAL, over src/App.jsx)
 * ------------------------------------------------------------------
 * The test env is node (no DOM), so the React behaviour of PasswordInput
 * is unit-tested via authForms.js; here we assert that App.jsx actually
 * WIRES it in: every password field uses the toggle component, the
 * forgot-password flow has a redirect strategy + in-flight guard +
 * success + expired-link handling, and no real reset email is sent from
 * a test.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const loginStart = SRC.indexOf('{screen === "login" && ');
const loginEnd = SRC.indexOf("{/* ---------------- DASHBOARD ----------------", loginStart);
const LOGIN = SRC.slice(loginStart, loginEnd);

/* ---------------- FIX 1: show / hide password ---------------- */
describe("Phase 23 FIX 1 — every password input uses the PasswordInput toggle", () => {
  it("a reusable PasswordInput component exists with its OWN visibility state", () => {
    expect(SRC).toMatch(/function PasswordInput\(/);
    const comp = SRC.slice(SRC.indexOf("function PasswordInput("), SRC.indexOf("function PasswordInput(") + 1400);
    expect(comp).toMatch(/const \[visible, setVisible\] = useState\(false\)/);   // masked by default, per-instance
    expect(comp).toMatch(/type=\{passwordInputType\(visible\)\}/);               // toggles ONLY the input type
    expect(comp).toMatch(/aria-label=\{label\}/);                               // accessible label
    expect(comp).toMatch(/aria-pressed=\{visible\}/);
    expect(comp).toMatch(/<button\s+type="button"/);                            // real button => keyboard-operable
    // value / onChange pass straight through (typed password is never cleared)
    expect(comp).toMatch(/value=\{value\}/);
    expect(comp).toMatch(/onChange=\{onChange\}/);
  });

  it("no bare <input type=\"password\"> remains anywhere in App.jsx", () => {
    expect(SRC).not.toMatch(/<input[^>]*type="password"/);
  });

  it("all five auth password fields render through PasswordInput", () => {
    for (const id of [
      "signup-password", "signup-confirm-password",
      "signin-password",
      "reset-password", "reset-confirm-password",
    ]) {
      expect(LOGIN).toMatch(new RegExp(`<PasswordInput id="${id}"`));
    }
  });

  it("the toggle never logs / stores the password", () => {
    const comp = SRC.slice(SRC.indexOf("function PasswordInput("), SRC.indexOf("function PasswordInput(") + 1400);
    expect(comp).not.toMatch(/console\.|localStorage|sessionStorage|fetch\(/);
  });
});

/* ---------------- FIX 2: forgot-password flow ---------------- */
describe("Phase 23 FIX 2 — forgot-password journey", () => {
  it("a visible 'Forgot password?' entry point sits on the sign-in view", () => {
    const signin = LOGIN.slice(LOGIN.indexOf('authView === "signin"'), LOGIN.indexOf('authView === "forgot"'));
    expect(signin).toMatch(/Forgot password\?/);
    expect(signin).toMatch(/setAuthView\("forgot"\)|goAuth\("forgot"\)/);
  });

  it("handleForgotPassword validates the email, guards against duplicate submits, and uses an origin-based redirect", () => {
    const fn = SRC.slice(SRC.indexOf("async function handleForgotPassword()"), SRC.indexOf("async function handleResetPassword()"));
    expect(fn).toMatch(/validateEmailForReset\(emailInput\)/);
    expect(fn).toMatch(/if \(authBusy\) return/);                 // no double submit
    expect(fn).toMatch(/setAuthBusy\(true\)/);
    expect(fn).toMatch(/finally\s*\{\s*setAuthBusy\(false\)/);
    expect(fn).toMatch(/passwordResetRedirectTo\(typeof window[^)]*window\.location\.origin/);
    expect(fn).toMatch(/resetPasswordForEmail\(/);
    expect(fn).toMatch(/redirectTo \? \{ redirectTo \} : undefined/);
    // non-enumerating success state
    expect(fn).toMatch(/setResetEmailSent\(true\)/);
    expect(fn).toMatch(/resetEmailSentMessage\(\)/);
  });

  it("NO hardcoded deploy URL is used as the reset redirect target", () => {
    const fn = SRC.slice(SRC.indexOf("async function handleForgotPassword()"), SRC.indexOf("async function handleResetPassword()"));
    expect(fn).not.toMatch(/vercel\.app|https?:\/\/[a-z0-9-]+\.(com|app|dev|io)/i);
  });

  it("the forgot view renders a clear success state and a loading label", () => {
    const forgot = LOGIN.slice(LOGIN.indexOf('authView === "forgot"'), LOGIN.indexOf('authView === "reset"'));
    expect(forgot).toMatch(/resetEmailSent \?/);
    expect(forgot).toMatch(/Check your email/);
    expect(forgot).toMatch(/disabled=\{authBusy\}/);
    expect(forgot).toMatch(/authBusy \? "Sending…"/);
    // a way back / a way to retry with a different address
    expect(forgot).toMatch(/Use a different email/);
    expect(forgot).toMatch(/Back to sign in/);
  });
});

describe("Phase 23 FIX 2 — reset-password screen", () => {
  const reset = LOGIN.slice(LOGIN.indexOf('authView === "reset"'), LOGIN.lastIndexOf("</div>"));

  it("clearly indicates the user is setting a NEW password via a valid link", () => {
    expect(reset).toMatch(/Set a new password/);
    expect(reset).toMatch(/valid password-reset link/i);
  });
  it("has New + Confirm password fields with show/hide, and a route back", () => {
    expect(reset).toMatch(/<PasswordInput id="reset-password"/);
    expect(reset).toMatch(/<PasswordInput id="reset-confirm-password"/);
    expect(reset).toMatch(/Cancel/);
  });
  it("handleResetPassword validates match+length, guards busy, and updates via Supabase", () => {
    const fn = SRC.slice(SRC.indexOf("async function handleResetPassword()"), SRC.indexOf("async function handleSignOut()"));
    expect(fn).toMatch(/validateNewPassword\(passwordInput, confirmPasswordInput\)/);
    expect(fn).toMatch(/if \(authBusy\) return/);
    expect(fn).toMatch(/updateUser\(\{ password: passwordInput \}\)/);
    expect(fn).toMatch(/setAuthBusy\(false\)/);
    // no live session (expired/used/other browser) => send them to request a fresh link, not a raw error
    expect(fn).toMatch(/if \(!current\?\.session\)/);
    expect(fn).toMatch(/expiredLinkMessage\(\)/);
  });
});

describe("Phase 23 FIX 2 — invalid / expired recovery link", () => {
  it("the auth effect classifies the redirect and routes a dead link to a recoverable state", () => {
    const eff = SRC.slice(SRC.indexOf("/* ---------------- AUTH (real Supabase Auth) ---------------- */"), SRC.indexOf("async function onAuthed("));
    expect(eff).toMatch(/classifyAuthRedirect\(window\.location\.hash, window\.location\.search\)/);
    // Phase 23A: the expired/error branch is now gated by isRecoveryErrorRedirect()
    expect(eff).toMatch(/isRecoveryErrorRedirect\(redirectClass\)/);
    expect(eff).toMatch(/setAuthView\("forgot"\)/);
    expect(eff).toMatch(/expiredLinkMessage\(\)/);
    // scrub the error params so a refresh is clean (no blank screen / raw error left in the URL)
    expect(eff).toMatch(/history\.replaceState\(null, "", window\.location\.pathname\)/);
  });
});

/* ---------------- test hygiene ---------------- */
describe("Phase 23 — no real reset email is triggered by tests", () => {
  it("neither new test file calls resetPasswordForEmail / a live Supabase client", () => {
    const a = readFileSync(new URL("./authForms.test.js", import.meta.url), "utf8");
    const b = readFileSync(new URL("./phase23AuthUx.test.js", import.meta.url), "utf8");
    for (const t of [a, b]) {
      expect(t).not.toMatch(/resetPasswordForEmail\(|createClient\(|supabase\.auth\./);
    }
  });
});
