-- AI Usage Governor: atomic quota reservation BEFORE any provider
-- call, role-aware (students only), with a kill switch. See
-- the milestone doc / Part 11. If a student exceeds policy, ZERO
-- Anthropic call occurs — enforced here, in Postgres, not in app code
-- that could race.

create table ai_usage_config (
  id boolean primary key default true,
  student_daily_limit integer not null default 8,
  course_daily_limit integer not null default 75,
  global_daily_limit integer not null default 100,
  cooldown_seconds integer not null default 9,
  ai_paused boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint ai_usage_config_singleton check (id)
);
insert into ai_usage_config (id) values (true) on conflict (id) do nothing;

create table course_ai_settings (
  course_id uuid primary key references courses (id) on delete cascade,
  ai_paused boolean not null default false,
  updated_at timestamptz not null default now()
);

create type ai_role as enum ('student', 'instructor', 'owner');
create type ai_entry_context as enum (
  'tutor_direct', 'tutor_performance', 'tutor_assessment_review',
  'tutor_slide', 'tutor_question_explain', 'practice_evaluation'
);
create type ai_event_status as enum ('reserved', 'success', 'failed');

-- One row per attempted generation, reserved BEFORE the provider call
-- and completed after. A 'reserved' row older than 2 minutes that
-- never completed (crashed request) is treated as abandoned and
-- excluded from cap/concurrency counting — see the counting queries
-- in reserve_ai_generation() below.
create table ai_generation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid references courses (id) on delete cascade,
  role ai_role not null,
  entry_context ai_entry_context not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  status ai_event_status not null default 'reserved',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index ai_generation_events_user_id_idx on ai_generation_events (user_id, created_at);
create index ai_generation_events_course_id_idx on ai_generation_events (course_id, created_at);

alter table ai_usage_config enable row level security;
alter table course_ai_settings enable row level security;
alter table ai_generation_events enable row level security;

-- Read-only for any authenticated user (needed so the UI can show
-- "AI Tutor: paused"); writes go through owner/instructor RPCs only.
create policy "authenticated users can read global ai config"
on ai_usage_config for select to authenticated using (true);

create policy "course members can read their course's ai settings"
on course_ai_settings for select to authenticated
using (current_course_role(course_id) is not null);

-- No client select policy on ai_generation_events at all — usage
-- events may contain patterns worth keeping internal; instructors see
-- aggregates only, via SECURITY DEFINER functions below.

-- ---------------------------------------------------------------------
-- reserve_ai_generation(): the ONLY gate before a provider call.
-- Fully serialized via an advisory lock — at pilot scale (tens of
-- students, ~100 generations/day) this is microseconds of contention,
-- not a real bottleneck, and it closes every race condition outright
-- rather than approximating atomicity with a check-then-insert.
-- ---------------------------------------------------------------------

create or replace function reserve_ai_generation(
  p_course_id uuid,
  p_entry_context ai_entry_context
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role ai_role;
  v_config ai_usage_config%rowtype;
  v_course_paused boolean;
  v_event_id uuid;
  v_last_created timestamptz;
  v_concurrent_count integer;
  v_student_count integer;
  v_course_count integer;
  v_global_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('ai_generation_reservation'));

  if current_course_role(p_course_id) is null then
    raise exception 'Not authorized.';
  end if;

  if current_user_is_owner() then
    v_role := 'owner';
  elsif current_course_role(p_course_id) = 'instructor' then
    v_role := 'instructor';
  else
    v_role := 'student';
  end if;

  -- Instructors/owner are logged for observability but never
  -- rate-limited or blocked by pause — see architecture doc's
  -- "role-aware accounting."
  if v_role != 'student' then
    insert into ai_generation_events (user_id, course_id, role, entry_context)
    values (auth.uid(), p_course_id, v_role, p_entry_context)
    returning id into v_event_id;
    return jsonb_build_object('allowed', true, 'eventId', v_event_id);
  end if;

  select * into v_config from ai_usage_config where id = true;
  select ai_paused into v_course_paused from course_ai_settings where course_id = p_course_id;

  if v_config.ai_paused or coalesce(v_course_paused, false) then
    return jsonb_build_object('allowed', false, 'reason', 'paused');
  end if;

  select max(created_at) into v_last_created
  from ai_generation_events
  where user_id = auth.uid();
  if v_last_created is not null and v_last_created > now() - make_interval(secs => v_config.cooldown_seconds) then
    return jsonb_build_object('allowed', false, 'reason', 'cooldown');
  end if;

  select count(*) into v_concurrent_count
  from ai_generation_events
  where user_id = auth.uid()
    and status = 'reserved'
    and created_at > now() - interval '2 minutes';
  if v_concurrent_count > 0 then
    return jsonb_build_object('allowed', false, 'reason', 'concurrent');
  end if;

  select count(*) into v_student_count
  from ai_generation_events
  where user_id = auth.uid()
    and role = 'student'
    and created_at >= current_date
    and (status != 'reserved' or created_at > now() - interval '2 minutes')
    and status != 'failed';
  if v_student_count >= v_config.student_daily_limit then
    return jsonb_build_object('allowed', false, 'reason', 'student_daily');
  end if;

  select count(*) into v_course_count
  from ai_generation_events
  where course_id = p_course_id
    and role = 'student'
    and created_at >= current_date
    and (status != 'reserved' or created_at > now() - interval '2 minutes')
    and status != 'failed';
  if v_course_count >= v_config.course_daily_limit then
    return jsonb_build_object('allowed', false, 'reason', 'course_daily');
  end if;

  select count(*) into v_global_count
  from ai_generation_events
  where role = 'student'
    and created_at >= current_date
    and (status != 'reserved' or created_at > now() - interval '2 minutes')
    and status != 'failed';
  if v_global_count >= v_config.global_daily_limit then
    return jsonb_build_object('allowed', false, 'reason', 'global_daily');
  end if;

  insert into ai_generation_events (user_id, course_id, role, entry_context)
  values (auth.uid(), p_course_id, v_role, p_entry_context)
  returning id into v_event_id;

  return jsonb_build_object('allowed', true, 'eventId', v_event_id);
end;
$$;

grant execute on function reserve_ai_generation(uuid, ai_entry_context) to authenticated;

-- ---------------------------------------------------------------------
-- complete_ai_generation(): records the outcome. A 'failed' completion
-- excludes that event from future cap counts (the refund) — see the
-- `and status != 'failed'` filters above.
-- ---------------------------------------------------------------------

create or replace function complete_ai_generation(
  p_event_id uuid,
  p_status ai_event_status,
  p_model text default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update ai_generation_events
  set status = p_status,
      model = coalesce(p_model, model),
      input_tokens = coalesce(p_input_tokens, input_tokens),
      output_tokens = coalesce(p_output_tokens, output_tokens),
      completed_at = now()
  where id = p_event_id and user_id = auth.uid();
end;
$$;

grant execute on function complete_ai_generation(uuid, ai_event_status, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------
-- Instructor controls + usage view. Course-scoped; global pause is
-- owner-only.
-- ---------------------------------------------------------------------

create or replace function set_course_ai_paused(p_course_id uuid, p_paused boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_course_role(p_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;

  insert into course_ai_settings (course_id, ai_paused, updated_at)
  values (p_course_id, p_paused, now())
  on conflict (course_id) do update set ai_paused = excluded.ai_paused, updated_at = now();
end;
$$;

grant execute on function set_course_ai_paused(uuid, boolean) to authenticated;

create or replace function set_global_ai_paused(p_paused boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not current_user_is_owner() then
    raise exception 'Not authorized.';
  end if;

  update ai_usage_config set ai_paused = p_paused, updated_at = now() where id = true;
end;
$$;

grant execute on function set_global_ai_paused(boolean) to authenticated;

-- Today's usage summary for a course, instructor-only.
create or replace function get_course_ai_usage_today(p_course_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if current_course_role(p_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;

  select jsonb_build_object(
    'studentGenerationsToday', count(*) filter (where role = 'student' and status != 'failed'),
    'inputTokensToday', coalesce(sum(input_tokens) filter (where status = 'success'), 0),
    'outputTokensToday', coalesce(sum(output_tokens) filter (where status = 'success'), 0),
    'failedToday', count(*) filter (where status = 'failed')
  ) into v_result
  from ai_generation_events
  where course_id = p_course_id and created_at >= current_date;

  return v_result;
end;
$$;

grant execute on function get_course_ai_usage_today(uuid) to authenticated;
