-- Learning Diagnostic (non-graded practice test) + explicit Tutor
-- preferences ("Learn with AI" front door). See
-- docs/HANDOFF_NEXT_SESSION.md for the full feature writeup.
--
-- Design choices:
--   - The Diagnostic is a REAL `assessments` row (kind = 'mock_test',
--     which is already non-grading by construction — see
--     create_assessment's `v_contributes := (p_kind = 'class_test')`)
--     with a new `is_diagnostic` flag for display/reporting, rather
--     than a parallel assessment type. It goes through the exact same
--     start_attempt/save_response/submit_attempt/get_attempt_view
--     path as every other assessment — no new grading or persistence
--     code. A submitted Diagnostic attempt is picked up automatically
--     by get_student_objective_evidence()/get_student_practice_evidence()
--     (Learn with AI's "evidence"), since those already aggregate over
--     any submitted attempt regardless of kind.
--   - `assessment_rules.visibility_filter` lets a random-selection rule
--     constrain to `questions.visibility` (defense in depth: today's
--     CSE 1203 bank happens to keep hidden Class Test questions in a
--     separate bank, but nothing stops an instructor from mixing
--     visibilities into one bank later, and the Diagnostic must never
--     expose a hidden question regardless of bank layout).
--   - tutor_preferences stores four explicit, small-enum fields the
--     student answers directly — never an inferred "learning style" or
--     personality label. Same RLS shape as `profiles`: own-row only.

alter table assessment_rules
  add column if not exists visibility_filter text
  check (visibility_filter in ('practice', 'hidden'));

alter table assessments
  add column if not exists is_diagnostic boolean not null default false;

-- start_attempt(): identical to the live definition except the random-
-- selection subquery now also respects visibility_filter when a rule
-- sets one (null = no filter = unchanged behavior for every existing
-- assessment).
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
          and (v_rule.visibility_filter is null or q.visibility = v_rule.visibility_filter)
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

-- create_assessment(): identical to the live definition, plus one new
-- trailing parameter (safe to CREATE OR REPLACE — appended with a
-- default, every existing call site is unaffected) and per-rule
-- visibility_filter persistence.
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
  p_rules jsonb,
  p_is_diagnostic boolean default false
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
    selection_mode, question_order_mode, option_order_mode, is_diagnostic
  ) values (
    p_course_id, v_bank_id, p_title, p_instructions, 0,
    null, true, p_kind, p_points_possible, v_contributes,
    p_selection_mode, p_question_order_mode, p_option_order_mode, coalesce(p_is_diagnostic, false)
  )
  returning id into v_assessment_id;

  for v_rule in select * from jsonb_array_elements(p_rules)
  loop
    insert into assessment_rules (
      assessment_id, position, source_lecture_id, topic, difficulty, count, fixed_question_id, question_type, visibility_filter
    ) values (
      v_assessment_id,
      (v_rule->>'position')::integer,
      nullif(v_rule->>'sourceLectureId', '')::uuid,
      nullif(v_rule->>'topic', ''),
      nullif(v_rule->>'difficulty', ''),
      coalesce((v_rule->>'count')::integer, 1),
      nullif(v_rule->>'fixedQuestionId', '')::uuid,
      nullif(v_rule->>'questionType', ''),
      nullif(v_rule->>'visibilityFilter', '')
    );
    v_question_count := v_question_count + coalesce((v_rule->>'count')::integer, 1);
  end loop;

  update assessments set question_count = v_question_count where id = v_assessment_id;

  return v_assessment_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Tutor preferences — explicit, small-enum, student-set. Never an
-- inferred personality/learning-style label (see migration header).
-- ---------------------------------------------------------------------

create table tutor_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  explanation_style text check (explanation_style in ('example_first', 'explain_first', 'guided_discovery')),
  correction_style text check (correction_style in ('hint_first', 'step_by_step', 'tell_and_explain')),
  detail_level text check (detail_level in ('short', 'balanced', 'detailed')),
  practice_pacing text check (practice_pacing in ('one_at_a_time', 'more_explanation', 'move_quickly')),
  updated_at timestamptz not null default now()
);

alter table tutor_preferences enable row level security;

create policy "users manage their own tutor preferences"
on tutor_preferences for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function upsert_my_tutor_preferences(
  p_explanation_style text,
  p_correction_style text,
  p_detail_level text,
  p_practice_pacing text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_explanation_style is not null and p_explanation_style not in ('example_first', 'explain_first', 'guided_discovery') then
    raise exception 'Invalid explanation style.';
  end if;
  if p_correction_style is not null and p_correction_style not in ('hint_first', 'step_by_step', 'tell_and_explain') then
    raise exception 'Invalid correction style.';
  end if;
  if p_detail_level is not null and p_detail_level not in ('short', 'balanced', 'detailed') then
    raise exception 'Invalid detail level.';
  end if;
  if p_practice_pacing is not null and p_practice_pacing not in ('one_at_a_time', 'more_explanation', 'move_quickly') then
    raise exception 'Invalid practice pacing.';
  end if;

  insert into tutor_preferences (user_id, explanation_style, correction_style, detail_level, practice_pacing, updated_at)
  values (auth.uid(), p_explanation_style, p_correction_style, p_detail_level, p_practice_pacing, now())
  on conflict (user_id) do update
    set explanation_style = excluded.explanation_style,
        correction_style = excluded.correction_style,
        detail_level = excluded.detail_level,
        practice_pacing = excluded.practice_pacing,
        updated_at = now();
end;
$$;

grant execute on function upsert_my_tutor_preferences(text, text, text, text) to authenticated;
