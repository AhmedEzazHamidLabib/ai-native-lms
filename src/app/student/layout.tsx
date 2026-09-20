import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getCurrentUser, getMyFullName } from "@/lib/supabase/course";

const NAV = [
  { label: "My Courses", href: "/student" },
  { label: "Available Courses", href: "/student/courses" },
];

export default async function StudentLayout({ children }: LayoutProps<"/student">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const fullName = await getMyFullName();

  return (
    <AppShell
      roleLabel="Student"
      courseCode="Coursework"
      userEmail={user.email}
      displayName={fullName}
      navItems={NAV}
    >
      {children}
    </AppShell>
  );
}
