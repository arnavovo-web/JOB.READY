-- =============================================================================
-- INSTITUTIONAL INSIGHTS — MILESTONE 2: ANALYTICS ENGINE
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER `inst_*` RPCs that turn the EXISTING JOB.READY student
-- interview data into aggregated, k-anonymised employability intelligence for
-- an institution's staff. They never expose a raw student row, an answer, a
-- transcript or an identifiable individual — every returned figure is an
-- aggregate over a set of students, and any group with fewer than
-- `c_min_n` (= 5) distinct contributing students is withheld.
--
-- WHAT EACH RPC RETURNS
--   A single jsonb envelope: { supported, min_n, scope, generated_at,
--   <metric-specific aggregates>, limitations[] }. The browser passes the
--   aggregates to src/institutional/insights.js, which DERIVES the plain-English
--   findings ("Commercial awareness is the cohort's largest development
--   opportunity") — deterministically, from these numbers only, never a causal
--   or invented claim. Keeping the wording layer in JS makes it unit-testable
--   without a database.
--
-- ARGUMENTS (all RPCs): (p_institution_id uuid, p_cohort_ids uuid[] default
--   null, p_from timestamptz default null, p_to timestamptz default null).
--   p_cohort_ids null => every cohort in the institution. Date filter applies
--   to interviews.completed_at (fallback created_at).
--
-- ACCESS: jr_inst_scope_student_ids() raises 42501 unless the caller is
--   institution_staff for p_institution_id (any role). Analyst/viewer and
--   owner/admin all read the same aggregates.
--
-- AGGREGATION RULES (documented so the numbers are defensible)
--   * "Completed interview" = interviews.status = 'completed'.
--   * Overall interview score = coalesce(interview_reports.overall_score,
--     interviews.overall_score).
--   * A competency dimension's cohort value = mean over students of
--     (that student's mean for the dimension across their completed-interview
--     answers) — i.e. every student weighted equally, so a student with many
--     interviews cannot dominate.
--   * Composite answer score = mean of the 6 evaluation sub-scores present.
--   * READINESS_TARGET = 70 (the "interview ready" band floor). "Below target"
--     / "development opportunity gap" is measured against this.
--   * MATERIAL_GAP = 4 points. A dimension is "materially below the cohort's
--     competency average" when its cohort value is >= MATERIAL_GAP below the
--     mean of all six dimension cohort values.
--   * IMPROVEMENT: computed PER STUDENT first (needs >= 2 completed interviews
--     in range), then aggregated. Never compares two arbitrary interviews.
--     A student's delta = (score of last interview) - (score of first).
--     `pct_improving` counts students with delta >= IMPROVE_EPS (= 3).
--
-- IDEMPOTENT: create or replace throughout. Purely additive. Timestamped after
-- 20260909120000_institutional_foundation.sql.
-- =============================================================================

-- =============================================================================
-- SHARED HELPERS
-- =============================================================================

-- Legacy -> canonical question category. Mirrors
-- src/institutional/taxonomy.js `canonicalCategory` and the student app's
-- methodology.js. Keep the two in sync.
create or replace function public.jr_canonical_category(p_category text)
returns text
language sql
immutable
set search_path to ''   -- touches no db objects; pins the advisory
as $$
  select case
    when p_category in (
      'motivation_fit','behavioural_competency','situational_judgement',
      'technical_functional','commercial_awareness','case_problem_solving'
    ) then p_category
    when p_category = 'cv_behavioural'  then 'behavioural_competency'
    when p_category in ('role_specific','technical') then 'technical_functional'
    else 'behavioural_competency'
  end;
$$;

-- Career-path family from a free-text role (+ company fallback). EXPLICIT,
-- DOCUMENTED heuristic — mirrors src/institutional/taxonomy.js
-- ROLE_FAMILIES / classifyRole. Returns a family key or 'unclassified'.
-- Keep the keyword lists in sync with taxonomy.js.
create or replace function public.jr_role_family(p_role text, p_company text)
returns text
language plpgsql
immutable
set search_path to ''   -- touches no db objects; pins the advisory
as $$
declare
  r text := lower(coalesce(p_role, ''));
  c text := lower(coalesce(p_company, ''));
begin
  if r = '' and c = '' then return 'unclassified'; end if;

  if r ~ '(investment bank|m&a|mergers|ibd|leveraged finance|dcm|ecm|coverage)' then return 'ib'; end if;
  if r ~ '(sales & trading|sales and trading|s&t|global markets|trading|trader|quant|structuring|fixed income|equities desk)' then return 'markets'; end if;
  if r ~ '(private equity|principal investment|buyout|growth equity|venture capital|private credit)' then return 'pe_pc'; end if;
  if r ~ '(asset management|wealth management|portfolio manag|investment management|fund manag)' then return 'am_wm'; end if;
  if r ~ '(consult|strategy&|advisory|business analyst)' then return 'consulting'; end if;
  if r ~ '(software engineer|software developer|swe|backend|frontend|full stack|full-stack|platform engineer|mobile engineer)' then return 'swe'; end if;
  if r ~ '(data scien|data analyst|machine learning|ml engineer|analytics|data engineer)' then return 'data'; end if;
  if r ~ '(product manager|product management|associate product|apm)' then return 'product'; end if;
  if r ~ '(financial analyst|corporate finance|fp&a|accounting|audit|treasury|actuar)' then return 'finance_corp'; end if;
  if r ~ '(marketing|brand|commercial graduate|sales graduate|account executive)' then return 'marketing'; end if;
  if r ~ '(operations|supply chain|graduate scheme|graduate programme|rotational|management trainee)' then return 'ops_grad'; end if;

  if c ~ '(goldman sachs|morgan stanley)' then return 'ib'; end if;
  if c ~ '(jpmorgan|j\.p\. morgan)' then return 'markets'; end if;
  if c ~ '(blackstone|kkr|apollo|carlyle)' then return 'pe_pc'; end if;
  if c ~ '(mckinsey|bain|bcg|boston consulting)' then return 'consulting'; end if;
  if c ~ '(google|meta|amazon|microsoft|netflix)' then return 'swe'; end if;

  return 'unclassified';
end;
$$;

-- Gate + resolve. Returns the DISTINCT set of student profile ids in scope
-- (linked, non-removed cohort members of the institution, optionally filtered
-- to p_cohort_ids). Raises 42501 if the caller is not staff for the institution.
create or replace function public.jr_inst_scope_student_ids(
  p_institution_id uuid,
  p_cohort_ids uuid[] default null
)
returns setof uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if public.jr_inst_role(p_institution_id) is null then
    raise exception 'not authorised for this institution' using errcode = '42501';
  end if;
  return query
    select distinct cm.student_id
      from public.cohort_members cm
      join public.cohorts c on c.id = cm.cohort_id
     where c.institution_id = p_institution_id
       and cm.student_id is not null
       and cm.status <> 'removed'
       and (p_cohort_ids is null or cm.cohort_id = any(p_cohort_ids));
end;
$$;

-- =============================================================================
-- 1) inst_overview
-- =============================================================================
create or replace function public.inst_overview(
  p_institution_id uuid,
  p_cohort_ids uuid[] default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c_min_n          constant int := 5;
  c_readiness_tgt  constant int := 70;
  v_students       uuid[];
  v_n_scope        int;
  v_result         jsonb;
begin
  select array_agg(s) into v_students from public.jr_inst_scope_student_ids(p_institution_id, p_cohort_ids) s;
  v_students := coalesce(v_students, '{}');
  v_n_scope := array_length(v_students, 1);

  with iv as (
    select i.id, i.user_id,
           coalesce(ir.overall_score, i.overall_score)::numeric as score,
           coalesce(ir.readiness, i.readiness) as readiness,
           coalesce(i.completed_at, i.created_at) as at
      from public.interviews i
      left join public.interview_reports ir on ir.interview_id = i.id
     where i.user_id = any(v_students)
       and i.status = 'completed'
       and (p_from is null or coalesce(i.completed_at, i.created_at) >= p_from)
       and (p_to   is null or coalesce(i.completed_at, i.created_at) <= p_to)
  ),
  per_student as (
    select user_id, avg(score) as mean_score, count(*) as ivs
      from iv where score is not null group by user_id
  ),
  readiness_roll as (
    -- a student's most recent readiness in range
    select distinct on (user_id) user_id, readiness
      from iv where readiness is not null order by user_id, at desc
  )
  select jsonb_build_object(
    'supported', true,
    'min_n', c_min_n,
    'generated_at', now(),
    'scope', jsonb_build_object(
      'institution_id', p_institution_id,
      'cohort_ids', to_jsonb(p_cohort_ids),
      'from', p_from, 'to', p_to,
      'students_in_scope', coalesce(v_n_scope, 0),
      'students_with_data', (select count(*) from per_student)
    ),
    'readiness_target', c_readiness_tgt,
    'activity', jsonb_build_object(
      'completed_interviews', (select count(*) from iv),
      'students_with_completed', (select count(*) from per_student),
      'coverage_pct', case when coalesce(v_n_scope,0) > 0
        then round(100.0 * (select count(*) from per_student) / v_n_scope) else null end,
      'avg_interviews_per_active_student', (select round(avg(ivs), 2) from per_student)
    ),
    'performance', case when (select count(*) from per_student) < c_min_n then
      jsonb_build_object('suppressed', true, 'reason', 'below_min_n',
                         'n', (select count(*) from per_student))
    else
      jsonb_build_object(
        'suppressed', false,
        'n_students', (select count(*) from per_student),
        'mean_overall', (select round(avg(mean_score)) from per_student),
        'median_overall', (select round(percentile_cont(0.5) within group (order by mean_score)) from per_student),
        'pct_at_or_above_target', (select round(100.0 * count(*) filter (where mean_score >= c_readiness_tgt) / count(*)) from per_student)
      )
    end,
    'readiness_mix', case when (select count(*) from readiness_roll) < c_min_n then
      jsonb_build_object('suppressed', true, 'reason', 'below_min_n', 'n', (select count(*) from readiness_roll))
    else
      (select jsonb_build_object('suppressed', false, 'n', count(*), 'buckets',
        jsonb_agg(jsonb_build_object('key', readiness, 'count', c) order by c desc))
       from (select readiness, count(*) c from readiness_roll group by readiness) q)
    end
  ) into v_result;

  return v_result;
end;
$$;

-- =============================================================================
-- 2) inst_performance — overall interview performance, splits, trend
-- =============================================================================
create or replace function public.inst_performance(
  p_institution_id uuid,
  p_cohort_ids uuid[] default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c_min_n constant int := 5;
  c_tgt   constant int := 70;
  v_students uuid[];
begin
  select array_agg(s) into v_students from public.jr_inst_scope_student_ids(p_institution_id, p_cohort_ids) s;
  v_students := coalesce(v_students, '{}');

  return (
  with iv as (
    select i.id, i.user_id, i.stage, i.format,
           coalesce(ir.overall_score, i.overall_score)::numeric as score,
           coalesce(ir.readiness, i.readiness) as readiness,
           coalesce(i.completed_at, i.created_at) as at
      from public.interviews i
      left join public.interview_reports ir on ir.interview_id = i.id
     where i.user_id = any(v_students) and i.status = 'completed' and coalesce(ir.overall_score, i.overall_score) is not null
       and (p_from is null or coalesce(i.completed_at, i.created_at) >= p_from)
       and (p_to   is null or coalesce(i.completed_at, i.created_at) <= p_to)
  ),
  per_student as (select user_id, avg(score) ms from iv group by user_id),
  bands as (
    select case when ms >= 75 then 'strong' when ms >= 60 then 'solid'
                when ms >= 45 then 'developing' else 'priority' end as band
      from per_student
  ),
  by_stage as (
    select coalesce(stage,'unspecified') stage, count(distinct user_id) ns, avg(score) ms
      from iv group by 1
  ),
  by_format as (
    select coalesce(format,'unspecified') format, count(distinct user_id) ns, avg(score) ms
      from iv group by 1
  ),
  by_month as (
    select to_char(date_trunc('month', at), 'YYYY-MM') ym,
           count(distinct user_id) ns, avg(score) ms
      from iv group by 1 order by 1
  )
  select jsonb_build_object(
    'supported', true, 'min_n', c_min_n, 'generated_at', now(), 'readiness_target', c_tgt,
    'scope', jsonb_build_object('institution_id', p_institution_id, 'cohort_ids', to_jsonb(p_cohort_ids),
      'from', p_from, 'to', p_to, 'students_in_scope', coalesce(array_length(v_students,1),0),
      'students_with_data', (select count(*) from per_student)),
    'overall', case when (select count(*) from per_student) < c_min_n then
        jsonb_build_object('suppressed', true, 'reason','below_min_n','n',(select count(*) from per_student))
      else jsonb_build_object('suppressed', false,
        'n_students', (select count(*) from per_student),
        'n_interviews', (select count(*) from iv),
        'mean', (select round(avg(ms)) from per_student),
        'median', (select round(percentile_cont(0.5) within group (order by ms)) from per_student),
        'p25', (select round(percentile_cont(0.25) within group (order by ms)) from per_student),
        'p75', (select round(percentile_cont(0.75) within group (order by ms)) from per_student),
        'pct_at_or_above_target', (select round(100.0*count(*) filter (where ms>=c_tgt)/count(*)) from per_student))
      end,
    'distribution', case when (select count(*) from per_student) < c_min_n then
        jsonb_build_object('suppressed', true, 'reason','below_min_n')
      else (select jsonb_build_object('suppressed', false, 'n', (select count(*) from per_student), 'buckets',
        jsonb_agg(jsonb_build_object('label', band, 'count', c)))
        from (select band, count(*) c from bands group by band) b)
      end,
    'by_stage', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', stage, 'n_students', ns,
        'mean', case when ns >= c_min_n then round(ms) else null end,
        'suppressed', ns < c_min_n) order by stage), '[]'::jsonb) from by_stage),
    'by_format', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', format, 'n_students', ns,
        'mean', case when ns >= c_min_n then round(ms) else null end,
        'suppressed', ns < c_min_n) order by format), '[]'::jsonb) from by_format),
    'trend_monthly', (select coalesce(jsonb_agg(jsonb_build_object(
        'month', ym, 'n_students', ns,
        'mean', case when ns >= c_min_n then round(ms) else null end,
        'suppressed', ns < c_min_n) order by ym), '[]'::jsonb) from by_month)
  ));
end;
$$;

-- =============================================================================
-- 3) inst_competencies — the six-dimension competency axis
-- =============================================================================
create or replace function public.inst_competencies(
  p_institution_id uuid,
  p_cohort_ids uuid[] default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c_min_n constant int := 5;
  c_tgt   constant int := 70;
  c_material constant numeric := 4;
  v_students uuid[];
begin
  select array_agg(s) into v_students from public.jr_inst_scope_student_ids(p_institution_id, p_cohort_ids) s;
  v_students := coalesce(v_students, '{}');

  return (
  with ans as (
    -- one row per scored answer on a completed, in-range interview
    select i.user_id,
           e.relevance, e.specificity, e.structure, e.evidence,
           e.clarity as communication, e.competency_demonstration
      from public.evaluations e
      join public.answers a            on a.id = e.answer_id
      join public.interview_questions q on q.id = a.question_id
      join public.interviews i         on i.id = q.interview_id
     where i.user_id = any(v_students) and i.status = 'completed'
       and (p_from is null or coalesce(i.completed_at, i.created_at) >= p_from)
       and (p_to   is null or coalesce(i.completed_at, i.created_at) <= p_to)
  ),
  long as (
    select user_id, 'relevance' dim, relevance v from ans where relevance is not null
    union all select user_id, 'specificity', specificity from ans where specificity is not null
    union all select user_id, 'structure', structure from ans where structure is not null
    union all select user_id, 'evidence', evidence from ans where evidence is not null
    union all select user_id, 'communication', communication from ans where communication is not null
    union all select user_id, 'competency_demonstration', competency_demonstration from ans where competency_demonstration is not null
  ),
  per_student_dim as (
    select user_id, dim, avg(v)::numeric sm from long group by user_id, dim
  ),
  per_dim as (
    select dim, count(*) n_students, avg(sm) cohort_mean,
           percentile_cont(0.5) within group (order by sm) cohort_median,
           stddev_samp(sm) sd,
           count(*) filter (where sm >= c_tgt) at_or_above
      from per_student_dim group by dim
  ),
  dim_avg as (
    select avg(cohort_mean) m from per_dim where n_students >= c_min_n
  ),
  shaped as (
    select d.dim, d.n_students,
           case when d.n_students >= c_min_n then round(d.cohort_mean) end mean,
           case when d.n_students >= c_min_n then round(d.cohort_median) end median,
           case when d.n_students >= c_min_n then round(d.sd, 1) end sd,
           case when d.n_students >= c_min_n and d.n_students > 0
                then round(100.0 * d.at_or_above / d.n_students) end pct_at_or_above_target,
           case when d.n_students >= c_min_n and (select m from dim_avg) is not null
                then round((d.cohort_mean - (select m from dim_avg))::numeric, 1) end delta_vs_competency_avg,
           case when d.n_students >= c_min_n and (select m from dim_avg) is not null
                then (d.cohort_mean <= (select m from dim_avg) - c_material) end materially_below,
           d.n_students < c_min_n suppressed
      from per_dim d
  )
  select jsonb_build_object(
    'supported', true, 'min_n', c_min_n, 'generated_at', now(),
    'readiness_target', c_tgt, 'material_gap_points', c_material,
    'scope', jsonb_build_object('institution_id', p_institution_id, 'cohort_ids', to_jsonb(p_cohort_ids),
      'from', p_from, 'to', p_to, 'students_in_scope', coalesce(array_length(v_students,1),0),
      'students_with_data', (select count(distinct user_id) from ans)),
    'competency_average', (select case when count(*) > 0 then round(avg(mean)) end from shaped where mean is not null),
    'dimensions', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', dim, 'n_students', n_students, 'suppressed', suppressed,
        'mean', mean, 'median', median, 'stddev', sd,
        'pct_at_or_above_target', pct_at_or_above_target,
        'delta_vs_competency_avg', delta_vs_competency_avg,
        'materially_below', materially_below) order by dim), '[]'::jsonb) from shaped)
  ));
end;
$$;

-- =============================================================================
-- 4) inst_career_insights — performance by career-path family
-- =============================================================================
create or replace function public.inst_career_insights(
  p_institution_id uuid,
  p_cohort_ids uuid[] default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c_min_n constant int := 5;
  c_tgt   constant int := 70;
  v_students uuid[];
begin
  select array_agg(s) into v_students from public.jr_inst_scope_student_ids(p_institution_id, p_cohort_ids) s;
  v_students := coalesce(v_students, '{}');

  return (
  with iv as (
    select i.id, i.user_id,
           public.jr_role_family(app.role, app.company) fam,
           coalesce(ir.overall_score, i.overall_score)::numeric score
      from public.interviews i
      join public.applications app on app.id = i.application_id
      left join public.interview_reports ir on ir.interview_id = i.id
     where i.user_id = any(v_students) and i.status = 'completed'
       and coalesce(ir.overall_score, i.overall_score) is not null
       and (p_from is null or coalesce(i.completed_at, i.created_at) >= p_from)
       and (p_to   is null or coalesce(i.completed_at, i.created_at) <= p_to)
  ),
  per_student_fam as (
    select user_id, fam, avg(score) sm, count(*) ivs from iv group by user_id, fam
  ),
  per_fam as (
    select fam, count(*) n_students, sum(ivs) n_interviews, avg(sm) cohort_mean
      from per_student_fam group by fam
  ),
  reportable as (select * from per_fam where n_students >= c_min_n),
  fam_avg as (select avg(cohort_mean) m from reportable)
  select jsonb_build_object(
    'supported', true, 'min_n', c_min_n, 'generated_at', now(), 'readiness_target', c_tgt,
    'scope', jsonb_build_object('institution_id', p_institution_id, 'cohort_ids', to_jsonb(p_cohort_ids),
      'from', p_from, 'to', p_to, 'students_in_scope', coalesce(array_length(v_students,1),0),
      'students_with_data', (select count(distinct user_id) from iv)),
    'cross_family_mean', (select round(m) from fam_avg),
    'families', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', fam, 'n_students', n_students, 'n_interviews', n_interviews,
        'suppressed', n_students < c_min_n,
        'mean', case when n_students >= c_min_n then round(cohort_mean) end,
        'delta_vs_cross_family', case when n_students >= c_min_n and (select m from fam_avg) is not null
          then round((cohort_mean - (select m from fam_avg))::numeric, 1) end,
        'gap_vs_target', case when n_students >= c_min_n then round((c_tgt - cohort_mean)::numeric, 1) end)
        order by cohort_mean asc), '[]'::jsonb) from per_fam),
    'families_total', (select count(*) from per_fam),
    'families_reportable', (select count(*) from reportable)
  ));
end;
$$;

-- =============================================================================
-- 5) inst_question_performance — difficulty by canonical question category
-- =============================================================================
create or replace function public.inst_question_performance(
  p_institution_id uuid,
  p_cohort_ids uuid[] default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c_min_n constant int := 5;
  c_tgt   constant int := 70;
  v_students uuid[];
begin
  select array_agg(s) into v_students from public.jr_inst_scope_student_ids(p_institution_id, p_cohort_ids) s;
  v_students := coalesce(v_students, '{}');

  return (
  with ans as (
    select i.user_id,
           public.jr_canonical_category(q.category) cat,
           ( (coalesce(e.relevance,0) + coalesce(e.specificity,0) + coalesce(e.structure,0)
            + coalesce(e.evidence,0) + coalesce(e.clarity,0) + coalesce(e.competency_demonstration,0))::numeric
             / nullif( (case when e.relevance is not null then 1 else 0 end)
                      +(case when e.specificity is not null then 1 else 0 end)
                      +(case when e.structure is not null then 1 else 0 end)
                      +(case when e.evidence is not null then 1 else 0 end)
                      +(case when e.clarity is not null then 1 else 0 end)
                      +(case when e.competency_demonstration is not null then 1 else 0 end), 0)
           ) composite
      from public.evaluations e
      join public.answers a             on a.id = e.answer_id
      join public.interview_questions q on q.id = a.question_id
      join public.interviews i          on i.id = q.interview_id
     where i.user_id = any(v_students) and i.status = 'completed'
       and (p_from is null or coalesce(i.completed_at, i.created_at) >= p_from)
       and (p_to   is null or coalesce(i.completed_at, i.created_at) <= p_to)
  ),
  per_student_cat as (
    select user_id, cat, avg(composite) sm, count(*) answers
      from ans where composite is not null group by user_id, cat
  ),
  per_cat as (
    select cat, count(*) n_students, sum(answers) n_answers, avg(sm) cohort_mean
      from per_student_cat group by cat
  ),
  reportable as (select * from per_cat where n_students >= c_min_n),
  cat_avg as (select avg(cohort_mean) m from reportable)
  select jsonb_build_object(
    'supported', true, 'min_n', c_min_n, 'generated_at', now(), 'readiness_target', c_tgt,
    'scope', jsonb_build_object('institution_id', p_institution_id, 'cohort_ids', to_jsonb(p_cohort_ids),
      'from', p_from, 'to', p_to, 'students_in_scope', coalesce(array_length(v_students,1),0),
      'students_with_data', (select count(distinct user_id) from ans)),
    'cross_category_mean', (select round(m) from cat_avg),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', cat, 'n_students', n_students, 'n_answers', n_answers,
        'suppressed', n_students < c_min_n,
        'mean', case when n_students >= c_min_n then round(cohort_mean) end,
        'delta_vs_cross_category', case when n_students >= c_min_n and (select m from cat_avg) is not null
          then round((cohort_mean - (select m from cat_avg))::numeric, 1) end,
        'gap_vs_target', case when n_students >= c_min_n then round((c_tgt - cohort_mean)::numeric, 1) end)
        order by cohort_mean asc), '[]'::jsonb) from per_cat),
    'note', 'The per-question `competency` label is free-text AI output and is not aggregated; this axis is the canonical question-category taxonomy.'
  ));
end;
$$;

-- =============================================================================
-- 6) inst_improvement — per-student trend, then cohort aggregate
-- =============================================================================
create or replace function public.inst_improvement(
  p_institution_id uuid,
  p_cohort_ids uuid[] default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c_min_n     constant int := 5;
  c_improve_eps constant numeric := 3;
  v_students uuid[];
begin
  select array_agg(s) into v_students from public.jr_inst_scope_student_ids(p_institution_id, p_cohort_ids) s;
  v_students := coalesce(v_students, '{}');

  return (
  with iv as (
    select i.user_id,
           coalesce(ir.overall_score, i.overall_score)::numeric score,
           coalesce(i.completed_at, i.created_at) at,
           row_number() over (partition by i.user_id order by coalesce(i.completed_at, i.created_at)) rn,
           count(*)   over (partition by i.user_id) cnt
      from public.interviews i
      left join public.interview_reports ir on ir.interview_id = i.id
     where i.user_id = any(v_students) and i.status = 'completed'
       and coalesce(ir.overall_score, i.overall_score) is not null
       and (p_from is null or coalesce(i.completed_at, i.created_at) >= p_from)
       and (p_to   is null or coalesce(i.completed_at, i.created_at) <= p_to)
  ),
  repeat_students as (select distinct user_id from iv where cnt >= 2),
  per_student as (
    select f.user_id,
           l.score - f.score as delta,
           f.score as first_score, l.score as last_score, f.cnt as interviews
      from (select user_id, score, cnt from iv where rn = 1) f
      join (select iv.user_id, iv.score from iv join (select user_id, max(rn) mr from iv group by user_id) m
              on m.user_id = iv.user_id and m.mr = iv.rn) l on l.user_id = f.user_id
     where f.user_id in (select user_id from repeat_students)
  ),
  -- per-dimension improvement from competency_history (timestamped per dim/interview)
  ch as (
    select ch.user_id, ch.competency dim, ch.score::numeric v, ch.created_at,
           row_number() over (partition by ch.user_id, ch.competency order by ch.created_at) rn,
           count(*)     over (partition by ch.user_id, ch.competency) cnt
      from public.competency_history ch
     where ch.user_id = any(v_students) and ch.source_type = 'interview'
       and (p_from is null or ch.created_at >= p_from)
       and (p_to   is null or ch.created_at <= p_to)
  ),
  ch_delta as (
    select f.user_id, f.dim, l.v - f.v delta
      from (select user_id, dim, v from ch where rn = 1) f
      join (select ch.user_id, ch.dim, ch.v from ch
              join (select user_id, dim, max(rn) mr from ch group by user_id, dim) m
                on m.user_id = ch.user_id and m.dim = ch.dim and m.mr = ch.rn) l
        on l.user_id = f.user_id and l.dim = f.dim
     where (f.user_id, f.dim) in (select user_id, dim from ch where cnt >= 2)
  ),
  ch_dim_roll as (
    select dim, count(*) n_students, avg(delta) mean_delta,
           count(*) filter (where delta >= c_improve_eps) improved
      from ch_delta group by dim
  )
  select jsonb_build_object(
    'supported', true, 'min_n', c_min_n, 'generated_at', now(), 'improve_epsilon', c_improve_eps,
    'method', 'Per student: (score of last completed interview in range) minus (score of first). Requires >= 2 completed interviews. Cohort figures are the mean/median of those per-student deltas — never a comparison of two arbitrary interviews.',
    'scope', jsonb_build_object('institution_id', p_institution_id, 'cohort_ids', to_jsonb(p_cohort_ids),
      'from', p_from, 'to', p_to, 'students_in_scope', coalesce(array_length(v_students,1),0),
      'students_with_data', (select count(distinct user_id) from iv),
      'students_with_repeat_practice', (select count(*) from repeat_students)),
    'overall', case when (select count(*) from per_student) < c_min_n then
        jsonb_build_object('suppressed', true, 'reason', 'below_min_n',
          'n_students_with_repeat', (select count(*) from per_student))
      else jsonb_build_object('suppressed', false,
        'n_students', (select count(*) from per_student),
        'mean_delta', (select round(avg(delta), 1) from per_student),
        'median_delta', (select round(percentile_cont(0.5) within group (order by delta)::numeric, 1) from per_student),
        'pct_improving', (select round(100.0 * count(*) filter (where delta >= c_improve_eps) / count(*)) from per_student),
        'pct_declining', (select round(100.0 * count(*) filter (where delta <= -c_improve_eps) / count(*)) from per_student))
      end,
    'by_dimension', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', dim, 'n_students', n_students, 'suppressed', n_students < c_min_n,
        'mean_delta', case when n_students >= c_min_n then round(mean_delta, 1) end,
        'pct_improving', case when n_students >= c_min_n and n_students > 0 then round(100.0 * improved / n_students) end)
        order by dim), '[]'::jsonb) from ch_dim_roll)
  ));
end;
$$;

-- =============================================================================
-- 7) inst_development_areas — the synthesis: ranked opportunities
-- -----------------------------------------------------------------------------
-- Combines the competency and question-category axes into one ranked list of
-- development opportunities. `opportunity_score` = gap_vs_target (points below
-- the interview-ready floor) scaled by the share of students below target. It
-- is an ordering aid, not a claim; the UI/insights layer states only what the
-- components say. Improvement direction is attached where known so the UI can
-- say "and it is / is not improving with practice".
-- =============================================================================
create or replace function public.inst_development_areas(
  p_institution_id uuid,
  p_cohort_ids uuid[] default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c_min_n constant int := 5;
  c_tgt   constant int := 70;
  v_students uuid[];
begin
  select array_agg(s) into v_students from public.jr_inst_scope_student_ids(p_institution_id, p_cohort_ids) s;
  v_students := coalesce(v_students, '{}');

  return (
  with ans as (
    select i.user_id,
           'relevance' dim, e.relevance v from public.evaluations e
      join public.answers a on a.id=e.answer_id
      join public.interview_questions q on q.id=a.question_id
      join public.interviews i on i.id=q.interview_id
     where i.user_id = any(v_students) and i.status='completed' and e.relevance is not null
       and (p_from is null or coalesce(i.completed_at,i.created_at) >= p_from)
       and (p_to   is null or coalesce(i.completed_at,i.created_at) <= p_to)
    union all select i.user_id,'specificity', e.specificity from public.evaluations e
      join public.answers a on a.id=e.answer_id join public.interview_questions q on q.id=a.question_id
      join public.interviews i on i.id=q.interview_id
     where i.user_id = any(v_students) and i.status='completed' and e.specificity is not null
       and (p_from is null or coalesce(i.completed_at,i.created_at) >= p_from)
       and (p_to   is null or coalesce(i.completed_at,i.created_at) <= p_to)
    union all select i.user_id,'structure', e.structure from public.evaluations e
      join public.answers a on a.id=e.answer_id join public.interview_questions q on q.id=a.question_id
      join public.interviews i on i.id=q.interview_id
     where i.user_id = any(v_students) and i.status='completed' and e.structure is not null
       and (p_from is null or coalesce(i.completed_at,i.created_at) >= p_from)
       and (p_to   is null or coalesce(i.completed_at,i.created_at) <= p_to)
    union all select i.user_id,'evidence', e.evidence from public.evaluations e
      join public.answers a on a.id=e.answer_id join public.interview_questions q on q.id=a.question_id
      join public.interviews i on i.id=q.interview_id
     where i.user_id = any(v_students) and i.status='completed' and e.evidence is not null
       and (p_from is null or coalesce(i.completed_at,i.created_at) >= p_from)
       and (p_to   is null or coalesce(i.completed_at,i.created_at) <= p_to)
    union all select i.user_id,'communication', e.clarity from public.evaluations e
      join public.answers a on a.id=e.answer_id join public.interview_questions q on q.id=a.question_id
      join public.interviews i on i.id=q.interview_id
     where i.user_id = any(v_students) and i.status='completed' and e.clarity is not null
       and (p_from is null or coalesce(i.completed_at,i.created_at) >= p_from)
       and (p_to   is null or coalesce(i.completed_at,i.created_at) <= p_to)
    union all select i.user_id,'competency_demonstration', e.competency_demonstration from public.evaluations e
      join public.answers a on a.id=e.answer_id join public.interview_questions q on q.id=a.question_id
      join public.interviews i on i.id=q.interview_id
     where i.user_id = any(v_students) and i.status='completed' and e.competency_demonstration is not null
       and (p_from is null or coalesce(i.completed_at,i.created_at) >= p_from)
       and (p_to   is null or coalesce(i.completed_at,i.created_at) <= p_to)
  ),
  ps as (select user_id, dim, avg(v)::numeric sm from ans group by user_id, dim),
  comp as (
    select dim, count(*) n_students, avg(sm) cohort_mean,
           count(*) filter (where sm < c_tgt) below_target
      from ps group by dim
  ),
  cat_ans as (
    select i.user_id, public.jr_canonical_category(q.category) cat,
           ((coalesce(e.relevance,0)+coalesce(e.specificity,0)+coalesce(e.structure,0)
            +coalesce(e.evidence,0)+coalesce(e.clarity,0)+coalesce(e.competency_demonstration,0))::numeric
            / nullif((case when e.relevance is not null then 1 else 0 end)
                     +(case when e.specificity is not null then 1 else 0 end)
                     +(case when e.structure is not null then 1 else 0 end)
                     +(case when e.evidence is not null then 1 else 0 end)
                     +(case when e.clarity is not null then 1 else 0 end)
                     +(case when e.competency_demonstration is not null then 1 else 0 end),0)) composite
      from public.evaluations e
      join public.answers a on a.id=e.answer_id
      join public.interview_questions q on q.id=a.question_id
      join public.interviews i on i.id=q.interview_id
     where i.user_id = any(v_students) and i.status='completed'
       and (p_from is null or coalesce(i.completed_at,i.created_at) >= p_from)
       and (p_to   is null or coalesce(i.completed_at,i.created_at) <= p_to)
  ),
  ps_cat as (select user_id, cat, avg(composite)::numeric sm from cat_ans where composite is not null group by user_id, cat),
  catr as (select cat, count(*) n_students, avg(sm) cohort_mean, count(*) filter (where sm < c_tgt) below_target from ps_cat group by cat),
  opps as (
    select 'competency' kind, dim key, n_students, round(cohort_mean) cohort_mean,
           round((c_tgt - cohort_mean)::numeric,1) gap_vs_target,
           round(100.0*below_target/nullif(n_students,0)) pct_below_target,
           round(((c_tgt - cohort_mean) * below_target::numeric / nullif(n_students,0))::numeric, 1) opportunity_score
      from comp where n_students >= c_min_n and cohort_mean < c_tgt
    union all
    select 'question_category', cat, n_students, round(cohort_mean),
           round((c_tgt - cohort_mean)::numeric,1),
           round(100.0*below_target/nullif(n_students,0)),
           round(((c_tgt - cohort_mean) * below_target::numeric / nullif(n_students,0))::numeric, 1)
      from catr where n_students >= c_min_n and cohort_mean < c_tgt
  )
  select jsonb_build_object(
    'supported', true, 'min_n', c_min_n, 'generated_at', now(), 'readiness_target', c_tgt,
    'scope', jsonb_build_object('institution_id', p_institution_id, 'cohort_ids', to_jsonb(p_cohort_ids),
      'from', p_from, 'to', p_to, 'students_in_scope', coalesce(array_length(v_students,1),0),
      'students_with_data', (select count(distinct user_id) from ans)),
    'method', 'opportunity_score = (points below the interview-ready floor) x (share of students below it). An ordering aid over competency dimensions and question categories that are (a) reportable (n >= min_n) and (b) below the floor. Not a causal claim.',
    'opportunities', (select coalesce(jsonb_agg(jsonb_build_object(
        'kind', kind, 'key', key, 'n_students', n_students, 'cohort_mean', cohort_mean,
        'gap_vs_target', gap_vs_target, 'pct_below_target', pct_below_target,
        'opportunity_score', opportunity_score) order by opportunity_score desc nulls last), '[]'::jsonb) from opps),
    'reportable', (select count(*) from opps)
  ));
end;
$$;

-- =============================================================================
-- GRANTS — authenticated end users; each RPC self-enforces the staff check.
-- =============================================================================
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.inst_overview(uuid,uuid[],timestamptz,timestamptz)',
    'public.inst_performance(uuid,uuid[],timestamptz,timestamptz)',
    'public.inst_competencies(uuid,uuid[],timestamptz,timestamptz)',
    'public.inst_career_insights(uuid,uuid[],timestamptz,timestamptz)',
    'public.inst_question_performance(uuid,uuid[],timestamptz,timestamptz)',
    'public.inst_improvement(uuid,uuid[],timestamptz,timestamptz)',
    'public.inst_development_areas(uuid,uuid[],timestamptz,timestamptz)',
    'public.jr_inst_scope_student_ids(uuid,uuid[])'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

revoke all on function public.jr_canonical_category(text) from public, anon;
revoke all on function public.jr_role_family(text, text)  from public, anon;
grant execute on function public.jr_canonical_category(text) to authenticated;
grant execute on function public.jr_role_family(text, text)  to authenticated;
