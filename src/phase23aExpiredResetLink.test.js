/* ================================================================== *
 * PHASE 23A — EXPIRED / INVALID PASSWORD-RESET LINK: RACE REGRESSION
 * ------------------------------------------------------------------
 * CONFIRMED BUG (reproduced live): when the app loads from a dead
 * recovery URL (#error=access_denied&error_code=otp_expired...) AND a
 * stale Supabase session sits in storage, Supabase's own initialize()
 * fails to refresh that token (HTTP 400) and fires a spurious
 * "SIGNED_OUT". The old SIGNED_OUT handler called clearAllUserState()
 * unconditionally, whose last line is setScreen("landing") — silently
 * overwriting the expired-link screen the bootstrap had just routed to.
 *
 * The test env is node (no DOM / no React render), so this models the
 * exact control-flow interaction with a tiny state machine that uses the
 * REAL classifier + the REAL Phase 23A predicates. `applyFix` toggles
 * old vs new behaviour: the regression assertions FAIL for applyFix=false
 * (old) and PASS for applyFix=true (new).
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  classifyAuthRedirect, isRecoveryErrorRedirect, suppressLandingRedirectOnSignedOut,
  expiredLinkMessage,
} from "./authForms.js";

const APP_SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

/* ---- faithful model of App.jsx's auth bootstrap + SIGNED_OUT path ----
 * Every line here corresponds 1:1 to code in App.jsx's auth useEffect,
 * clearAllUserState, and goAuth. `applyFix` = false reproduces the pre-23A
 * behaviour (SIGNED_OUT always navigates to landing).
 */
function makeApp({ applyFix }) {
  const app = {
    screen: "landing",
    authView: "signin",
    error: "",
    userDataCleared: 0,
    recoveryErrorActive: false,   // App.jsx: recoveryErrorRef.current
    isRecoveryLink: false,        // App.jsx: const isRecoveryLink = redirectClass.kind === "recovery"
  };

  // App.jsx: clearAllUserState({ keepAuthScreen }) — wipe per-user state, then
  // `if (!keepAuthScreen) setScreen("landing")`.
  function clearAllUserState({ keepAuthScreen = false } = {}) {
    app.userDataCleared += 1;
    if (!keepAuthScreen) app.screen = "landing";
  }

  // App.jsx: the synchronous top of the auth useEffect.
  function bootstrapSync(hash, search) {
    const redirectClass = classifyAuthRedirect(hash, search);
    app.isRecoveryLink = redirectClass.kind === "recovery";
    if (isRecoveryErrorRedirect(redirectClass)) {
      if (applyFix) app.recoveryErrorActive = true;   // recoveryErrorRef.current = true
      app.screen = "login";
      app.authView = "forgot";
      app.error = expiredLinkMessage();
    }
    return redirectClass;
  }

  // App.jsx: the onAuthStateChange(event, newSession) handler.
  function onAuthEvent(event, hasSession) {
    if (event === "SIGNED_OUT") {
      const keepAuthScreen = applyFix
        ? suppressLandingRedirectOnSignedOut(app.recoveryErrorActive)
        : false;                                       // OLD: clearAllUserState() with no arg
      clearAllUserState({ keepAuthScreen });
      return;
    }
    if (event === "PASSWORD_RECOVERY" || (app.isRecoveryLink && hasSession)) {
      app.screen = "login";
      app.authView = "reset";
      return;
    }
    // (newSession -> onAuthed) is not exercised by these scenarios
  }

  // App.jsx: goAuth(view) — clears the recovery guard + resets sub-state.
  function goAuth(view) {
    app.recoveryErrorActive = false;
    app.error = "";
    app.authView = view;
  }

  return { app, bootstrapSync, onAuthEvent, clearAllUserState, goAuth };
}

const DEAD_LINK_HASH = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";

/* ================== TEST A — expired recovery link ================== */
describe("Test A — expired recovery link + spurious startup SIGNED_OUT", () => {
  // The fail-old / pass-new regression contract, run against BOTH behaviours:
  // the identical assertion holds only when the Phase 23A guard is applied.
  it.each([
    { applyFix: false, expectedScreenAfterSignedOut: "landing" }, // OLD = the bug
    { applyFix: true, expectedScreenAfterSignedOut: "login" },    // NEW = fixed
  ])("SIGNED_OUT during expired-link bootstrap -> screen '$expectedScreenAfterSignedOut' (applyFix=$applyFix)", ({ applyFix, expectedScreenAfterSignedOut }) => {
    const { app, bootstrapSync, onAuthEvent } = makeApp({ applyFix });
    bootstrapSync(DEAD_LINK_HASH, "");
    expect(app.screen).toBe("login");                 // both: routed correctly at first
    expect(app.authView).toBe("forgot");
    onAuthEvent("SIGNED_OUT", false);                 // Supabase init fails to refresh a stale token
    expect(app.screen).toBe(expectedScreenAfterSignedOut);
  });

  it("REGRESSION GUARD: the fixed behaviour's assertion would FAIL on the old flow", () => {
    const old = makeApp({ applyFix: false });
    old.bootstrapSync(DEAD_LINK_HASH, "");
    old.onAuthEvent("SIGNED_OUT", false);
    // this is exactly what the FIXED test below asserts — proving it is a real regression test
    expect(old.app.screen).not.toBe("login");
  });

  it("FIXED: the expired-link recovery UI stays visible through the SIGNED_OUT", () => {
    const { app, bootstrapSync, onAuthEvent } = makeApp({ applyFix: true });
    bootstrapSync(DEAD_LINK_HASH, "");
    expect(app.screen).toBe("login");
    expect(app.authView).toBe("forgot");
    expect(app.error).toBe(expiredLinkMessage());

    onAuthEvent("SIGNED_OUT", false);                 // same spurious event

    expect(app.screen).toBe("login");                 // NOT overwritten
    expect(app.authView).toBe("forgot");              // still the recovery form
    expect(app.error).toBe(expiredLinkMessage());     // still explained
    expect(app.userDataCleared).toBeGreaterThan(0);   // hygiene still ran
  });

  it("FIXED: still holds if SIGNED_OUT fires twice (BroadcastChannel / StrictMode)", () => {
    const { app, bootstrapSync, onAuthEvent } = makeApp({ applyFix: true });
    bootstrapSync(DEAD_LINK_HASH, "");
    onAuthEvent("SIGNED_OUT", false);
    onAuthEvent("SIGNED_OUT", false);
    expect(app.screen).toBe("login");
    expect(app.authView).toBe("forgot");
  });

  it("FIXED: query-string (PKCE) form of the dead link is handled the same way", () => {
    const { app, bootstrapSync, onAuthEvent } = makeApp({ applyFix: true });
    bootstrapSync("", "?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    onAuthEvent("SIGNED_OUT", false);
    expect(app.screen).toBe("login");
    expect(app.authView).toBe("forgot");
  });

  it("FIXED: the recovery screen offers a next action — Back to sign in clears the guard", () => {
    const { app, bootstrapSync, onAuthEvent, goAuth } = makeApp({ applyFix: true });
    bootstrapSync(DEAD_LINK_HASH, "");
    onAuthEvent("SIGNED_OUT", false);
    goAuth("signin");                                 // user clicks "Back to sign in"
    expect(app.authView).toBe("signin");
    expect(app.recoveryErrorActive).toBe(false);      // guard released
    // a later stray SIGNED_OUT now behaves normally again
    onAuthEvent("SIGNED_OUT", false);
    expect(app.screen).toBe("landing");
  });
});

/* ================== TEST B — ordinary signed-out startup ================== */
describe("Test B — ordinary signed-out startup is unaffected", () => {
  it("no recovery params: a startup SIGNED_OUT still lands on the landing page", () => {
    for (const applyFix of [false, true]) {
      const { app, bootstrapSync, onAuthEvent } = makeApp({ applyFix });
      const rc = bootstrapSync("", "");
      expect(rc.kind).toBe("none");
      expect(app.recoveryErrorActive).toBe(false);
      onAuthEvent("SIGNED_OUT", false);              // e.g. a stale token failed to refresh
      expect(app.screen).toBe("landing");           // normal
      expect(app.authView).toBe("signin");
    }
  });

  it("a plain landing visit with no auth event stays on landing", () => {
    const { app, bootstrapSync } = makeApp({ applyFix: true });
    bootstrapSync("", "");
    expect(app.screen).toBe("landing");
  });
});

/* ================== TEST C — successful recovery still works ================== */
describe("Test C — a VALID recovery link still reaches Set New Password", () => {
  it("type=recovery is not treated as an error and routes to authView 'reset'", () => {
    const { app, bootstrapSync, onAuthEvent } = makeApp({ applyFix: true });
    const rc = bootstrapSync("#access_token=abc&type=recovery&expires_in=3600&refresh_token=r", "");
    expect(rc.kind).toBe("recovery");
    expect(isRecoveryErrorRedirect(rc)).toBe(false);
    expect(app.recoveryErrorActive).toBe(false);     // guard NOT engaged for a good link
    onAuthEvent("PASSWORD_RECOVERY", true);          // Supabase established the recovery session
    expect(app.screen).toBe("login");
    expect(app.authView).toBe("reset");
  });

  it("STRUCTURAL: the real recovery routing in App.jsx is untouched by this fix", () => {
    // valid-recovery branch still keys on PASSWORD_RECOVERY / isRecoveryLink+session
    expect(APP_SRC).toMatch(/if \(event === "PASSWORD_RECOVERY" \|\| \(isRecoveryLink && newSession\)\)/);
    expect(APP_SRC).toMatch(/setScreen\("login"\); setAuthView\("reset"\);/);
    // and the isRecoveryLink flag is still derived from the "recovery" classification
    expect(APP_SRC).toMatch(/const isRecoveryLink = redirectClass\.kind === "recovery"/);
  });
});

/* ================== TEST D — explicit normal sign-out ================== */
describe("Test D — explicit user sign-out returns to landing", () => {
  it("handleSignOut path: clearAllUserState() with no guard navigates to landing", () => {
    const { app, clearAllUserState } = makeApp({ applyFix: true });
    app.screen = "dashboard";
    clearAllUserState();                              // handleSignOut calls it with no args
    expect(app.screen).toBe("landing");
  });

  it("the SIGNED_OUT event after a real sign-out (no recovery guard) also lands", () => {
    const { app, onAuthEvent } = makeApp({ applyFix: true });
    app.screen = "dashboard";
    app.recoveryErrorActive = false;                 // real sign-out never sets this
    onAuthEvent("SIGNED_OUT", false);
    expect(app.screen).toBe("landing");
    expect(app.userDataCleared).toBeGreaterThan(0);
  });

  it("STRUCTURAL: handleSignOut still calls clearAllUserState() directly (unchanged)", () => {
    const fn = APP_SRC.slice(APP_SRC.indexOf("async function handleSignOut()"), APP_SRC.indexOf("async function handleSignOut()") + 400);
    expect(fn).toMatch(/clearAllUserState\(\)/);
    expect(fn).not.toMatch(/keepAuthScreen/);
  });
});

/* ================== predicates + wiring ================== */
describe("Phase 23A predicates and App.jsx wiring", () => {
  it("isRecoveryErrorRedirect: expired_link and error => true; recovery / none => false", () => {
    expect(isRecoveryErrorRedirect({ kind: "expired_link" })).toBe(true);
    expect(isRecoveryErrorRedirect({ kind: "error" })).toBe(true);
    expect(isRecoveryErrorRedirect({ kind: "recovery" })).toBe(false);
    expect(isRecoveryErrorRedirect({ kind: "none" })).toBe(false);
    expect(isRecoveryErrorRedirect(null)).toBe(false);
  });

  it("suppressLandingRedirectOnSignedOut: only true for an active recovery-error", () => {
    expect(suppressLandingRedirectOnSignedOut(true)).toBe(true);
    expect(suppressLandingRedirectOnSignedOut(false)).toBe(false);
    expect(suppressLandingRedirectOnSignedOut(undefined)).toBe(false);
  });

  it("STRUCTURAL: App.jsx clearAllUserState honours keepAuthScreen and the SIGNED_OUT handler passes the guard", () => {
    expect(APP_SRC).toMatch(/function clearAllUserState\(\{ keepAuthScreen = false \} = \{\}\)/);
    expect(APP_SRC).toMatch(/if \(!keepAuthScreen\) setScreen\("landing"\)/);
    expect(APP_SRC).toMatch(/clearAllUserState\(\{ keepAuthScreen: suppressLandingRedirectOnSignedOut\(recoveryErrorRef\.current\) \}\)/);
    expect(APP_SRC).toMatch(/const recoveryErrorRef = useRef\(false\)/);
    expect(APP_SRC).toMatch(/recoveryErrorRef\.current = true/);       // set on expired-link route
    expect(APP_SRC).toMatch(/recoveryErrorRef\.current = false/);      // cleared on goAuth / onAuthed
  });

  it("STRUCTURAL: no leftover debug tracing", () => {
    expect(APP_SRC).not.toMatch(/\[TRACE\]|console\.log\(/);
  });
});
