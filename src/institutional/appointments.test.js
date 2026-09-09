import { describe, it, expect } from "vitest";
import {
  statusMeta, groupAppointmentsByDay, splitUpcomingPast, shapeBriefing,
  deriveBriefingSummary, repeatedDevelopmentSentence, trendSentence,
  timeRange, dateTimeLabel,
  shapeCareersProfile, previousSupportModel, longitudinalStatement,
  outcomeFormValues, outcomeFormToRpcArgs,
} from "./appointments.js";

/* A realistic eki_student_briefing envelope (shape captured from the live RPC). */
const BRIEFING = {
  generated_at: "2026-09-09T12:00:00Z",
  target: 70,
  recent_window: 3,
  student: { name: "Demo Student 1-4", institution_name: "Northgate University (demo)", cohorts: ["Finance & Consulting 2026"] },
  appointment: {
    id: "ap1", status: "booked", type_label: "Interview preparation",
    starts_at: "2026-09-12T13:00:00Z", ends_at: "2026-09-12T13:30:00Z",
    student_comment: "I have a Goldman Sachs interview and want help with commercial awareness.",
  },
  application: {
    company: "Goldman Sachs", role: "Global Markets Summer Analyst", stage: "First Round",
    interview_date: "2026-09-20T09:00:00Z", created_at: "2026-08-01T00:00:00Z", practice_interviews: 2,
  },
  interview_dna: {
    n_completed_interviews: 3, has_enough_data: true, overall_mean: 58,
    dimensions: [
      { key: "relevance", mean: 66, n_answers: 12, band: "developing", below_target: true },
      { key: "communication", mean: 72, n_answers: 12, band: "solid", below_target: false },
      { key: "structure", mean: 61, n_answers: 12, band: "developing", below_target: true },
      { key: "specificity", mean: 52, n_answers: 12, band: "developing", below_target: true },
      { key: "competency_demonstration", mean: 49, n_answers: 12, band: "priority", below_target: true },
      { key: "evidence", mean: 44, n_answers: 12, band: "priority", below_target: true },
    ],
    strengths: [{ key: "communication", mean: 72 }],
    development_areas: [{ key: "evidence", mean: 44 }, { key: "competency_demonstration", mean: 49 }, { key: "specificity", mean: 52 }],
  },
  patterns: {
    repeated_development_area: { key: "evidence", overall_mean: 44, recent_mean: 41, recent_interviews: 3 },
    performance_trend: { first: 49, latest: 65, delta: 16, n_interviews: 3 },
    hardest_question_category: { key: "commercial_awareness", mean: 46, n_answers: 9 },
  },
};

const EMPTY_BRIEFING = {
  target: 70,
  student: { name: "New Student", institution_name: "Northgate University (demo)", cohorts: [] },
  appointment: { id: "ap2", status: "booked", type_label: "Career guidance", starts_at: null, student_comment: null },
  application: null,
  interview_dna: { n_completed_interviews: 0, has_enough_data: false, overall_mean: null, dimensions: [], strengths: [], development_areas: [] },
  patterns: { repeated_development_area: null, performance_trend: null, hardest_question_category: null },
};

describe("statusMeta / schedule grouping", () => {
  it("maps every status", () => {
    expect(statusMeta("booked")).toEqual({ label: "Booked", tone: "info" });
    expect(statusMeta("no_show").label).toBe("No-show");
    expect(statusMeta("junk").label).toBe("junk");
  });
  it("groups appointments by day, sorted", () => {
    const g = groupAppointmentsByDay([
      { id: 1, starts_at: "2026-09-12T13:00:00Z" },
      { id: 2, starts_at: "2026-09-12T09:00:00Z" },
      { id: 3, starts_at: "2026-09-10T10:00:00Z" },
    ]);
    expect(g.map((x) => x.key)).toEqual(["2026-09-10", "2026-09-12"]);
    expect(g[1].items.map((i) => i.id)).toEqual([2, 1]);
  });
  it("splitUpcomingPast keeps only future booked in upcoming", () => {
    const soon = new Date(Date.now() + 86400e3).toISOString();
    const old = new Date(Date.now() - 86400e3).toISOString();
    const { upcoming, past } = splitUpcomingPast([
      { id: 1, status: "booked", starts_at: soon },
      { id: 2, status: "completed", starts_at: old },
      { id: 3, status: "booked", starts_at: old },
    ]);
    expect(upcoming.map((a) => a.id)).toEqual([1]);
    expect(past.map((a) => a.id).sort()).toEqual([2, 3]);
  });
});

describe("shapeBriefing", () => {
  const s = shapeBriefing(BRIEFING);
  it("normalises student + appointment + application", () => {
    expect(s.student.name).toBe("Demo Student 1-4");
    expect(s.student.cohorts).toEqual(["Finance & Consulting 2026"]);
    expect(s.appointment.typeLabel).toBe("Interview preparation");
    expect(s.application.company).toBe("Goldman Sachs");
    expect(s.application.practiceInterviews).toBe(2);
  });
  it("labels the six DNA dimensions and splits strengths / development", () => {
    expect(s.dna.dimensions).toHaveLength(6);
    expect(s.dna.dimensions[0]).toMatchObject({ key: "relevance", label: "Relevance", tone: "warn" });
    expect(s.dna.strengths.map((x) => x.label)).toEqual(["Communication"]);
    expect(s.dna.development.map((x) => x.label)).toEqual(["Evidence", "Competency demonstration", "Specificity"]);
  });
  it("carries the pattern blocks", () => {
    expect(s.patterns.repeatedDevelopmentArea.label).toBe("Evidence");
    expect(s.patterns.performanceTrend.delta).toBe(16);
    expect(s.patterns.hardestCategory.label).toMatch(/commercial/i);
  });
  it("returns null for junk", () => {
    expect(shapeBriefing(null)).toBeNull();
  });
});

describe("deriveBriefingSummary", () => {
  it("picks the weakest dev area, strongest area, application + reason — all from data", () => {
    const sum = deriveBriefingSummary(shapeBriefing(BRIEFING));
    expect(sum.hasData).toBe(true);
    expect(sum.primaryDevelopmentArea).toMatchObject({ label: "Evidence", mean: 44, target: 70 });
    expect(sum.strongestArea).toMatchObject({ label: "Communication", mean: 72 });
    expect(sum.relevantApplication).toMatchObject({ company: "Goldman Sachs" });
    expect(sum.studentReason).toMatch(/commercial awareness/);
    expect(sum.repeatedConcern).toBe("Evidence");
  });
  it("degrades to nulls (no fabrication) when there is no interview data", () => {
    const sum = deriveBriefingSummary(shapeBriefing(EMPTY_BRIEFING));
    expect(sum.hasData).toBe(false);
    expect(sum.primaryDevelopmentArea).toBeNull();
    expect(sum.strongestArea).toBeNull();
    expect(sum.relevantApplication).toBeNull();
    expect(sum.repeatedConcern).toBeNull();
    // the student's stated reason is the only thing shown when it exists; here it's null
    expect(sum.studentReason).toBeNull();
  });
});

describe("pattern sentences are literal restatements or null", () => {
  it("repeated-development sentence quotes the numbers", () => {
    const s = repeatedDevelopmentSentence(shapeBriefing(BRIEFING));
    expect(s).toContain("Evidence has been below target across the student's last 3 interviews");
    expect(s).toContain("recent average 41");
    expect(s).toContain("overall 44");
  });
  it("trend sentence quotes first -> latest", () => {
    const s = trendSentence(shapeBriefing(BRIEFING));
    expect(s).toMatch(/risen by 16 points/);
    expect(s).toContain("49 → 65");
  });
  it("both are null when the pattern is absent", () => {
    const s = shapeBriefing(EMPTY_BRIEFING);
    expect(repeatedDevelopmentSentence(s)).toBeNull();
    expect(trendSentence(s)).toBeNull();
  });
});

describe("time helpers", () => {
  it("timeRange / dateTimeLabel are deterministic", () => {
    expect(timeRange("2026-09-12T13:00:00Z", "2026-09-12T13:30:00Z")).toMatch(/\d{2}:\d{2} – \d{2}:\d{2}/);
    expect(dateTimeLabel("2026-09-12T13:00:00Z")).toMatch(/\w+ \d+ \w+ · \d{2}:\d{2}/);
    expect(dateTimeLabel(null)).toBe("");
  });
});

/* ================================================================= *
 * CAREERS RELATIONSHIP HISTORY
 * ================================================================= */
const PROFILE_RAW = {
  ...BRIEFING,
  current_outcome: {
    discussed: "Structured practice plan.", actions_agreed: "Do 3 mock interviews.",
    next_steps: "Book a follow-up.", follow_up_required: true, follow_up_notes: "In 2 weeks",
    created_at: "2026-08-01T10:00:00Z", updated_at: "2026-08-02T09:00:00Z", updated_by_name: "A. Adviser",
  },
  previous_support: {
    appointment_id: "prev1", starts_at: "2026-08-10T13:00:00Z", days_ago: 30,
    type_label: "Interview preparation", adviser_name: "A. Adviser", status: "completed",
    student_comment: "Struggling with commercial awareness",
    key_development_area: "evidence", has_outcome: true,
    actions_agreed: "Read the FT markets page daily.", next_steps: "Book a mock.", follow_up_required: true,
  },
  history: [
    { appointment_id: "h2", starts_at: "2026-08-10T13:00:00Z", status: "completed", type_label: "Interview preparation",
      adviser_name: "A. Adviser", student_comment: "commercial awareness", has_outcome: true,
      discussed: "Worked through 3 CA questions.", actions_agreed: "Read the FT.", next_steps: "Book a mock.",
      follow_up_required: true, follow_up_notes: "after the final", outcome_updated_at: "2026-08-10T14:00:00Z", outcome_by: "A. Adviser" },
    { appointment_id: "h1", starts_at: "2026-07-01T09:00:00Z", status: "completed", type_label: "Career guidance",
      adviser_name: "B. Adviser", student_comment: "nervous about IB", has_outcome: false,
      discussed: null, actions_agreed: null, next_steps: null, follow_up_required: false, follow_up_notes: null },
  ],
  longitudinal: [
    { kind: "interview_score_change_after_intervention", prior_appointment_id: "h2", prior_date: "2026-08-10T13:00:00Z",
      prior_type: "Interview preparation", before_mean: 49, after_mean: 61, delta: 12, n_before: 1, n_after: 2 },
  ],
};

describe("shapeCareersProfile", () => {
  const s = shapeCareersProfile(PROFILE_RAW);
  it("is a superset of the briefing shape (dna, patterns, application all still there)", () => {
    expect(s.dna.dimensions).toHaveLength(6);
    expect(s.application.company).toBe("Goldman Sachs");
    expect(s.patterns.performanceTrend.delta).toBe(16);
  });
  it("normalises the current appointment's own outcome for the form", () => {
    expect(s.currentOutcome).toMatchObject({ discussed: "Structured practice plan.", followUpRequired: true, updatedByName: "A. Adviser" });
  });
  it("keeps history in the order given (reverse-chronological from the RPC) and flags has_outcome", () => {
    expect(s.history.map((h) => h.appointmentId)).toEqual(["h2", "h1"]);
    expect(s.history[0].hasOutcome).toBe(true);
    expect(s.history[1].hasOutcome).toBe(false);
    expect(s.history[0].discussed).toMatch(/3 CA questions/);
  });
  it("shapes previous_support and longitudinal", () => {
    expect(s.previousSupport).toMatchObject({ appointmentId: "prev1", daysAgo: 30, keyDevelopmentArea: "Evidence", followUpRequired: true });
    expect(s.longitudinal[0]).toMatchObject({ delta: 12, nBefore: 1, nAfter: 2 });
  });
  it("returns null for junk", () => {
    expect(shapeCareersProfile(null)).toBeNull();
  });
});

describe("previousSupportModel — the 'Previous careers support' block", () => {
  it("builds factual rows: last appointment / focus / key dev area / action / follow-up", () => {
    const m = previousSupportModel(shapeCareersProfile(PROFILE_RAW));
    const labels = m.rows.map((r) => r.label);
    expect(labels).toEqual(expect.arrayContaining(["Last appointment", "Focus", "Key development area then", "Action agreed", "Follow-up required"]));
    expect(m.rows.find((r) => r.label === "Last appointment").value).toMatch(/30 days ago/);
    expect(m.rows.find((r) => r.label === "Follow-up required").value).toBe("Yes");
    expect(m.studentComment).toMatch(/commercial awareness/);
  });
  it("is null when there is no previous appointment (never fabricated)", () => {
    expect(previousSupportModel(shapeCareersProfile({ ...PROFILE_RAW, previous_support: null }))).toBeNull();
  });
});

describe("longitudinalStatement — factual, never causal", () => {
  it("states the change following the previous recorded intervention, with counts", () => {
    const l = shapeCareersProfile(PROFILE_RAW).longitudinal[0];
    const s = longitudinalStatement(l);
    expect(s).toBe("Interview performance increased by 12 points following the previous recorded intervention "
      + "(mean 49 across 1 interview before, 61 across 2 after).");
    expect(s).not.toMatch(/caused|because|led to|thanks to/i);
  });
  it("null when there is no delta", () => {
    expect(longitudinalStatement(null)).toBeNull();
    expect(longitudinalStatement({ delta: null })).toBeNull();
  });
});

describe("outcome form helpers", () => {
  it("prefills from the current outcome, or blanks when none", () => {
    expect(outcomeFormValues(shapeCareersProfile(PROFILE_RAW))).toMatchObject({ discussed: "Structured practice plan.", followUpRequired: true });
    expect(outcomeFormValues(shapeCareersProfile({ ...PROFILE_RAW, current_outcome: null })))
      .toEqual({ discussed: "", actionsAgreed: "", nextSteps: "", followUpRequired: false, followUpNotes: "" });
  });
  it("maps to RPC args, trimming empties to null", () => {
    expect(outcomeFormToRpcArgs("ap1", { discussed: "  x ", actionsAgreed: "", nextSteps: "  ", followUpRequired: true, followUpNotes: "note" }))
      .toEqual({ p_appointment_id: "ap1", p_discussed: "x", p_actions_agreed: null, p_next_steps: null, p_follow_up_required: true, p_follow_up_notes: "note" });
  });
});
