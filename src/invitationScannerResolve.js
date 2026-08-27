/* ================================================================== *
 * PHASE 12 — INTERVIEW INVITATION EMAIL SCANNER: GUIDED-SETUP RESOLUTION
 * ------------------------------------------------------------------
 * Pure, deterministic layer that sits between the EXISTING Phase 7/8
 * invitation extraction (App.jsx buildInvitationExtractionPrompt /
 * validateInvitationExtraction) and the EXISTING Build Interview wizard.
 * It never calls the AI, never touches the network, never persists
 * anything, and never throws.
 *
 * Its one job: decide which of the FOUR mandatory interview-identity
 * fields the scanned email actually resolved —
 *
 *     Company · Role · Interview Stage · Question Mix
 *
 * — so the UI can ask the user ONLY for what is genuinely missing or
 * ambiguous, then hand ONE canonical configuration to the existing
 * interview engine (identical to a manual setup).
 *
 * HARD RULES (mirrors the Phase 11 product principle):
 *   - "unknown" is NEVER silently turned into "false" or into a fake
 *     canonical value. A missing field stays unresolved until the user
 *     resolves it.
 *   - The Question Mix is ALWAYS explicitly confirmed by the user — the
 *     scanner only ever *recommends* pre-ticks; it never locks the mix.
 *   - The final mix is validated through questionMix.js's own
 *     normalizeQuestionMix — this module NEVER re-implements the
 *     type<->category taxonomy or the Phase 11 enforcement.
 * ================================================================== */

import {
  QUESTION_MIX_TYPES, normalizeQuestionMix, questionMixTypeForCategory,
} from "./questionMix.js";

// The canonical interview-stage keys the rest of the app already uses
// (App.jsx INVITATION_STAGE_KEYS / INTERVIEW_STAGES). Written here as a
// literal so this stays a pure, dependency-light module; the integration
// test cross-checks it against App.jsx's own constant so it can't drift.
export const CANONICAL_STAGE_KEYS = ["recruiter_screen", "first_round", "technical", "final_round"];

// Provenance a resolved field can carry, in decreasing "the email told us" order.
export const FIELD_PROVENANCE = ["found", "inferred", "confirmed", "missing"];
// Per-question-type extraction status (matches the *_source enum the
// Phase 7 extractor already returns for company/role/stage/format).
export const MIX_SIGNAL_STATUS = ["explicit", "inferred", "unknown"];

function str(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}
function norm(v) {
  return str(v).trim().toLowerCase();
}

// A value that looks like a placeholder / filler rather than a real company.
const COMPANY_PLACEHOLDERS = new Set([
  "", "n/a", "na", "tbd", "tba", "unknown", "company", "the company",
  "hiring team", "talent team", "people team", "resourcing team",
  "hr", "human resources", "our client", "client", "the client", "-", "—",
]);
// The brief: the company is the one RUNNING the interview — never a recruitment
// agency / recruiter. A value that reads as a recruiter is treated as unresolved.
const RECRUITER_LIKE = /\b(recruit(er|ing|ment)?|talent acquisition|staffing agency)\b/i;
// A value that is generic role filler rather than a real position title.
const ROLE_PLACEHOLDERS = new Set([
  "", "n/a", "na", "tbd", "tba", "unknown", "role", "the role", "position", "the position",
  "opportunity", "the opportunity", "job", "the job", "vacancy", "this role", "-", "—",
]);

/** isUsableCompany(value) — non-empty, not an obvious placeholder, not a recruiter/agency name. */
export function isUsableCompany(value) {
  const n = norm(value);
  return n.length >= 2 && !COMPANY_PLACEHOLDERS.has(n) && !RECRUITER_LIKE.test(n);
}

/** isUsableRole(value) — non-empty, not generic filler such as "position". */
export function isUsableRole(value) {
  const n = norm(value);
  return n.length >= 2 && !ROLE_PLACEHOLDERS.has(n);
}

/** isCanonicalStage(value) — maps to a real interview stage (not "unknown"/"" /fake). */
export function isCanonicalStage(value) {
  return CANONICAL_STAGE_KEYS.includes(value);
}

// ---- 12.1 Question Mix signal (explicit / inferred / unknown per type) --------
/**
 * deriveQuestionMixSignal(extraction) ->
 *   { technical: <status>, behavioural: <status>, motivational: <status> }
 *
 * status ∈ MIX_SIGNAL_STATUS. Precedence:
 *   1. the extractor's own `question_mix.<type>.status` (Phase 12 schema),
 *      when present and valid;
 *   2. otherwise a FLOOR derived from `components` + `components_source`:
 *      a canonical component the email lists maps (via questionMix.js's own
 *      taxonomy) to a user-facing type — that counts as at least "inferred"
 *      (or "explicit" when components_source === "explicit").
 *   3. otherwise "unknown".
 *
 * "unknown" is preserved verbatim — it is NEVER promoted to a decision.
 */
export function deriveQuestionMixSignal(extraction) {
  const e = extraction && typeof extraction === "object" ? extraction : {};
  const qm = e.question_mix && typeof e.question_mix === "object" ? e.question_mix : {};
  const componentsSource = MIX_SIGNAL_STATUS.includes(e.components_source) ? e.components_source : "unknown";

  // floor from components
  const floor = { technical: "unknown", behavioural: "unknown", motivational: "unknown" };
  for (const c of arr(e.components)) {
    const type = questionMixTypeForCategory(c);
    if (!type || !(type in floor)) continue;
    const fromComponent = componentsSource === "explicit" ? "explicit" : "inferred";
    if (rankStatus(fromComponent) > rankStatus(floor[type])) floor[type] = fromComponent;
  }

  const out = {};
  for (const type of QUESTION_MIX_TYPES) {
    const declared = qm[type] && typeof qm[type] === "object" ? qm[type].status : qm[type];
    const declaredStatus = MIX_SIGNAL_STATUS.includes(declared) ? declared : null;
    out[type] = declaredStatus && rankStatus(declaredStatus) >= rankStatus(floor[type])
      ? declaredStatus
      : floor[type];
  }
  return out;
}
function rankStatus(s) {
  return s === "explicit" ? 2 : s === "inferred" ? 1 : 0;
}

/**
 * recommendedQuestionMixTypes(signal) -> string[] (subset of QUESTION_MIX_TYPES)
 *
 * The types the review screen PRE-TICKS: those the email explicitly named
 * or directly implied. A type whose status is "unknown" is deliberately
 * NOT pre-ticked — the user decides (Phase 11: the mix is always the
 * user's explicit choice; a scanner recommendation is never a lock).
 */
export function recommendedQuestionMixTypes(signal) {
  const s = signal && typeof signal === "object" ? signal : {};
  return QUESTION_MIX_TYPES.filter((t) => s[t] === "explicit" || s[t] === "inferred");
}

/**
 * questionMixSignalSummary(signal) ->
 *   { mentioned: string[], notMentioned: string[] }
 *
 * Deterministic input for the review screen's "we found these / X wasn't
 * mentioned" copy. `mentioned` = explicit|inferred; `notMentioned` = unknown.
 */
export function questionMixSignalSummary(signal) {
  const s = signal && typeof signal === "object" ? signal : {};
  return {
    mentioned: QUESTION_MIX_TYPES.filter((t) => s[t] === "explicit" || s[t] === "inferred"),
    notMentioned: QUESTION_MIX_TYPES.filter((t) => s[t] !== "explicit" && s[t] !== "inferred"),
  };
}

// ---- 12.2 identity resolution (which of the 4 fields are still open) ----------
/**
 * provenanceFor(value, source, { edited }) -> one of FIELD_PROVENANCE
 *   "found"     — the email states it and the user has not changed it
 *   "inferred"  — the email implies it (source === "inferred"), unchanged
 *   "confirmed" — the user supplied or edited the value
 *   "missing"   — no usable value at all
 * The review UI turns this into an honest badge — it must never say
 * "Found in invitation" for something the user typed.
 */
export function provenanceFor(value, source, { edited = false } = {}) {
  if (!str(value).trim()) return "missing";
  if (edited) return "confirmed";
  if (source === "explicit") return "found";
  if (source === "inferred") return "inferred";
  return "confirmed"; // source unknown/absent but a value exists -> it came from the user
}

/**
 * resolveInvitationIdentity(extraction, { original } = {}) ->
 *   {
 *     company:    { value, source, provenance, resolved },
 *     role:       { value, source, provenance, resolved },
 *     stage:      { value, source, provenance, resolved },   // value is "" when unresolved
 *     questionMix:{ signal, recommended, summary, resolved:false },
 *     missing:    string[]   // subset of ["company","role","stage","questionMix"]
 *     allIdentityResolved: boolean   // company + role + stage (questionMix always needs a confirm)
 *   }
 *
 * `original` (optional) is the untouched extraction captured right after the
 * AI call; when the CURRENT extraction's value differs, provenance becomes
 * "confirmed" (the user edited it) instead of "found".
 *
 * Deterministic. Never trusts the AI blindly: a value that fails
 * isUsableCompany / isUsableRole / isCanonicalStage is treated as
 * unresolved regardless of the source the AI claimed.
 */
export function resolveInvitationIdentity(extraction, { original } = {}) {
  const e = extraction && typeof extraction === "object" ? extraction : {};
  const o = original && typeof original === "object" ? original : null;

  const companyEdited = !!o && norm(o.company) !== norm(e.company);
  const roleEdited = !!o && norm(o.role) !== norm(e.role);
  const stageEdited = !!o && str(o.stage) !== str(e.stage);

  const company = {
    value: str(e.company).trim(),
    source: str(e.company_source) || "unknown",
    provenance: provenanceFor(e.company, e.company_source, { edited: companyEdited }),
    resolved: isUsableCompany(e.company),
  };
  const role = {
    value: str(e.role).trim(),
    source: str(e.role_source) || "unknown",
    provenance: provenanceFor(e.role, e.role_source, { edited: roleEdited }),
    resolved: isUsableRole(e.role),
  };
  const stageCanonical = isCanonicalStage(e.stage);
  const stage = {
    value: stageCanonical ? e.stage : "",
    source: str(e.stage_source) || "unknown",
    provenance: stageCanonical
      ? provenanceFor(e.stage, e.stage_source, { edited: stageEdited })
      : "missing",
    resolved: stageCanonical,
  };

  const signal = deriveQuestionMixSignal(e);
  const questionMix = {
    signal,
    recommended: recommendedQuestionMixTypes(signal),
    summary: questionMixSignalSummary(signal),
    resolved: false, // Phase 11: the mix is ALWAYS an explicit user confirmation
  };

  const missing = [];
  if (!company.resolved) missing.push("company");
  if (!role.resolved) missing.push("role");
  if (!stage.resolved) missing.push("stage");
  missing.push("questionMix"); // always surfaced for explicit confirmation

  return {
    company, role, stage, questionMix,
    missing,
    allIdentityResolved: company.resolved && role.resolved && stage.resolved,
  };
}

// ---- 12.3 the canonical config the wizard/engine receives --------------------
/**
 * buildCanonicalInterviewConfig({ company, role, stage, questionMix }) ->
 *   { ok, config, errors }
 *
 * The single deterministic gate before the scanner hands off. `config` (on
 * ok) is EXACTLY the shape a manual setup produces:
 *   { company: string, role: string, stage: <canonical key>, question_mix: string[] }
 * question_mix is validated through questionMix.js's own normalizeQuestionMix
 * — no second Question Mix system, no second taxonomy.
 *
 * `questionMix` input may be an array of types or the { technical, behavioural,
 * motivational } boolean object the wizard state uses — normalizeQuestionMix
 * accepts both.
 */
export function buildCanonicalInterviewConfig({ company, role, stage, questionMix } = {}) {
  const errors = {};
  const c = str(company).trim();
  const r = str(role).trim();
  if (!isUsableCompany(c)) errors.company = "Enter the company running this interview.";
  if (!isUsableRole(r)) errors.role = "Enter the role you're interviewing for.";
  if (!isCanonicalStage(stage)) errors.stage = "Choose which stage this interview is.";
  const mix = normalizeQuestionMix(questionMix);
  if (!mix) errors.questionMix = "Choose at least one question type.";

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    config: ok ? { company: c, role: r, stage, question_mix: mix } : null,
  };
}
