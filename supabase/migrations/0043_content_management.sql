-- Content management completion (Part 1/15): rename, reorder,
-- archive/restore, and dependency-aware delete for Units, Lectures,
-- and Materials. Archiving (not deleting) is the default safety net —
-- it auto-unpublishes and hides the item from the active instructor
-- view without ever touching student evidence, Course Intelligence,
-- assessment history, or Tutor provenance, all of which reference
-- these rows by id. Hard delete is only ever allowed when nothing
-- would be lost by it, checked in Postgres, not assumed by the UI.

alter table units add column if not exists archived_at timestamptz;
alter table lectures add column if not exists archived_at timestamptz;
alter table materials add column if not exists archived_at timestamptz;

-- ---------------------------------------------------------------------
-- Rename (trivial, but centralized so client-side validation — e.g.
-- non-empty title — has exactly one enforcement point per level).
-- ---------------------------------------------------------------------

create or replace function rename_unit(p_unit_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  select course_id into v_course_id from units where id = p_unit_id;
  if v_course_id is null then raise exception 'Unit not found.'; end if;
  if current_course_role(v_course_id) != 'instructor' then raise exception 'Not authorized.'; end if;
  if btrim(p_title) = '' then raise exception 'Title cannot be empty.'; end if;
  update units set title = btrim(p_title) where id = p_unit_id;
end;
$$;
grant execute on function rename_unit(uuid, text) to authenticated;

create or replace function rename_lecture(p_lecture_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  select u.course_id into v_course_id from lectures l join units u on u.id = l.unit_id where l.id = p_lecture_id;
  if v_course_id is null then raise exception 'Lecture not found.'; end if;
  if current_course_role(v_course_id) != 'instructor' then raise exception 'Not authorized.'; end if;
  if btrim(p_title) = '' then raise exception 'Title cannot be empty.'; end if;
  update lectures set title = btrim(p_title) where id = p_lecture_id;
end;
$$;
grant execute on function rename_lecture(uuid, text) to authenticated;

create or replace function rename_material(p_material_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  select u.course_id into v_course_id
  from materials m join lectures l on l.id = m.lecture_id join units u on u.id = l.unit_id
  where m.id = p_material_id;
  if v_course_id is null then raise exception 'Material not found.'; end if;
  if current_course_role(v_course_id) != 'instructor' then raise exception 'Not authorized.'; end if;
  if btrim(p_title) = '' then raise exception 'Title cannot be empty.'; end if;
  update materials set title = btrim(p_title) where id = p_material_id;
end;
$$;
grant execute on function rename_material(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Reorder: swap position with the immediately preceding/following
-- ACTIVE (non-archived) sibling — a lightweight "move up/down" control
-- rather than free drag-and-drop, matching the existing minimal UI.
-- ---------------------------------------------------------------------

create or replace function reorder_unit(p_unit_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_position integer;
  v_swap_id uuid;
  v_swap_position integer;
begin
  select course_id, position into v_course_id, v_position from units where id = p_unit_id;
  if v_course_id is null then raise exception 'Unit not found.'; end if;
  if current_course_role(v_course_id) != 'instructor' then raise exception 'Not authorized.'; end if;

  if p_direction = 'up' then
    select id, position into v_swap_id, v_swap_position from units
      where course_id = v_course_id and archived_at is null and position < v_position
      order by position desc limit 1;
  else
    select id, position into v_swap_id, v_swap_position from units
      where course_id = v_course_id and archived_at is null and position > v_position
      order by position asc limit 1;
  end if;

  if v_swap_id is null then return; end if;

  update units set position = v_swap_position where id = p_unit_id;
  update units set position = v_position where id = v_swap_id;
end;
$$;
grant execute on function reorder_unit(uuid, text) to authenticated;

create or replace function reorder_lecture(p_lecture_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_unit_id uuid;
  v_position integer;
  v_swap_id uuid;
  v_swap_position integer;
begin
  select u.course_id, l.unit_id, l.position into v_course_id, v_unit_id, v_position
  from lectures l join units u on u.id = l.unit_id where l.id = p_lecture_id;
  if v_course_id is null then raise exception 'Lecture not found.'; end if;
  if current_course_role(v_course_id) != 'instructor' then raise exception 'Not authorized.'; end if;

  if p_direction = 'up' then
    select id, position into v_swap_id, v_swap_position from lectures
      where unit_id = v_unit_id and archived_at is null and position < v_position
      order by position desc limit 1;
  else
    select id, position into v_swap_id, v_swap_position from lectures
      where unit_id = v_unit_id and archived_at is null and position > v_position
      order by position asc limit 1;
  end if;

  if v_swap_id is null then return; end if;

  update lectures set position = v_swap_position where id = p_lecture_id;
  update lectures set position = v_position where id = v_swap_id;
end;
$$;
grant execute on function reorder_lecture(uuid, text) to authenticated;

create or replace function reorder_material(p_material_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_lecture_id uuid;
  v_position integer;
  v_swap_id uuid;
  v_swap_position integer;
begin
  select u.course_id, m.lecture_id, m.position into v_course_id, v_lecture_id, v_position
  from materials m join lectures l on l.id = m.lecture_id join units u on u.id = l.unit_id
  where m.id = p_material_id;
  if v_course_id is null then raise exception 'Material not found.'; end if;
  if current_course_role(v_course_id) != 'instructor' then raise exception 'Not authorized.'; end if;

  if p_direction = 'up' then
    select id, position into v_swap_id, v_swap_position from materials
      where lecture_id = v_lecture_id and archived_at is null and position < v_position
      order by position desc limit 1;
  else
    select id, position into v_swap_id, v_swap_position from materials
      where lecture_id = v_lecture_id and archived_at is null and position > v_position
      order by position asc limit 1;
  end if;

  if v_swap_id is null then return; end if;

  update materials set position = v_swap_position where id = p_material_id;
  update materials set position = v_position where id = v_swap_id;
end;
$$;
grant execute on function reorder_material(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Archive / restore — always safe, always reversible, always
-- auto-unpublishes on archive so nothing archived stays visible to
-- students by accident.
-- ---------------------------------------------------------------------

create or replace function set_unit_archived(p_unit_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  select course_id into v_course_id from units where id = p_unit_id;
  if v_course_id is null then raise exception 'Unit not found.'; end if;
  if current_course_role(v_course_id) != 'instructor' then raise exception 'Not authorized.'; end if;
  update units set archived_at = case when p_archived then now() else null end where id = p_unit_id;
end;
$$;
grant execute on function set_unit_archived(uuid, boolean) to authenticated;

create or replace function set_lecture_archived(p_lecture_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  select u.course_id into v_course_id from lectures l join units u on u.id = l.unit_id where l.id = p_lecture_id;
  if v_course_id is null then raise exception 'Lecture not found.'; end if;
  if current_course_role(v_course_id) != 'instructor' then raise exception 'Not authorized.'; end if;
  update lectures
  set archived_at = case when p_archived then now() else null end,
      published_at = case when p_archived then null else published_at end
  where id = p_lecture_id;
end;
$$;
grant execute on function set_lecture_archived(uuid, boolean) to authenticated;

create or replace function set_material_archived(p_material_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  select u.course_id into v_course_id
  from materials m join lectures l on l.id = m.lecture_id join units u on u.id = l.unit_id
  where m.id = p_material_id;
  if v_course_id is null then raise exception 'Material not found.'; end if;
  if current_course_role(v_course_id) != 'instructor' then raise exception 'Not authorized.'; end if;
  update materials
  set archived_at = case when p_archived then now() else null end,
      published_at = case when p_archived then null else published_at end
  where id = p_material_id;
end;
$$;
grant execute on function set_material_archived(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Dependency-aware hard delete — only when truly nothing depends on
-- the row; otherwise a human-readable exception naming what's blocking
-- it, per Part 15's explicit example message shape.
-- ---------------------------------------------------------------------

create or replace function delete_unit_if_unused(p_unit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_lecture_count integer;
begin
  select course_id into v_course_id from units where id = p_unit_id;
  if v_course_id is null then raise exception 'Unit not found.'; end if;
  if current_course_role(v_course_id) != 'instructor' then raise exception 'Not authorized.'; end if;

  select count(*) into v_lecture_count from lectures where unit_id = p_unit_id;
  if v_lecture_count > 0 then
    raise exception 'This unit has % lecture(s) and cannot be permanently deleted. Archive it instead.', v_lecture_count;
  end if;

  delete from units where id = p_unit_id;
end;
$$;
grant execute on function delete_unit_if_unused(uuid) to authenticated;

create or replace function delete_lecture_if_unused(p_lecture_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_material_count integer;
  v_objective_count integer;
  v_question_count integer;
  v_session_count integer;
begin
  select u.course_id into v_course_id from lectures l join units u on u.id = l.unit_id where l.id = p_lecture_id;
  if v_course_id is null then raise exception 'Lecture not found.'; end if;
  if current_course_role(v_course_id) != 'instructor' then raise exception 'Not authorized.'; end if;

  select count(*) into v_material_count from materials where lecture_id = p_lecture_id;
  select count(*) into v_objective_count from learning_objectives where lecture_id = p_lecture_id;
  select count(*) into v_question_count from questions where source_lecture_id = p_lecture_id;
  select count(*) into v_session_count from course_session_notes where related_lecture_id = p_lecture_id;

  if v_material_count > 0 then
    raise exception 'This lecture has % material(s) and cannot be permanently deleted. Archive it instead.', v_material_count;
  end if;
  if v_objective_count > 0 or v_question_count > 0 then
    raise exception 'This lecture has learning objectives or questions mapped to it and cannot be permanently deleted. Archive it instead.';
  end if;
  if v_session_count > 0 then
    raise exception 'This lecture is referenced by a calendar session and cannot be permanently deleted. Archive it instead.';
  end if;

  delete from lectures where id = p_lecture_id;
end;
$$;
grant execute on function delete_lecture_if_unused(uuid) to authenticated;

create or replace function delete_material_if_unused(p_material_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_lecture_id uuid;
  v_was_published boolean;
  v_chunk_count integer;
begin
  select u.course_id, m.lecture_id, (m.published_at is not null) into v_course_id, v_lecture_id, v_was_published
  from materials m join lectures l on l.id = m.lecture_id join units u on u.id = l.unit_id
  where m.id = p_material_id;
  if v_course_id is null then raise exception 'Material not found.'; end if;
  if current_course_role(v_course_id) != 'instructor' then raise exception 'Not authorized.'; end if;

  if v_was_published then
    raise exception 'This material is published or was published before and cannot be permanently deleted. Archive it instead.';
  end if;

  select count(*) into v_chunk_count from material_chunks where material_id = p_material_id;
  if v_chunk_count > 0 then
    raise exception 'This material has extracted content used by the AI Tutor and cannot be permanently deleted. Archive it instead.';
  end if;

  delete from materials where id = p_material_id;
end;
$$;
grant execute on function delete_material_if_unused(uuid) to authenticated;
