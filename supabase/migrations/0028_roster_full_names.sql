-- Instructor roster should show full_name, not just email (see
-- docs/COURSEWORK_LEARNING_ARCHITECTURE.md "PROFILES"). Additive
-- redefinition of the two existing roster RPCs — same authorization
-- check, same callers, one extra column.

drop function if exists list_course_roster(uuid);

create or replace function list_course_roster(p_course_id uuid)
returns table (user_id uuid, email text, full_name text, enrolled_at timestamptz)
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
  select cm.user_id, u.email::text, p.full_name, cm.created_at
  from course_members cm
  join auth.users u on u.id = cm.user_id
  left join profiles p on p.user_id = cm.user_id
  where cm.course_id = p_course_id and cm.role = 'student'
  order by cm.created_at;
end;
$$;

drop function if exists list_pending_requests(uuid);

create or replace function list_pending_requests(p_course_id uuid)
returns table (request_id uuid, user_id uuid, email text, full_name text, requested_at timestamptz)
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
  select er.id, er.user_id, u.email::text, p.full_name, er.requested_at
  from enrollment_requests er
  join auth.users u on u.id = er.user_id
  left join profiles p on p.user_id = er.user_id
  where er.course_id = p_course_id and er.status = 'pending'
  order by er.requested_at;
end;
$$;
