import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { IntelligenceStatusList } from "@/components/instructor/intelligence-status-list";
import { getCourseIntelligenceStatus } from "@/lib/domain/course-intelligence";

export default async function InstructorCourseIntelligencePage({
  params,
}: PageProps<"/instructor/courses/[courseId]/content/intelligence">) {
  const { courseId } = await params;
  const rows = await getCourseIntelligenceStatus(courseId);

  return (
    <>
      <PageHeader
        title="AI Tutor Readiness"
        description="Shows how well the AI Tutor understands each learning objective in this course. Rebuild an objective after updating its material so the Tutor's explanations reflect the latest version."
        action={
          <Link href={`/instructor/courses/${courseId}/content`} className="text-xs text-azure hover:underline">
            ← Back to Content
          </Link>
        }
      />
      <IntelligenceStatusList courseId={courseId} rows={rows} />
    </>
  );
}
