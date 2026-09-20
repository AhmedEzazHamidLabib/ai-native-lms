-- The existing "students read files behind published, current
-- versions" storage policy only matched objects.name against
-- material_versions.storage_path (the original PPTX) — the rendered
-- PDF lives at a different path (material_versions.rendered_pdf_path)
-- and was correctly invisible under RLS, so signed URLs for it 404'd.
-- Additive: same authorization shape, now matches either path.

drop policy if exists "students read files behind published, current versions" on storage.objects;

create policy "students read files behind published, current versions"
on storage.objects for select
to authenticated
using (
  bucket_id = 'course-materials'
  and exists (
    select 1
    from material_versions mv
    join materials m on m.id = mv.material_id and m.current_version_id = mv.id
    join lectures l on l.id = m.lecture_id
    join units u on u.id = l.unit_id
    join course_members cm on cm.course_id = u.course_id and cm.user_id = auth.uid()
    where (mv.storage_path = name or mv.rendered_pdf_path = name)
      and m.published_at is not null
      and l.published_at is not null
  )
);
