import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { getCourseCalendar } from "@/lib/domain/calendar";
import { CalendarView } from "@/components/calendar/calendar-view";

function monthRange(monthParam: string | undefined): { year: number; month: number; from: string; to: string; label: string } {
  const now = new Date();
  const [y, m] = (monthParam ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`).split("-").map(Number);
  const year = y || now.getFullYear();
  const month = m || now.getMonth() + 1;
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const label = new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return { year, month, from, to, label };
}

function adjacentMonth(year: number, month: number, delta: number): string {
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function StudentCalendarPage({
  params,
  searchParams,
}: PageProps<"/student/courses/[courseId]/calendar">) {
  const { courseId } = await params;
  const sp = await searchParams;
  const monthParam = typeof sp.month === "string" ? sp.month : undefined;
  const { year, month, from, to, label } = monthRange(monthParam);

  const calendar = await getCourseCalendar(courseId, from, to);

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Class sessions and course events."
        action={
          <div className="flex items-center gap-3">
            <Link href={`?month=${adjacentMonth(year, month, -1)}`} className="text-sm text-azure hover:underline">
              ← Prev
            </Link>
            <span className="text-sm font-medium text-text">{label}</span>
            <Link href={`?month=${adjacentMonth(year, month, 1)}`} className="text-sm text-azure hover:underline">
              Next →
            </Link>
          </div>
        }
      />
      <CalendarView courseId={courseId} calendar={calendar} editable={false} lectures={[]} />
    </>
  );
}
