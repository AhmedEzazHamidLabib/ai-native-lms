"use client";

import { useState } from "react";
import type { CourseCalendar } from "@/lib/domain/calendar";
import { SessionEditor } from "./session-editor";
import { DeleteEventButton } from "./event-creator";
import { cn } from "@/lib/utils/cn";

const CATEGORY_LABEL: Record<string, string> = {
  exam: "Exam",
  project_deadline: "Project deadline",
  special_class: "Special class",
  holiday: "Holiday / cancelled",
  other: "Event",
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function CalendarView({
  courseId,
  calendar,
  editable,
  lectures,
}: {
  courseId: string;
  calendar: CourseCalendar;
  editable: boolean;
  lectures: { id: string; title: string }[];
}) {
  const [editingDate, setEditingDate] = useState<string | null>(null);

  type Row = { date: string; dayName?: string; isSession: boolean; events: typeof calendar.events };
  const rowMap = new Map<string, Row>();
  for (const s of calendar.sessions) {
    rowMap.set(s.date, { date: s.date, dayName: s.dayName, isSession: true, events: [] });
  }
  for (const e of calendar.events) {
    const existing = rowMap.get(e.date);
    if (existing) existing.events.push(e);
    else rowMap.set(e.date, { date: e.date, isSession: false, events: [e] });
  }
  const rows = [...rowMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  if (rows.length === 0) {
    return <p className="text-sm text-muted">Nothing scheduled this month.</p>;
  }

  return (
    <ul className="divide-y divide-border border-t border-b border-border">
      {rows.map((row) => {
        const session = calendar.sessions.find((s) => s.date === row.date);
        const note = session?.note;
        return (
          <li key={row.date} className="px-1 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">{formatDate(row.date)}</p>
                {session && (
                  <p className={cn("text-sm mt-0.5", note?.cancelled ? "text-danger line-through" : "text-text")}>
                    {note?.cancelled ? "Class cancelled" : (note?.title ?? "Class session")}
                  </p>
                )}
                {note?.agenda && !note.cancelled && <p className="text-xs text-muted mt-1 whitespace-pre-line">{note.agenda}</p>}
                {row.events.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-azure">{CATEGORY_LABEL[e.category]}</span>
                    <p className="text-sm text-text">{e.title}</p>
                    {editable && <DeleteEventButton courseId={courseId} event={e} />}
                  </div>
                ))}
              </div>
              {editable && session && editingDate !== row.date && (
                <button type="button" onClick={() => setEditingDate(row.date)} className="text-xs text-azure hover:underline shrink-0">
                  {note ? "Edit" : "Add details"}
                </button>
              )}
            </div>
            {editable && session && editingDate === row.date && (
              <SessionEditor courseId={courseId} session={session} lectures={lectures} onClose={() => setEditingDate(null)} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
