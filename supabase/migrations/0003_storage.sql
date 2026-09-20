-- Private storage bucket for original material source files.
--
-- Path convention: materials/{course_id}/{material_id}/v{version_number}-{filename}
-- Files are never public (Invariant: files must be private, no public URLs).
-- Access is granted per-request via short-lived signed URLs, gated by
-- the same course-membership + publication rules as the rows above.

insert into storage.buckets (id, name, public)
values ('course-materials', 'course-materials', false)
on conflict (id) do nothing;

create policy "instructors manage their course's material files"
on storage.objects for all
to authenticated
using (
  bucket_id = 'course-materials'
  and exists (
    select 1 from course_members cm
    where cm.user_id = auth.uid()
      and cm.role = 'instructor'
      and cm.course_id::text = (storage.foldername(name))[2]
  )
)
with check (
  bucket_id = 'course-materials'
  and exists (
    select 1 from course_members cm
    where cm.user_id = auth.uid()
      and cm.role = 'instructor'
      and cm.course_id::text = (storage.foldername(name))[2]
  )
);

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
    where mv.storage_path = name
      and m.published_at is not null
      and l.published_at is not null
  )
);
