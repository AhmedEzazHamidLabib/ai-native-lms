-- Grades and performance analytics, derived exclusively from the
-- existing assessment/attempt tables (Invariant: one authoritative
-- grading system — submit_attempt() in 0006_assessments_rls.sql — no
-- parallel gradebook that could disagree with it).
--
-- Grades (the student's own submitted scores) reuses the existing
-- `attempts` table read through RLS + getStudentAssessments() in
-- src/lib/domain/assessments.ts — no new function needed there.
--
-- Performance/gradebook aggregation, by contrast, needs to join
-- attempt_questions/responses/questions/lectures per-question, which
-- students and instructors have no direct table access to at all (see
-- 0006's comment on why). So each of these is one SECURITY DEFINER
-- function that computes its aggregate server-side and returns a
-- single JSON payload — one round trip, no N+1, and no client-side
-- code ever sees a full question/answer bank to do the aggregation
-- itself.
--
-- Every function below re-derives authorization from auth.uid() /
-- current_course_role() internally, exactly like the rest of the
-- assessment subsystem; none of them trust a client-supplied role or
-- user id.

-- ---------------------------------------------------------------------
-- get_student_performance(): this student's own accuracy, scoped to
-- one course, broken down by lecture and topic. Only counts questions
-- from SUBMITTED attempts in that course — an in-progress attempt's
-- partial answers never contribute (nothing to report on work that
-- hasn't been graded yet).
-- ---------------------------------------------------------------------

create or replace function get_student_performance(p_course_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_correct integer;
  v_total integer;
  v_assessments_completed integer;
  v_lecture_breakdown jsonb;
  v_topic_breakdown jsonb;
begin
  if current_course_role(p_course_id) is null then
    raise exception 'Not a member of this course.';
  end if;

  select count(*) into v_assessments_completed
  from attempts att
  join assessments a on a.id = att.assessment_id
  where a.course_id = p_course_id and att.user_id = auth.uid() and att.submitted_at is not null;

  select
    count(*) filter (where o.is_correct),
    count(*)
  into v_correct, v_total
  from attempt_questions aq
  join attempts att on att.id = aq.attempt_id
  join assessments a on a.id = att.assessment_id
  left join responses r on r.attempt_id = aq.attempt_id and r.question_id = aq.question_id
  left join question_options o on o.id = r.selected_option_id
  where a.course_id = p_course_id and att.user_id = auth.uid() and att.submitted_at is not null;

  select coalesce(jsonb_agg(x order by x.lecture_title), '[]'::jsonb) into v_lecture_breakdown
  from (
    select
      l.id as lecture_id,
      l.title as lecture_title,
      count(*) filter (where o.is_correct) as correct,
      count(*) as total
    from attempt_questions aq
    join attempts att on att.id = aq.attempt_id
    join assessments a on a.id = att.assessment_id
    join questions q on q.id = aq.question_id
    join lectures l on l.id = q.source_lecture_id
    left join responses r on r.attempt_id = aq.attempt_id and r.question_id = aq.question_id
    left join question_options o on o.id = r.selected_option_id
    where a.course_id = p_course_id and att.user_id = auth.uid() and att.submitted_at is not null
    group by l.id, l.title
  ) x;

  select coalesce(jsonb_agg(x order by x.total desc, x.topic), '[]'::jsonb) into v_topic_breakdown
  from (
    select
      q.topic,
      count(*) filter (where o.is_correct) as correct,
      count(*) as total
    from attempt_questions aq
    join attempts att on att.id = aq.attempt_id
    join assessments a on a.id = att.assessment_id
    join questions q on q.id = aq.question_id
    left join responses r on r.attempt_id = aq.attempt_id and r.question_id = aq.question_id
    left join question_options o on o.id = r.selected_option_id
    where a.course_id = p_course_id and att.user_id = auth.uid() and att.submitted_at is not null
    group by q.topic
  ) x;

  return jsonb_build_object(
    'assessmentsCompleted', v_assessments_completed,
    'questionsCorrect', coalesce(v_correct, 0),
    'questionsTotal', coalesce(v_total, 0),
    'lectureBreakdown', v_lecture_breakdown,
    'topicBreakdown', v_topic_breakdown
  );
end;
$$;

grant execute on function get_student_performance(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- get_course_gradebook(): one row per (enrolled student, assessment) in
-- this course, instructor-only. Built from course_members CROSS JOIN
-- assessments LEFT JOIN attempts so a student who hasn't started an
-- assessment still gets a row (status 'not_started') rather than being
-- silently absent — the instructor needs to see who HASN'T taken it,
-- not just who has.
-- ---------------------------------------------------------------------

drop function if exists get_course_gradebook(uuid);

create function get_course_gradebook(p_course_id uuid)
returns table (
  user_id uuid,
  user_email text,
  assessment_id uuid,
  assessment_title text,
  attempt_id uuid,
  status text,
  score integer,
  max_score integer,
  submitted_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if current_course_role(p_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;

  return query
  select
    cm.user_id,
    u.email::text as user_email,
    a.id as assessment_id,
    a.title as assessment_title,
    att.id as attempt_id,
    case
      when att.submitted_at is not null then 'submitted'
      when att.id is not null then 'in_progress'
      else 'not_started'
    end as status,
    att.score,
    att.max_score,
    att.submitted_at
  from course_members cm
  join auth.users u on u.id = cm.user_id
  cross join assessments a
  left join attempts att on att.assessment_id = a.id and att.user_id = cm.user_id
  where cm.course_id = p_course_id
    and cm.role = 'student'
    and a.course_id = p_course_id
  order by u.email, a.created_at;
end;
$$;

grant execute on function get_course_gradebook(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- get_course_performance(): course-wide aggregate analytics for the
-- instructor — average/median score, and per-lecture / per-topic /
-- per-question accuracy. Only ever computed from SUBMITTED attempts in
-- THIS course; never crosses into another course's data because every
-- join is anchored through assessments.course_id = p_course_id.
-- ---------------------------------------------------------------------

create or replace function get_course_performance(p_course_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_students_submitted integer;
  v_total_students integer;
  v_average_percent numeric;
  v_median_percent numeric;
  v_lecture_breakdown jsonb;
  v_topic_breakdown jsonb;
  v_question_breakdown jsonb;
begin
  if current_course_role(p_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;

  select count(distinct att.user_id) into v_students_submitted
  from attempts att
  join assessments a on a.id = att.assessment_id
  where a.course_id = p_course_id and att.submitted_at is not null;

  select count(*) into v_total_students
  from course_members
  where course_id = p_course_id and role = 'student';

  select
    round(avg(att.score::numeric / nullif(att.max_score, 0) * 100)::numeric, 1),
    round(percentile_cont(0.5) within group (
      order by (att.score::numeric / nullif(att.max_score, 0) * 100)
    )::numeric, 1)
  into v_average_percent, v_median_percent
  from attempts att
  join assessments a on a.id = att.assessment_id
  where a.course_id = p_course_id and att.submitted_at is not null;

  select coalesce(jsonb_agg(x order by x.lecture_title), '[]'::jsonb) into v_lecture_breakdown
  from (
    select
      l.id as lecture_id,
      l.title as lecture_title,
      count(*) filter (where o.is_correct) as correct,
      count(*) as total
    from attempt_questions aq
    join attempts att on att.id = aq.attempt_id
    join assessments a on a.id = att.assessment_id
    join questions q on q.id = aq.question_id
    join lectures l on l.id = q.source_lecture_id
    left join responses r on r.attempt_id = aq.attempt_id and r.question_id = aq.question_id
    left join question_options o on o.id = r.selected_option_id
    where a.course_id = p_course_id and att.submitted_at is not null
    group by l.id, l.title
  ) x;

  select coalesce(jsonb_agg(x order by x.total desc, x.topic), '[]'::jsonb) into v_topic_breakdown
  from (
    select
      q.topic,
      count(*) filter (where o.is_correct) as correct,
      count(*) as total
    from attempt_questions aq
    join attempts att on att.id = aq.attempt_id
    join assessments a on a.id = att.assessment_id
    join questions q on q.id = aq.question_id
    left join responses r on r.attempt_id = aq.attempt_id and r.question_id = aq.question_id
    left join question_options o on o.id = r.selected_option_id
    where a.course_id = p_course_id and att.submitted_at is not null
    group by q.topic
  ) x;

  select coalesce(jsonb_agg(x order by x.correct_pct asc, x.total desc), '[]'::jsonb) into v_question_breakdown
  from (
    select
      q.id as question_id,
      q.prompt,
      q.topic,
      l.title as lecture_title,
      count(*) filter (where o.is_correct) as correct,
      count(*) as total,
      round(100.0 * count(*) filter (where o.is_correct) / nullif(count(*), 0), 1) as correct_pct
    from attempt_questions aq
    join attempts att on att.id = aq.attempt_id
    join assessments a on a.id = att.assessment_id
    join questions q on q.id = aq.question_id
    left join lectures l on l.id = q.source_lecture_id
    left join responses r on r.attempt_id = aq.attempt_id and r.question_id = aq.question_id
    left join question_options o on o.id = r.selected_option_id
    where a.course_id = p_course_id and att.submitted_at is not null
    group by q.id, q.prompt, q.topic, l.title
  ) x;

  return jsonb_build_object(
    'studentsSubmitted', v_students_submitted,
    'totalStudents', v_total_students,
    'averagePercent', v_average_percent,
    'medianPercent', v_median_percent,
    'lectureBreakdown', v_lecture_breakdown,
    'topicBreakdown', v_topic_breakdown,
    'questionBreakdown', v_question_breakdown
  );
end;
$$;

grant execute on function get_course_performance(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Helpful composite index: get_course_gradebook / get_course_performance
-- both filter attempts through assessments.course_id, and look up one
-- attempt per (assessment, user) — both already covered by the existing
-- attempts_assessment_id_idx and the (assessment_id, user_id) unique
-- constraint from 0005. No new index needed there. This one speeds up
-- the course_members role filter used by every RPC in this file and in
-- 0009.
-- ---------------------------------------------------------------------

create index if not exists course_members_course_role_idx
  on course_members (course_id, role);
