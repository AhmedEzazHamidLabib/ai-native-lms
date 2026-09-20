-- Tutor sessions: lightweight educational-memory continuity, not a
-- chat platform. See docs/AI_TUTOR_ARCHITECTURE.md §5/§13.

create type tutor_entry_source as enum ('direct', 'performance', 'assessment_review');
create type tutor_message_role as enum ('user', 'assistant');

create table tutor_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references courses (id) on delete cascade,
  learning_objective_id uuid references learning_objectives (id) on delete set null,
  entry_source tutor_entry_source not null default 'direct',
  -- Only meaningful when entry_source = 'assessment_review'. Re-checked
  -- (submitted_at is not null, owned by this user) on every turn by the
  -- orchestrator, not just at creation — see architecture doc §7.
  source_attempt_id uuid references attempts (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index tutor_sessions_user_id_idx on tutor_sessions (user_id);
create index tutor_sessions_course_id_idx on tutor_sessions (course_id);

create table tutor_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references tutor_sessions (id) on delete cascade,
  role tutor_message_role not null,
  content text not null,
  -- Server-side signal only (see architecture doc §11) — never rendered.
  teaching_move text,
  created_at timestamptz not null default now()
);

create index tutor_messages_session_id_idx on tutor_messages (session_id, created_at);

-- ---------------------------------------------------------------------
-- RLS: owner-only, same shape as `responses` (the one other
-- student-writable table) — plus an explicit course-membership check
-- on insert so a forged direct insert can't create a session for a
-- course the caller doesn't belong to. Retrieval/evidence RPCs
-- independently re-verify membership regardless, so this is defense in
-- depth, not the only gate.
-- ---------------------------------------------------------------------

alter table tutor_sessions enable row level security;

create policy "students read their own tutor sessions"
on tutor_sessions for select
to authenticated
using (user_id = auth.uid());

create policy "students create their own tutor sessions"
on tutor_sessions for insert
to authenticated
with check (
  user_id = auth.uid()
  and current_course_role(course_id) = 'student'
);

create policy "students touch their own tutor sessions"
on tutor_sessions for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

alter table tutor_messages enable row level security;

-- Explicit ownership check via join, not row-level trust alone — the
-- same lesson DECISIONS.md already documents for course_members
-- queries: never assume a table's own columns are enough to scope
-- "mine" without checking the relationship explicitly.
create policy "students read their own tutor messages"
on tutor_messages for select
to authenticated
using (
  exists (
    select 1 from tutor_sessions ts
    where ts.id = tutor_messages.session_id and ts.user_id = auth.uid()
  )
);

create policy "students insert their own tutor messages"
on tutor_messages for insert
to authenticated
with check (
  exists (
    select 1 from tutor_sessions ts
    where ts.id = tutor_messages.session_id and ts.user_id = auth.uid()
  )
);
