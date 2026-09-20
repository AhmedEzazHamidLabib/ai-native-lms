-- Course Intelligence: pedagogical analysis computed ONCE per material
-- version by a strong model, consumed by every cheap runtime tutor
-- turn. See docs/COURSEWORK_LEARNING_ARCHITECTURE.md "COURSE
-- INTELLIGENCE". Never written by the per-message runtime path — only
-- by scripts/compile-course-intelligence.mjs.

create type intelligence_status as enum ('ready', 'stale', 'missing', 'generating', 'failed');

create table learning_objective_intelligence (
  id uuid primary key default gen_random_uuid(),
  learning_objective_id uuid not null unique references learning_objectives (id) on delete cascade,
  course_id uuid not null references courses (id) on delete cascade,

  canonical_explanation text,
  key_facts jsonb not null default '[]',
  common_misconceptions jsonb not null default '[]',
  diagnostic_cues jsonb not null default '[]',
  analogies jsonb not null default '[]',
  teaching_progression jsonb not null default '[]',
  practice_generation_guidance text,
  source_refs jsonb not null default '[]',

  -- Versioning/invalidation — see architecture doc "MATERIAL
  -- VERSIONING / INVALIDATION". source_hash is a hash of this
  -- objective's concatenated material_chunks content at generation
  -- time; the compiler only regenerates when this would change.
  source_hash text,
  prompt_version text not null default 'v1',
  model text,
  status intelligence_status not null default 'missing',
  error text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index learning_objective_intelligence_course_id_idx
  on learning_objective_intelligence (course_id);

alter table learning_objective_intelligence enable row level security;

-- Course-membership gated, same as learning_objectives itself — no new
-- authorization surface, and it contains no answer keys (pedagogy
-- about a topic, never tied to one graded question). See architecture
-- doc "ASSESSMENT MODEL — SECURITY BOUNDARIES".
create policy "course members can read course intelligence"
on learning_objective_intelligence for select
to authenticated
using (current_course_role(course_id) is not null);

-- No client insert/update/delete policy — written only by the
-- service-role compiler script, same posture as material_chunks.

-- One row per objective, "missing" until the compiler runs — lets the
-- runtime tutor and any future instructor-facing status view tell
-- "never generated" apart from "generated, now stale."
insert into learning_objective_intelligence (learning_objective_id, course_id, status)
select id, course_id, 'missing' from learning_objectives
on conflict (learning_objective_id) do nothing;
