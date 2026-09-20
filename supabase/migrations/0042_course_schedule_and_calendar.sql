-- Course schedule (Settings, Part 13) + deterministic Calendar (Part
-- 12). Recurring class sessions (e.g. every Monday/Saturday within the
-- course date range) are NEVER stored as individual rows — they are
-- computed from these config columns. Only per-session ANNOTATIONS
-- (title/notes/cancellation) and one-off custom events are stored,
-- each keyed by date rather than by a recurrence-rule row.

alter table courses
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists meeting_days text[] not null default '{}',
  add column if not exists meeting_start_time time,
  add column if not exists meeting_end_time time,
  add column if not exists timezone text not null default 'UTC',
  add column if not exists students_can_see_roster boolean not null default true;

alter table courses add constraint courses_meeting_days_check check (
  meeting_days <@ array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']::text[]
);

-- ---------------------------------------------------------------------
-- Per-date annotation of a COMPUTED recurring class session — one row
-- only for dates the instructor actually adds content to or cancels;
-- an un-annotated Monday/Saturday within range is still a real class
-- session, just with no extra detail attached yet.
-- ---------------------------------------------------------------------

create table course_session_notes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  session_date date not null,
  title text,
  agenda text,
  related_lecture_id uuid references lectures (id) on delete set null,
  related_assessment_id uuid references assessments (id) on delete set null,
  cancelled boolean not null default false,
  announcement_id uuid,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, session_date)
);

-- ---------------------------------------------------------------------
-- One-off custom events — exam, project deadline, special class,
-- holiday/cancelled day, other. Deliberately a small, fixed category
-- set, not a general-purpose event system.
-- ---------------------------------------------------------------------

create type course_event_category as enum ('exam', 'project_deadline', 'special_class', 'holiday', 'other');

create table course_events (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  event_date date not null,
  category course_event_category not null,
  title text not null,
  details text,
  announcement_id uuid,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index course_events_course_id_idx on course_events (course_id);
create index course_session_notes_course_id_idx on course_session_notes (course_id);

-- Link to announcements now that the table exists (0041); nullable FK
-- with set-null so deleting an announcement never deletes the calendar
-- item it came from.
alter table course_session_notes add constraint course_session_notes_announcement_id_fkey
  foreign key (announcement_id) references announcements (id) on delete set null;
alter table course_events add constraint course_events_announcement_id_fkey
  foreign key (announcement_id) references announcements (id) on delete set null;

alter table course_session_notes enable row level security;
create policy "instructors manage session notes"
on course_session_notes for all
to authenticated
using (current_course_role(course_id) = 'instructor')
with check (current_course_role(course_id) = 'instructor');

create policy "students read session notes"
on course_session_notes for select
to authenticated
using (current_course_role(course_id) = 'student');

alter table course_events enable row level security;
create policy "instructors manage events"
on course_events for all
to authenticated
using (current_course_role(course_id) = 'instructor')
with check (current_course_role(course_id) = 'instructor');

create policy "students read events"
on course_events for select
to authenticated
using (current_course_role(course_id) = 'student');

-- ---------------------------------------------------------------------
-- Course schedule settings — instructor-only write, via a narrow RPC
-- rather than a raw table update policy, so validation (date order,
-- known day names) lives in one place.
-- ---------------------------------------------------------------------

create or replace function set_course_schedule(
  p_course_id uuid,
  p_start_date date,
  p_end_date date,
  p_meeting_days text[],
  p_meeting_start_time time,
  p_meeting_end_time time,
  p_timezone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_course_role(p_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;
  if p_start_date is not null and p_end_date is not null and p_end_date < p_start_date then
    raise exception 'End date cannot be before start date.';
  end if;
  if not (p_meeting_days <@ array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']::text[]) then
    raise exception 'Invalid meeting day.';
  end if;

  update courses
  set start_date = p_start_date,
      end_date = p_end_date,
      meeting_days = coalesce(p_meeting_days, '{}'),
      meeting_start_time = p_meeting_start_time,
      meeting_end_time = p_meeting_end_time,
      timezone = coalesce(p_timezone, 'UTC')
  where id = p_course_id;
end;
$$;

grant execute on function set_course_schedule(uuid, date, date, text[], time, time, text) to authenticated;

create or replace function set_course_roster_visibility(p_course_id uuid, p_visible boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_course_role(p_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;
  update courses set students_can_see_roster = p_visible where id = p_course_id;
end;
$$;

grant execute on function set_course_roster_visibility(uuid, boolean) to authenticated;

-- Respect the new visibility toggle — a course that turns off the
-- student directory should show each student only themselves.
create or replace function list_course_members_directory(p_course_id uuid)
returns table (user_id uuid, full_name text, is_me boolean)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role course_role;
  v_visible boolean;
begin
  v_role := current_course_role(p_course_id);
  if v_role is null then
    raise exception 'Not authorized.';
  end if;

  select students_can_see_roster into v_visible from courses where id = p_course_id;

  return query
  select cm.user_id, coalesce(pr.full_name, 'Unnamed student'), cm.user_id = auth.uid()
  from course_members cm
  left join profiles pr on pr.user_id = cm.user_id
  where cm.course_id = p_course_id
    and cm.role = 'student'
    and (v_role = 'instructor' or v_visible or cm.user_id = auth.uid())
  order by coalesce(pr.full_name, '');
end;
$$;

grant execute on function list_course_members_directory(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Calendar read: computed recurring sessions (from meeting_days over
-- the date range) merged with any session_notes/events for the range.
-- Read-only aggregate, safe for both students and instructors (course
-- membership is the only gate, same as everything else calendar-ish).
-- ---------------------------------------------------------------------

create or replace function get_course_calendar(p_course_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_course courses%rowtype;
  v_sessions jsonb;
  v_events jsonb;
begin
  if current_course_role(p_course_id) is null then
    raise exception 'Not authorized.';
  end if;

  select * into v_course from courses where id = p_course_id;
  if v_course.id is null then
    raise exception 'Course not found.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'date', d::date,
    'dayName', lower(to_char(d, 'FMDay')),
    'note', (
      select jsonb_build_object(
        'id', n.id, 'title', n.title, 'agenda', n.agenda, 'cancelled', n.cancelled,
        'relatedLectureId', n.related_lecture_id, 'relatedAssessmentId', n.related_assessment_id,
        'announcementId', n.announcement_id
      )
      from course_session_notes n where n.course_id = p_course_id and n.session_date = d::date
    )
  ) order by d), '[]'::jsonb)
  into v_sessions
  from generate_series(
    greatest(coalesce(v_course.start_date, p_from), p_from),
    least(coalesce(v_course.end_date, p_to), p_to),
    interval '1 day'
  ) as d
  where v_course.start_date is not null
    and v_course.end_date is not null
    and lower(to_char(d, 'FMDay')) = any(v_course.meeting_days);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'date', e.event_date, 'category', e.category, 'title', e.title,
    'details', e.details, 'announcementId', e.announcement_id
  ) order by e.event_date), '[]'::jsonb)
  into v_events
  from course_events e
  where e.course_id = p_course_id and e.event_date between p_from and p_to;

  return jsonb_build_object(
    'startDate', v_course.start_date,
    'endDate', v_course.end_date,
    'meetingDays', to_jsonb(v_course.meeting_days),
    'meetingStartTime', v_course.meeting_start_time,
    'meetingEndTime', v_course.meeting_end_time,
    'timezone', v_course.timezone,
    'sessions', v_sessions,
    'events', v_events
  );
end;
$$;

grant execute on function get_course_calendar(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Instructor writes: upsert a session note, create/update/delete a
-- custom event. Each takes an optional "also publish as announcement"
-- flag/id so the caller (server action) can create or reuse a linked
-- announcement — the actual announcement row is written by the caller
-- (through the existing announcements RLS), these RPCs only store the
-- resulting announcement_id reference.
-- ---------------------------------------------------------------------

create or replace function upsert_session_note(
  p_course_id uuid,
  p_session_date date,
  p_title text,
  p_agenda text,
  p_related_lecture_id uuid,
  p_related_assessment_id uuid,
  p_cancelled boolean,
  p_announcement_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if current_course_role(p_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;

  insert into course_session_notes (
    course_id, session_date, title, agenda, related_lecture_id, related_assessment_id, cancelled, announcement_id
  ) values (
    p_course_id, p_session_date, p_title, p_agenda, p_related_lecture_id, p_related_assessment_id,
    coalesce(p_cancelled, false), p_announcement_id
  )
  on conflict (course_id, session_date) do update set
    title = excluded.title,
    agenda = excluded.agenda,
    related_lecture_id = excluded.related_lecture_id,
    related_assessment_id = excluded.related_assessment_id,
    cancelled = excluded.cancelled,
    announcement_id = coalesce(excluded.announcement_id, course_session_notes.announcement_id),
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function upsert_session_note(uuid, date, text, text, uuid, uuid, boolean, uuid) to authenticated;

create or replace function create_course_event(
  p_course_id uuid,
  p_event_date date,
  p_category course_event_category,
  p_title text,
  p_details text,
  p_announcement_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if current_course_role(p_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;

  insert into course_events (course_id, event_date, category, title, details, announcement_id, created_by)
  values (p_course_id, p_event_date, p_category, p_title, p_details, p_announcement_id, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function create_course_event(uuid, date, course_event_category, text, text, uuid) to authenticated;

create or replace function delete_course_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  select course_id into v_course_id from course_events where id = p_event_id;
  if v_course_id is null then
    raise exception 'Event not found.';
  end if;
  if current_course_role(v_course_id) != 'instructor' then
    raise exception 'Not authorized.';
  end if;
  delete from course_events where id = p_event_id;
end;
$$;

grant execute on function delete_course_event(uuid) to authenticated;
