-- Presentation rendering: PPTX -> PDF, generated once per material
-- version (PowerPoint COM automation locally — no Docker/LibreOffice/
-- cloud API introduced). Stored in the existing course-materials
-- bucket alongside the original file. See
-- docs/COURSEWORK_LEARNING_ARCHITECTURE.md "PRESENTATIONS". Existing
-- RLS on storage.objects already covers this path (same bucket, same
-- policy) — no storage policy changes needed.

alter table material_versions
  add column if not exists rendered_pdf_path text,
  add column if not exists rendered_at timestamptz;
