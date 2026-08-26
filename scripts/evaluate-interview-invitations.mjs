#!/usr/bin/env node
/* ================================================================== *
 * PHASE 8 — `npm run evaluate:interview-invitations`
 * ------------------------------------------------------------------
 * Thin, dependency-free, cross-platform launcher: sets
 * RUN_LIVE_INVITATION_EVAL=1 (in this process's own env, not via shell
 * syntax, so it works identically on Windows/macOS/Linux without adding a
 * devDependency like cross-env) and runs ONLY
 * src/invitationScannerLiveEvaluation.test.js through vitest.
 *
 * Requires INVITATION_EVAL_EMAIL / INVITATION_EVAL_PASSWORD and
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY to already be set in the
 * environment (see .env.example) — this script does not read .env files
 * itself; use your shell/CI's own mechanism for loading them first.
 * ================================================================== */
import { spawn } from "node:child_process";

// shell: true is required on Windows to locate/execute npx.cmd (a plain, non-shell spawn of a
// .cmd file throws EINVAL on current Node). Passed as a single fixed command STRING (no argv
// array) — the recommended shell:true form, and it avoids Node's "args aren't escaped"
// deprecation warning, which only fires when shell:true is combined with an argv array. Safe
// either way: every token here is a fixed literal, never untrusted/user-supplied input.
let child;
try {
  child = spawn(
    "npx vitest run src/invitationScannerLiveEvaluation.test.js",
    { stdio: "inherit", shell: true, env: { ...process.env, RUN_LIVE_INVITATION_EVAL: "1" } }
  );
} catch (err) {
  console.error("Failed to launch vitest for the live invitation evaluation:", err.message);
  process.exit(1);
}

child.on("exit", (code) => process.exit(code == null ? 1 : code));
child.on("error", (err) => {
  console.error("Failed to launch vitest for the live invitation evaluation:", err.message);
  process.exit(1);
});
