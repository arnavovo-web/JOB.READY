/* ================================================================== *
 * PHASE 2F — CANDIDATE STATE & EVIDENCE ENGINE — TEST SUITE
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { ACTIVE_CATEGORIES } from "./methodology.js";
import { buildCandidateSignals } from "./candidateIntelligence.js";
import {
  EVIDENCE_STRENGTHS,
  evaluateEvidence,
  buildEvidenceEvent,
  calculateConfidence,
  detectInconsistency,
  computeTrend,
  updateClaimEvidence,
  buildClaimState,
  updateCompetencyEvidence,
  buildCompetencyStates,
  buildCategoryStates,
  buildCandidateState,
  updateCandidateState,
  isCandidateStateUsable,
} from "./candidateState.js";

function evalWith(specificity, evidence) {
  return { relevance: 50, specificity, structure: 50, evidence, clarity: 50, competency_demonstration: 50, strengths: [], issues: [] };
}

/* ============================== Evidence classification ============================== */
describe("evaluateEvidence — deterministic strength classification", () => {
  it("no evaluation data at all -> insufficient, null score", () => {
    expect(evaluateEvidence({})).toEqual({ strength: "insufficient", score: null });
    expect(evaluateEvidence({ evaluation: null })).toEqual({ strength: "insufficient", score: null });
    expect(evaluateEvidence({ evaluation: {} })).toEqual({ strength: "insufficient", score: null });
  });

  it("high specificity+evidence -> strong", () => {
    const r = evaluateEvidence({ evaluation: evalWith(85, 80) });
    expect(r.strength).toBe("strong");
    expect(r.score).toBe(83);
  });

  it("mid-range -> moderate", () => {
    expect(evaluateEvidence({ evaluation: evalWith(50, 50) }).strength).toBe("moderate");
  });

  it("low but present -> weak", () => {
    expect(evaluateEvidence({ evaluation: evalWith(20, 20) }).strength).toBe("weak");
  });

  it("near-zero -> insufficient (too little signal, not merely 'weak')", () => {
    expect(evaluateEvidence({ evaluation: evalWith(5, 0) }).strength).toBe("insufficient");
  });

  it("a low score against a PREVIOUSLY SUPPORTED claim is contradictory, not weak", () => {
    const r = evaluateEvidence({ evaluation: evalWith(20, 20), priorStatus: "supported" });
    expect(r.strength).toBe("contradictory");
  });

  it("the same low score against an unverified/partially_supported claim stays weak — no false contradiction", () => {
    expect(evaluateEvidence({ evaluation: evalWith(20, 20), priorStatus: "unverified" }).strength).toBe("weak");
    expect(evaluateEvidence({ evaluation: evalWith(20, 20), priorStatus: "partially_supported" }).strength).toBe("weak");
    expect(evaluateEvidence({ evaluation: evalWith(20, 20) }).strength).toBe("weak");
  });

  it("insufficient-band score against a supported claim is also read as contradictory (still weak-or-below + prior strong)", () => {
    expect(evaluateEvidence({ evaluation: evalWith(0, 0), priorStatus: "supported" }).strength).toBe("contradictory");
  });

  it("deterministic tie-breaking: identical input always produces identical output", () => {
    const results = Array.from({ length: 10 }, () => evaluateEvidence({ evaluation: evalWith(63, 71), priorStatus: "supported" }));
    for (const r of results) expect(r).toEqual(results[0]);
  });

  it("EVIDENCE_STRENGTHS enumerates exactly the five documented buckets", () => {
    expect(EVIDENCE_STRENGTHS.sort()).toEqual(["contradictory", "insufficient", "moderate", "strong", "weak"].sort());
  });
});

describe("buildEvidenceEvent", () => {
  it("assembles a structured event carrying interview/question/claim identifiers and the classification", () => {
    const event = buildEvidenceEvent({
      interviewId: "iv-1", questionId: "q-1", claimId: "c-1", category: "behavioural_competency", competency: "leadership",
      evaluation: evalWith(80, 80), answerExcerpt: "I led a team of 15 and delivered X.",
    });
    expect(event.interview_id).toBe("iv-1");
    expect(event.question_id).toBe("q-1");
    expect(event.claim_id).toBe("c-1");
    expect(event.category).toBe("behavioural_competency");
    expect(event.competency).toBe("leadership");
    expect(event.strength).toBe("strong");
    expect(event.quote).toMatch(/led a team/);
    expect(typeof event.created_at).toBe("string");
  });

  it("never throws on missing/malformed input", () => {
    expect(() => buildEvidenceEvent()).not.toThrow();
    expect(() => buildEvidenceEvent({ evaluation: "nonsense" })).not.toThrow();
    expect(buildEvidenceEvent().strength).toBe("insufficient");
  });

  it("truncates an overlong answer excerpt to 300 chars, same as the pre-2F quote", () => {
    const longAnswer = "x".repeat(500);
    const event = buildEvidenceEvent({ evaluation: evalWith(80, 80), answerExcerpt: longAnswer });
    expect(event.quote.length).toBe(300);
  });

  it("normalizes a legacy category string via mapLegacyCategory, same rule every other call site uses", () => {
    const event = buildEvidenceEvent({ evaluation: evalWith(50, 50), category: "cv_behavioural" });
    expect(event.category).toBe("behavioural_competency");
  });
});

/* ============================== Confidence / inconsistency / trend ============================== */
describe("calculateConfidence — bounded influence", () => {
  it("no events -> low", () => {
    expect(calculateConfidence([])).toBe("low");
    expect(calculateConfidence(undefined)).toBe("low");
  });

  it("strong, strong, strong -> high", () => {
    const events = [{ strength: "strong" }, { strength: "strong" }, { strength: "strong" }];
    expect(calculateConfidence(events)).toBe("high");
  });

  it("strong, weak, contradictory -> low — a materially different state from strong x3", () => {
    const events = [{ strength: "strong" }, { strength: "weak" }, { strength: "contradictory" }];
    expect(calculateConfidence(events)).toBe("low");
  });

  it("a single strong event among many older weak ones does not alone jump confidence to high (bounded window)", () => {
    const events = [
      { strength: "weak" }, { strength: "weak" }, { strength: "weak" }, { strength: "weak" }, { strength: "weak" },
      { strength: "strong" },
    ];
    // only the last 3 (weak, weak, strong) are considered
    expect(calculateConfidence(events)).not.toBe("high");
  });

  it("insufficient events are excluded from the confidence read entirely", () => {
    const withInsufficient = [{ strength: "strong" }, { strength: "insufficient" }, { strength: "strong" }];
    const withoutInsufficient = [{ strength: "strong" }, { strength: "strong" }];
    expect(calculateConfidence(withInsufficient)).toBe(calculateConfidence(withoutInsufficient));
  });

  it("deterministic: identical input always produces identical output", () => {
    const events = [{ strength: "strong" }, { strength: "moderate" }, { strength: "weak" }];
    const results = Array.from({ length: 10 }, () => calculateConfidence(events));
    for (const r of results) expect(r).toBe(results[0]);
  });
});

describe("detectInconsistency", () => {
  it("fewer than 3 real events -> never inconsistent, even if wildly different", () => {
    expect(detectInconsistency([{ strength: "strong" }, { strength: "contradictory" }])).toBe(false);
    expect(detectInconsistency([])).toBe(false);
  });

  it("consistent strong evidence -> not inconsistent", () => {
    expect(detectInconsistency([{ strength: "strong", score: 80 }, { strength: "strong", score: 85 }, { strength: "strong", score: 82 }])).toBe(false);
  });

  it("alternating strong/contradictory -> inconsistent", () => {
    const events = [
      { strength: "strong", score: 85 }, { strength: "contradictory", score: 10 },
      { strength: "strong", score: 88 }, { strength: "contradictory", score: 5 },
    ];
    expect(detectInconsistency(events)).toBe(true);
  });

  it("insufficient events don't count toward the real-event threshold", () => {
    const events = [{ strength: "insufficient" }, { strength: "insufficient" }, { strength: "strong", score: 80 }];
    expect(detectInconsistency(events)).toBe(false);
  });
});

describe("computeTrend", () => {
  it("fewer than 3 real data points -> insufficient_data", () => {
    expect(computeTrend([])).toBe("insufficient_data");
    expect(computeTrend([{ score: 80, created_at: "2026-01-01" }])).toBe("insufficient_data");
  });

  it("does not overreact to a single strong answer surrounded by nothing", () => {
    expect(computeTrend([{ score: 95, created_at: "2026-01-01" }, { score: null, created_at: "2026-01-02" }])).toBe("insufficient_data");
  });

  it("sustained improvement across ordered scores -> improving", () => {
    const events = ["2026-01-01", "2026-01-05", "2026-01-10", "2026-01-15"].map((d, i) => ({ score: [40, 50, 75, 85][i], created_at: d }));
    expect(computeTrend(events)).toBe("improving");
  });

  it("sustained decline -> declining", () => {
    const events = ["2026-01-01", "2026-01-05", "2026-01-10", "2026-01-15"].map((d, i) => ({ score: [85, 75, 50, 40][i], created_at: d }));
    expect(computeTrend(events)).toBe("declining");
  });

  it("flat scores -> stable", () => {
    const events = ["2026-01-01", "2026-01-05", "2026-01-10"].map((d) => ({ score: 65, created_at: d }));
    expect(computeTrend(events)).toBe("stable");
  });

  it("volatile scores -> inconsistent, not averaged into 'stable'", () => {
    const events = ["2026-01-01", "2026-01-05", "2026-01-10", "2026-01-15"].map((d, i) => ({ score: [90, 20, 88, 15][i], created_at: d }));
    expect(computeTrend(events)).toBe("inconsistent");
  });

  it("is chronology-independent — out-of-order input sorts by created_at first", () => {
    const forward = ["2026-01-01", "2026-01-05", "2026-01-10", "2026-01-15"].map((d, i) => ({ score: [40, 50, 75, 85][i], created_at: d }));
    const shuffled = [forward[2], forward[0], forward[3], forward[1]];
    expect(computeTrend(shuffled)).toBe(computeTrend(forward));
  });

  it("deterministic: identical input always produces identical output", () => {
    const events = ["2026-01-01", "2026-01-05", "2026-01-10"].map((d, i) => ({ score: [40, 60, 80][i], created_at: d }));
    const results = Array.from({ length: 5 }, () => computeTrend(events));
    for (const r of results) expect(r).toBe(results[0]);
  });
});

/* ============================== Claim evidence ============================== */
describe("updateClaimEvidence — claims dynamically updated by evidence", () => {
  it("an untested claim (tests=0, evidence=none) is unaffected by a missing event", () => {
    const claim = { id: "c1", claim_text: "I managed a team of 15", status: "unverified", confidence: "medium", evidence: [], evidence_count: 0 };
    expect(updateClaimEvidence(claim, null)).toEqual(claim);
  });

  it("the worked example: weak -> strong -> contradictory", () => {
    let claim = { id: "c1", claim_text: "I managed a team of 15", status: "unverified", confidence: "medium", evidence: [], evidence_count: 0 };

    // After weak evidence: tests=1, evidence=weak, confidence low (reduced/unchanged from initial "medium")
    const weakEvent = buildEvidenceEvent({ interviewId: "iv-1", questionId: "q1", evaluation: evalWith(20, 20), priorStatus: claim.status });
    claim = updateClaimEvidence(claim, weakEvent);
    expect(claim.evidence_count).toBe(1);
    expect(claim.status).toBe("unverified"); // never tested before -> stays unverified, not contradicted
    expect(claim.confidence).toBe("low");

    // After strong evidence: tests=2, evidence=strong, confidence increases
    const strongEvent = buildEvidenceEvent({ interviewId: "iv-1", questionId: "q2", evaluation: evalWith(85, 85), priorStatus: claim.status });
    const afterStrong = updateClaimEvidence(claim, strongEvent);
    expect(afterStrong.evidence_count).toBe(2);
    expect(afterStrong.status).toBe("supported");
    expect(["medium", "high"]).toContain(afterStrong.confidence);
    claim = afterStrong;

    // After contradictory evidence: tests=3, evidence=contradictory, confidence decreases
    const contradictoryEvent = buildEvidenceEvent({ interviewId: "iv-1", questionId: "q3", evaluation: evalWith(15, 15), priorStatus: claim.status });
    expect(contradictoryEvent.strength).toBe("contradictory");
    const afterContradictory = updateClaimEvidence(claim, contradictoryEvent);
    expect(afterContradictory.evidence_count).toBe(3);
    expect(afterContradictory.status).toBe("contradicted");
    expect(afterContradictory.confidence).toBe("low");
  });

  it("strongly supported claim: repeated strong testing keeps status supported and confidence high", () => {
    let claim = { id: "c1", claim_text: "Built an AVM", status: "unverified", confidence: "low", evidence: [], evidence_count: 0 };
    for (let i = 0; i < 3; i++) {
      const event = buildEvidenceEvent({ interviewId: "iv-1", questionId: `q${i}`, evaluation: evalWith(85, 85), priorStatus: claim.status });
      claim = updateClaimEvidence(claim, event);
    }
    expect(claim.status).toBe("supported");
    expect(claim.confidence).toBe("high");
    expect(claim.evidence_count).toBe(3);
  });

  it("repeated testing accumulates evidence events (event-oriented, never overwrites a single score)", () => {
    let claim = { id: "c1", claim_text: "x", status: "unverified", confidence: "low", evidence: [], evidence_count: 0 };
    for (let i = 0; i < 4; i++) {
      claim = updateClaimEvidence(claim, buildEvidenceEvent({ questionId: `q${i}`, evaluation: evalWith(50, 50) }));
    }
    expect(claim.evidence.length).toBe(4);
  });

  it("cross-interview evidence: a claim seeded from interview 1's weak evidence is not treated as new in interview 2", () => {
    const interview1Event = buildEvidenceEvent({ interviewId: "iv-1", questionId: "q1", evaluation: evalWith(20, 20) });
    let claim = { id: "c1", claim_text: "Strong financial modelling", status: "unverified", confidence: "low", evidence: [], evidence_count: 0 };
    claim = updateClaimEvidence(claim, interview1Event);
    expect(claim.evidence_count).toBe(1);

    // Interview 2 starts from the persisted claim row, not from scratch
    const interview2Event = buildEvidenceEvent({ interviewId: "iv-2", questionId: "q9", evaluation: evalWith(85, 85), priorStatus: claim.status });
    const afterInterview2 = updateClaimEvidence(claim, interview2Event);
    expect(afterInterview2.evidence_count).toBe(2); // accumulated, not reset
    expect(afterInterview2.evidence[0].interview_id).toBe("iv-1");
    expect(afterInterview2.evidence[1].interview_id).toBe("iv-2");
  });

  it("insufficient evidence is recorded for audit but never moves status/confidence/evidence_count", () => {
    const claim = { id: "c1", claim_text: "x", status: "partially_supported", confidence: "medium", evidence: [{ strength: "moderate" }], evidence_count: 1 };
    const insufficientEvent = buildEvidenceEvent({ evaluation: evalWith(2, 0) });
    const updated = updateClaimEvidence(claim, insufficientEvent);
    expect(updated.status).toBe("partially_supported");
    expect(updated.confidence).toBe("medium");
    expect(updated.evidence_count).toBe(1);
    expect(updated.evidence.length).toBe(2); // still appended
  });

  it("accepts either the raw DB row shape (.evidence) or the state shape (.events)", () => {
    const rowShape = { status: "unverified", evidence: [], evidence_count: 0 };
    const stateShape = { status: "unverified", events: [], evidence_count: 0 };
    const event = buildEvidenceEvent({ evaluation: evalWith(85, 85) });
    expect(updateClaimEvidence(rowShape, event).evidence_count).toBe(1);
    expect(updateClaimEvidence(stateShape, event).evidence_count).toBe(1);
  });
});

describe("buildClaimState — read model", () => {
  it("untested claim", () => {
    const state = buildClaimState({ id: "c1", claim_text: "x", status: "unverified", confidence: "low", evidence: [], evidence_count: 0 });
    expect(state.tests).toBe(0);
    expect(state.evidenceStrength).toBe("insufficient");
    expect(state.inconsistent).toBe(false);
  });

  it("never throws on malformed input", () => {
    expect(() => buildClaimState(null)).not.toThrow();
    expect(() => buildClaimState(undefined)).not.toThrow();
    expect(() => buildClaimState("nonsense")).not.toThrow();
    expect(buildClaimState(null).status).toBe("unverified");
  });

  it("legacy claims whose evidence entries predate 2F (no `strength` field) get an all-zero breakdown, never fabricated", () => {
    const legacyClaim = { id: "c1", claim_text: "x", status: "supported", confidence: "high", evidence: [{ source: "interview", quote: "..." }], evidence_count: 1 };
    const state = buildClaimState(legacyClaim);
    expect(state.strengthCounts).toEqual({ strong: 0, moderate: 0, weak: 0, contradictory: 0 });
    expect(state.status).toBe("supported"); // still trusts the persisted status
  });

  it("reflects a mixed strong/weak/contradictory history in strengthCounts and inconsistent", () => {
    const claim = {
      id: "c1", claim_text: "x", status: "contradicted", confidence: "low", evidence_count: 4,
      evidence: [
        { strength: "strong", score: 85 }, { strength: "contradictory", score: 10 },
        { strength: "strong", score: 88 }, { strength: "contradictory", score: 8 },
      ],
    };
    const state = buildClaimState(claim);
    expect(state.strengthCounts.strong).toBe(2);
    expect(state.strengthCounts.contradictory).toBe(2);
    expect(state.inconsistent).toBe(true);
  });
});

/* ============================== Competency evidence ============================== */
describe("updateCompetencyEvidence / buildCompetencyStates", () => {
  it("untouched competency", () => {
    const state = updateCompetencyEvidence(undefined, null);
    expect(state.tests).toBe(0);
    expect(state.trend).toBe("insufficient_data");
    expect(state.coverage).toBe("untouched");
  });

  it("weak competency", () => {
    const state = updateCompetencyEvidence(undefined, { strength: "weak", score: 30, created_at: "2026-01-01" });
    expect(state.tests).toBe(1);
    expect(state.strengthCounts.weak).toBe(1);
    expect(state.coverage).toBe("lightly_tested");
  });

  it("moderate and strong competency coverage buckets", () => {
    let state = undefined;
    for (let i = 0; i < 3; i++) state = updateCompetencyEvidence(state, { strength: "strong", score: 85, created_at: `2026-01-0${i + 1}` });
    expect(state.tests).toBe(3);
    expect(state.coverage).toBe("adequately_tested");
  });

  it("repeated testing keeps every event, not just the latest", () => {
    let state = undefined;
    for (let i = 0; i < 6; i++) state = updateCompetencyEvidence(state, { strength: "moderate", score: 55, created_at: `2026-01-0${i + 1}` });
    expect(state.events.length).toBe(6);
    expect(state.coverage).toBe("over_tested");
  });

  it("inconsistent evidence across events", () => {
    let state = undefined;
    const scores = [90, 20, 88, 15];
    scores.forEach((score, i) => {
      state = updateCompetencyEvidence(state, { strength: score >= 70 ? "strong" : "contradictory", score, created_at: `2026-01-0${i + 1}` });
    });
    expect(state.inconsistent).toBe(true);
  });

  it("the worked example: Leadership tests=3 strong=2 weak=1 vs Commercial awareness tests=1 weak=1", () => {
    const questionHistory = [
      { competency: "leadership", score: 85, date: "2026-01-01" },
      { competency: "leadership", score: 88, date: "2026-01-05" },
      { competency: "leadership", score: 30, date: "2026-01-10" },
      { competency: "commercial awareness", score: 25, date: "2026-01-01" },
    ];
    const states = buildCompetencyStates(questionHistory);
    expect(states.leadership.tests).toBe(3);
    expect(states.leadership.strengthCounts.strong).toBe(2);
    expect(states.leadership.strengthCounts.weak).toBe(1);
    expect(states["commercial awareness"].tests).toBe(1);
    expect(states["commercial awareness"].strengthCounts.weak).toBe(1);
    expect(states["commercial awareness"].coverage).toBe("lightly_tested");
  });

  it("never throws on malformed/empty questionHistory", () => {
    expect(() => buildCompetencyStates(null)).not.toThrow();
    expect(() => buildCompetencyStates(undefined)).not.toThrow();
    expect(buildCompetencyStates([])).toEqual({});
    expect(buildCompetencyStates([{ competency: "" }, null, { foo: 1 }])).toEqual({});
  });

  it("trend calculation reflects the competency's chronological score history", () => {
    const improving = [
      { competency: "sql", score: 40, date: "2026-01-01" },
      { competency: "sql", score: 55, date: "2026-01-05" },
      { competency: "sql", score: 80, date: "2026-01-10" },
    ];
    expect(buildCompetencyStates(improving).sql.trend).toBe("improving");
  });
});

/* ============================== Category evidence ============================== */
describe("buildCategoryStates", () => {
  it("every ACTIVE_CATEGORY is always present, even with zero coverage", () => {
    const states = buildCategoryStates({});
    expect(Object.keys(states).sort()).toEqual([...ACTIVE_CATEGORIES].sort());
    for (const c of ACTIVE_CATEGORIES) expect(states[c].underTesting).toBe(true);
  });

  it("over-testing / under-testing flags derive from evidenceCount", () => {
    const coverage = { [ACTIVE_CATEGORIES[0]]: { evidenceCount: 8, status: "demonstrated", recentlyTested: true } };
    const states = buildCategoryStates(coverage);
    expect(states[ACTIVE_CATEGORIES[0]].overTesting).toBe(true);
    expect(states[ACTIVE_CATEGORIES[0]].underTesting).toBe(false);
    expect(states[ACTIVE_CATEGORIES[0]].testedCount).toBe(8);
  });

  it("never throws on malformed input", () => {
    expect(() => buildCategoryStates(null)).not.toThrow();
    expect(() => buildCategoryStates("nonsense")).not.toThrow();
  });
});

/* ============================== Candidate State assembly ============================== */
describe("buildCandidateState — empty / legacy / current-interview / historical", () => {
  it("empty candidate degrades to empty-but-valid claims/competencies/categories", () => {
    const state = buildCandidateState({});
    expect(state.claims).toEqual([]);
    expect(state.competencies).toEqual({});
    expect(Object.keys(state.categories).sort()).toEqual([...ACTIVE_CATEGORIES].sort());
  });

  it("is a strict superset of candidateSignals — every candidateIntelligence field passes through unchanged", () => {
    const signals = buildCandidateSignals({
      memoryRows: [{ category: "behavioural_competency", competency: "leadership", score: 85, interview_id: "iv-1", created_at: "2026-01-01T00:00:00Z" }],
    });
    const state = buildCandidateState({ candidateSignals: signals });
    for (const key of Object.keys(signals)) expect(state[key]).toEqual(signals[key]);
  });

  it("legacy candidate (no claims, no questionHistory, minimal signals) never throws and behaves like an empty candidate", () => {
    expect(() => buildCandidateState({ candidateSignals: buildCandidateSignals({}), claims: undefined, questionHistory: undefined })).not.toThrow();
  });

  it("reconstructs claim state deterministically from persisted candidate_claims rows", () => {
    const claims = [
      { id: "c1", claim_text: "Led a team of 10", status: "supported", confidence: "high", evidence_count: 3, evidence: [{ strength: "strong" }, { strength: "strong" }, { strength: "moderate" }] },
      { id: "c2", claim_text: "Cut costs by 20%", status: "unverified", confidence: "low", evidence_count: 0, evidence: [] },
    ];
    const state = buildCandidateState({ claims });
    expect(state.claims.length).toBe(2);
    expect(state.claims.find((c) => c.claimId === "c1").status).toBe("supported");
    expect(state.claims.find((c) => c.claimId === "c2").tests).toBe(0);
  });

  it("multiple historical interviews' worth of competency evidence accumulate (cross-interview)", () => {
    const questionHistory = [
      { competency: "leadership", score: 40, date: "2026-01-01" },
      { competency: "leadership", score: 60, date: "2026-02-01" },
      { competency: "leadership", score: 85, date: "2026-03-01" },
    ];
    const state = buildCandidateState({ questionHistory });
    expect(state.competencies.leadership.tests).toBe(3);
    expect(state.competencies.leadership.trend).toBe("improving");
  });

  it("mixed evidence produces a different state than uniformly strong evidence — strong x3 vs strong/weak/contradictory", () => {
    const strongClaim = { id: "c1", claim_text: "x", status: "supported", confidence: "high", evidence_count: 3, evidence: [{ strength: "strong" }, { strength: "strong" }, { strength: "strong" }] };
    const mixedClaim = { id: "c2", claim_text: "y", status: "contradicted", confidence: "low", evidence_count: 3, evidence: [{ strength: "strong" }, { strength: "weak" }, { strength: "contradictory" }] };
    const state = buildCandidateState({ claims: [strongClaim, mixedClaim] });
    const strongState = state.claims.find((c) => c.claimId === "c1");
    const mixedState = state.claims.find((c) => c.claimId === "c2");
    expect(strongState.status).not.toBe(mixedState.status);
    expect(strongState.confidence).not.toBe(mixedState.confidence);
  });

  it("deterministic reconstruction: identical input always produces identical output", () => {
    const input = {
      candidateSignals: buildCandidateSignals({ memoryRows: [{ category: "commercial_awareness", competency: "market sizing", score: 70, interview_id: "iv-1", created_at: "2026-01-01T00:00:00Z" }] }),
      claims: [{ id: "c1", claim_text: "x", status: "unverified", confidence: "low", evidence: [], evidence_count: 0 }],
      questionHistory: [{ competency: "market sizing", score: 70, date: "2026-01-01" }],
    };
    const results = Array.from({ length: 5 }, () => buildCandidateState(input));
    for (const r of results) expect(r).toEqual(results[0]);
  });
});

describe("updateCandidateState — current-interview live update", () => {
  it("folds a new claim event into state without touching unrelated claims", () => {
    const state = buildCandidateState({
      claims: [
        { id: "c1", claim_text: "x", status: "unverified", confidence: "low", evidence: [], evidence_count: 0 },
        { id: "c2", claim_text: "y", status: "supported", confidence: "high", evidence: [{ strength: "strong" }], evidence_count: 1 },
      ],
    });
    const event = buildEvidenceEvent({ claimId: "c1", evaluation: evalWith(85, 85) });
    const next = updateCandidateState(state, event);
    expect(next.claims.find((c) => c.claimId === "c1").status).toBe("supported");
    expect(next.claims.find((c) => c.claimId === "c2")).toEqual(state.claims.find((c) => c.claimId === "c2")); // untouched
  });

  it("folds a new competency event into state without touching unrelated competencies", () => {
    const state = buildCandidateState({ questionHistory: [{ competency: "leadership", score: 40, date: "2026-01-01" }, { competency: "sql", score: 60, date: "2026-01-01" }] });
    const event = buildEvidenceEvent({ competency: "leadership", evaluation: evalWith(85, 85) });
    const next = updateCandidateState(state, event);
    expect(next.competencies.leadership.tests).toBe(2); // accumulated on top of the 1 already there
    expect(next.competencies.sql).toEqual(state.competencies.sql); // untouched
  });

  it("folds a new category event into state, bumping only that category", () => {
    const state = buildCandidateState({});
    const category = ACTIVE_CATEGORIES[0];
    const event = buildEvidenceEvent({ category, evaluation: evalWith(85, 85) });
    const next = updateCandidateState(state, event);
    expect(next.categories[category].testedCount).toBe(1);
    for (const other of ACTIVE_CATEGORIES.slice(1)) expect(next.categories[other]).toEqual(state.categories[other]);
  });

  it("state is available immediately, in-memory, before any DB re-read would be needed — a second update composes on the first", () => {
    let state = buildCandidateState({});
    const category = ACTIVE_CATEGORIES[0];
    state = updateCandidateState(state, buildEvidenceEvent({ category, evaluation: evalWith(85, 85) }));
    state = updateCandidateState(state, buildEvidenceEvent({ category, evaluation: evalWith(20, 20) }));
    expect(state.categories[category].testedCount).toBe(2);
  });

  it("a missing/malformed event is a no-op", () => {
    const state = buildCandidateState({});
    expect(updateCandidateState(state, null)).toEqual(state);
    expect(updateCandidateState(state, "nonsense")).toEqual(state);
    expect(updateCandidateState(null, buildEvidenceEvent({}))).toBeTruthy();
  });

  it("a single weak answer does not consume/dominate the whole state — every OTHER claim/competency/category is byte-identical", () => {
    const state = buildCandidateState({
      claims: [{ id: "c1", claim_text: "x", status: "supported", confidence: "high", evidence: [{ strength: "strong" }], evidence_count: 1 }],
      questionHistory: [{ competency: "leadership", score: 85, date: "2026-01-01" }],
    });
    const event = buildEvidenceEvent({ category: ACTIVE_CATEGORIES[1], evaluation: evalWith(10, 10) });
    const next = updateCandidateState(state, event);
    expect(next.claims).toEqual(state.claims);
    expect(next.competencies).toEqual(state.competencies);
  });
});

describe("isCandidateStateUsable", () => {
  it("true for a real buildCandidateState output, false for malformed input", () => {
    expect(isCandidateStateUsable(buildCandidateState({}))).toBe(true);
    expect(isCandidateStateUsable(null)).toBe(false);
    expect(isCandidateStateUsable({})).toBe(false);
    expect(isCandidateStateUsable("nonsense")).toBe(false);
  });
});

/* ============================== Isolation / no second scheduler ============================== */
describe("candidateState.js makes no AI calls, touches no database, has no React dependency (STRUCTURAL)", () => {
  it("the module source contains no callClaude/supabase/react/scheduler references", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./candidateState.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/callClaude|supabase/i);
    expect(src).not.toMatch(/from ["']react["']/i);
    expect(src).not.toMatch(/scheduleNextCategory\(|resolveTurnDirective\(|runSimulatedAdaptiveTurn\(/);
    expect(src).not.toMatch(/from ["']\.\/adaptiveEngine/);
  });

  it("never assigns category/turn_type/anchor_source — structural interview decisions stay the scheduler's", () => {
    return import("node:fs").then(({ readFileSync }) => {
      const src = readFileSync(new URL("./candidateState.js", import.meta.url), "utf8");
      expect(src).not.toMatch(/decision\.category\s*=|genInput\.category\s*=|turn_type\s*=\s*["']/);
    });
  });
});
