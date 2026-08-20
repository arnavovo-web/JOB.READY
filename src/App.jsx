import React, { useState, useEffect, useRef } from "react";
import mammoth from "mammoth";
import {
  ChevronRight, Loader2, TrendingDown, CheckCircle2, ArrowLeft, ArrowRight, Sparkles,
  Target, BarChart3, AlertCircle, Upload, Mic, Menu, X,
  GraduationCap, BookOpen, Globe, HelpCircle, XCircle,
  Users, Briefcase, Mail, FileText, History
} from "lucide-react";

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

// Storage keys must avoid whitespace/slashes/quotes and stay under 200 chars —
// build every key through here instead of raw string concatenation.
function skey(...parts) {
  const raw = parts.filter(Boolean).join(":");
  return sanitizeText(raw).replace(/[\s\/\\'"]+/g, "_").slice(0, 190);
}

async function callClaude(system, userText, maxTokens = 2000, useWebSearch = false) {
  const body = { model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: sanitizeText(userText) }] };
  if (useWebSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000);
  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (networkErr) {
    clearTimeout(timeoutId);
    if (networkErr && networkErr.name === "AbortError") throw new Error("That took too long to respond. Please try again.");
    throw new Error("Couldn't reach the AI service. Check your connection and try again.");
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    let detail = "";
    try { const errBody = await response.json(); detail = errBody?.error?.message || ""; } catch (e) { /* body wasn't JSON */ }
    if (detail) console.error("AI request failed (" + response.status + "):", detail); // logged for debugging, never shown raw to the user
    if (response.status === 429) throw new Error("We're getting a lot of requests right now. Please wait a moment and try again.");
    if (response.status >= 500) throw new Error("The AI service is temporarily unavailable. Please try again in a moment.");
    if (response.status === 401 || response.status === 403) throw new Error("This session isn't authorised to reach the AI service. Please refresh and try again.");
    throw new Error("Something went wrong on our end (error " + response.status + "). Please try again.");
  }

  const data = await response.json();
  const truncated = data.stop_reason === "max_tokens";
  const text = (data.content || []).map((b) => b.text || "").join("\n");
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
      question_mix: Object.keys(scoreMap(ip.question_mix)).length ? scoreMap(ip.question_mix) : { motivation_fit: 30, cv_behavioural: 25, role_specific: 20, technical: 15, commercial_awareness: 10 },
    },
    candidate_profile: {
      education: arr(cp.education).map((s) => str(s)), experience: arr(cp.experience).map((s) => str(s)),
      leadership: arr(cp.leadership).map((s) => str(s)), achievements: arr(cp.achievements).map((s) => str(s)),
      skills: arr(cp.skills).map((s) => str(s)), behavioural_examples: arr(cp.behavioural_examples).map((s) => str(s)),
      potential_probe_areas: arr(cp.potential_probe_areas).map((a) => ({ claim: str(a?.claim), why: str(a?.why) })).filter((a) => a.claim),
    },
    opening_question: {
      text: str(p.opening_question?.text, "Tell me about yourself and why you're interested in this role."),
      category: str(p.opening_question?.category, "motivation_fit"), competency: str(p.opening_question?.competency),
    },
  };
}
function validateNextTurn(n) {
  n = n || {};
  return {
    evaluation: validateEvaluation(n.evaluation),
    decision: str(n.decision, "follow_up"),
    next_question: { text: str(n.next_question?.text, "Can you tell me more about that?"), category: str(n.next_question?.category, "cv_behavioural"), competency: str(n.next_question?.competency) },
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

async function storeGet(key) {
  try { const r = await window.storage.get(key, false); return r ? JSON.parse(r.value) : null; }
  catch (e) { return null; }
}
async function storeSet(key, value) {
  try { await window.storage.set(key, JSON.stringify(value), false); return true; }
  catch (e) { console.error("storage set failed", e); return false; }
}

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

const EXERCISE_TYPES = [
  { key: "group", label: "Group Exercise", icon: Users, blurb: "Work through a scenario with simulated teammates and reach a group recommendation.", competencies: ["Communication", "Leadership", "Collaboration", "Commercial reasoning", "Contribution quality"] },
  { key: "case", label: "Case Study", icon: Briefcase, blurb: "Analyse a business problem and recommend a course of action.", competencies: ["Structure", "Reasoning", "Commercial awareness", "Conclusion quality"] },
  { key: "presentation", label: "Presentation", icon: Mic, blurb: "Prepare and write out a short recommendation as if presenting it.", competencies: ["Structure", "Clarity", "Persuasiveness", "Commercial reasoning"] },
  { key: "written", label: "Written Exercise", icon: FileText, blurb: "Produce a professional written output under time pressure.", competencies: ["Accuracy", "Structure", "Conciseness", "Professionalism", "Reasoning"] },
  { key: "inbox", label: "Inbox Exercise", icon: Mail, blurb: "Prioritise a stack of competing tasks and justify your order.", competencies: ["Prioritisation", "Judgement", "Risk awareness", "Communication"] },
];
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }

let pdfjsLoadPromise = null;
function loadPdfJs() {
  if (typeof window !== "undefined" && window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfjsLoadPromise) return pdfjsLoadPromise;
  pdfjsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js";
    script.onload = () => {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      } catch (e) { reject(e); }
    };
    script.onerror = () => reject(new Error("pdf-loader-failed"));
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
  const maxPages = Math.min(pdf.numPages || 1, 40);
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str || "").join(" ") + "\n\n";
  }
  return text;
}

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
  return new Set((s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 3 && !MEMORY_STOPWORDS.has(w)).map(memoryStem));
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

function JobReadyLogo({ variant = "full", background = "light", size = 28 }) {
  const dark = background === "dark";
  const monochrome = variant === "monochrome";
  const markBg = monochrome ? (dark ? "#FFFFFF" : "var(--navy)") : "linear-gradient(135deg, var(--blue), var(--violet))";
  const arrowColor = monochrome ? (dark ? "var(--navy)" : "#FFFFFF") : "#FFFFFF";
  const textColor = monochrome ? (dark ? "#FFFFFF" : "var(--navy)") : (dark ? "#FFFFFF" : "var(--navy)");
  const Mark = (<div style={{ width: size, height: size, borderRadius: size * 0.28, background: markBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none"><circle cx="5" cy="19" r="2.4" fill={arrowColor} opacity="0.55" /><path d="M6 18L18 6" stroke={arrowColor} strokeWidth="2.4" strokeLinecap="round" /><path d="M10 6H18V14" stroke={arrowColor} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></div>);
  if (variant === "mark") return Mark;
  return (<div style={{ display: "flex", alignItems: "center", gap: 9 }}>{Mark}<span style={{ fontFamily: "var(--font)", fontWeight: 800, fontSize: size * 0.62, color: textColor, letterSpacing: "-0.01em" }}>JOB<span style={{ color: monochrome ? textColor : "var(--blue)" }}>.</span>READY</span></div>);
}

function Btn({ children, onClick, disabled, variant = "primary", style, full }) {
  const base = { fontFamily: "var(--font)", fontSize: 14.5, fontWeight: 600, border: "none", cursor: disabled ? "not-allowed" : "pointer", padding: "12px 22px", borderRadius: "var(--radius-sm)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, width: full ? "100%" : "auto" };
  const variants = { primary: { background: disabled ? "#CBD5E1" : "var(--navy)", color: "#fff" }, accent: { background: disabled ? "#CBD5E1" : "var(--blue)", color: "#fff" }, secondary: { background: "#fff", color: "var(--navy)", border: "1.5px solid var(--border)" }, ghost: { background: "transparent", color: "var(--text-dim)" } };
  return <button className="jr-btn" onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}>{children}</button>;
}
function Card({ children, style, hover = true, onClick }) { return <div className={hover ? "jr-card" : ""} onClick={onClick} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-sm)", ...style }}>{children}</div>; }
function Pill({ children, color = "var(--blue)", bg = "var(--highlight)" }) { return <span style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 600, color, background: bg, padding: "4px 11px", borderRadius: 999, display: "inline-block" }}>{children}</span>; }
function ScoreBar({ label, value, max = 100, color }) { const pct = Math.max(0, Math.min(100, (value / max) * 100)); const c = color || (pct >= 75 ? "var(--good)" : pct >= 50 ? "var(--blue)" : "var(--warn)"); return (<div className="mb-3"><div className="flex justify-between items-baseline mb-1"><span style={{ fontSize: 13, color: "var(--text-dim)", textTransform: "capitalize" }}>{label}</span><span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{value}</span></div><div style={{ height: 7, background: "#EEF2F7", borderRadius: 999 }}><div className="jr-bar" style={{ height: 7, width: pct + "%", background: c, borderRadius: 999 }} /></div></div>); }
function RingScore({ value, size = 148, label }) { const stroke = 12; const r = (size - stroke) / 2; const c = 2 * Math.PI * r; const pct = Math.max(0, Math.min(100, value)); const color = pct >= 75 ? "var(--good)" : pct >= 50 ? "var(--blue)" : "var(--warn)"; return (<div style={{ position: "relative", width: size, height: size }}><svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}><circle cx={size / 2} cy={size / 2} r={r} stroke="#EEF2F7" strokeWidth={stroke} fill="none" /><circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)" }} /></svg><div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}><div style={{ fontSize: size * 0.24, fontWeight: 800, color: "var(--navy)", lineHeight: 1 }}>{value}</div>{label && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{label}</div>}</div></div>); }
function TagBasis({ basis }) { const map = { explicit: { label: "From JD", color: "var(--good)", bg: "#E7F8F1" }, inferred: { label: "Inferred", color: "var(--blue)", bg: "var(--highlight)" }, general: { label: "General for role", color: "var(--text-dim)", bg: "#F1F5F9" } }; const m = map[basis] || map.general; return <span style={{ fontSize: 11, fontWeight: 600, color: m.color, background: m.bg, padding: "2px 8px", borderRadius: 999, marginLeft: 8 }}>{m.label}</span>; }
function LoadingScreen({ messages }) { const [idx, setIdx] = useState(0); useEffect(() => { const t = setInterval(() => setIdx((i) => (i + 1) % messages.length), 1300); return () => clearInterval(t); }, [messages]); return (<div className="flex flex-col items-center justify-center" style={{ minHeight: 440 }}><div style={{ width: 52, height: 52, borderRadius: 16, background: "linear-gradient(135deg, var(--blue), var(--violet))", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 22 }}><Loader2 className="animate-spin" size={24} color="#fff" /></div><div className="jr-fade" key={idx} style={{ fontSize: 17, fontWeight: 600, color: "var(--navy)" }}>{messages[idx]}</div></div>); }

function NavBar({ screen, setScreen, user, classroomNeedsWorkCount }) {
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 768 : false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { function onResize() { setIsMobile(window.innerWidth < 768); } window.addEventListener("resize", onResize); return () => window.removeEventListener("resize", onResize); }, []);
  useEffect(() => { setMenuOpen(false); }, [screen]);
  const links = user ? [{ label: "Dashboard", to: "dashboard" }, { label: "Classroom", to: "classroom" }, { label: "Assessment Centre", to: "ac_home" }, { label: "Progress", to: "progress" }] : [{ label: "How it works", to: "how" }, { label: "For universities", to: "universities" }];
  return (<div style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(248,250,252,0.95)", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--border)" }}><div style={{ maxWidth: 1080, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}><div style={{ cursor: "pointer" }} onClick={() => setScreen(user ? "dashboard" : "landing")}><JobReadyLogo size={26} /></div>{!isMobile && (<div style={{ display: "flex", alignItems: "center", gap: 22 }}>{links.map((l) => (<span key={l.to} onClick={() => setScreen(l.to)} style={{ fontSize: 13.5, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: screen === l.to ? "var(--navy)" : "var(--text-dim)" }}>{l.label}{l.to === "classroom" && classroomNeedsWorkCount > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "var(--blue)", borderRadius: 999, padding: "1px 7px" }}>{classroomNeedsWorkCount}</span>}</span>))}{!user && <><span onClick={() => setScreen("login")} style={{ fontSize: 14, fontWeight: 500, color: "var(--text-dim)", cursor: "pointer" }}>Log in</span><Btn variant="accent" onClick={() => setScreen("login")}>Start practising</Btn></>}</div>)}{isMobile && (<button aria-label={menuOpen ? "Close menu" : "Open menu"} onClick={() => setMenuOpen((v) => !v)} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, display: "flex" }}>{menuOpen ? <X size={22} color="var(--navy)" /> : <Menu size={22} color="var(--navy)" />}</button>)}</div>{isMobile && menuOpen && (<div style={{ borderTop: "1px solid var(--border)", background: "#fff", padding: "4px 24px 16px" }}>{links.map((l) => (<div key={l.to} onClick={() => setScreen(l.to)} style={{ padding: "14px 0", fontSize: 15, fontWeight: 500, color: screen === l.to ? "var(--navy)" : "var(--text-dim)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>{l.label}{l.to === "classroom" && classroomNeedsWorkCount > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "var(--blue)", borderRadius: 999, padding: "1px 7px" }}>{classroomNeedsWorkCount}</span>}</div>))}{!user ? <div style={{ paddingTop: 14 }}><Btn variant="accent" full onClick={() => setScreen("login")}>Start practising</Btn></div> : <div onClick={() => setScreen("login")} style={{ padding: "14px 0", fontSize: 15, fontWeight: 500, color: "var(--text-dim)", cursor: "pointer" }}>Switch profile</div>}</div>)}</div>);
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err, info) { console.error("JOB.READY error boundary caught:", err, info); }
  render() { if (this.state.hasError) return (<div style={{ fontFamily: "var(--font)", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", background: "var(--bg)" }}><style>{TOKENS}</style><div style={{ width: 44, height: 44, borderRadius: 12, background: "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}><AlertCircle size={22} color="var(--bad)" /></div><div style={{ fontSize: 19, fontWeight: 800, color: "var(--navy)", marginBottom: 8 }}>Something went wrong.</div><div style={{ fontSize: 14, color: "var(--text-dim)", marginBottom: 22, maxWidth: 380 }}>This screen hit an unexpected error. Your saved data is untouched.</div><Btn variant="primary" onClick={() => this.setState({ hasError: false })}>Try again</Btn></div>); return this.props.children; }
}

function App() {
  const [screen, setScreen] = useState("landing");
  const [user, setUser] = useState(null);
  const [nameInput, setNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [error, setError] = useState("");
  const [wizardStep, setWizardStep] = useState(1);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [stage, setStage] = useState("First Round");
  const [itype, setItype] = useState("Mixed");
  const [length, setLength] = useState(12);
  const [jdText, setJdText] = useState("");
  const [cvText, setCvText] = useState("");
  const [focusWeaknesses, setFocusWeaknesses] = useState(false);
  const [fileBusy, setFileBusy] = useState(null);
  const [profile, setProfile] = useState(null);
  const [interview, setInterview] = useState(null);
  const [interviewList, setInterviewList] = useState([]);
  const [perf, setPerf] = useState(null);
  const [answerInput, setAnswerInput] = useState("");
  const [report, setReport] = useState(null);
  const bottomRef = useRef(null);
  const busyRef = useRef(false);
  async function guarded(fn) { if (busyRef.current) return; busyRef.current = true; try { await fn(); } finally { busyRef.current = false; } }
  const [classroom, setClassroom] = useState([]);
  const [classroomTopic, setClassroomTopic] = useState(null);
  const [lesson, setLesson] = useState(null);
  const [targetTopic, setTargetTopic] = useState(null);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [questionHistory, setQuestionHistory] = useState([]);
  const [memoryLog, setMemoryLog] = useState([]);
  const [acCompany, setAcCompany] = useState("");
  const [acRole, setAcRole] = useState("");
  const [acType, setAcType] = useState(null);
  const [acScenario, setAcScenario] = useState(null);
  const [acSubmission, setAcSubmission] = useState("");
  const [acResult, setAcResult] = useState(null);
  const [acAttempts, setAcAttempts] = useState([]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [interview?.transcript?.length]);
  useEffect(() => { window.scrollTo(0, 0); }, [screen]);

  async function handleLogin() {
    if (!nameInput.trim() || !emailInput.trim()) { setError("Enter your name and email."); return; }
    const cleanName = sanitizeText(nameInput.trim()); const cleanEmail = sanitizeText(emailInput.trim().toLowerCase()); const userKey = skey("user", cleanEmail);
    let existing = await storeGet(userKey);
    if (!existing) { existing = { name: cleanName, email: cleanEmail, createdAt: Date.now() }; await storeSet(userKey, existing); }
    setUser(existing); setInterviewList((await storeGet(skey("interviews", existing.email))) || []); setPerf((await storeGet(skey("perf", existing.email))) || { strengths: [], weaknesses: [], competency_history: {}, style_notes: [], common_issues: [] }); setClassroom((await storeGet(skey("classroom", existing.email))) || []); setQuestionHistory((await storeGet(skey("qhistory", existing.email))) || []); setMemoryLog((await storeGet(skey("memory", existing.email))) || []); setAcAttempts((await storeGet(skey("ac_attempts", existing.email))) || []); setScreen("dashboard");
  }

  async function handleFileUpload(e, which) {
    const file = e.target.files && e.target.files[0]; e.target.value = ""; if (!file) return; setError(""); const ext = (file.name.split(".").pop() || "").toLowerCase(); const MAX_SIZE = 8 * 1024 * 1024;
    if (file.size === 0) { setError("That file is empty. Please try another file or paste the text directly."); return; }
    if (file.size > MAX_SIZE) { setError("That file is too large (max 8MB). Please try a smaller file or paste the text directly."); return; }
    setFileBusy(which);
    try {
      let text = "";
      if (ext === "txt") text = await file.text();
      else if (ext === "docx") { const buf = await file.arrayBuffer(); const result = await mammoth.extractRawText({ arrayBuffer: buf }); text = result.value || ""; }
      else if (ext === "pdf") { const buf = await file.arrayBuffer(); text = await extractPdfText(buf); }
      else { setError("We couldn't process this file. Please upload a .txt, .docx or .pdf file, or paste the text directly."); return; }
      const clean = sanitizeText(text).trim(); if (!clean) { setError("We couldn't find any readable text in that file. Please try another file or paste the text directly."); return; }
      if (which === "jd") setJdText(clean); else setCvText(clean);
    } catch (err) { setError((err && err.message) || "We couldn't process this file. Please try another file or paste the text directly."); }
    finally { setFileBusy(null); }
  }

  function normalizeTopic(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function statusFor(scores) { const latest = scores[scores.length - 1]; if (latest >= 85) return { label: "Mastered", color: "var(--good)", bg: "#E7F8F1" }; if (latest >= 70) return { label: "Improving", color: "var(--blue)", bg: "var(--highlight)" }; if (latest >= 50) return { label: "Learning", color: "var(--warn)", bg: "#FEF3E2" }; return { label: "Needs work", color: "var(--bad)", bg: "#FEF2F2" }; }
  function candidateLevel() { if (!interviewList.length) return "beginner — this is their first interview"; const avg = interviewList.reduce((s, i) => s + (i.overall_score || 0), 0) / interviewList.length; if (avg >= 78) return "advanced — give sophisticated, practical, industry-context material"; if (avg >= 58) return "intermediate — solid fundamentals, ready for applied detail"; return "beginner — needs clear core concepts and simple definitions before nuance"; }

  async function pushClassroomTopics(topics, ctx) {
    if (!topics || !topics.length || !user) return; let list = [...classroom];
    for (const t of topics) { if (!t.topic) continue; const norm = normalizeTopic(t.topic); const existing = list.find((x) => { const xn = normalizeTopic(x.topic); return xn === norm || xn.includes(norm) || norm.includes(xn); }); if (existing) { existing.scores = [...existing.scores, t.initial_score || 0]; existing.lastInterviewId = ctx.id; existing.description = t.description || existing.description; existing.relatedQuestion = t.related_question || existing.relatedQuestion; } else list.push({ id: "top_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7), topic: t.topic, category: t.category || "general", description: t.description || "", company: ctx.company, role: ctx.role, scores: [t.initial_score || 0], lastInterviewId: ctx.id, relatedQuestion: t.related_question || "" }); }
    setClassroom(list); await storeSet(skey("classroom", user.email), list);
  }
  async function applyPerformanceUpdate({ weaknesses = [], strengths = [], breakdown = {}, styleNotes = [] }) {
    if (!user) return perf; const newCompHistory = { ...(perf?.competency_history || {}) }; Object.entries(breakdown || {}).forEach(([k, v]) => { if (typeof v !== "number") return; newCompHistory[k] = [...(newCompHistory[k] || []), v]; });
    const newPerf = { strengths: Array.from(new Set([...(strengths || []), ...(perf?.strengths || [])])).slice(0, 8), weaknesses: Array.from(new Set([...(weaknesses || []), ...(perf?.weaknesses || [])])).slice(0, 8), competency_history: newCompHistory, style_notes: Array.from(new Set([...(styleNotes || []), ...(perf?.style_notes || [])])).slice(0, 6), common_issues: perf?.common_issues || [] };
    setPerf(newPerf); await storeSet(skey("perf", user.email), newPerf); return newPerf;
  }
  async function openLesson(topic) {
    setClassroomTopic(topic); setQuizAnswers({}); setError(""); const savedQuiz = await storeGet(skey("quizresult", user.email, topic.id)); if (savedQuiz?.answers) setQuizAnswers(savedQuiz.answers); const cacheKey = skey("lesson", user.email, topic.id); const cached = await storeGet(cacheKey); if (cached) { setLesson(cached); setScreen("lesson"); return; }
    setScreen("classroom_generating");
    try {
      const wantsWeb = topic.category === "company_knowledge" || topic.category === "commercial_awareness";
      const system = `You are a specialist interview-preparation tutor. You generate one short, targeted lesson (5-10 minutes to complete) that teaches a candidate exactly what they need to know to fix ONE specific interview weakness. Return strict JSON only, no prose, no markdown fences, in this exact shape:\n{\n  "title": "", "why_it_matters": "",\n  "core_knowledge": [{"point": "", "grounded": true}],\n  "key_points": [""], "example_answer_snippet": "", "interview_application": "",\n  "quick_check": [{"question": "", "options": ["",""], "correct_index": 0, "explanation": ""}],\n  "grounding_note": ""\n}\nRules: mini study guide, not an essay. core_knowledge 3-5 points, key_points 3-5, quick_check 2-3 questions with 3-4 options each. "grounded" is true only for points you are confident are accurate and current; mark false for general guidance and never present an unverified company fact as confirmed. If you can't establish reliable specifics, say so in grounding_note and stay general. example_answer_snippet shows how to use the knowledge, not fabricated achievements. Match depth to the candidate's level given.`;
      const userText = `Weakness topic: ${topic.topic}\nCategory: ${topic.category}\nWeakness as identified: ${topic.description}\nCompany: ${topic.company}\nRole: ${topic.role}\nRelated interview question: ${topic.relatedQuestion || "n/a"}\nCandidate level: ${candidateLevel()}\n\n${wantsWeb ? "This likely requires real, current, company-specific or market information — use web search to verify facts before teaching them." : "General interview-technique or subject-matter topic; no need to search."}`;
      const result = validateLesson(await callClaude(system, userText, 2200, wantsWeb)); setLesson(result); await storeSet(cacheKey, result); setScreen("lesson");
    } catch (e) { setError(e.message || "Couldn't generate this lesson."); setScreen("classroom"); }
  }
  async function recordQuizAnswer(qi, oi) {
    if (!lesson || !classroomTopic || !user) return; const newAnswers = { ...quizAnswers, [qi]: oi }; setQuizAnswers(newAnswers); if (Object.keys(newAnswers).length === lesson.quick_check.length) { const correct = lesson.quick_check.filter((q, i) => newAnswers[i] === q.correct_index).length; const result = { answers: newAnswers, score: correct, total: lesson.quick_check.length, completedAt: Date.now(), topic: classroomTopic.topic }; await storeSet(skey("quizresult", user.email, classroomTopic.id), result); }
  }
  function practiseThisWeakness(topic) { setCompany(topic.company); setRole(topic.role); setTargetTopic(topic.topic); setFocusWeaknesses(true); setError(""); setWizardStep(1); setScreen("create"); }
  function loadDemo() { setCompany("JPMorgan"); setRole("Global Markets Summer Analyst"); setJdText(DEMO_JD); setCvText(DEMO_CV); setStage("First Round"); setItype("Mixed"); }
  function startCreateFlow(focusWeak = false) { setWizardStep(1); setFocusWeaknesses(focusWeak); setTargetTopic(null); setError(""); setScreen("create"); }

  async function analyseAndPlan() {
    setError(""); setScreen("analyzing"); const cleanCompany = sanitizeText(company); const cleanRole = sanitizeText(role); const cleanJd = sanitizeText(jdText); const cleanCv = sanitizeText(cvText);
    try {
      const weaknessNote = targetTopic ? `The candidate came here specifically from a Classroom lesson to practise this exact weakness: "${targetTopic}". Weight the question plan heavily toward re-testing this specific competency — it should be tested more than once, with rising difficulty if the candidate does well.${perf?.weaknesses?.length ? ` Their other known weaknesses are: ${perf.weaknesses.join("; ")} — touch on these too where relevant, but "${targetTopic}" is the priority.` : ""}` : perf && perf.weaknesses.length ? "The candidate's known weaknesses from previous interviews are: " + perf.weaknesses.join("; ") + (focusWeaknesses ? ". The candidate has specifically asked to focus this interview on these weaknesses — weight the question plan heavily toward re-testing them." : ". Where relevant to this role, include at least one question that specifically re-tests one of these weaknesses.") : "This candidate has no prior interview history.";
      const system = `You are an expert interview coach and recruiter. You analyse a job description and a CV together and produce a single strict JSON object (no prose, no markdown fences) with this exact shape:\n{\n  "interview_profile": {\n    "company": "", "role": "", "division": "", "seniority": "",\n    "responsibilities": [""], "required_skills": [""], "preferred_skills": [""],\n    "competencies": [{"name": "", "basis": "explicit|inferred|general"}],\n    "technical_topics": [""], "behavioural_topics": [""], "commercial_topics": [""],\n    "question_mix": {"motivation_fit": 30, "cv_behavioural": 25, "role_specific": 20, "technical": 15, "commercial_awareness": 10}\n  },\n  "candidate_profile": {\n    "education": [""], "experience": [""], "leadership": [""], "achievements": [""],\n    "skills": [""], "behavioural_examples": [""],\n    "potential_probe_areas": [{"claim": "", "why": ""}]\n  },\n  "opening_question": { "text": "", "category": "motivation_fit|cv_behavioural|role_specific|technical|commercial_awareness", "competency": "" }\n}\nRules: "basis" must honestly mark whether each competency is explicitly stated in the JD, reasonably inferred, or just generally expected for this role type. question_mix percentages sum to 100 and reflect the actual role type. potential_probe_areas should point at specific claims worth challenging. opening_question must be natural and specific, not generic.`;
      const userText = `${weaknessNote}\n\nCompany: ${cleanCompany}\nRole: ${cleanRole}\nInterview stage: ${stage}\nInterview type requested: ${itype}\n\nJob description:\n${cleanJd}\n\nCandidate CV:\n${cleanCv}`;
      const result = validateProfile(await callClaude(system, userText, 3000)); setProfile(result); const newInterview = { id: "int_" + Date.now(), company: cleanCompany, role: cleanRole, stage, itype, startedAt: Date.now(), maxQuestions: length, transcript: [], currentQuestion: result.opening_question, status: "planned" }; setInterview(newInterview); setScreen("preview");
    } catch (e) { setError(e.message || "Something went wrong analysing this role."); setScreen("create"); }
  }
  function beginInterview() { setScreen("interview"); }
  async function submitAnswer() {
    if (!answerInput.trim() || !interview || !profile) return; setError(""); const cleanAnswer = sanitizeText(answerInput); const currentQ = interview.currentQuestion; const askedSoFar = interview.transcript.length + 1; setScreen("evaluating");
    try {
      const system = `You are a real, professional interviewer conducting a live interview. You are NOT effusive or full of praise — you are neutral and probing. Return strict JSON only, no prose, in this exact shape:\n{\n  "evaluation": { "relevance": 0, "specificity": 0, "structure": 0, "evidence": 0, "clarity": 0, "competency_demonstration": 0, "strengths": [""], "issues": [""] },\n  "decision": "follow_up|new_competency|challenge_claim|clarify|next_section",\n  "next_question": { "text": "", "category": "motivation_fit|cv_behavioural|role_specific|technical|commercial_awareness", "competency": "" },\n  "interview_should_end": false\n}\nRules: honest 0-100 scores. If vague/generic/no example, note it and probe for specifics. If dodged, redirect back to it. Don't repeat a thoroughly covered competency unless the answer revealed a weakness worth re-testing. Vary categories per question_mix. Set interview_should_end true once roughly ${interview.maxQuestions} questions have been asked and core competencies are covered.`;
      const userText = `Interview profile: ${JSON.stringify(profile.interview_profile)}\nCandidate profile: ${JSON.stringify(profile.candidate_profile)}\nQuestions asked so far: ${askedSoFar} of target ${interview.maxQuestions}\nTranscript so far: ${JSON.stringify(interview.transcript)}\n\nQuestion just asked: ${JSON.stringify(currentQ)}\nCandidate's answer: ${cleanAnswer}`;
      const result = validateNextTurn(await callClaude(system, userText, 1200)); const newEntry = { question: currentQ, answer: cleanAnswer, evaluation: result.evaluation }; const newTranscript = [...interview.transcript, newEntry]; const shouldEnd = result.interview_should_end || newTranscript.length >= interview.maxQuestions + 3; const updated = { ...interview, transcript: newTranscript, currentQuestion: result.next_question }; setInterview(updated); setAnswerInput(""); if (shouldEnd) await finishInterview(updated); else setScreen("interview");
    } catch (e) { setError(e.message || "Something went wrong evaluating that answer."); setScreen("interview"); }
  }
  async function finishInterview(finalInterview) {
    setScreen("reporting");
    try {
      const system = `You produce a final interview performance report as strict JSON only, no prose. Shape:\n{\n  "overall_score": 0, "readiness": "not_ready|needs_improvement|interview_ready|strong",\n  "breakdown": {"relevance":0,"structure":0,"specificity":0,"evidence":0,"communication":0,"competency_demonstration":0},\n  "strongest_areas": [""], "weakest_areas": [""],\n  "per_question_feedback": [{"question":"", "did_well": [""], "weakened_it": [""], "how_to_improve": "", "note_on_missing_data": ""}],\n  "next_practice_focus": "", "updated_candidate_weaknesses": [""], "updated_candidate_strengths": [""],\n  "interview_style_notes": [""],\n  "classroom_topics": [{"topic": "", "category": "company_knowledge|technical|commercial_awareness|behavioural|technique|role_specific", "description": "", "related_question": "", "initial_score": 0}]\n}\nRules: scores computed honestly from the transcript's evaluations. Never fabricate achievements the candidate never claimed. classroom_topics: only genuine, specific, teachable weaknesses (usually 1-3), with a short reusable "topic" title so progress on it can be tracked over time. interview_style_notes: 1-3 short, concrete observations about HOW this candidate interviews across the transcript as a whole (e.g. "Answers tend to run long", "Strong examples but rarely quantifies results", "Good technical grounding but motivation answers stay generic") — behavioural/stylistic patterns, not one-off scores.`;
      const userText = `Company: ${finalInterview.company}\nRole: ${finalInterview.role}\nInterview profile: ${JSON.stringify(profile.interview_profile)}\nPre-existing candidate performance profile: ${JSON.stringify(perf)}\nFull transcript: ${JSON.stringify(finalInterview.transcript)}`;
      const result = validateReport(await callClaude(system, userText, 4500));
      const comparisons = finalInterview.transcript.map((t) => { const match = matchPreviousQuestion(t.question?.text, t.question?.category, t.question?.competency, questionHistory); if (!match) return null; return { question: t.question?.text, previous_score: match.score, current_score: t.evaluation?.competency_demonstration ?? null, company: finalInterview.company, role: finalInterview.role, date: Date.now() }; }).filter(Boolean);
      setReport({ ...result, memory_comparisons: comparisons });
      if (comparisons.length && user) { const newMemoryLog = [...comparisons, ...memoryLog].slice(0, 30); setMemoryLog(newMemoryLog); await storeSet(skey("memory", user.email), newMemoryLog); }
      const newHistoryEntries = finalInterview.transcript.map((t) => ({ question: t.question?.text, category: t.question?.category, competency: t.question?.competency, score: t.evaluation?.competency_demonstration ?? t.evaluation?.relevance ?? 0, date: Date.now(), company: finalInterview.company, role: finalInterview.role, interviewId: finalInterview.id }));
      const newQHistory = [...questionHistory, ...newHistoryEntries].slice(-200); setQuestionHistory(newQHistory); if (user) await storeSet(skey("qhistory", user.email), newQHistory);
      await pushClassroomTopics(result.classroom_topics, { company: finalInterview.company, role: finalInterview.role, id: finalInterview.id });
      const summary = { id: finalInterview.id, company: finalInterview.company, role: finalInterview.role, date: Date.now(), overall_score: result.overall_score, readiness: result.readiness, breakdown: result.breakdown }; const newList = [...interviewList, summary]; setInterviewList(newList); if (user) { await storeSet(skey("interviews", user.email), newList); await storeSet(skey("interview_full", finalInterview.id), { ...finalInterview, report: result, memoryComparisons: comparisons }); }
      await applyPerformanceUpdate({ weaknesses: result.updated_candidate_weaknesses, strengths: result.updated_candidate_strengths, breakdown: result.breakdown, styleNotes: result.interview_style_notes }); setScreen("report");
    } catch (e) { setError(e.message || "Something went wrong generating the report."); setScreen("interview"); }
  }
  function resetForNewInterview() { setCompany(""); setRole(""); setJdText(""); setCvText(""); setStage("First Round"); setItype("Mixed"); setLength(12); setProfile(null); setInterview(null); setReport(null); setError(""); setFocusWeaknesses(false); setWizardStep(1); setScreen("create"); }
  function startAssessmentCentre(type) { setAcType(type); setAcSubmission(""); setAcResult(null); setError(""); generateAcScenario(type); }
  async function generateAcScenario(type) {
    setScreen("ac_generating");
    try { const cfg = EXERCISE_TYPES.find((t) => t.key === type); const priorAttempts = acAttempts.filter((a) => a.type === type); const priorAvg = priorAttempts.length ? Math.round(priorAttempts.reduce((s, a) => s + a.overall_score, 0) / priorAttempts.length) : null; const system = `You design realistic graduate assessment-centre exercises. Return strict JSON only, no prose:\n{ "title": "", "brief": "", "objective": "", "materials": [""], "suggested_time_minutes": 15 }\nRules: ground it in the specific company and role given, for a "${cfg.label}" exercise. materials should be short concrete bullets (documents, data points, or — for an inbox exercise — the individual inbox items themselves, each one bullet with sender/subject/gist and no explicit urgency label, since judging urgency is the point of the exercise). Calibrate difficulty${priorAvg !== null ? ` — the candidate averaged ${priorAvg}/100 on this exercise type before, so ${priorAvg >= 75 ? "raise the difficulty a notch" : priorAvg < 50 ? "keep it approachable" : "keep it moderately challenging"}` : " for a first attempt: realistic but approachable"}.`; const userText = `Exercise type: ${cfg.label}\nCompany: ${sanitizeText(acCompany)}\nRole: ${sanitizeText(acRole)}\nCandidate level: ${candidateLevel()}\nKnown weaknesses to weave in naturally where relevant: ${(perf?.weaknesses || []).join("; ") || "none yet"}`; const result = validateAcScenario(await callClaude(system, userText, 1400)); setAcScenario(result); setScreen("ac_exercise"); } catch (e) { setError(e.message || "Couldn't generate this exercise."); setScreen("ac_home"); }
  }
  async function submitAcResponse() {
    if (!acSubmission.trim() || !acScenario) return; setError(""); setScreen("ac_evaluating");
    try { const cfg = EXERCISE_TYPES.find((t) => t.key === acType); const system = `You are an assessment-centre assessor. Return strict JSON only:\n{ "overall_score": 0, "breakdown": {}, "did_well": [""], "held_back": [""], "classroom_topics": [{"topic":"","category":"","description":"","related_question":"","initial_score":0}], "updated_candidate_weaknesses": [""], "updated_candidate_strengths": [""] }\nAssess against this exercise's competencies: ${cfg.competencies.join(", ")}.`; const userText = `Company: ${acCompany}\nRole: ${acRole}\nExercise: ${JSON.stringify(acScenario)}\nCandidate submission:\n${sanitizeText(acSubmission)}`; const result = validateAcResult(await callClaude(system, userText, 2200)); setAcResult(result); const attempt = { id: "ac_" + Date.now(), type: acType, company: acCompany, role: acRole, overall_score: result.overall_score, date: Date.now() }; const newAttempts = [...acAttempts, attempt]; setAcAttempts(newAttempts); if (user) await storeSet(skey("ac_attempts", user.email), newAttempts); await pushClassroomTopics(result.classroom_topics, { company: acCompany, role: acRole, id: attempt.id }); await applyPerformanceUpdate({ weaknesses: result.updated_candidate_weaknesses, strengths: result.updated_candidate_strengths, breakdown: result.breakdown }); setScreen("ac_scorecard"); } catch (e) { setError(e.message || "Couldn't evaluate this exercise."); setScreen("ac_exercise"); }
  }

  const classroomNeedsWorkCount = classroom.filter((t) => t.scores?.length && t.scores[t.scores.length - 1] < 70).length;
  const shell = (children) => (<div style={{ fontFamily: "var(--font)", minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}><style>{TOKENS}</style><NavBar screen={screen} setScreen={setScreen} user={user} classroomNeedsWorkCount={classroomNeedsWorkCount} />{children}</div>);

  if (screen === "landing") return shell(<div style={{ maxWidth: 1080, margin: "0 auto", padding: "72px 24px" }}><div className="jr-fade" style={{ maxWidth: 760 }}><Pill>AI-powered interview preparation</Pill><h1 style={{ fontSize: "clamp(42px,7vw,72px)", lineHeight: 1.02, letterSpacing: "-0.045em", fontWeight: 900, color: "var(--navy)", margin: "18px 0" }}>Prepare better.<br /><span style={{ color: "var(--blue)" }}>Interview stronger.</span></h1><p style={{ fontSize: 18, lineHeight: 1.65, color: "var(--text-dim)", maxWidth: 650 }}>JOB.READY creates realistic, role-specific interviews, evaluates your answers and builds a personalised plan to improve the weaknesses that matter.</p><div className="flex flex-wrap gap-3 mt-8"><Btn variant="accent" onClick={() => setScreen("login")}>Start practising <ChevronRight size={17} /></Btn><Btn variant="secondary" onClick={() => setScreen("how")}>How it works</Btn></div></div></div>);
  if (screen === "how") return shell(<div style={{ maxWidth: 900, margin: "0 auto", padding: "52px 24px" }}><Pill>How it works</Pill><h2 style={{ fontSize: 36, fontWeight: 850, color: "var(--navy)", margin: "14px 0 28px" }}>From job description to targeted practice.</h2><div className="grid grid-cols-1 md:grid-cols-3 gap-4">{[["01","Build your profile","Add the company, role, job description and CV."],["02","Run the interview","Answer realistic questions generated around the role and your profile."],["03","Improve","Get detailed feedback, Classroom lessons, progress tracking and repeat practice."]].map(([n,t,d]) => <Card key={n} style={{ padding: 22 }}><div style={{ fontSize: 12, color: "var(--blue)", fontWeight: 800 }}>{n}</div><h3 style={{ fontSize: 18, margin: "12px 0 8px", color: "var(--navy)" }}>{t}</h3><p style={{ color: "var(--text-dim)", lineHeight: 1.6, fontSize: 14 }}>{d}</p></Card>)}</div></div>);
  if (screen === "universities") return shell(<div style={{ maxWidth: 900, margin: "0 auto", padding: "52px 24px" }}><Pill>For universities</Pill><h2 style={{ fontSize: 38, fontWeight: 850, color: "var(--navy)", margin: "14px 0" }}>A scalable interview-preparation layer for careers teams.</h2><p style={{ color: "var(--text-dim)", lineHeight: 1.7, maxWidth: 700 }}>Give students structured, personalised interview practice while helping careers teams understand where students need support.</p></div>);
  if (screen === "login") return shell(<div style={{ maxWidth: 460, margin: "0 auto", padding: "70px 24px" }}><Card style={{ padding: 28 }}><JobReadyLogo size={30} /><h2 style={{ color: "var(--navy)", margin: "24px 0 6px" }}>Welcome to JOB.READY</h2><p style={{ color: "var(--text-dim)", fontSize: 14 }}>Demo account access — production authentication will be handled by Supabase.</p><input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Name" style={{ width: "100%", padding: 13, margin: "16px 0 8px", border: "1px solid var(--border)", borderRadius: 8 }} /><input value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="Email" type="email" style={{ width: "100%", padding: 13, margin: "0 0 12px", border: "1px solid var(--border)", borderRadius: 8 }} />{error && <div style={{ color: "var(--bad)", fontSize: 13, marginBottom: 10 }}>{error}</div>}<Btn full variant="accent" onClick={() => guarded(handleLogin)}>Continue</Btn><Btn full variant="ghost" onClick={loadDemo} style={{ marginTop: 8 }}>Load demo data</Btn></Card></div>);
  if (screen === "dashboard") return shell(<div style={{ maxWidth: 1080, margin: "0 auto", padding: "44px 24px" }}><div className="flex flex-wrap justify-between items-end gap-4"><div><Pill>Dashboard</Pill><h2 style={{ fontSize: 32, fontWeight: 850, color: "var(--navy)", margin: "12px 0 4px" }}>Good to see you, {user?.name || "candidate"}.</h2><p style={{ color: "var(--text-dim)" }}>Build your next interview around the role you actually want.</p></div><Btn variant="accent" onClick={() => startCreateFlow()}>New interview <ChevronRight size={16} /></Btn></div><div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-7"><Card style={{ padding: 20 }}><Target size={20} color="var(--blue)" /><div style={{ fontSize: 28, fontWeight: 850, marginTop: 12 }}>{interviewList.length}</div><div style={{ color: "var(--text-dim)", fontSize: 13 }}>Interviews completed</div></Card><Card style={{ padding: 20 }}><BarChart3 size={20} color="var(--violet)" /><div style={{ fontSize: 28, fontWeight: 850, marginTop: 12 }}>{perf?.weaknesses?.length || 0}</div><div style={{ color: "var(--text-dim)", fontSize: 13 }}>Known weaknesses</div></Card><Card style={{ padding: 20 }}><GraduationCap size={20} color="var(--teal)" /><div style={{ fontSize: 28, fontWeight: 850, marginTop: 12 }}>{classroom.length}</div><div style={{ color: "var(--text-dim)", fontSize: 13 }}>Classroom topics</div></Card></div><Card style={{ padding: 22, marginTop: 18 }}><h3 style={{ margin: 0, color: "var(--navy)" }}>Quick start</h3><div className="flex flex-wrap gap-3 mt-4"><Btn variant="secondary" onClick={() => startCreateFlow(true)}>Practise a weakness</Btn><Btn variant="secondary" onClick={() => setScreen("classroom")}>Open Classroom</Btn><Btn variant="secondary" onClick={() => setScreen("progress")}>View Progress</Btn></div></Card></div>);
  if (screen === "create") return shell(<div style={{ maxWidth: 760, margin: "0 auto", padding: "44px 24px" }}><Btn variant="ghost" onClick={() => setScreen("dashboard")}><ArrowLeft size={15} /> Dashboard</Btn><h2 style={{ fontSize: 30, fontWeight: 850, color: "var(--navy)", margin: "16px 0 6px" }}>Build your interview</h2><p style={{ color: "var(--text-dim)" }}>Tell JOB.READY what you're preparing for.</p><div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6"><Card style={{ padding: 18 }}><label>Company</label><input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Barclays" style={{ width: "100%", padding: 12, marginTop: 7, border: "1px solid var(--border)", borderRadius: 8 }} /></Card><Card style={{ padding: 18 }}><label>Role</label><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Summer Analyst" style={{ width: "100%", padding: 12, marginTop: 7, border: "1px solid var(--border)", borderRadius: 8 }} /></Card></div><Card style={{ padding: 18, marginTop: 14 }}><div className="flex flex-wrap justify-between items-center gap-3"><div><div style={{ fontWeight: 700, color: "var(--navy)" }}>Job description</div><div style={{ color: "var(--text-faint)", fontSize: 12 }}>Paste text or upload TXT, DOCX or PDF.</div></div><label style={{ cursor: "pointer" }}><input type="file" accept=".txt,.docx,.pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf" onChange={(e) => handleFileUpload(e, "jd")} style={{ display: "none" }} /><Btn variant="secondary" onClick={() => {}}> <Upload size={15} /> {fileBusy === "jd" ? "Processing..." : "Upload file"}</Btn></label></div><textarea value={jdText} onChange={(e) => setJdText(e.target.value)} placeholder="Paste the job description here..." style={{ width: "100%", minHeight: 180, padding: 14, marginTop: 14, border: "1px solid var(--border)", borderRadius: 8, lineHeight: 1.5 }} /></Card><Card style={{ padding: 18, marginTop: 14 }}><div className="flex flex-wrap justify-between items-center gap-3"><div><div style={{ fontWeight: 700, color: "var(--navy)" }}>CV / Resume</div><div style={{ color: "var(--text-faint)", fontSize: 12 }}>Paste text or upload TXT, DOCX or PDF.</div></div><label style={{ cursor: "pointer" }}><input type="file" accept=".txt,.docx,.pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf" onChange={(e) => handleFileUpload(e, "cv")} style={{ display: "none" }} /><Btn variant="secondary" onClick={() => {}}> <Upload size={15} /> {fileBusy === "cv" ? "Processing..." : "Upload file"}</Btn></label></div><textarea value={cvText} onChange={(e) => setCvText(e.target.value)} placeholder="Paste your CV here..." style={{ width: "100%", minHeight: 180, padding: 14, marginTop: 14, border: "1px solid var(--border)", borderRadius: 8, lineHeight: 1.5 }} /></Card>{error && <div style={{ color: "var(--bad)", fontSize: 13, marginTop: 12 }}>{error}</div>}<div className="flex flex-wrap justify-between gap-3 mt-5"><Btn variant="secondary" onClick={loadDemo}>Use demo data</Btn><Btn variant="accent" disabled={!company.trim() || !role.trim() || !jdText.trim() || !cvText.trim()} onClick={() => guarded(analyseAndPlan)}>Build my interview <ChevronRight size={16} /></Btn></div></div>);
  if (screen === "analyzing") return shell(<LoadingScreen messages={["Reading the job description...", "Mapping the role's competencies...", "Cross-referencing your CV...", "Building your interview plan..."]} />);
  if (screen === "preview" && profile && interview) return shell(<div style={{ maxWidth: 800, margin: "0 auto", padding: "44px 24px" }}><Pill>{interview.company} · {interview.role}</Pill><h2 style={{ fontSize: 30, fontWeight: 850, color: "var(--navy)", margin: "14px 0" }}>Your interview is ready.</h2><Card style={{ padding: 22 }}><div style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 15 }}>Opening question</div><div style={{ fontSize: 20, fontWeight: 700, color: "var(--navy)", lineHeight: 1.4 }}>{profile.opening_question.text}</div></Card><div className="flex flex-wrap gap-3 mt-5"><Btn variant="accent" onClick={beginInterview}>Start interview <ChevronRight size={16} /></Btn><Btn variant="secondary" onClick={() => setScreen("create")}>Edit</Btn></div></div>);
  if (screen === "interview") return shell(<div style={{ maxWidth: 800, margin: "0 auto", padding: "36px 24px" }}><div className="flex flex-wrap justify-between gap-3"><Pill>{interview?.company} · {interview?.role}</Pill><span style={{ color: "var(--text-faint)", fontSize: 13 }}>{interview?.transcript?.length || 0} answers</span></div><Card style={{ padding: 24, marginTop: 18 }}><div style={{ fontSize: 12, color: "var(--blue)", fontWeight: 800, textTransform: "uppercase", marginBottom: 10 }}>Interviewer</div><div style={{ fontSize: 22, fontWeight: 750, lineHeight: 1.45, color: "var(--navy)" }}>{interview?.currentQuestion?.text}</div></Card><textarea value={answerInput} onChange={(e) => setAnswerInput(e.target.value)} placeholder="Type your answer..." style={{ width: "100%", minHeight: 240, marginTop: 14, padding: 16, border: "1.5px solid var(--border)", borderRadius: "var(--radius)", fontSize: 15, lineHeight: 1.6 }} />{error && <div style={{ color: "var(--bad)", fontSize: 13, marginTop: 10 }}>{error}</div>}<div className="flex flex-wrap justify-between gap-3 mt-4"><span style={{ color: "var(--text-faint)", fontSize: 12 }}>Be specific. Use evidence where you can.</span><Btn variant="accent" onClick={() => guarded(submitAnswer)} disabled={!answerInput.trim()}>Submit answer <ChevronRight size={16} /></Btn></div></div>);
  if (screen === "evaluating") return shell(<LoadingScreen messages={["Evaluating your answer...", "Checking specificity and evidence...", "Choosing the next question..."]} />);
  if (screen === "reporting") return shell(<LoadingScreen messages={["Reviewing the full interview...", "Updating your performance profile...", "Building your next practice plan..."]} />);
  if (screen === "report" && report) return shell(<div style={{ maxWidth: 800, margin: "0 auto", padding: "44px 24px" }}><Pill>Interview report</Pill><div className="flex flex-wrap items-center gap-6 mt-5"><RingScore value={report.overall_score} label="/ 100" /><div><h2 style={{ fontSize: 30, fontWeight: 850, color: "var(--navy)", margin: 0 }}>{report.readiness.replace(/_/g, " ")}</h2><p style={{ color: "var(--text-dim)" }}>{report.next_practice_focus}</p></div></div><Card style={{ padding: 20, marginTop: 22 }}>{Object.entries(report.breakdown || {}).map(([k,v]) => <ScoreBar key={k} label={k.replace(/_/g," ")} value={v} />)}</Card><div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4"><Card style={{ padding: 18 }}><h3 style={{ color: "var(--good)" }}>Strengths</h3>{(report.strongest_areas || []).map((x,i)=><div key={i} className="flex gap-2 mb-2"><CheckCircle2 size={15} color="var(--good)" />{x}</div>)}</Card><Card style={{ padding: 18 }}><h3 style={{ color: "var(--bad)" }}>Focus areas</h3>{(report.weakest_areas || []).map((x,i)=><div key={i} className="flex gap-2 mb-2"><TrendingDown size={15} color="var(--bad)" />{x}</div>)}</Card></div>{report.memory_comparisons?.length > 0 && <Card style={{ padding: 18, marginTop: 16 }}><h3 style={{ color: "var(--violet)" }}>Interview Memory</h3>{report.memory_comparisons.map((m,i)=><div key={i} style={{ fontSize: 14, marginTop: 8 }}>{m.previous_score} → {m.current_score}</div>)}</Card>}<div className="flex flex-wrap gap-3 mt-5"><Btn variant="accent" onClick={() => setScreen("classroom")}>Study in Classroom</Btn><Btn variant="secondary" onClick={resetForNewInterview}>New interview</Btn><Btn variant="secondary" onClick={() => setScreen("progress")}>Progress</Btn></div></div>);

  if (screen === "classroom") return shell(<div style={{ maxWidth: 900, margin: "0 auto", padding: "44px 24px" }}><Pill>Classroom</Pill><h2 style={{ fontSize: 32, fontWeight: 850, color: "var(--navy)", margin: "12px 0" }}>Turn weaknesses into knowledge.</h2><p style={{ color: "var(--text-dim)" }}>Short, targeted lessons generated from your interview performance.</p>{!classroom.length ? <Card style={{ padding: 24, marginTop: 20 }}><p style={{ color: "var(--text-dim)" }}>Complete an interview to populate your Classroom.</p></Card> : <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">{classroom.map((t) => { const s=statusFor(t.scores || [0]); return <Card key={t.id} onClick={() => openLesson(t)} style={{ padding: 20, cursor: "pointer" }}><div className="flex justify-between gap-3"><Pill color={s.color} bg={s.bg}>{s.label}</Pill><span style={{ fontSize: 12, color: "var(--text-faint)" }}>{t.scores?.[t.scores.length-1] || 0}/100</span></div><h3 style={{ color: "var(--navy)", margin: "14px 0 6px" }}>{t.topic}</h3><p style={{ color: "var(--text-dim)", fontSize: 13.5, lineHeight: 1.55 }}>{t.description}</p><div style={{ fontSize: 12, color: "var(--blue)", marginTop: 12 }}>Open lesson →</div></Card>})}</div>}</div>);
  if (screen === "classroom_generating") return shell(<LoadingScreen messages={["Building your lesson...", "Selecting the knowledge that matters...", "Creating a quick check..."]} />);
  if (screen === "lesson" && lesson) return shell(<div style={{ maxWidth: 780, margin: "0 auto", padding: "44px 24px" }}><Btn variant="ghost" onClick={() => setScreen("classroom")}><ArrowLeft size={15}/> Classroom</Btn><Pill>{classroomTopic?.category}</Pill><h2 style={{ fontSize: 32, fontWeight: 850, color: "var(--navy)", margin: "14px 0" }}>{lesson.title}</h2><Card style={{ padding: 22, marginBottom: 16 }}><h3>Why it matters</h3><p style={{ color: "var(--text-dim)", lineHeight: 1.65 }}>{lesson.why_it_matters}</p></Card><Card style={{ padding: 22, marginBottom: 16 }}><h3>Core knowledge</h3>{lesson.core_knowledge.map((k,i)=><div key={i} style={{ padding: "10px 0", borderBottom: i<lesson.core_knowledge.length-1?"1px solid var(--border)":"none", lineHeight:1.6 }}>{k.point}</div>)}</Card><Card style={{ padding: 22, marginBottom: 16 }}><h3>Key points</h3>{lesson.key_points.map((k,i)=><div key={i} className="flex gap-2 mb-2"><CheckCircle2 size={15} color="var(--teal)" style={{marginTop:3}}/>{k}</div>)}</Card>{lesson.example_answer_snippet && <Card style={{ padding: 22, marginBottom: 16 }}><h3>How to apply it</h3><p style={{ color: "var(--text-dim)", lineHeight:1.65 }}>{lesson.example_answer_snippet}</p><p style={{ color:"var(--navy)", fontWeight:600 }}>{lesson.interview_application}</p></Card>}<Card style={{ padding: 22 }}><h3>Quick check</h3>{lesson.quick_check.map((q,qi)=><div key={qi} style={{marginBottom:20}}><div style={{fontWeight:650, marginBottom:10}}>{q.question}</div><div className="flex flex-wrap gap-2">{q.options.map((o,oi)=><button key={oi} onClick={()=>recordQuizAnswer(qi,oi)} disabled={quizAnswers[qi] !== undefined} style={{padding:"9px 12px", border:"1px solid var(--border)", borderRadius:8, background: quizAnswers[qi]===oi?"var(--highlight)":"#fff", cursor:"pointer"}}>{o}</button>)}</div>{quizAnswers[qi] !== undefined && <div style={{fontSize:12,color:"var(--text-dim)",marginTop:7}}>{q.explanation}</div>}</div>)}</Card></div>);
  if (screen === "progress") return shell(<div style={{ maxWidth: 900, margin: "0 auto", padding: "44px 24px" }}><Pill>Progress</Pill><h2 style={{ fontSize: 32, fontWeight: 850, color: "var(--navy)", margin: "12px 0" }}>Your interview progress.</h2><div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">{interviewList.map((i) => <Card key={i.id} style={{ padding: 18 }}><div className="flex justify-between"><div><div style={{fontWeight:700,color:"var(--navy)"}}>{i.company}</div><div style={{fontSize:13,color:"var(--text-dim)"}}>{i.role}</div></div><RingScore value={i.overall_score} size={74}/></div></Card>)}</div>{perf && <Card style={{padding:22,marginTop:18}}><h3>Interview DNA</h3><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div><div style={{fontWeight:700,color:"var(--good)",marginBottom:8}}>Strengths</div>{perf.strengths.map((x,i)=><div key={i}>{x}</div>)}</div><div><div style={{fontWeight:700,color:"var(--bad)",marginBottom:8}}>Weaknesses</div>{perf.weaknesses.map((x,i)=><div key={i}>{x}</div>)}</div></div></Card>}</div>);

  if (screen === "ac_home") return shell(<div style={{ maxWidth: 900, margin: "0 auto", padding: "44px 24px" }}><Pill>Assessment Centre</Pill><h2 style={{ fontSize: 32, fontWeight: 850, color: "var(--navy)", margin: "12px 0" }}>Practise graduate assessment exercises.</h2><div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">{EXERCISE_TYPES.map((x)=><Card key={x.key} onClick={()=>{setAcCompany(company);setAcRole(role);startAssessmentCentre(x.key)}} style={{padding:20,cursor:"pointer"}}><x.icon size={20} color="var(--blue)"/><h3 style={{color:"var(--navy)",margin:"12px 0 6px"}}>{x.label}</h3><p style={{fontSize:13.5,color:"var(--text-dim)",lineHeight:1.55}}>{x.blurb}</p></Card>)}</div></div>);
  if (screen === "ac_generating") return shell(<LoadingScreen messages={["Designing the exercise...", "Calibrating the difficulty...", "Preparing the assessment..."]} />);
  if (screen === "ac_exercise" && acScenario) return shell(<div className="jr-fade" style={{ maxWidth: 700, margin: "0 auto", padding: "44px 24px" }}><Btn variant="ghost" onClick={() => setScreen("ac_home")} style={{ marginBottom: 16, padding: "6px 4px" }}><ArrowLeft size={14} /> Assessment Centre</Btn><Pill color="var(--teal)" bg="#E6FBF6">{EXERCISE_TYPES.find((t) => t.key === acType)?.label} · {acCompany} — {acRole}</Pill><h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--navy)", margin: "14px 0 12px" }}>{acScenario.title}</h2><Card style={{ padding: 22, marginBottom: 16 }}><div style={{ fontSize: 14.5, color: "var(--text-dim)", lineHeight: 1.6, marginBottom: 14 }}>{acScenario.brief}</div>{acScenario.objective && <div style={{ marginBottom: 14 }}><div style={{ fontSize: 11, fontWeight: 700, color: "var(--blue)", textTransform: "uppercase", marginBottom: 4 }}>Objective</div><div style={{ fontSize: 14, color: "var(--navy)" }}>{acScenario.objective}</div></div>}{acScenario.materials?.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 8 }}>Materials</div>{acScenario.materials.map((m, i) => <div key={i} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, fontSize: 13, color: "var(--navy)", marginBottom: 6 }}>{m}</div>)}</div>}{acScenario.suggested_time_minutes && <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 12 }}>Suggested time: {acScenario.suggested_time_minutes} minutes (untimed here — take what you need)</div>}</Card><div style={{fontSize:12,fontWeight:600,color:"var(--text-dim)",marginBottom:8}}>{acType === "inbox" ? "Write your priority order and your reasoning for it." : acType === "group" ? "Write your key contributions, as if speaking in the group, in the order you'd raise them." : "Your response"}</div><textarea value={acSubmission} onChange={(e)=>setAcSubmission(e.target.value)} placeholder="Type your response..." style={{width:"100%",height:220,padding:16,border:"1.5px solid var(--border)",borderRadius:"var(--radius)",fontSize:15,lineHeight:1.55,fontFamily:"var(--font)"}} />{error && <div style={{color:"var(--bad)",fontSize:13,marginTop:10}}>{error}</div>}<div className="flex flex-wrap justify-between gap-3 mt-4"><span style={{fontSize:12,color:"var(--text-faint)"}}>{acSubmission.trim().split(/\s+/).filter(Boolean).length} words</span><Btn variant="accent" onClick={()=>guarded(submitAcResponse)} disabled={!acSubmission.trim()}>Submit <ChevronRight size={16}/></Btn></div></div>);
  if (screen === "ac_evaluating") return shell(<LoadingScreen messages={["Reading your submission...", "Scoring against the rubric...", "Writing your scorecard..."]} />);
  if (screen === "ac_scorecard" && acResult) return shell(<div className="jr-fade" style={{ maxWidth: 700, margin: "0 auto", padding: "44px 24px" }}><Pill color="var(--teal)" bg="#E6FBF6">{EXERCISE_TYPES.find((t) => t.key === acType)?.label}</Pill><h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--navy)", margin: "14px 0 20px" }}>{acCompany} — {acRole}</h2><Card style={{ padding: 26, marginBottom: 20 }}><div className="flex items-center gap-8"><RingScore value={acResult.overall_score} size={110} label="/ 100" /><div style={{ fontSize: 13.5, color: "var(--text-dim)", maxWidth: 340 }}>{acResult.held_back?.[0] || ""}</div></div></Card><Card style={{ padding: 20, marginBottom: 20 }}>{Object.entries(acResult.breakdown || {}).map(([k,v])=><ScoreBar key={k} label={k.replace(/_/g," ")} value={v}/>)}</Card><div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"><Card style={{padding:18}}><div style={{fontSize:12,fontWeight:700,color:"var(--good)",marginBottom:10,textTransform:"uppercase"}}>What you did well</div>{(acResult.did_well||[]).map((s,i)=><div key={i} className="flex gap-2 mb-2" style={{fontSize:13.5}}><CheckCircle2 size={14} color="var(--good)" style={{flexShrink:0,marginTop:2}}/>{s}</div>)}</Card><Card style={{padding:18}}><div style={{fontSize:12,fontWeight:700,color:"var(--bad)",marginBottom:10,textTransform:"uppercase"}}>What held you back</div>{(acResult.held_back||[]).map((s,i)=><div key={i} className="flex gap-2 mb-2" style={{fontSize:13.5}}><TrendingDown size={14} color="var(--bad)" style={{flexShrink:0,marginTop:2}}/>{s}</div>)}</Card></div>{acResult.classroom_topics?.length>0 && <Card style={{padding:20,marginBottom:20,borderLeft:"4px solid var(--violet)"}}><div className="flex items-center gap-3 mb-2"><GraduationCap size={17} color="var(--violet)"/><div style={{fontSize:14.5,fontWeight:700,color:"var(--navy)"}}>Recommended Classroom lesson</div></div><div style={{fontSize:13.5,color:"var(--text-dim)",marginBottom:12}}>{acResult.classroom_topics.map((t)=>t.topic).join(", ")}</div><Btn variant="secondary" onClick={()=>setScreen("classroom")}>Learn this in Classroom <ArrowRight size={15}/></Btn></Card>}<div className="flex flex-wrap gap-3"><Btn variant="accent" onClick={()=>startAssessmentCentre(acType)}>Practise again <ArrowRight size={15}/></Btn><Btn variant="secondary" onClick={()=>setScreen("ac_home")}>Back to Assessment Centre</Btn></div></div>);

  return shell(<div style={{ maxWidth: 700, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}><AlertCircle size={30} color="var(--bad)"/><h2 style={{color:"var(--navy)"}}>Page not found</h2><Btn variant="accent" onClick={()=>setScreen(user?"dashboard":"landing")}>Go back</Btn></div>);
}

export default function AppRoot() { return (<ErrorBoundary><App /></ErrorBoundary>); }
