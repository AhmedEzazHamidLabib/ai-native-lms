-- Course Intelligence status/rebuild (Part 14). learning_objective_intelligence
-- has NO client write policy at all (only the service-role compiler
-- script writes it) — these RPCs are the one narrow, re-authorized
-- exception that lets an instructor trigger a rebuild from the app.
-- The actual Sonnet call still happens exactly once, server-side, in
-- the Next.js action that calls these — never in the runtime tutor
-- path, and never reachable by a student.

create or replace function get_course_intelligence_status(p_course_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if current_course_role(p_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;

  select coalesce(jsonb_agg(x order by x.position), '[]'::jsonb) into v_result
  from (
    select
      lo.id as learning_objective_id,
      lo.title,
      lo.position,
      coalesce(loi.status, 'missing') as status,
      loi.generated_at,
      loi.model,
      loi.error,
      (select count(*) from material_chunks mc where mc.learning_objective_id = lo.id) as chunk_count
    from learning_objectives lo
    left join learning_objective_intelligence loi on loi.learning_objective_id = lo.id
    where lo.course_id = p_course_id
  ) x;

  return v_result;
end;
$$;

grant execute on function get_course_intelligence_status(uuid) to authenticated;

-- Marks the objective 'generating' and returns everything the caller
-- needs to run the analysis model itself (title/description/material,
-- source hash to persist on success) — re-verifies instructor auth,
-- never trusts a client-supplied course_id/objective pairing.
create or replace function start_intelligence_regeneration(p_learning_objective_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_title text;
  v_description text;
  v_chunks text[];
begin
  select course_id, title, description into v_course_id, v_title, v_description
  from learning_objectives where id = p_learning_objective_id;
  if v_course_id is null then
    raise exception 'Learning objective not found.';
  end if;
  if current_course_role(v_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;

  select coalesce(array_agg(content order by position), '{}') into v_chunks
  from material_chunks where learning_objective_id = p_learning_objective_id;

  if array_length(v_chunks, 1) is null or array_length(v_chunks, 1) = 0 then
    raise exception 'No source material has been chunked for this objective yet.';
  end if;

  update learning_objective_intelligence
  set status = 'generating', updated_at = now()
  where learning_objective_id = p_learning_objective_id;

  return jsonb_build_object(
    'title', v_title,
    'description', v_description,
    'sourceMaterial', array_to_string(v_chunks, E'\n\n---\n\n')
  );
end;
$$;

grant execute on function start_intelligence_regeneration(uuid) to authenticated;

create or replace function write_learning_objective_intelligence(
  p_learning_objective_id uuid,
  p_canonical_explanation text,
  p_key_facts jsonb,
  p_common_misconceptions jsonb,
  p_analogies jsonb,
  p_teaching_progression jsonb,
  p_practice_generation_guidance text,
  p_source_hash text,
  p_model text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  select course_id into v_course_id from learning_objectives where id = p_learning_objective_id;
  if v_course_id is null then
    raise exception 'Learning objective not found.';
  end if;
  if current_course_role(v_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;

  update learning_objective_intelligence
  set canonical_explanation = p_canonical_explanation,
      key_facts = p_key_facts,
      common_misconceptions = p_common_misconceptions,
      analogies = p_analogies,
      teaching_progression = p_teaching_progression,
      practice_generation_guidance = p_practice_generation_guidance,
      source_hash = p_source_hash,
      model = p_model,
      status = 'ready',
      error = null,
      generated_at = now(),
      updated_at = now()
  where learning_objective_id = p_learning_objective_id;
end;
$$;

grant execute on function write_learning_objective_intelligence(uuid, text, jsonb, jsonb, jsonb, jsonb, text, text, text) to authenticated;

create or replace function fail_learning_objective_intelligence(p_learning_objective_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  select course_id into v_course_id from learning_objectives where id = p_learning_objective_id;
  if v_course_id is null then
    raise exception 'Learning objective not found.';
  end if;
  if current_course_role(v_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;

  update learning_objective_intelligence
  set status = 'failed', error = p_error, updated_at = now()
  where learning_objective_id = p_learning_objective_id;
end;
$$;

grant execute on function fail_learning_objective_intelligence(uuid, text) to authenticated;
