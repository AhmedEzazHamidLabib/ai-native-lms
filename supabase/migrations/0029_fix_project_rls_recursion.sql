-- BUG FIX: project_groups' RLS policy queried project_group_members,
-- and project_group_members' RLS policy queried project_groups —
-- direct circular RLS dependency, causing "infinite recursion detected
-- in policy for relation project_group_members" on ANY query that
-- touched either table (including, transitively, the
-- project-submissions storage policies, which broke signed-URL
-- generation for the UNRELATED course-materials bucket too, since
-- Postgres must validate every OR'd policy branch for a statement).
--
-- Fix: two SECURITY DEFINER helper functions — same pattern as
-- current_course_role() — that read the tables directly (bypassing
-- RLS, since they run as the function owner) instead of the policies
-- re-triggering each other's RLS. Same authorization semantics as
-- before, just no self-reference.

create or replace function is_project_group_member(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from project_group_members m
    where m.group_id = p_group_id and m.user_id = auth.uid()
  );
$$;

grant execute on function is_project_group_member(uuid) to authenticated;

create or replace function is_instructor_for_project_group(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from project_groups g
    join projects p on p.id = g.project_id
    where g.id = p_group_id and current_course_role(p.course_id) = 'instructor'
  );
$$;

grant execute on function is_instructor_for_project_group(uuid) to authenticated;

drop policy if exists "own group or course instructor can read group row" on project_groups;
create policy "own group or course instructor can read group row"
on project_groups for select
to authenticated
using (
  is_project_group_member(project_groups.id)
  or exists (
    select 1 from projects p
    where p.id = project_groups.project_id and current_course_role(p.course_id) = 'instructor'
  )
);

drop policy if exists "own membership or course instructor can read" on project_group_members;
create policy "own membership or course instructor can read"
on project_group_members for select
to authenticated
using (
  user_id = auth.uid()
  or is_instructor_for_project_group(project_group_members.group_id)
);
