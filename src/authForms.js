/* ================================================================== *
 * PHASE 23 — AUTHENTICATION UX HELPERS
 * ------------------------------------------------------------------
 * Pure, deterministic helpers for the auth screens (sign in / sign up /
 * forgot password / set new password). No React, no network, no
 * Supabase, no DOM — every function is a plain input→output transform
 * so the auth UX can be unit-tested without rendering or mocking auth.
 *
 * Nothing here ever logs, stores, or transmits a password. The
 * show/hide feature is expressed only as "which <input type> and which
 * accessible label corresponds to a boolean visibility flag".
 * ================================================================== */

export const PASSWORD_MIN_LENGTH = 8;

// ---- show / hide password --------------------------------------------
/**
 * passwordInputType(visible) -> "text" | "password"
 * The ONLY thing a visibility toggle may change on the field. The value
 * and the onChange handler are untouched, so the typed password is never
 * cleared or transformed by toggling.
 */
export function passwordInputType(visible) {
  return visible ? "text" : "password";
}

/**
 * visibilityToggleLabel(visible) -> accessible label for the toggle control.
 * When the password is hidden the control's action is "Show password";
 * when it is visible the action is "Hide password".
 */
export function visibilityToggleLabel(visible) {
  return visible ? "Hide password" : "Show password";
}

/** nextVisibility(current) -> toggled boolean (defensive against non-booleans). */
export function nextVisibility(current) {
  return !current;
}

// ---- validation ----------------------------------------------------
function str(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

// Intentionally permissive: real verification is Supabase's job. This only
// catches the obvious "that isn't an email" typo before a network round-trip.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * validateEmailForReset(email) -> { ok: boolean, error: string }
 * Trims + lower-cases nothing here (the caller does that for the API call);
 * this only reports whether it's worth sending at all.
 */
export function validateEmailForReset(email) {
  const e = str(email).trim();
  if (!e) return { ok: false, error: "Enter your email address." };
  if (!EMAIL_SHAPE.test(e)) return { ok: false, error: "Enter a valid email address." };
  return { ok: true, error: "" };
}

/**
 * validateNewPassword(password, confirm) -> { ok: boolean, error: string }
 * Used by BOTH sign-up and the set-new-password screen: non-empty, at least
 * PASSWORD_MIN_LENGTH characters, and the confirmation must match exactly.
 */
export function validateNewPassword(password, confirm) {
  const p = str(password);
  const c = str(confirm);
  if (!p) return { ok: false, error: "Enter a new password." };
  if (p.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (p !== c) return { ok: false, error: "Passwords don't match." };
  return { ok: true, error: "" };
}

// ---- password-reset redirect strategy -----------------------------
/**
 * passwordResetRedirectTo(origin) -> string
 *
 * The URL Supabase should send the user back to after they click the reset
 * link in their email. This app is a single-page app served at the site
 * root with client-side (React-state) navigation and `detectSessionInUrl`
 * enabled — so the recovery link only has to land back on the SAME ORIGIN
 * the request was made from; the app then detects `type=recovery` in the
 * URL and routes to the "set a new password" screen itself.
 *
 * Using the live `window.location.origin` means this resolves correctly and
 * automatically for every environment — local dev, each Vercel preview, and
 * the eventual production domain — with NO hardcoded host. (Each origin must
 * be added to Supabase Auth's allowed "Redirect URLs" list; see the phase
 * report.) Returns "" when origin is missing so the caller can omit the
 * option and let Supabase fall back to its configured Site URL.
 */
export function passwordResetRedirectTo(origin) {
  const o = str(origin).trim().replace(/\/+$/, "");
  if (!o || !/^https?:\/\//i.test(o)) return "";
  return o;
}

// ---- recovery-link classification --------------------------------
/**
 * classifyAuthRedirect(hash, search) -> { kind, code, description }
 *   kind: "recovery"      — a valid password-recovery return (type=recovery)
 *         "expired_link"   — Supabase reported the link invalid/expired/used
 *         "error"          — some other auth error param is present
 *         "none"           — nothing auth-related in the URL
 *
 * Supabase appends its result to the redirect URL: a good recovery link
 * carries `type=recovery` (+ tokens); a bad one carries
 * `error=access_denied&error_code=otp_expired&error_description=...` (usually
 * in the hash for the implicit flow, sometimes the query string for PKCE).
 * We read BOTH so the app can show a real message instead of a blank screen.
 */
export function classifyAuthRedirect(hash, search) {
  const blob = `${str(hash)}&${str(search)}`.replace(/^#/, "");
  const params = new URLSearchParams(blob.replace(/^[#?]/, "").replace(/#/g, "&"));
  const errorCode = str(params.get("error_code")).toLowerCase();
  const error = str(params.get("error")).toLowerCase();
  const description = str(params.get("error_description")).replace(/\+/g, " ").trim();

  if (/type=recovery/.test(blob) && !error) {
    return { kind: "recovery", code: "", description: "" };
  }
  const expiredCodes = ["otp_expired", "invalid_otp", "token_expired", "flow_state_expired", "bad_oauth_state"];
  const looksExpired =
    expiredCodes.includes(errorCode) ||
    (error === "access_denied" && (!errorCode || /expire|invalid|used/.test(description.toLowerCase()))) ||
    /expire|invalid|used/.test(description.toLowerCase());
  if (looksExpired) return { kind: "expired_link", code: errorCode || error, description };
  if (error || errorCode) return { kind: "error", code: errorCode || error, description };
  return { kind: "none", code: "", description: "" };
}

/**
 * isRecoveryErrorRedirect(redirectClass) -> boolean
 * True when classifyAuthRedirect determined this page load came from an
 * invalid / expired / errored password-recovery link — i.e. the app must
 * deliberately show the "request a new link" screen and hold it there.
 */
export function isRecoveryErrorRedirect(redirectClass) {
  const kind = redirectClass && redirectClass.kind;
  return kind === "expired_link" || kind === "error";
}

/**
 * suppressLandingRedirectOnSignedOut(recoveryErrorActive) -> boolean
 *
 * PHASE 23A. When Supabase fails to recover a stale session from storage at
 * startup it emits a "SIGNED_OUT" event from inside its own initialize(). If
 * the app has just deliberately routed to the expired/invalid recovery-link
 * screen, the SIGNED_OUT handler must clear per-user state for hygiene but must
 * NOT run setScreen("landing") — otherwise the user is silently dropped onto
 * the ordinary logged-out landing page with no explanation.
 *
 * A user-initiated sign-out (handleSignOut) and an ordinary signed-out startup
 * both pass `false` here, so landing navigation is unaffected for them.
 */
export function suppressLandingRedirectOnSignedOut(recoveryErrorActive) {
  return recoveryErrorActive === true;
}

// ---- user-facing copy -------------------------------------------
/**
 * resetEmailSentMessage() -> a deliberately NON-ENUMERATING success line.
 * It does not confirm whether an account exists for the address — matching
 * Supabase's own secure default (resetPasswordForEmail resolves the same way
 * either way).
 */
export function resetEmailSentMessage() {
  return "If an account exists for that email, we've sent a link to reset your password. Check your inbox (and spam).";
}

/** Copy for the "your reset link didn't work" state — always offers a way forward. */
export function expiredLinkMessage() {
  return "That password reset link has expired or has already been used. Enter your email below and we'll send a new one.";
}

/**
 * friendlyAuthError(rawMessage) -> string
 * Maps the noisier Supabase / network error strings to something a user can
 * act on. Anything unrecognised is passed through (already reasonably worded)
 * or falls back to a generic line.
 */
export function friendlyAuthError(rawMessage, fallback = "Something went wrong. Please try again.") {
  const m = str(rawMessage).trim();
  if (!m) return fallback;
  const l = m.toLowerCase();
  if (/failed to fetch|networkerror|network request failed|load failed/.test(l)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (/rate limit|too many requests|for security purposes|only request this after/.test(l)) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (/invalid login credentials|invalid credentials/.test(l)) {
    return "Incorrect email or password.";
  }
  if (/user already registered|already been registered/.test(l)) {
    return "An account with that email already exists. Try signing in instead.";
  }
  if (/email not confirmed/.test(l)) {
    return "Please confirm your email address first — check your inbox for the confirmation link.";
  }
  if (/new password should be different/.test(l)) {
    return "Your new password must be different from your current one.";
  }
  return m;
}
