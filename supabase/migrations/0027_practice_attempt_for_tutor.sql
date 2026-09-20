-- "Ask AI to Explain" context (docs/COURSEWORK_LEARNING_ARCHITECTURE.md
-- "CONTEXT ROUTING" — question-bank practice). practice_attempts has
-- ZERO client RLS policies by design (same posture as
-- question_options.is_correct) — this is the one narrow, purpose-built
-- read path, owner-checked, and only for an ALREADY-ANSWERED row
-- (never exposes canonical_answer for a pending/unanswered question).

create or replace function get_practice_attempt_for_tutor(p_practice_attempt_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_row practice_attempts%rowtype;
  v_correct_text text;
  v_objective_title text;
begin
  select * into v_row from practice_attempts
  where id = p_practice_attempt_id and user_id = auth.uid();

  if not found then
    raise exception 'Not authorized.';
  end if;
  if v_row.answered_at is null then
    raise exception 'This question has not been answered yet.';
  end if;

  select title into v_objective_title from learning_objectives where id = v_row.learning_objective_id;

  if v_row.source_type = 'question_bank' then
    select o.text into v_correct_text
    from question_options o
    where o.question_id = v_row.question_id and o.is_correct;
  else
    v_correct_text := v_row.canonical_answer;
  end if;

  return jsonb_build_object(
    'courseId', v_row.course_id,
    'learningObjectiveId', v_row.learning_objective_id,
    'learningObjectiveTitle', v_objective_title,
    'prompt', v_row.prompt,
    'studentAnswer', v_row.student_answer,
    'correctAnswer', v_correct_text,
    'wasCorrect', v_row.correct
  );
end;
$$;

grant execute on function get_practice_attempt_for_tutor(uuid) to authenticated;
