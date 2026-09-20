-- Core academic schema: courses through slides.
-- See docs/ARCHITECTURE.md for the shape rationale and
-- docs/INVARIANTS.md for the rules this schema exists to uphold.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Courses & membership
-- ---------------------------------------------------------------------

create table courses (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  title text not null,
  term text not null,
  created_at timestamptz not null default now()
);

create type course_role as enum ('student', 'instructor');

create table course_members (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role course_role not null,
  created_at timestamptz not null default now(),
  unique (course_id, user_id)
);

create index course_members_user_id_idx on course_members (user_id);
create index course_members_course_id_idx on course_members (course_id);

-- ---------------------------------------------------------------------
-- Units & lectures
-- ---------------------------------------------------------------------

create table units (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  title text not null,
  position integer not null,
  created_at timestamptz not null default now()
);

create index units_course_id_idx on units (course_id);

create table lectures (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units (id) on delete cascade,
  title text not null,
  position integer not null,
  scheduled_for date,
  -- null = draft, invisible to students (Invariant: draft content is invisible)
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create index lectures_unit_id_idx on lectures (unit_id);

-- ---------------------------------------------------------------------
-- Materials & versions
--
-- materials.current_version_id and material_versions.material_id are
-- mutually referential, so the FK from materials -> material_versions
-- is added after material_versions exists.
-- ---------------------------------------------------------------------

create type material_kind as enum ('pptx', 'pdf', 'document', 'link', 'video');
create type ingestion_status as enum ('pending', 'processing', 'ready', 'failed');

create table materials (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references lectures (id) on delete cascade,
  kind material_kind not null,
  title text not null,
  position integer not null,
  current_version_id uuid, -- FK added below
  published_at timestamptz,
  external_url text,
  created_at timestamptz not null default now(),
  constraint materials_link_video_need_url
    check (kind not in ('link', 'video') or external_url is not null)
);

create index materials_lecture_id_idx on materials (lecture_id);

create table material_versions (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials (id) on delete cascade,
  version_number integer not null,
  original_filename text not null,
  -- Path inside the private `course-materials` storage bucket. Immutable:
  -- a new upload creates a new version row, never overwrites this path.
  storage_path text not null,
  uploaded_by uuid not null references auth.users (id),
  uploaded_at timestamptz not null default now(),
  ingestion_status ingestion_status not null default 'pending',
  ingestion_error text,
  slide_count integer,
  unique (material_id, version_number)
);

create index material_versions_material_id_idx on material_versions (material_id);

alter table materials
  add constraint materials_current_version_fk
  foreign key (current_version_id) references material_versions (id)
  on delete set null;

-- ---------------------------------------------------------------------
-- Extracted slides — one row per slide, always traceable back to the
-- exact material version and source index (Invariant: provenance).
-- ---------------------------------------------------------------------

create table slides (
  id uuid primary key default gen_random_uuid(),
  material_version_id uuid not null references material_versions (id) on delete cascade,
  index integer not null,
  title text,
  text text not null default '',
  speaker_notes text,
  unique (material_version_id, index)
);

create index slides_material_version_id_idx on slides (material_version_id);
