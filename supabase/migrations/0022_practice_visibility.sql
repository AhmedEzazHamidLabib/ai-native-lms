-- Question-bank Practice: reclassifies the existing bank as ungraded
-- practice, and builds the hard boundary that stops a future Class
-- Test's hidden pool leaking through Practice. See
-- docs/COURSEWORK_LEARNING_ARCHITECTURE.md "PRACTICE MODEL".

alter table questions
  add column if not exists visibility text not null default 'practice'
  check (visibility in ('practice', 'hidden'));

-- Existing 100 questions already default to 'practice' via the ADD
-- COLUMN DEFAULT above — explicit UPDATE kept here for clarity/intent,
-- not because it's structurally required.
update questions set visibility = 'practice' where visibility = 'practice';

-- ---------------------------------------------------------------------
-- practice_attempts: extended (not duplicated) to also represent
-- question-bank practice, so get_student_practice_evidence() covers
-- both kinds for free.
-- ---------------------------------------------------------------------

alter table practice_attempts
  add column if not exists source_type text not null default 'ai_generated'
    check (source_type in ('question_bank', 'ai_generated')),
  add column if not exists question_id uuid references questions (id) on delete set null,
  add column if not exists selected_option_id uuid references question_options (id) on delete set null;

-- Question-bank practice can happen standalone, outside any tutor
-- session — tutor_session_id is no longer required.
alter table practice_attempts alter column tutor_session_id drop not null;

alter table practice_attempts drop constraint practice_attempts_expected_answer_kind_check;
alter table practice_attempts add constraint practice_attempts_expected_answer_kind_check
  check (expected_answer_kind in ('numeric', 'short_text', 'explanation', 'multiple_choice'));

-- canonical_answer is never populated for question_id-backed rows —
-- correctness is derived at grading time from question_options, never
-- stored as client-adjacent text. Make it optional to reflect that.
alter table practice_attempts alter column canonical_answer drop not null;

create index if not exists practice_attempts_question_id_idx on practice_attempts (question_id);

-- ---------------------------------------------------------------------
-- list_practice_questions(): the catalog for "Practice Lecture 1/2 /
-- Mixed" — never includes option text or is_correct, just enough to
-- build the entry-point lists.
-- ---------------------------------------------------------------------

create or replace function list_practice_questions(
  p_course_id uuid,
  p_lecture_id uuid default null
)
returns table (
  question_id uuid,
  prompt text,
  topic text,
  source_lecture_id uuid,
  learning_objective_id uuid
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if current_course_role(p_course_id) is null then
    raise exception 'Not authorized.';
  end if;

  return query
  select q.id, q.prompt, q.topic, q.source_lecture_id, q.learning_objective_id
  from questions q
  join question_banks qb on qb.id = q.bank_id
  where qb.course_id = p_course_id
    and q.visibility = 'practice'
    and q.active = true
    and (p_lecture_id is null or q.source_lecture_id = p_lecture_id)
  order by q.source_position nulls last, q.created_at;
end;
$$;

grant execute on function list_practice_questions(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- get_practice_question(): renders ONE question for practice. Hard
-- rejects anything not visibility='practice', even if called directly
-- with a hidden question's id — this is the actual boundary, not a
-- UI convention. Never returns is_correct.
-- ---------------------------------------------------------------------

create or replace function get_practice_question(p_question_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_course_id uuid;
  v_visibility text;
  v_prompt text;
  v_lo_id uuid;
  v_options jsonb;
begin
  select qb.course_id, q.visibility, q.prompt, q.learning_objective_id
  into v_course_id, v_visibility, v_prompt, v_lo_id
  from questions q
  join question_banks qb on qb.id = q.bank_id
  where q.id = p_question_id;

  if v_course_id is null then
    raise exception 'Question not found.';
  end if;
  if current_course_role(v_course_id) is null then
    raise exception 'Not authorized.';
  end if;
  if v_visibility != 'practice' then
    raise exception 'This question is not available for practice.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('optionId', o.id, 'text', o.text) order by o.position), '[]'::jsonb)
  into v_options
  from question_options o
  where o.question_id = p_question_id;

  return jsonb_build_object(
    'questionId', p_question_id,
    'prompt', v_prompt,
    'learningObjectiveId', v_lo_id,
    'options', v_options
  );
end;
$$;

grant execute on function get_practice_question(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- submit_question_bank_practice_answer(): deterministic grading only
-- — never an LLM call. Re-checks visibility='practice' again here too
-- (defense in depth, not just at render time).
-- ---------------------------------------------------------------------

create or replace function submit_question_bank_practice_answer(
  p_question_id uuid,
  p_selected_option_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_visibility text;
  v_lo_id uuid;
  v_correct boolean;
  v_practice_attempt_id uuid;
begin
  select qb.course_id, q.visibility, q.learning_objective_id
  into v_course_id, v_visibility, v_lo_id
  from questions q
  join question_banks qb on qb.id = q.bank_id
  where q.id = p_question_id;

  if v_course_id is null then
    raise exception 'Question not found.';
  end if;
  if current_course_role(v_course_id) is distinct from 'student' then
    raise exception 'Not authorized.';
  end if;
  if v_visibility != 'practice' then
    raise exception 'This question is not available for practice.';
  end if;
  if v_lo_id is null then
    raise exception 'This question has no learning objective configured.';
  end if;

  select o.is_correct into v_correct
  from question_options o
  where o.id = p_selected_option_id and o.question_id = p_question_id;

  if v_correct is null then
    raise exception 'Invalid option for this question.';
  end if;

  insert into practice_attempts (
    user_id, course_id, learning_objective_id, source_type, question_id,
    selected_option_id, expected_answer_kind, prompt, student_answer, correct,
    evaluation_reason, answered_at
  )
  select
    auth.uid(), v_course_id, v_lo_id, 'question_bank', p_question_id,
    p_selected_option_id, 'multiple_choice', q.prompt, o.text, v_correct,
    case when v_correct then 'Correct.' else 'Incorrect.' end, now()
  from questions q, question_options o
  where q.id = p_question_id and o.id = p_selected_option_id
  returning id into v_practice_attempt_id;

  return jsonb_build_object('practiceAttemptId', v_practice_attempt_id, 'correct', v_correct);
end;
$$;

grant execute on function submit_question_bank_practice_answer(uuid, uuid) to authenticated;
