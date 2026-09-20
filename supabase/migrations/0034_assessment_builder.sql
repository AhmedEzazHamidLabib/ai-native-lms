-- Assessment Builder (Part 4): two question-selection modes feeding
-- the SAME secure attempt engine — no parallel engine. Additive:
-- assessment_rules gains an optional fixed_question_id (a pinned
-- question instead of a random-N-from-pool rule); assessments gains
-- explicit order-mode controls. start_attempt() is redefined to
-- honor both, preserving every existing safety property (membership
-- check, published/locked check, the 0012 race-condition fix).

alter table assessments
  add column if not exists selection_mode text not null default 'random'
    check (selection_mode in ('random', 'fixed')),
  add column if not exists question_order_mode text not null default 'shuffled'
    check (question_order_mode in ('fixed', 'shuffled')),
  add column if not exists option_order_mode text not null default 'shuffled'
    check (option_order_mode in ('fixed', 'shuffled'));

alter table assessment_rules
  add column if not exists fixed_question_id uuid references questions (id);

create or replace function start_attempt(p_assessment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assessment assessments%rowtype;
  v_bank_version integer;
  v_attempt_id uuid;
  v_rule record;
  v_rule_ids uuid[];
  v_all_ids uuid[] := '{}';
  v_ordered_ids uuid[];
  v_qid uuid;
  v_position integer := 0;
  v_option_order jsonb;
begin
  select * into v_assessment from assessments where id = p_assessment_id;
  if not found then
    raise exception 'Assessment not found.';
  end if;

  if current_course_role(v_assessment.course_id) is null then
    raise exception 'Not a member of this course.';
  end if;

  select id into v_attempt_id from attempts
    where assessment_id = p_assessment_id and user_id = auth.uid();
  if found then
    return v_attempt_id;
  end if;

  if v_assessment.published_at is null then
    raise exception 'This assessment is not available.';
  end if;
  if v_assessment.locked then
    raise exception 'This assessment is currently locked.';
  end if;

  select version into v_bank_version from question_banks where id = v_assessment.bank_id;

  insert into attempts (assessment_id, user_id, bank_version)
  values (p_assessment_id, auth.uid(), v_bank_version)
  on conflict (assessment_id, user_id) do nothing
  returning id into v_attempt_id;

  if v_attempt_id is null then
    -- Lost the race: a concurrent request already created this
    -- attempt between our SELECT above and this INSERT. Resume that
    -- one instead of erroring.
    select id into v_attempt_id from attempts
      where assessment_id = p_assessment_id and user_id = auth.uid();
    return v_attempt_id;
  end if;

  -- Build the ordered question list, rule by rule, in rule.position
  -- order — this order is what "fixed" question order means below.
  for v_rule in
    select * from assessment_rules where assessment_id = p_assessment_id order by position
  loop
    if v_rule.fixed_question_id is not null then
      v_rule_ids := array[v_rule.fixed_question_id];
    else
      select coalesce(array_agg(sub.id), '{}') into v_rule_ids
      from (
        select q.id from questions q
        where q.bank_id = v_assessment.bank_id
          and q.active
          and (v_rule.source_lecture_id is null or q.source_lecture_id = v_rule.source_lecture_id)
          and (v_rule.topic is null or q.topic = v_rule.topic)
          and (v_rule.difficulty is null or q.difficulty = v_rule.difficulty)
          and not (q.id = any(v_all_ids))
        order by random()
        limit v_rule.count
      ) sub;

      if array_length(v_rule_ids, 1) is null or array_length(v_rule_ids, 1) < v_rule.count then
        raise exception 'Not enough active questions to satisfy an assessment rule.';
      end if;
    end if;

    v_all_ids := v_all_ids || v_rule_ids;
  end loop;

  if v_assessment.question_order_mode = 'shuffled' then
    select array_agg(qid order by random()) into v_ordered_ids from unnest(v_all_ids) as qid;
  else
    v_ordered_ids := v_all_ids; -- rule-position order, exactly as built above
  end if;

  foreach v_qid in array v_ordered_ids loop
    v_position := v_position + 1;

    if v_assessment.option_order_mode = 'shuffled' then
      select jsonb_agg(o.id order by random()) into v_option_order
      from question_options o
      where o.question_id = v_qid;
    else
      select jsonb_agg(o.id order by o.position) into v_option_order
      from question_options o
      where o.question_id = v_qid;
    end if;

    insert into attempt_questions (attempt_id, question_id, position, option_order)
    values (v_attempt_id, v_qid, v_position, v_option_order);
  end loop;

  return v_attempt_id;
end;
$$;

-- ---------------------------------------------------------------------
-- create_assessment(): the one instructor entry point for Mock/Class
-- Test creation — validates the Class Test / Practice-visibility
-- integrity rule server-side (never just a UI warning), and re-derives
-- instructor authorization itself.
-- ---------------------------------------------------------------------

create or replace function create_assessment(
  p_course_id uuid,
  p_bank_id uuid,
  p_title text,
  p_instructions text,
  p_kind assessment_kind,
  p_points_possible integer,
  p_selection_mode text,
  p_question_order_mode text,
  p_option_order_mode text,
  p_rules jsonb -- [{position, sourceLectureId, topic, difficulty, count, fixedQuestionId}]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bank_id uuid := p_bank_id;
  v_assessment_id uuid;
  v_question_count integer := 0;
  v_rule jsonb;
  v_practice_leak_count integer;
  v_contributes boolean;
begin
  if current_course_role(p_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;
  if p_kind = 'project' then
    raise exception 'Projects are configured through the Project workspace, not the assessment builder.';
  end if;

  if v_bank_id is null or not exists (select 1 from question_banks where id = v_bank_id and course_id = p_course_id) then
    raise exception 'Could not determine a question bank for this assessment.';
  end if;

  -- Every fixed question (if any) must actually belong to the chosen bank —
  -- never trust the client's pairing of bank + question ids.
  if exists (
    select 1 from jsonb_array_elements(p_rules) r
    join questions q on q.id = (r->>'fixedQuestionId')::uuid
    where q.bank_id != v_bank_id
  ) then
    raise exception 'One or more selected questions do not belong to this question bank.';
  end if;

  v_contributes := (p_kind = 'class_test');

  -- Integrity rule: a graded Class Test must not use Practice-visible
  -- questions unless every one of them has already been explicitly
  -- switched to hidden — never silently allowed.
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
      assessment_id, position, source_lecture_id, topic, difficulty, count, fixed_question_id
    ) values (
      v_assessment_id,
      (v_rule->>'position')::integer,
      nullif(v_rule->>'sourceLectureId', '')::uuid,
      nullif(v_rule->>'topic', ''),
      nullif(v_rule->>'difficulty', ''),
      coalesce((v_rule->>'count')::integer, 1),
      nullif(v_rule->>'fixedQuestionId', '')::uuid
    );
    v_question_count := v_question_count + coalesce((v_rule->>'count')::integer, 1);
  end loop;

  update assessments set question_count = v_question_count where id = v_assessment_id;

  return v_assessment_id;
end;
$$;

grant execute on function create_assessment(uuid, uuid, text, text, assessment_kind, integer, text, text, text, jsonb) to authenticated;
