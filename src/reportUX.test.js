/* ================================================================== *
 * PHASE 2G — PRODUCTISATION / PRODUCTION HARDENING TEST SUITE
 * ------------------------------------------------------------------
 * Covers the changes made in the Phase 2G productisation pass:
 *   (1) claimStatusMeta/CLAIM_STATUS_META — the pure, exported helper
 *       that turns a candidate_claims.status value into a candidate-
 *       facing label/colour, now surfaced in the report and Progress
 *       screens (EXECUTABLE — a real exported function).
 *   (2) the report/Progress screens actually render a claims summary
 *       fed from already-hydrated state (candidateClaims/interview.
 *       transcript), never a new AI call or a new DB read (STRUCTURAL —
 *       same source-text-inspection convention liveWiring.test.js and
 *       candidateIntelligenceIntegration.test.js already established,
 *       since the render body is a React closure that can't be invoked
 *       directly in a unit test).
 *   (3) clearAllUserState resets every per-user field, including the
 *       Candidate Intelligence/Claims state that was previously missed
 *       (ownership-hygiene fix — see App.jsx's own comment).
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CLAIM_STATUS_META, claimStatusMeta } from "./App.jsx";
import { CLAIM_STATUSES } from "./candidateIntelligence.js";

const SOURCE = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function extractFunctionSource(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found in App.jsx: ${startMarker}`);
  const end = SOURCE.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`end marker not found in App.jsx: ${endMarker}`);
  return SOURCE.slice(start, end);
}

/* ============================== claimStatusMeta (EXECUTABLE) ============================== */
describe("claimStatusMeta", () => {
  it("has a candidate-facing label/colour for every real candidate_claims.status value", () => {
    CLAIM_STATUSES.forEach((status) => {
      const meta = claimStatusMeta(status);
      expect(meta).toBeTruthy();
      expect(typeof meta.label).toBe("string");
      expect(meta.label.length).toBeGreaterThan(0);
      expect(typeof meta.color).toBe("string");
      expect(typeof meta.bg).toBe("string");
    });
  });

  it("degrades to the 'unverified' meta for a missing/malformed/legacy status rather than throwing or returning undefined", () => {
    expect(claimStatusMeta(undefined)).toEqual(CLAIM_STATUS_META.unverified);
    expect(claimStatusMeta(null)).toEqual(CLAIM_STATUS_META.unverified);
    expect(claimStatusMeta("some_future_status_this_build_doesnt_know_about")).toEqual(CLAIM_STATUS_META.unverified);
  });

  it("never uses raw evidence-engine vocabulary (strong/moderate/weak/contradictory/insufficient) as a candidate-facing label — only the claim-status enum's own concepts", () => {
    Object.values(CLAIM_STATUS_META).forEach((meta) => {
      expect(meta.label).not.toMatch(/strong|moderate|weak|contradictory|insufficient/i);
    });
  });
});

/* ============================== Report screen wiring (STRUCTURAL) ============================== */
// Phase 3 (interview history): the claims-explored markup itself was extracted into the
// shared ReportBody component (so a reopened past report renders identical markup to the
// just-finished one) — these checks now target ReportBody's own definition rather than the
// "report" screen's JSX directly. The guarantee this suite protects is unchanged: the report
// screen still passes claimsTestedThisInterview in, and that section still only ever reads
// already-in-memory data.
describe("Report screen surfaces Candidate Claims (STRUCTURAL)", () => {
  const REPORT_SCREEN_SRC = extractFunctionSource('screen === "report" && report && (', 'screen === "report_view" && viewedReport && (');
  const REPORT_BODY_SRC = extractFunctionSource("function ReportBody(", "function AcScorecardBody(");

  it("the just-completed interview screen feeds claimsTestedThisInterview into the shared report body", () => {
    expect(REPORT_SCREEN_SRC).toMatch(/<ReportBody/);
    expect(REPORT_SCREEN_SRC).toMatch(/claimsTested=\{claimsTestedThisInterview\}/);
  });

  it("renders a claims-explored section using candidate-facing claim status labels", () => {
    expect(REPORT_BODY_SRC).toMatch(/claimsTested/);
    expect(REPORT_BODY_SRC).toMatch(/claimStatusMeta/);
  });

  it("never issues a new AI call or a new DB read to build that section — it's a plain array read of whatever claimsTested it's given", () => {
    const claimsSectionIdx = REPORT_BODY_SRC.indexOf("claimsTested.length > 0");
    expect(claimsSectionIdx).toBeGreaterThan(-1);
    const claimsSection = REPORT_BODY_SRC.slice(claimsSectionIdx, REPORT_BODY_SRC.indexOf("</Card>", claimsSectionIdx));
    expect(claimsSection).not.toMatch(/callClaude|getSupabase|\.from\(/);
  });

  it("only renders when there's something to show — no empty/placeholder card when no claim was targeted", () => {
    expect(REPORT_BODY_SRC).toMatch(/\{claimsTested\.length > 0 && \(/);
  });

  it("a reopened past report never claims to show claims tested — that linkage was never persisted, so it defaults to none rather than a guess", () => {
    const HISTORY_SCREEN_SRC = extractFunctionSource('screen === "report_view" && viewedReport && (', '{/* ---------------- PROGRESS');
    expect(HISTORY_SCREEN_SRC).toMatch(/<ReportBody/);
    expect(HISTORY_SCREEN_SRC).not.toMatch(/claimsTested=/);
  });
});

describe("Progress screen surfaces cross-interview Candidate Claims (STRUCTURAL)", () => {
  const PROGRESS_SCREEN_SRC = extractFunctionSource('screen === "progress" && (', '/* ---------------- CLASSROOM DASHBOARD');

  it("renders a claims overview sourced from candidateClaims, not a new fetch", () => {
    expect(PROGRESS_SCREEN_SRC).toMatch(/claimsOverview/);
    expect(PROGRESS_SCREEN_SRC).toMatch(/claimStatusMeta/);
  });

  it("only renders when the candidate actually has tracked claims", () => {
    expect(PROGRESS_SCREEN_SRC).toMatch(/\{claimsOverview\.length > 0 && \(/);
  });
});

describe("claimsTestedThisInterview/claimsOverview derivation (STRUCTURAL)", () => {
  const DERIVED_SRC = extractFunctionSource("/* ---------------- DERIVED VALUES ---------------- */", "if (!authChecked) {");

  it("matches on the question's own targetedClaimId, never re-deriving/guessing which claim a question targeted", () => {
    expect(DERIVED_SRC).toMatch(/t\.question\?\.targetedClaimId/);
  });

  it("dedupes by claim id (a claim can be targeted at most meaningfully once per interview's summary)", () => {
    const idx = DERIVED_SRC.indexOf("claimsTestedThisInterview");
    const block = DERIVED_SRC.slice(idx, DERIVED_SRC.indexOf("claimsOverview", idx));
    expect(block).toMatch(/seen\.has\(claimId\)/);
  });

  it("claimsOverview reads candidateClaims directly — never independent_batch/Assessment-Centre state", () => {
    const idx = DERIVED_SRC.indexOf("claimsOverview");
    const line = DERIVED_SRC.slice(idx, DERIVED_SRC.indexOf(";", idx) + 1);
    expect(line).toMatch(/candidateClaims/);
    expect(line).not.toMatch(/acAttempts|independent_batch/);
  });
});

/* ============================== clearAllUserState (STRUCTURAL) ============================== */
describe("clearAllUserState resets every per-user field (STRUCTURAL — ownership hygiene)", () => {
  const CLEAR_SRC = extractFunctionSource("function clearAllUserState()", "async function handleSignUp()");

  it("resets Candidate Intelligence/Claims state on sign-out (previously missing)", () => {
    expect(CLEAR_SRC).toMatch(/setCandidateClaims\(\[\]\)/);
    expect(CLEAR_SRC).toMatch(/setCandidateIntelligence\(null\)/);
  });

  it("resets in-flight interview/profile/report state too, so nothing from a signed-out session lingers in memory", () => {
    expect(CLEAR_SRC).toMatch(/setInterview\(null\)/);
    expect(CLEAR_SRC).toMatch(/setProfile\(null\)/);
    expect(CLEAR_SRC).toMatch(/setReport\(null\)/);
  });

  it("still routes to the landing screen, unchanged", () => {
    expect(CLEAR_SRC).toMatch(/setScreen\("landing"\)/);
  });
});
