import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ActionButton } from "@/components/ui/action-button";
import { isCurrentUserOwner } from "@/lib/supabase/course";
import {
  listInstructorStatus,
  removeInstructorEmail,
} from "@/lib/supabase/instructor-management";
import { AddInstructorForm } from "./add-instructor-form";

function statusLabel(row: {
  isActiveInstructor: boolean;
  emailVerified: boolean;
  userRegistered: boolean;
}): string {
  if (row.isActiveInstructor) return "Active";
  if (row.userRegistered && !row.emailVerified) return "Awaiting verification";
  if (!row.userRegistered) return "Invited";
  return "Authorized";
}

export default async function ManageInstructorsPage() {
  // Presentation-level gate — matches what the nav link visibility
  // already does. The real boundary is inside every RPC this page
  // calls, which re-check ownership from auth.uid() independent of
  // this redirect (see src/lib/supabase/instructor-management.ts).
  const isOwner = await isCurrentUserOwner();
  if (!isOwner) redirect("/instructor");

  const { rows, error } = await listInstructorStatus();

  return (
    <>
      <PageHeader
        eyebrow="Owner"
        title="Manage instructors"
        description="Authorize an email for instructor access. They still have to verify it themselves through Instructor Sign Up."
      />

      <section className="mb-10 max-w-md">
        <AddInstructorForm />
      </section>

      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : (
        <ul className="divide-y divide-border border-t border-b border-border">
          {rows.map((row) => (
            <li
              key={row.email}
              className="flex items-center justify-between px-1 py-3 gap-4"
            >
              <div className="min-w-0">
                <p className="text-sm text-text truncate">{row.email}</p>
                <p className="text-xs text-muted">
                  {row.isOwner ? "Owner · " : ""}
                  {statusLabel(row)}
                </p>
              </div>
              {!row.isOwner && (
                <ActionButton
                  action={removeInstructorEmail.bind(null, row.email)}
                  variant="destructive"
                >
                  Remove
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
