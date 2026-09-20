-- Evidence-based Learning Profile (Part 8): transparent, traceable
-- observations, never a personality/mastery score. At most one active
-- observation per (student, objective) — newer evidence supersedes or
-- resolves it, never a free-form diary.

create table student_misconceptions (
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references courses (id) on delete cascade,
  learning_objective_id uuid not null references learning_objectives (id) on delete cascade,
  description text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, learning_objective_id)
);

alter table student_misconceptions enable row level security;

create policy "students read their own misconception notes"
on student_misconceptions for select
to authenticated
using (user_id = auth.uid());

create policy "instructors read misconception notes for their course"
on student_misconceptions for select
to authenticated
using (current_course_role(course_id) = 'instructor');

-- No client insert/update policy — written only via record_misconception()
-- below, which re-derives auth.uid() itself (never a client-supplied
-- user id).

create or replace function record_misconception(
  p_course_id uuid,
  p_learning_objective_id uuid,
  p_description text,
  p_resolved boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_course_role(p_course_id) is distinct from 'student' then
    raise exception 'Not authorized.';
  end if;

  insert into student_misconceptions (user_id, course_id, learning_objective_id, description, resolved, updated_at)
  values (auth.uid(), p_course_id, p_learning_objective_id, p_description, p_resolved, now())
  on conflict (user_id, learning_objective_id)
  do update set description = excluded.description, resolved = excluded.resolved, updated_at = now();
end;
$$;

grant execute on function record_misconception(uuid, uuid, text, boolean) to authenticated;
