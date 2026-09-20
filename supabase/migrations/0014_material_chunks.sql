-- Retrievable knowledge chunks for the AI tutor. One row per slide (the
-- existing semantic boundary — see docs/AI_TUTOR_ARCHITECTURE.md §3),
-- not fixed-character splitting. Populated by
-- scripts/backfill-material-chunks.mjs, which only chunks PUBLISHED
-- lectures/materials — the same visibility rule already enforced by
-- RLS on `slides` — so retrieval can never surface draft content.
--
-- Full-text search (tsvector), not embeddings: Anthropic (our
-- configured provider) has no embeddings endpoint, and adding a second
-- provider purely for vectors is exactly the speculative infra this
-- milestone should avoid. The `embedding` column is reserved for a
-- future pgvector backfill but intentionally left unpopulated and
-- unused by retrieval today.

-- Only for the reserved `embedding` column below (unused by retrieval
-- today — see comment on that column).
create extension if not exists "vector";

create table material_chunks (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  lecture_id uuid not null references lectures (id) on delete cascade,
  material_id uuid not null references materials (id) on delete cascade,
  material_version_id uuid not null references material_versions (id) on delete cascade,
  slide_id uuid not null references slides (id) on delete cascade,
  -- Best-effort keyword match against the objective's topic list
  -- (see backfill script) — nullable; a miss means "no objective
  -- filter," never a fabricated one.
  learning_objective_id uuid references learning_objectives (id) on delete set null,
  position integer not null,
  content text not null,
  -- Reserved for a future pgvector backfill. Unused by retrieval today
  -- (see architecture doc §3) — no embeddings provider configured.
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (slide_id)
);

create index material_chunks_course_id_idx on material_chunks (course_id);
create index material_chunks_lecture_id_idx on material_chunks (lecture_id);
create index material_chunks_learning_objective_id_idx on material_chunks (learning_objective_id);
create index material_chunks_content_fts_idx
  on material_chunks using gin (to_tsvector('english', content));

alter table material_chunks enable row level security;

create policy "course members can read material chunks"
on material_chunks for select
to authenticated
using (current_course_role(course_id) is not null);

-- No client insert/update/delete policy — populated only by the
-- service-role backfill script, same posture as the ingestion
-- pipeline's slides writes.

-- ---------------------------------------------------------------------
-- search_course_material(): the ONLY retrieval path the tutor uses.
-- SECURITY DEFINER, re-derives auth.uid() and re-checks course
-- membership itself — never trusts that the caller already checked.
-- Full-text ranked, course-scoped, optionally objective-scoped.
-- ---------------------------------------------------------------------

create or replace function search_course_material(
  p_course_id uuid,
  p_query text,
  p_learning_objective_id uuid default null,
  p_limit integer default 5
)
returns table (
  chunk_id uuid,
  lecture_title text,
  material_title text,
  slide_index integer,
  slide_title text,
  content text,
  rank real
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if current_course_role(p_course_id) is null then
    raise exception 'Not authorized.';
  end if;

  return query
  select
    mc.id,
    l.title,
    m.title,
    s.index,
    s.title,
    mc.content,
    ts_rank(to_tsvector('english', mc.content), plainto_tsquery('english', p_query))::real as rank
  from material_chunks mc
  join lectures l on l.id = mc.lecture_id
  join materials m on m.id = mc.material_id
  join slides s on s.id = mc.slide_id
  where mc.course_id = p_course_id
    and (p_learning_objective_id is null or mc.learning_objective_id = p_learning_objective_id)
    and (
      p_query is null or p_query = '' or
      to_tsvector('english', mc.content) @@ plainto_tsquery('english', p_query)
    )
  order by rank desc, mc.position asc
  limit greatest(p_limit, 1);
end;
$$;

grant execute on function search_course_material(uuid, text, uuid, integer) to authenticated;
