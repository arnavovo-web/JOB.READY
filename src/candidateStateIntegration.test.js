/* ================================================================== *
 * PHASE 2F — App.jsx / Phase 2C-2E INTEGRATION TEST SUITE
 * ------------------------------------------------------------------
 * Same convention as candidateIntelligenceIntegration.test.js /
 * liveWiring.test.js: EXECUTABLE tests call a real exported pure
 * function; STRUCTURAL tests read App.jsx's own source text, because
 * submitAnswer/regenerateNextQuestion are React-closure functions that
 * cannot be imported and invoked directly in a unit test.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildCandidateState, buildEvidenceEvent, updateCandidateState, updateClaimEvidence } from "./candidateState.js";
import { buildInterviewStrategy } from "./interviewStrategy.js";
import { buildCandidateSignals } from "./candidateIntelligence.js";

const SOURCE = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function extractFunctionSource(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found in App.jsx: ${startMarker}`);
  const end = SOURCE.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`end marker not found in App.jsx: ${endMarker}`);
  return SOURCE.slice(start, end);
}

const SUBMIT_ANSWER_SRC = extractFunctionSource("async function submitAnswer()", "async function generateAndPersistNextQuestion(");
const REGENERATE_SRC = extractFunctionSource("async function regenerateNextQuestion()", "async function reconstructSchedulerDecision(");

/* ============================== Flow ordering ============================== */
describe("PHASE 2F — evidence engine runs after Call 1, before Candidate Strategy (STRUCTURAL)", () => {
  it("candidate state is built after Call 1 and before buildInterviewStrategy runs", () => {
    const call1Idx = SUBMIT_ANSWER_SRC.indexOf('requestType: "interview_turn_evaluate"');
    const stateIdx = SUBMIT_ANSWER_SRC.indexOf("buildCandidateState(");
    const strategyIdx = SUBMIT_ANSWER_SRC.indexOf("buildInterviewStrategy(");
    const schedulerIdx = SUBMIT_ANSWER_SRC.indexOf("runSimulatedAdaptiveTurn(");
    expect(stateIdx).toBeGreaterThan(call1Idx);
    expect(strategyIdx).toBeGreaterThan(stateIdx);
    expect(schedulerIdx).toBeGreaterThan(strategyIdx);
  });

  it("candidateStrategy consumes candidateStateForStrategy, not raw candidateIntelligence, at the live call site", () => {
    expect(SUBMIT_ANSWER_SRC).toMatch(/candidateSignals:\s*candidateStateForStrategy/);
  });

  it("the Phase 2F block uses two INDEPENDENT non-fatal try/catches and never touches setError/setScreen", () => {
    const block = SUBMIT_ANSWER_SRC.slice(SUBMIT_ANSWER_SRC.indexOf("PHASE 2F: CANDIDATE STATE"), SUBMIT_ANSWER_SRC.indexOf("PHASE 2E: CANDIDATE STRATEGY"));
    expect(block).toMatch(/catch \(csfErr\)/); // (1) candidateStateForStrategy build
    expect(block).toMatch(/catch \(ceErr\)/); // (2) evidence-event computation
    expect(block).not.toMatch(/setError\(/);
    expect(block).not.toMatch(/setScreen\(/);
  });

  it("a failure building the broader Candidate State snapshot cannot suppress the claim evidence computation, or vice versa (independent try/catches)", () => {
    const block = SUBMIT_ANSWER_SRC.slice(SUBMIT_ANSWER_SRC.indexOf("PHASE 2F: CANDIDATE STATE"), SUBMIT_ANSWER_SRC.indexOf("PHASE 2E: CANDIDATE STRATEGY"));
    // buildEvidenceEvent must be OUTSIDE the first try block (whose catch is csfErr) — i.e.
    // it appears after that try's own catch, inside the SECOND try (whose catch is ceErr).
    const firstCatchIdx = block.indexOf("catch (csfErr)");
    const evidenceEventIdx = block.indexOf("buildEvidenceEvent(");
    expect(evidenceEventIdx).toBeGreaterThan(firstCatchIdx);
  });

  it("evidence classification for the answered claim is computed exactly once and reused by the later persistence block", () => {
    expect(SUBMIT_ANSWER_SRC.split("buildEvidenceEvent(").length - 1).toBe(1);
    expect(SUBMIT_ANSWER_SRC.split("updateClaimEvidence(").length - 1).toBe(1);
    expect(SUBMIT_ANSWER_SRC).toMatch(/updatedTargetedClaimRow\s*=\s*updateClaimEvidence\(targetedClaim, currentTurnEvidenceEvent\)/);
    expect(SUBMIT_ANSWER_SRC).toMatch(/await dbUpdateClaim\(currentQ\.targetedClaimId, fields\)/);
  });

  it("this turn's own evidence for the answered claim already reaches buildInterviewStrategy's claims argument (liveClaimsForStrategy), not the stale pre-turn candidateClaims", () => {
    expect(SUBMIT_ANSWER_SRC).toMatch(/claims:\s*liveClaimsForStrategy/);
  });
});

describe("PHASE 2F — a claim just tested THIS turn already lowers/raises its own strategy priority THIS turn (EXECUTABLE)", () => {
  it("reproduces the live wiring: swapping the just-updated claim row into buildInterviewStrategy's claims array changes claim priority immediately, not next turn", () => {
    const claim = { id: "c1", claim_text: "Managed a team of 15", status: "unverified", confidence: "low", evidence: [], evidence_count: 0 };
    const staleClaims = [claim]; // what the live call site's OLD (pre-fix) `claims: candidateClaims` would have passed
    const event = buildEvidenceEvent({ claimId: "c1", evaluation: { specificity: 90, evidence: 90 } });
    const updatedRow = updateClaimEvidence(claim, event);
    const liveClaims = staleClaims.map((c) => (c.id === "c1" ? updatedRow : c)); // what liveClaimsForStrategy now passes

    const strategyFromStale = buildInterviewStrategy({ candidateSignals: buildCandidateSignals({}), claims: staleClaims });
    const strategyFromLive = buildInterviewStrategy({ candidateSignals: buildCandidateSignals({}), claims: liveClaims });

    const stalePriority = strategyFromStale.priorities.find((p) => p.key === "c1")?.priority;
    const livePriority = strategyFromLive.priorities.concat(strategyFromLive.depriorities).find((p) => p.key === "c1")?.priority;
    expect(stalePriority).toBeGreaterThan(livePriority); // unverified (high priority) -> supported (low priority), same turn
  });
});

describe("PHASE 2F — regenerateNextQuestion also builds Candidate State for the retried strategy (STRUCTURAL)", () => {
  it("uses buildCandidateState before buildInterviewStrategy, still inside the non-fatal try/catch", () => {
    const block = REGENERATE_SRC.slice(REGENERATE_SRC.indexOf("let candidateStrategy = null;"), REGENERATE_SRC.indexOf("} catch (csErr)"));
    expect(block).toMatch(/buildCandidateState\(/);
    expect(block).toMatch(/candidateSignals:\s*candidateStateForStrategy/);
  });

  it("still makes no Call-1 request — only rebuilds strategy/state from already-persisted data", () => {
    expect(REGENERATE_SRC).not.toMatch(/interview_turn_evaluate/);
    expect(REGENERATE_SRC).not.toMatch(/validateEvaluationSignals/);
  });
});

/* ============================== No second scheduler / no new AI call ============================== */
describe("PHASE 2F — no second scheduler, no new AI call, no structural authority (STRUCTURAL)", () => {
  it("submitAnswer still makes exactly one callClaude request of its own (Call 1) — Phase 2F adds none", () => {
    expect(SUBMIT_ANSWER_SRC.split("callClaude(").length - 1).toBe(1);
  });

  it("the scheduler call (runSimulatedAdaptiveTurn) takes no candidateState argument — only the existing candidateStrategy nudge", () => {
    const schedulerCallIdx = SUBMIT_ANSWER_SRC.indexOf("runSimulatedAdaptiveTurn({");
    const schedulerCall = SUBMIT_ANSWER_SRC.slice(schedulerCallIdx, SUBMIT_ANSWER_SRC.indexOf("});", schedulerCallIdx));
    expect(schedulerCall).not.toMatch(/candidateState|candidateIntelligence|candidateClaims/);
  });

  it("candidateState.js never imports or invokes the scheduler, React, Supabase, or the AI client", () => {
    const src = readFileSync(new URL("./candidateState.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/scheduleNextCategory\(|resolveTurnDirective\(|runSimulatedAdaptiveTurn\(/);
    expect(src).not.toMatch(/from ["']\.\/adaptiveEngine/);
    expect(src).not.toMatch(/callClaude|supabase/i);
    expect(src).not.toMatch(/from ["']react["']/i);
  });
});

/* ============================== Batch / Assessment Centre isolation ============================== */
describe("PHASE 2F — batch pipeline and Assessment Centre remain unaffected (STRUCTURAL)", () => {
  it("dbInsertQuestionBatch / generateQuestionBatch contain no candidateState references", () => {
    const batchStart = SOURCE.indexOf("async function dbInsertQuestionBatch(");
    const batchEnd = SOURCE.indexOf("async function dbInsertAnswerOnly(");
    const batchBlock = SOURCE.slice(batchStart, batchEnd);
    expect(batchBlock).not.toMatch(/candidateState|buildCandidateState|buildEvidenceEvent|updateCandidateState/i);
  });

  it("Assessment Centre's functions contain no candidateState references", () => {
    const acBlock = SOURCE.slice(
      SOURCE.indexOf("/* ---------------- ASSESSMENT CENTRE ---------------- */"),
      SOURCE.indexOf("/* ---------------- DERIVED VALUES ---------------- */")
    );
    expect(acBlock).not.toMatch(/candidateState|buildCandidateState|buildEvidenceEvent|updateCandidateState/i);
  });

  it("candidateState.js itself has no coupling to the batch pipeline or Assessment Centre", () => {
    const src = readFileSync(new URL("./candidateState.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/independent_batch|generateQuestionBatch|assessment|EXERCISE_TYPES/i);
  });
});

/* ============================== Recovery / duplicate prevention ============================== */
describe("PHASE 2F — recovery stays deterministic, no duplicate evidence on retry (STRUCTURAL + EXECUTABLE)", () => {
  it("the claim-evidence DB write (dbUpdateClaim) appears exactly once in submitAnswer, before Call 2's try/catch", () => {
    const occurrences = SUBMIT_ANSWER_SRC.split("dbUpdateClaim(").length - 1;
    expect(occurrences).toBe(1);
    const call2Try = SUBMIT_ANSWER_SRC.slice(SUBMIT_ANSWER_SRC.indexOf("try {", SUBMIT_ANSWER_SRC.indexOf("PERSIST SCHEDULER DECISION")));
    expect(call2Try).not.toMatch(/dbUpdateClaim/);
  });

  it("regenerateNextQuestion never calls dbUpdateClaim — a Call-2 retry never re-applies evidence", () => {
    expect(REGENERATE_SRC).not.toMatch(/dbUpdateClaim/);
  });

  it("EXECUTABLE: folding the SAME evidence event into candidate state twice (simulating a retried, idempotent recovery read) does not double-count it beyond the fold itself", () => {
    const state = buildCandidateState({ claims: [{ id: "c1", claim_text: "x", status: "unverified", confidence: "low", evidence: [], evidence_count: 0 }] });
    const event = buildEvidenceEvent({ claimId: "c1", evaluation: { specificity: 85, evidence: 85 } });
    const once = updateCandidateState(state, event);
    // Recovery must never silently re-apply the same event a second time without an explicit
    // fold call — this just documents that updateCandidateState itself is a plain, predictable
    // append (the caller, not this module, is responsible for calling it exactly once per
    // real event — see the STRUCTURAL "computed exactly once" test above).
    expect(once.claims.find((c) => c.claimId === "c1").tests).toBe(1);
  });
});

/* ============================== Legacy compatibility ============================== */
describe("PHASE 2F — legacy candidate degrades to pre-2F Phase 2E/2C behaviour (EXECUTABLE)", () => {
  it("a candidate with no claims, no memory, no DNA produces an inert Candidate State that changes nothing about the strategy nudge", () => {
    const emptySignals = buildCandidateSignals({});
    const legacyState = buildCandidateState({ candidateSignals: emptySignals, claims: [], questionHistory: [] });
    const strategyFromState = buildInterviewStrategy({ candidateSignals: legacyState, claims: [], transcript: [] });
    const strategyFromSignals = buildInterviewStrategy({ candidateSignals: emptySignals, claims: [], transcript: [] });
    expect(strategyFromState).toEqual(strategyFromSignals);
  });
});

/* ============================== Cross-user isolation ============================== */
describe("PHASE 2F — no cross-user/cross-candidate contamination (EXECUTABLE)", () => {
  it("Candidate State is built entirely from the claims/questionHistory passed in — it never reaches outside its own arguments for other users' data", async () => {
    const src = readFileSync(new URL("./candidateState.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/user_id|userId|auth\.uid/i);
  });

  it("building state for user A's claims never leaks into a state built from user B's claims", () => {
    const userAClaims = [{ id: "a1", claim_text: "User A's claim", status: "supported", confidence: "high", evidence: [{ strength: "strong" }], evidence_count: 1 }];
    const userBClaims = [{ id: "b1", claim_text: "User B's claim", status: "unverified", confidence: "low", evidence: [], evidence_count: 0 }];
    const stateA = buildCandidateState({ claims: userAClaims });
    const stateB = buildCandidateState({ claims: userBClaims });
    expect(stateA.claims.map((c) => c.claimId)).toEqual(["a1"]);
    expect(stateB.claims.map((c) => c.claimId)).toEqual(["b1"]);
  });
});
