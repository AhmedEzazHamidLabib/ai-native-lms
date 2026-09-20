-- Instructor Student Detail (Part 6): per-objective assessment and
-- practice evidence for a SPECIFIC student, for an instructor's own
-- course roster click-through. Same query shape as
-- get_student_objective_evidence()/get_student_practice_evidence()
-- (0016) which are locked to auth.uid() — these are the
-- instructor-facing counterparts, authorized separately.

create or replace function get_student_objective_evidence_for_instructor(p_course_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if current_course_role(p_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;

  select coalesce(jsonb_agg(x order by x.position), '[]'::jsonb) into v_result
  from (
    select
      lo.id as learning_objective_id,
      lo.title,
      lo.position,
      count(*) filter (where o.is_correct) as correct,
      count(*) as attempted
    from learning_objectives lo
    join questions q on q.learning_objective_id = lo.id
    join attempt_questions aq on aq.question_id = q.id
    join attempts att on att.id = aq.attempt_id
    join assessments a on a.id = att.assessment_id
    left join responses r on r.attempt_id = aq.attempt_id and r.question_id = aq.question_id
    left join question_options o on o.id = r.selected_option_id
    where lo.course_id = p_course_id
      and a.course_id = p_course_id
      and att.user_id = p_user_id
      and att.submitted_at is not null
    group by lo.id, lo.title, lo.position
  ) x;

  return v_result;
end;
$$;

grant execute on function get_student_objective_evidence_for_instructor(uuid, uuid) to authenticated;

create or replace function get_student_practice_evidence_for_instructor(p_course_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if current_course_role(p_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;

  select coalesce(jsonb_agg(x order by x.position), '[]'::jsonb) into v_result
  from (
    select
      lo.id as learning_objective_id,
      lo.title,
      lo.position,
      count(*) filter (where pa.correct) as correct,
      count(*) filter (where pa.answered_at is not null) as attempted
    from learning_objectives lo
    join practice_attempts pa on pa.learning_objective_id = lo.id
    where lo.course_id = p_course_id
      and pa.course_id = p_course_id
      and pa.user_id = p_user_id
    group by lo.id, lo.title, lo.position
  ) x;

  return v_result;
end;
$$;

grant execute on function get_student_practice_evidence_for_instructor(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- list_course_members_directory(): names-only classmate directory for
-- students — never emails, and scoped to the caller's own course
-- membership (never lets a student enumerate a course they're not in).
-- ---------------------------------------------------------------------

create or replace function list_course_members_directory(p_course_id uuid)
returns table (user_id uuid, full_name text, is_me boolean)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if current_course_role(p_course_id) is null then
    raise exception 'Not authorized.';
  end if;

  return query
  select cm.user_id, coalesce(pr.full_name, 'Unnamed student'), cm.user_id = auth.uid()
  from course_members cm
  left join profiles pr on pr.user_id = cm.user_id
  where cm.course_id = p_course_id and cm.role = 'student'
  order by coalesce(pr.full_name, '');
end;
$$;

grant execute on function list_course_members_directory(uuid) to authenticated;
