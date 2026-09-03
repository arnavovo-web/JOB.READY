#!/usr/bin/env node
/* ================================================================== *
 * PHASE 36 — `npm run benchmark:deepseek`
 * ------------------------------------------------------------------
 * Thin, dependency-free, cross-platform launcher — same pattern as
 * scripts/evaluate-interview-invitations.mjs (Phase 8): sets
 * RUN_DEEPSEEK_BENCHMARK=1 in this process's own env and runs ONLY
 * src/deepseekBenchmarkLive.test.js through vitest, so App.jsx's JSX can be
 * loaded (vitest is this repo's only JSX-aware runtime) without adding a
 * separate loader/build step.
 *
 * Execution flags (not a change to any task/prompt/routing/validator):
 *   --no-file-parallelism + --poolOptions.forks.singleFork
 *       pin the whole run to ONE worker process, so each task's stdout
 *       block is printed contiguously instead of interleaving.
 *   --testTimeout=90000
 *       live provider calls take 20-30s+ each — far past vitest's 5s
 *       default. (The test file also sets this via vi.setConfig; passing
 *       it here too keeps a bare `npx vitest run ...` honest.)
 *
 * Requires ANTHROPIC_API_KEY (and, to see a real comparison rather than
 * Claude-only output, DEEPSEEK_API_KEY) already set in the environment —
 * this script does not read .env files itself. Neither key is read, echoed,
 * or logged by this launcher.
 * ================================================================== */
import { spawn } from "node:child_process";

let child;
try {
  child = spawn(
    "npx vitest run src/deepseekBenchmarkLive.test.js --no-file-parallelism --poolOptions.forks.singleFork --testTimeout=90000",
    { stdio: "inherit", shell: true, env: { ...process.env, RUN_DEEPSEEK_BENCHMARK: "1" } }
  );
} catch (err) {
  console.error("Failed to launch vitest for the DeepSeek benchmark:", err.message);
  process.exit(1);
}

child.on("exit", (code) => process.exit(code == null ? 1 : code));
child.on("error", (err) => {
  console.error("Failed to launch vitest for the DeepSeek benchmark:", err.message);
  process.exit(1);
});
