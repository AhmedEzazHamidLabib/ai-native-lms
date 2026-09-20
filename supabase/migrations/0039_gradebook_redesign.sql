-- Gradebook redesign (instructor product pass, Part 9): the previous
-- get_course_gradebook() cross-joined EVERY enrolled student against
-- EVERY assessment including kind='project' rows, which never get an
-- `attempts` row at all (Projects are tracked via project_group_grades,
-- a completely different mechanism) — that is the exact root cause of
-- the "26 not started" nonsense metric: 10 students x 3 assessments
-- (including Project, which is ALWAYS "not started" for everyone by
-- construction) - 4 actually started = 26. Fix: this RPC now only
-- covers assessment-engine-backed kinds (mock_test/class_test); the
-- instructor UI merges in project grades separately from
-- project_group_grades, which already exists and is authoritative for
-- Project completion.

drop function if exists get_course_gradebook(uuid);

create function get_course_gradebook(p_course_id uuid)
returns table (
  user_id uuid,
  user_email text,
  assessment_id uuid,
  assessment_title text,
  assessment_kind assessment_kind,
  points_possible integer,
  contributes_to_grade boolean,
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
    a.kind as assessment_kind,
    a.points_possible,
    a.contributes_to_grade,
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
    and a.kind != 'project';
end;
$$;

grant execute on function get_course_gradebook(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- get_course_project_grades(): one row per enrolled student with their
-- project group + grade (if any) — the Project-specific counterpart to
-- the assessment-engine gradebook above, so the instructor UI can
-- merge the two into one per-student summary without a separate,
-- misleading "not started" concept for something that isn't attempted.
-- ---------------------------------------------------------------------

create or replace function get_course_project_grades(p_course_id uuid)
returns table (
  user_id uuid,
  project_id uuid,
  group_id uuid,
  group_name text,
  score numeric,
  max_score numeric,
  feedback text
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
    p.id as project_id,
    g.id as group_id,
    g.name as group_name,
    gr.score,
    gr.max_score,
    gr.feedback
  from course_members cm
  join projects p on p.course_id = p_course_id
  left join project_group_members m on m.user_id = cm.user_id
    and m.group_id in (select id from project_groups where project_id = p.id)
  left join project_groups g on g.id = m.group_id
  left join project_group_grades gr on gr.project_id = p.id and gr.group_id = g.id
  where cm.course_id = p_course_id and cm.role = 'student';
end;
$$;

grant execute on function get_course_project_grades(uuid) to authenticated;
