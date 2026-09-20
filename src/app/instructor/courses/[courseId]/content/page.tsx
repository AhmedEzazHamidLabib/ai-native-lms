import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { InlineCreateForm } from "@/components/ui/inline-create-form";
import { ContentItemMenu } from "@/components/instructor/content-item-menu";
import { getCourseContent } from "@/lib/domain/queries";
import {
  createLecture,
  createUnit,
  renameUnitAction,
  reorderUnitAction,
  setUnitArchivedAction,
  deleteUnitAction,
  renameLectureAction,
  reorderLectureAction,
  setLectureArchivedAction,
  deleteLectureAction,
} from "@/lib/domain/actions";
import {
  lecturesForUnit,
  materialsForLecture,
  unitsForCourse,
} from "@/lib/domain/selectors";
import { materialDisplayStatus } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";

export default async function InstructorContentPage({
  params,
  searchParams,
}: PageProps<"/instructor/courses/[courseId]/content">) {
  const { courseId } = await params;
  const sp = await searchParams;
  const showArchived = sp.archived === "1";

  const { course, units: allUnits, lectures: allLectures, materials: allMaterials, materialVersions } =
    await getCourseContent(courseId);

  const units = unitsForCourse(allUnits, course.id).filter((u) => showArchived || !u.archivedAt);

  return (
    <>
      <PageHeader
        title="Content"
        description="Units, lectures, and materials for this course. Publish a lecture or material to make it visible to students right away."
        action={
          <div className="flex items-center gap-4">
            <Link href={`?archived=${showArchived ? "0" : "1"}`} className="text-xs text-muted hover:text-text">
              {showArchived ? "Hide archived" : "Show archived"}
            </Link>
            <Link href={`/instructor/courses/${courseId}/content/intelligence`} className="text-xs text-azure hover:underline">
              AI Tutor readiness →
            </Link>
          </div>
        }
      />

      <div className="mb-10 max-w-sm">
        <InlineCreateForm
          action={createUnit.bind(null, course.id)}
          placeholder="New unit title"
          buttonLabel="Add unit"
        />
      </div>

      <div className="space-y-10">
        {units.map((unit) => {
          const lectures = lecturesForUnit(allLectures, unit.id).filter((l) => showArchived || !l.archivedAt);
          return (
            <section key={unit.id} className={cn(unit.archivedAt && "opacity-60")}>
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="font-display text-xl text-ink flex items-center gap-2">
                  {unit.title}
                  {unit.archivedAt && <span className="text-[11px] font-sans uppercase tracking-wide text-muted">Archived</span>}
                </h2>
                <ContentItemMenu
                  currentTitle={unit.title}
                  onRename={renameUnitAction.bind(null, courseId, unit.id)}
                  onMoveUp={reorderUnitAction.bind(null, courseId, unit.id, "up")}
                  onMoveDown={reorderUnitAction.bind(null, courseId, unit.id, "down")}
                  isArchived={Boolean(unit.archivedAt)}
                  onToggleArchive={setUnitArchivedAction.bind(null, courseId, unit.id, !unit.archivedAt)}
                  onDelete={deleteUnitAction.bind(null, courseId, unit.id)}
                  deleteDisabledHint="Only an empty unit with no lectures can be permanently deleted."
                />
              </div>
              <ul className="space-y-3 mb-4">
                {lectures.map((lecture) => {
                  const materials = materialsForLecture(allMaterials, lecture.id);
                  return (
                    <li
                      key={lecture.id}
                      className={cn("border border-border rounded-md px-5 py-4", lecture.archivedAt && "opacity-60")}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Link
                          href={`/instructor/courses/${courseId}/content/lecture/${lecture.id}`}
                          className="text-sm font-medium text-text hover:text-azure transition-colors duration-[180ms] min-w-0 truncate"
                        >
                          {lecture.title}
                        </Link>
                        <div className="flex items-center gap-2 shrink-0">
                          {lecture.archivedAt ? (
                            <span className="text-[11px] uppercase tracking-wide text-muted">Archived</span>
                          ) : (
                            <StatusPill status={lecture.publishedAt ? "PUBLISHED" : "DRAFT"} />
                          )}
                          <ContentItemMenu
                            currentTitle={lecture.title}
                            onRename={renameLectureAction.bind(null, courseId, lecture.id)}
                            onMoveUp={reorderLectureAction.bind(null, courseId, lecture.id, "up")}
                            onMoveDown={reorderLectureAction.bind(null, courseId, lecture.id, "down")}
                            isArchived={Boolean(lecture.archivedAt)}
                            onToggleArchive={setLectureArchivedAction.bind(null, courseId, lecture.id, !lecture.archivedAt)}
                            onDelete={deleteLectureAction.bind(null, courseId, lecture.id)}
                            deleteDisabledHint="Only a lecture with no materials, mapped questions, or objectives can be permanently deleted."
                          />
                        </div>
                      </div>
                      {materials.length === 0 ? (
                        <p className="mt-2 text-xs text-muted">No materials yet.</p>
                      ) : (
                        <ul className="mt-3 flex flex-wrap gap-2">
                          {materials.map((m) => {
                            const version = materialVersions.find(
                              (v) => v.id === m.currentVersionId,
                            );
                            return (
                              <li key={m.id}>
                                <Link
                                  href={`/instructor/courses/${courseId}/content/lecture/${lecture.id}/materials/${m.id}`}
                                  className={cn(
                                    "inline-flex items-center gap-2 text-xs text-text border border-border rounded-full px-2.5 py-1 hover:border-ink transition-colors duration-[180ms]",
                                    m.archivedAt && "opacity-60",
                                  )}
                                >
                                  {m.title}
                                  {m.archivedAt ? (
                                    <span className="text-[10px] uppercase tracking-wide text-muted">Archived</span>
                                  ) : (
                                    <StatusPill status={materialDisplayStatus(m, version ?? null)} />
                                  )}
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
              {!unit.archivedAt && (
                <div className="max-w-sm">
                  <InlineCreateForm
                    action={createLecture.bind(null, unit.id)}
                    placeholder="New lecture title"
                    buttonLabel="Add lecture"
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
