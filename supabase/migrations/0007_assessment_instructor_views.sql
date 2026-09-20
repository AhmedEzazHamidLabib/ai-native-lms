-- Instructor-facing read helper: attempts joined with student email.
-- auth.users isn't queryable through PostgREST/RLS directly (same
-- reason instructor_allowlist's list_instructor_status() needed a
-- SECURITY DEFINER function) — this is the equivalent for assessment
-- attempts.

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
  if current_course_role(v_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;

  return query
  select a.id, a.user_id, u.email, a.started_at, a.submitted_at, a.score, a.max_score
  from attempts a
  join auth.users u on u.id = a.user_id
  where a.assessment_id = p_assessment_id
  order by a.started_at;
end;
$$;

grant execute on function list_assessment_attempts(uuid) to authenticated;
