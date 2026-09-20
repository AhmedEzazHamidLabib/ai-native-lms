"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertSessionNoteAction } from "@/lib/domain/calendar-actions";
import type { CalendarSession } from "@/lib/domain/calendar";
import { Button } from "@/components/ui/button";

export function SessionEditor({
  courseId,
  session,
  lectures,
  onClose,
}: {
  courseId: string;
  session: CalendarSession;
  lectures: { id: string; title: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(session.note?.title ?? "");
  const [agenda, setAgenda] = useState(session.note?.agenda ?? "");
  const [lectureId, setLectureId] = useState(session.note?.relatedLectureId ?? "");
  const [cancelled, setCancelled] = useState(session.note?.cancelled ?? false);
  const [alsoAnnounce, setAlsoAnnounce] = useState(false);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await upsertSessionNoteAction(courseId, {
        sessionDate: session.date,
        title: title.trim() || null,
        agenda: agenda.trim() || null,
        relatedLectureId: lectureId || null,
        relatedAssessmentId: session.note?.relatedAssessmentId ?? null,
        cancelled,
        existingAnnouncementId: session.note?.announcementId ?? null,
        alsoAnnounce,
      });
      if (result.error) setError(result.error);
      else {
        router.refresh();
        onClose();
      }
    });
  }

  return (
    <div className="border border-azure/40 bg-azure-soft/10 rounded-md px-4 py-3 mt-2 space-y-2">
      {error && <p className="text-xs text-danger">{error}</p>}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Session title (e.g. Lecture 03 — Software Applications)"
        className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-surface"
      />
      <textarea
        value={agenda}
        onChange={(e) => setAgenda(e.target.value)}
        placeholder="Notes or agenda for this class"
        rows={3}
        className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-surface"
      />
      {lectures.length > 0 && (
        <select value={lectureId} onChange={(e) => setLectureId(e.target.value)} className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-surface">
          <option value="">No related lecture</option>
          {lectures.map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
        </select>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={cancelled} onChange={(e) => setCancelled(e.target.checked)} />
          Cancel this session
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={alsoAnnounce} onChange={(e) => setAlsoAnnounce(e.target.checked)} />
          Also publish as announcement
        </label>
      </div>
      <div className="flex gap-2">
        <Button disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
