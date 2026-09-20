-- Student learning evidence, derived — never duplicated — from
-- existing graded data. Same shape/authorization as
-- get_student_performance (0010_grades_performance.sql): SECURITY
-- DEFINER, scoped to auth.uid(), only SUBMITTED attempts count.
-- See docs/AI_TUTOR_ARCHITECTURE.md §4.

create or replace function get_student_objective_evidence(p_course_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if current_course_role(p_course_id) is null then
    raise exception 'Not a member of this course.';
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
      and att.user_id = auth.uid()
      and att.submitted_at is not null
    group by lo.id, lo.title, lo.position
  ) x;

  return v_result;
end;
$$;

grant execute on function get_student_objective_evidence(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- practice_attempts: tutor-generated practice, kept structurally
-- separate from the graded assessment tables — no FK into
-- attempts/questions, so it is incapable of changing an official
-- grade. See docs/AI_TUTOR_ARCHITECTURE.md §6.
-- ---------------------------------------------------------------------

create table practice_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references courses (id) on delete cascade,
  learning_objective_id uuid not null references learning_objectives (id) on delete cascade,
  tutor_session_id uuid not null references tutor_sessions (id) on delete cascade,
  prompt text not null,
  expected_answer_kind text not null check (expected_answer_kind in ('numeric', 'short_text', 'explanation')),
  -- Never surfaced to the client for an unanswered question — enforced
  -- structurally (no RETURNS clause below ever selects it), not just
  -- by convention. See comment on the RLS posture just below.
  canonical_answer text,
  student_answer text,
  correct boolean,
  evaluation_reason text,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create index practice_attempts_user_id_idx on practice_attempts (user_id);
create index practice_attempts_course_id_idx on practice_attempts (course_id);
create index practice_attempts_objective_id_idx on practice_attempts (learning_objective_id);

-- Same posture as question_options.is_correct (DECISIONS.md): RLS
-- enabled, ZERO client policies. `canonical_answer` sits in the same
-- row as everything else, and RLS is row-level, not column-level — a
-- direct `select *` from an owner-only policy would still hand back
-- the answer key for a question the student hasn't answered yet. Every
-- read/write goes through a SECURITY DEFINER function below, none of
-- which ever includes canonical_answer in a RETURNS clause.
alter table practice_attempts enable row level security;

-- ---------------------------------------------------------------------
-- create_practice_attempt(): the only way a practice question gets
-- persisted. Verifies the caller is a student in the course AND owns
-- the tutor session it's attached to. Returns everything except the
-- answer key.
-- ---------------------------------------------------------------------

create or replace function create_practice_attempt(
  p_course_id uuid,
  p_learning_objective_id uuid,
  p_tutor_session_id uuid,
  p_prompt text,
  p_expected_answer_kind text,
  p_canonical_answer text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if current_course_role(p_course_id) is distinct from 'student' then
    raise exception 'Not authorized.';
  end if;

  if not exists (
    select 1 from tutor_sessions ts
    where ts.id = p_tutor_session_id
      and ts.user_id = auth.uid()
      and ts.course_id = p_course_id
  ) then
    raise exception 'Not authorized.';
  end if;

  if not exists (
    select 1 from learning_objectives lo
    where lo.id = p_learning_objective_id and lo.course_id = p_course_id
  ) then
    raise exception 'Unknown learning objective.';
  end if;

  if p_expected_answer_kind not in ('numeric', 'short_text', 'explanation') then
    raise exception 'Invalid answer kind.';
  end if;

  insert into practice_attempts (
    user_id, course_id, learning_objective_id, tutor_session_id,
    prompt, expected_answer_kind, canonical_answer
  ) values (
    auth.uid(), p_course_id, p_learning_objective_id, p_tutor_session_id,
    p_prompt, p_expected_answer_kind, p_canonical_answer
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'prompt', p_prompt,
    'expectedAnswerKind', p_expected_answer_kind
  );
end;
$$;

grant execute on function create_practice_attempt(uuid, uuid, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- submit_practice_answer(): deterministic grading for numeric/short_text
-- (no model call needed); for 'explanation' this just records the
-- answer and reports back that LLM evaluation is needed — the caller
-- (trusted server code) then makes one bounded model call and persists
-- the result via record_practice_evaluation(). Never callable twice on
-- an already-answered row.
-- ---------------------------------------------------------------------

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

    return jsonb_build_object('status', 'pending_evaluation');
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

grant execute on function submit_practice_answer(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- record_practice_evaluation(): persists an LLM-judged 'explanation'
-- evaluation. Only writable once (answered_at must still be null, and
-- student_answer must already be set by submit_practice_answer) — a
-- client cannot use this to overwrite a result or skip answering.
-- ---------------------------------------------------------------------

create or replace function record_practice_evaluation(
  p_practice_attempt_id uuid,
  p_correct boolean,
  p_evaluation_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row practice_attempts%rowtype;
begin
  select * into v_row from practice_attempts
  where id = p_practice_attempt_id and user_id = auth.uid();

  if not found then
    raise exception 'Not authorized.';
  end if;
  if v_row.answered_at is not null then
    raise exception 'Already evaluated.';
  end if;
  if v_row.student_answer is null then
    raise exception 'No answer to evaluate.';
  end if;
  if v_row.expected_answer_kind != 'explanation' then
    raise exception 'Not an explanation question.';
  end if;

  update practice_attempts
  set correct = p_correct,
      evaluation_reason = p_evaluation_reason,
      answered_at = now()
  where id = p_practice_attempt_id;

  return jsonb_build_object('status', 'graded', 'correct', p_correct, 'evaluationReason', p_evaluation_reason);
end;
$$;

grant execute on function record_practice_evaluation(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- list_practice_attempts(): renders session/history UI. Never selects
-- canonical_answer.
-- ---------------------------------------------------------------------

create or replace function list_practice_attempts(p_tutor_session_id uuid)
returns table (
  id uuid,
  learning_objective_id uuid,
  prompt text,
  expected_answer_kind text,
  student_answer text,
  correct boolean,
  evaluation_reason text,
  created_at timestamptz,
  answered_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select pa.id, pa.learning_objective_id, pa.prompt, pa.expected_answer_kind,
         pa.student_answer, pa.correct, pa.evaluation_reason, pa.created_at, pa.answered_at
  from practice_attempts pa
  where pa.tutor_session_id = p_tutor_session_id and pa.user_id = auth.uid()
  order by pa.created_at asc;
$$;

grant execute on function list_practice_attempts(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- get_student_practice_evidence(): same aggregate shape as assessment
-- evidence, over practice_attempts instead. Kept as a separate
-- function/number on purpose — practice is never merged into the
-- official assessment score (see architecture doc §6).
-- ---------------------------------------------------------------------

create or replace function get_student_practice_evidence(p_course_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if current_course_role(p_course_id) is null then
    raise exception 'Not a member of this course.';
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
      and pa.user_id = auth.uid()
    group by lo.id, lo.title, lo.position
  ) x;

  return v_result;
end;
$$;

grant execute on function get_student_practice_evidence(uuid) to authenticated;
