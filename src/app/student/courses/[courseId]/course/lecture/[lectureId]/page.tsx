import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { SlideViewer } from "@/components/course/slide-viewer";
import { PresentationViewer } from "@/components/course/presentation-viewer";
import { PdfViewer } from "@/components/course/pdf-viewer";
import { DocumentViewer } from "@/components/course/document-viewer";
import { getLectureContent, getSlidesForVersion } from "@/lib/domain/queries";
import { getSignedMaterialUrl } from "@/lib/domain/actions";
import { materialsForLecture } from "@/lib/domain/selectors";

export default async function StudentLecturePage({
  params,
}: PageProps<"/student/courses/[courseId]/course/lecture/[lectureId]">) {
  const { courseId, lectureId } = await params;

  const content = await getLectureContent(lectureId);
  // A missing row and an RLS-filtered (draft, or someone else's course)
  // row look identical here — that's the point (Invariant 3).
  if (!content || !content.lecture.publishedAt) notFound();

  const { lecture, unit, materials: allMaterials, materialVersions } = content;
  const materials = materialsForLecture(allMaterials, lecture.id).filter(
    (m) => m.publishedAt !== null,
  );

  return (
    <>
      <PageHeader
        eyebrow={unit?.title}
        title={lecture.title}
        description={
          lecture.scheduledFor ? `Scheduled ${lecture.scheduledFor}` : undefined
        }
      />

      {materials.length === 0 ? (
        <p className="text-sm text-muted">
          No materials published for this lecture yet.
        </p>
      ) : (
        <div className="space-y-10">
          {await Promise.all(
            materials.map(async (material) => {
              const version = materialVersions.find(
                (v) => v.id === material.currentVersionId,
              );
              const slides = version
                ? await getSlidesForVersion(version.id)
                : [];
              const pdfUrl =
                version?.renderedPdfPath ? await getSignedMaterialUrl(version.renderedPdfPath) : null;

              return (
                <section key={material.id}>
                  <h2 className="font-display text-lg text-ink mb-3">
                    {material.title}
                  </h2>

                  {material.kind === "link" || material.kind === "video" ? (
                    <a
                      href={material.externalUrl ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-azure hover:underline underline-offset-2"
                    >
                      Open {material.kind === "video" ? "video" : "link"} ↗
                    </a>
                  ) : material.kind === "pptx" && version && pdfUrl && slides.length > 0 ? (
                    <PresentationViewer
                      courseId={courseId}
                      lectureId={lectureId}
                      pdfUrl={pdfUrl}
                      slides={slides}
                      totalSlideCount={version.slideCount ?? slides.length}
                    />
                  ) : material.kind === "pptx" && version && slides.length > 0 ? (
                    <SlideViewer
                      slides={slides}
                      totalSlideCount={version.slideCount ?? slides.length}
                    />
                  ) : material.kind === "pdf" && version && pdfUrl ? (
                    <PdfViewer pdfUrl={pdfUrl} title={material.title} />
                  ) : material.kind === "document" && version?.extractedHtml ? (
                    <DocumentViewer html={version.extractedHtml} />
                  ) : version && version.ingestionStatus === "processing" ? (
                    <p className="text-sm text-muted">This material is still being processed.</p>
                  ) : version && version.ingestionStatus === "failed" ? (
                    <p className="text-sm text-danger">
                      This material could not be processed{version.ingestionError ? `: ${version.ingestionError}` : "."}
                    </p>
                  ) : version && material.kind === "pdf" ? (
                    <p className="text-sm text-muted">This PDF isn&apos;t available right now.</p>
                  ) : (
                    <p className="text-sm text-muted">Material unavailable.</p>
                  )}
                </section>
              );
            }),
          )}
        </div>
      )}
    </>
  );
}
