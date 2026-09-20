-- Security fix: reintroduced NULL-check regression from migration 0011.
--
-- `if current_course_role(p_course_id) != 'instructor' then raise
-- exception` never fires for a caller with NO relationship to the
-- course at all (current_course_role() returns NULL for a non-member,
-- and `IF NULL THEN ...` is false in PL/pgSQL's three-valued logic —
-- see 0011_fix_null_instructor_check.sql for the original writeup and
-- fix). Every migration after 0011 that added a new instructor-only
-- SECURITY DEFINER function reused the vulnerable `!=` idiom instead
-- of the established `is distinct from` fix, silently reopening the
-- same hole across 32 functions.
--
-- Found this pass via the CSE 1203 test-data cleanup: with the dev
-- fixture accounts no longer permanently enrolled in CSE 1203,
-- calendar.integration.test.ts's "student cannot change the course
-- schedule directly" test caught a signed-in user with ZERO
-- relationship to CSE 1203 successfully calling set_course_schedule.
-- Auditing every function using the same `!= 'instructor'` pattern
-- against the live database (not just migration file history, since
-- later CREATE OR REPLACE calls can silently supersede earlier fixes)
-- found 32 currently-live functions with this exact bug,
-- fixed here in one pass exactly as 0011 did.
--
-- Impact before this fix: any authenticated user — including one not
-- enrolled in ANY course — could call these functions against an
-- arbitrary course_id/assessment_id/etc. they have no relationship to,
-- including creating/renaming/archiving/deleting course content,
-- grading written responses, reading private per-student evidence,
-- pausing AI, regenerating Course Intelligence, and rewriting the
-- course schedule.

CREATE OR REPLACE FUNCTION public._assert_project_instructor(p_project_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
begin
  select course_id into v_course_id from projects where id = p_project_id;
  if v_course_id is null then
    raise exception 'Project not found.';
  end if;
  if current_course_role(v_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;
  return v_course_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_assessment(p_course_id uuid, p_bank_id uuid, p_title text, p_instructions text, p_kind assessment_kind, p_points_possible integer, p_selection_mode text, p_question_order_mode text, p_option_order_mode text, p_rules jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_bank_id uuid := p_bank_id;
  v_assessment_id uuid;
  v_question_count integer := 0;
  v_rule jsonb;
  v_practice_leak_count integer;
  v_contributes boolean;
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;
  if p_kind = 'project' then
    raise exception 'Projects are configured through the Project workspace, not the assessment builder.';
  end if;

  if v_bank_id is null or not exists (select 1 from question_banks where id = v_bank_id and course_id = p_course_id) then
    raise exception 'Could not determine a question bank for this assessment.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rules) r
    join questions q on q.id = (r->>'fixedQuestionId')::uuid
    where q.bank_id != v_bank_id
  ) then
    raise exception 'One or more selected questions do not belong to this question bank.';
  end if;

  v_contributes := (p_kind = 'class_test');

  if p_kind = 'class_test' then
    select count(*) into v_practice_leak_count
    from jsonb_array_elements(p_rules) r
    join questions q on q.id = (r->>'fixedQuestionId')::uuid
    where q.visibility = 'practice';

    if v_practice_leak_count > 0 then
      raise exception 'This Class Test includes % question(s) that are still Practice-visible. Switch them to Hidden in the Question Bank first, or choose different questions.', v_practice_leak_count;
    end if;
  end if;

  insert into assessments (
    course_id, bank_id, title, instructions, question_count,
    published_at, locked, kind, points_possible, contributes_to_grade,
    selection_mode, question_order_mode, option_order_mode
  ) values (
    p_course_id, v_bank_id, p_title, p_instructions, 0,
    null, true, p_kind, p_points_possible, v_contributes,
    p_selection_mode, p_question_order_mode, p_option_order_mode
  )
  returning id into v_assessment_id;

  for v_rule in select * from jsonb_array_elements(p_rules)
  loop
    insert into assessment_rules (
      assessment_id, position, source_lecture_id, topic, difficulty, count, fixed_question_id, question_type
    ) values (
      v_assessment_id,
      (v_rule->>'position')::integer,
      nullif(v_rule->>'sourceLectureId', '')::uuid,
      nullif(v_rule->>'topic', ''),
      nullif(v_rule->>'difficulty', ''),
      coalesce((v_rule->>'count')::integer, 1),
      nullif(v_rule->>'fixedQuestionId', '')::uuid,
      nullif(v_rule->>'questionType', '')
    );
    v_question_count := v_question_count + coalesce((v_rule->>'count')::integer, 1);
  end loop;

  update assessments set question_count = v_question_count where id = v_assessment_id;

  return v_assessment_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_course_event(p_course_id uuid, p_event_date date, p_category course_event_category, p_title text, p_details text, p_announcement_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;

  insert into course_events (course_id, event_date, category, title, details, announcement_id, created_by)
  values (p_course_id, p_event_date, p_category, p_title, p_details, p_announcement_id, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_course_event(p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
begin
  select course_id into v_course_id from course_events where id = p_event_id;
  if v_course_id is null then
    raise exception 'Event not found.';
  end if;
  if current_course_role(v_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;
  delete from course_events where id = p_event_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_lecture_if_unused(p_lecture_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
  v_material_count integer;
  v_objective_count integer;
  v_question_count integer;
  v_session_count integer;
begin
  select u.course_id into v_course_id from lectures l join units u on u.id = l.unit_id where l.id = p_lecture_id;
  if v_course_id is null then raise exception 'Lecture not found.'; end if;
  if current_course_role(v_course_id) is distinct from 'instructor' then raise exception 'Not authorized.'; end if;

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
$function$;

CREATE OR REPLACE FUNCTION public.delete_material_if_unused(p_material_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if current_course_role(v_course_id) is distinct from 'instructor' then raise exception 'Not authorized.'; end if;

  if v_was_published then
    raise exception 'This material is published or was published before and cannot be permanently deleted. Archive it instead.';
  end if;

  select count(*) into v_chunk_count from material_chunks where material_id = p_material_id;
  if v_chunk_count > 0 then
    raise exception 'This material has extracted content used by the AI Tutor and cannot be permanently deleted. Archive it instead.';
  end if;

  delete from materials where id = p_material_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_unit_if_unused(p_unit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
  v_lecture_count integer;
begin
  select course_id into v_course_id from units where id = p_unit_id;
  if v_course_id is null then raise exception 'Unit not found.'; end if;
  if current_course_role(v_course_id) is distinct from 'instructor' then raise exception 'Not authorized.'; end if;

  select count(*) into v_lecture_count from lectures where unit_id = p_unit_id;
  if v_lecture_count > 0 then
    raise exception 'This unit has % lecture(s) and cannot be permanently deleted. Archive it instead.', v_lecture_count;
  end if;

  delete from units where id = p_unit_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fail_learning_objective_intelligence(p_learning_objective_id uuid, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
begin
  select course_id into v_course_id from learning_objectives where id = p_learning_objective_id;
  if v_course_id is null then
    raise exception 'Learning objective not found.';
  end if;
  if current_course_role(v_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;

  update learning_objective_intelligence
  set status = 'failed', error = p_error, updated_at = now()
  where learning_objective_id = p_learning_objective_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_course_ai_usage_today(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;

  select jsonb_build_object(
    'studentGenerationsToday', count(*) filter (where role = 'student' and status != 'failed'),
    'inputTokensToday', coalesce(sum(input_tokens) filter (where status = 'success'), 0),
    'outputTokensToday', coalesce(sum(output_tokens) filter (where status = 'success'), 0),
    'failedToday', count(*) filter (where status = 'failed')
  ) into v_result
  from ai_generation_events
  where course_id = p_course_id and created_at >= current_date;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_course_gradebook(p_course_id uuid)
 RETURNS TABLE(user_id uuid, user_email text, assessment_id uuid, assessment_title text, assessment_kind assessment_kind, points_possible integer, contributes_to_grade boolean, attempt_id uuid, status text, score integer, max_score integer, submitted_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;

  return query
  select
    cm.user_id,
    u.email::text as user_email,
    a.id as assessment_id,
    a.title as assessment_title,
    a.kind as assessment_kind,
    a.points_possible,
    a.contributes_to_grade,
    att.id as attempt_id,
    case
      when att.submitted_at is not null then 'submitted'
      when att.id is not null then 'in_progress'
      else 'not_started'
    end as status,
    att.score,
    att.max_score,
    att.submitted_at
  from course_members cm
  join auth.users u on u.id = cm.user_id
  cross join assessments a
  left join attempts att on att.assessment_id = a.id and att.user_id = cm.user_id
  where cm.course_id = p_course_id
    and cm.role = 'student'
    and a.course_id = p_course_id
    and a.kind != 'project';
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_course_intelligence_status(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
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
$function$;

CREATE OR REPLACE FUNCTION public.get_course_project_grades(p_course_id uuid)
 RETURNS TABLE(user_id uuid, project_id uuid, group_id uuid, group_name text, score numeric, max_score numeric, feedback text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
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
$function$;

CREATE OR REPLACE FUNCTION public.get_student_objective_evidence_for_instructor(p_course_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;

  select coalesce(jsonb_agg(x order by x.position), '[]'::jsonb) into v_result
  from (
    select
      lo.id as learning_objective_id,
      lo.title,
      lo.position,
      count(*) filter (where o.is_correct) as correct,
      count(*) as attempted
    from learning_objectives lo
    join questions q on q.learning_objective_id = lo.id
    join attempt_questions aq on aq.question_id = q.id
    join attempts att on att.id = aq.attempt_id
    join assessments a on a.id = att.assessment_id
    left join responses r on r.attempt_id = aq.attempt_id and r.question_id = aq.question_id
    left join question_options o on o.id = r.selected_option_id
    where lo.course_id = p_course_id
      and a.course_id = p_course_id
      and att.user_id = p_user_id
      and att.submitted_at is not null
    group by lo.id, lo.title, lo.position
  ) x;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_student_practice_evidence_for_instructor(p_course_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;

  select coalesce(jsonb_agg(x order by x.position), '[]'::jsonb) into v_result
  from (
    select
      lo.id as learning_objective_id,
      lo.title,
      lo.position,
      count(*) filter (where pa.correct) as correct,
      count(*) filter (where pa.answered_at is not null) as attempted
    from learning_objectives lo
    join practice_attempts pa on pa.learning_objective_id = lo.id
    where lo.course_id = p_course_id
      and pa.course_id = p_course_id
      and pa.user_id = p_user_id
    group by lo.id, lo.title, lo.position
  ) x;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.grade_written_response(p_attempt_id uuid, p_question_id uuid, p_is_correct boolean, p_grading_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
  v_correct integer;
  v_total integer;
  v_pending integer;
begin
  select a.course_id into v_course_id
  from attempts att join assessments a on a.id = att.assessment_id
  where att.id = p_attempt_id;
  if v_course_id is null then
    raise exception 'Attempt not found.';
  end if;
  if current_course_role(v_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;

  update responses
  set is_correct_manual = p_is_correct, graded_by = auth.uid(), graded_at = now(), grading_note = p_grading_note
  where attempt_id = p_attempt_id and question_id = p_question_id;

  if not found then
    raise exception 'No response recorded for that question on this attempt.';
  end if;

  select count(*) into v_total from attempt_questions where attempt_id = p_attempt_id;

  select count(*) into v_correct
  from attempt_questions aq
  join questions q on q.id = aq.question_id
  left join responses r on r.attempt_id = aq.attempt_id and r.question_id = aq.question_id
  left join question_options o on o.id = r.selected_option_id
  where aq.attempt_id = p_attempt_id
    and (
      (q.question_type = 'single_choice' and o.is_correct)
      or (q.question_type = 'written' and r.is_correct_manual = true)
    );

  select count(*) into v_pending
  from attempt_questions aq
  join questions q on q.id = aq.question_id
  left join responses r on r.attempt_id = aq.attempt_id and r.question_id = aq.question_id
  where aq.attempt_id = p_attempt_id
    and q.question_type = 'written'
    and (r.is_correct_manual is null);

  update attempts set score = v_correct, max_score = v_total, pending_grading_count = v_pending where id = p_attempt_id;

  return jsonb_build_object('score', v_correct, 'maxScore', v_total, 'pendingGradingCount', v_pending);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_course_roster(p_course_id uuid)
 RETURNS TABLE(user_id uuid, email text, full_name text, enrolled_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
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
$function$;

CREATE OR REPLACE FUNCTION public.list_pending_requests(p_course_id uuid)
 RETURNS TABLE(request_id uuid, user_id uuid, email text, full_name text, requested_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
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
$function$;

CREATE OR REPLACE FUNCTION public.rename_lecture(p_lecture_id uuid, p_title text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
begin
  select u.course_id into v_course_id from lectures l join units u on u.id = l.unit_id where l.id = p_lecture_id;
  if v_course_id is null then raise exception 'Lecture not found.'; end if;
  if current_course_role(v_course_id) is distinct from 'instructor' then raise exception 'Not authorized.'; end if;
  if btrim(p_title) = '' then raise exception 'Title cannot be empty.'; end if;
  update lectures set title = btrim(p_title) where id = p_lecture_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rename_material(p_material_id uuid, p_title text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
begin
  select u.course_id into v_course_id
  from materials m join lectures l on l.id = m.lecture_id join units u on u.id = l.unit_id
  where m.id = p_material_id;
  if v_course_id is null then raise exception 'Material not found.'; end if;
  if current_course_role(v_course_id) is distinct from 'instructor' then raise exception 'Not authorized.'; end if;
  if btrim(p_title) = '' then raise exception 'Title cannot be empty.'; end if;
  update materials set title = btrim(p_title) where id = p_material_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rename_unit(p_unit_id uuid, p_title text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
begin
  select course_id into v_course_id from units where id = p_unit_id;
  if v_course_id is null then raise exception 'Unit not found.'; end if;
  if current_course_role(v_course_id) is distinct from 'instructor' then raise exception 'Not authorized.'; end if;
  if btrim(p_title) = '' then raise exception 'Title cannot be empty.'; end if;
  update units set title = btrim(p_title) where id = p_unit_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reorder_lecture(p_lecture_id uuid, p_direction text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if current_course_role(v_course_id) is distinct from 'instructor' then raise exception 'Not authorized.'; end if;

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
$function$;

CREATE OR REPLACE FUNCTION public.reorder_material(p_material_id uuid, p_direction text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if current_course_role(v_course_id) is distinct from 'instructor' then raise exception 'Not authorized.'; end if;

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
$function$;

CREATE OR REPLACE FUNCTION public.reorder_unit(p_unit_id uuid, p_direction text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
  v_position integer;
  v_swap_id uuid;
  v_swap_position integer;
begin
  select course_id, position into v_course_id, v_position from units where id = p_unit_id;
  if v_course_id is null then raise exception 'Unit not found.'; end if;
  if current_course_role(v_course_id) is distinct from 'instructor' then raise exception 'Not authorized.'; end if;

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
$function$;

CREATE OR REPLACE FUNCTION public.set_course_ai_paused(p_course_id uuid, p_paused boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;

  insert into course_ai_settings (course_id, ai_paused, updated_at)
  values (p_course_id, p_paused, now())
  on conflict (course_id) do update set ai_paused = excluded.ai_paused, updated_at = now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_course_roster_visibility(p_course_id uuid, p_visible boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;
  update courses set students_can_see_roster = p_visible where id = p_course_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_course_schedule(p_course_id uuid, p_start_date date, p_end_date date, p_meeting_days text[], p_meeting_start_time time without time zone, p_meeting_end_time time without time zone, p_timezone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;
  if p_start_date is not null and p_end_date is not null and p_end_date < p_start_date then
    raise exception 'End date cannot be before start date.';
  end if;
  if not (p_meeting_days <@ array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']::text[]) then
    raise exception 'Invalid meeting day.';
  end if;

  update courses
  set start_date = p_start_date,
      end_date = p_end_date,
      meeting_days = coalesce(p_meeting_days, '{}'),
      meeting_start_time = p_meeting_start_time,
      meeting_end_time = p_meeting_end_time,
      timezone = coalesce(p_timezone, 'UTC')
  where id = p_course_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_lecture_archived(p_lecture_id uuid, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
begin
  select u.course_id into v_course_id from lectures l join units u on u.id = l.unit_id where l.id = p_lecture_id;
  if v_course_id is null then raise exception 'Lecture not found.'; end if;
  if current_course_role(v_course_id) is distinct from 'instructor' then raise exception 'Not authorized.'; end if;
  update lectures
  set archived_at = case when p_archived then now() else null end,
      published_at = case when p_archived then null else published_at end
  where id = p_lecture_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_material_archived(p_material_id uuid, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
begin
  select u.course_id into v_course_id
  from materials m join lectures l on l.id = m.lecture_id join units u on u.id = l.unit_id
  where m.id = p_material_id;
  if v_course_id is null then raise exception 'Material not found.'; end if;
  if current_course_role(v_course_id) is distinct from 'instructor' then raise exception 'Not authorized.'; end if;
  update materials
  set archived_at = case when p_archived then now() else null end,
      published_at = case when p_archived then null else published_at end
  where id = p_material_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_unit_archived(p_unit_id uuid, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
begin
  select course_id into v_course_id from units where id = p_unit_id;
  if v_course_id is null then raise exception 'Unit not found.'; end if;
  if current_course_role(v_course_id) is distinct from 'instructor' then raise exception 'Not authorized.'; end if;
  update units set archived_at = case when p_archived then now() else null end where id = p_unit_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_intelligence_regeneration(p_learning_objective_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if current_course_role(v_course_id) is distinct from 'instructor' then
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
$function$;

CREATE OR REPLACE FUNCTION public.upsert_session_note(p_course_id uuid, p_session_date date, p_title text, p_agenda text, p_related_lecture_id uuid, p_related_assessment_id uuid, p_cancelled boolean, p_announcement_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if current_course_role(p_course_id) is distinct from 'instructor' then
    raise exception 'Not authorized.';
  end if;

  insert into course_session_notes (
    course_id, session_date, title, agenda, related_lecture_id, related_assessment_id, cancelled, announcement_id
  ) values (
    p_course_id, p_session_date, p_title, p_agenda, p_related_lecture_id, p_related_assessment_id,
    coalesce(p_cancelled, false), p_announcement_id
  )
  on conflict (course_id, session_date) do update set
    title = excluded.title,
    agenda = excluded.agenda,
    related_lecture_id = excluded.related_lecture_id,
    related_assessment_id = excluded.related_assessment_id,
    cancelled = excluded.cancelled,
    announcement_id = coalesce(excluded.announcement_id, course_session_notes.announcement_id),
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.write_learning_objective_intelligence(p_learning_objective_id uuid, p_canonical_explanation text, p_key_facts jsonb, p_common_misconceptions jsonb, p_analogies jsonb, p_teaching_progression jsonb, p_practice_generation_guidance text, p_source_hash text, p_model text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
begin
  select course_id into v_course_id from learning_objectives where id = p_learning_objective_id;
  if v_course_id is null then
    raise exception 'Learning objective not found.';
  end if;
  if current_course_role(v_course_id) is distinct from 'instructor' then
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
$function$;
