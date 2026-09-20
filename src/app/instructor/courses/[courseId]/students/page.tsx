import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { ActionButton } from "@/components/ui/action-button";
import { RosterActionMenu } from "@/components/course/roster-action-menu";
import { getCourseRosterSummary, getPendingRequests } from "@/lib/domain/roster";
import {
  approveEnrollmentRequest,
  rejectEnrollmentRequest,
} from "@/lib/supabase/enrollment-actions";

export default async function InstructorStudentsPage({
  params,
}: PageProps<"/instructor/courses/[courseId]/students">) {
  const { courseId } = await params;
  const [roster, pending] = await Promise.all([
    getCourseRosterSummary(courseId),
    getPendingRequests(courseId),
  ]);

  return (
    <>
      <PageHeader title="Students" description="Who's enrolled, and who's waiting on approval." />

      <section className="mb-12">
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">
          Enrolled ({roster.length})
        </h2>
        {roster.length === 0 ? (
          <p className="text-sm text-muted">No students enrolled yet.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-b border-border">
            {roster.map((r) => (
              <li
                key={r.userId}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1 py-3"
              >
                <Link
                  href={`/instructor/courses/${courseId}/students/${r.userId}`}
                  className="min-w-0 hover:text-azure transition-colors duration-[180ms]"
                >
                  <p className="text-sm text-text truncate">{r.fullName ?? r.email}</p>
                  {r.fullName && <p className="text-xs text-muted truncate">{r.email}</p>}
                  <p className="text-xs text-muted">
                    Enrolled {new Date(r.enrolledAt).toLocaleDateString()}
                    {r.projectGroupName ? ` · ${r.projectGroupName}` : ""}
                    {r.assessmentsTotal > 0 ? ` · ${r.assessmentsSubmitted}/${r.assessmentsTotal} assessments submitted` : ""}
                  </p>
                </Link>
                <div className="shrink-0">
                  <RosterActionMenu courseId={courseId} userId={r.userId} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">
          Pending Requests ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">No enrollment requests right now.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-b border-border">
            {pending.map((r) => (
              <li
                key={r.requestId}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-text truncate">{r.fullName ?? r.email}</p>
                  {r.fullName && <p className="text-xs text-muted truncate">{r.email}</p>}
                  <p className="text-xs text-muted">
                    Requested {new Date(r.requestedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <ActionButton
                    action={approveEnrollmentRequest.bind(null, r.requestId, courseId)}
                  >
                    Approve
                  </ActionButton>
                  <ActionButton
                    action={rejectEnrollmentRequest.bind(null, r.requestId, courseId)}
                    variant="secondary"
                  >
                    Reject
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
