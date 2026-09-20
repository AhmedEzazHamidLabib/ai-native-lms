-- "Assessment" stops implicitly meaning "graded quiz."
-- See docs/COURSEWORK_LEARNING_ARCHITECTURE.md "ASSESSMENT MODEL".

create type assessment_kind as enum ('mock_test', 'class_test', 'project');

alter table assessments
  add column if not exists kind assessment_kind not null default 'mock_test',
  add column if not exists points_possible integer,
  add column if not exists contributes_to_grade boolean not null default false;

-- Reclassify the existing, already-attempted assessment in place.
-- Zero rows in attempts/attempt_questions/responses are touched —
-- this is a column update on the assessment row only.
update assessments
set kind = 'mock_test',
    contributes_to_grade = false,
    points_possible = question_count
where title ilike '%mock test%';

-- ---------------------------------------------------------------------
-- Class Test: same secure engine as Mock Test, but a DIFFERENT,
-- separate, empty, locked question bank — the hidden pool. No
-- questions are fabricated here; an instructor populates this bank
-- later via the existing ingestion script. Structurally separate from
-- Practice/Mock Test's bank from the moment it's created, not merely
-- flagged.
-- ---------------------------------------------------------------------

do $$
declare
  v_course_id uuid := '11111111-1111-1111-1111-111111111111'; -- CSE 1203
  v_hidden_bank_id uuid;
  v_placeholder_bank_id uuid;
begin
  if not exists (select 1 from courses where id = v_course_id) then
    return;
  end if;

  if not exists (
    select 1 from assessments where course_id = v_course_id and kind = 'class_test'
  ) then
    insert into question_banks (course_id, title, version)
    values (v_course_id, 'CSE 1203 Class Test Bank (hidden)', 1)
    returning id into v_hidden_bank_id;

    insert into assessments (
      course_id, bank_id, title, instructions, question_count,
      published_at, locked, kind, points_possible, contributes_to_grade
    ) values (
      v_course_id, v_hidden_bank_id, 'Class Test',
      'Your instructor will open this test when it is ready.',
      0, now(), true, 'class_test', 10, true
    );
  end if;

  if not exists (
    select 1 from assessments where course_id = v_course_id and kind = 'project'
  ) then
    -- Placeholder bank only: the schema requires bank_id not null, but
    -- a Project is never started through the quiz engine at all (see
    -- the `projects` table, 0021) — this bank is never rendered.
    insert into question_banks (course_id, title, version)
    values (v_course_id, 'CSE 1203 Project (placeholder — not a quiz bank)', 1)
    returning id into v_placeholder_bank_id;

    insert into assessments (
      course_id, bank_id, title, instructions, question_count,
      published_at, locked, kind, points_possible, contributes_to_grade
    ) values (
      v_course_id, v_placeholder_bank_id, 'Project',
      'See the Project section for groups, deliverables, and submission.',
      0, now(), true, 'project', 10, true
    );
  end if;
end $$;
