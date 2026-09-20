"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createDeliverableAction,
  updateDeliverableAction,
  deleteDeliverableAction,
} from "@/lib/domain/project-instructor-actions";
import type { DeliverableRow } from "@/lib/domain/project-instructor";
import { Button } from "@/components/ui/button";

interface DraftDeliverable {
  title: string;
  description: string;
  dueAt: string;
  submissionEnabled: boolean;
  allowedType: string;
  published: boolean;
}

const EMPTY_DRAFT: DraftDeliverable = {
  title: "",
  description: "",
  dueAt: "",
  submissionEnabled: true,
  allowedType: "",
  published: false,
};

export function ProjectDeliverablesManager({
  courseId,
  projectId,
  deliverables,
}: {
  courseId: string;
  projectId: string;
  deliverables: DeliverableRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftDeliverable>(EMPTY_DRAFT);

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-xs text-danger border border-danger/40 bg-danger-soft rounded-md px-3 py-2">{error}</p>}

      <details className="border border-border rounded-md px-5 py-4">
        <summary className="text-xs font-medium tracking-wide uppercase text-muted cursor-pointer">New deliverable</summary>
        <div className="mt-4 space-y-3">
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Title"
            className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-surface"
          />
          <textarea
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            placeholder="Instructions for students"
            rows={2}
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-surface"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="datetime-local"
              value={draft.dueAt}
              onChange={(e) => setDraft((d) => ({ ...d, dueAt: e.target.value }))}
              className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface"
            />
            <input
              type="text"
              value={draft.allowedType}
              onChange={(e) => setDraft((d) => ({ ...d, allowedType: e.target.value }))}
              placeholder="Allowed file type (e.g. PDF)"
              className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface"
            />
            <label className="flex items-center gap-2 text-sm text-text px-2">
              <input
                type="checkbox"
                checked={draft.submissionEnabled}
                onChange={(e) => setDraft((d) => ({ ...d, submissionEnabled: e.target.checked }))}
              />
              Submissions open
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={draft.published}
              onChange={(e) => setDraft((d) => ({ ...d, published: e.target.checked }))}
            />
            Published (visible to students)
          </label>
          <Button
            disabled={pending || !draft.title.trim()}
            onClick={() =>
              run(async () => {
                await createDeliverableAction(courseId, projectId, {
                  title: draft.title.trim(),
                  description: draft.description.trim(),
                  dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
                  submissionEnabled: draft.submissionEnabled,
                  allowedType: draft.allowedType.trim() || null,
                  published: draft.published,
                });
                setDraft(EMPTY_DRAFT);
              })
            }
          >
            Create deliverable
          </Button>
        </div>
      </details>

      <ul className="space-y-3">
        {deliverables.map((d) => (
          <DeliverableRowItem key={d.id} courseId={courseId} deliverable={d} pending={pending} run={run} />
        ))}
        {deliverables.length === 0 && <p className="text-sm text-muted">No deliverables yet — add one above.</p>}
      </ul>
    </div>
  );
}

function DeliverableRowItem({
  courseId,
  deliverable,
  pending,
  run,
}: {
  courseId: string;
  deliverable: DeliverableRow;
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
}) {
  return (
    <li className="border border-border rounded-md px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{deliverable.title}</p>
          {deliverable.description && <p className="text-xs text-muted mt-1">{deliverable.description}</p>}
          <p className="text-xs text-muted mt-1">
            {deliverable.dueAt ? `Due ${new Date(deliverable.dueAt).toLocaleString()}` : "No due date"}
            {deliverable.allowedType ? ` · ${deliverable.allowedType}` : ""}
            {!deliverable.submissionEnabled ? " · Submissions closed" : ""}
          </p>
        </div>
        <span className={`shrink-0 text-[11px] font-medium tracking-wide uppercase ${deliverable.published ? "text-azure" : "text-muted"}`}>
          {deliverable.published ? "Published" : "Draft"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(() =>
              updateDeliverableAction(courseId, deliverable.id, {
                title: deliverable.title,
                description: deliverable.description,
                dueAt: deliverable.dueAt,
                submissionEnabled: deliverable.submissionEnabled,
                allowedType: deliverable.allowedType,
                published: !deliverable.published,
              }),
            )
          }
        >
          {deliverable.published ? "Unpublish" : "Publish"}
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(() =>
              updateDeliverableAction(courseId, deliverable.id, {
                title: deliverable.title,
                description: deliverable.description,
                dueAt: deliverable.dueAt,
                submissionEnabled: !deliverable.submissionEnabled,
                allowedType: deliverable.allowedType,
                published: deliverable.published,
              }),
            )
          }
        >
          {deliverable.submissionEnabled ? "Close submissions" : "Open submissions"}
        </Button>
        <Button variant="destructive" disabled={pending} onClick={() => run(() => deleteDeliverableAction(courseId, deliverable.id))}>
          Delete
        </Button>
      </div>
    </li>
  );
}
