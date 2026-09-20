-- Multi-course support + trusted self-enrollment.
--
-- Two new concepts: a per-course `auto_enroll` toggle, and a real
-- enrollment_requests table distinct from course_members — a pending
-- request must never be mistaken for (or implemented as) membership.
--
-- Security shape matches the rest of this project: self-enrollment,
-- approve, reject, and remove all go through SECURITY DEFINER functions
-- that derive identity from auth.uid() and re-check authorization
-- inside Postgres. The browser can never supply a role and get
-- anything other than 'student' out of enroll_in_course().

alter table courses add column auto_enroll boolean not null default true;

-- Any authenticated user may browse the course catalog (title/code/term
-- aren't sensitive) — this is what makes "Available Courses" possible
-- before someone is a member of anything. The narrower existing
-- "members can read their course" policy still holds; this one just
-- also allows non-members to see the catalog.
create policy "authenticated users can browse all courses"
on courses for select
to authenticated
using (true);

create policy "instructors update their course settings"
on courses for update
to authenticated
using (current_course_role(id) = 'instructor')
with check (current_course_role(id) = 'instructor');

create type enrollment_request_status as enum ('pending', 'approved', 'rejected');

create table enrollment_requests (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status enrollment_request_status not null default 'pending',
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id)
);

create index enrollment_requests_course_id_idx on enrollment_requests (course_id);
create index enrollment_requests_user_id_idx on enrollment_requests (user_id);

-- At most one PENDING request per student/course — a rejected or
-- approved row doesn't block a fresh request later.
create unique index enrollment_requests_one_pending_idx
  on enrollment_requests (course_id, user_id)
  where status = 'pending';

alter table enrollment_requests enable row level security;

create policy "students read own enrollment requests"
on enrollment_requests for select
to authenticated
using (user_id = auth.uid());

create policy "instructors read enrollment requests in their course"
on enrollment_requests for select
to authenticated
using (current_course_role(course_id) = 'instructor');

-- No insert/update/delete policy for anyone — enroll_in_course(),
-- approve_enrollment_request(), and reject_enrollment_request() are the
-- only writers.

-- ---------------------------------------------------------------------
-- enroll_in_course(): the one entry point for a student joining a
-- course. Always derives identity from auth.uid(), always creates role
-- = 'student' — there is no parameter here a client could set to
-- become an instructor. Idempotent: already enrolled or already
-- pending both return cleanly instead of erroring.
-- ---------------------------------------------------------------------

create or replace function enroll_in_course(p_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course courses%rowtype;
  v_existing_role course_role;
begin
  select * into v_course from courses where id = p_course_id;
  if not found then
    raise exception 'Course not found.';
  end if;

  select role into v_existing_role
  from course_members
  where course_id = p_course_id and user_id = auth.uid();

  if v_existing_role is not null then
    return jsonb_build_object('status', 'enrolled', 'already', true);
  end if;

  if v_course.auto_enroll then
    insert into course_members (course_id, user_id, role)
    values (p_course_id, auth.uid(), 'student')
    on conflict (course_id, user_id) do nothing;
    return jsonb_build_object('status', 'enrolled', 'already', false);
  end if;

  if exists (
    select 1 from enrollment_requests
    where course_id = p_course_id and user_id = auth.uid() and status = 'pending'
  ) then
    return jsonb_build_object('status', 'pending', 'already', true);
  end if;

  insert into enrollment_requests (course_id, user_id, status)
  values (p_course_id, auth.uid(), 'pending');

  return jsonb_build_object('status', 'pending', 'already', false);
end;
$$;

grant execute on function enroll_in_course(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- approve/reject: instructor-only, re-checked from auth.uid() inside
-- the function regardless of what the caller believes about itself.
-- ---------------------------------------------------------------------

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
  if current_course_role(v_req.course_id) != 'instructor' then
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

grant execute on function approve_enrollment_request(uuid) to authenticated;

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
  if current_course_role(v_req.course_id) != 'instructor' then
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

grant execute on function reject_enrollment_request(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- remove_course_member(): removes membership in ONE course only, and
-- only a student membership — an instructor can't accidentally (or
-- deliberately, from a UI bug) remove another instructor's access
-- through the roster's "Remove from Course" button.
-- ---------------------------------------------------------------------

create or replace function remove_course_member(p_course_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_course_role(p_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;

  delete from course_members
  where course_id = p_course_id and user_id = p_user_id and role = 'student';
end;
$$;

grant execute on function remove_course_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Instructor read helpers — same reason as list_assessment_attempts:
-- auth.users isn't reachable through normal RLS-scoped queries.
-- ---------------------------------------------------------------------

create or replace function list_course_roster(p_course_id uuid)
returns table (user_id uuid, email text, enrolled_at timestamptz)
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
  select cm.user_id, u.email::text, cm.created_at
  from course_members cm
  join auth.users u on u.id = cm.user_id
  where cm.course_id = p_course_id and cm.role = 'student'
  order by cm.created_at;
end;
$$;

grant execute on function list_course_roster(uuid) to authenticated;

create or replace function list_pending_requests(p_course_id uuid)
returns table (request_id uuid, user_id uuid, email text, requested_at timestamptz)
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
  select er.id, er.user_id, u.email::text, er.requested_at
  from enrollment_requests er
  join auth.users u on u.id = er.user_id
  where er.course_id = p_course_id and er.status = 'pending'
  order by er.requested_at;
end;
$$;

grant execute on function list_pending_requests(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- CSE 1205: a real second course, seeded the same way CSE 1203 was
-- (see supabase/seed.sql) — not a UI flow yet, matching the existing
-- "course creation is out of scope" decision. Both current instructors
-- get instructor access on it too, matching what the email-confirmation
-- trigger already grants on every course for a newly verified
-- instructor (0004_instructor_authorization.sql) — this just backfills
-- the same outcome for a course that didn't exist yet when they
-- verified.
-- ---------------------------------------------------------------------

insert into courses (id, code, title, term)
values (
  '22222222-2222-2222-2222-222222222221',
  'CSE 1205',
  'Introduction to Computing II',
  'Fall 2026'
)
on conflict (id) do nothing;

insert into course_members (course_id, user_id, role)
select '22222222-2222-2222-2222-222222222221', u.id, 'instructor'
from auth.users u
join instructor_allowlist ia on lower(u.email) = ia.email
on conflict (course_id, user_id) do update set role = 'instructor';
