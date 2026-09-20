-- auth.users.email is character varying(255), not text — the RETURNS
-- TABLE declaration in 0007 didn't match, causing every call to fail
-- with "structure of query does not match function result type".
-- Cast explicitly rather than changing the return type, so callers
-- (and generated TS types) keep seeing a plain string.

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
  select a.id, a.user_id, u.email::text, a.started_at, a.submitted_at, a.score, a.max_score
  from attempts a
  join auth.users u on u.id = a.user_id
  where a.assessment_id = p_assessment_id
  order by a.started_at;
end;
$$;
