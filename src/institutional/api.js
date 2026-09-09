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

/* ---------- Performance -> intervention workflow -------------- *
 * eki_readiness_roster is authorised, institution-scoped, per-student
 * readiness classification for the careers-team drill-in. It is NOT
 * k-anonymised (it is the authorised individual-identification workflow,
 * gated exactly like eki_student_briefing) but the aggregate `distribution`
 * carries `suppressed` when fewer than MIN_COHORT_N students are assessed.
 */
export async function getReadinessRoster(institutionId, filters) {
  return rpc("eki_readiness_roster", {
    p_institution_id: institutionId,
    p_cohort_ids: filters?.cohortIds || null,
    p_from: filters?.from || null,
    p_to: filters?.to || null,
  });
}

/** The Student Careers Profile for a student with no appointment yet (roster drill-in). */
export async function getStudentSnapshot(institutionId, studentId) {
  return rpc("eki_student_snapshot", { p_institution_id: institutionId, p_student_id: studentId });
}

/** Staff sends a student an invitation into an existing open slot. */
export async function inviteToAppointment({ slotId, studentId, appointmentTypeId, message, applicationId }) {
  return rpc("eki_invite_to_appointment", {
    p_slot_id: slotId,
    p_student_id: studentId,
    p_appointment_type_id: appointmentTypeId || null,
    p_message: message || null,
    p_application_id: applicationId || null,
  });
}

/** Staff sends a student-facing careers message (never adviser notes / analytics). */
export async function sendCareersMessage({ institutionId, studentId, body, relatedAppointmentId }) {
  return rpc("send_careers_message", {
    p_institution_id: institutionId,
    p_student_id: studentId,
    p_body: body,
    p_related_appointment_id: relatedAppointmentId || null,
  });
}

/** Staff-side: the messages already sent to one student (for the profile). */
export async function listStudentMessages(institutionId, studentId) {
  const data = await rpc("eki_list_student_messages", { p_institution_id: institutionId, p_student_id: studentId });
  return Array.isArray(data) ? data : [];
}

/* ---------- Intelligence platform ---------------------------- *
 * One deterministic per-student engine (eki_student_intelligence) powers
 * No-Contact / Stuck / trajectory / movement. Programme pulse + follow-up
 * queue are separate k-anonymised / staff-authorised aggregates. All
 * institution-scoped, all self-authorising in SQL.
 */
export async function getStudentIntelligence(institutionId, filters) {
  return rpc("eki_student_intelligence", {
    p_institution_id: institutionId,
    p_cohort_ids: filters?.cohortIds || null,
    p_from: filters?.from || null,
    p_to: filters?.to || null,
  });
}
export async function getProgrammePulse(institutionId, filters) {
  return rpc("eki_programme_pulse", {
    p_institution_id: institutionId,
    p_from: filters?.from || null,
    p_to: filters?.to || null,
  });
}
export async function getFollowUpQueue(institutionId, filters) {
  const data = await rpc("eki_follow_up_queue", {
    p_institution_id: institutionId,
    p_cohort_ids: filters?.cohortIds || null,
  });
  return Array.isArray(data) ? data : [];
}
export async function listResources(institutionId, competency, careerPath) {
  const data = await rpc("list_resources", {
    p_institution_id: institutionId || null,
    p_competency: competency || null,
    p_career_path: careerPath || null,
  });
  return Array.isArray(data) ? data : [];
}

/* ---------- Development plans (staff writes) ----------------- */
export async function saveDevelopmentPlan(args) { return rpc("save_development_plan", args); }
export async function setDevelopmentPlanStatus(planId, status) {
  return rpc("set_development_plan_status", { p_plan_id: planId, p_status: status });
}
export async function upsertDevelopmentPlanItem({ planId, kind, label, itemId, status }) {
  return rpc("upsert_development_plan_item", {
    p_plan_id: planId, p_kind: kind, p_label: label, p_item_id: itemId || null, p_status: status || "todo",
  });
}
export async function markFollowUpDone(appointmentId) {
  return rpc("mark_follow_up_done", { p_appointment_id: appointmentId });
}
export async function saveAdviserBriefing(args) { return rpc("save_adviser_briefing", args); }

/* ---------- AI Careers Adviser Briefing (optional) ---------- *
 * Thin synthesis via an Edge Function. Re-authorises via
 * eki_student_snapshot server-side. Returns { ok:false, reason } when AI
 * is not configured / fails — the caller keeps its deterministic briefing.
 */
export async function requestAdviserBriefing({ institutionId, studentId }) {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.functions.invoke("eki-adviser-briefing", {
      body: { institution_id: institutionId, student_id: studentId },
    });
    if (error) return { ok: false, reason: "unavailable" };
    return data && typeof data === "object" ? data : { ok: false, reason: "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
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

/* ---------- Careers Appointments (EKI² side) -------------------- *
 * The student-facing half (booking) lives in src/careersAppointments.jsx,
 * which talks to Supabase through this same client.
 */

/** The careers-team schedule for an institution in a time window. */
export async function listInstitutionAppointments(institutionId, { from, to, statuses } = {}) {
  const data = await rpc("list_institution_appointments", {
    p_institution_id: institutionId,
    p_from: from || null,
    p_to: to || null,
    p_statuses: statuses && statuses.length ? statuses : null,
  });
  return Array.isArray(data) ? data : [];
}

/** The focused, authorised student intelligence briefing for one appointment. */
export async function getStudentBriefing(appointmentId) {
  return rpc("eki_student_briefing", { p_appointment_id: appointmentId });
}

/**
 * The full Student Careers Profile for an appointment: current snapshot
 * (Interview DNA, patterns, application), the current appointment's own
 * outcome, the previous-support context block, chronological appointment
 * history and factual longitudinal statements. Double-gated + institution
 * scoped server-side.
 */
export async function getStudentCareersProfile(appointmentId) {
  return rpc("eki_student_careers_profile", { p_appointment_id: appointmentId });
}

/** Create or update this appointment's adviser outcome record (staff only). */
export async function saveAppointmentOutcome(rpcArgs) {
  return rpc("save_appointment_outcome", rpcArgs);
}

/** owner/admin/staff: mark an appointment completed / no_show / cancelled. */
export async function setAppointmentStatus(appointmentId, status) {
  return rpc("set_appointment_status", { p_appointment_id: appointmentId, p_status: status });
}

/** Availability the signed-in staff member has published (their own slots). */
export async function listMySlots(institutionId, userId) {
  return selectRows("appointment_slots", (q) =>
    q.eq("institution_id", institutionId).eq("staff_id", userId).order("starts_at", { ascending: true })
  );
}

/** owner/admin: every slot in the institution (all advisers). */
export async function listAllSlots(institutionId) {
  return selectRows("appointment_slots", (q) =>
    q.eq("institution_id", institutionId).order("starts_at", { ascending: true })
  );
}

export async function listInstitutionAppointmentTypes(institutionId) {
  const data = await rpc("list_appointment_types", { p_institution_id: institutionId });
  return Array.isArray(data) ? data : [];
}

/** Publish an availability slot (RLS: staff, own slots). */
export async function createSlot(institutionId, userId, { startsAt, endsAt, appointmentTypeId, note }) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("appointment_slots").insert({
    institution_id: institutionId,
    staff_id: userId,
    appointment_type_id: appointmentTypeId || null,
    starts_at: startsAt,
    ends_at: endsAt,
    note: note || null,
    created_by: userId,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

/** Remove an open slot the staff member owns. */
export async function deleteSlot(slotId) {
  const supabase = await getSupabase();
  const { error } = await supabase.from("appointment_slots").delete().eq("id", slotId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
