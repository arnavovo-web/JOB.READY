/* ================================================================== *
 * PHASE 31 — TECHNICAL DIFFICULTY CONTROL
 * ------------------------------------------------------------------
 * A pure, deterministic layer (same shape as questionMix.js /
 * methodology.js — no AI call, no web search, no database, no React,
 * never throws). It owns TWO things and nothing else:
 *
 *   1. the canonical Beginner / Intermediate / Advanced vocabulary,
 *      its user-facing copy, and safe normalisation of a stored value;
 *   2. the EXPLICIT generation guidance each level injects into the
 *      real question-generation prompts (adaptive per-turn, independent
 *      batch, and the technical Assessment Centre exercises), plus the
 *      universal "realistic interview difficulty, not maximum technical
 *      complexity" guard (Phase 31 §5).
 *
 * It also derives a SUGGESTED level from an already-parsed interview
 * invitation (Phase 31 §6–§8) using ONLY signals the existing
 * invitation-analysis pipeline already produces — no new AI call, no
 * web search. A weak / ambiguous signal always resolves to Intermediate
 * with an honest low confidence; it never claims a confident Advanced.
 *
 * WHAT THIS MODULE DOES NOT DO: it never picks a category, a turn type,
 * an anchor, or a competency; it never touches the scheduler; it never
 * decides WHETHER an interview is technical (that is the user's Question
 * Mix — questionMix.js). It only calibrates HOW hard a technical
 * question should be once one is being generated.
 * ================================================================== */

// ---- 31.1 canonical vocabulary -----------------------------------------------
export const TECHNICAL_DIFFICULTY_LEVELS = ["beginner", "intermediate", "advanced"];

// Phase 31 §3: when Technical is selected, the control defaults to Intermediate.
// The user can always change it before the interview starts.
export const DEFAULT_TECHNICAL_DIFFICULTY = "intermediate";

// Phase 31 §2: short, clear, non-noisy descriptions shown under the control.
export const TECHNICAL_DIFFICULTY_META = {
  beginner: {
    key: "beginner",
    label: "Beginner",
    description:
      "Fundamental concepts, core knowledge and entry-level practical understanding.",
  },
  intermediate: {
    key: "intermediate",
    label: "Intermediate",
    description:
      "Role-relevant knowledge, realistic applied questions and moderate problem-solving.",
  },
  advanced: {
    key: "advanced",
    label: "Advanced",
    description:
      "Deep specialist knowledge, complex scenarios and advanced technical problem-solving.",
  },
};

/** normalizeTechnicalDifficulty(raw) -> canonical level | null (null = no explicit value). */
export function normalizeTechnicalDifficulty(raw) {
  return TECHNICAL_DIFFICULTY_LEVELS.includes(raw) ? raw : null;
}

/** resolveTechnicalDifficulty(raw) -> canonical level, falling back to the Intermediate default. */
export function resolveTechnicalDifficulty(raw) {
  return normalizeTechnicalDifficulty(raw) || DEFAULT_TECHNICAL_DIFFICULTY;
}

// ---- 31.2 the universal realism guard (Phase 31 §5) -------------------------
// Added to EVERY technical question-generation prompt this feature touches, at
// every level. The objective it states is deliberately "realistic interview
// difficulty", never "maximum technical complexity".
export const TECHNICAL_REALISM_GUARD =
  "REALISTIC INTERVIEW DIFFICULTY (not maximum technical complexity): generate questions that are " +
  "representative of what a real interviewer is genuinely likely to ask for this candidate's role, " +
  "seniority and the selected difficulty. Do not raise difficulty merely to make a question " +
  "intellectually challenging. Avoid academic, obscure, unnecessarily specialised or examination-style " +
  "questions unless the role and the selected difficulty clearly justify them. The goal is a realistic " +
  "interview, not a hard exam.";

// ---- 31.3 explicit per-level generation guidance (Phase 31 §4) --------------
// The model is NEVER left to infer what "beginner"/"advanced" mean — each level
// spells out what to test and what to avoid. Kept role-agnostic on purpose: the
// surrounding prompt already carries the role, JD and domain.
const LEVEL_GUIDANCE = {
  beginner:
    "TECHNICAL DIFFICULTY: BEGINNER.\n" +
    "Test fundamentals, core knowledge and entry-level practical understanding:\n" +
    "- ask about the core concepts, standard terminology and basic definitions of the field;\n" +
    "- use straightforward, commonly-encountered scenarios and simple, single-step reasoning;\n" +
    "- keep every question answerable by a well-prepared candidate with little or no hands-on professional experience.\n" +
    "Avoid: obscure edge cases, specialist theory, exam-style or trick questions, multi-layered expert scenarios, " +
    "and anything that assumes significant prior work experience.",
  intermediate:
    "TECHNICAL DIFFICULTY: INTERMEDIATE.\n" +
    "Pitch questions at the level expected in many graduate and early-career technical interviews for this role:\n" +
    "- test role-relevant knowledge applied to realistic, practical situations the candidate would plausibly meet in the job;\n" +
    "- include moderate problem-solving that connects two or three ideas rather than pure recall;\n" +
    "- expect the candidate to justify an approach, not only state a fact.\n" +
    "Do not artificially increase complexity: this is the realistic working level for the role, not an advanced screen.",
  advanced:
    "TECHNICAL DIFFICULTY: ADVANCED.\n" +
    "Probe deep, specialist knowledge for this role:\n" +
    "- use complex but realistic scenarios that need multi-step reasoning and deliberate trade-off analysis;\n" +
    "- expect advanced application of the field's methods and awareness of where standard approaches break down;\n" +
    "- assume the candidate has genuine specialist experience.\n" +
    "The questions must still resemble ones a real interviewer would actually ask for this role. Do NOT generate " +
    "obscure academic or examination questions purely to demonstrate difficulty.",
};

/** technicalDifficultyLevelGuidance(raw) -> the explicit instruction block for one level. */
export function technicalDifficultyLevelGuidance(raw) {
  return LEVEL_GUIDANCE[resolveTechnicalDifficulty(raw)];
}

/**
 * buildTechnicalDifficultyGuidance(raw) -> string
 *
 * The full block injected into a technical question-generation prompt: the
 * explicit per-level guidance followed by the universal realism guard. Safe for
 * any input (defaults to Intermediate).
 */
export function buildTechnicalDifficultyGuidance(raw) {
  return `${technicalDifficultyLevelGuidance(raw)}\n${TECHNICAL_REALISM_GUARD}`;
}

// ---- 31.4 invitation-derived suggestion (Phase 31 §6–§8) -------------------
function str(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}

// Evidence-based signal words. Deliberately conservative and interview-relevant
// (Phase 31 §8). Matched case-insensitively against the invitation text, the
// role title, and the structured fields the extractor already produced.
const BEGINNER_SIGNALS = [
  /\binterns?(hip)?\b/, /\bspring week\b/, /\bspring insight\b/, /\binsight (day|week|programme|program)\b/,
  /\bwork experience\b/, /\bopen day\b/, /\bpenultimate year\b/, /\bfirst year\b/, /\bsecond year\b/,
  /\bschool leaver\b/, /\bapprentice(ship)?\b/, /\bfoundation (programme|program)\b/,
  /\bentry[- ]level\b/, /\bno (prior )?experience (is )?(required|needed|necessary)\b/,
  /\bjunior\b/, /\btrainee\b/, /\btaster\b/,
];
const ADVANCED_SIGNALS = [
  /\bsenior\b/, /\blead\b/, /\bprincipal\b/, /\bstaff (engineer|analyst)\b/, /\bmanager\b/, /\bdirector\b/,
  /\bvice president\b/, /\bvp\b/, /\bassociate director\b/, /\bexpert\b/, /\bspecialist\b/,
  /\bdeep (technical |domain )?(expertise|knowledge)\b/, /\badvanced (technical )?(assessment|interview|test|exercise)\b/,
  /\bsystem design\b/, /\barchitect(ure)?\b/, /\bcomplex (modelling|modeling|systems?|architecture)\b/,
  /\bquant(itative)? (researcher|analyst|developer)\b/, /\bph\.?d\b/, /\bpost[- ]?doc\b/,
  /\bsignificant (prior )?experience\b/, /\byears of experience\b/, /\bproven track record\b/,
  /\bwhiteboard(ing)?\b/, /\blive coding\b/, /\bpair programming\b/,
];
// Intermediate is the anchor: it needs no signal words (it is the default). These
// merely add confidence that Intermediate is a POSITIVE read, not just a fallback.
const INTERMEDIATE_SIGNALS = [
  /\bgraduate (scheme|programme|program|analyst|role)\b/, /\bgrad scheme\b/,
  /\bassociate\b/, /\banalyst\b/, /\bstandard technical (interview|assessment)\b/,
  /\bapplied (assessment|exercise|case)\b/, /\bpractical (problem[- ]solving|exercise|assessment)\b/,
  /\bcompetency[- ]based technical\b/, /\bfirst[- ]round technical\b/,
];

function countMatches(haystack, patterns) {
  const hits = [];
  for (const re of patterns) {
    const m = haystack.match(new RegExp(re.source, "i"));
    if (m) hits.push(m[0].trim().toLowerCase());
  }
  return [...new Set(hits)];
}

/**
 * deriveTechnicalDifficultySignal({ extraction, invitationText, roleTitle, jdText }) ->
 *   { level, confidence, rationale, evidence: string[] }
 *
 *   level      — one of TECHNICAL_DIFFICULTY_LEVELS. Weak/ambiguous -> "intermediate".
 *   confidence — "weak" | "moderate" | "strong". Never "strong" for "advanced"
 *                unless there is genuine, explicit evidence for it.
 *   rationale  — one short sentence for the "Recommended because…" line.
 *   evidence   — the concrete signal phrases found (may be empty).
 *
 * Deterministic. Uses ONLY already-available material (the parsed invitation,
 * its raw text, the role title, and the JD if one exists at scan time). It
 * invents nothing and adds no AI call / web search (Phase 31 §7).
 */
export function deriveTechnicalDifficultySignal(input) {
  const inp = input && typeof input === "object" ? input : {};
  const extraction = inp.extraction && typeof inp.extraction === "object" ? inp.extraction : {};

  const structuredBits = [
    str(inp.roleTitle || extraction.role),
    str(extraction.division),
    str(extraction.team),
    str(extraction.stage),
    arr(extraction.technical_topics).join(" "),
    arr(extraction.mentioned_competencies).join(" "),
    arr(extraction.preparation_areas).join(" "),
    arr(extraction.round_sequence).join(" "),
    str(extraction.preparation_instructions),
    str(extraction.next_steps),
    str(extraction.question_mix && extraction.question_mix.technical && extraction.question_mix.technical.evidence),
  ].join("  ");

  const haystack = `${structuredBits}  ${str(inp.invitationText)}  ${str(inp.jdText)}`.toLowerCase();

  const beginnerHits = countMatches(haystack, BEGINNER_SIGNALS);
  const advancedHits = countMatches(haystack, ADVANCED_SIGNALS);
  const intermediateHits = countMatches(haystack, INTERMEDIATE_SIGNALS);

  // A "final_round" / "superday" stage with explicit technical assessment is a
  // mild nudge toward Advanced, but only ever a supporting signal, never decisive.
  const stage = str(extraction.stage);
  const technicalStage = stage === "technical";

  let level = DEFAULT_TECHNICAL_DIFFICULTY;
  let confidence = "weak";
  let rationale =
    "We couldn't find a strong signal in your invitation, so this defaults to Intermediate — change it if you know the interview will be more or less technical.";
  let evidence = [];

  const beginnerScore = beginnerHits.length;
  const advancedScore = advancedHits.length + (technicalStage && advancedHits.length ? 1 : 0);

  if (beginnerScore > 0 && beginnerScore >= advancedScore) {
    level = "beginner";
    evidence = beginnerHits;
    confidence = beginnerScore >= 2 ? "strong" : "moderate";
    rationale = `Your invitation looks like an early-career / entry-level opportunity (${beginnerHits.join(", ")}), so a Beginner level is likely a better match.`;
  } else if (advancedScore > 0 && advancedHits.length > beginnerScore) {
    level = "advanced";
    evidence = advancedHits;
    // Advanced only reaches "strong" with clear, multiple explicit signals — a
    // single "senior" mention stays "moderate" so the UI never over-claims.
    confidence = advancedHits.length >= 2 ? "strong" : "moderate";
    rationale = `Your invitation points to a senior or specialist, deeply technical interview (${advancedHits.join(", ")}), so an Advanced level is likely a better match.`;
  } else if (intermediateHits.length > 0) {
    level = "intermediate";
    evidence = intermediateHits;
    confidence = "moderate";
    rationale = `Your invitation reads like a standard graduate / early-career technical interview (${intermediateHits.join(", ")}), so Intermediate is a good match.`;
  }

  return { level, confidence, rationale, evidence };
}
