-- submit_practice_answer(): the 'pending_evaluation' branch now also
-- returns course_id, needed by the AI Usage Governor (reserve_ai_generation
-- requires a course id) before the free-text explanation evaluation
-- call. Additive — same authorization/shape otherwise.

create or replace function submit_practice_answer(
  p_practice_attempt_id uuid,
  p_student_answer text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row practice_attempts%rowtype;
  v_correct boolean;
  v_reason text;
begin
  select * into v_row from practice_attempts
  where id = p_practice_attempt_id and user_id = auth.uid();

  if not found then
    raise exception 'Not authorized.';
  end if;
  if v_row.answered_at is not null then
    raise exception 'Already answered.';
  end if;

  if v_row.expected_answer_kind = 'explanation' then
    update practice_attempts
    set student_answer = p_student_answer
    where id = p_practice_attempt_id;

    return jsonb_build_object(
      'status', 'pending_evaluation',
      'rubricNotes', v_row.canonical_answer,
      'prompt', v_row.prompt,
      'courseId', v_row.course_id
    );
  end if;

  if v_row.expected_answer_kind = 'numeric' then
    v_correct := trim(regexp_replace(lower(p_student_answer), '\s+', '', 'g'))
      = trim(regexp_replace(lower(v_row.canonical_answer), '\s+', '', 'g'));
  else
    v_correct := trim(lower(p_student_answer)) = trim(lower(v_row.canonical_answer));
  end if;

  v_reason := case when v_correct then 'Matched the expected answer.' else 'Did not match the expected answer.' end;

  update practice_attempts
  set student_answer = p_student_answer,
      correct = v_correct,
      evaluation_reason = v_reason,
      answered_at = now()
  where id = p_practice_attempt_id;

  return jsonb_build_object('status', 'graded', 'correct', v_correct, 'evaluationReason', v_reason);
end;
$$;
