-- Student/instructor display profiles. Identity remains auth.uid() /
-- course_members everywhere — full_name is display data only, never
-- checked for access control. See docs/COURSEWORK_LEARNING_ARCHITECTURE.md
-- "PROFILES".

create table profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "users read their own profile"
on profiles for select
to authenticated
using (user_id = auth.uid());

create policy "users update their own profile"
on profiles for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users insert their own profile"
on profiles for insert
to authenticated
with check (user_id = auth.uid());

-- Instructors need to see student names on their own course roster —
-- same shape as the existing "instructors read attempts in their
-- course" pattern: scoped to courses they actually teach, never global.
create policy "instructors read profiles of students in their courses"
on profiles for select
to authenticated
using (
  exists (
    select 1 from course_members mine
    join course_members theirs on theirs.course_id = mine.course_id
    where mine.user_id = auth.uid()
      and mine.role = 'instructor'
      and theirs.user_id = profiles.user_id
  )
);

-- ---------------------------------------------------------------------
-- upsert_my_full_name(): the one write path from the app. A plain RLS
-- update policy would already allow this, but routing it through a
-- function keeps validation (non-empty, trimmed, length-capped) in one
-- place rather than duplicated in every caller.
-- ---------------------------------------------------------------------

create or replace function upsert_my_full_name(p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(p_full_name);
begin
  if v_name = '' or length(v_name) > 200 then
    raise exception 'Please enter a valid name.';
  end if;

  insert into profiles (user_id, full_name, updated_at)
  values (auth.uid(), v_name, now())
  on conflict (user_id) do update
    set full_name = excluded.full_name, updated_at = now();
end;
$$;

grant execute on function upsert_my_full_name(text) to authenticated;
