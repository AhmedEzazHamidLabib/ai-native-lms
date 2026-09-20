-- Announcements (Part 11): simple, D2L-style course announcements.
-- Body is stored and rendered as plain text — no HTML input is ever
-- accepted or interpreted, which is the safest way to satisfy "no
-- arbitrary unsafe HTML/scripts" without adding a sanitizer dependency
-- (React escapes plain text by default; the client applies a small,
-- fully-controlled bold/italic/bullet formatter over the plain string,
-- never dangerouslySetInnerHTML).

create table announcements (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  title text not null,
  body text not null,
  pinned boolean not null default false,
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index announcements_course_id_idx on announcements (course_id);

alter table announcements enable row level security;

create policy "instructors manage announcements"
on announcements for all
to authenticated
using (current_course_role(course_id) = 'instructor')
with check (current_course_role(course_id) = 'instructor');

create policy "students read published, unexpired announcements"
on announcements for select
to authenticated
using (
  current_course_role(course_id) = 'student'
  and published_at is not null
  and published_at <= now()
  and (expires_at is null or expires_at > now())
);
