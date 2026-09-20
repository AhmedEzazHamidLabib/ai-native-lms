-- RLS + RPCs for the assessment subsystem.
--
-- Design: students never get a direct table read/write path to
-- questions, question_options, attempt_questions, or responses — every
-- student interaction with an attempt goes through exactly three
-- SECURITY DEFINER functions (start_attempt, save_response,
-- submit_attempt) plus one read function (get_attempt_view). This is
-- deliberately stricter than "hide is_correct" alone: it means there is
-- no RLS policy anywhere for students to get wrong on this subsystem,
-- because there is almost no direct policy at all — the functions
-- validate everything internally, in Postgres, every time.

-- ---------------------------------------------------------------------
-- question_banks / questions / question_options — instructor-only.
-- Students never query these tables directly, at any point, before or
-- after submission. That's what makes "the answer key is never
-- client-queryable" true by construction rather than by convention.
-- ---------------------------------------------------------------------

alter table question_banks enable row level security;

create policy "instructors manage question banks"
on question_banks for all
to authenticated
using (current_course_role(course_id) = 'instructor')
with check (current_course_role(course_id) = 'instructor');

alter table questions enable row level security;

create policy "instructors manage questions"
on questions for all
to authenticated
using (
  exists (
    select 1 from question_banks b
    where b.id = questions.bank_id and current_course_role(b.course_id) = 'instructor'
  )
)
with check (
  exists (
    select 1 from question_banks b
    where b.id = questions.bank_id and current_course_role(b.course_id) = 'instructor'
  )
);

alter table question_options enable row level security;

create policy "instructors manage question options"
on question_options for all
to authenticated
using (
  exists (
    select 1 from questions q
    join question_banks b on b.id = q.bank_id
    where q.id = question_options.question_id and current_course_role(b.course_id) = 'instructor'
  )
)
with check (
  exists (
    select 1 from questions q
    join question_banks b on b.id = q.bank_id
    where q.id = question_options.question_id and current_course_role(b.course_id) = 'instructor'
  )
);

-- ---------------------------------------------------------------------
-- assessments / assessment_rules
-- ---------------------------------------------------------------------

alter table assessments enable row level security;

create policy "instructors manage assessments"
on assessments for all
to authenticated
using (current_course_role(course_id) = 'instructor')
with check (current_course_role(course_id) = 'instructor');

create policy "students read published assessments"
on assessments for select
to authenticated
using (published_at is not null and current_course_role(course_id) = 'student');

alter table assessment_rules enable row level security;

create policy "instructors manage assessment rules"
on assessment_rules for all
to authenticated
using (
  exists (
    select 1 from assessments a
    where a.id = assessment_rules.assessment_id and current_course_role(a.course_id) = 'instructor'
  )
)
with check (
  exists (
    select 1 from assessments a
    where a.id = assessment_rules.assessment_id and current_course_role(a.course_id) = 'instructor'
  )
);

-- ---------------------------------------------------------------------
-- attempts — students read their own row (status/score summary only,
-- never how it was computed); instructors read/delete within their
-- course. No insert/update policy for anyone: start_attempt() and
-- submit_attempt() are the only paths that ever write here.
-- ---------------------------------------------------------------------

alter table attempts enable row level security;

create policy "students read own attempts"
on attempts for select
to authenticated
using (user_id = auth.uid());

create policy "instructors read attempts in their course"
on attempts for select
to authenticated
using (
  exists (
    select 1 from assessments a
    where a.id = attempts.assessment_id and current_course_role(a.course_id) = 'instructor'
  )
);

create policy "instructors reset attempts in their course"
on attempts for delete
to authenticated
using (
  exists (
    select 1 from assessments a
    where a.id = attempts.assessment_id and current_course_role(a.course_id) = 'instructor'
  )
);

-- ---------------------------------------------------------------------
-- attempt_questions / responses — instructor read only. Students get
-- everything (including their own saved answers) through
-- get_attempt_view(); there is intentionally no student policy here at
-- all, so there's nothing to misconfigure.
-- ---------------------------------------------------------------------

alter table attempt_questions enable row level security;

create policy "instructors read attempt questions in their course"
on attempt_questions for select
to authenticated
using (
  exists (
    select 1 from attempts a
    join assessments ass on ass.id = a.assessment_id
    where a.id = attempt_questions.attempt_id and current_course_role(ass.course_id) = 'instructor'
  )
);

alter table responses enable row level security;

create policy "instructors read responses in their course"
on responses for select
to authenticated
using (
  exists (
    select 1 from attempts a
    join assessments ass on ass.id = a.assessment_id
    where a.id = responses.attempt_id and current_course_role(ass.course_id) = 'instructor'
  )
);

-- ---------------------------------------------------------------------
-- start_attempt(): samples questions per assessment_rules, shuffles the
-- combined question order (not block-by-rule — a full reshuffle across
-- all selected questions), shuffles each question's option order, and
-- persists all of it. Resuming an existing attempt always succeeds,
-- even while locked; only a fresh start checks published/locked.
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
  v_shuffled uuid[];
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
  returning id into v_attempt_id;

  for v_rule in
    select * from assessment_rules where assessment_id = p_assessment_id order by position
  loop
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

    v_all_ids := v_all_ids || v_rule_ids;
  end loop;

  select array_agg(qid order by random()) into v_shuffled
  from unnest(v_all_ids) as qid;

  foreach v_qid in array v_shuffled loop
    v_position := v_position + 1;

    select jsonb_agg(o.id order by random()) into v_option_order
    from question_options o
    where o.question_id = v_qid;

    insert into attempt_questions (attempt_id, question_id, position, option_order)
    values (v_attempt_id, v_qid, v_position, v_option_order);
  end loop;

  return v_attempt_id;
end;
$$;

grant execute on function start_attempt(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- save_response(): the one write path for a student's answer. Validates
-- the attempt is theirs and still open, the question is actually part
-- of that attempt, and the chosen option actually belongs to that
-- question — all server-side, none of it trusting the client beyond
-- "here are three IDs."
-- ---------------------------------------------------------------------

create or replace function save_response(
  p_attempt_id uuid,
  p_question_id uuid,
  p_selected_option_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
end;
$$;

grant execute on function save_response(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- submit_attempt(): the only place a score is ever computed. Grades
-- from question_options.is_correct directly (readable here regardless
-- of RLS, because SECURITY DEFINER) — never from anything the client
-- sent. Idempotent: re-submitting an already-submitted attempt just
-- returns the stored score instead of re-grading or erroring.
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
      'score', v_attempt.score, 'maxScore', v_attempt.max_score, 'alreadySubmitted', true
    );
  end if;

  select count(*) into v_total from attempt_questions where attempt_id = p_attempt_id;

  select count(*) into v_correct
  from attempt_questions aq
  join responses r on r.attempt_id = aq.attempt_id and r.question_id = aq.question_id
  join question_options o on o.id = r.selected_option_id
  where aq.attempt_id = p_attempt_id and o.is_correct;

  update attempts
  set submitted_at = now(), score = v_correct, max_score = v_total
  where id = p_attempt_id;

  return jsonb_build_object('score', v_correct, 'maxScore', v_total, 'alreadySubmitted', false);
end;
$$;

grant execute on function submit_attempt(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- get_attempt_view(): the one read path for attempt content. Owner or
-- instructor only. Options never include is_correct unless the caller
-- is an instructor or the attempt is already submitted — this is the
-- function that makes "no correct answer sitting in client-visible
-- data before submission" true for the one place students actually see
-- question content.
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
    'questions', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'position', aq.position,
          'questionId', aq.question_id,
          'prompt', q.prompt,
          'selectedOptionId', r.selected_option_id,
          'options', (
            select jsonb_agg(
              (case when v_reveal
                then jsonb_build_object('optionId', o.id, 'text', o.text, 'isCorrect', o.is_correct)
                else jsonb_build_object('optionId', o.id, 'text', o.text)
              end)
              order by ord.idx
            )
            from jsonb_array_elements_text(aq.option_order) with ordinality as ord(option_id, idx)
            join question_options o on o.id = ord.option_id::uuid
          )
        )
        order by aq.position
      ), '[]'::jsonb)
      from attempt_questions aq
      join questions q on q.id = aq.question_id
      left join responses r on r.attempt_id = aq.attempt_id and r.question_id = aq.question_id
      where aq.attempt_id = v_attempt.id
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function get_attempt_view(uuid) to authenticated;
