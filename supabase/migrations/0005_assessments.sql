-- Assessment subsystem: Question Bank -> Test Definition -> Attempt ->
-- Responses -> Submission/Score.
--
-- Security shape (see docs/DECISIONS.md for the reasoning):
--   - question_options.is_correct is never exposed to students through
--     table RLS at all — no student SELECT policy on questions or
--     question_options exists. Students only ever see question/option
--     content through get_attempt_view(), a SECURITY DEFINER function
--     that omits is_correct until the attempt is submitted.
--   - Attempt generation (sampling + shuffling) and grading are both
--     SECURITY DEFINER functions (start_attempt, submit_attempt) —
--     students have no INSERT/UPDATE policy on attempts,
--     attempt_questions, or the score/submitted_at columns at all, so
--     there is no client-writable path to any of those.
--   - responses is the one student-writable table, and only for the
--     student's own not-yet-submitted attempt, only for questions
--     actually assigned to that attempt.

create table question_banks (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  title text not null,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references question_banks (id) on delete cascade,
  -- Provenance (Invariant 7) — nullable because a future question might
  -- not map to one specific lecture.
  source_lecture_id uuid references lectures (id) on delete set null,
  topic text not null,
  difficulty text not null default 'easy' check (difficulty in ('easy', 'medium', 'hard')),
  question_type text not null default 'single_choice' check (question_type in ('single_choice')),
  prompt text not null,
  active boolean not null default true,
  -- Original bank position (e.g. "047") — stable reference back to the
  -- reviewed source document, independent of DB insert order.
  source_position integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index questions_bank_id_idx on questions (bank_id);
create index questions_source_lecture_id_idx on questions (source_lecture_id);

create table question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions (id) on delete cascade,
  position integer not null, -- canonical order in the source bank (0-3)
  text text not null,
  is_correct boolean not null default false
);

create index question_options_question_id_idx on question_options (question_id);
create unique index question_options_one_correct_idx
  on question_options (question_id)
  where is_correct;

create table assessments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  bank_id uuid not null references question_banks (id),
  title text not null,
  instructions text not null default '',
  question_count integer not null,
  -- null = draft, invisible to students (same convention as
  -- lectures/materials).
  published_at timestamptz,
  -- Gates whether a NEW attempt can be started — independent of
  -- published_at. A student who already has an attempt may always
  -- resume it regardless of lock state; locking only stops fresh
  -- starts. Defaults locked so a newly created assessment is never
  -- accidentally open.
  locked boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assessments_course_id_idx on assessments (course_id);

-- One row per sampling rule, e.g. "5 questions from Lecture 1" +
-- "5 questions from Lecture 2". Generalizes to more complex rules later
-- (by topic, by difficulty) without a schema change.
create table assessment_rules (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments (id) on delete cascade,
  position integer not null,
  source_lecture_id uuid references lectures (id),
  topic text,
  difficulty text,
  count integer not null check (count > 0)
);

create index assessment_rules_assessment_id_idx on assessment_rules (assessment_id);

create table attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  bank_version integer not null,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  score integer,
  max_score integer,
  unique (assessment_id, user_id)
);

create index attempts_assessment_id_idx on attempts (assessment_id);
create index attempts_user_id_idx on attempts (user_id);

-- The generated, persisted selection + order for one attempt. Written
-- once by start_attempt() and never updated — "no client-writable path
-- to selected questions or option order" holds by construction (no
-- policy grants students insert/update here at all).
create table attempt_questions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempts (id) on delete cascade,
  question_id uuid not null references questions (id),
  position integer not null,
  -- This student's shuffled option order for this question, as an
  -- ordered array of question_options.id.
  option_order jsonb not null,
  unique (attempt_id, question_id),
  unique (attempt_id, position)
);

create index attempt_questions_attempt_id_idx on attempt_questions (attempt_id);

create table responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempts (id) on delete cascade,
  question_id uuid not null references questions (id),
  selected_option_id uuid references question_options (id),
  answered_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create index responses_attempt_id_idx on responses (attempt_id);
