/* ================================================================== *
 * PHASE 12 — INVITATION GUIDED-SETUP RESOLUTION: UNIT TESTS
 * ------------------------------------------------------------------
 * invitationScannerResolve.js in isolation: which of the four mandatory
 * identity fields the extraction resolved, the per-type Question Mix
 * signal, "unknown" never becoming "false" / a fake stage, the honest
 * provenance model, and the one canonical config the wizard receives.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CATEGORIES } from "./methodology.js";
import { QUESTION_MIX_TYPES, normalizeQuestionMix } from "./questionMix.js";
import {
  CANONICAL_STAGE_KEYS, MIX_SIGNAL_STATUS, FIELD_PROVENANCE,
  isUsableCompany, isUsableRole, isCanonicalStage,
  deriveQuestionMixSignal, recommendedQuestionMixTypes, questionMixSignalSummary,
  provenanceFor, resolveInvitationIdentity, buildCanonicalInterviewConfig,
} from "./invitationScannerResolve.js";

const src = readFileSync(new URL("./invitationScannerResolve.js", import.meta.url), "utf8");

// A validateInvitationExtraction-shaped object (the real validator is in App.jsx; these
// fixtures mirror its output shape for the fields this module reads).
function extraction(over = {}) {
  return {
    company: "", company_source: "unknown",
    role: "", role_source: "unknown",
    stage: "unknown", stage_source: "unknown",
    format: "unknown", components: [], components_source: "unknown",
    question_mix: {
      technical: { status: "unknown", evidence: "" },
      behavioural: { status: "unknown", evidence: "" },
      motivational: { status: "unknown", evidence: "" },
    },
    ...over,
  };
}

/* ============================== module purity (STRUCTURAL) ============================== */
describe("invitationScannerResolve.js is a pure deterministic layer", () => {
  it("no AI call, no web search, no DB, no React", () => {
    expect(src).not.toMatch(/callClaude|supabase|fetch\(|WebSearch|from ["']react["']|from ["']\.\/App/);
  });
  it("imports ONLY questionMix.js — never re-implements the type<->category taxonomy or Phase 11 enforcement", () => {
    const imports = src.match(/^import [\s\S]*?from ["'][^"']+["'];/gm) || [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatch(/from ["']\.\/questionMix\.js["']/);
  });
  it("its canonical stage list matches methodology's four interview stages exactly", () => {
    expect(CANONICAL_STAGE_KEYS).toEqual(["recruiter_screen", "first_round", "technical", "final_round"]);
  });
});

/* ============================== usable-value guards (EXECUTABLE) ============================== */
describe("deterministic validation never trusts the AI blindly", () => {
  it("company: rejects placeholders / recruiter-name filler, accepts a real name", () => {
    expect(isUsableCompany("JPMorgan")).toBe(true);
    expect(isUsableCompany("  Goldman Sachs ")).toBe(true);
    for (const bad of ["", "  ", "N/A", "TBD", "unknown", "the company", "Recruitment Team", "hiring team", "our client", "-"]) {
      expect(isUsableCompany(bad), bad).toBe(false);
    }
  });
  it("role: rejects generic filler such as 'position', accepts a real title", () => {
    expect(isUsableRole("Investment Banking Summer Analyst")).toBe(true);
    for (const bad of ["", "role", "the position", "opportunity", "this role", "tbd", "job"]) {
      expect(isUsableRole(bad), bad).toBe(false);
    }
  });
  it("stage: only the four canonical keys count as resolved — never 'unknown' or a fabricated key", () => {
    for (const k of CANONICAL_STAGE_KEYS) expect(isCanonicalStage(k)).toBe(true);
    for (const bad of ["unknown", "", "superday", "hr_interview", "phone_screen", null, undefined]) {
      expect(isCanonicalStage(bad), String(bad)).toBe(false);
    }
  });
});

/* ============================== Question Mix signal — explicit / inferred / unknown (EXECUTABLE) ============================== */
describe("deriveQuestionMixSignal — per-type explicit/inferred/unknown, never fabricated", () => {
  it("a bare 'we are pleased to invite you to an interview' -> ALL THREE unknown", () => {
    const s = deriveQuestionMixSignal(extraction());
    expect(s).toEqual({ technical: "unknown", behavioural: "unknown", motivational: "unknown" });
    expect(recommendedQuestionMixTypes(s)).toEqual([]); // nothing pre-ticked
  });

  it("email names technical + behavioural -> those explicit, motivational stays unknown (NOT false)", () => {
    const s = deriveQuestionMixSignal(extraction({
      question_mix: {
        technical: { status: "explicit", evidence: "assessed on technical knowledge" },
        behavioural: { status: "explicit", evidence: "your previous experiences" },
        motivational: { status: "unknown", evidence: "" },
      },
    }));
    expect(s.technical).toBe("explicit");
    expect(s.behavioural).toBe("explicit");
    expect(s.motivational).toBe("unknown");
    expect(recommendedQuestionMixTypes(s).sort()).toEqual(["behavioural", "technical"]);
  });

  it("falls back to a FLOOR derived from `components` when the AI omitted question_mix", () => {
    const s = deriveQuestionMixSignal(extraction({
      question_mix: undefined,
      components: ["technical_functional", "motivation_fit"], components_source: "explicit",
    }));
    expect(s.technical).toBe("explicit");   // technical_functional -> technical bucket, explicit components
    expect(s.motivational).toBe("explicit"); // motivation_fit -> motivational bucket
    expect(s.behavioural).toBe("unknown");
  });

  it("components with components_source 'inferred' only lift the floor to 'inferred'", () => {
    const s = deriveQuestionMixSignal(extraction({
      question_mix: undefined, components: ["behavioural_competency"], components_source: "inferred",
    }));
    expect(s.behavioural).toBe("inferred");
  });

  it("the AI's own question_mix wins when it is at least as strong as the components floor", () => {
    const s = deriveQuestionMixSignal(extraction({
      question_mix: { technical: { status: "explicit" }, behavioural: { status: "unknown" }, motivational: { status: "unknown" } },
      components: ["technical_functional"], components_source: "inferred", // floor would be 'inferred'
    }));
    expect(s.technical).toBe("explicit"); // AI's explicit beats the inferred floor
  });

  it("never throws on malformed input", () => {
    expect(() => deriveQuestionMixSignal(null)).not.toThrow();
    expect(() => deriveQuestionMixSignal({ question_mix: "nope", components: 5 })).not.toThrow();
    expect(deriveQuestionMixSignal(undefined)).toEqual({ technical: "unknown", behavioural: "unknown", motivational: "unknown" });
  });

  it("questionMixSignalSummary splits mentioned vs not-mentioned for the review copy", () => {
    const summary = questionMixSignalSummary({ technical: "explicit", behavioural: "inferred", motivational: "unknown" });
    expect(summary.mentioned.sort()).toEqual(["behavioural", "technical"]);
    expect(summary.notMentioned).toEqual(["motivational"]);
  });
});

/* ============================== provenance (EXECUTABLE) ============================== */
describe("provenanceFor — honest labelling, never 'Found in invitation' for user-typed data", () => {
  it("explicit + unchanged -> 'found'; inferred -> 'inferred'; edited -> 'confirmed'; empty -> 'missing'", () => {
    expect(provenanceFor("JPMorgan", "explicit", { edited: false })).toBe("found");
    expect(provenanceFor("JPMorgan", "inferred", { edited: false })).toBe("inferred");
    expect(provenanceFor("JPMorgan", "explicit", { edited: true })).toBe("confirmed");
    expect(provenanceFor("", "explicit", { edited: false })).toBe("missing");
    expect(provenanceFor("Acme", "unknown", { edited: false })).toBe("confirmed"); // a value with no AI source came from the user
  });
  it("FIELD_PROVENANCE / MIX_SIGNAL_STATUS enums are stable", () => {
    expect(FIELD_PROVENANCE).toEqual(["found", "inferred", "confirmed", "missing"]);
    expect(MIX_SIGNAL_STATUS).toEqual(["explicit", "inferred", "unknown"]);
  });
});

/* ============================== identity resolution (EXECUTABLE) ============================== */
describe("resolveInvitationIdentity — which of the 4 fields still need the user", () => {
  it("fully-detailed email -> company/role/stage resolved, questionMix always surfaced for confirmation", () => {
    const r = resolveInvitationIdentity(extraction({
      company: "JPMorgan", company_source: "explicit",
      role: "Investment Banking Summer Analyst", role_source: "explicit",
      stage: "first_round", stage_source: "explicit",
      question_mix: { technical: { status: "explicit" }, behavioural: { status: "explicit" }, motivational: { status: "unknown" } },
    }));
    expect(r.company.resolved).toBe(true);
    expect(r.role.resolved).toBe(true);
    expect(r.stage.resolved).toBe(true);
    expect(r.stage.value).toBe("first_round");
    expect(r.allIdentityResolved).toBe(true);
    expect(r.missing).toEqual(["questionMix"]); // the 3 identity fields resolved; mix always confirmed
    expect(r.questionMix.recommended.sort()).toEqual(["behavioural", "technical"]);
    expect(r.questionMix.resolved).toBe(false);
  });

  it("sparse 'we would like to invite you to an interview' -> nothing fabricated, all four surfaced", () => {
    const r = resolveInvitationIdentity(extraction());
    expect(r.company.resolved).toBe(false);
    expect(r.role.resolved).toBe(false);
    expect(r.stage.resolved).toBe(false);
    expect(r.stage.value).toBe(""); // never a guessed canonical key
    expect(r.allIdentityResolved).toBe(false);
    expect(r.missing.sort()).toEqual(["company", "questionMix", "role", "stage"]);
    expect(r.questionMix.recommended).toEqual([]);
  });

  it("an AI-claimed 'explicit' company that is actually a placeholder is still treated as unresolved", () => {
    const r = resolveInvitationIdentity(extraction({ company: "Recruitment Team", company_source: "explicit" }));
    expect(r.company.resolved).toBe(false);
  });

  it("a stage the AI hallucinated to a non-canonical value is unresolved, value '' , provenance 'missing'", () => {
    const r = resolveInvitationIdentity(extraction({ stage: "superday_special", stage_source: "explicit" }));
    expect(r.stage.resolved).toBe(false);
    expect(r.stage.value).toBe("");
    expect(r.stage.provenance).toBe("missing");
  });

  it("provenance turns to 'confirmed' when the current value differs from the captured original", () => {
    const original = extraction({ company: "Acme Advisory", company_source: "explicit" });
    const edited = extraction({ company: "Acme Capital", company_source: "explicit" });
    const r = resolveInvitationIdentity(edited, { original });
    expect(r.company.provenance).toBe("confirmed");
    // an unchanged field keeps its "found" provenance
    const r2 = resolveInvitationIdentity(original, { original });
    expect(r2.company.provenance).toBe("found");
  });

  it("never throws on malformed input", () => {
    expect(() => resolveInvitationIdentity(null)).not.toThrow();
    expect(() => resolveInvitationIdentity(undefined, { original: 5 })).not.toThrow();
  });
});

/* ============================== canonical config (EXECUTABLE) ============================== */
describe("buildCanonicalInterviewConfig — the ONE shape the wizard/engine receives (identical to manual)", () => {
  it("valid input -> { ok:true, config:{ company, role, stage, question_mix:[...] } } using questionMix.js's normalizeQuestionMix", () => {
    const r = buildCanonicalInterviewConfig({
      company: "JPMorgan", role: "IB Summer Analyst", stage: "first_round",
      questionMix: { technical: true, behavioural: true, motivational: false },
    });
    expect(r.ok).toBe(true);
    expect(r.config).toEqual({ company: "JPMorgan", role: "IB Summer Analyst", stage: "first_round", question_mix: ["technical", "behavioural"] });
    expect(normalizeQuestionMix(r.config.question_mix)).toEqual(["technical", "behavioural"]); // round-trips through Phase 11
  });

  it("accepts an array Question Mix too (same normaliser)", () => {
    const r = buildCanonicalInterviewConfig({ company: "X Ltd", role: "Analyst Programme", stage: "technical", questionMix: ["motivational"] });
    expect(r.ok).toBe(true);
    expect(r.config.question_mix).toEqual(["motivational"]);
  });

  it("missing company / role / stage / mix each produce a specific error and ok:false — never a silent default", () => {
    expect(buildCanonicalInterviewConfig({ company: "", role: "Analyst", stage: "first_round", questionMix: ["technical"] })).toMatchObject({ ok: false, errors: { company: expect.any(String) } });
    expect(buildCanonicalInterviewConfig({ company: "X", role: "position", stage: "first_round", questionMix: ["technical"] })).toMatchObject({ ok: false, errors: { role: expect.any(String) } });
    expect(buildCanonicalInterviewConfig({ company: "X", role: "Analyst", stage: "unknown", questionMix: ["technical"] })).toMatchObject({ ok: false, errors: { stage: expect.any(String) } });
    expect(buildCanonicalInterviewConfig({ company: "X", role: "Analyst", stage: "first_round", questionMix: {} })).toMatchObject({ ok: false, errors: { questionMix: expect.any(String) } });
  });

  it("NEVER converts an unknown / empty Question Mix into a value — config is null until the user picks", () => {
    const r = buildCanonicalInterviewConfig({ company: "X", role: "Analyst", stage: "first_round", questionMix: { technical: false, behavioural: false, motivational: false } });
    expect(r.ok).toBe(false);
    expect(r.config).toBeNull();
  });

  it("never throws on malformed input", () => {
    expect(() => buildCanonicalInterviewConfig()).not.toThrow();
    expect(() => buildCanonicalInterviewConfig({ questionMix: "nope" })).not.toThrow();
  });
});

/* ============================== taxonomy reuse guard (STRUCTURAL) ============================== */
describe("Phase 12 does not duplicate Phase 11", () => {
  it("the module references QUESTION_MIX_TYPES from questionMix.js, not a local copy", () => {
    expect(QUESTION_MIX_TYPES).toEqual(["technical", "behavioural", "motivational"]);
    expect(src).toMatch(/QUESTION_MIX_TYPES/);
    expect(src).not.toMatch(/\btechnical_functional\b.*\bcommercial_awareness\b/); // no re-declared category map
  });
  it("every canonical component the floor logic can see is a real methodology category", () => {
    // deriveQuestionMixSignal maps components via questionMix.js; feeding a non-category is a no-op.
    const s = deriveQuestionMixSignal(extraction({ question_mix: undefined, components: ["not_a_category", ...CATEGORIES], components_source: "explicit" }));
    // motivation_fit + behavioural_competency + technical_functional + commercial_awareness + situational_judgement + case_problem_solving
    // -> technical (technical_functional/commercial_awareness/case), behavioural (behavioural_competency/situational_judgement), motivational (motivation_fit)
    expect(s).toEqual({ technical: "explicit", behavioural: "explicit", motivational: "explicit" });
  });
});
