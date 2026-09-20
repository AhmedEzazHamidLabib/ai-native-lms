"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Contextual "⋯" menu for a Unit/Lecture/Material row — rename,
 * move up/down, archive/restore, delete-if-unused. Keeps the row itself
 * to one primary link/action; everything else lives behind this menu
 * instead of a wall of permanent buttons (Part 1 "Content UX").
 */
export function ContentItemMenu({
  currentTitle,
  onRename,
  onMoveUp,
  onMoveDown,
  isArchived,
  onToggleArchive,
  onDelete,
  deleteDisabledHint,
  deleteRedirectTo,
}: {
  currentTitle: string;
  /** Bound server action taking a FormData with a "title" field — e.g. `renameUnitAction.bind(null, courseId, unitId)`. */
  onRename: (formData: FormData) => Promise<void>;
  onMoveUp?: () => Promise<void>;
  onMoveDown?: () => Promise<void>;
  isArchived: boolean;
  onToggleArchive: () => Promise<void>;
  onDelete: () => Promise<{ error: string | null }>;
  deleteDisabledHint?: string;
  /**
   * Where to navigate after a successful delete, when this menu lives
   * on the deleted item's OWN detail page (e.g. a Material page
   * deleting that same material) — `router.refresh()` there would
   * re-run the current route's data fetch against an object that no
   * longer exists and 404. Omit this when the menu lives on a list/
   * parent page instead (deleting a row there just needs a refresh).
   */
  deleteRedirectTo?: string;
}) {
  const router = useRouter();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(currentTitle);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (detailsRef.current) detailsRef.current.open = false;
  }

  function run(fn: () => Promise<void | { error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      close();
      router.refresh();
    });
  }

  function runDelete() {
    setError(null);
    startTransition(async () => {
      const result = await onDelete();
      if (result.error) {
        setError(result.error);
        return;
      }
      close();
      // Never refresh/revalidate the URL of an object that was just
      // deleted — navigate to the parent instead of re-fetching a 404.
      if (deleteRedirectTo) {
        router.push(deleteRedirectTo);
      } else {
        router.refresh();
      }
    });
  }

  if (renaming) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData();
          fd.set("title", title);
          run(async () => {
            await onRename(fd);
          });
          setRenaming(false);
        }}
        className="flex items-center gap-1.5"
      >
        <input
          autoFocus
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="border border-azure rounded-md px-2 py-1 text-sm bg-surface"
        />
        <button type="submit" className="text-xs text-azure">
          Save
        </button>
        <button type="button" onClick={() => setRenaming(false)} className="text-xs text-muted">
          Cancel
        </button>
      </form>
    );
  }

  return (
    <details ref={detailsRef} className="relative shrink-0">
      <summary className="list-none cursor-pointer text-muted hover:text-text px-1.5 py-0.5 rounded select-none" aria-label="More actions">
        ⋯
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-48 border border-border rounded-md bg-warm-paper shadow-md py-1">
        {error && <p className="px-3 py-1 text-xs text-danger">{error}</p>}
        <button
          type="button"
          onClick={() => setRenaming(true)}
          className="w-full text-left px-3 py-1.5 text-sm text-text hover:bg-black/[0.03]"
        >
          Rename
        </button>
        {onMoveUp && (
          <button type="button" disabled={pending} onClick={() => run(onMoveUp)} className="w-full text-left px-3 py-1.5 text-sm text-text hover:bg-black/[0.03]">
            Move up
          </button>
        )}
        {onMoveDown && (
          <button type="button" disabled={pending} onClick={() => run(onMoveDown)} className="w-full text-left px-3 py-1.5 text-sm text-text hover:bg-black/[0.03]">
            Move down
          </button>
        )}
        <button type="button" disabled={pending} onClick={() => run(onToggleArchive)} className="w-full text-left px-3 py-1.5 text-sm text-text hover:bg-black/[0.03]">
          {isArchived ? "Restore" : "Archive"}
        </button>
        <button
          type="button"
          disabled={pending}
          title={deleteDisabledHint}
          onClick={() => {
            if (confirm("Permanently delete this? This cannot be undone.")) runDelete();
          }}
          className="w-full text-left px-3 py-1.5 text-sm text-danger hover:bg-danger-soft"
        >
          Delete
        </button>
      </div>
    </details>
  );
}
