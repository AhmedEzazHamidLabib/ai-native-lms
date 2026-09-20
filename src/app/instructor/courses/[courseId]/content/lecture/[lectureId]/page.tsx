import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ActionButton } from "@/components/ui/action-button";
import { InlineCreateForm } from "@/components/ui/inline-create-form";
import { getLectureContent } from "@/lib/domain/queries";
import { createMaterial, setLecturePublished } from "@/lib/domain/actions";
import { materialDisplayStatus } from "@/lib/domain/types";

export default async function InstructorLectureEditorPage({
  params,
}: PageProps<"/instructor/courses/[courseId]/content/lecture/[lectureId]">) {
  const { courseId, lectureId } = await params;
  const content = await getLectureContent(lectureId);
  if (!content) notFound();

  const { lecture, unit, materials, materialVersions } = content;

  return (
    <>
      <PageHeader
        eyebrow={unit?.title}
        title={lecture.title}
        action={
          <div className="flex items-center gap-3">
            <StatusPill status={lecture.publishedAt ? "PUBLISHED" : "DRAFT"} />
            <ActionButton
              action={setLecturePublished.bind(
                null,
                lecture.id,
                !lecture.publishedAt,
              )}
              variant={lecture.publishedAt ? "secondary" : "primary"}
            >
              {lecture.publishedAt ? "Unpublish" : "Publish"}
            </ActionButton>
          </div>
        }
      />

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted">
          Materials
        </h2>
      </div>

      {materials.length === 0 ? (
        <p className="text-sm text-muted mb-6">No materials on this lecture yet.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-b border-border mb-6">
          {materials.map((m) => {
            const version = materialVersions.find((v) => v.id === m.currentVersionId);
            return (
              <li key={m.id}>
                <Link
                  href={`/instructor/courses/${courseId}/content/lecture/${lecture.id}/materials/${m.id}`}
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

      <div className="max-w-md">
        <InlineCreateForm
          action={createMaterial.bind(null, lecture.id)}
          placeholder="New material title"
          buttonLabel="Add material"
          extraFields={
            <>
              <select
                name="kind"
                defaultValue="pptx"
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface"
              >
                <option value="pptx">Slides (PPTX)</option>
                <option value="pdf">PDF</option>
                <option value="document">Document (DOCX)</option>
                <option value="link">Link</option>
                <option value="video">Video</option>
              </select>
              <input
                type="url"
                name="externalUrl"
                placeholder="URL (link/video only)"
                className="min-w-0 flex-1 border border-border rounded-md px-3 py-1.5 text-sm bg-surface focus-visible:border-azure"
              />
            </>
          }
        />
      </div>

      <p className="mt-8 text-xs text-muted">
        Publishing a material makes it visible to students immediately.
      </p>
    </>
  );
}
