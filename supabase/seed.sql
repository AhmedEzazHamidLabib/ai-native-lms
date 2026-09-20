-- Minimal real course skeleton — not fixture data, this is what an
-- instructor would create through the Content UI once course creation
-- ships. Seeded directly for now because course creation is out of
-- Milestone 1 scope (see docs/DECISIONS.md).
--
-- This does NOT create user accounts or course_members rows: those
-- require real auth.users rows, which only exist after someone signs
-- up via Supabase Auth. After your instructor account signs up once,
-- link it with:
--
--   insert into course_members (course_id, user_id, role)
--   values ('11111111-1111-1111-1111-111111111111', '<their auth uid>', 'instructor');

insert into courses (id, code, title, term)
values (
  '11111111-1111-1111-1111-111111111111',
  'CSE 1203',
  'Introduction to Computing',
  'Fall 2026'
)
on conflict (id) do nothing;

insert into units (id, course_id, title, position)
values
  ('11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', 'Unit 01 — Foundations', 1),
  ('11111111-1111-1111-1111-111111111113', '11111111-1111-1111-1111-111111111111', 'Unit 02 — Systems', 2)
on conflict (id) do nothing;
