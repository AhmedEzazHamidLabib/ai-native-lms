-- Private storage for project submissions. Same shape as the existing
-- course-materials bucket (0003_storage.sql): never public, path-based
-- RLS, short-lived signed URLs only.
--
-- Path convention: {course_id}/{group_id}/{deliverable_id}/{filename}

insert into storage.buckets (id, name, public)
values ('project-submissions', 'project-submissions', false)
on conflict (id) do nothing;

create policy "group members upload into their own group's folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'project-submissions'
  and exists (
    select 1 from project_group_members m
    where m.user_id = auth.uid()
      and m.group_id::text = (storage.foldername(name))[2]
  )
);

create policy "group members and course instructors read submission files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'project-submissions'
  and (
    exists (
      select 1 from project_group_members m
      where m.user_id = auth.uid()
        and m.group_id::text = (storage.foldername(name))[2]
    )
    or exists (
      select 1 from course_members cm
      where cm.user_id = auth.uid()
        and cm.role = 'instructor'
        and cm.course_id::text = (storage.foldername(name))[1]
    )
  )
);
