import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { getCourseContent } from "@/lib/domain/queries";
import { materialDisplayStatus } from "@/lib/domain/types";

export default async function InstructorCourseOverviewPage({
  params,
}: PageProps<"/instructor/courses/[courseId]">) {
  const { courseId } = await params;
  const { course, units, lectures, materials, materialVersions } =
    await getCourseContent(courseId);

  const draftLectures = lectures.filter((l) => !l.publishedAt);
  const failedMaterials = materials.filter((m) => {
    const v = materialVersions.find((v) => v.id === m.currentVersionId);
    return v?.ingestionStatus === "failed";
  });
  const processingMaterials = materials.filter((m) => {
    const v = materialVersions.find((v) => v.id === m.currentVersionId);
    return v?.ingestionStatus === "processing" || v?.ingestionStatus === "pending";
  });

  return (
    <>
      <PageHeader
        eyebrow={course.term}
        title={course.title}
        description={`${course.code} · ${units.length} units · ${lectures.length} lectures · ${materials.length} materials`}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-border border border-border rounded-md overflow-hidden mb-10">
        <StatBlock label="Draft lectures" value={draftLectures.length} />
        <StatBlock label="Processing materials" value={processingMaterials.length} />
        <StatBlock label="Failed extractions" value={failedMaterials.length} />
      </div>

      <section>
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">
          Needs attention
        </h2>
        {failedMaterials.length === 0 && processingMaterials.length === 0 ? (
          <p className="text-sm text-muted">Nothing needs attention right now.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-b border-border">
            {[...failedMaterials, ...processingMaterials].map((m) => {
              const version = materialVersions.find((v) => v.id === m.currentVersionId);
              return (
                <li key={m.id}>
                  <Link
                    href={`/instructor/courses/${courseId}/content/lecture/${m.lectureId}/materials/${m.id}`}
                    className="flex items-center justify-between gap-3 px-1 py-3 hover:bg-black/[0.02] transition-colors duration-[180ms]"
                  >
                    <span className="text-sm text-text min-w-0 truncate">{m.title}</span>
                    <StatusPill status={materialDisplayStatus(m, version ?? null)} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-warm-paper px-5 py-4">
      <p className="text-2xl font-display text-ink">{value}</p>
      <p className="text-xs text-muted mt-1">{label}</p>
    </div>
  );
}
