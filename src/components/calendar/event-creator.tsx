"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCourseEventAction, deleteCourseEventAction } from "@/lib/domain/calendar-actions";
import type { CalendarEvent, CourseEventCategory } from "@/lib/domain/calendar";
import { Button } from "@/components/ui/button";

const CATEGORY_LABEL: Record<CourseEventCategory, string> = {
  exam: "Exam",
  project_deadline: "Project deadline",
  special_class: "Special class",
  holiday: "Holiday / cancelled day",
  other: "Other",
};

export function EventCreator({ courseId, defaultDate }: { courseId: string; defaultDate: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(defaultDate);
  const [category, setCategory] = useState<CourseEventCategory>("other");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [alsoAnnounce, setAlsoAnnounce] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Add event
      </Button>
    );
  }

  return (
    <div className="border border-border rounded-md px-4 py-3 space-y-2 max-w-md">
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface" />
        <select value={category} onChange={(e) => setCategory(e.target.value as CourseEventCategory)} className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface">
          {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-surface"
      />
      <textarea
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        placeholder="Details (optional)"
        rows={2}
        className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-surface"
      />
      <label className="flex items-center gap-2 text-sm text-text">
        <input type="checkbox" checked={alsoAnnounce} onChange={(e) => setAlsoAnnounce(e.target.checked)} />
        Also publish as announcement
      </label>
      <div className="flex gap-2">
        <Button
          disabled={pending || !title.trim()}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await createCourseEventAction(courseId, { eventDate: date, category, title, details: details.trim() || null, alsoAnnounce });
              if (result.error) setError(result.error);
              else {
                setOpen(false);
                setTitle("");
                setDetails("");
                router.refresh();
              }
            })
          }
        >
          Add
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function DeleteEventButton({ courseId, event }: { courseId: string; event: CalendarEvent }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (confirm(`Remove "${event.title}"?`)) {
          startTransition(async () => {
            await deleteCourseEventAction(courseId, event.id);
            router.refresh();
          });
        }
      }}
      className="text-xs text-muted hover:text-danger disabled:opacity-40"
    >
      Remove
    </button>
  );
}
