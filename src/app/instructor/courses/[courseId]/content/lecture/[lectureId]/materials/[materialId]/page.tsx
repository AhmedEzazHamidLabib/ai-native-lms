import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ActionButton } from "@/components/ui/action-button";
import { SlideViewer } from "@/components/course/slide-viewer";
import { DocumentViewer } from "@/components/course/document-viewer";
import { MaterialUploadForm } from "@/components/course/material-upload-form";
import { RenderedPdfUploadForm } from "@/components/course/rendered-pdf-upload-form";
import { ContentItemMenu } from "@/components/instructor/content-item-menu";
import { getMaterialDetail } from "@/lib/domain/queries";
import {
  downloadMaterialVersion,
  retryIngestion,
  setMaterialPublished,
  renameMaterialAction,
  reorderMaterialAction,
  setMaterialArchivedAction,
  deleteMaterialAction,
} from "@/lib/domain/actions";
import { materialDisplayStatus } from "@/lib/domain/types";

export default async function InstructorMaterialPage({
  params,
}: PageProps<"/instructor/courses/[courseId]/content/lecture/[lectureId]/materials/[materialId]">) {
  const { courseId, lectureId, materialId } = await params;

  const detail = await getMaterialDetail(materialId);
  if (!detail || detail.material.lectureId !== lectureId) notFound();

  const { material, lecture, versions, currentVersion, slides } = detail;
  const status = materialDisplayStatus(material, currentVersion ?? null);

  return (
    <>
      <PageHeader
        eyebrow={lecture?.title}
        title={material.title}
        action={
          <div className="flex items-center gap-2">
            {material.archivedAt ? (
              <span className="text-[11px] uppercase tracking-wide text-muted">Archived</span>
            ) : (
              <StatusPill status={status} />
            )}
            <ContentItemMenu
              currentTitle={material.title}
              onRename={renameMaterialAction.bind(null, courseId, lectureId, material.id)}
              onMoveUp={reorderMaterialAction.bind(null, courseId, lectureId, material.id, "up")}
              onMoveDown={reorderMaterialAction.bind(null, courseId, lectureId, material.id, "down")}
              isArchived={Boolean(material.archivedAt)}
              onToggleArchive={setMaterialArchivedAction.bind(null, courseId, lectureId, material.id, !material.archivedAt)}
              onDelete={deleteMaterialAction.bind(null, courseId, lectureId, material.id)}
              deleteDisabledHint="Only a never-published material with no extracted content can be permanently deleted."
              deleteRedirectTo={`/instructor/courses/${courseId}/content/lecture/${lectureId}`}
            />
          </div>
        }
      />

      {(material.kind === "pptx" ||
        material.kind === "pdf" ||
        material.kind === "document") && (
        <>
          <section className="mb-10 border border-border rounded-md px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text font-medium">
                  {currentVersion
                    ? `Version ${currentVersion.versionNumber} · ${currentVersion.originalFilename}`
                    : "No source uploaded yet"}
                </p>
                {currentVersion && (
                  <p className="text-xs text-muted mt-1">
                    Uploaded {new Date(currentVersion.uploadedAt).toLocaleString()}
                    {currentVersion.slideCount !== null &&
                      ` · ${currentVersion.slideCount} slides`}
                  </p>
                )}
                {currentVersion?.ingestionStatus === "failed" && (
                  <p className="text-xs text-danger mt-1">
                    {currentVersion.ingestionError ?? "Extraction failed."}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                {currentVersion?.ingestionStatus === "failed" && (
                  <ActionButton
                    action={retryIngestion.bind(
                      null,
                      currentVersion.id,
                      material.id,
                      lectureId,
                    )}
                    variant="secondary"
                  >
                    Retry extraction
                  </ActionButton>
                )}
                {currentVersion && (
                  <ActionButton
                    action={downloadMaterialVersion.bind(
                      null,
                      currentVersion.sourceStoragePath,
                    )}
                    variant="secondary"
                  >
                    Download original
                  </ActionButton>
                )}
              </div>
            </div>
          </section>

          <section className="mb-10">
            <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">
              Upload revision
            </h2>
            <MaterialUploadForm
              materialId={material.id}
              nextVersionNumber={(currentVersion?.versionNumber ?? 0) + 1}
            />
          </section>

          {material.kind === "pptx" && currentVersion && (
            <section className="mb-10">
              <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">
                Rendered slides {currentVersion.renderedPdfPath && <span className="text-success normal-case">· attached</span>}
              </h2>
              <RenderedPdfUploadForm materialId={material.id} hasRenderedPdf={Boolean(currentVersion.renderedPdfPath)} />
            </section>
          )}
        </>
      )}

      {(material.kind === "link" || material.kind === "video") && (
        <section className="mb-10 border border-border rounded-md px-5 py-4">
          <a
            href={material.externalUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-azure hover:underline underline-offset-2"
          >
            {material.externalUrl} ↗
          </a>
        </section>
      )}

      {currentVersion && (
        <section className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-medium tracking-wide uppercase text-muted">
              Preview
            </h2>
            {material.archivedAt ? (
              <span className="text-xs text-muted">Restore this material before publishing it again.</span>
            ) : (
              <ActionButton
                action={setMaterialPublished.bind(
                  null,
                  material.id,
                  lectureId,
                  !material.publishedAt,
                )}
                variant={material.publishedAt ? "secondary" : "primary"}
              >
                {material.publishedAt ? "Unpublish" : "Publish"}
              </ActionButton>
            )}
          </div>
          {material.kind === "pptx" && slides.length > 0 ? (
            <SlideViewer
              slides={slides}
              totalSlideCount={currentVersion.slideCount ?? slides.length}
            />
          ) : material.kind === "document" && currentVersion.extractedHtml ? (
            <DocumentViewer html={currentVersion.extractedHtml} />
          ) : material.kind === "pdf" && currentVersion.ingestionStatus === "ready" ? (
            <p className="text-sm text-muted">
              PDF ready — students will see the file directly. Use &quot;Download original&quot; above to preview it yourself.
            </p>
          ) : currentVersion.ingestionStatus === "processing" || currentVersion.ingestionStatus === "pending" ? (
            <p className="text-sm text-muted">Extraction in progress.</p>
          ) : currentVersion.ingestionStatus === "failed" ? (
            <p className="text-sm text-danger">{currentVersion.ingestionError ?? "Extraction failed."}</p>
          ) : (
            <p className="text-sm text-muted">No preview available for this material kind yet.</p>
          )}
        </section>
      )}

      {versions.length > 1 && (
        <section>
          <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">
            Version history
          </h2>
          <ul className="divide-y divide-border border-t border-b border-border">
            {versions.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between px-1 py-3 text-sm"
              >
                <span>
                  Version {v.versionNumber} · {v.originalFilename}
                </span>
                <span className="text-xs text-muted">
                  {new Date(v.uploadedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
