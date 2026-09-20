import { PageHeader } from "@/components/ui/page-header";
import { getInstructorAnnouncements } from "@/lib/domain/announcements";
import { AnnouncementManager } from "@/components/instructor/announcement-manager";

export default async function InstructorAnnouncementsPage({
  params,
}: PageProps<"/instructor/courses/[courseId]/announcements">) {
  const { courseId } = await params;
  const announcements = await getInstructorAnnouncements(courseId);

  return (
    <>
      <PageHeader title="Announcements" description="Post updates your students see on their course home and Announcements page." />
      <AnnouncementManager courseId={courseId} announcements={announcements} />
    </>
  );
}
