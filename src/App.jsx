import React, { useState, useEffect, useRef } from "react";
import mammoth from "mammoth";
import {
  ChevronRight, Loader2, TrendingDown, CheckCircle2, ArrowLeft, ArrowRight, Sparkles,
  Target, BarChart3, AlertCircle, Upload, Mic, Menu, X,
  GraduationCap, BookOpen, Globe, HelpCircle, XCircle,
  Users, Briefcase, Mail, FileText, History, Clock
} from "lucide-react";
// Phase 2A: canonical taxonomy / anchor-source / stage-methodology engine.
// A companion layer to the Phase 4A INTERVIEW_STAGES/INTERVIEW_FORMATS
// catalog below — it does not read, write, or duplicate that catalog.
// Only category normalization is wired into this file for now (the three
// call sites below). anchor_source normalization has no call site yet —
// no schema in this file emits anchor_source until Phase 2B adds it to
// the batch pipeline — so normalizeAnchorSource is deliberately not
// imported here; it stays exported from methodology.js for that phase.
// The methodology calculation itself (computeMethodologyDistribution) is
// likewise not called anywhere yet — that's also Phase 2B's job.
import { mapLegacyCategory, mapCategoryWithLegacyFallback, normalizeCategoryMix } from "./methodology";

/* ================================================================== *
 * JOB.READY — DESIGN SYSTEM (unchanged from previous build)
 * ================================================================== */
const TOKENS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  :root{
    --navy:#101828; --navy-soft:#1D2939; --blue:#2563EB; --blue-dark:#1D4ED8; --violet:#7C3AED; --teal:#14B8A6;
    --highlight:#DBEAFE; --bg:#F8FAFC; --card:#FFFFFF; --border:#E2E8F0;
    --text:#0F172A; --text-dim:#475569; --text-faint:#94A3B8;
    --good:#0F9D6E; --warn:#D97706; --bad:#DC2626;
    --radius:14px; --radius-sm:8px;
    --shadow-sm: 0 1px 2px rgba(16,24,40,0.06); --shadow-md: 0 4px 16px rgba(16,24,40,0.08); --shadow-lg: 0 12px 32px rgba(16,24,40,0.12);
    --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .jr-btn{ transition: transform .12s ease, box-shadow .12s ease, background .12s ease; }
  .jr-btn:hover{ transform: translateY(-1px); box-shadow: var(--shadow-md); }
  .jr-btn:active{ transform: translateY(0); }
  .jr-card{ transition: box-shadow .15s ease, transform .15s ease; }
  .jr-card:hover{ box-shadow: var(--shadow-md); }
  .jr-fade{ animation: jrFade .35s ease both; }
  @keyframes jrFade{ from{ opacity:0; transform: translateY(6px);} to{opacity:1; transform:translateY(0);} }
  .jr-bar{ transition: width 0.7s cubic-bezier(.4,0,.2,1); }
  input:focus, textarea:focus, select:focus{ outline:none; border-color: var(--blue) !important; box-shadow: 0 0 0 3px var(--highlight); }
  button:focus-visible, a:focus-visible{ outline: 2px solid var(--blue); outline-offset: 2px; }
`;

const MODEL = "claude-sonnet-4-6";

/* ================================================================== *
 * ROBUSTNESS LAYER
 * Root cause of "The string did not match the expected pattern.":
 * WebKit's fetch-body text encoder can throw on an UNPAIRED UTF-16
 * surrogate (a broken half-character some mobile keyboards/autocorrect
 * insert). sanitizeText() strips only those + stray control bytes —
 * every other input class (smart quotes, em/en dashes, accents,
 * currency symbols, valid emoji, tabs, newlines) passes through
 * untouched. Verified against JSON.stringify + TextEncoder locally.
 * ================================================================== */
function sanitizeText(s) {
  if (!s) return s;
  return s
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/* ================================================================== *
 * SUPABASE CLIENT — dynamically loaded from a CDN UMD build (same
 * pattern already used for pdf.js) since @supabase/supabase-js isn't
 * in this environment's bundled library list. Project ref
 * dcltfxnzzfqjtctixlxe, inspected directly via the Supabase MCP
 * connection before writing any of this integration.
 * ================================================================== */
const SUPABASE_URL = "https://dcltfxnzzfqjtctixlxe.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjbHRmeG56emZxanRjdGl4bHhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMjM4MjksImV4cCI6MjEwMjc5OTgyOX0.GufInmeZqrzCuI59k9pWvjysbIX1Uld0fgxG-YNa-uc";
// This is the public "anon" key — safe to ship client-side by design (Supabase's
// intended architecture): it grants no access on its own, RLS on every table
// (verified directly against the live project) is what actually enforces
// ownership. The Anthropic API key is NEVER here — it lives only as an Edge
// Function secret and is called via callClaude() -> supabase.functions.invoke().

let supabaseLoadPromise = null;
function loadSupabase() {
  if (typeof window !== "undefined" && window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
  if (supabaseLoadPromise) return supabaseLoadPromise;
  supabaseLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
    script.onload = () => resolve(window.supabase);
    // Clear the cached promise on failure so a later retry actually re-fetches
    // instead of permanently replaying this one rejection (same fix as loadPdfJs above).
    script.onerror = () => { supabaseLoadPromise = null; reject(new Error("Couldn't load the authentication service. Please check your connection and try again.")); };
    document.head.appendChild(script);
  });
  return supabaseLoadPromise;
}

let supabaseClient = null;
async function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const sb = await loadSupabase();
  // ROOT-CAUSE FIX (2026-08-21): this was "false", which meant Supabase's client never parsed
  // the access/refresh tokens Supabase Auth appends to the redirect URL after an email-confirm
  // or password-recovery link is clicked. That's the single shared root cause behind two bugs:
  // (1) new users landing back on the site after confirming their email with no session
  //     established, so they appeared "stuck" and had to sign in manually; and
  // (2) password reset being a structural dead end — resetPasswordForEmail() sent a real email,
  //     but clicking its link never gave the app a session to call updateUser() with.
  // Turning this on lets supabase-js do this parsing itself (both the legacy hash-token flow and
  // the PKCE ?code= flow), and it emits a distinct "PASSWORD_RECOVERY" auth event so recovery
  // links can be routed to a "set new password" screen instead of silently signing the user in.
  supabaseClient = sb.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return supabaseClient;
}

// callClaude() keeps its original public signature (system, userText, maxTokens, useWebSearch)
// so every call site elsewhere in the app is unchanged. Internally it now calls the
// authenticated Supabase Edge Function "ai-generate" instead of the Anthropic API directly —
// the function verifies the caller's JWT (verify_jwt=true, enforced by Supabase's edge
// runtime before the function body even runs) and holds the real Anthropic key server-side.
async function callClaude(system, userText, maxTokens = 2000, useWebSearch = false, meta = {}) {
  const supabase = await getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) throw new Error("Your session has expired. Please sign in again.");

  let res;
  try {
    res = await supabase.functions.invoke("ai-generate", {
      body: {
        system, userText: sanitizeText(userText), maxTokens, useWebSearch,
        requestType: meta.requestType || "unknown", applicationId: meta.applicationId || null, interviewId: meta.interviewId || null,
      },
    });
  } catch (networkErr) {
    throw new Error("Couldn't reach the AI service. Check your connection and try again.");
  }

  if (res.error) {
    // supabase-js surfaces non-2xx Edge Function responses here; try to read our own JSON error body for a clean message
    let msg = "Something went wrong on our end. Please try again.";
    try {
      const ctx = res.error.context;
      if (ctx && typeof ctx.json === "function") { const body = await ctx.json(); if (body?.error) msg = body.error; }
    } catch (e) { /* fall back to generic message below */ }
    if (/rate|busy|quickly/i.test(msg)) throw new Error(msg);
    if (/not authenticated|session/i.test(msg)) throw new Error("Your session has expired. Please sign in again.");
    throw new Error(msg);
  }

  const data = res.data;
  const truncated = data?.stop_reason === "max_tokens";
  const text = (data?.content || []).map((b) => b.text || "").join("\n");
  const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (e2) { /* fall through */ }
    }
    if (truncated) throw new Error("The AI's response was cut off before it finished. Try again.");
    throw new Error("Could not parse the AI's response. Please try again.");
  }
}

// AI output validation — the model is instructed to return strict JSON, but instructions
// aren't a guarantee. These coerce/clamp values so a malformed field (e.g. a score returned
// as "excellent" instead of a number, or a missing array) degrades gracefully instead of
// crashing rendering or corrupting stored performance data.
function num(v, fallback = 0, min = 0, max = 100) {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
function arr(v) { return Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined) : []; }
function str(v, fallback = "") { return typeof v === "string" ? v : (v == null ? fallback : String(v)); }
function bool(v, fallback = false) { return typeof v === "boolean" ? v : fallback; }
function scoreMap(obj) {
  const out = {};
  if (obj && typeof obj === "object") Object.entries(obj).forEach(([k, v]) => { out[k] = num(v, 0); });
  return out;
}
function validateEvaluation(e) {
  e = e || {};
  return {
    relevance: num(e.relevance), specificity: num(e.specificity), structure: num(e.structure),
    evidence: num(e.evidence), clarity: num(e.clarity), competency_demonstration: num(e.competency_demonstration),
    strengths: arr(e.strengths).map((s) => str(s)), issues: arr(e.issues).map((s) => str(s)),
  };
}
function validateReport(r) {
  r = r || {};
  const readinessOk = ["not_ready", "needs_improvement", "interview_ready", "strong"].includes(r.readiness);
  return {
    overall_score: num(r.overall_score),
    readiness: readinessOk ? r.readiness : "needs_improvement",
    breakdown: scoreMap(r.breakdown),
    strongest_areas: arr(r.strongest_areas).map((s) => str(s)),
    weakest_areas: arr(r.weakest_areas).map((s) => str(s)),
    per_question_feedback: arr(r.per_question_feedback).map((f) => ({
      question: str(f?.question), did_well: arr(f?.did_well).map((s) => str(s)), weakened_it: arr(f?.weakened_it).map((s) => str(s)),
      how_to_improve: str(f?.how_to_improve), note_on_missing_data: str(f?.note_on_missing_data),
    })),
    next_practice_focus: str(r.next_practice_focus),
    updated_candidate_weaknesses: arr(r.updated_candidate_weaknesses).map((s) => str(s)),
    updated_candidate_strengths: arr(r.updated_candidate_strengths).map((s) => str(s)),
    interview_style_notes: arr(r.interview_style_notes).map((s) => str(s)),
    classroom_topics: arr(r.classroom_topics).map((t) => ({
      topic: str(t?.topic), category: str(t?.category, "general"), description: str(t?.description),
      related_question: str(t?.related_question), initial_score: num(t?.initial_score),
    })).filter((t) => t.topic),
  };
}
function validateProfile(p) {
  p = p || {};
  const ip = p.interview_profile || {};
  const cp = p.candidate_profile || {};
  return {
    interview_profile: {
      company: str(ip.company), role: str(ip.role), division: str(ip.division), seniority: str(ip.seniority),
      responsibilities: arr(ip.responsibilities).map((s) => str(s)), required_skills: arr(ip.required_skills).map((s) => str(s)),
      preferred_skills: arr(ip.preferred_skills).map((s) => str(s)),
      competencies: arr(ip.competencies).map((c) => ({ name: str(c?.name), basis: ["explicit", "inferred", "general"].includes(c?.basis) ? c.basis : "general" })).filter((c) => c.name),
      technical_topics: arr(ip.technical_topics).map((s) => str(s)), behavioural_topics: arr(ip.behavioural_topics).map((s) => str(s)),
      commercial_topics: arr(ip.commercial_topics).map((s) => str(s)),
      // Phase 2A: normalize whatever category keys the AI returned (legacy
      // or canonical) into the canonical taxonomy. The AI-facing prompt
      // still asks for the legacy shape today (that's Phase 2B's prompt
      // change) — this just means downstream consumers only ever see
      // canonical keys, with values summed where multiple legacy keys
      // collapse onto the same canonical category.
      question_mix: normalizeCategoryMix(
        Object.keys(scoreMap(ip.question_mix)).length ? scoreMap(ip.question_mix) : { motivation_fit: 30, cv_behavioural: 25, role_specific: 20, technical: 15, commercial_awareness: 10 }
      ),
    },
    candidate_profile: {
      education: arr(cp.education).map((s) => str(s)), experience: arr(cp.experience).map((s) => str(s)),
      leadership: arr(cp.leadership).map((s) => str(s)), achievements: arr(cp.achievements).map((s) => str(s)),
      skills: arr(cp.skills).map((s) => str(s)), behavioural_examples: arr(cp.behavioural_examples).map((s) => str(s)),
      potential_probe_areas: arr(cp.potential_probe_areas).map((a) => ({ claim: str(a?.claim), why: str(a?.why) })).filter((a) => a.claim),
    },
    opening_question: {
      text: str(p.opening_question?.text, "Tell me about yourself and why you're interested in this role."),
      category: mapLegacyCategory(str(p.opening_question?.category, "motivation_fit")), competency: str(p.opening_question?.competency),
    },
  };
}
function validateNextTurn(n) {
  n = n || {};
  return {
    evaluation: validateEvaluation(n.evaluation),
    decision: str(n.decision, "follow_up"),
    next_question: { text: str(n.next_question?.text, "Can you tell me more about that?"), category: mapLegacyCategory(str(n.next_question?.category, "cv_behavioural")), competency: str(n.next_question?.competency) },
    interview_should_end: !!n.interview_should_end,
  };
}
function validateLesson(l) {
  l = l || {};
  return {
    title: str(l.title, "Lesson"), why_it_matters: str(l.why_it_matters),
    core_knowledge: arr(l.core_knowledge).map((k) => ({ point: str(k?.point), grounded: !!k?.grounded })).filter((k) => k.point),
    key_points: arr(l.key_points).map((s) => str(s)), example_answer_snippet: str(l.example_answer_snippet),
    interview_application: str(l.interview_application),
    quick_check: arr(l.quick_check).map((q) => ({ question: str(q?.question), options: arr(q?.options).map((s) => str(s)), correct_index: Number.isInteger(q?.correct_index) ? q.correct_index : 0, explanation: str(q?.explanation) })).filter((q) => q.question && q.options.length >= 2),
    grounding_note: str(l.grounding_note),
  };
}
function validateAcScenario(s) {
  s = s || {};
  return { title: str(s.title, "Exercise"), brief: str(s.brief), objective: str(s.objective), materials: arr(s.materials).map((m) => str(m)), suggested_time_minutes: num(s.suggested_time_minutes, 15, 1, 180) };
}
function validateAcResult(r) {
  r = r || {};
  return {
    overall_score: num(r.overall_score), breakdown: scoreMap(r.breakdown),
    did_well: arr(r.did_well).map((s) => str(s)), held_back: arr(r.held_back).map((s) => str(s)),
    classroom_topics: arr(r.classroom_topics).map((t) => ({ topic: str(t?.topic), category: str(t?.category, "general"), description: str(t?.description), related_question: str(t?.related_question), initial_score: num(t?.initial_score) })).filter((t) => t.topic),
    updated_candidate_weaknesses: arr(r.updated_candidate_weaknesses).map((s) => str(s)),
    updated_candidate_strengths: arr(r.updated_candidate_strengths).map((s) => str(s)),
  };
}

// Phase 4B: independent/batch interview engine validators.
// Exported (only this one) so it's directly unit-testable — see
// src/App.validators.test.js for the unrecognized-category regression test.
export function validateQuestionBatch(r, expectedCount) {
  r = r || {};
  const DIFFS = ["foundational", "intermediate", "advanced"];
  let questions = arr(r.questions).map((q) => ({
    text: str(q?.text),
    // Phase 2A: normalize legacy-or-canonical category into the canonical
    // taxonomy, preserving the pre-2A fallback semantics: an unrecognized/
    // invalid category historically defaulted to the legacy string
    // "role_specific", which canonically resolves to technical_functional
    // (see mapCategoryWithLegacyFallback in methodology.js) — so that
    // remains the end result here, reached through the mapping table
    // rather than a re-hardcoded legacy enum.
    category: mapCategoryWithLegacyFallback(q?.category, "role_specific"),
    competency: str(q?.competency),
    difficulty: DIFFS.includes(q?.difficulty) ? q.difficulty : "intermediate",
    is_technical: bool(q?.is_technical, false),
    role_relevance: str(q?.role_relevance),
    expected_answer_characteristics: str(q?.expected_answer_characteristics),
  })).filter((q) => q.text);
  if (expectedCount && questions.length > expectedCount) questions = questions.slice(0, expectedCount);
  return { questions };
}
function validateBatchEvaluation(r) {
  r = r || {};
  // Deliberately reuses validateEvaluation() per item — same rubric shape as the adaptive
  // pipeline (Phase 4 plan §4.2) rather than a fragmented, format-specific evaluation schema.
  return { evaluations: arr(r.evaluations).map((e) => validateEvaluation(e)) };
}

/* ================================================================== *
 * SUPABASE DATA ACCESS LAYER
 * Every table/column below was read directly from the live project
 * (dcltfxnzzfqjtctixlxe) via the Supabase MCP connection before this
 * was written — nothing here is guessed. RLS (ownership via auth.uid())
 * is enforced at the database level on all 17 tables and the storage
 * bucket, verified with real cross-user SQL tests during development.
 * ================================================================== */

async function dbSelect(table, build) {
  const supabase = await getSupabase();
  let q = supabase.from(table).select("*");
  if (build) q = build(q);
  const { data, error } = await q;
  if (error) { console.error(table, "select failed:", error.message); return []; }
  return data || [];
}

async function loadFullUserState(userId) {
  const supabase = await getSupabase();

  const [{ data: profile }, { data: dna }, apps, interviewsRaw, competencyRows, classroomTopicsRaw, memoryRows, comparisonRows, acAttemptsRaw] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("candidate_dna").select("*").eq("user_id", userId).maybeSingle(),
    dbSelect("applications", (q) => q.eq("user_id", userId).order("created_at", { ascending: false })),
    dbSelect("interviews", (q) => q.eq("user_id", userId).eq("status", "completed").order("completed_at", { ascending: true })),
    dbSelect("competency_history", (q) => q.eq("user_id", userId).order("created_at", { ascending: true })),
    dbSelect("classroom_topics", (q) => q.eq("user_id", userId).order("updated_at", { ascending: false })),
    dbSelect("interview_memory", (q) => q.eq("user_id", userId).order("created_at", { ascending: true })),
    dbSelect("memory_comparisons", (q) => q.eq("user_id", userId).order("created_at", { ascending: false })),
    dbSelect("assessment_attempts", (q) => q.eq("user_id", userId).order("created_at", { ascending: true })),
  ]);

  // interviewList needs each completed interview's report summary (company/role live on the application)
  const appById = new Map(apps.map((a) => [a.id, a]));
  let reportsByInterview = new Map();
  if (interviewsRaw.length) {
    const { data: reports } = await supabase.from("interview_reports").select("*").in("interview_id", interviewsRaw.map((i) => i.id));
    (reports || []).forEach((r) => reportsByInterview.set(r.interview_id, r));
  }
  const interviewList = interviewsRaw.map((iv) => {
    const app = appById.get(iv.application_id) || {};
    return { id: iv.id, applicationId: iv.application_id, company: app.company || "", role: app.role || "", date: new Date(iv.completed_at || iv.created_at).getTime(), overall_score: iv.overall_score, readiness: iv.readiness, breakdown: reportsByInterview.get(iv.id)?.breakdown || {} };
  });

  const competency_history = {};
  competencyRows.forEach((r) => { (competency_history[r.competency] = competency_history[r.competency] || []).push(r.score); });

  const classroom = classroomTopicsRaw.map((t) => ({ id: t.id, topic: t.topic, category: t.category, description: t.description, company: t.company, role: t.role, scores: Array.isArray(t.scores) ? t.scores : [], lastInterviewId: t.last_interview_id, relatedQuestion: t.related_question, applicationId: t.application_id }));

  const questionHistory = memoryRows.map((m) => ({ id: m.id, question: m.question_text, category: m.category, competency: m.competency, score: m.score, date: new Date(m.created_at).getTime(), company: m.company, role: m.role }));

  const memoryLog = comparisonRows.map((c) => ({ question: c.question_text, previous_score: c.previous_score, current_score: c.current_score, date: new Date(c.created_at).getTime() /* company/role not denormalised on this table; harmless if blank in the UI list */ }));

  const acAttempts = acAttemptsRaw.map((a) => ({ id: a.id, type: a.type, typeLabel: a.type_label, company: a.company, role: a.role, date: new Date(a.created_at).getTime(), overall_score: a.overall_score, breakdown: a.breakdown }));

  return {
    profile,
    perf: { strengths: dna?.strengths || [], weaknesses: dna?.weaknesses || [], competency_history, style_notes: dna?.style_notes || [], common_issues: dna?.common_issues || [] },
    interviewList, classroom, questionHistory, memoryLog, acAttempts,
  };
}

async function dbCreateApplication(userId, fields) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("applications").insert({ user_id: userId, ...fields }).select().single();
  if (error) throw new Error("Couldn't save your application details. Please try again.");
  return data;
}
async function dbUpdateApplication(applicationId, fields) {
  const supabase = await getSupabase();
  const { error } = await supabase.from("applications").update(fields).eq("id", applicationId);
  if (error) console.error("application update failed:", error.message);
}
async function dbInsertDocument(userId, applicationId, doc) {
  const supabase = await getSupabase();
  const { error } = await supabase.from("documents").insert({ user_id: userId, application_id: applicationId, document_type: doc.type, filename: doc.filename, storage_path: doc.storagePath || null, mime_type: doc.mimeType || null, file_size: doc.fileSize || null, extracted_text: doc.extractedText || null });
  if (error) console.error("document insert failed:", error.message);
}
async function dbUploadDocumentFile(userId, applicationId, file) {
  const supabase = await getSupabase();
  const path = `${userId}/${applicationId || "unfiled"}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) { console.error("storage upload failed:", error.message); return null; }
  return path;
}

async function dbCreateInterview(userId, applicationId, config) {
  const supabase = await getSupabase();
  // Phase 4A: persist the resolved stage/format/config (see resolveInterviewConfig above).
  // `config` may be omitted/undefined by any future caller — stage/format/config all stay
  // NULL in that case, which is exactly the legacy shape historical interview rows already
  // have, so no other code path needs a special case for "old vs new" interviews.
  const { data, error } = await supabase.from("interviews").insert({
    user_id: userId, application_id: applicationId, status: "in_progress", started_at: new Date().toISOString(),
    stage: config?.stage || null, format: config?.format || null, config: config || null,
  }).select().single();
  if (error) throw new Error("Couldn't start the interview. Please try again.");
  return data;
}
async function dbInsertQuestion(interviewId, questionNumber, q) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("interview_questions").insert({ interview_id: interviewId, question_number: questionNumber, question_text: q.text, category: q.category || null, competency: q.competency || null }).select().single();
  if (error) throw new Error("Couldn't save the next question. Please try again.");
  return data;
}
async function dbInsertAnswer(questionId, answerText, evaluation, decision) {
  const supabase = await getSupabase();
  const { data: answer, error: aErr } = await supabase.from("answers").insert({ question_id: questionId, answer_text: answerText }).select().single();
  if (aErr) throw new Error("Couldn't save your answer. Please try again.");
  const { error: eErr } = await supabase.from("evaluations").insert({ answer_id: answer.id, relevance: evaluation.relevance, specificity: evaluation.specificity, structure: evaluation.structure, evidence: evaluation.evidence, clarity: evaluation.clarity, competency_demonstration: evaluation.competency_demonstration, strengths: evaluation.strengths, issues: evaluation.issues, decision: decision || null });
  if (eErr) console.error("evaluation insert failed:", eErr.message);
  return answer;
}

// Phase 4B: independent/batch pipeline DB helpers. These never call dbInsertQuestion/
// dbInsertAnswer above (the adaptive pipeline's per-turn insert path) — the batch pipeline
// persists the whole question set up front, then persists each answer on its own with
// evaluation deferred until the batch evaluation call completes.
async function dbInsertQuestionBatch(interviewId, questions, meta) {
  const supabase = await getSupabase();
  const rows = questions.map((q, i) => ({
    interview_id: interviewId,
    question_number: i + 1,
    question_text: q.text,
    category: q.category || null,
    competency: q.competency || null,
    generation_mode: "independent",
    prep_seconds: Number.isFinite(meta?.prepSeconds) ? meta.prepSeconds : null,
    answer_seconds: Number.isFinite(meta?.answerSeconds) ? meta.answerSeconds : null,
    metadata: { difficulty: q.difficulty || null, is_technical: !!q.is_technical, role_relevance: q.role_relevance || null, expected_answer_characteristics: q.expected_answer_characteristics || null },
  }));
  const { data, error } = await supabase.from("interview_questions").insert(rows).select();
  if (error) throw new Error("Couldn't save the interview questions. Please try again.");
  return (data || []).slice().sort((a, b) => a.question_number - b.question_number);
}
async function dbInsertAnswerOnly(questionId, answerText, timeExpired) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("answers").insert({ question_id: questionId, answer_text: answerText, time_expired: !!timeExpired }).select().single();
  if (error) throw new Error("Couldn't save your answer. Please try again.");
  return data;
}
async function dbInsertEvaluationForAnswer(answerId, evaluation, decision) {
  const supabase = await getSupabase();
  const { error } = await supabase.from("evaluations").insert({ answer_id: answerId, relevance: evaluation.relevance, specificity: evaluation.specificity, structure: evaluation.structure, evidence: evaluation.evidence, clarity: evaluation.clarity, competency_demonstration: evaluation.competency_demonstration, strengths: evaluation.strengths, issues: evaluation.issues, decision: decision || null });
  if (error) console.error("evaluation insert failed:", error.message);
}

async function dbCompleteInterview(interviewId, report) {
  const supabase = await getSupabase();
  await supabase.from("interviews").update({ status: "completed", completed_at: new Date().toISOString(), overall_score: report.overall_score, readiness: report.readiness }).eq("id", interviewId);
  const { error } = await supabase.from("interview_reports").insert({
    interview_id: interviewId, overall_score: report.overall_score, readiness: report.readiness, breakdown: report.breakdown,
    strongest_areas: report.strongest_areas, weakest_areas: report.weakest_areas, per_question_feedback: report.per_question_feedback,
    next_practice_focus: report.next_practice_focus, updated_candidate_weaknesses: report.updated_candidate_weaknesses,
    updated_candidate_strengths: report.updated_candidate_strengths, interview_style_notes: report.interview_style_notes, classroom_topics: report.classroom_topics,
  });
  if (error) console.error("report insert failed:", error.message);
}
async function dbInsertMemory(userId, interviewId, entry) {
  const supabase = await getSupabase();
  const { error } = await supabase.from("interview_memory").insert({ user_id: userId, interview_id: interviewId, question_text: entry.question, category: entry.category, competency: entry.competency, score: entry.score, company: entry.company, role: entry.role, answer_text: entry.answerText || null });
  if (error) console.error("memory insert failed:", error.message);
}
async function dbInsertMemoryComparison(userId, interviewId, c) {
  const supabase = await getSupabase();
  const { error } = await supabase.from("memory_comparisons").insert({ user_id: userId, interview_id: interviewId, question_text: c.question, previous_memory_id: c.previousMemoryId || null, previous_score: c.previous_score, current_score: c.current_score, improvement: (c.current_score ?? 0) - (c.previous_score ?? 0) });
  if (error) console.error("memory comparison insert failed:", error.message);
}
async function dbInsertCompetencyHistory(userId, competency, score, sourceType, sourceId, company, role) {
  const supabase = await getSupabase();
  const { error } = await supabase.from("competency_history").insert({ user_id: userId, competency, score, source_type: sourceType, source_id: sourceId || null, company: company || null, role: role || null });
  if (error) console.error("competency history insert failed:", error.message);
}
async function dbUpsertCandidateDna(userId, { strengths, weaknesses, style_notes, common_issues }) {
  const supabase = await getSupabase();
  const { error } = await supabase.from("candidate_dna").upsert({ user_id: userId, strengths, weaknesses, style_notes, common_issues, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) console.error("candidate_dna upsert failed:", error.message);
}
async function dbUpsertClassroomTopic(userId, applicationId, interviewIdOrNull, existingId, topic) {
  const supabase = await getSupabase();
  if (existingId) {
    const { data: current } = await supabase.from("classroom_topics").select("scores").eq("id", existingId).single();
    const newScores = [...((current && current.scores) || []), topic.initial_score || 0];
    const updateFields = { scores: newScores, description: topic.description, related_question: topic.related_question, updated_at: new Date().toISOString() };
    if (interviewIdOrNull) updateFields.last_interview_id = interviewIdOrNull; // only overwrite when we have a real interviews.id (FK-constrained)
    const { error } = await supabase.from("classroom_topics").update(updateFields).eq("id", existingId);
    if (error) console.error("classroom_topics update failed:", error.message);
    return existingId;
  }
  const { data, error } = await supabase.from("classroom_topics").insert({ user_id: userId, application_id: applicationId, company: topic.company, role: topic.role, topic: topic.topic, category: topic.category || "general", description: topic.description, related_question: topic.related_question, scores: [topic.initial_score || 0], last_interview_id: interviewIdOrNull || null }).select().single();
  if (error) { console.error("classroom_topics insert failed:", error.message); return null; }
  return data.id;
}
async function dbInsertClassroomLesson(topicId, lesson) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("classroom_lessons").insert({ topic_id: topicId, title: lesson.title, why_it_matters: lesson.why_it_matters, core_knowledge: lesson.core_knowledge, key_points: lesson.key_points, example_answer_snippet: lesson.example_answer_snippet, interview_application: lesson.interview_application, quick_check: lesson.quick_check, grounding_note: lesson.grounding_note }).select().single();
  if (error) { console.error("classroom_lessons insert failed:", error.message); return null; }
  return data;
}
async function dbGetClassroomLesson(topicId) {
  const supabase = await getSupabase();
  const { data } = await supabase.from("classroom_lessons").select("*").eq("topic_id", topicId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}
async function dbGetQuizResult(topicId, userId) {
  const supabase = await getSupabase();
  const { data } = await supabase.from("classroom_quiz_results").select("*").eq("topic_id", topicId).eq("user_id", userId).order("completed_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}
async function dbUpsertQuizResult(userId, topicId, lessonId, answers, score, total) {
  const supabase = await getSupabase();
  const { error } = await supabase.from("classroom_quiz_results").upsert(
    { user_id: userId, topic_id: topicId, lesson_id: lessonId, answers, score, total, completed_at: new Date().toISOString() },
    { onConflict: "user_id,topic_id" }
  );
  if (error) console.error("quiz result upsert failed:", error.message);
}
async function dbInsertAssessmentAttempt(userId, applicationId, attempt) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("assessment_attempts").insert({ user_id: userId, application_id: applicationId, type: attempt.type, type_label: attempt.typeLabel, company: attempt.company, role: attempt.role, overall_score: attempt.overall_score, breakdown: attempt.breakdown, scenario: attempt.scenario, submission: attempt.submission, result: attempt.result }).select().single();
  if (error) { console.error("assessment_attempts insert failed:", error.message); return null; }
  return data;
}

/* ------------------------------------------------------------------ */
/* DEMO DATA                                                            */
/* ------------------------------------------------------------------ */
const DEMO_JD = `Global Markets Summer Analyst — JPMorgan, London

The Global Markets Summer Analyst programme places you within one of our Sales, Trading or Research desks for a 10-week rotation. You will support senior desk staff with market analysis, client preparation materials, and trade lifecycle tasks, while completing a structured training curriculum covering fixed income, equities, FX and derivatives.

Key responsibilities:
- Assist traders and salespeople with daily market colour and client queries
- Build pricing and risk summaries for vanilla and structured products
- Monitor macro news flow and summarise implications for desk positioning
- Support onboarding of client trades and reconciliation with middle office
- Participate in trading simulations and technical training modules

What we look for:
- Strong quantitative aptitude and interest in financial markets
- Excellent communication skills, comfortable under pressure
- Demonstrated commercial awareness — you follow markets and can discuss recent developments
- Team-oriented, resilient, able to work in a fast-paced desk environment
- Preferred: prior markets internship, relevant coursework in finance/economics/maths, or trading competition experience`;

const DEMO_CV = `Alex Chen
BSc Economics, University College London — Expected 2027, First Class (predicted)

Experience:
Summer Insight Programme, Barclays Markets — July 2025 (1 week)
- Shadowed FX spot trading desk; completed a mock trading simulation ranking in top 3 of cohort
- Presented a macro trade idea on GBP/USD to desk head

Investment Society, UCL — Analyst, Sept 2024–present
- Managed a team of 6 analysts producing a weekly markets newsletter distributed to 400+ students
- Improved newsletter open rate from 22% to 41% by restructuring content and send timing

Retail Assistant, Zara — June 2023–Sept 2024 (part-time)
- Consistently exceeded weekly sales targets by ~15%

Leadership:
Treasurer, UCL Economics Society — managed a termly budget of £3,000

Skills: Excel (financial modelling), Python (basic), Bloomberg Terminal (training completed)

Achievements: Winner, UCL Trading Competition (equities track), 2025`;

/* ================================================================== */
/* ASSESSMENT CENTRE CONFIG                                             */
/* ================================================================== */
const EXERCISE_TYPES = [
  { key: "group", label: "Group Exercise", icon: Users, blurb: "Work through a scenario with simulated teammates and reach a group recommendation.",
    competencies: ["Communication", "Leadership", "Collaboration", "Commercial reasoning", "Contribution quality"] },
  { key: "case", label: "Case Study", icon: Briefcase, blurb: "Analyse a business problem and recommend a course of action.",
    competencies: ["Structure", "Reasoning", "Commercial awareness", "Conclusion quality"] },
  { key: "presentation", label: "Presentation", icon: Mic, blurb: "Prepare and write out a short recommendation as if presenting it.",
    competencies: ["Structure", "Clarity", "Persuasiveness", "Commercial reasoning"] },
  { key: "written", label: "Written Exercise", icon: FileText, blurb: "Produce a professional written output under time pressure.",
    competencies: ["Accuracy", "Structure", "Conciseness", "Professionalism", "Reasoning"] },
  { key: "inbox", label: "Inbox Exercise", icon: Mail, blurb: "Prioritise a stack of competing tasks and justify your order.",
    competencies: ["Prioritisation", "Judgement", "Risk awareness", "Communication"] },
];
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }

/* ================================================================== *
 * PHASE 4A — INTERVIEW CONFIGURATION FOUNDATION
 * ------------------------------------------------------------------
 * Establishes the STAGE/FORMAT split identified in the interview-generation
 * audit: previously "stage" and "itype" were two freeform strings that only
 * ever reached the initial profile-generation call as one line of text, then
 * vanished from the AI's context for the rest of the interview. This catalog
 * (same pattern as EXERCISE_TYPES above, which already works well for
 * Assessment Centre) makes format-specific behaviour a resolvable, code-level
 * CONFIGURATION rather than an unenforced label — the foundation the next
 * phase (the independent/batch HireVue engine) will build on.
 *
 * IMPORTANT — Phase 4A SCOPE: this catalog is deliberately declarative only.
 * `submitAnswer` (interview_turn) and `finishInterview` (interview_report)
 * are NOT modified to branch on this config yet — every interview, of every
 * stage/format, still runs through today's existing adaptive engine exactly
 * as before. `pipeline` below documents which engine each format WILL use
 * once Phase 4B (the independent_batch engine) is built; in 4A only
 * "adaptive_turn" is actually wired up. Nothing here changes runtime
 * question-generation or evaluation behaviour.
 *
 * A STAGE is a point in a real recruitment process (what the candidate is
 * actually facing). A FORMAT is how that interview is delivered. Some stages
 * can plausibly go either way (a recruiter screen or a first round can be
 * live OR an async video link) — that's `allowedFormats` below — so we do
 * NOT hard-code every stage x format combination; a stage just carries a
 * sensible default format plus optional overrides merged on top of it.
 * ================================================================== */
const INTERVIEW_FORMATS = {
  asynchronous_video: {
    label: "Asynchronous video (HireVue-style)",
    blurb: "Independent, pre-set questions with prep and answer time — no live follow-ups.",
    pipeline: "independent_batch", // NOT implemented until Phase 4B — declarative only in 4A
    adaptive_level: "none",
    followups_enabled: false,
    challenge_enabled: false,
    question_independence: "independent",
    // "CV-informed but not CV-chasing": the CV still provides background context and
    // controlled personalisation for question generation — it is NOT excluded — but it must
    // never drive a live, per-answer follow-up chain the way it does in the adaptive engine.
    // "background_context" signals a deliberately lighter-touch use of candidate_profile
    // (headline facts, not the full behavioural_examples/potential_probe_areas detail the
    // adaptive engine leans on) — the actual data-shaping happens when Phase 4B builds the
    // batch-question call; this field just records the intent so that build starts from the
    // right premise instead of re-litigating "excluded vs informed".
    cv_weight: "background_context",
    jd_weight: "high",
    motivation_weight: 30, behavioural_weight: 25, technical_weight: 15, commercial_weight: 20, role_specific_weight: 10,
    question_count: 8,
    preparation_time: 45, // seconds; null = untimed
    answer_time: 120,     // seconds; null = untimed
    evaluation_framework: "standard_rubric", // all formats share one rubric today (validateEvaluation) — see Phase 4 plan §4.2
  },
  live_conversational: {
    label: "Live conversational",
    blurb: "Adaptive back-and-forth — follow-ups, clarification, challenge.",
    pipeline: "adaptive_turn", // == today's existing, unmodified engine (submitAnswer/interview_turn)
    adaptive_level: "moderate",
    followups_enabled: true,
    challenge_enabled: true,
    question_independence: "chained",
    cv_weight: "full",
    jd_weight: "high",
    motivation_weight: 20, behavioural_weight: 30, technical_weight: 15, commercial_weight: 15, role_specific_weight: 20,
    question_count: 12,
    preparation_time: null,
    answer_time: null,
    evaluation_framework: "standard_rubric",
  },
  technical: {
    label: "Technical",
    blurb: "Adaptive, technical-weighted questioning drawn from role-specific topics.",
    pipeline: "adaptive_turn",
    adaptive_level: "moderate",
    followups_enabled: true,
    challenge_enabled: true,
    question_independence: "chained",
    cv_weight: "moderate",
    jd_weight: "high",
    motivation_weight: 10, behavioural_weight: 15, technical_weight: 50, commercial_weight: 10, role_specific_weight: 15,
    question_count: 10,
    preparation_time: null,
    answer_time: null,
    evaluation_framework: "standard_rubric",
  },
};

const INTERVIEW_STAGES = [
  {
    key: "recruiter_screen", label: "Recruiter / HR Screen",
    blurb: "Motivation, fit and logistics — usually the first conversation.",
    defaultFormat: "asynchronous_video", allowedFormats: ["asynchronous_video", "live_conversational"],
    overrides: { question_count: 5, motivation_weight: 45, behavioural_weight: 20, technical_weight: 5, commercial_weight: 25, role_specific_weight: 5, preparation_time: 20, answer_time: 90 },
  },
  {
    key: "first_round", label: "First Round",
    blurb: "The standard first interview for the role.",
    defaultFormat: "live_conversational", allowedFormats: ["live_conversational", "asynchronous_video"],
    overrides: null,
  },
  {
    key: "technical", label: "Technical Interview",
    blurb: "Technical-weighted, role-specific questioning.",
    defaultFormat: "technical", allowedFormats: ["technical"],
    overrides: null,
  },
  {
    key: "final_round", label: "Final Round / Superday",
    blurb: "Deeper, more assertive — strong CV and technical usage.",
    defaultFormat: "live_conversational", allowedFormats: ["live_conversational"],
    overrides: { adaptive_level: "high", question_count: 15, motivation_weight: 15, behavioural_weight: 25, technical_weight: 25, commercial_weight: 15, role_specific_weight: 20, cv_weight: "full" },
  },
];
// Note: Assessment Centre is deliberately NOT a stage/format here — it is a separate,
// dedicated engine (EXERCISE_TYPES/generateAcScenario/submitAcResponse) with its own entry
// point (the "Assessment Centre" nav item -> screen "ac_home"). Phase 4A removes the old
// "Assessment Centre" option from this normal interview builder's stage list entirely,
// rather than representing it in this catalog, so there is no path by which selecting it
// here could ever reach the wrong engine again.

function stageByKey(key) { return INTERVIEW_STAGES.find((s) => s.key === key) || INTERVIEW_STAGES[1]; }

// Resolves a stage + optional format override into a full, concrete configuration object.
// Stage-level `overrides` are merged on top of the chosen format's base config — this is
// deliberately NOT a full stage x format matrix (the audit's plan explicitly called that out
// as unnecessary complexity); most stages just need a sensible default plus a handful of
// tweaked weights/timing, not a wholly separate config.
function resolveInterviewConfig(stageKey, formatKeyOverride) {
  const stage = stageByKey(stageKey);
  const formatKey = (formatKeyOverride && stage.allowedFormats.includes(formatKeyOverride)) ? formatKeyOverride : stage.defaultFormat;
  const base = INTERVIEW_FORMATS[formatKey];
  const resolved = { ...base, ...(stage.overrides || {}), stage: stage.key, format: formatKey };
  return resolved;
}

/* ================================================================== *
 * PHASE 4B: INDEPENDENT / BATCH INTERVIEW ENGINE (AI CALLS)
 * Two new AI calls, both routed through the existing callClaude() so they get
 * ai_usage logging + api_usage_limits rate-limiting for free, same as every
 * other call in this file. Neither of these ever feeds into interview_turn,
 * and interview_turn is never called anywhere in this section.
 * ================================================================== */

// "CV-informed but not CV-chasing": deliberately expose only headline candidate facts
// to the batch question generator — never the full behavioural_examples /
// potential_probe_areas detail the adaptive engine leans on to build live follow-ups.
// This keeps the *data itself* lighter-touch, not just a prompt instruction, so the
// independent pipeline structurally can't build a CV-chasing chain even by accident.
function cvBackgroundSummary(candidateProfile) {
  const cp = candidateProfile || {};
  return {
    education: arr(cp.education).map((s) => str(s)),
    experience: arr(cp.experience).map((s) => str(s)),
    skills: arr(cp.skills).map((s) => str(s)),
  };
}

function buildQuestionBatchPrompt(config, interviewProfile, cvBackground, jdText, weaknessNote) {
  const stageLabel = stageByKey(config.stage).label;
  const formatLabel = INTERVIEW_FORMATS[config.format].label;
  const system = `You are an expert interview designer building a COMPLETE, FIXED set of independent interview questions for an asynchronous, one-way video interview (${stageLabel} — ${formatLabel}). Every question must be answerable entirely on its own, with zero dependency on any other question or its answer — this set is generated once, in full, before the candidate sees question 1, and none of it changes based on how they answer.

Return strict JSON only, no prose, no markdown fences, in this exact shape:
{
  "questions": [
    {
      "text": "",
      "category": "motivation_fit|cv_behavioural|role_specific|technical|commercial_awareness",
      "competency": "",
      "difficulty": "foundational|intermediate|advanced",
      "is_technical": false,
      "role_relevance": "one sentence on why this question matters for this specific role",
      "expected_answer_characteristics": "one sentence on what a strong answer would contain, to guide evaluation later"
    }
  ]
}

Rules:
- Generate exactly ${config.question_count} questions.
- Target composition (approximate weighting, not a rigid quota): motivation ${config.motivation_weight}%, behavioural ${config.behavioural_weight}%, technical ${config.technical_weight}%, commercial awareness ${config.commercial_weight}%, role-specific ${config.role_specific_weight}%.
- Only mark "is_technical": true, and only include a genuinely technical question, where THIS SPECIFIC role actually requires technical assessment at THIS stage. Do NOT include technical questions just because the role sounds finance-related or technical-sounding — judge from the actual job description, division, and stage. A recruiter/HR screen in particular should very rarely, if ever, include a technical question.
- The candidate's background below is BACKGROUND CONTEXT ONLY, for light, natural personalisation (e.g. referencing something real they listed). Do NOT build any question that only makes sense given a specific expected answer to an earlier question — every question must be self-contained and independently gradable, with no chain: question 2 must not depend on how question 1 might be answered, question 3 must not depend on question 2, and so on for the entire set.
- Vary categories and difficulty sensibly across the set rather than clustering.`;

  const userText = `${weaknessNote}\n\nInterview stage: ${stageLabel}\nInterview format: ${formatLabel}\n\nInterview profile (from JD analysis): ${JSON.stringify(interviewProfile)}\n\nCandidate background (context only — do not chain questions off this): ${JSON.stringify(cvBackground)}\n\nJob description:\n${jdText}`;
  return { system, userText };
}

async function generateQuestionBatch(config, interviewProfile, cvBackground, jdText, weaknessNote, meta) {
  const { system, userText } = buildQuestionBatchPrompt(config, interviewProfile, cvBackground, jdText, weaknessNote);
  const maxTokens = Math.min(7500, 1200 + config.question_count * 350);
  const raw = await callClaude(system, userText, maxTokens, false, { ...meta, requestType: "interview_question_batch" });
  return validateQuestionBatch(raw, config.question_count);
}

function buildBatchEvaluationPrompt(config, interviewProfile, cvBackground, questions, answers) {
  const stageLabel = stageByKey(config.stage).label;
  const system = `You are a real, professional interviewer scoring a completed asynchronous (${stageLabel}) interview HOLISTICALLY, after the fact. This is NOT a live conversational interview — there were no follow-ups, no clarifying questions, and no chance for the candidate to be redirected. Evaluate accordingly:
- Do NOT penalise the candidate for a lack of conversational depth, follow-up handling, or dynamic back-and-forth — that is structurally impossible in this format and is not a fair criticism here.
- Only assess technical accuracy or rigour on questions explicitly marked "is_technical": true in the input below. Do not invent technical weaknesses when the question set contains no technical questions.
- If an answer is blank or near-blank, score it honestly and low — do not invent content the candidate never gave.
- If a question's "time_expired" flag is true, treat the answer as cut short by a hard time limit: note this as a possible factor rather than silently scoring it as if the candidate simply chose to give a short answer.

Return strict JSON only, no prose, in this exact shape:
{
  "evaluations": [
    { "relevance": 0, "specificity": 0, "structure": 0, "evidence": 0, "clarity": 0, "competency_demonstration": 0, "strengths": [""], "issues": [""] }
  ]
}
Return exactly one evaluation object per question, in the SAME ORDER as the questions are listed below.`;

  const userText = `Interview stage: ${stageLabel}\nInterview profile: ${JSON.stringify(interviewProfile)}\nCandidate background (context only): ${JSON.stringify(cvBackground)}\n\nQuestions and answers, in order:\n${JSON.stringify(questions.map((q, i) => ({
    index: i + 1, question: q.text, category: q.category, competency: q.competency, is_technical: q.is_technical,
    expected_answer_characteristics: q.expected_answer_characteristics, answer: answers[i]?.text ?? "", time_expired: !!answers[i]?.timeExpired,
  })))}`;
  return { system, userText };
}

async function generateBatchEvaluation(config, interviewProfile, cvBackground, questions, answers, meta) {
  const { system, userText } = buildBatchEvaluationPrompt(config, interviewProfile, cvBackground, questions, answers);
  const maxTokens = Math.min(7500, 1500 + questions.length * 380);
  const raw = await callClaude(system, userText, maxTokens, false, { ...meta, requestType: "interview_batch_evaluation" });
  const result = validateBatchEvaluation(raw);
  // Defensive: pad/truncate to exactly questions.length so downstream indexed access
  // (matching evaluation[i] back to question[i]/answer[i]) can never go out of bounds.
  while (result.evaluations.length < questions.length) result.evaluations.push(validateEvaluation(null));
  if (result.evaluations.length > questions.length) result.evaluations = result.evaluations.slice(0, questions.length);
  return result;
}

/* ------------------------------------------------------------------ */
/* PDF TEXT EXTRACTION — dynamically loads pdf.js from cdnjs at runtime */
/* (no npm dependency available for this), so real PDF parsing works   */
/* without a bundled library.                                          */
/* ------------------------------------------------------------------ */
let pdfjsLoadPromise = null;
function loadPdfJs() {
  if (typeof window !== "undefined" && window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfjsLoadPromise) return pdfjsLoadPromise;
  pdfjsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    // Pinned to the latest pdf.js release that still ships the classic UMD
    // "pdf.min.js" / "pdf.worker.min.js" build on cdnjs. From 4.x onward,
    // cdnjs only publishes ESM ("pdf.min.mjs") builds, which 404 when loaded
    // as a classic <script> tag the way this loader works — verified live
    // against cdnjs before making this change (4.0.379's file list contains
    // only pdf.min.mjs / pdf.worker.min.mjs, no .js UMD build).
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      } catch (e) { pdfjsLoadPromise = null; reject(e); }
    };
    // On failure, clear the cached promise so a later retry (new upload
    // attempt, "try again") actually re-fetches the script instead of
    // permanently replaying this one rejection for the rest of the session.
    script.onerror = () => { pdfjsLoadPromise = null; reject(new Error("pdf-loader-failed")); };
    document.head.appendChild(script);
  });
  return pdfjsLoadPromise;
}
async function extractPdfText(arrayBuffer) {
  let pdfjsLib;
  try {
    pdfjsLib = await loadPdfJs();
  } catch (e) {
    throw new Error("We couldn't load the PDF reader (likely a network/connectivity issue). Please try again, or paste the text directly.");
  }
  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  } catch (e) {
    const msg = (e && e.name) || (e && e.message) || "";
    if (/password/i.test(msg)) throw new Error("This PDF is password-protected. Please remove the password, or paste the text directly.");
    throw new Error("This PDF couldn't be read — it may be corrupted or in an unusual format. Please try another file or paste the text directly.");
  }
  let text = "";
  const maxPages = Math.min(pdf.numPages || 1, 40); // guard against pathologically large files
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str || "").join(" ") + "\n\n";
  }
  return text;
}

/* ------------------------------------------------------------------ */
/* INTERVIEW MEMORY — pure helper, no state needed                     */
/* ------------------------------------------------------------------ */
const MEMORY_STOPWORDS = new Set(["tell", "describe", "give", "example", "about", "when", "time", "occasion", "situation", "where", "that", "this", "have", "your", "you", "did", "had", "been", "were", "being", "which", "what", "would", "could", "should", "from", "with", "into", "onto", "some", "most", "during", "while"]);
const MEMORY_SYNONYMS = {
  lead: "lead", leader: "lead", leading: "lead", leadership: "lead", led: "lead",
  team: "team", teams: "team", teamwork: "team",
  manage: "manage", managed: "manage", managing: "manage", management: "manage", manager: "manage",
  conflict: "conflict", disagreement: "conflict", dispute: "conflict", clash: "conflict",
  fail: "fail", failed: "fail", failure: "fail", mistake: "fail", mistakes: "fail",
  challenge: "challenge", challenging: "challenge", challenged: "challenge", difficult: "challenge", difficulty: "challenge",
  motivate: "motivate", motivated: "motivate", motivation: "motivate", motivating: "motivate",
  weakness: "weak", weaknesses: "weak", weak: "weak",
  strength: "strong", strengths: "strong", strong: "strong",
  pressure: "pressure", stress: "pressure", stressful: "pressure",
  communicate: "communicate", communication: "communicate", communicating: "communicate",
  decision: "decide", decisions: "decide", decide: "decide", decided: "decide",
};
function memoryStem(w) {
  if (MEMORY_SYNONYMS[w]) return MEMORY_SYNONYMS[w];
  if (w.length > 6 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 5 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}
function normWords(s) {
  return new Set(
    (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/)
      .filter((w) => w.length > 3 && !MEMORY_STOPWORDS.has(w))
      .map(memoryStem)
  );
}
function matchPreviousQuestion(qText, category, competency, history) {
  if (!qText || !history || !history.length) return null;
  const words = normWords(qText);
  if (!words.size) return null;
  let best = null, bestScore = 0;
  for (const h of history) {
    if (h.category !== category && h.competency !== competency) continue;
    const hw = normWords(h.question);
    let overlap = 0;
    for (const w of words) if (hw.has(w)) overlap++;
    const score = overlap / Math.max(3, Math.min(words.size, hw.size || 1));
    if (score > bestScore) { bestScore = score; best = h; }
  }
  return bestScore >= 0.35 ? best : null;
}

/* ================================================================== */
/* BRAND: LOGO                                                          */
/* ================================================================== */
function JobReadyLogo({ variant = "full", background = "light", size = 28 }) {
  const dark = background === "dark";
  const monochrome = variant === "monochrome";
  const markBg = monochrome ? (dark ? "#FFFFFF" : "var(--navy)") : "linear-gradient(135deg, var(--blue), var(--violet))";
  const arrowColor = monochrome ? (dark ? "var(--navy)" : "#FFFFFF") : "#FFFFFF";
  const textColor = monochrome ? (dark ? "#FFFFFF" : "var(--navy)") : (dark ? "#FFFFFF" : "var(--navy)");

  const Mark = (
    <div style={{ width: size, height: size, borderRadius: size * 0.28, background: markBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none">
        <circle cx="5" cy="19" r="2.4" fill={arrowColor} opacity="0.55" />
        <path d="M6 18L18 6" stroke={arrowColor} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M10 6H18V14" stroke={arrowColor} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
  if (variant === "mark") return Mark;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      {Mark}
      <span style={{ fontFamily: "var(--font)", fontWeight: 800, fontSize: size * 0.62, color: textColor, letterSpacing: "-0.01em" }}>
        JOB<span style={{ color: monochrome ? textColor : "var(--blue)" }}>.</span>READY
      </span>
    </div>
  );
}

/* ================================================================== */
/* SHARED UI PRIMITIVES                                                 */
/* ================================================================== */
function Btn({ children, onClick, disabled, variant = "primary", style, full }) {
  const base = { fontFamily: "var(--font)", fontSize: 14.5, fontWeight: 600, border: "none", cursor: disabled ? "not-allowed" : "pointer", padding: "12px 22px", borderRadius: "var(--radius-sm)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, width: full ? "100%" : "auto" };
  const variants = {
    primary: { background: disabled ? "#CBD5E1" : "var(--navy)", color: "#fff" },
    accent: { background: disabled ? "#CBD5E1" : "var(--blue)", color: "#fff" },
    secondary: { background: "#fff", color: "var(--navy)", border: "1.5px solid var(--border)" },
    ghost: { background: "transparent", color: "var(--text-dim)" },
  };
  return <button className="jr-btn" onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}>{children}</button>;
}

function Card({ children, style, hover = true, onClick }) {
  return <div className={hover ? "jr-card" : ""} onClick={onClick} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-sm)", ...style }}>{children}</div>;
}

function Pill({ children, color = "var(--blue)", bg = "var(--highlight)" }) {
  return <span style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 600, color, background: bg, padding: "4px 11px", borderRadius: 999, display: "inline-block" }}>{children}</span>;
}

function ScoreBar({ label, value, max = 100, color }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const c = color || (pct >= 75 ? "var(--good)" : pct >= 50 ? "var(--blue)" : "var(--warn)");
  return (
    <div className="mb-3">
      <div className="flex justify-between items-baseline mb-1">
        <span style={{ fontSize: 13, color: "var(--text-dim)", textTransform: "capitalize" }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{value}</span>
      </div>
      <div style={{ height: 7, background: "#EEF2F7", borderRadius: 999 }}>
        <div className="jr-bar" style={{ height: 7, width: pct + "%", background: c, borderRadius: 999 }} />
      </div>
    </div>
  );
}

function RingScore({ value, size = 148, label }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const color = pct >= 75 ? "var(--good)" : pct >= 50 ? "var(--blue)" : "var(--warn)";
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#EEF2F7" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: size * 0.24, fontWeight: 800, color: "var(--navy)", lineHeight: 1 }}>{value}</div>
        {label && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{label}</div>}
      </div>
    </div>
  );
}

function TagBasis({ basis }) {
  const map = {
    explicit: { label: "From JD", color: "var(--good)", bg: "#E7F8F1" },
    inferred: { label: "Inferred", color: "var(--blue)", bg: "var(--highlight)" },
    general: { label: "General for role", color: "var(--text-dim)", bg: "#F1F5F9" },
  };
  const m = map[basis] || map.general;
  return <span style={{ fontSize: 11, fontWeight: 600, color: m.color, background: m.bg, padding: "2px 8px", borderRadius: 999, marginLeft: 8 }}>{m.label}</span>;
}

function LoadingScreen({ messages }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => { const t = setInterval(() => setIdx((i) => (i + 1) % messages.length), 1300); return () => clearInterval(t); }, [messages]);
  return (
    <div className="flex flex-col items-center justify-center" style={{ minHeight: 440 }}>
      <div style={{ width: 52, height: 52, borderRadius: 16, background: "linear-gradient(135deg, var(--blue), var(--violet))", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 22 }}>
        <Loader2 className="animate-spin" size={24} color="#fff" />
      </div>
      <div className="jr-fade" key={idx} style={{ fontSize: 17, fontWeight: 600, color: "var(--navy)" }}>{messages[idx]}</div>
    </div>
  );
}

function NavBar({ screen, setScreen, user, classroomNeedsWorkCount, onSignOut }) {
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 768 : false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth < 768); }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => { setMenuOpen(false); }, [screen]);

  const links = user
    ? [{ label: "Dashboard", to: "dashboard" }, { label: "Classroom", to: "classroom" }, { label: "Assessment Centre", to: "ac_home" }, { label: "Progress", to: "progress" }]
    : [{ label: "How it works", to: "how" }, { label: "For universities", to: "universities" }];

  return (
    <div style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(248,250,252,0.95)", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--border)" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ cursor: "pointer" }} onClick={() => setScreen(user ? "dashboard" : "landing")}>
          <JobReadyLogo size={26} />
        </div>

        {!isMobile && (
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            {links.map((l) => (
              <span key={l.to} onClick={() => setScreen(l.to)} style={{ fontSize: 13.5, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: screen === l.to ? "var(--navy)" : "var(--text-dim)" }}>
                {l.label}
                {l.to === "classroom" && classroomNeedsWorkCount > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "var(--blue)", borderRadius: 999, padding: "1px 7px" }}>{classroomNeedsWorkCount}</span>
                )}
              </span>
            ))}
            {!user && (
              <>
                <span onClick={() => setScreen("login")} style={{ fontSize: 14, fontWeight: 500, color: "var(--text-dim)", cursor: "pointer" }}>Log in</span>
                <Btn variant="accent" onClick={() => setScreen("login")}>Start practising</Btn>
              </>
            )}
            {user && (
              <span onClick={onSignOut} style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-dim)", cursor: "pointer" }}>Sign out</span>
            )}
          </div>
        )}

        {isMobile && (
          <button aria-label={menuOpen ? "Close menu" : "Open menu"} onClick={() => setMenuOpen((v) => !v)} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, display: "flex" }}>
            {menuOpen ? <X size={22} color="var(--navy)" /> : <Menu size={22} color="var(--navy)" />}
          </button>
        )}
      </div>

      {isMobile && menuOpen && (
        <div style={{ borderTop: "1px solid var(--border)", background: "#fff", padding: "4px 24px 16px" }}>
          {links.map((l) => (
            <div key={l.to} onClick={() => setScreen(l.to)} style={{ padding: "14px 0", fontSize: 15, fontWeight: 500, color: screen === l.to ? "var(--navy)" : "var(--text-dim)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
              {l.label}
              {l.to === "classroom" && classroomNeedsWorkCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "var(--blue)", borderRadius: 999, padding: "1px 7px" }}>{classroomNeedsWorkCount}</span>
              )}
            </div>
          ))}
          {!user ? (
            <div style={{ paddingTop: 14 }}>
              <Btn variant="accent" full onClick={() => setScreen("login")}>Start practising</Btn>
            </div>
          ) : (
            <div onClick={onSignOut} style={{ padding: "14px 0", fontSize: 15, fontWeight: 500, color: "var(--text-dim)", cursor: "pointer" }}>Sign out</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* ERROR BOUNDARY — normal use must never show a blank/crashed screen   */
/* ================================================================== */
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err, info) { console.error("JOB.READY error boundary caught:", err, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ fontFamily: "var(--font)", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", background: "var(--bg)" }}>
          <style>{TOKENS}</style>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
            <AlertCircle size={22} color="var(--bad)" />
          </div>
          <div style={{ fontSize: 19, fontWeight: 800, color: "var(--navy)", marginBottom: 8 }}>Something went wrong.</div>
          <div style={{ fontSize: 14, color: "var(--text-dim)", marginBottom: 22, maxWidth: 380 }}>This screen hit an unexpected error. Your saved data is untouched.</div>
          <Btn variant="primary" onClick={() => this.setState({ hasError: false })}>Try again</Btn>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ================================================================== */
/* MAIN APP                                                             */
/* ================================================================== */
function App() {
  const [screen, setScreen] = useState("landing");
  const [user, setUser] = useState(null); // { id, email, first_name, last_name }
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false); // true once initial session restore attempt has completed
  const [authView, setAuthView] = useState("signin"); // "signin" | "signup" | "forgot" | "reset"
  const [firstNameInput, setFirstNameInput] = useState("");
  const [lastNameInput, setLastNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [confirmPasswordInput, setConfirmPasswordInput] = useState("");
  const [authNotice, setAuthNotice] = useState(""); // e.g. "check your email to confirm"
  const [error, setError] = useState("");

  const [wizardStep, setWizardStep] = useState(1);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [interviewStage, setInterviewStage] = useState("first_round"); // recruiter_screen | first_round | technical | final_round
  const [interviewFormat, setInterviewFormat] = useState(null); // null = use the stage's default format; only meaningful when the stage allows a choice
  const [length, setLength] = useState(12);
  const [jdText, setJdText] = useState("");
  const [cvText, setCvText] = useState("");
  const [focusWeaknesses, setFocusWeaknesses] = useState(false);
  const [fileBusy, setFileBusy] = useState(null); // "jd" | "cv" | null
  const [applicationId, setApplicationId] = useState(null);

  const [profile, setProfile] = useState(null);
  const [interview, setInterview] = useState(null);
  const [interviewList, setInterviewList] = useState([]);
  const [perf, setPerf] = useState(null); // { strengths, weaknesses, competency_history:{key:[scores]}, style_notes, common_issues }
  const [answerInput, setAnswerInput] = useState("");
  const [report, setReport] = useState(null);
  const bottomRef = useRef(null);
  const busyRef = useRef(false);
  async function guarded(fn) {
    if (busyRef.current) return;
    busyRef.current = true;
    try { await fn(); } finally { busyRef.current = false; }
  }

  // Classroom
  const [classroom, setClassroom] = useState([]);
  const [classroomTopic, setClassroomTopic] = useState(null);
  const [lesson, setLesson] = useState(null);
  const [targetTopic, setTargetTopic] = useState(null);
  const [quizAnswers, setQuizAnswers] = useState({});

  // Interview Memory
  const [questionHistory, setQuestionHistory] = useState([]); // [{question,category,competency,score,date,company,role,interviewId}]
  const [memoryLog, setMemoryLog] = useState([]); // [{question, previous_score, current_score, company, role, date}]

  // Assessment Centre
  const [acCompany, setAcCompany] = useState("");
  const [acRole, setAcRole] = useState("");
  const [acType, setAcType] = useState(null);
  const [acScenario, setAcScenario] = useState(null);
  const [acSubmission, setAcSubmission] = useState("");
  const [acResult, setAcResult] = useState(null);
  const [acAttempts, setAcAttempts] = useState([]);

  // Phase 4B: independent/batch (asynchronous video) interview engine.
  // asyncPhase: "prep" | "answering". asyncSecondsLeft: null = untimed phase, otherwise
  // the live countdown. Kept entirely separate from the adaptive interview's state above —
  // the two pipelines never read or write each other's state.
  const [asyncPhase, setAsyncPhase] = useState("prep");
  const [asyncSecondsLeft, setAsyncSecondsLeft] = useState(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [interview?.transcript?.length]);
  useEffect(() => { window.scrollTo(0, 0); }, [screen]);

  // Reset the prep/answer cycle whenever a new async question comes into view.
  useEffect(() => {
    if (screen !== "async_interview" || !interview || interview.config?.pipeline !== "independent_batch") return;
    const q = interview.questions?.[interview.currentIndex];
    if (!q) return;
    if (Number.isFinite(q.prepSeconds) && q.prepSeconds > 0) { setAsyncPhase("prep"); setAsyncSecondsLeft(q.prepSeconds); }
    else if (Number.isFinite(q.answerSeconds) && q.answerSeconds > 0) { setAsyncPhase("answering"); setAsyncSecondsLeft(q.answerSeconds); }
    else { setAsyncPhase("answering"); setAsyncSecondsLeft(null); }
  }, [screen, interview?.currentIndex]);

  // Countdown ticker. setTimeout-chained (not setInterval) so it naturally re-arms itself
  // correctly whenever asyncPhase/asyncSecondsLeft change, including the prep->answering
  // transition below. Untimed phases (asyncSecondsLeft === null) simply never tick.
  useEffect(() => {
    if (screen !== "async_interview" || asyncSecondsLeft === null) return;
    if (asyncSecondsLeft <= 0) {
      if (asyncPhase === "prep") {
        const q = interview?.questions?.[interview.currentIndex];
        if (Number.isFinite(q?.answerSeconds) && q.answerSeconds > 0) { setAsyncPhase("answering"); setAsyncSecondsLeft(q.answerSeconds); }
        else { setAsyncPhase("answering"); setAsyncSecondsLeft(null); }
      } else {
        // Answer timer expired — never silently discard whatever the candidate has typed.
        guarded(() => submitAsyncAnswer(true));
      }
      return;
    }
    const t = setTimeout(() => setAsyncSecondsLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [screen, asyncPhase, asyncSecondsLeft]);

  /* ---------------- AUTH (real Supabase Auth) ---------------- */
  useEffect(() => {
    let unsub = null;
    // Captured synchronously, before any async work, so it reflects the URL exactly as the
    // page loaded — a password-recovery redirect from Supabase carries "type=recovery" in
    // either the hash (legacy implicit flow) or the query string (PKCE flow).
    const isRecoveryLink = typeof window !== "undefined" && /type=recovery/.test(window.location.hash + window.location.search);
    (async () => {
      try {
        const supabase = await getSupabase();
        // Subscribe BEFORE calling getSession(): detectSessionInUrl's one-time processing of
        // the redirect URL (and the PASSWORD_RECOVERY event it can emit) is gated behind the
        // same internal init sequence getSession() awaits, so subscribing first avoids a race
        // where that event fires before anything is listening for it.
        const { data: sub } = supabase.auth.onAuthStateChange(async (event, newSession) => {
          if (event === "SIGNED_OUT") { clearAllUserState(); return; }
          // ROOT-CAUSE FIX (2026-08-21, round 2): live testing showed the app landing straight in
          // the dashboard after clicking a real recovery link, instead of the "set new password"
          // screen. Cause: Supabase doesn't reliably fire the distinct "PASSWORD_RECOVERY" event —
          // observed live, this recovery session actually arrived as a plain "SIGNED_IN" event,
          // which fell through to onAuthed() and signed the user straight into the dashboard before
          // the isRecoveryLink check below (a separate, slower async path) could win the race back.
          // Fix: treat ANY event carrying a session as a recovery event whenever the page was loaded
          // from a recovery link (isRecoveryLink, captured synchronously above, closed over here) —
          // not just the ones literally named "PASSWORD_RECOVERY". This makes routing deterministic
          // regardless of which event name Supabase actually emits.
          if (event === "PASSWORD_RECOVERY" || (isRecoveryLink && newSession)) {
            setSession(newSession); setError(""); setAuthNotice("");
            setScreen("login"); setAuthView("reset");
            return;
          }
          if (newSession) await onAuthed(newSession);
        });
        unsub = sub?.subscription;
        const { data } = await supabase.auth.getSession();
        if (data?.session) {
          // A recovery-link session is intentionally NOT treated as a normal sign-in — the
          // PASSWORD_RECOVERY handler above (or this same check) routes to "set new password"
          // instead, so a stale/foreign recovery link never dumps someone straight into the app.
          if (isRecoveryLink) { setSession(data.session); setScreen("login"); setAuthView("reset"); }
          else { await onAuthed(data.session); }
        }
        setAuthChecked(true);
      } catch (e) {
        setError(e.message || "Couldn't connect to the authentication service.");
        setAuthChecked(true);
      }
    })();
    return () => { if (unsub) unsub.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onAuthed(newSession) {
    setSession(newSession);
    const authUser = newSession.user;
    try {
      const state = await loadFullUserState(authUser.id);
      let p = state.profile;
      // Backfill name from signup metadata if the profile row doesn't have it yet
      // (handles both instant-session and email-confirmation-required signup flows).
      const metaFirst = authUser.user_metadata?.first_name, metaLast = authUser.user_metadata?.last_name;
      if ((!p?.first_name || !p?.last_name) && (metaFirst || metaLast)) {
        const supabase = await getSupabase();
        const { data: updated } = await supabase.from("profiles").update({ first_name: metaFirst || p?.first_name || "", last_name: metaLast || p?.last_name || "" }).eq("id", authUser.id).select().maybeSingle();
        if (updated) p = updated;
      }
      setUser({ id: authUser.id, email: authUser.email, first_name: p?.first_name || "", last_name: p?.last_name || "" });
      setPerf(state.perf);
      setInterviewList(state.interviewList);
      setClassroom(state.classroom);
      setQuestionHistory(state.questionHistory);
      setMemoryLog(state.memoryLog);
      setAcAttempts(state.acAttempts);
      setScreen((s) => (["landing", "how", "universities", "login"].includes(s) ? "dashboard" : s));
    } catch (e) {
      setError("Signed in, but couldn't load your data. Please refresh.");
    }
  }

  function clearAllUserState() {
    setUser(null); setSession(null); setPerf(null); setInterviewList([]); setClassroom([]);
    setQuestionHistory([]); setMemoryLog([]); setAcAttempts([]); setApplicationId(null);
    setScreen("landing");
  }

  async function handleSignUp() {
    setError(""); setAuthNotice("");
    if (!firstNameInput.trim() || !lastNameInput.trim()) { setError("Enter your first and last name."); return; }
    if (!emailInput.trim() || !passwordInput) { setError("Enter your email and a password."); return; }
    if (passwordInput.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (passwordInput !== confirmPasswordInput) { setError("Passwords don't match."); return; }
    try {
      const supabase = await getSupabase();
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email: sanitizeText(emailInput.trim().toLowerCase()), password: passwordInput,
        options: { data: { first_name: sanitizeText(firstNameInput.trim()), last_name: sanitizeText(lastNameInput.trim()) } },
      });
      if (signUpErr) { setError(signUpErr.message); return; }
      if (data?.session) { await onAuthed(data.session); }
      else { setAuthNotice("Check your email to confirm your account, then sign in."); setAuthView("signin"); }
    } catch (e) { setError(e.message || "Couldn't create your account. Please try again."); }
  }

  async function handleSignIn() {
    setError(""); setAuthNotice("");
    if (!emailInput.trim() || !passwordInput) { setError("Enter your email and password."); return; }
    try {
      const supabase = await getSupabase();
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({ email: sanitizeText(emailInput.trim().toLowerCase()), password: passwordInput });
      if (signInErr) { setError(/invalid/i.test(signInErr.message) ? "Incorrect email or password." : signInErr.message); return; }
      await onAuthed(data.session);
    } catch (e) { setError(e.message || "Couldn't sign in. Please try again."); }
  }

  async function handleForgotPassword() {
    setError(""); setAuthNotice("");
    if (!emailInput.trim()) { setError("Enter your email first."); return; }
    try {
      const supabase = await getSupabase();
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(sanitizeText(emailInput.trim().toLowerCase()));
      if (resetErr) { setError(resetErr.message); return; }
      setAuthNotice("If an account exists for that email, a reset link has been sent.");
    } catch (e) { setError(e.message || "Couldn't send the reset email. Please try again."); }
  }

  // Only reachable via authView === "reset", which is only ever set from a live PASSWORD_RECOVERY
  // session (see the auth useEffect above) — so a valid session for updateUser() is guaranteed here.
  async function handleResetPassword() {
    setError(""); setAuthNotice("");
    if (!passwordInput) { setError("Enter a new password."); return; }
    if (passwordInput.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (passwordInput !== confirmPasswordInput) { setError("Passwords don't match."); return; }
    try {
      const supabase = await getSupabase();
      const { error: updateErr } = await supabase.auth.updateUser({ password: passwordInput });
      if (updateErr) { setError(updateErr.message); return; }
      setPasswordInput(""); setConfirmPasswordInput("");
      // updateUser() succeeding means the recovery session is now a normal, valid session —
      // sign the user straight into the app rather than making them log in again.
      const { data: refreshed } = await supabase.auth.getSession();
      if (refreshed?.session) await onAuthed(refreshed.session);
      else { setAuthNotice("Your password has been updated. Please sign in."); setAuthView("signin"); }
    } catch (e) { setError(e.message || "Couldn't update your password. Please try again."); }
  }

  async function handleSignOut() {
    try { const supabase = await getSupabase(); await supabase.auth.signOut(); } catch (e) { /* clearAllUserState runs via onAuthStateChange regardless */ }
    clearAllUserState();
  }

  /* ---------------- FILE UPLOAD (TXT / DOCX; PDF gets an honest message) ---------------- */
  async function confirmCompanyRole() {
    setError("");
    try {
      if (!applicationId) {
        const app = await dbCreateApplication(user.id, { company: sanitizeText(company), role: sanitizeText(role), status: "draft" });
        setApplicationId(app.id);
      } else {
        await dbUpdateApplication(applicationId, { company: sanitizeText(company), role: sanitizeText(role) });
      }
      setWizardStep(2);
    } catch (e) {
      setError(e.message || "Couldn't save your application. Please try again.");
    }
  }

  async function handleFileUpload(e, which) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!user) { setError("Please sign in before uploading a file."); return; }
    setError("");
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const MAX_SIZE = 8 * 1024 * 1024;
    if (file.size === 0) { setError("That file is empty. Please try another file or paste the text directly."); return; }
    if (file.size > MAX_SIZE) { setError("That file is too large (max 8MB). Please try a smaller file or paste the text directly."); return; }
    setFileBusy(which);
    try {
      let text = "";
      if (ext === "txt") {
        text = await file.text();
      } else if (ext === "docx") {
        const buf = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: buf });
        text = result.value || "";
      } else if (ext === "pdf") {
        const buf = await file.arrayBuffer();
        text = await extractPdfText(buf); // throws its own specific message for password/corrupt cases
      } else {
        setError("We couldn't process this file. Please upload a .txt or .docx file, or paste the text directly.");
        return;
      }
      const clean = sanitizeText(text).trim();
      if (!clean) { setError("We couldn't find any readable text in that file. Please try another file or paste the text directly."); return; }
      if (which === "jd") setJdText(clean); else setCvText(clean);

      const storagePath = await dbUploadDocumentFile(user.id, applicationId, file);
      await dbInsertDocument(user.id, applicationId, { type: which === "jd" ? "jd" : "cv", filename: file.name, storagePath, mimeType: file.type, fileSize: file.size, extractedText: clean });
    } catch (err) {
      setError((err && err.message) || "We couldn't process this file. Please try another file or paste the text directly.");
    } finally {
      setFileBusy(null);
    }
  }

  /* ---------------- SHARED HELPERS: Classroom + Interview DNA ---------------- */
  function normalizeTopic(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function statusFor(scores) {
    const latest = scores[scores.length - 1];
    if (latest >= 85) return { label: "Mastered", color: "var(--good)", bg: "#E7F8F1" };
    if (latest >= 70) return { label: "Improving", color: "var(--blue)", bg: "var(--highlight)" };
    if (latest >= 50) return { label: "Learning", color: "var(--warn)", bg: "#FEF3E2" };
    return { label: "Needs work", color: "var(--bad)", bg: "#FEF2F2" };
  }
  function candidateLevel() {
    if (!interviewList.length) return "beginner — this is their first interview";
    const avg = interviewList.reduce((s, i) => s + (i.overall_score || 0), 0) / interviewList.length;
    if (avg >= 78) return "advanced — give sophisticated, practical, industry-context material";
    if (avg >= 58) return "intermediate — solid fundamentals, ready for applied detail";
    return "beginner — needs clear core concepts and simple definitions before nuance";
  }

  async function pushClassroomTopics(topics, ctx) {
    if (!topics || !topics.length || !user) return;
    let list = [...classroom];
    for (const t of topics) {
      if (!t.topic) continue;
      const norm = normalizeTopic(t.topic);
      const existing = list.find((x) => {
        const xn = normalizeTopic(x.topic);
        return xn === norm || xn.includes(norm) || norm.includes(xn);
      });
      const newId = await dbUpsertClassroomTopic(user.id, ctx.applicationId || applicationId, ctx.isInterview ? ctx.id : null, existing?.id || null, { topic: t.topic, category: t.category, description: t.description, related_question: t.related_question, initial_score: t.initial_score, company: ctx.company, role: ctx.role });
      if (existing) {
        existing.scores = [...existing.scores, t.initial_score || 0];
        existing.lastInterviewId = ctx.id;
        existing.description = t.description || existing.description;
        existing.relatedQuestion = t.related_question || existing.relatedQuestion;
      } else if (newId) {
        list.push({ id: newId, topic: t.topic, category: t.category || "general", description: t.description || "", company: ctx.company, role: ctx.role, scores: [t.initial_score || 0], lastInterviewId: ctx.id, relatedQuestion: t.related_question || "" });
      }
    }
    setClassroom(list);
  }

  // Interview DNA: merges qualitative + numeric performance signal from ANY source (interview or assessment centre)
  async function applyPerformanceUpdate({ weaknesses = [], strengths = [], breakdown = {}, styleNotes = [], sourceType = "interview", sourceId = null, company = null, role = null }) {
    if (!user) return perf;
    const newCompHistory = { ...(perf?.competency_history || {}) };
    for (const [k, v] of Object.entries(breakdown || {})) {
      if (typeof v !== "number") continue;
      newCompHistory[k] = [...(newCompHistory[k] || []), v];
      await dbInsertCompetencyHistory(user.id, k, v, sourceType, sourceId, company, role);
    }
    const newPerf = {
      strengths: Array.from(new Set([...(strengths || []), ...(perf?.strengths || [])])).slice(0, 8),
      weaknesses: Array.from(new Set([...(weaknesses || []), ...(perf?.weaknesses || [])])).slice(0, 8),
      competency_history: newCompHistory,
      style_notes: Array.from(new Set([...(styleNotes || []), ...(perf?.style_notes || [])])).slice(0, 6),
      common_issues: perf?.common_issues || [],
    };
    setPerf(newPerf);
    await dbUpsertCandidateDna(user.id, newPerf);
    return newPerf;
  }

  async function openLesson(topic) {
    setClassroomTopic(topic); setQuizAnswers({}); setError("");
    const savedQuiz = await dbGetQuizResult(topic.id, user.id);
    if (savedQuiz?.answers) setQuizAnswers(savedQuiz.answers);
    const cachedLesson = await dbGetClassroomLesson(topic.id);
    if (cachedLesson) {
      setLesson({ title: cachedLesson.title, why_it_matters: cachedLesson.why_it_matters, core_knowledge: cachedLesson.core_knowledge, key_points: cachedLesson.key_points, example_answer_snippet: cachedLesson.example_answer_snippet, interview_application: cachedLesson.interview_application, quick_check: cachedLesson.quick_check, grounding_note: cachedLesson.grounding_note, id: cachedLesson.id });
      setScreen("lesson");
      return;
    }
    setScreen("classroom_generating");
    try {
      const wantsWeb = topic.category === "company_knowledge" || topic.category === "commercial_awareness";
      const system = `You are a specialist interview-preparation tutor. You generate one short, targeted lesson (5-10 minutes to complete) that teaches a candidate exactly what they need to know to fix ONE specific interview weakness. Return strict JSON only, no prose, no markdown fences, in this exact shape:
{
  "title": "", "why_it_matters": "",
  "core_knowledge": [{"point": "", "grounded": true}],
  "key_points": [""], "example_answer_snippet": "", "interview_application": "",
  "quick_check": [{"question": "", "options": ["",""], "correct_index": 0, "explanation": ""}],
  "grounding_note": ""
}
Rules: mini study guide, not an essay. core_knowledge 3-5 points, key_points 3-5, quick_check 2-3 questions with 3-4 options each. "grounded" is true only for points you are confident are accurate and current; mark false for general guidance and never present an unverified company fact as confirmed. If you can't establish reliable specifics, say so in grounding_note and stay general. example_answer_snippet shows how to use the knowledge, not fabricated achievements. Match depth to the candidate's level given.`;
      const userText = `Weakness topic: ${topic.topic}\nCategory: ${topic.category}\nWeakness as identified: ${topic.description}\nCompany: ${topic.company}\nRole: ${topic.role}\nRelated interview question: ${topic.relatedQuestion || "n/a"}\nCandidate level: ${candidateLevel()}\n\n${wantsWeb ? "This likely requires real, current, company-specific or market information — use web search to verify facts before teaching them." : "General interview-technique or subject-matter topic; no need to search."}`;
      // ROOT-CAUSE FIX (found via live testing 2026-08-21): when wantsWeb is true, Anthropic's
      // web_search tool runs its search+reasoning round-trip inside the SAME max_tokens budget
      // as the final answer. 2200 tokens was enough for the search step alone, leaving nothing
      // for the model to actually write the lesson JSON — the response got cut off mid-JSON
      // (confirmed live: output_tokens 2370 on a call whose result never parsed/saved), so
      // callClaude() threw "cut off" / "could not parse" and the whole lesson silently failed.
      // Non-web lessons need no search round-trip, so they keep the original, cheaper budget.
      const result = validateLesson(await callClaude(system, userText, wantsWeb ? 4500 : 2200, wantsWeb, { requestType: "classroom_lesson", applicationId: topic.applicationId }));
      const saved = await dbInsertClassroomLesson(topic.id, result);
      setLesson({ ...result, id: saved?.id });
      setScreen("lesson");
    } catch (e) {
      setError(e.message || "Couldn't generate this lesson.");
      setScreen("classroom");
    }
  }

  async function recordQuizAnswer(qi, oi) {
    if (!lesson || !classroomTopic || !user) return;
    const newAnswers = { ...quizAnswers, [qi]: oi };
    setQuizAnswers(newAnswers);
    if (Object.keys(newAnswers).length === lesson.quick_check.length) {
      const correct = lesson.quick_check.filter((q, i) => newAnswers[i] === q.correct_index).length;
      await dbUpsertQuizResult(user.id, classroomTopic.id, lesson.id, newAnswers, correct, lesson.quick_check.length);
      // Quiz results measure knowledge recall, not live interview performance — deliberately
      // kept separate from classroomTopic.scores (which only interviews/AC attempts update).
    }
  }

  function practiseThisWeakness(topic) {
    setCompany(topic.company); setRole(topic.role);
    setTargetTopic(topic.topic); setFocusWeaknesses(true); setApplicationId(null);
    setError(""); setWizardStep(1); setScreen("create");
  }

  function loadDemo() {
    setCompany("JPMorgan"); setRole("Global Markets Summer Analyst");
    setJdText(DEMO_JD); setCvText(DEMO_CV); setInterviewStage("first_round"); setInterviewFormat(null);
  }

  function startCreateFlow(focusWeak = false) {
    setWizardStep(1); setFocusWeaknesses(focusWeak); setTargetTopic(null); setApplicationId(null); setError(""); setScreen("create");
  }

  /* ---------------- STEP 1: JD + CV ANALYSIS -> PROFILE ---------------- */
  async function analyseAndPlan() {
    setError(""); setScreen("analyzing");
    const cleanCompany = sanitizeText(company);
    const cleanRole = sanitizeText(role);
    const cleanJd = sanitizeText(jdText);
    const cleanCv = sanitizeText(cvText);
    // Phase 4A: resolve the chosen stage (+ optional format override) into a concrete config.
    // This is persisted below and is what Phase 4B's independent/batch engine will branch on;
    // in 4A it is NOT yet used to change question-generation or evaluation behaviour — every
    // interview still runs through the existing adaptive engine unchanged (see catalog comment).
    const ivConfig = resolveInterviewConfig(interviewStage, interviewFormat);
    try {
      const weaknessNote = targetTopic
        ? `The candidate came here specifically from a Classroom lesson to practise this exact weakness: "${targetTopic}". Weight the question plan heavily toward re-testing this specific competency — it should be tested more than once, with rising difficulty if the candidate does well.` +
          (perf?.weaknesses?.length ? ` Their other known weaknesses are: ${perf.weaknesses.join("; ")} — touch on these too where relevant, but "${targetTopic}" is the priority.` : "")
        : perf && perf.weaknesses.length
        ? "The candidate's known weaknesses from previous interviews are: " + perf.weaknesses.join("; ") + (focusWeaknesses ? ". The candidate has specifically asked to focus this interview on these weaknesses — weight the question plan heavily toward re-testing them." : ". Where relevant to this role, include at least one question that specifically re-tests one of these weaknesses.")
        : "This candidate has no prior interview history.";

      const system = `You are an expert interview coach and recruiter. You analyse a job description and a CV together and produce a single strict JSON object (no prose, no markdown fences) with this exact shape:
{
  "interview_profile": {
    "company": "", "role": "", "division": "", "seniority": "",
    "responsibilities": [""], "required_skills": [""], "preferred_skills": [""],
    "competencies": [{"name": "", "basis": "explicit|inferred|general"}],
    "technical_topics": [""], "behavioural_topics": [""], "commercial_topics": [""],
    "question_mix": {"motivation_fit": 30, "cv_behavioural": 25, "role_specific": 20, "technical": 15, "commercial_awareness": 10}
  },
  "candidate_profile": {
    "education": [""], "experience": [""], "leadership": [""], "achievements": [""],
    "skills": [""], "behavioural_examples": [""],
    "potential_probe_areas": [{"claim": "", "why": ""}]
  },
  "opening_question": { "text": "", "category": "motivation_fit|cv_behavioural|role_specific|technical|commercial_awareness", "competency": "" }
}
Rules: "basis" must honestly mark whether each competency is explicitly stated in the JD, reasonably inferred, or just generally expected for this role type. question_mix percentages sum to 100 and reflect the actual role type. potential_probe_areas should point at specific claims worth challenging. opening_question must be natural and specific, not generic.`;

      const stageLabel = stageByKey(ivConfig.stage).label;
      const formatLabel = INTERVIEW_FORMATS[ivConfig.format].label;
      const userText = `${weaknessNote}\n\nCompany: ${cleanCompany}\nRole: ${cleanRole}\nInterview stage: ${stageLabel}\nInterview format: ${formatLabel}\n\nJob description:\n${cleanJd}\n\nCandidate CV:\n${cleanCv}`;
      const result = validateProfile(await callClaude(system, userText, 3000, false, { requestType: "interview_profile", applicationId }));
      setProfile(result);

      await dbUpdateApplication(applicationId, { job_description: cleanJd, interview_stage: stageLabel, interview_type: formatLabel, interview_length: length, status: "active" });
      const ivRow = await dbCreateInterview(user.id, applicationId, ivConfig);

      // Phase 4B: branch on the resolved pipeline. independent_batch generates and persists
      // the COMPLETE question set now, before the candidate sees question 1, and never
      // touches interview_turn. adaptive_turn falls through to the existing, unmodified
      // single-opening-question path (interview_turn generates the rest, one at a time).
      if (ivConfig.pipeline === "independent_batch") {
        const cvBackground = cvBackgroundSummary(result.candidate_profile);
        const batch = await generateQuestionBatch(ivConfig, result.interview_profile, cvBackground, cleanJd, weaknessNote, { applicationId, interviewId: ivRow.id });
        if (!batch.questions.length) throw new Error("Couldn't generate the interview questions. Please try again.");
        const savedRows = await dbInsertQuestionBatch(ivRow.id, batch.questions, { prepSeconds: ivConfig.preparation_time, answerSeconds: ivConfig.answer_time });
        const questions = savedRows.map((row, i) => ({
          dbId: row.id, questionNumber: row.question_number, text: row.question_text, category: row.category, competency: row.competency,
          difficulty: batch.questions[i]?.difficulty, is_technical: !!batch.questions[i]?.is_technical, role_relevance: batch.questions[i]?.role_relevance,
          expected_answer_characteristics: batch.questions[i]?.expected_answer_characteristics,
          prepSeconds: ivConfig.preparation_time ?? null, answerSeconds: ivConfig.answer_time ?? null,
        }));

        const newInterview = {
          id: ivRow.id, applicationId, company: cleanCompany, role: cleanRole, stage: ivConfig.stage, format: ivConfig.format, stageLabel, formatLabel, startedAt: Date.now(),
          config: ivConfig, cvBackground, questions, currentIndex: 0, answers: [], status: "planned",
        };
        setInterview(newInterview);
        setScreen("preview");
        return;
      }

      const q1 = await dbInsertQuestion(ivRow.id, 1, result.opening_question);
      const newInterview = {
        id: ivRow.id, applicationId, company: cleanCompany, role: cleanRole, stage: ivConfig.stage, format: ivConfig.format, stageLabel, formatLabel, startedAt: Date.now(),
        // config is threaded through starting Phase 4B (per redesign plan §11) so the
        // adaptive engine has access to the resolved configuration for future Phase 4C
        // tuning. It is NOT yet read anywhere in submitAnswer/finishInterview's own logic
        // below — purely additive, current adaptive behaviour is unchanged.
        config: ivConfig,
        maxQuestions: length, transcript: [], currentQuestion: { ...result.opening_question, dbId: q1.id, questionNumber: 1 }, status: "planned",
      };
      setInterview(newInterview);
      setScreen("preview");
    } catch (e) {
      setError(e.message || "Something went wrong analysing this role.");
      setScreen("create");
    }
  }

  // Phase 4B: routes to the dedicated one-way async screen for independent_batch
  // interviews, leaving the existing chat-style "interview" screen untouched for
  // adaptive_turn interviews.
  function beginInterview() { setScreen(interview?.config?.pipeline === "independent_batch" ? "async_interview" : "interview"); }

  /* ---------------- STEP 2: SUBMIT ANSWER ---------------- */
  async function submitAnswer() {
    if (!answerInput.trim() || !interview || !profile) return;
    // Structural guard (Phase 4B §3): interview_turn must be UNREACHABLE for an
    // independent_batch interview, not merely discouraged by a prompt. This check exists
    // so that even a future accidental wiring of a button/handler to submitAnswer() cannot
    // invoke the adaptive engine for a batch-pipeline interview.
    if (interview.config?.pipeline === "independent_batch") {
      console.error("submitAnswer() (interview_turn) was called for an independent_batch interview — this is a routing bug, not a valid interview state.");
      setError("Internal error: this interview type does not use live follow-up questions. Please refresh and try again.");
      return;
    }
    setError("");
    const cleanAnswer = sanitizeText(answerInput);
    const currentQ = interview.currentQuestion;
    const askedSoFar = interview.transcript.length + 1;
    setScreen("evaluating");
    try {
      const system = `You are a real, professional interviewer conducting a live interview. You are NOT effusive or full of praise — you are neutral and probing. Return strict JSON only, no prose, in this exact shape:
{
  "evaluation": { "relevance": 0, "specificity": 0, "structure": 0, "evidence": 0, "clarity": 0, "competency_demonstration": 0, "strengths": [""], "issues": [""] },
  "decision": "follow_up|new_competency|challenge_claim|clarify|next_section",
  "next_question": { "text": "", "category": "motivation_fit|cv_behavioural|role_specific|technical|commercial_awareness", "competency": "" },
  "interview_should_end": false
}
Rules: honest 0-100 scores. If vague/generic/no example, note it and probe for specifics. If dodged, redirect back to it. Don't repeat a thoroughly covered competency unless the answer revealed a weakness worth re-testing. Vary categories per question_mix. Set interview_should_end true once roughly ${interview.maxQuestions} questions have been asked and core competencies are covered.`;
      // Resolved configuration context (Phase 4B §11) — currently inert. Not referenced by
      // any rule in the system prompt above; threaded through purely so Phase 4C can later
      // tune technical/CV/behavioural/commercial weighting and challenge intensity for the
      // adaptive engine without another plumbing change here.
      const userText = `Interview profile: ${JSON.stringify(profile.interview_profile)}\nCandidate profile: ${JSON.stringify(profile.candidate_profile)}\nQuestions asked so far: ${askedSoFar} of target ${interview.maxQuestions}\nTranscript so far: ${JSON.stringify(interview.transcript)}\n\nQuestion just asked: ${JSON.stringify(currentQ)}\nCandidate's answer: ${cleanAnswer}\n\nResolved interview configuration (context only, currently unused by the rules above): ${JSON.stringify(interview.config || {})}`;
      const result = validateNextTurn(await callClaude(system, userText, 1200, false, { requestType: "interview_turn", applicationId: interview.applicationId, interviewId: interview.id }));

      await dbInsertAnswer(currentQ.dbId, cleanAnswer, result.evaluation, result.decision);

      const newEntry = { question: currentQ, answer: cleanAnswer, evaluation: result.evaluation };
      const newTranscript = [...interview.transcript, newEntry];
      const shouldEnd = result.interview_should_end || newTranscript.length >= interview.maxQuestions + 3;

      let nextQWithId = { ...result.next_question, dbId: null, questionNumber: askedSoFar + 1 };
      if (!shouldEnd) {
        const qRow = await dbInsertQuestion(interview.id, askedSoFar + 1, result.next_question);
        nextQWithId.dbId = qRow.id;
      }
      const updated = { ...interview, transcript: newTranscript, currentQuestion: nextQWithId };
      setInterview(updated);
      setAnswerInput("");
      if (shouldEnd) { await finishInterview(updated); } else { setScreen("interview"); }
    } catch (e) {
      setError(e.message || "Something went wrong evaluating that answer.");
      setScreen("interview");
    }
  }

  /* ---------------- STEP 3: FINAL REPORT + Interview Memory + Interview DNA ---------------- */
  async function finishInterview(finalInterview) {
    setScreen("reporting");
    try {
      const isAsync = finalInterview.config?.pipeline === "independent_batch";
      // Phase 4B §8: report infrastructure stays shared/compatible — one extra conditional
      // paragraph keys off the pipeline so an async report doesn't invent conversational
      // follow-through as a weakness, and doesn't invent technical weaknesses when the
      // question set (correctly, per §2) contained no technical questions.
      const formatNote = isAsync
        ? `\nThis was an ASYNCHRONOUS, one-way interview (no live follow-ups, no clarification, questions were fixed in advance and answered independently). Do NOT criticise the candidate for lack of conversational depth, not building on follow-ups, or not adapting to a redirect — none of that was possible in this format. Report per_question_feedback and weakest_areas honestly, but only flag a technical weakness if the transcript actually contains a technical question the candidate answered poorly — do not invent one. If any answer's underlying evaluation notes a timer cut it short, mention that as context in note_on_missing_data rather than treating it as a pure content gap.`
        : "";
      const system = `You produce a final interview performance report as strict JSON only, no prose. Shape:
{
  "overall_score": 0, "readiness": "not_ready|needs_improvement|interview_ready|strong",
  "breakdown": {"relevance":0,"structure":0,"specificity":0,"evidence":0,"communication":0,"competency_demonstration":0},
  "strongest_areas": [""], "weakest_areas": [""],
  "per_question_feedback": [{"question":"", "did_well": [""], "weakened_it": [""], "how_to_improve": "", "note_on_missing_data": ""}],
  "next_practice_focus": "", "updated_candidate_weaknesses": [""], "updated_candidate_strengths": [""],
  "interview_style_notes": [""],
  "classroom_topics": [{"topic": "", "category": "company_knowledge|technical|commercial_awareness|behavioural|technique|role_specific", "description": "", "related_question": "", "initial_score": 0}]
}
Rules: scores computed honestly from the transcript's evaluations. Never fabricate achievements the candidate never claimed. classroom_topics: only genuine, specific, teachable weaknesses (usually 1-3), with a short reusable "topic" title so progress on it can be tracked over time. interview_style_notes: 1-3 short, concrete observations about HOW this candidate interviews across the transcript as a whole (e.g. "Answers tend to run long", "Strong examples but rarely quantifies results", "Good technical grounding but motivation answers stay generic") — behavioural/stylistic patterns, not one-off scores.${formatNote}`;
      const userText = `Company: ${finalInterview.company}\nRole: ${finalInterview.role}\nInterview profile: ${JSON.stringify(profile.interview_profile)}\nPre-existing candidate performance profile: ${JSON.stringify(perf)}\nFull transcript: ${JSON.stringify(finalInterview.transcript)}`;
      const result = validateReport(await callClaude(system, userText, 4500, false, { requestType: "interview_report", applicationId: finalInterview.applicationId, interviewId: finalInterview.id }));

      // Interview Memory: compare each answered question to prior similar ones, before this interview's Q&A is logged
      const comparisons = finalInterview.transcript
        .map((t) => {
          const match = matchPreviousQuestion(t.question?.text, t.question?.category, t.question?.competency, questionHistory);
          if (!match) return null;
          return { question: t.question?.text, previous_score: match.score, current_score: t.evaluation?.competency_demonstration ?? null, company: finalInterview.company, role: finalInterview.role, date: Date.now(), previousMemoryId: match.id };
        })
        .filter(Boolean);

      setReport({ ...result, memory_comparisons: comparisons });

      if (comparisons.length && user) {
        for (const c of comparisons) await dbInsertMemoryComparison(user.id, finalInterview.id, c);
        setMemoryLog([...comparisons, ...memoryLog].slice(0, 30));
      }

      const newHistoryEntries = finalInterview.transcript.map((t) => ({
        question: t.question?.text, category: t.question?.category, competency: t.question?.competency,
        score: t.evaluation?.competency_demonstration ?? t.evaluation?.relevance ?? 0,
        date: Date.now(), company: finalInterview.company, role: finalInterview.role, interviewId: finalInterview.id,
      }));
      if (user) {
        for (const h of newHistoryEntries) await dbInsertMemory(user.id, finalInterview.id, h);
      }
      setQuestionHistory([...questionHistory, ...newHistoryEntries].slice(-200));

      await pushClassroomTopics(result.classroom_topics, { company: finalInterview.company, role: finalInterview.role, id: finalInterview.id, applicationId: finalInterview.applicationId, isInterview: true });

      await dbCompleteInterview(finalInterview.id, result);
      const summary = { id: finalInterview.id, company: finalInterview.company, role: finalInterview.role, date: Date.now(), overall_score: result.overall_score, readiness: result.readiness, breakdown: result.breakdown };
      setInterviewList([...interviewList, summary]);

      await applyPerformanceUpdate({
        weaknesses: result.updated_candidate_weaknesses,
        strengths: result.updated_candidate_strengths,
        breakdown: result.breakdown,
        styleNotes: result.interview_style_notes,
        sourceType: "interview", sourceId: finalInterview.id, company: finalInterview.company, role: finalInterview.role,
      });

      setScreen("report");
    } catch (e) {
      setError(e.message || "Something went wrong generating the report.");
      setScreen(finalInterview.config?.pipeline === "independent_batch" ? "async_interview" : "interview");
    }
  }

  /* ---------------- PHASE 4B: INDEPENDENT/BATCH (ASYNC) INTERVIEW ---------------- */
  // Persists the current answer against the already-generated question (its question ID/
  // dbId never changes, per §6), then advances to the next pre-generated question or, if
  // this was the last one, finishes the interview. Never regenerates a question, never
  // calls interview_turn, never calls callClaude at all — persistence only.
  async function submitAsyncAnswer(timeExpired) {
    if (!interview || interview.config?.pipeline !== "independent_batch") return;
    const q = interview.questions[interview.currentIndex];
    if (!q) return;
    setError("");
    const cleanAnswer = sanitizeText(answerInput || "");
    try {
      const savedAnswer = await dbInsertAnswerOnly(q.dbId, cleanAnswer, !!timeExpired);
      const newAnswers = [...interview.answers, { questionDbId: q.dbId, answerDbId: savedAnswer.id, text: cleanAnswer, timeExpired: !!timeExpired }];
      const nextIndex = interview.currentIndex + 1;
      const updated = { ...interview, answers: newAnswers, currentIndex: nextIndex };
      setInterview(updated);
      setAnswerInput("");
      if (nextIndex >= interview.questions.length) { await finishAsyncInterview(updated); } else { setScreen("async_interview"); }
    } catch (e) {
      setError(e.message || "Something went wrong saving that answer.");
      setScreen("async_interview");
    }
  }

  // Runs the single batch evaluation call once every question has been answered, persists
  // one evaluation row per answer, then builds a transcript array in EXACTLY the shape the
  // existing, unmodified finishInterview() already expects — deliberately reusing 100% of
  // its report generation, Interview Memory, Classroom, and Candidate DNA logic rather than
  // forking a second copy of it (Phase 4B §7/§8).
  async function finishAsyncInterview(finalInterview) {
    setScreen("async_evaluating");
    try {
      const evalResult = await generateBatchEvaluation(
        finalInterview.config, profile.interview_profile, finalInterview.cvBackground, finalInterview.questions, finalInterview.answers,
        { applicationId: finalInterview.applicationId, interviewId: finalInterview.id }
      );
      const transcript = finalInterview.questions.map((q, i) => {
        const a = finalInterview.answers[i];
        const evaluation = evalResult.evaluations[i];
        return { question: { text: q.text, category: q.category, competency: q.competency, dbId: q.dbId, questionNumber: q.questionNumber }, answer: a?.text ?? "", evaluation };
      });
      for (let i = 0; i < transcript.length; i++) {
        const a = finalInterview.answers[i];
        if (a?.answerDbId) await dbInsertEvaluationForAnswer(a.answerDbId, transcript[i].evaluation, null);
      }
      await finishInterview({ ...finalInterview, transcript });
    } catch (e) {
      setError(e.message || "Something went wrong evaluating your interview.");
      setScreen("async_interview");
    }
  }

  function resetForNewInterview() {
    setCompany(""); setRole(""); setJdText(""); setCvText(""); setInterviewStage("first_round"); setInterviewFormat(null); setLength(12);
    setProfile(null); setInterview(null); setReport(null); setError(""); setFocusWeaknesses(false); setWizardStep(1); setApplicationId(null);
    setScreen("create");
  }

  /* ---------------- ASSESSMENT CENTRE ---------------- */
  function startAssessmentCentre(type) {
    setAcType(type); setAcSubmission(""); setAcResult(null); setError("");
    generateAcScenario(type);
  }

  async function generateAcScenario(type) {
    setScreen("ac_generating");
    try {
      const cfg = EXERCISE_TYPES.find((t) => t.key === type);
      const priorAttempts = acAttempts.filter((a) => a.type === type);
      const priorAvg = priorAttempts.length ? Math.round(priorAttempts.reduce((s, a) => s + a.overall_score, 0) / priorAttempts.length) : null;
      const system = `You design realistic graduate assessment-centre exercises. Return strict JSON only, no prose:
{ "title": "", "brief": "", "objective": "", "materials": [""], "suggested_time_minutes": 15 }
Rules: ground it in the specific company and role given, for a "${cfg.label}" exercise. materials should be short concrete bullets (documents, data points, or — for an inbox exercise — the individual inbox items themselves, each one bullet with sender/subject/gist and no explicit urgency label, since judging urgency is the point of the exercise). Calibrate difficulty${priorAvg !== null ? ` — the candidate averaged ${priorAvg}/100 on this exercise type before, so ${priorAvg >= 75 ? "raise the difficulty a notch" : priorAvg < 50 ? "keep it approachable" : "keep it moderately challenging"}` : " for a first attempt: realistic but approachable"}.`;
      const userText = `Exercise type: ${cfg.label}\nCompany: ${sanitizeText(acCompany)}\nRole: ${sanitizeText(acRole)}\nCandidate level: ${candidateLevel()}\nKnown weaknesses to weave in naturally where relevant: ${(perf?.weaknesses || []).join("; ") || "none yet"}`;
      const result = validateAcScenario(await callClaude(system, userText, 1400, false, { requestType: "assessment_centre_scenario", applicationId }));
      setAcScenario(result);
      setScreen("ac_exercise");
    } catch (e) {
      setError(e.message || "Couldn't generate this exercise.");
      setScreen("ac_home");
    }
  }

  async function submitAcResponse() {
    if (!acSubmission.trim() || !acScenario) return;
    setError("");
    const clean = sanitizeText(acSubmission);
    setScreen("ac_evaluating");
    try {
      const cfg = EXERCISE_TYPES.find((t) => t.key === acType);
      const breakdownKeys = cfg.competencies.map((c) => `"${slugify(c)}": 0`).join(", ");
      const system = `You are an assessment-centre assessor evaluating a candidate's ${cfg.label} submission. Return strict JSON only, no prose:
{
  "overall_score": 0,
  "breakdown": {${breakdownKeys}},
  "did_well": [""], "held_back": [""],
  "classroom_topics": [{"topic": "", "category": "company_knowledge|technical|commercial_awareness|behavioural|technique|role_specific", "description": "", "related_question": "", "initial_score": 0}],
  "updated_candidate_weaknesses": [""], "updated_candidate_strengths": [""]
}
Rules: score honestly, 0-100 per competency, using exactly the keys given in "breakdown".${cfg.key === "group" ? ' This is a group exercise — do NOT reward the candidate simply for writing more. Distinguish high-quality contribution (building on others\' ideas, constructive challenge, moving the group toward a decision) from excessive talking; score "collaboration" and "contribution_quality" on quality, not volume.' : ""} classroom_topics: only genuine, specific, teachable weaknesses (usually 1-2) — never invent facts.`;
      const userText = `Exercise: ${JSON.stringify(acScenario)}\nCandidate's submission: ${clean}`;
      const result = validateAcResult(await callClaude(system, userText, 2200, false, { requestType: "assessment_centre" }));
      setAcResult(result);

      const cfgLabel = cfg.label;
      const acAppMatches = applicationId && company === acCompany && role === acRole;
      const savedAttempt = await dbInsertAssessmentAttempt(user.id, acAppMatches ? applicationId : null, { type: acType, typeLabel: cfgLabel, company: acCompany, role: acRole, overall_score: result.overall_score, breakdown: result.breakdown, scenario: acScenario, submission: clean, result });
      const attempt = { id: savedAttempt?.id || ("local_" + Date.now()), type: acType, typeLabel: cfgLabel, company: acCompany, role: acRole, date: Date.now(), overall_score: result.overall_score, breakdown: result.breakdown };
      setAcAttempts([...acAttempts, attempt]);

      await pushClassroomTopics(result.classroom_topics, { company: acCompany, role: acRole, id: savedAttempt?.id, applicationId: acAppMatches ? applicationId : null, isInterview: false });
      await applyPerformanceUpdate({ weaknesses: result.updated_candidate_weaknesses, strengths: result.updated_candidate_strengths, breakdown: {}, styleNotes: [] });

      setScreen("ac_scorecard");
    } catch (e) {
      setError(e.message || "Something went wrong evaluating that submission.");
      setScreen("ac_exercise");
    }
  }

  /* ---------------- DERIVED VALUES ---------------- */
  const showNav = ["landing", "how", "universities", "login", "dashboard", "create", "preview", "progress", "report", "classroom", "lesson", "ac_home", "ac_exercise", "ac_scorecard"].includes(screen);
  const classroomNeedsWorkCount = classroom.filter((t) => statusFor(t.scores).label !== "Mastered").length;
  const acReadiness = (() => {
    if (!acAttempts.length) return 0;
    const latestByType = {};
    acAttempts.forEach((a) => { latestByType[a.type] = a; });
    const vals = Object.values(latestByType).map((a) => a.overall_score);
    return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  })();
  const compKeys = Object.keys(perf?.competency_history || {});
  const compLatest = compKeys.map((k) => ({ key: k, value: perf.competency_history[k][perf.competency_history[k].length - 1], history: perf.competency_history[k] }));
  const dnaStrengths = [...compLatest].sort((a, b) => b.value - a.value).slice(0, 3);
  const dnaWeaknesses = [...compLatest].sort((a, b) => a.value - b.value).slice(0, 3);
  const dnaBiggestImprovement = [...compLatest].filter((c) => c.history.length >= 2)
    .map((c) => ({ ...c, delta: c.history[c.history.length - 1] - c.history[0] }))
    .sort((a, b) => b.delta - a.delta)[0];
  const dnaPriority = dnaWeaknesses[0];
  const inputStyle = { width: "100%", padding: "11px 13px", border: "1.5px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 14 };

  if (!authChecked) {
    return (
      <div style={{ fontFamily: "var(--font)", background: "var(--bg)", minHeight: "100vh" }}>
        <style>{TOKENS}</style>
        <LoadingScreen messages={["Restoring your session..."]} />
      </div>
    );
  }

  /* ================================================================== */
  return (
    <div style={{ fontFamily: "var(--font)", background: "var(--bg)", minHeight: "100%", color: "var(--text)" }}>
      <style>{TOKENS}</style>
      {showNav && <NavBar screen={screen} setScreen={setScreen} user={user} classroomNeedsWorkCount={classroomNeedsWorkCount} onSignOut={() => guarded(handleSignOut)} />}

      {/* ---------------- LANDING ---------------- */}
      {screen === "landing" && (
        <div className="jr-fade">
          <div style={{ maxWidth: 1080, margin: "0 auto", padding: "72px 24px 40px" }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
              <div>
                <Pill>Built for role-specific interview prep</Pill>
                <h1 style={{ fontSize: 46, lineHeight: 1.12, fontWeight: 800, letterSpacing: "-0.02em", margin: "18px 0 16px", color: "var(--navy)" }}>
                  Practise the interview you're actually going to face.
                </h1>
                <p style={{ fontSize: 17, color: "var(--text-dim)", lineHeight: 1.6, marginBottom: 28 }}>
                  Upload your CV and job description. JOB.READY builds a personalised, adaptive interview around the role you're applying for — then tells you exactly how to improve.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Btn variant="accent" onClick={() => setScreen("login")}>Start practising <ChevronRight size={16} /></Btn>
                  <Btn variant="secondary" onClick={() => setScreen("how")}>See how it works</Btn>
                </div>
              </div>
              <div style={{ position: "relative" }}>
                <div style={{ position: "absolute", width: 200, height: 200, background: "var(--violet)", opacity: 0.12, borderRadius: "50%", top: -30, right: -20, filter: "blur(10px)" }} />
                <div style={{ position: "absolute", width: 160, height: 160, background: "var(--teal)", opacity: 0.14, borderRadius: "50%", bottom: -20, left: -20, filter: "blur(10px)" }} />
                <Card style={{ position: "relative", padding: 22, borderRadius: 18 }} hover={false}>
                  <div className="flex items-center justify-between mb-4">
                    <JobReadyLogo size={20} />
                    <Pill color="var(--violet)" bg="#F1E9FE">Mixed interview</Pill>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 2 }}>JPMorgan</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--navy)", marginBottom: 14 }}>Global Markets Summer Analyst</div>
                  <div style={{ background: "#F8FAFC", border: "1px solid var(--border)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: "var(--blue)", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Motivation / Fit</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--navy)" }}>"Why are you interested in Global Markets?"</div>
                  </div>
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Interview readiness</span>
                      <span style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)" }}>78%</span>
                    </div>
                    <ScoreBar label="Structure" value={84} />
                    <ScoreBar label="Specificity" value={71} />
                    <ScoreBar label="Commercial awareness" value={82} />
                  </div>
                </Card>
              </div>
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", background: "#fff" }}>
            <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 24px" }}>
              <div style={{ fontSize: 13, color: "var(--text-faint)", textAlign: "center", marginBottom: 18, fontWeight: 600, letterSpacing: "0.02em" }}>BUILT FOR THE INTERVIEWS THAT MATTER</div>
              <div className="flex justify-center flex-wrap gap-3">
                {["Investment Banking", "Consulting", "Technology", "Asset Management", "Law", "Graduate Schemes"].map((c) => (
                  <span key={c} style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-dim)", background: "var(--bg)", border: "1px solid var(--border)", padding: "8px 16px", borderRadius: 999 }}>{c}</span>
                ))}
              </div>
            </div>
          </div>

          <div style={{ maxWidth: 1080, margin: "0 auto", padding: "72px 24px" }}>
            <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--navy)", textAlign: "center", marginBottom: 40, letterSpacing: "-0.01em" }}>Generic interview practice isn't enough.</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                ["Generic questions", "Most interview practice gives everyone the same questions, regardless of the role."],
                ["No personal feedback", "Candidates don't know exactly why their answers aren't strong enough."],
                ["No progression", "Candidates practise repeatedly without knowing whether they're actually improving."],
              ].map(([t, d], i) => (
                <Card key={i} style={{ padding: 24 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                    <XCircle size={17} color="var(--bad)" />
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15.5, color: "var(--navy)", marginBottom: 6 }}>{t}</div>
                  <div style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.5 }}>{d}</div>
                </Card>
              ))}
            </div>
          </div>

          <div style={{ background: "#fff", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
            <div style={{ maxWidth: 1080, margin: "0 auto", padding: "72px 24px" }}>
              <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--navy)", textAlign: "center", marginBottom: 44, letterSpacing: "-0.01em" }}>How it works</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {[
                  ["01", "Upload your application", "Add your CV and the job description."],
                  ["02", "Take your interview", "JOB.READY asks realistic questions based on your role, company and experience."],
                  ["03", "Improve", "Get detailed feedback and track your interview readiness over time."],
                ].map(([n, t, d], i) => (
                  <div key={i}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "var(--blue)", marginBottom: 10 }}>{n}</div>
                    <div style={{ fontSize: 19, fontWeight: 700, color: "var(--navy)", marginBottom: 8 }}>{t}</div>
                    <div style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.55 }}>{d}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ maxWidth: 860, margin: "0 auto", padding: "72px 24px" }}>
            <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--navy)", textAlign: "center", marginBottom: 12, letterSpacing: "-0.01em" }}>Not another chatbot.</h2>
            <p style={{ textAlign: "center", color: "var(--text-dim)", fontSize: 15, marginBottom: 36 }}>A real interview simulation, not a Q&A window.</p>
            <Card style={{ overflow: "hidden" }} hover={false}>
              <div className="grid grid-cols-1 md:grid-cols-2">
                <div style={{ padding: "16px 22px", fontSize: 13, fontWeight: 700, color: "var(--text-faint)", borderBottom: "1px solid var(--border)" }}>TRADITIONAL AI CHAT</div>
                <div style={{ padding: "16px 22px", fontSize: 13, fontWeight: 700, color: "var(--blue)", borderBottom: "1px solid var(--border)" }}>JOB.READY</div>
                {[
                  ["Generic questions", "Role-specific questions"],
                  ["Static conversation", "Adaptive interview"],
                  ["Generic feedback", "Competency-based feedback"],
                  ["No memory", "Remembers weaknesses"],
                  ["No progression", "Tracks improvement"],
                ].map((row, i) => (
                  <React.Fragment key={i}>
                    <div style={{ padding: "14px 22px", fontSize: 14, color: "var(--text-dim)", borderBottom: i < 4 ? "1px solid var(--border)" : "none" }}>{row[0]}</div>
                    <div style={{ padding: "14px 22px", fontSize: 14, fontWeight: 600, color: "var(--navy)", borderBottom: i < 4 ? "1px solid var(--border)" : "none", display: "flex", alignItems: "center", gap: 8 }}>
                      <CheckCircle2 size={14} color="var(--good)" /> {row[1]}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </Card>
          </div>

          <div style={{ background: "var(--navy)", padding: "80px 24px" }}>
            <div style={{ maxWidth: 1080, margin: "0 auto" }}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
                <div>
                  <h2 style={{ fontSize: 30, fontWeight: 800, color: "#fff", marginBottom: 14, letterSpacing: "-0.01em" }}>Your interview. Your role. Your weaknesses.</h2>
                  <p style={{ color: "#94A3B8", fontSize: 15, lineHeight: 1.6, marginBottom: 20 }}>Every report is scored against the actual competencies your target role demands — and tells you precisely what to fix next.</p>
                  <div style={{ fontSize: 13, color: "var(--teal)", fontWeight: 700, marginBottom: 10, textTransform: "uppercase" }}>Focus next time</div>
                  {["Quantify your achievements", "Reduce answer length", "Make motivation more company-specific"].map((t, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, color: "#fff", fontSize: 14.5 }}>
                      <div style={{ width: 20, height: 20, borderRadius: 6, background: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                      {t}
                    </div>
                  ))}
                </div>
                <Card style={{ padding: 24 }} hover={false}>
                  <div className="flex items-center gap-6 mb-5">
                    <RingScore value={78} size={100} />
                    <div>
                      <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Interview readiness</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--good)", marginTop: 4 }}>Interview ready</div>
                    </div>
                  </div>
                  <ScoreBar label="Communication" value={82} />
                  <ScoreBar label="Structure" value={74} />
                  <ScoreBar label="Specificity" value={68} />
                  <ScoreBar label="Commercial awareness" value={84} />
                </Card>
              </div>
            </div>
          </div>

          <div style={{ maxWidth: 1080, margin: "0 auto", padding: "80px 24px" }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
              <Card style={{ padding: 26 }}>
                <div className="flex items-end gap-4" style={{ height: 140 }}>
                  {[62, 69, 77, 84].map((v, i) => (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--navy)", marginBottom: 6 }}>{v}</div>
                      <div style={{ width: "60%", height: v, background: i === 3 ? "var(--blue)" : "#DBEAFE", borderRadius: "6px 6px 0 0" }} />
                      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>#{i + 1}</div>
                    </div>
                  ))}
                </div>
              </Card>
              <div>
                <h2 style={{ fontSize: 30, fontWeight: 800, color: "var(--navy)", marginBottom: 14, letterSpacing: "-0.01em" }}>Get better with every interview.</h2>
                <p style={{ color: "var(--text-dim)", fontSize: 15, lineHeight: 1.6 }}>JOB.READY remembers where you struggle and adapts future interviews around the areas you need to improve.</p>
              </div>
            </div>
          </div>

          <div style={{ background: "#fff", borderTop: "1px solid var(--border)" }}>
            <div style={{ maxWidth: 780, margin: "0 auto", padding: "64px 24px", textAlign: "center" }}>
              <h2 style={{ fontSize: 25, fontWeight: 800, color: "var(--navy)", marginBottom: 12 }}>Give every student access to interview preparation.</h2>
              <p style={{ color: "var(--text-dim)", fontSize: 14.5, marginBottom: 20, maxWidth: 520, margin: "0 auto 22px" }}>Careers teams can give students personalised interview practice at a scale that one-to-one coaching cannot match.</p>
              <Btn variant="secondary" onClick={() => setScreen("universities")}>For universities <ArrowRight size={15} /></Btn>
            </div>
          </div>

          <div style={{ background: "linear-gradient(135deg, var(--navy), #1E293B)", padding: "84px 24px", textAlign: "center" }}>
            <h2 style={{ fontSize: 34, fontWeight: 800, color: "#fff", marginBottom: 14, letterSpacing: "-0.01em" }}>Your next interview starts here.</h2>
            <p style={{ color: "#94A3B8", fontSize: 15.5, marginBottom: 28 }}>Stop guessing what you'll be asked. Start practising for the interview you're actually going to face.</p>
            <Btn variant="accent" onClick={() => setScreen("login")} style={{ padding: "14px 28px", fontSize: 15.5 }}>Start practising <ChevronRight size={16} /></Btn>
          </div>
        </div>
      )}

      {/* ---------------- HOW / UNIVERSITIES ---------------- */}
      {screen === "how" && (
        <div className="jr-fade" style={{ maxWidth: 640, margin: "0 auto", padding: "64px 24px" }}>
          <Btn variant="ghost" onClick={() => setScreen("landing")} style={{ marginBottom: 20, padding: "8px 4px" }}><ArrowLeft size={14} /> Back</Btn>
          <h2 style={{ fontSize: 28, fontWeight: 800, color: "var(--navy)", marginBottom: 24 }}>How JOB.READY works</h2>
          {[
            "Tell us the company, role and stage, and add the job description and your CV.",
            "The AI reads both together and builds an interview profile — competencies, likely themes, and CV claims worth probing.",
            "You sit a live, adaptive interview: the next question depends on how you answered the last one, just like a real interviewer.",
            "You get a structured report — scored, specific, honest about what's inferred versus stated — and your weak spots carry into the next session.",
          ].map((t, i) => (
            <div key={i} className="flex gap-4 mb-5">
              <div style={{ width: 26, height: 26, borderRadius: 8, background: "var(--highlight)", color: "var(--blue)", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div>
              <div style={{ fontSize: 15, lineHeight: 1.55, color: "var(--text-dim)" }}>{t}</div>
            </div>
          ))}
          <Btn variant="accent" onClick={() => setScreen("login")} style={{ marginTop: 8 }}>Start practising <ChevronRight size={16} /></Btn>
        </div>
      )}
      {screen === "universities" && (
        <div className="jr-fade" style={{ maxWidth: 640, margin: "0 auto", padding: "64px 24px", textAlign: "center" }}>
          <Btn variant="ghost" onClick={() => setScreen("landing")} style={{ marginBottom: 20, padding: "8px 4px" }}><ArrowLeft size={14} /> Back</Btn>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--navy)", marginBottom: 14 }}>JOB.READY for universities</h2>
          <p style={{ color: "var(--text-dim)", fontSize: 15, lineHeight: 1.6 }}>The institutional dashboard is on the roadmap. This MVP is focused on proving the individual student experience first.</p>
        </div>
      )}

      {/* ---------------- LOGIN (real Supabase Auth) ---------------- */}
      {screen === "login" && (
        <div className="jr-fade" style={{ maxWidth: 420, margin: "0 auto", padding: "72px 24px" }}>
          {authView === "signup" && (
            <>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--navy)", marginBottom: 20 }}>Create your account</h2>
              <Card style={{ padding: 24 }}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 16 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>First name</label>
                    <input value={firstNameInput} onChange={(e) => setFirstNameInput(e.target.value)} placeholder="Alex" style={{ ...inputStyle, marginTop: 6 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>Last name</label>
                    <input value={lastNameInput} onChange={(e) => setLastNameInput(e.target.value)} placeholder="Chen" style={{ ...inputStyle, marginTop: 6 }} />
                  </div>
                </div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>Email</label>
                <input type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="alex@university.ac.uk" style={{ ...inputStyle, marginTop: 6, marginBottom: 16 }} />
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>Password</label>
                <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} placeholder="At least 8 characters" style={{ ...inputStyle, marginTop: 6, marginBottom: 16 }} />
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>Confirm password</label>
                <input type="password" value={confirmPasswordInput} onChange={(e) => setConfirmPasswordInput(e.target.value)} style={{ ...inputStyle, marginTop: 6, marginBottom: 8 }} />
                {error && <div style={{ color: "var(--bad)", fontSize: 13, marginBottom: 10 }}>{error}</div>}
                {authNotice && <div style={{ color: "var(--good)", fontSize: 13, marginBottom: 10 }}>{authNotice}</div>}
                <Btn variant="accent" full onClick={() => guarded(handleSignUp)} style={{ marginTop: 8 }}>Create account <ChevronRight size={16} /></Btn>
              </Card>
              <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 16, textAlign: "center" }}>
                Already have an account?{" "}
                <span onClick={() => { setError(""); setAuthNotice(""); setAuthView("signin"); }} style={{ color: "var(--blue)", fontWeight: 600, cursor: "pointer" }}>Sign in</span>
              </div>
            </>
          )}

          {authView === "signin" && (
            <>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--navy)", marginBottom: 20 }}>Sign in</h2>
              <Card style={{ padding: 24 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>Email</label>
                <input type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="alex@university.ac.uk" style={{ ...inputStyle, marginTop: 6, marginBottom: 16 }} />
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>Password</label>
                <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} style={{ ...inputStyle, marginTop: 6, marginBottom: 8 }} />
                <div className="flex justify-end" style={{ marginBottom: 8 }}>
                  <span onClick={() => { setError(""); setAuthNotice(""); setAuthView("forgot"); }} style={{ fontSize: 12.5, color: "var(--blue)", cursor: "pointer", fontWeight: 600 }}>Forgot password?</span>
                </div>
                {error && <div style={{ color: "var(--bad)", fontSize: 13, marginBottom: 10 }}>{error}</div>}
                {authNotice && <div style={{ color: "var(--good)", fontSize: 13, marginBottom: 10 }}>{authNotice}</div>}
                <Btn variant="accent" full onClick={() => guarded(handleSignIn)} style={{ marginTop: 8 }}>Sign in <ChevronRight size={16} /></Btn>
              </Card>
              <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 16, textAlign: "center" }}>
                New to JOB.READY?{" "}
                <span onClick={() => { setError(""); setAuthNotice(""); setAuthView("signup"); }} style={{ color: "var(--blue)", fontWeight: 600, cursor: "pointer" }}>Create account</span>
              </div>
            </>
          )}

          {authView === "forgot" && (
            <>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--navy)", marginBottom: 20 }}>Reset your password</h2>
              <Card style={{ padding: 24 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>Email</label>
                <input type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="alex@university.ac.uk" style={{ ...inputStyle, marginTop: 6, marginBottom: 8 }} />
                {error && <div style={{ color: "var(--bad)", fontSize: 13, marginBottom: 10 }}>{error}</div>}
                {authNotice && <div style={{ color: "var(--good)", fontSize: 13, marginBottom: 10 }}>{authNotice}</div>}
                <Btn variant="accent" full onClick={() => guarded(handleForgotPassword)} style={{ marginTop: 8 }}>Send reset link <ChevronRight size={16} /></Btn>
              </Card>
              <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 16, textAlign: "center" }}>
                <span onClick={() => { setError(""); setAuthNotice(""); setAuthView("signin"); }} style={{ color: "var(--blue)", fontWeight: 600, cursor: "pointer" }}>Back to sign in</span>
              </div>
            </>
          )}

          {authView === "reset" && (
            <>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--navy)", marginBottom: 20 }}>Set a new password</h2>
              <Card style={{ padding: 24 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>New password</label>
                <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} placeholder="At least 8 characters" style={{ ...inputStyle, marginTop: 6, marginBottom: 16 }} />
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>Confirm new password</label>
                <input type="password" value={confirmPasswordInput} onChange={(e) => setConfirmPasswordInput(e.target.value)} style={{ ...inputStyle, marginTop: 6, marginBottom: 8 }} />
                {error && <div style={{ color: "var(--bad)", fontSize: 13, marginBottom: 10 }}>{error}</div>}
                {authNotice && <div style={{ color: "var(--good)", fontSize: 13, marginBottom: 10 }}>{authNotice}</div>}
                <Btn variant="accent" full onClick={() => guarded(handleResetPassword)} style={{ marginTop: 8 }}>Update password <ChevronRight size={16} /></Btn>
              </Card>
              <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 16, textAlign: "center" }}>
                <span onClick={() => { setError(""); setAuthNotice(""); guarded(handleSignOut); setAuthView("signin"); }} style={{ color: "var(--blue)", fontWeight: 600, cursor: "pointer" }}>Cancel</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------------- DASHBOARD ---------------- */}
      {screen === "dashboard" && user && (
        <div className="jr-fade" style={{ maxWidth: 900, margin: "0 auto", padding: "44px 24px" }}>
          <div className="flex justify-between items-start mb-8">
            <div>
              <h2 style={{ fontSize: 27, fontWeight: 800, color: "var(--navy)" }}>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, {user.first_name || user.email.split("@")[0]}</h2>
              <div style={{ fontSize: 14.5, color: "var(--text-dim)", marginTop: 4 }}>Ready for your next interview?</div>
            </div>
            <Btn variant="accent" onClick={() => startCreateFlow(false)}><Sparkles size={16} /> New interview</Btn>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <Card style={{ padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)", marginBottom: 8 }}>INTERVIEW READINESS</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: "var(--navy)" }}>{interviewList.length ? interviewList[interviewList.length - 1].overall_score : "—"}<span style={{ fontSize: 15, color: "var(--text-faint)" }}>/100</span></div>
              {interviewList.length > 1 && (
                <div style={{ fontSize: 12, color: "var(--good)", fontWeight: 600, marginTop: 4 }}>
                  {interviewList[interviewList.length - 1].overall_score - interviewList[interviewList.length - 2].overall_score >= 0 ? "↑" : "↓"} since last interview
                </div>
              )}
            </Card>
            <Card style={{ padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)", marginBottom: 8 }}>INTERVIEWS COMPLETED</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: "var(--navy)" }}>{interviewList.length}</div>
            </Card>
            <Card style={{ padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)", marginBottom: 8 }}>TOP FOCUS AREA</div>
              <div style={{ fontSize: 14.5, color: "var(--navy)", fontWeight: 600, lineHeight: 1.4 }}>{perf?.weaknesses?.[0] || "Complete an interview to find out"}</div>
            </Card>
          </div>

          {perf?.weaknesses?.length > 0 && (
            <Card style={{ padding: 22, marginBottom: 20, borderLeft: "4px solid var(--blue)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--blue)", marginBottom: 12, textTransform: "uppercase" }}>Your focus areas</div>
              {perf.weaknesses.slice(0, 3).map((w, i) => (
                <div key={i} className="flex gap-3 mb-2" style={{ fontSize: 14.5, color: "var(--text)" }}>
                  <span style={{ fontWeight: 700, color: "var(--navy)" }}>{i + 1}.</span> {w}
                </div>
              ))}
              <Btn variant="secondary" onClick={() => startCreateFlow(true)} style={{ marginTop: 10 }}>Practise weaknesses <ArrowRight size={15} /></Btn>
            </Card>
          )}

          {classroom.length > 0 && (
            <Card style={{ padding: 22, marginBottom: 16, borderLeft: "4px solid var(--violet)" }}>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: "#F1E9FE", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <GraduationCap size={17} color="var(--violet)" />
                  </div>
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--navy)" }}>Classroom</div>
                    <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{classroomNeedsWorkCount > 0 ? `${classroomNeedsWorkCount} lesson${classroomNeedsWorkCount !== 1 ? "s" : ""} ready from your weaknesses` : "You've mastered every topic so far"}</div>
                  </div>
                </div>
                <Btn variant="secondary" onClick={() => setScreen("classroom")}>Open <ArrowRight size={15} /></Btn>
              </div>
            </Card>
          )}

          <Card style={{ padding: 22, marginBottom: 24, borderLeft: "4px solid var(--teal)" }}>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div style={{ width: 34, height: 34, borderRadius: 9, background: "#E6FBF6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Briefcase size={17} color="var(--teal)" />
                </div>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--navy)" }}>Assessment Centre</div>
                  <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{acAttempts.length > 0 ? `${acReadiness}% readiness across ${acAttempts.length} exercise${acAttempts.length !== 1 ? "s" : ""}` : "Practise group exercises, case studies, presentations & more"}</div>
                </div>
              </div>
              <Btn variant="secondary" onClick={() => setScreen("ac_home")}>{acAttempts.length > 0 ? "Open" : "Explore"} <ArrowRight size={15} /></Btn>
            </div>
          </Card>

          <div className="flex justify-between items-center mb-3">
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--navy)" }}>Recent interviews</div>
            {interviewList.length > 0 && <Btn variant="ghost" onClick={() => setScreen("progress")} style={{ padding: "6px 4px" }}><BarChart3 size={14} /> View progress</Btn>}
          </div>
          {interviewList.length === 0 ? (
            <Card style={{ padding: 36, textAlign: "center", color: "var(--text-faint)", fontSize: 14 }}>No interviews yet. Start your first one to see your readiness score here.</Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[...interviewList].reverse().map((iv) => (
                <Card key={iv.id} style={{ padding: 18 }}>
                  <div className="flex justify-between items-start">
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--navy)" }}>{iv.company}</div>
                      <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 2 }}>{iv.role}</div>
                      <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 6 }}>{new Date(iv.date).toLocaleDateString()}</div>
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)" }}>{iv.overall_score}<span style={{ fontSize: 12, color: "var(--text-faint)" }}>/100</span></div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------------- CREATE (progressive wizard) ---------------- */}
      {screen === "create" && (
        <div className="jr-fade" style={{ maxWidth: 620, margin: "0 auto", padding: "44px 24px" }}>
          <Btn variant="ghost" onClick={() => setScreen("dashboard")} style={{ marginBottom: 16, padding: "6px 4px" }}><ArrowLeft size={14} /> Dashboard</Btn>
          <div className="flex gap-2 mb-8">
            {[1, 2, 3, 4].map((s) => <div key={s} style={{ flex: 1, height: 5, borderRadius: 999, background: s <= wizardStep ? "var(--blue)" : "var(--border)" }} />)}
          </div>
          {focusWeaknesses && <Pill color="var(--violet)" bg="#F1E9FE">Focused on your weak spots</Pill>}

          {wizardStep === 1 && (
            <div className="jr-fade">
              <h2 style={{ fontSize: 23, fontWeight: 800, color: "var(--navy)", margin: "14px 0 6px" }}>What are you interviewing for?</h2>
              <p style={{ fontSize: 14, color: "var(--text-dim)", marginBottom: 20 }}>Enter the company and role.</p>
              <button onClick={loadDemo} style={{ fontSize: 12.5, color: "var(--blue)", background: "none", border: "none", cursor: "pointer", marginBottom: 16, fontWeight: 600 }}>Fill with example (JPMorgan · Global Markets Summer Analyst)</button>
              <Card style={{ padding: 22 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>Company</label>
                <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. JPMorgan" style={{ ...inputStyle, marginTop: 6, marginBottom: 16 }} />
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>Role</label>
                <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Global Markets Summer Analyst" style={{ ...inputStyle, marginTop: 6 }} />
              </Card>
              <Btn variant="accent" full onClick={() => guarded(confirmCompanyRole)} disabled={!company || !role} style={{ marginTop: 18 }}>Continue <ChevronRight size={16} /></Btn>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="jr-fade">
              <h2 style={{ fontSize: 23, fontWeight: 800, color: "var(--navy)", margin: "14px 0 6px" }}>Tell us about the role.</h2>
              <p style={{ fontSize: 14, color: "var(--text-dim)", marginBottom: 20 }}>Paste the job description, or upload a file.</p>
              <Card style={{ padding: 22 }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2" style={{ color: "var(--text-faint)", fontSize: 12 }}><Upload size={13} /> Paste text, or upload .txt / .docx / .pdf</div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: fileBusy === "jd" ? "var(--text-faint)" : "var(--blue)", cursor: fileBusy === "jd" ? "default" : "pointer" }}>
                    {fileBusy === "jd" ? "Processing..." : "Upload file"}
                    <input disabled={fileBusy === "jd"} type="file" accept=".txt,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={{ display: "none" }} onChange={(e) => handleFileUpload(e, "jd")} />
                  </label>
                </div>
                <textarea value={jdText} onChange={(e) => setJdText(e.target.value)} placeholder="Paste the job description here"
                  style={{ width: "100%", height: 220, padding: 13, border: "1.5px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 13.5, lineHeight: 1.5, fontFamily: "var(--font)" }} />
              </Card>
              {error && <div style={{ color: "var(--bad)", fontSize: 13, marginTop: 12 }}>{error}</div>}
              <div className="flex flex-wrap gap-3 mt-4">
                <Btn variant="secondary" onClick={() => setWizardStep(1)}><ArrowLeft size={15} /> Back</Btn>
                <Btn variant="accent" full onClick={() => setWizardStep(3)} disabled={!jdText}>Continue <ChevronRight size={16} /></Btn>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="jr-fade">
              <h2 style={{ fontSize: 23, fontWeight: 800, color: "var(--navy)", margin: "14px 0 6px" }}>Tell us about you.</h2>
              <p style={{ fontSize: 14, color: "var(--text-dim)", marginBottom: 20 }}>Paste your CV, or upload a file.</p>
              <Card style={{ padding: 22 }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2" style={{ color: "var(--text-faint)", fontSize: 12 }}><Upload size={13} /> Paste text, or upload .txt / .docx / .pdf</div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: fileBusy === "cv" ? "var(--text-faint)" : "var(--blue)", cursor: fileBusy === "cv" ? "default" : "pointer" }}>
                    {fileBusy === "cv" ? "Processing..." : "Upload file"}
                    <input disabled={fileBusy === "cv"} type="file" accept=".txt,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={{ display: "none" }} onChange={(e) => handleFileUpload(e, "cv")} />
                  </label>
                </div>
                <textarea value={cvText} onChange={(e) => setCvText(e.target.value)} placeholder="Paste your CV text here"
                  style={{ width: "100%", height: 220, padding: 13, border: "1.5px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 13.5, lineHeight: 1.5, fontFamily: "var(--font)" }} />
              </Card>
              {error && <div style={{ color: "var(--bad)", fontSize: 13, marginTop: 12 }}>{error}</div>}
              <div className="flex flex-wrap gap-3 mt-4">
                <Btn variant="secondary" onClick={() => setWizardStep(2)}><ArrowLeft size={15} /> Back</Btn>
                <Btn variant="accent" full onClick={() => setWizardStep(4)} disabled={!cvText}>Continue <ChevronRight size={16} /></Btn>
              </div>
            </div>
          )}

          {wizardStep === 4 && (() => {
            const currentStage = stageByKey(interviewStage);
            const canChooseFormat = currentStage.allowedFormats.length > 1;
            return (
            <div className="jr-fade">
              <h2 style={{ fontSize: 23, fontWeight: 800, color: "var(--navy)", margin: "14px 0 6px" }}>Choose your interview.</h2>
              <p style={{ fontSize: 14, color: "var(--text-dim)", marginBottom: 20 }}>What stage are you preparing for?</p>
              <Card style={{ padding: 22 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>Interview stage</label>
                <div className="flex flex-col gap-2 mt-2 mb-4">
                  {INTERVIEW_STAGES.map((s) => (
                    <button key={s.key} onClick={() => { setInterviewStage(s.key); setInterviewFormat(null); }} style={{
                      textAlign: "left", padding: "12px 14px", borderRadius: "var(--radius-sm)", cursor: "pointer",
                      border: interviewStage === s.key ? "1.5px solid var(--blue)" : "1.5px solid var(--border)",
                      background: interviewStage === s.key ? "var(--highlight)" : "#fff",
                    }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: interviewStage === s.key ? "var(--blue)" : "var(--navy)" }}>{s.label}</div>
                      <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 2 }}>{s.blurb}</div>
                    </button>
                  ))}
                </div>

                {canChooseFormat && (
                  <>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>Format</label>
                    <div className="flex gap-2 mt-2 mb-4">
                      {currentStage.allowedFormats.map((fKey) => {
                        const active = (interviewFormat || currentStage.defaultFormat) === fKey;
                        return (
                          <button key={fKey} onClick={() => setInterviewFormat(fKey)} style={{
                            flex: 1, padding: "10px 12px", borderRadius: "var(--radius-sm)", fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left",
                            border: active ? "1.5px solid var(--blue)" : "1.5px solid var(--border)",
                            background: active ? "var(--highlight)" : "#fff", color: active ? "var(--blue)" : "var(--text-dim)",
                          }}>{INTERVIEW_FORMATS[fKey].label}</button>
                        );
                      })}
                    </div>
                  </>
                )}

                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>Length</label>
                <div className="flex gap-2 mt-2">
                  {[["Short", 8], ["Standard", 12], ["Long", 18]].map(([l, v]) => (
                    <button key={l} onClick={() => setLength(v)} style={{
                      flex: 1, padding: "10px 0", borderRadius: "var(--radius-sm)", fontSize: 13.5, fontWeight: 600, cursor: "pointer",
                      border: length === v ? "1.5px solid var(--blue)" : "1.5px solid var(--border)",
                      background: length === v ? "var(--highlight)" : "#fff", color: length === v ? "var(--blue)" : "var(--text-dim)"
                    }}>{l} · {v}</button>
                  ))}
                </div>
              </Card>
              <div style={{ fontSize: 12.5, color: "var(--text-faint)", marginTop: 14 }}>
                Looking for a group exercise, case study, or written test instead?{" "}
                <span onClick={() => setScreen("ac_home")} style={{ color: "var(--blue)", fontWeight: 600, cursor: "pointer" }}>Try Assessment Centre</span>.
              </div>
              {error && <div style={{ color: "var(--bad)", fontSize: 13, marginTop: 14 }}>{error}</div>}
              <div className="flex flex-wrap gap-3 mt-5">
                <Btn variant="secondary" onClick={() => setWizardStep(3)}><ArrowLeft size={15} /> Back</Btn>
                <Btn variant="accent" full onClick={() => guarded(analyseAndPlan)}>Build my interview <Sparkles size={16} /></Btn>
              </div>
            </div>
            );
          })()}
        </div>
      )}

      {screen === "analyzing" && <LoadingScreen messages={["Reading the job description...", "Mapping required competencies...", "Reviewing your CV...", "Finding claims worth probing...", "Building your interview..."]} />}

      {/* ---------------- PREVIEW ---------------- */}
      {screen === "preview" && profile && (
        <div className="jr-fade" style={{ maxWidth: 680, margin: "0 auto", padding: "44px 24px" }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--navy)", marginBottom: 4 }}>{role} <span style={{ color: "var(--text-faint)", fontWeight: 600 }}>· {company}</span></h2>
          <div style={{ fontSize: 13.5, color: "var(--text-dim)", marginBottom: 22 }}>{interview?.stageLabel} · {interview?.formatLabel} · {interview?.config?.pipeline === "independent_batch" ? (interview.questions?.length || 0) : length} questions</div>

          <Card style={{ padding: 22, marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--navy)", marginBottom: 12 }}>Key competencies this interview will test</div>
            {(profile.interview_profile.competencies || []).map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", marginBottom: 9, fontSize: 14 }}>
                <Target size={13} color="var(--blue)" style={{ marginRight: 8, flexShrink: 0 }} /> {c.name} <TagBasis basis={c.basis} />
              </div>
            ))}
          </Card>

          <Card style={{ padding: 22, marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--navy)", marginBottom: 12 }}>Question mix</div>
            {Object.entries(profile.interview_profile.question_mix || {}).map(([k, v]) => <ScoreBar key={k} label={k.replace(/_/g, " ")} value={v} />)}
          </Card>

          {profile.candidate_profile?.potential_probe_areas?.length > 0 && (
            <Card style={{ padding: 22, marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--navy)", marginBottom: 12 }}>From your CV, likely to be probed</div>
              {profile.candidate_profile.potential_probe_areas.map((p, i) => (
                <div key={i} style={{ marginBottom: 10, fontSize: 13.5 }}>
                  <div style={{ color: "var(--navy)", fontWeight: 500 }}>"{p.claim}"</div>
                  <div style={{ color: "var(--text-dim)", fontSize: 12.5 }}>{p.why}</div>
                </div>
              ))}
            </Card>
          )}

          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 20, lineHeight: 1.5 }}>
            Questions marked "Inferred" or "General for role" are AI judgement calls, not confirmed facts about how {company || "this company"} actually interviews.
          </div>
          {error && <div style={{ color: "var(--bad)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <Btn variant="accent" full onClick={beginInterview}>Start interview <ChevronRight size={16} /></Btn>
        </div>
      )}

      {/* ---------------- INTERVIEW ---------------- */}
      {screen === "interview" && interview && (() => {
        const memMatch = matchPreviousQuestion(interview.currentQuestion?.text, interview.currentQuestion?.category, interview.currentQuestion?.competency, questionHistory);
        return (
          <div className="jr-fade" style={{ minHeight: "100vh" }}>
            <div style={{ borderBottom: "1px solid var(--border)", background: "#fff" }}>
              <div style={{ maxWidth: 680, margin: "0 auto", padding: "16px 24px" }}>
                <div className="flex justify-between items-center mb-3">
                  <JobReadyLogo size={20} />
                  <div style={{ fontSize: 12.5, color: "var(--text-dim)", fontWeight: 600 }}>{company} · {role}</div>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Question {interview.transcript.length + 1} of ~{interview.maxQuestions}</span>
                </div>
                <div style={{ height: 4, background: "var(--border)", borderRadius: 999 }}>
                  <div className="jr-bar" style={{ height: 4, borderRadius: 999, background: "var(--blue)", width: Math.min(100, ((interview.transcript.length + 1) / interview.maxQuestions) * 100) + "%" }} />
                </div>
              </div>
            </div>

            <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 24px" }}>
              {memMatch && (
                <Card style={{ padding: 16, marginBottom: 18, borderLeft: "4px solid var(--teal)" }}>
                  <div className="flex items-center gap-2" style={{ fontSize: 13, color: "var(--navy)" }}>
                    <History size={15} color="var(--teal)" />
                    You've answered a similar question before — last time you scored <strong>&nbsp;{memMatch.score}/100&nbsp;</strong>. Let's see how you've improved.
                  </div>
                </Card>
              )}
              <Pill color="var(--violet)" bg="#F1E9FE">{(interview.currentQuestion?.category || "").replace(/_/g, " ")}</Pill>
              <div style={{ fontSize: 25, fontWeight: 700, lineHeight: 1.4, color: "var(--navy)", margin: "18px 0 28px" }}>{interview.currentQuestion?.text}</div>
              <textarea value={answerInput} onChange={(e) => setAnswerInput(e.target.value)} placeholder="Type your answer..."
                style={{ width: "100%", height: 200, padding: 16, border: "1.5px solid var(--border)", borderRadius: "var(--radius)", fontSize: 15, lineHeight: 1.55, fontFamily: "var(--font)" }} />
              {error && <div style={{ color: "var(--bad)", fontSize: 13, marginTop: 10 }}>{error}</div>}
              <div className="flex justify-between items-center mt-4">
                <div className="flex items-center gap-3">
                  <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{answerInput.trim().split(/\s+/).filter(Boolean).length} words</span>
                  <span style={{ fontSize: 12, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 4 }}><Mic size={12} /> Voice — coming soon</span>
                </div>
                <Btn variant="accent" onClick={() => guarded(submitAnswer)} disabled={!answerInput.trim()}>Submit answer <ChevronRight size={16} /></Btn>
              </div>
              <div ref={bottomRef} />
            </div>
          </div>
        );
      })()}

      {screen === "evaluating" && <LoadingScreen messages={["Reading your answer...", "Checking for specifics and evidence...", "Deciding what to ask next..."]} />}
      {screen === "reporting" && <LoadingScreen messages={["Scoring your responses...", "Comparing against role competencies...", "Writing your feedback...", "Finalising your report..."]} />}

      {/* ---------------- PHASE 4B: ASYNC (INDEPENDENT/BATCH) INTERVIEW ---------------- */}
      {/* Deliberately NOT styled like the adaptive chat-style "interview" screen above —
          this simulates a one-way video interview: question -> prep timer -> answer timer ->
          submit -> next independent question. There is no "Tell me more" / "Why?" / "Based
          on your previous answer..." anywhere here, because there is nothing dynamic to
          generate — the entire question set was generated and persisted before this screen
          ever rendered (Phase 4B §5). */}
      {screen === "async_interview" && interview && interview.config?.pipeline === "independent_batch" && (() => {
        const q = interview.questions[interview.currentIndex];
        const qNum = interview.currentIndex + 1;
        const total = interview.questions.length;
        if (!q) return null;
        return (
          <div className="jr-fade" style={{ minHeight: "100vh", background: "var(--navy)" }}>
            <div style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
              <div style={{ maxWidth: 680, margin: "0 auto", padding: "16px 24px" }}>
                <div className="flex justify-between items-center mb-3">
                  <JobReadyLogo size={20} background="dark" />
                  <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{company} · {role} — {interview.formatLabel}</div>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>Question {qNum} of {total}</span>
                  {asyncSecondsLeft !== null && (
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", display: "flex", alignItems: "center", gap: 4, fontWeight: 700 }}>
                      <Clock size={13} /> {Math.floor(Math.max(0, asyncSecondsLeft) / 60)}:{String(Math.max(0, asyncSecondsLeft) % 60).padStart(2, "0")} {asyncPhase === "prep" ? "to prepare" : "remaining"}
                    </span>
                  )}
                </div>
                <div style={{ height: 4, background: "rgba(255,255,255,0.15)", borderRadius: 999 }}>
                  <div className="jr-bar" style={{ height: 4, borderRadius: 999, background: "var(--blue)", width: Math.min(100, (qNum / total) * 100) + "%" }} />
                </div>
              </div>
            </div>

            <div style={{ maxWidth: 680, margin: "0 auto", padding: "56px 24px", color: "#fff" }}>
              <Pill color="var(--violet)" bg="rgba(241,233,254,0.18)">{(q.category || "").replace(/_/g, " ")}</Pill>
              <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.4, margin: "18px 0 30px" }}>{q.text}</div>

              {asyncPhase === "prep" ? (
                <Card hover={false} style={{ padding: 28, textAlign: "center", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)" }}>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 10, textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>Preparation time</div>
                  <div style={{ fontSize: 44, fontWeight: 800 }}>{asyncSecondsLeft ?? 0}s</div>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", marginTop: 10 }}>Read the question. Your answer timer starts automatically once prep ends.</div>
                  <div style={{ marginTop: 18 }}>
                    <Btn variant="secondary" onClick={() => guarded(async () => {
                      const answerSecs = Number.isFinite(q.answerSeconds) && q.answerSeconds > 0 ? q.answerSeconds : null;
                      setAsyncPhase("answering"); setAsyncSecondsLeft(answerSecs);
                    })}>Start answering now</Btn>
                  </div>
                </Card>
              ) : (
                <>
                  <textarea value={answerInput} onChange={(e) => setAnswerInput(e.target.value)} placeholder="Type your answer..."
                    style={{ width: "100%", height: 220, padding: 16, border: "1.5px solid rgba(255,255,255,0.22)", borderRadius: "var(--radius)", fontSize: 15, lineHeight: 1.55, fontFamily: "var(--font)", background: "rgba(255,255,255,0.07)", color: "#fff" }} />
                  {error && <div style={{ color: "#FF9B9B", fontSize: 13, marginTop: 10 }}>{error}</div>}
                  <div className="flex justify-between items-center mt-4">
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{answerInput.trim().split(/\s+/).filter(Boolean).length} words</span>
                    <Btn variant="accent" onClick={() => guarded(() => submitAsyncAnswer(false))}>
                      {qNum >= total ? "Submit final answer" : "Submit & continue"} <ChevronRight size={16} />
                    </Btn>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {screen === "async_evaluating" && <LoadingScreen messages={["Reviewing your answers as a whole...", "Weighing motivation, competency and communication...", "Checking technical answers where relevant...", "Finalising your report..."]} />}

      {/* ---------------- REPORT ---------------- */}
      {screen === "report" && report && (
        <div className="jr-fade" style={{ maxWidth: 720, margin: "0 auto", padding: "44px 24px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--blue)", textTransform: "uppercase", marginBottom: 6 }}>Interview complete</div>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--navy)", marginBottom: 24 }}>{role} <span style={{ color: "var(--text-faint)", fontWeight: 600 }}>· {company}</span></h2>

          <Card style={{ padding: 26, marginBottom: 20 }}>
            <div className="flex items-center gap-8">
              <RingScore value={report.overall_score} size={128} label="/ 100" />
              <div>
                <Pill color={report.readiness === "strong" || report.readiness === "interview_ready" ? "var(--good)" : "var(--warn)"} bg={report.readiness === "strong" || report.readiness === "interview_ready" ? "#E7F8F1" : "#FEF3E2"}>
                  {(report.readiness || "").replace(/_/g, " ")}
                </Pill>
                <div style={{ fontSize: 13.5, color: "var(--text-dim)", marginTop: 12, lineHeight: 1.5, maxWidth: 340 }}>{report.next_practice_focus}</div>
              </div>
            </div>
          </Card>

          {report.memory_comparisons?.length > 0 && (
            <Card style={{ padding: 20, marginBottom: 20, borderLeft: "4px solid var(--teal)" }}>
              <div className="flex items-center gap-2 mb-3"><History size={16} color="var(--teal)" /><div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--navy)" }}>Interview Memory</div></div>
              {report.memory_comparisons.map((c, i) => {
                const delta = (c.current_score ?? 0) - (c.previous_score ?? 0);
                return (
                  <div key={i} style={{ padding: "10px 0", borderBottom: i < report.memory_comparisons.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <div style={{ fontSize: 13, color: "var(--text-dim)", fontStyle: "italic", marginBottom: 4 }}>"{c.question}"</div>
                    <div className="flex items-center gap-2" style={{ fontSize: 13.5 }}>
                      <span style={{ color: "var(--text-faint)" }}>Previous: {c.previous_score}</span>
                      <ArrowRight size={12} color="var(--text-faint)" />
                      <span style={{ fontWeight: 700, color: "var(--navy)" }}>Current: {c.current_score}</span>
                      <span style={{ fontWeight: 700, color: delta >= 0 ? "var(--good)" : "var(--bad)" }}>{delta >= 0 ? "+" : ""}{delta} {delta >= 15 ? "— significant improvement" : ""}</span>
                    </div>
                  </div>
                );
              })}
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            {Object.entries(report.breakdown || {}).map(([k, v]) => (
              <Card key={k} style={{ padding: 16 }}>
                <div style={{ fontSize: 11, color: "var(--text-faint)", textTransform: "capitalize", marginBottom: 6 }}>{k.replace(/_/g, " ")}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)" }}>{v}</div>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <Card style={{ padding: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--good)", marginBottom: 10, textTransform: "uppercase" }}>What you did well</div>
              {(report.strongest_areas || []).map((s, i) => <div key={i} className="flex gap-2 mb-2" style={{ fontSize: 13.5 }}><CheckCircle2 size={14} color="var(--good)" style={{ flexShrink: 0, marginTop: 2 }} />{s}</div>)}
            </Card>
            <Card style={{ padding: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--bad)", marginBottom: 10, textTransform: "uppercase" }}>What held you back</div>
              {(report.weakest_areas || []).map((s, i) => <div key={i} className="flex gap-2 mb-2" style={{ fontSize: 13.5 }}><TrendingDown size={14} color="var(--bad)" style={{ flexShrink: 0, marginTop: 2 }} />{s}</div>)}
            </Card>
          </div>

          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--navy)", margin: "8px 0 12px" }}>Question-by-question feedback</div>
          {(report.per_question_feedback || []).map((f, i) => (
            <Card key={i} style={{ padding: 20, marginBottom: 12 }}>
              <div style={{ fontSize: 14, color: "var(--navy)", marginBottom: 10, fontStyle: "italic" }}>"{f.question}"</div>
              {f.did_well?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--good)", textTransform: "uppercase" }}>What you did well</div>
                  {f.did_well.map((d, j) => <div key={j} style={{ fontSize: 13, marginTop: 2, color: "var(--text-dim)" }}>· {d}</div>)}
                </div>
              )}
              {f.weakened_it?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--bad)", textTransform: "uppercase" }}>What weakened it</div>
                  {f.weakened_it.map((d, j) => <div key={j} style={{ fontSize: 13, marginTop: 2, color: "var(--text-dim)" }}>· {d}</div>)}
                </div>
              )}
              {f.how_to_improve && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--blue)", textTransform: "uppercase" }}>How to improve</div>
                  <div style={{ fontSize: 13, marginTop: 2, color: "var(--text-dim)" }}>{f.how_to_improve}</div>
                </div>
              )}
              {f.note_on_missing_data && <div style={{ fontSize: 11.5, color: "var(--text-faint)", fontStyle: "italic", marginTop: 6 }}>{f.note_on_missing_data}</div>}
            </Card>
          ))}

          {report.classroom_topics?.length > 0 && (
            <Card style={{ padding: 20, marginBottom: 20, borderLeft: "4px solid var(--violet)" }}>
              <div className="flex items-center gap-3 mb-2"><GraduationCap size={17} color="var(--violet)" /><div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--navy)" }}>Added to your Classroom</div></div>
              <div style={{ fontSize: 13.5, color: "var(--text-dim)", marginBottom: 12 }}>{report.classroom_topics.map((t) => t.topic).join(", ")}</div>
              <Btn variant="secondary" onClick={() => setScreen("classroom")}>Open Classroom <ArrowRight size={15} /></Btn>
            </Card>
          )}

          <div className="flex flex-wrap gap-3 mt-6">
            <Btn variant="accent" onClick={() => setScreen("classroom")}><GraduationCap size={16} /> Study in Classroom</Btn>
            <Btn variant="secondary" onClick={resetForNewInterview}>New interview</Btn>
            <Btn variant="ghost" onClick={() => setScreen("progress")}><BarChart3 size={14} /> Progress</Btn>
          </div>
        </div>
      )}

      {/* ---------------- PROGRESS (+ Interview DNA + Interview Memory) ---------------- */}
      {screen === "progress" && (
        <div className="jr-fade" style={{ maxWidth: 760, margin: "0 auto", padding: "44px 24px" }}>
          <Btn variant="ghost" onClick={() => setScreen("dashboard")} style={{ marginBottom: 16, padding: "6px 4px" }}><ArrowLeft size={14} /> Dashboard</Btn>
          <h2 style={{ fontSize: 25, fontWeight: 800, color: "var(--navy)", marginBottom: 6 }}>Your progress</h2>
          <p style={{ fontSize: 14, color: "var(--text-dim)", marginBottom: 24 }}>How JOB.READY sees you across every interview so far.</p>

          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={16} color="var(--violet)" />
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--navy)" }}>Your Interview DNA</div>
          </div>
          {compKeys.length === 0 ? (
            <Card style={{ padding: 24, marginBottom: 24, textAlign: "center", color: "var(--text-faint)", fontSize: 13.5 }}>Complete an interview to start building your Interview DNA.</Card>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <Card style={{ padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--good)", marginBottom: 10, textTransform: "uppercase" }}>Strengths</div>
                  {dnaStrengths.map((c) => (
                    <div key={c.key} className="flex items-center justify-between mb-2" style={{ fontSize: 13.5 }}>
                      <span className="flex items-center gap-2" style={{ color: "var(--navy)", textTransform: "capitalize" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--good)", display: "inline-block" }} />{c.key.replace(/_/g, " ")}</span>
                      <span style={{ fontWeight: 700 }}>{c.value}</span>
                    </div>
                  ))}
                </Card>
                <Card style={{ padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--bad)", marginBottom: 10, textTransform: "uppercase" }}>Weaknesses</div>
                  {dnaWeaknesses.map((c) => (
                    <div key={c.key} className="flex items-center justify-between mb-2" style={{ fontSize: 13.5 }}>
                      <span className="flex items-center gap-2" style={{ color: "var(--navy)", textTransform: "capitalize" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--bad)", display: "inline-block" }} />{c.key.replace(/_/g, " ")}</span>
                      <span style={{ fontWeight: 700 }}>{c.value}</span>
                    </div>
                  ))}
                </Card>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {dnaBiggestImprovement && (
                  <Card style={{ padding: 18 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 6 }}>Biggest improvement</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", textTransform: "capitalize", marginBottom: 4 }}>{dnaBiggestImprovement.key.replace(/_/g, " ")}</div>
                    <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{dnaBiggestImprovement.history.join(" → ")}</div>
                  </Card>
                )}
                {dnaPriority && (
                  <Card style={{ padding: 18 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 6 }}>Current priority</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", textTransform: "capitalize" }}>{dnaPriority.key.replace(/_/g, " ")}</div>
                  </Card>
                )}
              </div>
              {perf?.style_notes?.length > 0 && (
                <Card style={{ padding: 18, marginBottom: 24 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 10 }}>Interview style</div>
                  {perf.style_notes.map((s, i) => <div key={i} style={{ fontSize: 13.5, color: "var(--text-dim)", marginBottom: 6 }}>· {s}</div>)}
                </Card>
              )}
            </>
          )}

          <Card style={{ padding: 22, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-faint)", marginBottom: 14, textTransform: "uppercase" }}>Score over time</div>
            {interviewList.length === 0 ? (
              <div style={{ color: "var(--text-faint)", fontSize: 14, textAlign: "center", padding: 24 }}>No interviews yet.</div>
            ) : (
              <div className="flex items-end gap-3" style={{ height: 150 }}>
                {interviewList.map((iv, i) => (
                  <div key={iv.id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--navy)", marginBottom: 6 }}>{iv.overall_score}</div>
                    <div className="jr-bar" style={{ width: "65%", height: (iv.overall_score / 100) * 110, background: i === interviewList.length - 1 ? "var(--blue)" : "var(--highlight)", borderRadius: "6px 6px 0 0" }} />
                    <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>#{i + 1}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {memoryLog.length > 0 && (
            <Card style={{ padding: 22, marginBottom: 20 }}>
              <div className="flex items-center gap-2 mb-4"><History size={15} color="var(--teal)" /><div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase" }}>Interview Memory — recent re-attempts</div></div>
              {memoryLog.slice(0, 5).map((c, i) => {
                const delta = (c.current_score ?? 0) - (c.previous_score ?? 0);
                return (
                  <div key={i} style={{ padding: "8px 0", borderBottom: i < 4 && i < memoryLog.length - 1 ? "1px solid var(--border)" : "none", fontSize: 13.5 }}>
                    <span style={{ color: "var(--text-dim)" }}>{c.previous_score} → </span>
                    <span style={{ fontWeight: 700, color: "var(--navy)" }}>{c.current_score}</span>
                    <span style={{ fontWeight: 700, color: delta >= 0 ? "var(--good)" : "var(--bad)", marginLeft: 8 }}>{delta >= 0 ? "+" : ""}{delta}</span>
                    <span style={{ color: "var(--text-faint)", marginLeft: 8 }}>{c.company} — {c.role}</span>
                  </div>
                );
              })}
            </Card>
          )}

          {acAttempts.length > 0 && (
            <Card style={{ padding: 22, marginBottom: 20 }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2"><Briefcase size={15} color="var(--teal)" /><div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase" }}>Assessment Centre readiness</div></div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--navy)" }}>{acReadiness}%</div>
              </div>
              {EXERCISE_TYPES.map((t) => {
                const attempts = acAttempts.filter((a) => a.type === t.key);
                if (!attempts.length) return null;
                const avg = Math.round(attempts.reduce((s, a) => s + a.overall_score, 0) / attempts.length);
                return <ScoreBar key={t.key} label={t.label} value={avg} />;
              })}
              <Btn variant="secondary" onClick={() => setScreen("ac_home")} style={{ marginTop: 8 }}>Open Assessment Centre <ArrowRight size={15} /></Btn>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card style={{ padding: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--good)", marginBottom: 8, textTransform: "uppercase" }}>Current strengths</div>
              {(perf?.strengths || []).length === 0 ? <div style={{ fontSize: 13, color: "var(--text-faint)" }}>—</div> : perf.strengths.map((s, i) => <div key={i} style={{ fontSize: 13.5, marginBottom: 6, color: "var(--text-dim)" }}>· {s}</div>)}
            </Card>
            <Card style={{ padding: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--bad)", marginBottom: 8, textTransform: "uppercase" }}>Current focus</div>
              {(perf?.weaknesses || []).length === 0 ? <div style={{ fontSize: 13, color: "var(--text-faint)" }}>—</div> : perf.weaknesses.map((s, i) => <div key={i} style={{ fontSize: 13.5, marginBottom: 6, color: "var(--text-dim)" }}>· {s}</div>)}
            </Card>
          </div>
          {perf?.weaknesses?.length > 0 && <Btn variant="accent" onClick={() => startCreateFlow(true)} style={{ marginTop: 20 }}>Practise weaknesses <ArrowRight size={15} /></Btn>}
        </div>
      )}

      {/* ---------------- CLASSROOM DASHBOARD ---------------- */}
      {screen === "classroom" && (
        <div className="jr-fade" style={{ maxWidth: 760, margin: "0 auto", padding: "44px 24px" }}>
          <div className="flex items-center gap-3 mb-2">
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "#F1E9FE", display: "flex", alignItems: "center", justifyContent: "center" }}><GraduationCap size={18} color="var(--violet)" /></div>
            <h2 style={{ fontSize: 25, fontWeight: 800, color: "var(--navy)" }}>Classroom</h2>
          </div>
          <p style={{ fontSize: 14, color: "var(--text-dim)", marginBottom: 28 }}>Every lesson here comes from a real weakness spotted in one of your interviews or assessment-centre exercises. Study it, then retest.</p>

          {classroom.length === 0 ? (
            <Card style={{ padding: 40, textAlign: "center" }}>
              <BookOpen size={28} color="var(--text-faint)" style={{ margin: "0 auto 14px" }} />
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--navy)", marginBottom: 6 }}>Nothing here yet</div>
              <div style={{ fontSize: 13.5, color: "var(--text-dim)", marginBottom: 18 }}>Complete an interview and any real weaknesses we find will show up here as lessons.</div>
              <Btn variant="accent" onClick={() => startCreateFlow(false)}><Sparkles size={15} /> Start an interview</Btn>
            </Card>
          ) : (
            <>
              <Card style={{ padding: 18, marginBottom: 22 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 12 }}>My interviews</div>
                {Object.entries(classroom.reduce((acc, t) => { const key = t.company + " — " + t.role; acc[key] = acc[key] || []; acc[key].push(t); return acc; }, {})).map(([key, topics]) => (
                  <div key={key} className="flex items-center justify-between" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontSize: 13.5, color: "var(--navy)", fontWeight: 500 }}>{key}</span>
                    <div className="flex items-center gap-2">
                      {topics.map((t) => <span key={t.id} title={t.topic + " — " + statusFor(t.scores).label} style={{ width: 9, height: 9, borderRadius: "50%", background: statusFor(t.scores).color, display: "inline-block" }} />)}
                    </div>
                  </div>
                ))}
              </Card>

              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--navy)", marginBottom: 12 }}>Your learning areas</div>
              {[...classroom].sort((a, b) => a.scores[a.scores.length - 1] - b.scores[b.scores.length - 1]).map((t) => {
                const st = statusFor(t.scores);
                return (
                  <Card key={t.id} style={{ padding: 20, marginBottom: 14 }}>
                    <div className="flex justify-between items-start mb-2">
                      <Pill color="var(--blue)" bg="var(--highlight)">{t.company} — {t.role}</Pill>
                      <Pill color={st.color} bg={st.bg}>{st.label}</Pill>
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: "var(--navy)", margin: "8px 0 4px" }}>{t.topic}</div>
                    <div style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 12 }}>{t.description}</div>
                    <div className="flex items-center justify-between">
                      <div style={{ fontSize: 12.5, color: "var(--text-faint)", fontWeight: 600 }}>{t.scores.join(" → ")}</div>
                      <Btn variant={st.label === "Mastered" ? "secondary" : "accent"} onClick={() => guarded(() => openLesson(t))}><BookOpen size={14} /> {st.label === "Needs work" ? "Start lesson" : "Continue lesson"}</Btn>
                    </div>
                  </Card>
                );
              })}
            </>
          )}
        </div>
      )}

      {screen === "classroom_generating" && <LoadingScreen messages={["Reviewing what went wrong...", "Checking the facts you'll need...", "Building your lesson...", "Writing a quick check..."]} />}

      {/* ---------------- LESSON ---------------- */}
      {screen === "lesson" && lesson && classroomTopic && (
        <div className="jr-fade" style={{ maxWidth: 680, margin: "0 auto", padding: "44px 24px" }}>
          <Btn variant="ghost" onClick={() => setScreen("classroom")} style={{ marginBottom: 16, padding: "6px 4px" }}><ArrowLeft size={14} /> Classroom</Btn>
          <Pill color="var(--violet)" bg="#F1E9FE">{classroomTopic.company} — {classroomTopic.role}</Pill>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--navy)", margin: "14px 0 20px" }}>{lesson.title}</h2>

          <Card style={{ padding: 22, marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--blue)", textTransform: "uppercase", marginBottom: 8 }}>Why this matters</div>
            <div style={{ fontSize: 14.5, color: "var(--text-dim)", lineHeight: 1.6 }}>{lesson.why_it_matters}</div>
          </Card>

          <Card style={{ padding: 22, marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 12 }}>Core knowledge</div>
            {(lesson.core_knowledge || []).map((k, i) => (
              <div key={i} className="flex gap-2 mb-3" style={{ alignItems: "flex-start" }}>
                {k.grounded ? <Globe size={14} color="var(--good)" style={{ flexShrink: 0, marginTop: 3 }} /> : <HelpCircle size={14} color="var(--text-faint)" style={{ flexShrink: 0, marginTop: 3 }} />}
                <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.55 }}>
                  {k.point}
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: k.grounded ? "var(--good)" : "var(--text-faint)", marginLeft: 8 }}>{k.grounded ? "VERIFIED" : "GENERAL GUIDANCE"}</span>
                </div>
              </div>
            ))}
            {lesson.grounding_note && <div style={{ fontSize: 12, color: "var(--text-faint)", fontStyle: "italic", marginTop: 8, lineHeight: 1.5 }}>{lesson.grounding_note}</div>}
          </Card>

          {lesson.key_points?.length > 0 && (
            <Card style={{ padding: 22, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 12 }}>Key points</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {lesson.key_points.map((k, i) => <div key={i} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 12, fontSize: 13.5, color: "var(--navy)", fontWeight: 500 }}>{k}</div>)}
              </div>
            </Card>
          )}

          {lesson.example_answer_snippet && (
            <Card style={{ padding: 22, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 10 }}>Example</div>
              <div style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.6, fontStyle: "italic", borderLeft: "3px solid var(--border)", paddingLeft: 14 }}>"{lesson.example_answer_snippet}"</div>
            </Card>
          )}

          {lesson.interview_application && (
            <Card style={{ padding: 22, marginBottom: 16, borderLeft: "4px solid var(--blue)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--blue)", textTransform: "uppercase", marginBottom: 8 }}>Interview application</div>
              <div style={{ fontSize: 14.5, color: "var(--navy)", lineHeight: 1.6 }}>{lesson.interview_application}</div>
            </Card>
          )}

          {lesson.quick_check?.length > 0 && (
            <Card style={{ padding: 22, marginBottom: 20 }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase" }}>Quick check</div>
                {Object.keys(quizAnswers).length === lesson.quick_check.length && (
                  <Pill color="var(--good)" bg="#E7F8F1">{lesson.quick_check.filter((q, i) => quizAnswers[i] === q.correct_index).length}/{lesson.quick_check.length} saved</Pill>
                )}
              </div>
              {lesson.quick_check.map((q, qi) => {
                const chosen = quizAnswers[qi];
                return (
                  <div key={qi} style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--navy)", marginBottom: 10 }}>{qi + 1}. {q.question}</div>
                    <div className="flex flex-col gap-2">
                      {q.options.map((opt, oi) => {
                        const isChosen = chosen === oi, isCorrect = oi === q.correct_index;
                        let borderColor = "var(--border)", bg = "#fff", textColor = "var(--text)";
                        if (chosen !== undefined) {
                          if (isCorrect) { borderColor = "var(--good)"; bg = "#E7F8F1"; textColor = "var(--good)"; }
                          else if (isChosen) { borderColor = "var(--bad)"; bg = "#FEF2F2"; textColor = "var(--bad)"; }
                        }
                        return (
                          <button key={oi} disabled={chosen !== undefined} onClick={() => guarded(() => recordQuizAnswer(qi, oi))}
                            style={{ textAlign: "left", padding: "10px 14px", borderRadius: "var(--radius-sm)", border: "1.5px solid " + borderColor, background: bg, color: textColor, fontSize: 13.5, cursor: chosen !== undefined ? "default" : "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                            {chosen !== undefined && isCorrect && <CheckCircle2 size={14} />}
                            {chosen !== undefined && isChosen && !isCorrect && <XCircle size={14} />}
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                    {chosen !== undefined && q.explanation && <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.5 }}>{q.explanation}</div>}
                  </div>
                );
              })}
            </Card>
          )}

          <Card style={{ padding: 24, textAlign: "center", background: "var(--navy)" }} hover={false}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 6 }}>Ready to test yourself?</div>
            <div style={{ fontSize: 13.5, color: "#94A3B8", marginBottom: 16 }}>We'll build a short interview that weights heavily toward this exact weakness.</div>
            <Btn variant="accent" onClick={() => practiseThisWeakness(classroomTopic)}>Practise this weakness <ArrowRight size={15} /></Btn>
          </Card>
        </div>
      )}

      {/* ---------------- ASSESSMENT CENTRE ---------------- */}
      {screen === "ac_home" && (
        <div className="jr-fade" style={{ maxWidth: 760, margin: "0 auto", padding: "44px 24px" }}>
          <div className="flex items-center gap-3 mb-2">
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "#E6FBF6", display: "flex", alignItems: "center", justifyContent: "center" }}><Briefcase size={18} color="var(--teal)" /></div>
            <h2 style={{ fontSize: 25, fontWeight: 800, color: "var(--navy)" }}>Assessment Centre</h2>
          </div>
          <p style={{ fontSize: 14, color: "var(--text-dim)", marginBottom: 24 }}>Practise the exercises that come after the interview — group exercises, case studies, presentations, written tasks and inbox triage.</p>

          {acAttempts.length > 0 && (
            <Card style={{ padding: 20, marginBottom: 22 }}>
              <div className="flex items-center justify-between mb-3">
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase" }}>Assessment Centre readiness</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)" }}>{acReadiness}%</div>
              </div>
              {EXERCISE_TYPES.map((t) => {
                const attempts = acAttempts.filter((a) => a.type === t.key);
                if (!attempts.length) return null;
                const avg = Math.round(attempts.reduce((s, a) => s + a.overall_score, 0) / attempts.length);
                return <ScoreBar key={t.key} label={t.label} value={avg} />;
              })}
            </Card>
          )}

          <Card style={{ padding: 22, marginBottom: 22 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", marginBottom: 10 }}>Company & role for this exercise</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input value={acCompany} onChange={(e) => setAcCompany(e.target.value)} placeholder="Company" style={inputStyle} />
              <input value={acRole} onChange={(e) => setAcRole(e.target.value)} placeholder="Role" style={inputStyle} />
            </div>
            {interviewList.length > 0 && (
              <button onClick={() => { const last = interviewList[interviewList.length - 1]; setAcCompany(last.company); setAcRole(last.role); }}
                style={{ fontSize: 12, color: "var(--blue)", background: "none", border: "none", cursor: "pointer", marginTop: 10, fontWeight: 600 }}>
                Use {interviewList[interviewList.length - 1].company} — {interviewList[interviewList.length - 1].role}
              </button>
            )}
          </Card>

          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--navy)", marginBottom: 12 }}>Choose an exercise</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {EXERCISE_TYPES.map((t) => {
              const Icon = t.icon;
              const enabled = acCompany.trim() && acRole.trim();
              return (
                <Card key={t.key} onClick={() => enabled && guarded(() => startAssessmentCentre(t.key))} style={{ padding: 20, cursor: enabled ? "pointer" : "not-allowed", opacity: enabled ? 1 : 0.55 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--highlight)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                    <Icon size={16} color="var(--blue)" />
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--navy)", marginBottom: 4 }}>{t.label}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.4 }}>{t.blurb}</div>
                </Card>
              );
            })}
          </div>
          {(!acCompany.trim() || !acRole.trim()) && <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 12 }}>Enter a company and role above to unlock an exercise.</div>}
          {error && <div style={{ color: "var(--bad)", fontSize: 13, marginTop: 14 }}>{error}</div>}
        </div>
      )}

      {screen === "ac_generating" && <LoadingScreen messages={["Reading the role...", "Building a realistic scenario...", "Calibrating the difficulty..."]} />}

      {screen === "ac_exercise" && acScenario && (
        <div className="jr-fade" style={{ maxWidth: 700, margin: "0 auto", padding: "44px 24px" }}>
          <Btn variant="ghost" onClick={() => setScreen("ac_home")} style={{ marginBottom: 16, padding: "6px 4px" }}><ArrowLeft size={14} /> Assessment Centre</Btn>
          <Pill color="var(--teal)" bg="#E6FBF6">{EXERCISE_TYPES.find((t) => t.key === acType)?.label} · {acCompany} — {acRole}</Pill>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--navy)", margin: "14px 0 12px" }}>{acScenario.title}</h2>
          <Card style={{ padding: 22, marginBottom: 16 }}>
            <div style={{ fontSize: 14.5, color: "var(--text-dim)", lineHeight: 1.6, marginBottom: 14 }}>{acScenario.brief}</div>
            {acScenario.objective && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--blue)", textTransform: "uppercase", marginBottom: 4 }}>Objective</div>
                <div style={{ fontSize: 14, color: "var(--navy)" }}>{acScenario.objective}</div>
              </div>
            )}
            {acScenario.materials?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 8 }}>Materials</div>
                {acScenario.materials.map((m, i) => (
                  <div key={i} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, fontSize: 13, color: "var(--navy)", marginBottom: 6 }}>{m}</div>
                ))}
              </div>
            )}
            {acScenario.suggested_time_minutes && (
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
                Suggested time: {acScenario.suggested_time_minutes} minutes (untimed here — take what you need)
              </div>
            )}
          </Card>

          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", marginBottom: 8 }}>
            {acType === "inbox" ? "Write your priority order and your reasoning for it." : acType === "group" ? "Write your key contributions, as if speaking in the group, in the order you'd raise them." : "Your response"}
          </div>
          <textarea value={acSubmission} onChange={(e) => setAcSubmission(e.target.value)} placeholder="Type your response..."
            style={{ width: "100%", height: 220, padding: 16, border: "1.5px solid var(--border)", borderRadius: "var(--radius)", fontSize: 15, lineHeight: 1.55, fontFamily: "var(--font)" }} />
          {error && <div style={{ color: "var(--bad)", fontSize: 13, marginTop: 10 }}>{error}</div>}
          <div className="flex justify-between items-center mt-4">
            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{acSubmission.trim().split(/\s+/).filter(Boolean).length} words</span>
            <Btn variant="accent" onClick={() => guarded(submitAcResponse)} disabled={!acSubmission.trim()}>Submit <ChevronRight size={16} /></Btn>
          </div>
        </div>
      )}

      {screen === "ac_evaluating" && <LoadingScreen messages={["Reading your submission...", "Scoring against the rubric...", "Writing your scorecard..."]} />}

      {screen === "ac_scorecard" && acResult && (
        <div className="jr-fade" style={{ maxWidth: 700, margin: "0 auto", padding: "44px 24px" }}>
          <Pill color="var(--teal)" bg="#E6FBF6">{EXERCISE_TYPES.find((t) => t.key === acType)?.label}</Pill>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--navy)", margin: "14px 0 20px" }}>{acCompany} — {acRole}</h2>
          <Card style={{ padding: 26, marginBottom: 20 }}>
            <div className="flex items-center gap-8">
              <RingScore value={acResult.overall_score} size={110} label="/ 100" />
              <div style={{ fontSize: 13.5, color: "var(--text-dim)", maxWidth: 340 }}>{acResult.held_back?.[0] || ""}</div>
            </div>
          </Card>
          <Card style={{ padding: 20, marginBottom: 20 }}>
            {Object.entries(acResult.breakdown || {}).map(([k, v]) => <ScoreBar key={k} label={k.replace(/_/g, " ")} value={v} />)}
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <Card style={{ padding: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--good)", marginBottom: 10, textTransform: "uppercase" }}>What you did well</div>
              {(acResult.did_well || []).map((s, i) => <div key={i} className="flex gap-2 mb-2" style={{ fontSize: 13.5 }}><CheckCircle2 size={14} color="var(--good)" style={{ flexShrink: 0, marginTop: 2 }} />{s}</div>)}
            </Card>
            <Card style={{ padding: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--bad)", marginBottom: 10, textTransform: "uppercase" }}>What held you back</div>
              {(acResult.held_back || []).map((s, i) => <div key={i} className="flex gap-2 mb-2" style={{ fontSize: 13.5 }}><TrendingDown size={14} color="var(--bad)" style={{ flexShrink: 0, marginTop: 2 }} />{s}</div>)}
            </Card>
          </div>
          {acResult.classroom_topics?.length > 0 && (
            <Card style={{ padding: 20, marginBottom: 20, borderLeft: "4px solid var(--violet)" }}>
              <div className="flex items-center gap-3 mb-2"><GraduationCap size={17} color="var(--violet)" /><div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--navy)" }}>Recommended Classroom lesson</div></div>
              <div style={{ fontSize: 13.5, color: "var(--text-dim)", marginBottom: 12 }}>{acResult.classroom_topics.map((t) => t.topic).join(", ")}</div>
              <Btn variant="secondary" onClick={() => setScreen("classroom")}>Learn this in Classroom <ArrowRight size={15} /></Btn>
            </Card>
          )}
          <div className="flex flex-wrap gap-3">
            <Btn variant="accent" onClick={() => guarded(() => startAssessmentCentre(acType))}>Practise again <ArrowRight size={15} /></Btn>
            <Btn variant="secondary" onClick={() => setScreen("ac_home")}>Back to Assessment Centre</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppRoot() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
