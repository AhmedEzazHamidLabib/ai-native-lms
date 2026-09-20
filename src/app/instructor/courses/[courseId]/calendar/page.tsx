import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { getCourseCalendar } from "@/lib/domain/calendar";
import { getCourseContent } from "@/lib/domain/queries";
import { CalendarView } from "@/components/calendar/calendar-view";
import { EventCreator } from "@/components/calendar/event-creator";

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

export default async function InstructorCalendarPage({
  params,
  searchParams,
}: PageProps<"/instructor/courses/[courseId]/calendar">) {
  const { courseId } = await params;
  const sp = await searchParams;
  const monthParam = typeof sp.month === "string" ? sp.month : undefined;
  const { year, month, from, to, label } = monthRange(monthParam);

  const [calendar, content] = await Promise.all([getCourseCalendar(courseId, from, to), getCourseContent(courseId)]);
  const lectures = content.lectures.map((l) => ({ id: l.id, title: l.title }));

  const noMeetingDays = calendar.meetingDays.length === 0;
  const noTermRange = !calendar.startDate || !calendar.endDate;
  const noSchedule = noMeetingDays || noTermRange;

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

      {noSchedule && (
        <p className="text-sm text-muted border border-border rounded-md px-4 py-3 mb-6">
          {noMeetingDays && noTermRange
            ? "No recurring meeting schedule is configured yet."
            : noTermRange
              ? `Meeting days are set (${calendar.meetingDays.map((d) => d[0].toUpperCase() + d.slice(1)).join("/")}), but no term start/end date yet — sessions can't be generated without a date range.`
              : "No meeting days are set yet."}{" "}
          Configure it in{" "}
          <Link href={`/instructor/courses/${courseId}/settings`} className="text-azure hover:underline">
            Settings
          </Link>{" "}
          to see class sessions here automatically — you can still add one-off events below.
        </p>
      )}

      <div className="mb-6">
        <EventCreator courseId={courseId} defaultDate={from} />
      </div>

      <CalendarView courseId={courseId} calendar={calendar} editable lectures={lectures} />
    </>
  );
}
