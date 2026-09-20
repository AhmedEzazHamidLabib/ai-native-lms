-- get_my_project_group() is SECURITY DEFINER and therefore bypasses the
-- project_deliverables RLS policy entirely — it was already filtering
-- nothing by visibility before 0035 added the `published` column, so
-- it would otherwise leak draft/unpublished deliverables to students.
-- Also surfaces submission_enabled/allowed_type so the student UI can
-- correctly disable the submit form when closed.

create or replace function get_my_project_group(p_project_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_course_id uuid;
  v_group_id uuid;
  v_result jsonb;
begin
  select course_id into v_course_id from projects where id = p_project_id;
  if v_course_id is null or current_course_role(v_course_id) is null then
    raise exception 'Not authorized.';
  end if;

  select g.id into v_group_id
  from project_groups g
  join project_group_members m on m.group_id = g.id
  where g.project_id = p_project_id and m.user_id = auth.uid();

  if v_group_id is null then
    return jsonb_build_object('group', null);
  end if;

  select jsonb_build_object(
    'groupId', v_group_id,
    'deliverables', coalesce(jsonb_agg(jsonb_build_object(
      'deliverableId', d.id,
      'title', d.title,
      'description', d.description,
      'dueAt', d.due_at,
      'position', d.position,
      'submissionEnabled', d.submission_enabled,
      'allowedType', d.allowed_type,
      'submitted', s.id is not null,
      'submittedAt', s.submitted_at,
      'submittedByUserId', s.submitted_by_user_id,
      'submittedByName', coalesce(pr.full_name, 'A group member'),
      'note', s.note
    ) order by d.position), '[]'::jsonb)
  ) into v_result
  from project_deliverables d
  left join project_submissions s
    on s.deliverable_id = d.id and s.group_id = v_group_id and s.superseded_at is null
  left join profiles pr on pr.user_id = s.submitted_by_user_id
  where d.project_id = p_project_id and d.published;

  return v_result;
end;
$$;

grant execute on function get_my_project_group(uuid) to authenticated;
