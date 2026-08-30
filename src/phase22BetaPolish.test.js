/* ================================================================== *
 * PHASE 22 — FINAL BETA POLISH FIXES
 * ------------------------------------------------------------------
 * FIX 1  CV evidence must render the human-readable quote, never
 *        "[object Object]" — candidate_claims.evidence is a jsonb
 *        array like [{ type:"cv_quote", quote:"...", verified:true }].
 * FIX 2  The "New interview" wizard must let a student continue with
 *        NO CV, without placeholder text, and downstream must treat a
 *        skipped CV as genuinely absent (no false CV provenance).
 * FIX 3  The logged-out top-nav "How it works" link must reach the
 *        same destination as the working "See how it works" CTA.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  readEvidenceQuote, experiencesToExplore, normaliseCvEvidenceItem, verifyCvEvidence,
} from "./applicationIntelligence.js";

const APP_SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

/* ==================================================================
 * FIX 1 — CV EVIDENCE RENDERING
 * ================================================================== */
describe("Phase 22 FIX 1 — CV evidence renders the quote, never [object Object]", () => {
  it("readEvidenceQuote pulls the quote from the Phase 21 structured evidence shape", () => {
    const row = {
      claim_text: "Prepared audit working papers",
      source: "cv",
      evidence: [{ type: "cv_quote", quote: "Prepared working papers for the FY23 audit", verified: true }],
    };
    expect(readEvidenceQuote(row)).toBe("Prepared working papers for the FY23 audit");
  });

  it("readEvidenceQuote still accepts a plain evidence_quote string (probe-area / normalised shape)", () => {
    expect(readEvidenceQuote({ evidence_quote: "Built a three-statement model" })).toBe("Built a three-statement model");
  });

  it("readEvidenceQuote returns '' for empty / legacy / malformed evidence — never stringifies an object", () => {
    for (const c of [
      { evidence: [] },                                   // legacy default
      { evidence: [{ quote: "x", verified: false }] },     // present but NOT verified
      { evidence: [{ type: "cv_quote" }] },                // no quote text
      { evidence: [{}] },
      { evidence: {} },
      { evidence: "just a string somehow" },
      { evidence: null },
      { evidence: undefined },
      {},
      null,
      42,
      "nope",
    ]) {
      const q = readEvidenceQuote(c);
      expect(typeof q).toBe("string");
      expect(q).not.toMatch(/\[object Object\]/);
    }
    expect(readEvidenceQuote({ evidence: [{ quote: "x", verified: false }] })).toBe("");
  });

  it("readEvidenceQuote does NOT weaken provenance: an unverified structured entry yields no quote", () => {
    const row = { source: "cv", evidence: [{ type: "cv_quote", quote: "unproven paraphrase", verified: false }] };
    expect(readEvidenceQuote(row)).toBe("");
  });

  it("experiencesToExplore renders the real quote for a claim with verified structured evidence", () => {
    const recs = [{ label: "audit working papers", dimension: "technical", evidence: "prepared working papers" }];
    const out = experiencesToExplore({
      claims: [{
        claim_text: "Prepared audit working papers for FY23",
        source: "cv",
        evidence: [{ type: "cv_quote", quote: "Prepared working papers for the FY23 audit", verified: true }],
      }],
    }, recs);
    expect(out).toHaveLength(1);
    expect(out[0].attributed).toBe(true);
    expect(out[0].fact).toBe('Your CV mentions: "Prepared working papers for the FY23 audit"');
    expect(out[0].fact).not.toMatch(/\[object Object\]/);
  });

  it("experiencesToExplore falls back to generic wording (no [object Object]) for legacy / unverified evidence", () => {
    const recs = [{ label: "audit working papers", dimension: "technical", evidence: "prepared working papers" }];
    // legacy row: source "cv" but evidence is the empty default
    const legacy = experiencesToExplore({
      claims: [{ claim_text: "Prepared audit working papers", source: "cv", evidence: [] }],
    }, recs);
    expect(legacy[0].attributed).toBe(false);
    expect(legacy[0].fact.startsWith("Your CV mentions")).toBe(false);
    expect(legacy[0].fact).not.toMatch(/\[object Object\]/);

    // unverified structured entry
    const unverified = experiencesToExplore({
      claims: [{ claim_text: "Prepared audit working papers", source: "cv", evidence: [{ type: "cv_quote", quote: "made up", verified: false }] }],
    }, recs);
    expect(unverified[0].attributed).toBe(false);
    expect(unverified[0].fact).not.toMatch(/\[object Object\]/);
  });

  it("experiencesToExplore never emits [object Object] across a mixed batch of evidence shapes", () => {
    const recs = [
      { label: "financial modelling", dimension: "technical", evidence: "financial modelling" },
      { label: "team leadership", dimension: "behavioural", evidence: "led a team" },
      { label: "stakeholder management", dimension: "behavioural", evidence: "managed stakeholders" },
    ];
    const out = experiencesToExplore({
      candidateProfile: {
        cv_evidence: [{ text: "financial modelling deck", source: "cv", evidence_quote: "built a financial modelling deck" }],
        experience: ["Led a team of five on a modelling project"],
      },
      claims: [
        { claim_text: "Managed senior stakeholders", source: "cv", evidence: [{ type: "cv_quote", quote: "Managed senior stakeholders across three teams", verified: true }] },
        { claim_text: "weird legacy", source: "cv", evidence: { foo: 1 } },
        { claim_text: "another", source: "interview", evidence: [{ quote: "x", verified: true }] },
      ],
      cvText: "built a financial modelling deck. Managed senior stakeholders across three teams. Led a team of five on a modelling project.",
    }, recs, { limit: 5 });
    for (const h of out) {
      expect(`${h.fact} ${h.suggestion}`).not.toMatch(/\[object Object\]/);
    }
  });

  it("normaliseCvEvidenceItem never puts [object Object] in evidence_quote when handed an object-shaped evidence field", () => {
    const item = normaliseCvEvidenceItem({ text: "did a thing", source: "cv", evidence: [{ type: "cv_quote", quote: "verbatim bit", verified: true }] });
    expect(item.evidence_quote).toBe("verbatim bit");
    const bad = normaliseCvEvidenceItem({ text: "did a thing", source: "cv", evidence: { not: "a string" } });
    expect(bad.evidence_quote).not.toMatch(/\[object Object\]/);
    expect(bad.evidence_quote).toBe("");
  });

  it("STRUCTURAL: no candidate_claims render path stringifies the evidence column directly", () => {
    // the only historical leak was str(... ?? c.evidence) in experiencesToExplore
    expect(APP_SRC).not.toMatch(/\{\s*c\.evidence\s*\}/);            // never render {c.evidence}
    // the DNA "Claims explored" panel uses evidence only as a boolean find(), never renders the object
    const dnaIdx = APP_SRC.indexOf("Claims explored this interview");
    const dnaBlock = APP_SRC.slice(dnaIdx, dnaIdx + 900);
    expect(dnaBlock).toMatch(/arr\(c\.evidence\)\.find\(/);
    expect(dnaBlock).not.toMatch(/\{\s*cvQuote\s*\}/);              // cvQuote is a match object, only used as a flag
  });
});

/* ==================================================================
 * FIX 2 — CONTINUE WITHOUT A CV IN THE WIZARD
 * ================================================================== */
describe("Phase 22 FIX 2 — the wizard lets a student continue with no CV", () => {
  const step3Idx = APP_SRC.indexOf("Tell us about you.");
  const step3Block = APP_SRC.slice(step3Idx, step3Idx + 2200);

  it("STRUCTURAL: step 3 offers an explicit 'Continue without a CV' action", () => {
    expect(step3Idx).toBeGreaterThan(-1);
    expect(step3Block).toMatch(/Continue without a CV/);
  });

  it("STRUCTURAL: the continue action is NOT disabled when the CV box is empty", () => {
    // the old gate `disabled={buildMethod !== "invitation" && !cvText}` on the CV
    // Continue button must be gone
    expect(step3Block).not.toMatch(/disabled=\{buildMethod !== "invitation" && !cvText\}/);
    // both branches just advance the wizard
    expect(step3Block).toMatch(/onClick=\{\(\) => setWizardStep\(4\)\}/);
  });

  it("STRUCTURAL: no placeholder text (e.g. 'N/A') is injected for a skipped CV", () => {
    expect(step3Block).not.toMatch(/setCvText\(["'](N\/A|n\/a|none|None|-)["']\)/);
  });

  it("STRUCTURAL: the empty-CV state clearly says personalisation leans on the job description", () => {
    expect(step3Block).toMatch(/rely more heavily on the job description|personalised from the job description/i);
  });

  it("STRUCTURAL: downstream treats an empty CV as genuinely absent (not placeholder)", () => {
    // analyseAndPlan: prompt says "none provided." for an empty CV
    expect(APP_SRC).toMatch(/Candidate CV:\\n\$\{cleanCv \|\| "none provided\."\}/);
    // and CV provenance is verified against the (possibly empty) real CV text
    expect(APP_SRC).toMatch(/verifyCvEvidence\(result\.candidate_profile, cleanCv \|\| ""\)/);
  });

  it("BEHAVIOUR: verifyCvEvidence against an empty CV removes every 'cv' attribution (no false provenance)", () => {
    const out = verifyCvEvidence({
      cv_evidence: [{ text: "x", source: "cv", evidence_quote: "the model invented this" }],
      potential_probe_areas: [{ claim: "invented", source: "cv", evidence_quote: "also invented" }],
    }, "");
    expect(out.cv_evidence.every((i) => i.source !== "cv")).toBe(true);
    expect(out.potential_probe_areas.every((p) => p.source !== "cv")).toBe(true);
  });

  it("STRUCTURAL: an existing CV still shows a plain 'Continue' (behaviour preserved when a CV is supplied)", () => {
    // when hasCv (or invitation) the label is the plain "Continue", otherwise "Continue without a CV"
    expect(step3Block).toMatch(/hasCv \|\| buildMethod === "invitation" \?/);
    expect(step3Block).toMatch(/>Continue <ChevronRight/);
    expect(step3Block).toMatch(/>Continue without a CV <ChevronRight/);
  });
});

/* ==================================================================
 * FIX 3 — "HOW IT WORKS" NAV LINK
 * ================================================================== */
describe("Phase 22 FIX 3 — logged-out 'How it works' nav link reaches the same place as the CTA", () => {
  it("STRUCTURAL: the logged-out nav link and the hero CTA both target the 'how' screen", () => {
    // nav link (logged-out links array)
    expect(APP_SRC).toMatch(/\{ label: "How it works", to: "how" \}/);
    // the nav renders each link as onClick={() => setScreen(l.to)}
    expect(APP_SRC).toMatch(/onClick=\{\(\) => setScreen\(l\.to\)\}/);
    // the working hero CTA
    expect(APP_SRC).toMatch(/onClick=\{\(\) => setScreen\("how"\)\}>See how it works/);
    // and there is a real destination screen
    expect(APP_SRC).toMatch(/screen === "how" &&/);
  });
});
