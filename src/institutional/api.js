/* ================================================================== *
 * INSTITUTIONAL INSIGHTS — data-access layer
 * ------------------------------------------------------------------
 * The ONLY module in the institutional tree that talks to Supabase.
 * Everything the dashboard needs is a function here. Two shapes:
 *
 *   1. Config reads/writes — plain PostgREST table calls on the new
 *      institutional tables. RLS restricts these to the caller's own
 *      institution(s); the client never sees another institution's rows.
 *
 *   2. Analytics reads — SECURITY DEFINER `inst_*` RPCs (added in
 *      Milestone 2). They verify institution-staff membership, join into
 *      the existing student tables, and return ONLY k-anonymised
 *      aggregates (never a raw student row, never a transcript).
 *
 * No aggregation logic lives here — see analytics.js for pure shaping.
 * ================================================================== */

import { getSupabase } from "./supabaseClient.js";

/* ---------- helpers ------------------------------------------------ */
async function rpc(name, args) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc(name, args || {});
  if (error) throw new Error(error.message || `${name} failed`);
  return data;
}

async function selectRows(table, build) {
  const supabase = await getSupabase();
  let q = supabase.from(table).select("*");
  if (build) q = build(q);
  const { data, error } = await q;
  if (error) throw new Error(error.message || `read ${table} failed`);
  return Array.isArray(data) ? data : [];
}

/* ---------- identity / access ----------------------------------- */

/** The institutions the signed-in user is staff for, with their role. */
export async function getMyInstitutions() {
  const data = await rpc("get_my_institutions");
  return Array.isArray(data) ? data : [];
}

/* ---------- org structure (config) ---------------------------- */

export async function listOrganisations(institutionId) {
  return selectRows("institution_organisations", (q) =>
    q.eq("institution_id", institutionId).order("name", { ascending: true })
  );
}

export async function listCohorts(institutionId) {
  return selectRows("cohorts", (q) =>
    q.eq("institution_id", institutionId).order("created_at", { ascending: false })
  );
}

/**
 * Cohort membership rows for the institution (staff-readable via RLS).
 * Returned flat; analytics.js groups them. Includes `invited_email` rows
 * that have not yet been linked to a JOB.READY account.
 */
export async function listCohortMembers(institutionId) {
  const supabase = await getSupabase();
  const { data: cohorts, error: cErr } = await supabase
    .from("cohorts").select("id").eq("institution_id", institutionId);
  if (cErr) throw new Error(cErr.message);
  const ids = (cohorts || []).map((c) => c.id);
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("cohort_members").select("*").in("cohort_id", ids);
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

/** owner/admin: create a cohort. */
export async function createCohort(institutionId, { name, organisationId, academicYear, graduationYear }) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("cohorts").insert({
    institution_id: institutionId,
    organisation_id: organisationId || null,
    name,
    academic_year: academicYear || null,
    graduation_year: graduationYear || null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

/** owner/admin: create an organisation / society. */
export async function createOrganisation(institutionId, { name, kind }) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("institution_organisations").insert({
    institution_id: institutionId, name, kind: kind || "other",
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * owner/admin: add students to a cohort by email. Rows whose email already
 * matches a JOB.READY profile are linked immediately by
 * inst_reconcile_cohort_members(); the rest sit as 'invited' until that
 * person signs up. Returns { added, linked }.
 */
export async function addCohortMembersByEmail(institutionId, cohortId, emails, addedBy) {
  const supabase = await getSupabase();
  const clean = [...new Set(
    (emails || [])
      .map((e) => String(e || "").trim().toLowerCase())
      .filter((e) => e.includes("@") && e.length >= 3 && e.length <= 320)
  )];
  if (!clean.length) return { added: 0, linked: 0 };

  // The (cohort_id, lower(invited_email)) uniqueness is a PARTIAL index, which
  // PostgREST's upsert cannot infer — so de-dupe against what's already there
  // (by invited_email OR by an already-linked student's email) and plain-insert
  // the rest. Two staff adding the same email concurrently is a rare, tolerable
  // 23505 the caller surfaces.
  const { data: existing, error: exErr } = await supabase
    .from("cohort_members").select("invited_email, student_id").eq("cohort_id", cohortId);
  if (exErr) throw new Error(exErr.message);
  const taken = new Set(
    (existing || []).map((r) => (r.invited_email || "").toLowerCase()).filter(Boolean)
  );
  const toInsert = clean.filter((e) => !taken.has(e));

  let added = 0;
  if (toInsert.length) {
    const rows = toInsert.map((email) => ({
      cohort_id: cohortId, invited_email: email, status: "invited", added_by: addedBy || null,
    }));
    const { data, error } = await supabase.from("cohort_members").insert(rows).select();
    if (error) throw new Error(error.message);
    added = Array.isArray(data) ? data.length : 0;
  }

  // Link any of these that already have a JOB.READY account.
  const { linked } = await reconcileCohortMembers(institutionId);
  return { added, linked };
}

/** owner/admin: link any newly-registered students to their pending memberships. */
export async function reconcileCohortMembers(institutionId) {
  const res = await rpc("inst_reconcile_cohort_members", { p_institution_id: institutionId });
  return { ok: !!res?.ok, linked: Number(res?.linked || 0) };
}

/* ---------- analytics (Milestone 2 — inst_* RPCs) ------------- *
 * Declared here so the dashboard imports a stable surface. Until the
 * Milestone 2 migration lands, each returns a typed "unsupported"
 * envelope rather than throwing, so the shell renders cleanly.
 */
const NOT_YET = (metric) => ({ supported: false, metric, reason: "analytics_engine_pending", data: null });

export async function getOverview(institutionId, filters) {
  return callAnalytics("inst_overview", institutionId, filters, "overview");
}
export async function getPerformance(institutionId, filters) {
  return callAnalytics("inst_performance", institutionId, filters, "performance");
}
export async function getCompetencies(institutionId, filters) {
  return callAnalytics("inst_competencies", institutionId, filters, "competencies");
}
export async function getCareerInsights(institutionId, filters) {
  return callAnalytics("inst_career_insights", institutionId, filters, "career_insights");
}
export async function getQuestionPerformance(institutionId, filters) {
  return callAnalytics("inst_question_performance", institutionId, filters, "question_performance");
}
export async function getDevelopmentAreas(institutionId, filters) {
  return callAnalytics("inst_development_areas", institutionId, filters, "development_areas");
}
export async function getImprovement(institutionId, filters) {
  return callAnalytics("inst_improvement", institutionId, filters, "improvement");
}

/**
 * Every analytics section in one parallel round of RPCs — used by the Overview,
 * which synthesises across sections. Returns a keyed map; a per-section failure
 * is isolated (that key holds an { supported:false } stub), the rest still load.
 */
export async function getAllAnalytics(institutionId, filters) {
  const jobs = {
    overview: getOverview, performance: getPerformance, competencies: getCompetencies,
    career: getCareerInsights, questions: getQuestionPerformance,
    developmentAreas: getDevelopmentAreas, improvement: getImprovement,
  };
  const entries = await Promise.all(
    Object.entries(jobs).map(async ([k, fn]) => {
      try { return [k, await fn(institutionId, filters)]; }
      catch (e) { return [k, { supported: false, error: e.message || "failed", reason: "section_error" }]; }
    })
  );
  return Object.fromEntries(entries);
}

async function callAnalytics(fnName, institutionId, filters, metric) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc(fnName, {
    p_institution_id: institutionId,
    p_cohort_ids: filters?.cohortIds || null,
    p_from: filters?.from || null,
    p_to: filters?.to || null,
  });
  if (error) {
    // A missing function (Milestone 2 not deployed) -> graceful "unsupported",
    // not a hard failure. Any other error is real and should surface.
    if (/could not find the function|does not exist|schema cache/i.test(error.message || "")) {
      return NOT_YET(metric);
    }
    throw new Error(error.message || `${fnName} failed`);
  }
  return data;
}
