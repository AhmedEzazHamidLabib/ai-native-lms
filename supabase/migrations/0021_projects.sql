-- Projects: an assessment (for grade weighting) with its own subsystem
-- underneath (groups, deliverables, submissions). See
-- docs/COURSEWORK_LEARNING_ARCHITECTURE.md "PROJECTS".
--
-- Group membership resolves by user_id, never by name — imported_name
-- exists only as a staging column for a FUTURE reconciliation pass
-- (exact + unique + same-course match against profiles.full_name).
-- Nothing is imported or auto-linked by this migration.

create table projects (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null unique references assessments (id) on delete cascade,
  course_id uuid not null references courses (id) on delete cascade,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table project_groups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

create table project_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references project_groups (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  -- Staging for future name-based reconciliation (see migration header).
  -- Never used for authorization — only user_id is.
  imported_name text,
  created_at timestamptz not null default now(),
  constraint project_group_members_identity_check
    check (user_id is not null or imported_name is not null)
);

create index project_group_members_group_id_idx on project_group_members (group_id);
create unique index project_group_members_one_membership_per_user_idx
  on project_group_members (group_id, user_id)
  where user_id is not null;

create table project_deliverables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  title text not null,
  description text not null default '',
  due_at timestamptz,
  position integer not null,
  created_at timestamptz not null default now()
);

create index project_deliverables_project_id_idx on project_deliverables (project_id);

create table project_submissions (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references project_deliverables (id) on delete cascade,
  group_id uuid not null references project_groups (id) on delete cascade,
  submitted_by_user_id uuid not null references auth.users (id),
  storage_path text not null,
  note text,
  submitted_at timestamptz not null default now(),
  -- Set when a resubmission replaces this one — history is kept, not
  -- overwritten, so accountability ("who submitted what, when") never
  -- silently disappears. No large version-control system: just this.
  superseded_at timestamptz
);

create index project_submissions_deliverable_group_idx
  on project_submissions (deliverable_id, group_id);
-- At most one CURRENT (non-superseded) submission per group per
-- deliverable — this row is what "group deliverable status" reads.
create unique index project_submissions_one_current_idx
  on project_submissions (deliverable_id, group_id)
  where superseded_at is null;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table projects enable row level security;
create policy "course members can read the project"
on projects for select
to authenticated
using (current_course_role(course_id) is not null);

alter table project_deliverables enable row level security;
create policy "course members can read deliverables"
on project_deliverables for select
to authenticated
using (
  exists (
    select 1 from projects p
    where p.id = project_deliverables.project_id
      and current_course_role(p.course_id) is not null
  )
);

-- project_groups / project_group_members: kept STRICT at the raw-table
-- level (self or instructor only) — the intentionally broader
-- "everyone in the course can see the group directory" view is served
-- by list_project_groups() below, a deliberate, narrow, reviewed
-- exception rather than an open table policy.
alter table project_groups enable row level security;
create policy "own group or course instructor can read group row"
on project_groups for select
to authenticated
using (
  exists (
    select 1 from project_group_members m
    where m.group_id = project_groups.id and m.user_id = auth.uid()
  )
  or exists (
    select 1 from projects p
    where p.id = project_groups.project_id and current_course_role(p.course_id) = 'instructor'
  )
);

alter table project_group_members enable row level security;
create policy "own membership or course instructor can read"
on project_group_members for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from project_groups g
    join projects p on p.id = g.project_id
    where g.id = project_group_members.group_id
      and current_course_role(p.course_id) = 'instructor'
  )
);

alter table project_submissions enable row level security;
create policy "own group or course instructor can read submissions"
on project_submissions for select
to authenticated
using (
  exists (
    select 1 from project_group_members m
    where m.group_id = project_submissions.group_id and m.user_id = auth.uid()
  )
  or exists (
    select 1 from project_deliverables d
    join projects p on p.id = d.project_id
    where d.id = project_submissions.deliverable_id
      and current_course_role(p.course_id) = 'instructor'
  )
);
-- No client insert/update policy — submit_project_deliverable() below
-- is the only write path, so group identity is always server-resolved
-- from auth.uid(), never a client-supplied group_id.

-- ---------------------------------------------------------------------
-- list_project_groups(): the course-wide group directory. Deliberately
-- broader than raw project_group_members RLS — full names only, never
-- emails, and only for members of the SAME course as the project.
-- ---------------------------------------------------------------------

create or replace function list_project_groups(p_project_id uuid)
returns table (
  group_id uuid,
  group_name text,
  member_user_id uuid,
  member_full_name text,
  is_me boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  select course_id into v_course_id from projects where id = p_project_id;
  if v_course_id is null or current_course_role(v_course_id) is null then
    raise exception 'Not authorized.';
  end if;

  return query
  select
    g.id,
    g.name,
    m.user_id,
    coalesce(pr.full_name, 'Unnamed student'),
    m.user_id = auth.uid()
  from project_groups g
  join project_group_members m on m.group_id = g.id
  left join profiles pr on pr.user_id = m.user_id
  where g.project_id = p_project_id and m.user_id is not null
  order by g.name;
end;
$$;

grant execute on function list_project_groups(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- get_my_project_group(): a student's own group + deliverable
-- submission status, in one call.
-- ---------------------------------------------------------------------

create or replace function get_my_project_group(p_project_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_course_id uuid;
  v_group_id uuid;
  v_result jsonb;
begin
  select course_id into v_course_id from projects where id = p_project_id;
  if v_course_id is null or current_course_role(v_course_id) is null then
    raise exception 'Not authorized.';
  end if;

  select g.id into v_group_id
  from project_groups g
  join project_group_members m on m.group_id = g.id
  where g.project_id = p_project_id and m.user_id = auth.uid();

  if v_group_id is null then
    return jsonb_build_object('group', null);
  end if;

  select jsonb_build_object(
    'groupId', v_group_id,
    'deliverables', coalesce(jsonb_agg(jsonb_build_object(
      'deliverableId', d.id,
      'title', d.title,
      'description', d.description,
      'dueAt', d.due_at,
      'position', d.position,
      'submitted', s.id is not null,
      'submittedAt', s.submitted_at,
      'submittedByUserId', s.submitted_by_user_id,
      'submittedByName', coalesce(pr.full_name, 'A group member'),
      'note', s.note
    ) order by d.position), '[]'::jsonb)
  ) into v_result
  from project_deliverables d
  left join project_submissions s
    on s.deliverable_id = d.id and s.group_id = v_group_id and s.superseded_at is null
  left join profiles pr on pr.user_id = s.submitted_by_user_id
  where d.project_id = p_project_id;

  return v_result;
end;
$$;

grant execute on function get_my_project_group(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- submit_project_deliverable(): the ONLY write path for a submission.
-- Group is always resolved server-side from auth.uid() — a client can
-- never supply a group_id. Re-verifies every hop: student is enrolled,
-- belongs to a group in THIS project, the deliverable belongs to THIS
-- project. Marks any prior current submission superseded rather than
-- deleting it.
-- ---------------------------------------------------------------------

create or replace function submit_project_deliverable(
  p_deliverable_id uuid,
  p_storage_path text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_course_id uuid;
  v_group_id uuid;
  v_submission_id uuid;
begin
  select d.project_id, p.course_id into v_project_id, v_course_id
  from project_deliverables d
  join projects p on p.id = d.project_id
  where d.id = p_deliverable_id;

  if v_project_id is null then
    raise exception 'Deliverable not found.';
  end if;
  if current_course_role(v_course_id) is distinct from 'student' then
    raise exception 'Not authorized.';
  end if;

  select g.id into v_group_id
  from project_groups g
  join project_group_members m on m.group_id = g.id
  where g.project_id = v_project_id and m.user_id = auth.uid();

  if v_group_id is null then
    raise exception 'You are not in a project group for this project yet.';
  end if;

  update project_submissions
  set superseded_at = now()
  where deliverable_id = p_deliverable_id and group_id = v_group_id and superseded_at is null;

  insert into project_submissions (deliverable_id, group_id, submitted_by_user_id, storage_path, note)
  values (p_deliverable_id, v_group_id, auth.uid(), p_storage_path, p_note)
  returning id into v_submission_id;

  return jsonb_build_object('submissionId', v_submission_id, 'groupId', v_group_id);
end;
$$;

grant execute on function submit_project_deliverable(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Seed the projects row linking to the 'project' assessment created in
-- 0020. Deliberately NO groups/deliverables seeded — the real CSE 1203
-- project requirements and the two historical group submissions are
-- not guessed at in this milestone (see the report's "HISTORICAL
-- PROJECT MIGRATION" section). An instructor adds real deliverables
-- once requirements are known; the page shows an honest empty state
-- until then.
-- ---------------------------------------------------------------------

do $$
declare
  v_course_id uuid := '11111111-1111-1111-1111-111111111111';
  v_assessment_id uuid;
begin
  if not exists (select 1 from courses where id = v_course_id) then
    return;
  end if;

  select id into v_assessment_id
  from assessments
  where course_id = v_course_id and kind = 'project'
  limit 1;

  if v_assessment_id is not null and not exists (
    select 1 from projects where assessment_id = v_assessment_id
  ) then
    insert into projects (assessment_id, course_id, description)
    values (v_assessment_id, v_course_id, 'Course project — groups and deliverables to be configured by the instructor.');
  end if;
end $$;
