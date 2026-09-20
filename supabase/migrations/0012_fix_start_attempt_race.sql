-- Security/correctness fix: start_attempt() had a check-then-insert
-- race. It first SELECTs for an existing attempt and returns early if
-- found, then only INSERTs if not found — but under two truly
-- concurrent requests for the same (assessment_id, user_id) (a real
-- double-tap on the Start Test button, or a flaky mobile network
-- retry), both requests can pass the SELECT before either commits the
-- INSERT. The attempts table's unique (assessment_id, user_id)
-- constraint correctly stops the second one from creating a duplicate
-- row, but the caller saw a raw
-- "duplicate key value violates unique constraint" error instead of
-- transparently resuming the attempt the other request just created —
-- found during the 50-student concurrency simulation for this release
-- pass (11 of 25 concurrent double-start pairs hit this).
--
-- Fix: let the INSERT itself carry the conflict target
-- (`on conflict (assessment_id, user_id) do nothing`) and fall back to
-- re-selecting the now-existing row when the insert is skipped, instead
-- of trusting the earlier SELECT to have been the last word.

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
  on conflict (assessment_id, user_id) do nothing
  returning id into v_attempt_id;

  if v_attempt_id is null then
    -- Lost the race: a concurrent request already created this
    -- attempt between our SELECT above and this INSERT. Resume that
    -- one instead of erroring — same outcome as if we'd found it on
    -- the first SELECT, just a beat later.
    select id into v_attempt_id from attempts
      where assessment_id = p_assessment_id and user_id = auth.uid();
    return v_attempt_id;
  end if;

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
