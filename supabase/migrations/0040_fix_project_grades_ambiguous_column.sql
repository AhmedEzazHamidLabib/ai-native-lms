-- get_course_project_grades() (0039) has an ambiguous-column bug: the
-- function's own `project_id` OUT parameter collides with
-- project_groups.project_id inside the membership subquery. Qualify it.

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
    and m.group_id in (select pg.id from project_groups pg where pg.project_id = p.id)
  left join project_groups g on g.id = m.group_id
  left join project_group_grades gr on gr.project_id = p.id and gr.group_id = g.id
  where cm.course_id = p_course_id and cm.role = 'student';
end;
$$;

grant execute on function get_course_project_grades(uuid) to authenticated;
