-- New context-routing entry points (docs/COURSEWORK_LEARNING_ARCHITECTURE.md
-- "CONTEXT ROUTING"): a specific slide the student is viewing, and
-- explaining a just-answered question-bank practice question.

alter type tutor_entry_source add value if not exists 'slide';
alter type tutor_entry_source add value if not exists 'question_bank_practice';

alter table tutor_sessions
  add column if not exists source_lecture_id uuid references lectures (id) on delete set null,
  add column if not exists source_slide_id uuid references slides (id) on delete set null,
  add column if not exists source_practice_attempt_id uuid references practice_attempts (id) on delete set null;
