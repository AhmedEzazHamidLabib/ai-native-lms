-- Written Q&A question type (Part 3/6): the assessment engine
-- currently hard-constrains question_type to 'single_choice' only —
-- there is no way to author or grade a free-text question at all.
-- This adds a second type, feeding the SAME engine
-- (start_attempt/save_response/submit_attempt/get_attempt_view) rather
-- than a parallel one, per the instruction not to build a separate
-- assessment path per question type.
--
-- Grading model: written responses are NEVER auto-graded. A response
-- is "pending" until an instructor manually marks it correct/incorrect
-- (optionally partial, via points). attempts.score/max_score keep
-- their existing meaning (correct count / total count) but a new
-- pending_grading_count makes "this score isn't final yet" explicit
-- rather than silently treating an ungraded written answer as wrong.

alter table questions drop constraint if exists questions_question_type_check;
alter table questions add constraint questions_question_type_check
  check (question_type in ('single_choice', 'written'));

alter table questions
  add column if not exists answer_guide text,
  add column if not exists explanation text;

alter table responses
  add column if not exists text_response text,
  add column if not exists is_correct_manual boolean,
  add column if not exists graded_by uuid references auth.users (id),
  add column if not exists graded_at timestamptz,
  add column if not exists grading_note text;

alter table attempts add column if not exists pending_grading_count integer not null default 0;

-- question_options' "exactly one correct option" unique index only
-- makes sense for single_choice; written questions simply have zero
-- options, so no constraint change is needed there — the create/edit
-- paths just never insert options for a written question.

-- ---------------------------------------------------------------------
-- start_attempt(): unchanged sampling/shuffling logic — a written
-- question just has an empty option_order (nothing to shuffle).
-- Re-declared only to keep behavior explicit and reviewed alongside
-- this migration; the actual SQL body is identical to 0034's version.
-- ---------------------------------------------------------------------

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
    select id into v_attempt_id from attempts
      where assessment_id = p_assessment_id and user_id = auth.uid();
    return v_attempt_id;
  end if;

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
          and (v_rule.question_type is null or q.question_type = v_rule.question_type)
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
    v_ordered_ids := v_all_ids;
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
    values (v_attempt_id, v_qid, v_position, coalesce(v_option_order, '[]'::jsonb));
  end loop;

  return v_attempt_id;
end;
$$;

-- assessment_rules gains an optional question_type filter, used above.
alter table assessment_rules add column if not exists question_type text
  check (question_type is null or question_type in ('single_choice', 'written'));

-- ---------------------------------------------------------------------
-- save_response(): now accepts EITHER an option (single_choice) or a
-- free-text answer (written) — validated against the question's own
-- type, never trusted from the client's framing of the call.
-- ---------------------------------------------------------------------

create or replace function save_response(
  p_attempt_id uuid,
  p_question_id uuid,
  p_selected_option_id uuid,
  p_text_response text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_question_type text;
begin
  if not exists (
    select 1 from attempts
    where id = p_attempt_id and user_id = auth.uid() and submitted_at is null
  ) then
    raise exception 'Attempt not found, not yours, or already submitted.';
  end if;

  if not exists (
    select 1 from attempt_questions
    where attempt_id = p_attempt_id and question_id = p_question_id
  ) then
    raise exception 'That question is not part of this attempt.';
  end if;

  select question_type into v_question_type from questions where id = p_question_id;

  if v_question_type = 'written' then
    insert into responses (attempt_id, question_id, text_response)
    values (p_attempt_id, p_question_id, nullif(btrim(p_text_response), ''))
    on conflict (attempt_id, question_id)
    do update set text_response = excluded.text_response, answered_at = now();
  else
    if p_selected_option_id is not null and not exists (
      select 1 from question_options
      where id = p_selected_option_id and question_id = p_question_id
    ) then
      raise exception 'That option does not belong to this question.';
    end if;

    insert into responses (attempt_id, question_id, selected_option_id)
    values (p_attempt_id, p_question_id, p_selected_option_id)
    on conflict (attempt_id, question_id)
    do update set selected_option_id = excluded.selected_option_id, answered_at = now();
  end if;
end;
$$;

grant execute on function save_response(uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- submit_attempt(): auto-grades single_choice as before; written
-- questions are counted toward max_score (they're still part of the
-- test) but never silently scored zero — pending_grading_count says
-- exactly how many are still awaiting a human.
-- ---------------------------------------------------------------------

create or replace function submit_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt attempts%rowtype;
  v_correct integer;
  v_total integer;
  v_pending integer;
begin
  select * into v_attempt from attempts where id = p_attempt_id;
  if not found then
    raise exception 'Attempt not found.';
  end if;
  if v_attempt.user_id != auth.uid() then
    raise exception 'Not authorized.';
  end if;

  if v_attempt.submitted_at is not null then
    return jsonb_build_object(
      'score', v_attempt.score, 'maxScore', v_attempt.max_score,
      'pendingGradingCount', v_attempt.pending_grading_count, 'alreadySubmitted', true
    );
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

  update attempts
  set submitted_at = now(), score = v_correct, max_score = v_total, pending_grading_count = v_pending
  where id = p_attempt_id;

  return jsonb_build_object('score', v_correct, 'maxScore', v_total, 'pendingGradingCount', v_pending, 'alreadySubmitted', false);
end;
$$;

grant execute on function submit_attempt(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- grade_written_response(): the ONE instructor path to grade a written
-- answer. Recomputes and persists the attempt's score/max_score/
-- pending_grading_count afterward so the gradebook never drifts out of
-- sync with individual response grades.
-- ---------------------------------------------------------------------

create or replace function grade_written_response(
  p_attempt_id uuid,
  p_question_id uuid,
  p_is_correct boolean,
  p_grading_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  if current_course_role(v_course_id) != 'instructor' then
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
$$;

grant execute on function grade_written_response(uuid, uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- get_attempt_view(): adds questionType/textResponse/explanation/
-- isCorrectManual/gradingNote. answer_guide is included only for the
-- instructor (or the student once the response has been graded) — it
-- is grading reference material, not a client-visible "correct answer"
-- before that point.
-- ---------------------------------------------------------------------

create or replace function get_attempt_view(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_attempt attempts%rowtype;
  v_assessment assessments%rowtype;
  v_is_instructor boolean;
  v_reveal boolean;
  v_result jsonb;
begin
  select * into v_attempt from attempts where id = p_attempt_id;
  if not found then
    raise exception 'Attempt not found.';
  end if;

  select * into v_assessment from assessments where id = v_attempt.assessment_id;
  v_is_instructor := current_course_role(v_assessment.course_id) = 'instructor';

  if v_attempt.user_id != auth.uid() and not v_is_instructor then
    raise exception 'Not authorized to view this attempt.';
  end if;

  v_reveal := v_is_instructor or v_attempt.submitted_at is not null;

  select jsonb_build_object(
    'attemptId', v_attempt.id,
    'assessmentId', v_assessment.id,
    'assessmentTitle', v_assessment.title,
    'startedAt', v_attempt.started_at,
    'submittedAt', v_attempt.submitted_at,
    'score', v_attempt.score,
    'maxScore', v_attempt.max_score,
    'pendingGradingCount', v_attempt.pending_grading_count,
    'questions', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'position', aq.position,
          'questionId', aq.question_id,
          'questionType', q.question_type,
          'prompt', q.prompt,
          'selectedOptionId', r.selected_option_id,
          'textResponse', r.text_response,
          'isCorrectManual', r.is_correct_manual,
          'gradingNote', case when v_reveal then r.grading_note else null end,
          'answerGuide', case when v_is_instructor then q.answer_guide else null end,
          'explanation', case when v_reveal then q.explanation else null end,
          'options', (
            select coalesce(jsonb_agg(
              (case when v_reveal
                then jsonb_build_object('optionId', o.id, 'text', o.text, 'isCorrect', o.is_correct)
                else jsonb_build_object('optionId', o.id, 'text', o.text)
              end)
              order by ord.idx
            ), '[]'::jsonb)
            from jsonb_array_elements_text(aq.option_order) with ordinality as ord(option_id, idx)
            join question_options o on o.id = ord.option_id::uuid
          )
        )
        order by aq.position
      ), '[]'::jsonb)
      from attempt_questions aq
      join questions q on q.id = aq.question_id
      left join responses r on r.attempt_id = aq.attempt_id and r.question_id = aq.question_id
      where aq.attempt_id = p_attempt_id
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function get_attempt_view(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- create_assessment(): re-declared only to add an optional
-- questionType filter per rule (e.g. "2 written questions from
-- Operating Systems"), passed through to assessment_rules.question_type
-- so start_attempt() (above) can honor it. Everything else is
-- unchanged from 0034.
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
  p_rules jsonb
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
$$;

grant execute on function create_assessment(uuid, uuid, text, text, assessment_kind, integer, text, text, text, jsonb) to authenticated;
