import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getCurrentUser, getMyFullName, isCurrentUserOwner, isInstructorAnywhere } from "@/lib/supabase/course";
import type { NavItem } from "@/components/shell/sidebar-nav";

const NAV: NavItem[] = [{ label: "Overview", href: "/instructor" }];

export default async function InstructorLayout({
  children,
}: LayoutProps<"/instructor">) {
  // Belt-and-suspenders: src/proxy.ts already redirects a non-instructor
  // away from /instructor before this layout runs. This check is what
  // renders correctly if this layout is ever reached some other way —
  // RLS underneath every query here is the actual boundary either way.
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const isInstructor = await isInstructorAnywhere();
  if (!isInstructor) redirect("/student");

  // Same pattern: showing/hiding the nav link is presentation. The
  // manage-instructors page and every RPC it calls re-check ownership
  // independently (src/lib/supabase/instructor-management.ts).
  const isOwner = await isCurrentUserOwner();
  const navItems = isOwner
    ? [...NAV, { label: "Manage instructors", href: "/instructor/manage-instructors" }]
    : NAV;
  const fullName = await getMyFullName();

  return (
    <AppShell
      roleLabel="Instructor"
      courseCode="Coursework"
      userEmail={user.email}
      displayName={fullName}
      navItems={navItems}
    >
      {children}
    </AppShell>
  );
}
