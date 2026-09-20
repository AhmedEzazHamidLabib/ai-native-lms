import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getStudentAnnouncements } from "@/lib/domain/announcements";
import { AnnouncementList } from "@/components/announcements/announcement-list";

export default async function StudentAnnouncementsPage({
  params,
}: PageProps<"/student/courses/[courseId]/announcements">) {
  const { courseId } = await params;
  const announcements = await getStudentAnnouncements(courseId);

  return (
    <>
      <PageHeader title="Announcements" description="Updates from your instructor." />
      {announcements.length === 0 ? (
        <EmptyState title="No announcements yet" description="Your instructor hasn't posted anything yet." />
      ) : (
        <AnnouncementList announcements={announcements} />
      )}
    </>
  );
}
