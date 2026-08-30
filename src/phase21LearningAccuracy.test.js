/* ================================================================== *
 * PHASE 21 — LEARNING ACCURACY & SOURCE TRUSTWORTHINESS
 * ------------------------------------------------------------------
 * Track A — tolerant, still-deterministic written-quiz grading:
 *   NO AI call on submit/retry; synonyms/aliases/abbreviations, safe
 *   morphology + UK/US spelling, required vs optional concepts,
 *   anti-false-positive protections retained, legacy metadata intact.
 *
 * Track B — CV source trustworthiness:
 *   a statement is attributed to the candidate's CV ONLY when its
 *   source is "cv" AND a verbatim evidence_quote verifies against the
 *   real CV text. Everything else (JD-derived, role-inferred, legacy,
 *   unverifiable, cross-application) uses generic wording. No fuzzy /
 *   semantic matching. False attribution is worse than generic wording.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  markWrittenQuiz, coverageVerdict, normaliseConcept,
} from "./writtenQuiz.js";
import {
  experiencesToExplore, cvEvidenceVerifies, normaliseCvEvidenceItem,
  normaliseCandidateProfile, verifyCvEvidence, CV_EVIDENCE_SOURCES,
} from "./applicationIntelligence.js";
import { mergeProbeAreasForInterview } from "./candidateIntelligence.js";
import { redoConceptUnion } from "./continuePreparing.js";

const APP_SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const QUIZ_SRC = readFileSync(new URL("./writtenQuiz.js", import.meta.url), "utf8");
const AI_SRC = readFileSync(new URL("./applicationIntelligence.js", import.meta.url), "utf8");

/* ==================================================================
 * TRACK A — WRITTEN-QUIZ GRADING
 * ================================================================== */
describe("Phase 21A — tolerant deterministic quiz grading", () => {
  // A realistic Phase 21 concept set for "terminal value in a DCF"
  const TV = [
    {
      concept: "future cash flows beyond the forecast",
      accepted_terms: ["cash flows after the explicit forecast", "post-forecast cash flow"],
      definition: "the cash the business is expected to generate in every year after the explicit projection period ends",
      required: true,
    },
    {
      concept: "perpetuity growth",
      aliases: ["gordon growth", "constant growth rate", "long term growth rate"],
      definition: "a single steady growth rate the cash flows are assumed to grow at forever",
      required: true,
    },
    {
      concept: "discounting to present value",
      aliases: ["DCF", "discounted cash flow", "present-value"],
      definition: "bringing a future amount back to today using a discount rate",
      required: false,
    },
  ];

  it("exact accepted answer covers every required concept", () => {
    const r = markWrittenQuiz(
      "Terminal value captures the future cash flows beyond the forecast, assuming a constant growth rate forever, discounted to present value.",
      TV
    );
    expect(r.coverage).toEqual({ n: 2, total: 2 });
    expect(r.missing).toEqual([]);
    expect(r.optionalCovered).toContain("discounting to present value");
  });

  it("credits a concept via a synonym / alias that is NOT in accepted_terms", () => {
    const r = markWrittenQuiz("It uses the Gordon Growth idea and post-forecast cash flow.", TV);
    expect(r.covered).toContain("perpetuity growth");          // "gordon growth" alias
    expect(r.covered).toContain("future cash flows beyond the forecast"); // "post-forecast cash flow"
  });

  it("credits a concept when the wording is reordered", () => {
    const r = markWrittenQuiz("beyond the forecast, the future cash flows continue", TV);
    expect(r.covered).toContain("future cash flows beyond the forecast");
  });

  it("tolerates morphological variation (project/projecting/projected, discount/discounting)", () => {
    const concepts = [
      { concept: "projecting revenue", definition: "estimating how sales will grow over the forecast", required: true },
    ];
    // conservative suffix stemming: -ed / -ing / -s all fold to the same stem.
    expect(markWrittenQuiz("we projected revenue for five years", concepts).covered).toEqual(["projecting revenue"]);
    expect(markWrittenQuiz("they are projecting revenues upward", concepts).covered).toEqual(["projecting revenue"]);
  });

  it("tolerates UK/US spelling variation (amortise / amortize, capitalisation / capitalization)", () => {
    const concepts = [{ concept: "amortisation of intangibles", required: true }];
    expect(markWrittenQuiz("amortization of intangibles is added back", concepts).coverage.n).toBe(1);
    expect(markWrittenQuiz("we amortise the intangible assets", concepts).coverage.n).toBe(1);
  });

  it("matches an abbreviation against its expansion and vice versa", () => {
    const concepts = [
      { concept: "return on equity", aliases: [], required: true },
      { concept: "WACC", required: true },
    ];
    const r = markWrittenQuiz("ROE improved while the weighted average cost of capital fell", concepts);
    expect(r.coverage).toEqual({ n: 2, total: 2 });
  });

  it("a partial answer is scored as partial — never a binary 'wrong'", () => {
    const r = markWrittenQuiz("It is about the cash flows after the explicit forecast.", TV);
    expect(r.coverage.n).toBe(1);
    expect(r.coverage.total).toBe(2);
    expect(r.missing).toContain("perpetuity growth");
    const verdict = coverageVerdict(r.coverage);
    expect(verdict.label).not.toMatch(/wrong|incorrect|fail/i);
  });

  it("a MISSING required concept stays in `missing`; a missing OPTIONAL one stays in `optionalMissing` and never inflates coverage", () => {
    const r = markWrittenQuiz("future cash flows beyond the forecast growing at a constant growth rate", TV);
    expect(r.coverage).toEqual({ n: 2, total: 2 });      // both required covered
    expect(r.missing).toEqual([]);
    expect(r.optionalMissing).toContain("discounting to present value"); // optional, not covered
    expect(r.coverage.total).toBe(2);                     // optional never counted in total
  });

  it("anti-false-positive: one incidental keyword in an unrelated sentence does NOT credit a multi-word concept", () => {
    const r = markWrittenQuiz(
      "My summer job involved a growth spreadsheet for the office party and a cash tin.",
      TV
    );
    expect(r.covered).not.toContain("future cash flows beyond the forecast");
    expect(r.covered).not.toContain("perpetuity growth");
  });

  it("anti-false-positive: scattered concept words far apart are not a proximity match", () => {
    const filler = " and then we talked about many unrelated things for a long while in the room ".repeat(3);
    const r = markWrittenQuiz(`future${filler}cash${filler}flows beyond the forecast`, TV);
    expect(r.covered).not.toContain("future cash flows beyond the forecast");
  });

  it("LEGACY metadata { label, accepted_terms } still grades exactly as before (all required)", () => {
    const legacy = [
      { label: "retained earnings", accepted_terms: ["accumulated profit"] },
      { label: "net income" },
      { label: "dividends" },
    ];
    const r = markWrittenQuiz("net income less dividends flows into retained earnings", legacy);
    expect(r.covered.sort()).toEqual(["dividends", "net income", "retained earnings"]);
    expect(r.coverage).toEqual({ n: 3, total: 3 });
    expect(r.optionalMissing).toEqual([]);   // nothing is optional in a legacy set
  });

  it("malformed / empty metadata never throws and yields a safe result", () => {
    expect(() => markWrittenQuiz("anything", null)).not.toThrow();
    expect(() => markWrittenQuiz("anything", [null, {}, { label: "" }, { concept: "x", accepted_terms: "nope", aliases: 5, definition: {} }])).not.toThrow();
    expect(markWrittenQuiz("x", []).coverage).toEqual({ n: 0, total: 0 });
    const r = markWrittenQuiz("   ", [{ concept: "a real concept", required: true }]);
    expect(r.answered).toBe(false);
    expect(r.coverage).toEqual({ n: 0, total: 1 });
  });

  it("normaliseConcept coerces legacy + new shapes and defaults required=true", () => {
    expect(normaliseConcept({ label: "x" }).required).toBe(true);
    expect(normaliseConcept({ concept: "x", required: false }).required).toBe(false);
    expect(normaliseConcept({})).toBeNull();
    expect(normaliseConcept(null)).toBeNull();
    const nc = normaliseConcept({ concept: "y", accepted_terms: ["a"], aliases: ["b"], definition: "d" });
    expect(nc.label).toBe("y");
    expect(nc.aliases).toEqual(["b"]);
  });

  it("redoConceptUnion passes aliases / definition / required through for redo marking", () => {
    const mod = { learning_items: [{ expected_concepts: [
      { concept: "alpha", aliases: ["a1"], definition: "the first thing", required: false },
      { label: "beta", accepted_terms: ["b1"] },
    ] }] };
    const union = redoConceptUnion(mod);
    expect(union.map((c) => c.label)).toEqual(["alpha", "beta"]);
    expect(union[0]).toMatchObject({ aliases: ["a1"], definition: "the first thing", required: false });
    expect(union[1].required).toBe(true);
  });

  it("STRUCTURAL: grading a submission / retry makes NO AI call", () => {
    const submitStart = APP_SRC.indexOf("async function submitWrittenAnswer()");
    const submitEnd = APP_SRC.indexOf("async function saveRedoAnswer()");
    const redoEnd = APP_SRC.indexOf("}", APP_SRC.indexOf("async function saveRedoAnswer()") + 4000);
    const block = APP_SRC.slice(submitStart, Math.max(redoEnd, submitEnd + 3000));
    expect(submitStart).toBeGreaterThan(-1);
    expect(block).toMatch(/markWrittenQuiz\(quizDraft/);
    expect(block).toMatch(/markWrittenQuiz\(redoDraft/);
    expect(block).not.toMatch(/callClaude|await generate|requestType/);
  });

  it("STRUCTURAL: quiz metadata is produced by the EXISTING development_module call — no extra AI call", () => {
    // there is exactly one development_module generation call
    const calls = AppMatchAll(/requestType:\s*"development_module"/g);
    expect(calls).toBe(1);
    // and the concept schema in that prompt carries the Phase 21 keys
    const promptRegion = APP_SRC.slice(APP_SRC.indexOf('"expected_concepts"'), APP_SRC.indexOf('"expected_concepts"') + 260);
    expect(promptRegion).toMatch(/aliases/);
    expect(promptRegion).toMatch(/definition/);
    expect(promptRegion).toMatch(/required/);
  });
});

function AppMatchAll(re) {
  return (APP_SRC.match(re) || []).length;
}

/* ==================================================================
 * TRACK B — CV SOURCE TRUSTWORTHINESS
 * ================================================================== */
describe("Phase 21B — deterministic CV provenance", () => {
  const CV = [
    "EXPERIENCE",
    "Analyst, Rothbury Partners (2023-2024)",
    "Built a three-statement financial model for a mock leveraged buyout and presented it to the deal team.",
    "Led a team of four interns on a market-sizing project.",
  ].join("\n");

  it("cvEvidenceVerifies: a genuine verbatim excerpt verifies; a paraphrase / absent quote does not", () => {
    expect(cvEvidenceVerifies("Built a three-statement financial model for a mock leveraged buyout", CV)).toBe(true);
    // safe normalisation: case + whitespace + smart quotes
    expect(cvEvidenceVerifies("  built a THREE-statement financial model  ", CV)).toBe(true);
    // paraphrase — not a substring
    expect(cvEvidenceVerifies("created a detailed LBO model for the M&A team", CV)).toBe(false);
    // too short to be meaningful
    expect(cvEvidenceVerifies("model", CV)).toBe(false);
    // no CV at all
    expect(cvEvidenceVerifies("Built a three-statement financial model", "")).toBe(false);
  });

  it("verifyCvEvidence: a genuine CV quote keeps source 'cv'", () => {
    const profile = {
      experience: ["Analyst at Rothbury Partners"],
      cv_evidence: [{
        text: "Built an LBO model",
        source: "cv",
        evidence_quote: "Built a three-statement financial model for a mock leveraged buyout",
      }],
      potential_probe_areas: [{
        claim: "Owns financial modelling end to end",
        why: "Depth worth probing",
        source: "cv",
        evidence_quote: "Built a three-statement financial model for a mock leveraged buyout",
      }],
    };
    const out = verifyCvEvidence(profile, CV);
    expect(out.cv_evidence[0].source).toBe("cv");
    expect(out.potential_probe_areas[0].source).toBe("cv");
  });

  it("verifyCvEvidence: a quote NOT present in the CV is downgraded to 'unverified'", () => {
    const profile = {
      cv_evidence: [{ text: "Ran a $2bn buyout", source: "cv", evidence_quote: "Led all execution on a live $2bn leveraged buyout" }],
      potential_probe_areas: [{ claim: "Ran a huge deal", source: "cv", evidence_quote: "single-handedly closed a $2bn transaction" }],
    };
    const out = verifyCvEvidence(profile, CV);
    expect(out.cv_evidence[0].source).toBe("unverified");
    expect(out.potential_probe_areas[0].source).toBe("unverified");
  });

  it("verifyCvEvidence: an inferred claim is never re-labelled 'cv'", () => {
    const profile = {
      cv_evidence: [{ text: "Likely comfortable with valuation", source: "inferred", evidence_quote: "" }],
      potential_probe_areas: [{ claim: "Probably knows DCF", source: "inferred", evidence_quote: "" }],
    };
    const out = verifyCvEvidence(profile, CV);
    expect(out.cv_evidence[0].source).toBe("inferred");
    expect(out.potential_probe_areas[0].source).toBe("inferred");
  });

  it("verifyCvEvidence: a JD-derived claim is never labelled 'cv'", () => {
    const profile = {
      cv_evidence: [{ text: "Role needs stakeholder management", source: "jd", evidence_quote: "manage senior stakeholders" }],
    };
    const out = verifyCvEvidence(profile, CV);
    expect(out.cv_evidence[0].source).toBe("jd");
  });

  it("no-CV analysis: verifyCvEvidence(profile, '') strips every 'cv' claim to 'unverified'", () => {
    const profile = {
      cv_evidence: [{ text: "x", source: "cv", evidence_quote: "something the model made up" }],
      potential_probe_areas: [
        { claim: "invented claim", source: "cv", evidence_quote: "invented supporting quote" },
        { claim: "role expectation", source: "inferred", evidence_quote: "" },
      ],
    };
    const out = verifyCvEvidence(profile, "");
    expect(out.cv_evidence.every((i) => i.source !== "cv")).toBe(true);
    expect(out.potential_probe_areas.find((p) => p.claim === "invented claim").source).toBe("unverified");
    expect(out.potential_probe_areas.find((p) => p.claim === "role expectation").source).toBe("inferred");
  });

  it("normaliseCandidateProfile: legacy string-array profile normalises safely, no provenance invented", () => {
    const legacy = {
      education: ["BSc Economics"],
      experience: ["Intern at X", "  ", null],
      potential_probe_areas: [{ claim: "Did a project", why: "vague" }, "bare string probe"],
    };
    const cp = normaliseCandidateProfile(legacy);
    expect(cp.experience).toEqual(["Intern at X"]);
    expect(cp.cv_evidence).toEqual([]);
    expect(cp.potential_probe_areas[0]).toMatchObject({ claim: "Did a project", source: "unverified", evidence_quote: "" });
    expect(cp.potential_probe_areas[1]).toMatchObject({ claim: "bare string probe", source: "unverified" });
  });

  it("normaliseCandidateProfile / normaliseCvEvidenceItem: malformed provenance metadata defaults to 'unverified', never throws", () => {
    expect(() => normaliseCandidateProfile(null)).not.toThrow();
    expect(() => normaliseCandidateProfile({})).not.toThrow();
    expect(() => normaliseCandidateProfile("nope")).not.toThrow();
    expect(normaliseCvEvidenceItem({ text: "t", source: "totally-bogus" }).source).toBe("unverified");
    expect(normaliseCvEvidenceItem({ text: "" })).toBeNull();
    expect(normaliseCvEvidenceItem(42)).toBeNull();
    expect(normaliseCvEvidenceItem("a plain string")).toMatchObject({ text: "a plain string", source: "unverified", evidence_quote: "" });
    expect(CV_EVIDENCE_SOURCES).toEqual(["cv", "jd", "inferred", "unverified"]);
  });

  it("normaliseCandidateProfile keeps the six wire arrays as string[] (contract unchanged)", () => {
    const cp = normaliseCandidateProfile({
      skills: ["Excel", "SQL"], behavioural_examples: ["Handled a conflict"],
    });
    for (const k of ["education", "experience", "leadership", "achievements", "skills", "behavioural_examples"]) {
      expect(Array.isArray(cp[k])).toBe(true);
      expect(cp[k].every((s) => typeof s === "string")).toBe(true);
    }
  });

  it("mixed CV / JD / inferred evidence: only the verified CV item survives as 'cv'", () => {
    const profile = {
      cv_evidence: [
        { text: "modelling", source: "cv", evidence_quote: "Built a three-statement financial model for a mock leveraged buyout" },
        { text: "stakeholders", source: "jd", evidence_quote: "manage senior stakeholders" },
        { text: "leadership potential", source: "inferred", evidence_quote: "" },
        { text: "made up", source: "cv", evidence_quote: "ran a global restructuring programme" },
      ],
    };
    const out = verifyCvEvidence(profile, CV);
    expect(out.cv_evidence.map((i) => i.source)).toEqual(["cv", "jd", "inferred", "unverified"]);
  });
});

/* ==================================================================
 * TRACK B — UI-FACING ATTRIBUTION (experiencesToExplore)
 * ================================================================== */
describe("Phase 21B — experiencesToExplore attribution gate", () => {
  const recs = [
    { label: "strong financial modelling", dimension: "technical", evidence: "financial modelling skills" },
    { label: "leading a team", dimension: "behavioural", evidence: "team leadership" },
  ];
  const CV = "Built a three-statement financial model for a mock leveraged buyout at university.";

  it("verified cv_evidence + matching CV text -> 'Your CV mentions'", () => {
    const out = experiencesToExplore({
      candidateProfile: { cv_evidence: [{
        text: "financial model for an LBO",
        source: "cv",
        evidence_quote: "Built a three-statement financial model for a mock leveraged buyout",
      }] },
      cvText: CV,
    }, recs);
    expect(out[0].attributed).toBe(true);
    expect(out[0].fact.startsWith('Your CV mentions: "')).toBe(true);
  });

  it("legacy profile with only string arrays -> generic wording, never a CV attribution", () => {
    const out = experiencesToExplore({
      candidateProfile: { experience: ["Built a financial modelling deck for an LBO"] },
    }, recs);
    expect(out[0].attributed).toBe(false);
    expect(out[0].fact).toBe('A useful area to focus on is "strong financial modelling".');
  });

  it("cv_evidence whose quote fails CV verification -> generic wording", () => {
    const out = experiencesToExplore({
      candidateProfile: { cv_evidence: [{
        text: "financial modelling",
        source: "cv",
        evidence_quote: "owned every financial model on a live $3bn take-private",
      }] },
      cvText: CV,
    }, recs);
    expect(out[0].attributed).toBe(false);
    expect(out[0].fact.startsWith("Your CV mentions")).toBe(false);
  });

  it("interview / candidate_input / inferred claims are never CV-attributed", () => {
    const out = experiencesToExplore({
      claims: [
        { claim_text: "Comfortable leading a team of analysts", source: "interview" },
        { claim_text: "Strong financial modelling", source: "inferred" },
      ],
      cvText: "Comfortable leading a team of analysts. Strong financial modelling.",
    }, recs, { limit: 5 });
    for (const h of out) expect(h.attributed).toBe(false);
  });

  it("a persisted claim carrying a genuine verified CV quote is attributed", () => {
    const out = experiencesToExplore({
      claims: [{
        claim_text: "Financial modelling for an LBO",
        source: "cv",
        evidence_quote: "Built a three-statement financial model for a mock leveraged buyout",
      }],
      cvText: CV,
    }, recs);
    expect(out[0].attributed).toBe(true);
  });

  it("returns [] with no material — never asserts 'you have no experience'", () => {
    expect(experiencesToExplore({}, recs)).toEqual([]);
    expect(experiencesToExplore({ candidateProfile: {}, claims: [] }, recs)).toEqual([]);
  });

  it("never emits assertion language regardless of provenance", () => {
    const out = experiencesToExplore({
      candidateProfile: {
        cv_evidence: [{ text: "led a team", source: "cv", evidence_quote: "Led a team of four interns" }],
        experience: ["Financial modelling on a project"],
      },
      cvText: "Led a team of four interns on a market-sizing project. Financial modelling on a project.",
    }, recs, { limit: 5 });
    for (const h of out) {
      const blob = `${h.fact} ${h.suggestion}`.toLowerCase();
      expect(blob).not.toMatch(/this proves|demonstrates that you|you are strong|shows you have|confirms you/);
    }
  });
});

/* ==================================================================
 * TRACK B — PROVENANCE PASS-THROUGH & APPLICATION ISOLATION
 * ================================================================== */
describe("Phase 21B — provenance pass-through and application isolation", () => {
  it("mergeProbeAreasForInterview preserves { source, evidence_quote } and defaults missing provenance to 'unverified'", () => {
    const merged = mergeProbeAreasForInterview(
      [{ claim: "Built an FX model", why: "cv", source: "cv", evidence_quote: "built an fx model" }],
      [{ claim: "Ran a workshop", why: "unresolved from a past interview" }],
    );
    expect(merged[0]).toMatchObject({ source: "cv", evidence_quote: "built an fx model" });
    expect(merged[1]).toMatchObject({ source: "unverified", evidence_quote: "" });
  });

  it("STRUCTURAL: analyseAndPlan verifies CV evidence before persisting / seeding claims", () => {
    const start = APP_SRC.indexOf("async function analyseAndPlan()");
    const end = APP_SRC.indexOf("async function ", start + 20);
    const src = APP_SRC.slice(start, end > start ? end : start + 12000);
    expect(src).toMatch(/verifyCvEvidence\(result\.candidate_profile, cleanCv/);
    // only CV-verified probe areas are seeded as candidate_claims
    expect(src).toMatch(/p\?\.source === "cv" && p\?\.evidence_quote/);
  });

  it("STRUCTURAL: analyseApplicationOnly (no CV) runs verifyCvEvidence against an empty CV", () => {
    const start = APP_SRC.indexOf("async function analyseApplicationOnly(app)");
    const end = APP_SRC.indexOf("async function ", start + 20);
    const src = APP_SRC.slice(start, end > start ? end : start + 8000);
    expect(src).toMatch(/verifyCvEvidence\(result\.candidate_profile, ""\)/);
    expect(src).toMatch(/p\?\.source === "cv" && p\?\.evidence_quote/);
  });

  it("STRUCTURAL: the Classroom experience feed is application-scoped, not the volatile global profile", () => {
    // candidate_profile is only passed when the global profile provably belongs
    // to the active classroom application
    expect(APP_SRC).toMatch(/classroomProfileAppId = interview\?\.applicationId \|\| applicationId/);
    expect(APP_SRC).toMatch(/classroomScopedProfile = \(activeClassroomApp && classroomProfileAppId === activeClassroomApp\.id\)/);
    // claims are filtered to the active application's id
    expect(APP_SRC).toMatch(/candidateClaims\.filter\(\(c\) => c\.application_id === activeClassroomApp\.id\)/);
    // the call uses the scoped values, not `profile?.candidate_profile` / `candidateClaims`
    const callIdx = APP_SRC.indexOf("classroomExperienceHints = experiencesToExplore(");
    const callSrc = APP_SRC.slice(callIdx, callIdx + 240);
    expect(callSrc).toMatch(/candidateProfile: classroomScopedProfile, claims: classroomScopedClaims/);
  });

  it("STRUCTURAL: dbInsertClaims persists the real source + verbatim evidence, not a blanket 'cv'", () => {
    const start = APP_SRC.indexOf("async function dbInsertClaims(");
    const src = APP_SRC.slice(start, start + 1200);
    expect(src).toMatch(/CLAIM_SOURCES\.includes\(c\.source\) \? c\.source : "cv"/);
    expect(src).toMatch(/evidence, evidence_count: evidence\.length/);
    expect(src).not.toMatch(/source: "cv",\s*\n\s*\}\)\);/); // no unconditional hard-coded source
  });

  it("application A's profile cannot surface in application B's Classroom feed (isolation, executable proxy)", () => {
    // Simulate: global profile belongs to app A, viewer is on app B -> scoped
    // profile must be null, so no CV material leaks across applications.
    const appAProfile = { cv_evidence: [{ text: "Built a financial model for an LBO at app A", source: "cv", evidence_quote: "Built a three-statement financial model for a mock leveraged buyout" }] };
    const scopedForB = null; // what the App.jsx guard produces when ids differ
    const out = experiencesToExplore(
      { candidateProfile: scopedForB, claims: [], cvText: "" },
      [{ label: "financial modelling", dimension: "technical", evidence: "financial modelling" }],
    );
    expect(out).toEqual([]);
    // sanity: the same data WOULD have produced an attributed hint if wrongly passed
    const leaked = experiencesToExplore(
      { candidateProfile: appAProfile, cvText: "Built a three-statement financial model for a mock leveraged buyout" },
      [{ label: "financial modelling", dimension: "technical", evidence: "financial modelling" }],
    );
    expect(leaked[0].attributed).toBe(true);
  });

  it("purity: applicationIntelligence.js provenance layer makes no AI / network / db / react call", () => {
    expect(AI_SRC).not.toMatch(/callClaude|fetch\(|\bsupabase\b|from ["']react["']|XMLHttpRequest|WebSocket/);
    // provenance verification is pure substring matching — no fuzzy/vector path
    expect(AI_SRC).not.toMatch(/cosineSimilarity|\.embed\(|vectorStore|levenshtein|jaroWinkler/i);
  });
});
