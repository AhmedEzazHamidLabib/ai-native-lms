"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createAnnouncementAction,
  updateAnnouncementAction,
  setAnnouncementPublished,
  deleteAnnouncementAction,
} from "@/lib/domain/announcements-actions";
import type { AnnouncementRow } from "@/lib/domain/announcements";
import { Button } from "@/components/ui/button";
import { FormattedText } from "@/components/ui/formatted-text";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";

interface Draft {
  title: string;
  body: string;
  pinned: boolean;
  expiresAt: string;
}

const EMPTY_DRAFT: Draft = { title: "", body: "", pinned: false, expiresAt: "" };

export function AnnouncementManager({ courseId, announcements }: { courseId: string; announcements: AnnouncementRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);

  function run(fn: () => Promise<{ error: string | null } | void>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result && result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      {error && <p className="text-xs text-danger border border-danger/40 bg-danger-soft rounded-md px-3 py-2">{error}</p>}

      {!creating ? (
        <Button onClick={() => setCreating(true)}>New announcement</Button>
      ) : (
        <div className="border border-border rounded-md px-5 py-4 space-y-3">
          <p className="text-xs font-medium tracking-wide uppercase text-muted">New announcement</p>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Title"
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface"
          />
          <textarea
            value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
            placeholder="What do you want students to know?"
            rows={5}
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface"
          />
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft((d) => ({ ...d, pinned: e.target.checked }))} />
              Pin as important
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              Expires
              <input
                type="datetime-local"
                value={draft.expiresAt}
                onChange={(e) => setDraft((d) => ({ ...d, expiresAt: e.target.value }))}
                className="border border-border rounded-md px-2 py-1 text-xs bg-surface"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending || !draft.title.trim() || !draft.body.trim()}
              onClick={() =>
                run(async () => {
                  const result = await createAnnouncementAction(courseId, {
                    title: draft.title,
                    body: draft.body,
                    pinned: draft.pinned,
                    expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
                    publishNow: true,
                  });
                  if (!result.error) {
                    setDraft(EMPTY_DRAFT);
                    setCreating(false);
                  }
                  return result;
                })
              }
            >
              Publish
            </Button>
            <Button
              variant="secondary"
              disabled={pending || !draft.title.trim() || !draft.body.trim()}
              onClick={() =>
                run(async () => {
                  const result = await createAnnouncementAction(courseId, {
                    title: draft.title,
                    body: draft.body,
                    pinned: draft.pinned,
                    expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
                    publishNow: false,
                  });
                  if (!result.error) {
                    setDraft(EMPTY_DRAFT);
                    setCreating(false);
                  }
                  return result;
                })
              }
            >
              Save as draft
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {announcements.length === 0 ? (
        <EmptyState title="No announcements yet" description="Create the first announcement so students see it on their course home." />
      ) : (
        <ul className="space-y-3">
          {announcements.map((a) => (
            <AnnouncementCard key={a.id} courseId={courseId} announcement={a} pending={pending} run={run} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AnnouncementCard({
  courseId,
  announcement,
  pending,
  run,
}: {
  courseId: string;
  announcement: AnnouncementRow;
  pending: boolean;
  run: (fn: () => Promise<{ error: string | null } | void>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    title: announcement.title,
    body: announcement.body,
    pinned: announcement.pinned,
    expiresAt: announcement.expiresAt ? announcement.expiresAt.slice(0, 16) : "",
  });

  const expired = announcement.expiresAt ? new Date(announcement.expiresAt) <= new Date() : false;
  const published = announcement.publishedAt !== null;

  if (editing) {
    return (
      <li className="border border-border rounded-md px-5 py-4 space-y-3">
        <input
          type="text"
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface"
        />
        <textarea
          value={draft.body}
          onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          rows={5}
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface"
        />
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft((d) => ({ ...d, pinned: e.target.checked }))} />
            Pin as important
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            Expires
            <input
              type="datetime-local"
              value={draft.expiresAt}
              onChange={(e) => setDraft((d) => ({ ...d, expiresAt: e.target.value }))}
              className="border border-border rounded-md px-2 py-1 text-xs bg-surface"
            />
          </label>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={pending}
            onClick={() =>
              run(async () => {
                const result = await updateAnnouncementAction(courseId, announcement.id, {
                  title: draft.title,
                  body: draft.body,
                  pinned: draft.pinned,
                  expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
                });
                if (!result.error) setEditing(false);
                return result;
              })
            }
          >
            Save
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className={cn("border border-border rounded-md px-5 py-4", !published && "opacity-60")}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {announcement.pinned && <span className="text-[10px] font-medium uppercase tracking-wide text-azure shrink-0">Pinned</span>}
          <p className="text-sm font-medium text-text truncate">{announcement.title}</p>
        </div>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted shrink-0">
          {!published ? "Draft" : expired ? "Expired" : "Published"}
        </span>
      </div>
      <FormattedText text={announcement.body} className="text-sm text-text mb-3" />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={pending} onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => run(() => setAnnouncementPublished(courseId, announcement.id, !published))}
        >
          {published ? "Unpublish" : "Publish"}
        </Button>
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() => {
            if (confirm("Delete this announcement? This cannot be undone.")) {
              run(() => deleteAnnouncementAction(courseId, announcement.id));
            }
          }}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}
