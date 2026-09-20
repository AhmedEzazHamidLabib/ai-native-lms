-- Security fix: `if current_course_role(p_course_id) != 'instructor' then
-- raise exception` never fires for a caller with NO relationship to the
-- course at all. current_course_role() returns NULL for a non-member,
-- and in PL/pgSQL `IF NULL THEN ...` is treated as false (Postgres's
-- three-valued logic — NULL != 'instructor' is NULL, not true), so the
-- exception is silently skipped and the function falls through to
-- returning real data to a completely unauthorized caller.
--
-- Found during the grades/performance release pass by calling
-- get_course_gradebook() and get_course_performance() (0010) as a
-- student who had been fully removed from the course (no course_members
-- row at all, not even as a student) — both functions returned the full
-- class roster/scores/analytics instead of raising "Not authorized."
-- The same `!= 'instructor'` pattern turned out to already exist in six
-- other SECURITY DEFINER functions across 0007/0008/0009, all fixed
-- here in one pass.
--
-- Fix: `is distinct from` instead of `!=`. `NULL is distinct from
-- 'instructor'` is true (correctly rejects), `'student' is distinct
-- from 'instructor'` is true (correctly rejects), `'instructor' is
-- distinct from 'instructor'` is false (correctly allows) — unlike
-- `!=`, it never evaluates to NULL.

create or replace function list_assessment_attempts(p_assessment_id uuid)
returns table (
  attempt_id uuid,
  user_id uuid,
  user_email text,
  started_at timestamptz,
  submitted_at timestamptz,
  score integer,
  max_score integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  select course_id into v_course_id from assessments where id = p_assessment_id;
  if v_course_id is null then
    raise exception 'Assessment not found.';
  end if;
  if current_course_role(v_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;

  return query
  select a.id, a.user_id, u.email::text, a.started_at, a.submitted_at, a.score, a.max_score
  from attempts a
  join auth.users u on u.id = a.user_id
  where a.assessment_id = p_assessment_id
  order by a.started_at;
end;
$$;

create or replace function approve_enrollment_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req enrollment_requests%rowtype;
begin
  select * into v_req from enrollment_requests where id = p_request_id;
  if not found then
    raise exception 'Request not found.';
  end if;
  if current_course_role(v_req.course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;
  if v_req.status != 'pending' then
    raise exception 'Request already resolved.';
  end if;

  insert into course_members (course_id, user_id, role)
  values (v_req.course_id, v_req.user_id, 'student')
  on conflict (course_id, user_id) do nothing;

  update enrollment_requests
  set status = 'approved', resolved_at = now(), resolved_by = auth.uid()
  where id = p_request_id;
end;
$$;

create or replace function reject_enrollment_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req enrollment_requests%rowtype;
begin
  select * into v_req from enrollment_requests where id = p_request_id;
  if not found then
    raise exception 'Request not found.';
  end if;
  if current_course_role(v_req.course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;
  if v_req.status != 'pending' then
    raise exception 'Request already resolved.';
  end if;

  update enrollment_requests
  set status = 'rejected', resolved_at = now(), resolved_by = auth.uid()
  where id = p_request_id;
end;
$$;

create or replace function remove_course_member(p_course_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;

  delete from course_members
  where course_id = p_course_id and user_id = p_user_id and role = 'student';
end;
$$;

create or replace function list_course_roster(p_course_id uuid)
returns table (user_id uuid, email text, enrolled_at timestamptz)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;

  return query
  select cm.user_id, u.email::text, cm.created_at
  from course_members cm
  join auth.users u on u.id = cm.user_id
  where cm.course_id = p_course_id and cm.role = 'student'
  order by cm.created_at;
end;
$$;

create or replace function list_pending_requests(p_course_id uuid)
returns table (request_id uuid, user_id uuid, email text, requested_at timestamptz)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;

  return query
  select er.id, er.user_id, u.email::text, er.requested_at
  from enrollment_requests er
  join auth.users u on u.id = er.user_id
  where er.course_id = p_course_id and er.status = 'pending'
  order by er.requested_at;
end;
$$;

create or replace function get_course_gradebook(p_course_id uuid)
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
  if current_course_role(p_course_id) is distinct from 'instructor' then
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
  if current_course_role(p_course_id) is distinct from 'instructor' then
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
