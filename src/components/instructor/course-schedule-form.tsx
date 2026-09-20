"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCourseScheduleAction } from "@/lib/domain/course-schedule-actions";
import type { CourseSchedule } from "@/lib/domain/course-schedule";
import { Button } from "@/components/ui/button";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const DAY_LABEL: Record<(typeof DAYS)[number], string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

export function CourseScheduleForm({ courseId, schedule }: { courseId: string; schedule: CourseSchedule }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [startDate, setStartDate] = useState(schedule.startDate ?? "");
  const [endDate, setEndDate] = useState(schedule.endDate ?? "");
  const [days, setDays] = useState<Set<string>>(new Set(schedule.meetingDays));
  const [startTime, setStartTime] = useState(schedule.meetingStartTime?.slice(0, 5) ?? "");
  const [endTime, setEndTime] = useState(schedule.meetingEndTime?.slice(0, 5) ?? "");
  const [timezone, setTimezone] = useState(schedule.timezone);

  function toggleDay(day: string) {
    setDays((d) => {
      const next = new Set(d);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await setCourseScheduleAction(courseId, {
        startDate: startDate || null,
        endDate: endDate || null,
        meetingDays: [...days],
        meetingStartTime: startTime || null,
        meetingEndTime: endTime || null,
        timezone: timezone.trim() || "UTC",
      });
      if (result.error) setError(result.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="border border-border rounded-md px-5 py-4 space-y-4 max-w-lg">
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs text-muted mb-1.5">Term start date</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-surface"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1.5">Term end date</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-surface"
          />
        </label>
      </div>

      <div>
        <span className="block text-xs text-muted mb-1.5">Meeting days</span>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className={
                "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors duration-[180ms] " +
                (days.has(day) ? "bg-ink text-warm-paper border-ink" : "border-border text-muted hover:border-ink")
              }
            >
              {DAY_LABEL[day]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs text-muted mb-1.5">Class start time (optional)</span>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-surface"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1.5">Class end time (optional)</span>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-surface"
          />
        </label>
      </div>

      <label className="block">
        <span className="block text-xs text-muted mb-1.5">Timezone</span>
        <input
          type="text"
          list="timezone-suggestions"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="e.g. Asia/Dhaka"
          className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-surface"
        />
        <datalist id="timezone-suggestions">
          <option value="UTC" />
          <option value="Asia/Dhaka" />
          <option value="America/New_York" />
          <option value="America/Chicago" />
          <option value="America/Los_Angeles" />
          <option value="Europe/London" />
          <option value="Asia/Kolkata" />
        </datalist>
      </label>

      <div className="flex items-center gap-3">
        <Button disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save schedule"}
        </Button>
        {saved && <span className="text-xs text-success">Saved.</span>}
      </div>
      <p className="text-xs text-muted">
        Leave meeting days empty if this course doesn&apos;t meet on a fixed schedule — the Calendar will only show
        events you add directly.
      </p>
    </div>
  );
}
