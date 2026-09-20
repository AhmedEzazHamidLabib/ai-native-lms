-- Bounded, purpose-built context for the "Review mistakes with AI" entry
-- point (docs/AI_TUTOR_ARCHITECTURE.md §7). Students have NO RLS select
-- policy on questions/question_options at all (0006_assessments_rls.sql)
-- — get_attempt_view() is the only existing read path, and it returns
-- every option for every question in the attempt, with no objective
-- linkage. This is deliberately narrower: only the questions the
-- student got wrong (or left unanswered), only their own SUBMITTED
-- attempt, joined to the learning objective for tutor context.

create or replace function get_attempt_mistakes(p_attempt_id uuid)
returns table (
  question_prompt text,
  student_answer_text text,
  correct_answer_text text,
  learning_objective_id uuid,
  learning_objective_title text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_attempt attempts%rowtype;
begin
  select * into v_attempt from attempts
  where id = p_attempt_id and user_id = auth.uid();

  if not found then
    raise exception 'Not authorized.';
  end if;
  if v_attempt.submitted_at is null then
    raise exception 'Attempt not yet submitted.';
  end if;

  return query
  select
    q.prompt,
    coalesce(selected.text, '(no answer given)'),
    correct.text,
    lo.id,
    lo.title
  from attempt_questions aq
  join questions q on q.id = aq.question_id
  left join responses r on r.attempt_id = aq.attempt_id and r.question_id = aq.question_id
  left join question_options selected on selected.id = r.selected_option_id
  join question_options correct on correct.question_id = q.id and correct.is_correct
  left join learning_objectives lo on lo.id = q.learning_objective_id
  where aq.attempt_id = p_attempt_id
    and (selected.id is null or selected.id != correct.id)
  order by aq.position;
end;
$$;

grant execute on function get_attempt_mistakes(uuid) to authenticated;
