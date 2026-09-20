-- Learning objectives: the spine connecting materials, assessment
-- questions, tutor context, and practice evidence. See
-- docs/AI_TUTOR_ARCHITECTURE.md §2 for the rationale.
--
-- Normalizes questions.topic (free text) rather than replacing it —
-- the topic string is kept as-is; a mapping table backfills
-- questions.learning_objective_id so nothing existing breaks if the
-- mapping needs revisiting later.

create table learning_objectives (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  title text not null,
  description text not null default '',
  -- Ordering/provenance hint only — several objectives are legitimately
  -- taught across more than one lecture (see architecture doc §2).
  lecture_id uuid references lectures (id) on delete set null,
  position integer not null,
  created_at timestamptz not null default now(),
  unique (course_id, title)
);

create index learning_objectives_course_id_idx on learning_objectives (course_id);

alter table learning_objectives enable row level security;

create policy "course members can read learning objectives"
on learning_objectives for select
to authenticated
using (current_course_role(course_id) is not null);

-- No client insert/update/delete policy: curated via migration/service
-- role for this milestone (see architecture doc §10) — same posture as
-- courses/questions today.

-- ---------------------------------------------------------------------
-- questions.learning_objective_id
-- ---------------------------------------------------------------------

alter table questions
  add column if not exists learning_objective_id uuid references learning_objectives (id) on delete set null;

create index if not exists questions_learning_objective_id_idx
  on questions (learning_objective_id);

-- ---------------------------------------------------------------------
-- Seed CSE 1203's objectives from the real topic distribution
-- (derived empirically — see docs/AI_TUTOR_ARCHITECTURE.md §2).
-- Idempotent: keyed on (course_id, title), safe to re-run.
-- ---------------------------------------------------------------------

do $$
declare
  v_course_id uuid := '11111111-1111-1111-1111-111111111111'; -- CSE 1203
  v_lecture_1 uuid;
  v_lecture_2 uuid;
begin
  if not exists (select 1 from courses where id = v_course_id) then
    return; -- seed course not present in this environment; skip quietly
  end if;

  select l.id into v_lecture_1
  from lectures l join units u on u.id = l.unit_id
  where u.course_id = v_course_id
  order by u.position, l.position
  limit 1;

  select l.id into v_lecture_2
  from lectures l join units u on u.id = l.unit_id
  where u.course_id = v_course_id
  order by u.position, l.position
  offset 1 limit 1;

  insert into learning_objectives (course_id, title, description, lecture_id, position)
  values
    (v_course_id, 'Computer Basics & History',
     'What a computer is, and the historical arc from early computing to today.',
     v_lecture_1, 1),
    (v_course_id, 'AI & LLM Concepts',
     'Large language models: tokens, context, training vs. inference, agents, and their reliability limits.',
     v_lecture_1, 2),
    (v_course_id, 'Binary, Bits & Bytes',
     'How computers represent information as binary digits, and how bits group into bytes.',
     v_lecture_1, 3),
    (v_course_id, 'Memory & Storage',
     'The difference between working memory (RAM) and persistent storage, and why both are needed.',
     v_lecture_2, 4),
    (v_course_id, 'Computer Hardware',
     'The physical components of a computer — CPU, GPU, I/O, networking, power — and how they fit together.',
     v_lecture_2, 5),
    (v_course_id, 'Operating Systems',
     'What an operating system does and why every computer needs one.',
     v_lecture_2, 6),
    (v_course_id, 'DOS & Command Line',
     'Interacting with a computer through a command-line interface, and how DOS led to modern OS shells.',
     v_lecture_2, 7)
  on conflict (course_id, title) do nothing;
end $$;

-- ---------------------------------------------------------------------
-- Backfill: map existing free-text topics to the seeded objectives.
-- Explicit and reviewable rather than fuzzy-matched. Idempotent —
-- only touches rows that aren't mapped yet.
-- ---------------------------------------------------------------------

do $$
declare
  v_course_id uuid := '11111111-1111-1111-1111-111111111111';
  v_obj record;
  v_mapping jsonb := '{
    "Computer Basics & History": ["History", "PC history", "Computer basics"],
    "AI & LLM Concepts": ["LLMs", "Tokens", "Inference", "Training", "Context", "Agents", "AI reliability", "Algorithms", "Cloud"],
    "Binary, Bits & Bytes": ["Binary", "Bits", "Bytes", "Encoding"],
    "Memory & Storage": ["Memory", "Storage", "RAM"],
    "Computer Hardware": ["CPU", "GPU", "Hardware", "Components", "Power", "Input", "Input/output", "Networking"],
    "Operating Systems": ["OS"],
    "DOS & Command Line": ["DOS", "CLI"]
  }'::jsonb;
begin
  if not exists (select 1 from courses where id = v_course_id) then
    return;
  end if;

  for v_obj in
    select key as title, value as topics from jsonb_each(v_mapping)
  loop
    update questions q
    set learning_objective_id = lo.id
    from learning_objectives lo,
         question_banks qb
    where lo.course_id = v_course_id
      and lo.title = v_obj.title
      and qb.id = q.bank_id
      and qb.course_id = v_course_id
      and q.topic in (select jsonb_array_elements_text(v_obj.topics))
      and q.learning_objective_id is null;
  end loop;
end $$;
