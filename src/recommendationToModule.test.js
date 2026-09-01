/* ================================================================== *
 * PHASE 14.1 — APPLICATION RECOMMENDATION -> DEVELOPMENT MODULE
 * ------------------------------------------------------------------
 * A Phase 13B application recommendation must enter the SAME Development
 * Module flow even when no interview-diagnosed classroom_topic exists:
 *   reuse an application-aware topic if one matches, else materialise one
 *   (no AI call) and hand it to the existing openDevelopmentModule.
 * A materialised topic is an AREA TO PREPARE — never a demonstrated
 * weakness. Application isolation must hold. Structural, App.jsx source.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function slice(a, b) {
  const s = SRC.indexOf(a);
  if (s === -1) throw new Error(`marker not found: ${a}`);
  const e = SRC.indexOf(b, s + a.length);
  if (e === -1) throw new Error(`end marker not found: ${b}`);
  return SRC.slice(s, e);
}

const DB_FN = slice("async function dbCreateRecommendationTopic(userId", "async function dbUpsertClassroomTopic(");
const HANDLER = slice("async function startLearningFromRecommendation(rec, app)", "// The ONE AI call for Phase 14.");

/* ============================== materialisation helper ============================== */
describe("dbCreateRecommendationTopic — extends the existing classroom_topics table", () => {
  it("inserts into classroom_topics (not a new/parallel table)", () => {
    expect(DB_FN).toMatch(/supabase\.from\("classroom_topics"\)\.insert\(\{/);
  });
  it("carries NO interview evidence — scores [] and last_interview_id null", () => {
    expect(DB_FN).toMatch(/scores: \[\]/);
    expect(DB_FN).toMatch(/last_interview_id: null/);
    expect(DB_FN).toMatch(/related_question: null/);
  });
  it("is bound to the recommendation's own application_id (isolation)", () => {
    expect(DB_FN).toMatch(/application_id: applicationId \|\| null/);
  });
  it("category is the recommendation's dimension (maps straight through devDimensionForCategory)", () => {
    expect(DB_FN).toMatch(/category: rec\.dimension \|\| "behavioural"/);
  });
  it("description carries the recommendation's gap wording (preparation vs demonstrated preserved)", () => {
    expect(DB_FN).toMatch(/description: str\(rec\.gapSummary\) \|\| str\(rec\.why\) \|\| ""/);
  });
  it("makes NO AI call", () => {
    expect(DB_FN).not.toMatch(/callClaude/);
  });
});

/* ============================== the click handler ============================== */
describe("startLearningFromRecommendation — reuse first, else materialise, then existing flow", () => {
  it("1-2. reuses an existing APPLICATION-AWARE topic when one matches", () => {
    expect(HANDLER).toMatch(/const existing = classroom\.find\(\(t\) => \{/);
    // never reuse another application's topic
    expect(HANDLER).toMatch(/if \(t\.applicationId && t\.applicationId !== app\.id\) return false;/);
    expect(HANDLER).toMatch(/if \(existing\) \{ await openDevelopmentModule\(existing\); return; \}/);
  });
  it("3. materialises via dbCreateRecommendationTopic when nothing matches", () => {
    expect(HANDLER).toMatch(/const row = await dbCreateRecommendationTopic\(user\.id, \{ applicationId: app\.id, company: app\.company, role: app\.role \}, rec\)/);
  });
  it("4. hands the REAL persisted topic to the existing openDevelopmentModule flow", () => {
    // Phase 38: knownNew:true — this topic was just inserted above, so openDevelopmentModule
    // can safely skip its own existence check (still the SAME flow, same function, no bypass).
    expect(HANDLER).toMatch(/await openDevelopmentModule\(clientTopic, \{ knownNew: true \}\)/);
    expect(HANDLER).toMatch(/id: row\.id/);
    expect(HANDLER).toMatch(/lastInterviewId: row\.last_interview_id \|\| null/);
  });
  it("5. makes NO AI call itself (only openDevelopmentModule may, and only when generating)", () => {
    expect(HANDLER).not.toMatch(/callClaude/);
  });
  it("mirrors the new topic into local classroom state so a repeat click reuses it", () => {
    expect(HANDLER).toMatch(/setClassroom\(\(prev\) => \[\.\.\.prev, clientTopic\]\)/);
  });
  it("fails safe (no row) without opening a module, restoring the screen it moved to for immediate feedback", () => {
    expect(HANDLER).toMatch(/if \(!row\) \{\s*\n\s*setGenProgress\(null\);\s*\n\s*setError\([^)]*\);\s*\n\s*setScreen\("classroom"\);\s*\n\s*return;\s*\n\s*\}/);
  });
});

/* ============================== preparation vs demonstrated ============================== */
describe("a recommendation-materialised topic is an area to prepare, never a demonstrated weakness", () => {
  it("last_interview_id null -> openDevelopmentModule's `demonstrated` flag is false -> 'AREA TO PREPARE' prompt branch", () => {
    const open = slice("async function openDevelopmentModule(topic, opts = {})", "// ---- deterministic sub-activities");
    expect(open).toMatch(/const demonstrated = !!topic\.lastInterviewId;/);
    expect(open).toMatch(/this is an AREA TO PREPARE for this application; it is NOT a demonstrated weakness/);
  });
  it("statusFor treats an empty/absent score as neutral 'To start', never red 'Needs work'", () => {
    const sf = slice("function statusFor(scores) {", "function candidateLevel()");
    expect(sf).toMatch(/const latest = Array\.isArray\(scores\) && scores\.length \? scores\[scores\.length - 1\] : null;/);
    expect(sf).toMatch(/if \(latest == null\) return \{ label: "To start"/);
  });
  it("the nav 'needs work' badge counts only interview-evidenced topics", () => {
    expect(SRC).toMatch(/classroom\.filter\(\(t\) => \(t\.scores \|\| \[\]\)\.length > 0 && statusFor\(t\.scores\)\.label !== "Mastered"\)\.length/);
  });
  it("the 'From your interviews' section only lists interview-evidenced topics", () => {
    expect(SRC).toMatch(/const interviewClassroom = classroom\.filter\(\(t\) => \(\(t\.scores \|\| \[\]\)\.length > 0\) \|\| t\.lastInterviewId\)/);
    expect(SRC).toMatch(/interviewClassroom\.length === 0 \? \(/);
    expect(SRC).toMatch(/\[\.\.\.interviewClassroom\]\.sort\(/);
  });
});

/* ============================== application isolation ============================== */
describe("application isolation", () => {
  it("the recommendation-card match filter rejects topics from other applications", () => {
    expect(SRC).toMatch(/if \(t\.applicationId && activeClassroomApp && t\.applicationId !== activeClassroomApp\.id\) return false;/);
  });
  it("openDevelopmentModule reads applicationIntelligence from the topic's OWN application only", () => {
    const open = slice("async function openDevelopmentModule(topic, opts = {})", "// ---- deterministic sub-activities");
    expect(open).toMatch(/applications\.find\(\(a\) => a\.id === topic\.applicationId\)\?\.applicationIntelligence/);
  });
});

/* ============================== existing diagnosed-topic flow unchanged ============================== */
describe("the interview-diagnosed topic flow is untouched", () => {
  it("pushClassroomTopics still creates topics from interview diagnosis with an initial_score", () => {
    const push = slice("async function pushClassroomTopics(topics, ctx)", "async function applyPerformanceUpdate");
    expect(push).toMatch(/dbUpsertClassroomTopic\(/);
    expect(push).toMatch(/initial_score/);
    expect(push).not.toMatch(/dbCreateRecommendationTopic/);
  });
  it("dbUpsertClassroomTopic (the interview path) is unchanged — still appends a score", () => {
    const up = slice("async function dbUpsertClassroomTopic(userId", "async function dbInsertClassroomLesson");
    expect(up).toMatch(/\[\.\.\.\(\(current && current\.scores\) \|\| \[\]\), topic\.initial_score \|\| 0\]/);
    expect(up).toMatch(/scores: \[topic\.initial_score \|\| 0\]/);
  });
  it("the learning-areas card still opens the module for a diagnosed topic", () => {
    expect(SRC).toMatch(/onClick=\{\(\) => guarded\(\(\) => openDevelopmentModule\(t\)\)\}/);
  });
});

/* ============================== legacy / null safety ============================== */
describe("legacy / null safety", () => {
  it("handler no-ops without a recommendation, user or app", () => {
    expect(HANDLER).toMatch(/if \(!rec \|\| !rec\.label \|\| !user \|\| !app\) return;/);
  });
  it("the interviewClassroom filter tolerates a topic with undefined scores", () => {
    expect(SRC).toMatch(/\(t\.scores \|\| \[\]\)\.length > 0/);
  });
  it("clientTopic coerces row fields defensively", () => {
    expect(HANDLER).toMatch(/scores: Array\.isArray\(row\.scores\) \? row\.scores : \[\]/);
    expect(HANDLER).toMatch(/applicationId: row\.application_id \|\| null/);
  });
});
