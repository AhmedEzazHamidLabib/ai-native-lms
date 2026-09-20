-- Row Level Security.
--
-- The backend proves student data is private, not the UI (Invariant 3).
-- Every table below has RLS enabled; there is no table that relies on
-- "the app just won't query it that way."

-- ---------------------------------------------------------------------
-- Helper: a course member's role, or null. SECURITY DEFINER so it can
-- read course_members regardless of the caller's own RLS visibility
-- into that table, which avoids recursive-policy evaluation.
-- ---------------------------------------------------------------------

create or replace function current_course_role(p_course_id uuid)
returns course_role
language sql
security definer
stable
set search_path = public
as $$
  select role from course_members
  where course_id = p_course_id and user_id = auth.uid()
  limit 1;
$$;

grant execute on function current_course_role(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- courses
-- ---------------------------------------------------------------------

alter table courses enable row level security;

create policy "members can read their course"
on courses for select
to authenticated
using (current_course_role(id) is not null);

-- No client-side insert/update/delete policy: course creation and
-- metadata edits are out of Milestone 1 scope (see docs/DECISIONS.md)
-- and go through the service role for now.

-- ---------------------------------------------------------------------
-- course_members
-- ---------------------------------------------------------------------

alter table course_members enable row level security;

create policy "members can read their own membership rows"
on course_members for select
to authenticated
using (
  user_id = auth.uid()
  or current_course_role(course_id) = 'instructor'
);

-- Enrollment management (the Students page) is out of Milestone 1 scope;
-- writes go through the service role until that page exists.

-- ---------------------------------------------------------------------
-- units
-- ---------------------------------------------------------------------

alter table units enable row level security;

create policy "members can read units"
on units for select
to authenticated
using (current_course_role(course_id) is not null);

create policy "instructors manage units"
on units for all
to authenticated
using (current_course_role(course_id) = 'instructor')
with check (current_course_role(course_id) = 'instructor');

-- ---------------------------------------------------------------------
-- lectures
--
-- Students only ever see published lectures. Instructors see everything,
-- including drafts, in their own course.
-- ---------------------------------------------------------------------

alter table lectures enable row level security;

create policy "instructors read all lectures in their course"
on lectures for select
to authenticated
using (
  exists (
    select 1 from units u
    where u.id = lectures.unit_id
      and current_course_role(u.course_id) = 'instructor'
  )
);

create policy "students read published lectures"
on lectures for select
to authenticated
using (
  published_at is not null
  and exists (
    select 1 from units u
    where u.id = lectures.unit_id
      and current_course_role(u.course_id) = 'student'
  )
);

create policy "instructors manage lectures"
on lectures for all
to authenticated
using (
  exists (
    select 1 from units u
    where u.id = lectures.unit_id
      and current_course_role(u.course_id) = 'instructor'
  )
)
with check (
  exists (
    select 1 from units u
    where u.id = lectures.unit_id
      and current_course_role(u.course_id) = 'instructor'
  )
);

-- ---------------------------------------------------------------------
-- materials
-- ---------------------------------------------------------------------

alter table materials enable row level security;

create policy "instructors read all materials in their course"
on materials for select
to authenticated
using (
  exists (
    select 1 from lectures l
    join units u on u.id = l.unit_id
    where l.id = materials.lecture_id
      and current_course_role(u.course_id) = 'instructor'
  )
);

create policy "students read published materials on published lectures"
on materials for select
to authenticated
using (
  materials.published_at is not null
  and exists (
    select 1 from lectures l
    join units u on u.id = l.unit_id
    where l.id = materials.lecture_id
      and l.published_at is not null
      and current_course_role(u.course_id) = 'student'
  )
);

create policy "instructors manage materials"
on materials for all
to authenticated
using (
  exists (
    select 1 from lectures l
    join units u on u.id = l.unit_id
    where l.id = materials.lecture_id
      and current_course_role(u.course_id) = 'instructor'
  )
)
with check (
  exists (
    select 1 from lectures l
    join units u on u.id = l.unit_id
    where l.id = materials.lecture_id
      and current_course_role(u.course_id) = 'instructor'
  )
);

-- ---------------------------------------------------------------------
-- material_versions
--
-- Students may read only the current version of a published material
-- (they can download the original source, same as they can view the
-- extracted slides). All versions, published or not, are visible to
-- instructors for history/rollback.
-- ---------------------------------------------------------------------

alter table material_versions enable row level security;

create policy "instructors read all versions in their course"
on material_versions for select
to authenticated
using (
  exists (
    select 1 from materials m
    join lectures l on l.id = m.lecture_id
    join units u on u.id = l.unit_id
    where m.id = material_versions.material_id
      and current_course_role(u.course_id) = 'instructor'
  )
);

create policy "students read the current version of published materials"
on material_versions for select
to authenticated
using (
  exists (
    select 1 from materials m
    join lectures l on l.id = m.lecture_id
    join units u on u.id = l.unit_id
    where m.id = material_versions.material_id
      and m.current_version_id = material_versions.id
      and m.published_at is not null
      and l.published_at is not null
      and current_course_role(u.course_id) = 'student'
  )
);

create policy "instructors create versions"
on material_versions for insert
to authenticated
with check (
  exists (
    select 1 from materials m
    join lectures l on l.id = m.lecture_id
    join units u on u.id = l.unit_id
    where m.id = material_versions.material_id
      and current_course_role(u.course_id) = 'instructor'
  )
);

-- ingestion_status / slide_count / ingestion_error are updated by the
-- ingestion pipeline (service role), not by instructors directly — see
-- docs/DECISIONS.md. No authenticated update/delete policy.

-- ---------------------------------------------------------------------
-- slides — written only by the ingestion pipeline (service role).
-- ---------------------------------------------------------------------

alter table slides enable row level security;

create policy "instructors read all slides in their course"
on slides for select
to authenticated
using (
  exists (
    select 1 from material_versions mv
    join materials m on m.id = mv.material_id
    join lectures l on l.id = m.lecture_id
    join units u on u.id = l.unit_id
    where mv.id = slides.material_version_id
      and current_course_role(u.course_id) = 'instructor'
  )
);

create policy "students read slides of the current published version"
on slides for select
to authenticated
using (
  exists (
    select 1 from material_versions mv
    join materials m on m.id = mv.material_id and m.current_version_id = mv.id
    join lectures l on l.id = m.lecture_id
    join units u on u.id = l.unit_id
    where mv.id = slides.material_version_id
      and m.published_at is not null
      and l.published_at is not null
      and current_course_role(u.course_id) = 'student'
  )
);
