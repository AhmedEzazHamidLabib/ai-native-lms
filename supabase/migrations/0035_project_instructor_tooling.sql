-- Project Instructor Tooling (Part 5): group-mode config (not just UI
-- branching), atomic capacity-safe self-enrollment, deliverable
-- CRUD/publishing, and a simple group-level grading path. All new
-- writes go through SECURITY DEFINER RPCs that re-derive auth.uid()/
-- current_course_role() themselves — never trust a client-supplied
-- group_id/user_id/course_id. See docs/COURSEWORK_LEARNING_ARCHITECTURE.md.

alter table projects
  add column if not exists group_mode text not null default 'instructor_assigned'
    check (group_mode in ('instructor_assigned', 'self_enrollment')),
  add column if not exists groups_locked boolean not null default false;

alter table project_groups
  add column if not exists capacity integer check (capacity is null or capacity > 0);

alter table project_deliverables
  add column if not exists submission_enabled boolean not null default true,
  add column if not exists allowed_type text,
  add column if not exists published boolean not null default false;

-- Students should only ever see published deliverables; instructors see
-- all (draft + published) for their own course's project.
drop policy if exists "course members can read deliverables" on project_deliverables;
create policy "students read published deliverables, instructors read all"
on project_deliverables for select
to authenticated
using (
  exists (
    select 1 from projects p
    where p.id = project_deliverables.project_id
      and (
        current_course_role(p.course_id) = 'instructor'
        or (published and current_course_role(p.course_id) is not null)
      )
  )
);

create table project_group_grades (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  group_id uuid not null references project_groups (id) on delete cascade,
  score numeric not null,
  max_score numeric not null,
  feedback text,
  graded_by uuid not null references auth.users (id),
  graded_at timestamptz not null default now(),
  unique (project_id, group_id)
);

alter table project_group_grades enable row level security;
create policy "own group or course instructor can read project grades"
on project_group_grades for select
to authenticated
using (
  exists (
    select 1 from project_group_members m
    where m.group_id = project_group_grades.group_id and m.user_id = auth.uid()
  )
  or exists (
    select 1 from projects p
    where p.id = project_group_grades.project_id and current_course_role(p.course_id) = 'instructor'
  )
);
-- No client insert/update policy — set_project_group_grade() is the
-- only write path.

-- ---------------------------------------------------------------------
-- helper: raise unless the caller instructs this project's course
-- ---------------------------------------------------------------------

create or replace function _assert_project_instructor(p_project_id uuid)
returns uuid
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  select course_id into v_course_id from projects where id = p_project_id;
  if v_course_id is null then
    raise exception 'Project not found.';
  end if;
  if current_course_role(v_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;
  return v_course_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Group configuration (instructor-only)
-- ---------------------------------------------------------------------

create or replace function set_project_group_mode(p_project_id uuid, p_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform _assert_project_instructor(p_project_id);
  if p_mode not in ('instructor_assigned', 'self_enrollment') then
    raise exception 'Invalid group mode.';
  end if;
  update projects set group_mode = p_mode where id = p_project_id;
end;
$$;
grant execute on function set_project_group_mode(uuid, text) to authenticated;

create or replace function set_project_groups_locked(p_project_id uuid, p_locked boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform _assert_project_instructor(p_project_id);
  update projects set groups_locked = p_locked where id = p_project_id;
end;
$$;
grant execute on function set_project_groups_locked(uuid, boolean) to authenticated;

create or replace function create_project_group(p_project_id uuid, p_name text, p_capacity integer default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform _assert_project_instructor(p_project_id);
  insert into project_groups (project_id, name, capacity)
  values (p_project_id, p_name, p_capacity)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function create_project_group(uuid, text, integer) to authenticated;

create or replace function update_project_group(p_group_id uuid, p_name text, p_capacity integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from project_groups where id = p_group_id;
  if v_project_id is null then
    raise exception 'Group not found.';
  end if;
  perform _assert_project_instructor(v_project_id);
  update project_groups set name = p_name, capacity = p_capacity where id = p_group_id;
end;
$$;
grant execute on function update_project_group(uuid, text, integer) to authenticated;

create or replace function delete_project_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from project_groups where id = p_group_id;
  if v_project_id is null then
    raise exception 'Group not found.';
  end if;
  perform _assert_project_instructor(v_project_id);

  if exists (select 1 from project_submissions where group_id = p_group_id) then
    raise exception 'This group has submissions on record — remove its members instead of deleting it, to keep submission history intact.';
  end if;

  delete from project_groups where id = p_group_id;
end;
$$;
grant execute on function delete_project_group(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Instructor-assigned membership: assign/move (one function handles
-- both — moving is just assigning while already in another group),
-- and remove. Always re-verifies the student is actually enrolled in
-- this course, and that at most one active membership per project.
-- ---------------------------------------------------------------------

create or replace function assign_student_to_group(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_course_id uuid;
  v_capacity integer;
  v_current_count integer;
begin
  select project_id, capacity into v_project_id, v_capacity
  from project_groups where id = p_group_id
  for update;
  if v_project_id is null then
    raise exception 'Group not found.';
  end if;
  v_course_id := _assert_project_instructor(v_project_id);

  if not exists (
    select 1 from course_members
    where course_id = v_course_id and user_id = p_user_id and role = 'student'
  ) then
    raise exception 'That user is not an enrolled student in this course.';
  end if;

  -- Already a member of this exact group — nothing to do.
  if exists (select 1 from project_group_members where group_id = p_group_id and user_id = p_user_id) then
    return;
  end if;

  if v_capacity is not null then
    select count(*) into v_current_count from project_group_members where group_id = p_group_id;
    if v_current_count >= v_capacity then
      raise exception 'This group is at capacity (%).', v_capacity;
    end if;
  end if;

  -- Move semantics: remove any existing membership elsewhere in this project first.
  delete from project_group_members
  where user_id = p_user_id
    and group_id in (select id from project_groups where project_id = v_project_id);

  insert into project_group_members (group_id, user_id) values (p_group_id, p_user_id);
end;
$$;
grant execute on function assign_student_to_group(uuid, uuid) to authenticated;

create or replace function remove_student_from_group(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from project_groups where id = p_group_id;
  if v_project_id is null then
    raise exception 'Group not found.';
  end if;
  perform _assert_project_instructor(v_project_id);
  delete from project_group_members where group_id = p_group_id and user_id = p_user_id;
end;
$$;
grant execute on function remove_student_from_group(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Student self-enrollment: capacity-safe via `for update` row lock on
-- the target group (small pilot scale — a per-group lock is enough to
-- close the race, no global serialization needed). Switching groups is
-- allowed until locked; joining removes any prior membership in the
-- same project first, same "one active group per project" invariant
-- as the instructor-assigned path.
-- ---------------------------------------------------------------------

create or replace function join_project_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_course_id uuid;
  v_capacity integer;
  v_current_count integer;
  v_group_mode text;
  v_locked boolean;
begin
  select project_id, capacity into v_project_id, v_capacity
  from project_groups where id = p_group_id
  for update;
  if v_project_id is null then
    raise exception 'Group not found.';
  end if;

  select course_id, group_mode, groups_locked into v_course_id, v_group_mode, v_locked
  from projects where id = v_project_id;

  if current_course_role(v_course_id) is distinct from 'student' then
    raise exception 'Not authorized.';
  end if;
  if v_group_mode != 'self_enrollment' then
    raise exception 'Groups for this project are assigned by the instructor.';
  end if;
  if v_locked then
    raise exception 'Groups are locked for this project. Contact your instructor to change groups.';
  end if;

  if exists (select 1 from project_group_members where group_id = p_group_id and user_id = auth.uid()) then
    return;
  end if;

  if v_capacity is not null then
    select count(*) into v_current_count from project_group_members where group_id = p_group_id;
    if v_current_count >= v_capacity then
      raise exception 'This group is full.';
    end if;
  end if;

  delete from project_group_members
  where user_id = auth.uid()
    and group_id in (select id from project_groups where project_id = v_project_id);

  insert into project_group_members (group_id, user_id) values (p_group_id, auth.uid());
end;
$$;
grant execute on function join_project_group(uuid) to authenticated;

create or replace function leave_project_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_course_id uuid;
  v_group_mode text;
  v_locked boolean;
begin
  select project_id into v_project_id from project_groups where id = p_group_id;
  if v_project_id is null then
    raise exception 'Group not found.';
  end if;
  select course_id, group_mode, groups_locked into v_course_id, v_group_mode, v_locked
  from projects where id = v_project_id;

  if current_course_role(v_course_id) is distinct from 'student' then
    raise exception 'Not authorized.';
  end if;
  if v_group_mode != 'self_enrollment' then
    raise exception 'Groups for this project are assigned by the instructor.';
  end if;
  if v_locked then
    raise exception 'Groups are locked for this project. Contact your instructor to change groups.';
  end if;

  delete from project_group_members where group_id = p_group_id and user_id = auth.uid();
end;
$$;
grant execute on function leave_project_group(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Deliverables CRUD (instructor-only). Delete is blocked once a
-- submission exists — unpublish instead, so submission history is
-- never silently destroyed.
-- ---------------------------------------------------------------------

create or replace function create_project_deliverable(
  p_project_id uuid,
  p_title text,
  p_description text,
  p_due_at timestamptz,
  p_submission_enabled boolean,
  p_allowed_type text,
  p_published boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_position integer;
begin
  perform _assert_project_instructor(p_project_id);
  select coalesce(max(position), 0) + 1 into v_position from project_deliverables where project_id = p_project_id;
  insert into project_deliverables (project_id, title, description, due_at, position, submission_enabled, allowed_type, published)
  values (p_project_id, p_title, coalesce(p_description, ''), p_due_at, v_position, p_submission_enabled, nullif(p_allowed_type, ''), p_published)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function create_project_deliverable(uuid, text, text, timestamptz, boolean, text, boolean) to authenticated;

create or replace function update_project_deliverable(
  p_deliverable_id uuid,
  p_title text,
  p_description text,
  p_due_at timestamptz,
  p_submission_enabled boolean,
  p_allowed_type text,
  p_published boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from project_deliverables where id = p_deliverable_id;
  if v_project_id is null then
    raise exception 'Deliverable not found.';
  end if;
  perform _assert_project_instructor(v_project_id);
  update project_deliverables
  set title = p_title,
      description = coalesce(p_description, ''),
      due_at = p_due_at,
      submission_enabled = p_submission_enabled,
      allowed_type = nullif(p_allowed_type, ''),
      published = p_published
  where id = p_deliverable_id;
end;
$$;
grant execute on function update_project_deliverable(uuid, text, text, timestamptz, boolean, text, boolean) to authenticated;

create or replace function delete_project_deliverable(p_deliverable_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from project_deliverables where id = p_deliverable_id;
  if v_project_id is null then
    raise exception 'Deliverable not found.';
  end if;
  perform _assert_project_instructor(v_project_id);

  if exists (select 1 from project_submissions where deliverable_id = p_deliverable_id) then
    raise exception 'This deliverable has submissions on record — unpublish it instead of deleting it.';
  end if;

  delete from project_deliverables where id = p_deliverable_id;
end;
$$;
grant execute on function delete_project_deliverable(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Simple group-level grading (upsert).
-- ---------------------------------------------------------------------

create or replace function set_project_group_grade(
  p_project_id uuid,
  p_group_id uuid,
  p_score numeric,
  p_max_score numeric,
  p_feedback text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform _assert_project_instructor(p_project_id);
  if not exists (select 1 from project_groups where id = p_group_id and project_id = p_project_id) then
    raise exception 'That group does not belong to this project.';
  end if;

  insert into project_group_grades (project_id, group_id, score, max_score, feedback, graded_by, graded_at)
  values (p_project_id, p_group_id, p_score, p_max_score, p_feedback, auth.uid(), now())
  on conflict (project_id, group_id)
  do update set score = excluded.score, max_score = excluded.max_score, feedback = excluded.feedback,
    graded_by = excluded.graded_by, graded_at = excluded.graded_at;
end;
$$;
grant execute on function set_project_group_grade(uuid, uuid, numeric, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- get_project_instructor_overview(): groups + members + capacities +
-- deliverable submission counts + grades, in one call for the
-- instructor workspace.
-- ---------------------------------------------------------------------

create or replace function get_project_instructor_overview(p_project_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform _assert_project_instructor(p_project_id);

  select jsonb_build_object(
    'groupMode', pr.group_mode,
    'groupsLocked', pr.groups_locked,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'groupId', g.id,
        'name', g.name,
        'capacity', g.capacity,
        'members', coalesce((
          select jsonb_agg(jsonb_build_object(
            'userId', m.user_id,
            'fullName', coalesce(p2.full_name, 'Unnamed student')
          ) order by coalesce(p2.full_name, ''))
          from project_group_members m
          left join profiles p2 on p2.user_id = m.user_id
          where m.group_id = g.id
        ), '[]'::jsonb),
        'grade', (
          select jsonb_build_object('score', gr.score, 'maxScore', gr.max_score, 'feedback', gr.feedback)
          from project_group_grades gr where gr.project_id = p_project_id and gr.group_id = g.id
        )
      ) order by g.name)
      from project_groups g where g.project_id = p_project_id
    ), '[]'::jsonb),
    'unassignedStudents', coalesce((
      select jsonb_agg(jsonb_build_object('userId', cm.user_id, 'fullName', coalesce(p3.full_name, 'Unnamed student')) order by coalesce(p3.full_name, ''))
      from course_members cm
      left join profiles p3 on p3.user_id = cm.user_id
      where cm.course_id = pr.course_id
        and cm.role = 'student'
        and not exists (
          select 1 from project_group_members m2
          join project_groups g2 on g2.id = m2.group_id
          where g2.project_id = p_project_id and m2.user_id = cm.user_id
        )
    ), '[]'::jsonb)
  ) into v_result
  from projects pr
  where pr.id = p_project_id;

  return v_result;
end;
$$;
grant execute on function get_project_instructor_overview(uuid) to authenticated;
