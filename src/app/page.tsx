import { redirect } from "next/navigation";
import { getCurrentUser, isInstructorAnywhere } from "@/lib/supabase/course";

export default async function RootPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Being signed in and being enrolled in a course are different
  // things (docs/ARCHITECTURE.md) — an account with no course
  // membership yet still lands in the student experience (My Courses),
  // which shows its own "choose a course" empty state rather than
  // bouncing them back out. Instructor status is currently global
  // (every course), so this check doesn't need a specific course.
  const isInstructor = await isInstructorAnywhere();
  redirect(isInstructor ? "/instructor" : "/student");
}
