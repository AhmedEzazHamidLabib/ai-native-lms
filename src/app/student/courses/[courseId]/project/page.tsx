import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getProjectForCourse, getProjectGroups, getMyProjectGroup, getJoinableGroups } from "@/lib/projects/actions";
import { DeliverableSubmitForm } from "@/components/projects/deliverable-submit-form";
import { GroupJoinPanel } from "@/components/projects/group-join-panel";
import { cn } from "@/lib/utils/cn";

export default async function ProjectPage({
  params,
}: PageProps<"/student/courses/[courseId]/project">) {
  const { courseId } = await params;
  const project = await getProjectForCourse(courseId);

  if (!project) {
    return (
      <>
        <PageHeader title="Project" />
        <EmptyState title="No project configured" description="Your instructor hasn't set up the project yet." />
      </>
    );
  }

  const [groups, myGroup, joinableGroups] = await Promise.all([
    getProjectGroups(project.id),
    getMyProjectGroup(project.id),
    project.groupMode === "self_enrollment" ? getJoinableGroups(project.id) : Promise.resolve([]),
  ]);

  const groupedByGroup = new Map<string, { groupName: string; members: typeof groups }>();
  for (const g of groups) {
    const existing = groupedByGroup.get(g.groupId);
    if (existing) existing.members.push(g);
    else groupedByGroup.set(g.groupId, { groupName: g.groupName, members: [g] });
  }

  return (
    <>
      <PageHeader
        title="Project"
        description={
          project.pointsPossible != null
            ? `${project.pointsPossible} marks. ${project.description}`
            : project.description
        }
      />

      {myGroup.groupId && myGroup.deliverables.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">Deliverables</h2>
          <ul className="space-y-3">
            {myGroup.deliverables.map((d) => (
              <li key={d.deliverableId} className="border border-border rounded-md px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-text">{d.title}</p>
                    {d.description && <p className="text-xs text-muted mt-1">{d.description}</p>}
                    {d.dueAt && (
                      <p className="text-xs text-muted mt-1">Due {new Date(d.dueAt).toLocaleDateString()}</p>
                    )}
                    {d.allowedType && <p className="text-xs text-muted mt-1">Accepted: {d.allowedType}</p>}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-[11px] font-medium tracking-wide uppercase",
                      d.submitted ? "text-azure" : "text-muted",
                    )}
                  >
                    {d.submitted ? "Submitted" : "Not submitted"}
                  </span>
                </div>
                {d.submitted ? (
                  <p className="text-xs text-muted mt-2">
                    Submitted by {d.submittedByName}
                    {d.submittedAt ? ` · ${new Date(d.submittedAt).toLocaleDateString()}` : ""}
                  </p>
                ) : d.submissionEnabled ? (
                  <DeliverableSubmitForm deliverableId={d.deliverableId} />
                ) : (
                  <p className="text-xs text-muted mt-2">Submissions are currently closed for this deliverable.</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {project.groupMode === "self_enrollment" ? (
        <GroupJoinPanel courseId={courseId} groups={joinableGroups} locked={project.groupsLocked} />
      ) : (
        !myGroup.groupId && (
          <EmptyState
            title="You're not in a project group yet"
            description="Your instructor will add you to a group."
          />
        )
      )}

      <section>
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">Project Groups</h2>
        {groupedByGroup.size === 0 ? (
          <p className="text-sm text-muted">No groups have been set up yet.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-b border-border">
            {[...groupedByGroup.entries()].map(([groupId, g]) => {
              const isMyGroup = g.members.some((m) => m.isMe);
              return (
                <li
                  key={groupId}
                  className={cn("px-1 py-3", isMyGroup && "bg-azure-soft/20")}
                >
                  <p className="text-sm font-medium text-text">
                    {g.groupName}
                    {isMyGroup && <span className="ml-2 text-xs text-azure">(your group)</span>}
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    {g.members.map((m) => m.memberFullName).join(", ")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
