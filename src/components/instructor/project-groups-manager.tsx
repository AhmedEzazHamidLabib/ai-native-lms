"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setGroupModeAction,
  setGroupsLockedAction,
  createGroupAction,
  deleteGroupAction,
  assignStudentAction,
  removeStudentAction,
} from "@/lib/domain/project-instructor-actions";
import type { ProjectInstructorOverview } from "@/lib/domain/project-instructor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export function ProjectGroupsManager({
  courseId,
  projectId,
  initialOverview,
  roster,
}: {
  courseId: string;
  projectId: string;
  initialOverview: ProjectInstructorOverview;
  roster: { userId: string; email: string; fullName: string | null }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupCapacity, setNewGroupCapacity] = useState("");

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

  const overview = initialOverview;
  const nameByUserId = new Map(roster.map((r) => [r.userId, r.fullName || r.email]));

  return (
    <div className="space-y-8">
      {error && <p className="text-xs text-danger border border-danger/40 bg-danger-soft rounded-md px-3 py-2">{error}</p>}

      <section className="border border-border rounded-md px-5 py-4 space-y-3">
        <p className="text-xs font-medium tracking-wide uppercase text-muted">Group configuration</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-text">
            Mode:
            <select
              value={overview.groupMode}
              disabled={pending}
              onChange={(e) =>
                run(() => setGroupModeAction(courseId, projectId, e.target.value as "instructor_assigned" | "self_enrollment"))
              }
              className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface"
            >
              <option value="instructor_assigned">Instructor-assigned</option>
              <option value="self_enrollment">Student self-enrollment</option>
            </select>
          </label>
          <Button
            variant={overview.groupsLocked ? "primary" : "secondary"}
            disabled={pending}
            onClick={() => run(() => setGroupsLockedAction(courseId, projectId, !overview.groupsLocked))}
          >
            {overview.groupsLocked ? "Unlock groups" : "Lock groups"}
          </Button>
        </div>
        <p className="text-xs text-muted">
          {overview.groupMode === "self_enrollment"
            ? "Students can join/switch groups themselves until locked. You can always assign or move students regardless."
            : "Students see their group but cannot join or switch on their own — use Assign below."}
        </p>
      </section>

      <section className="border border-border rounded-md px-5 py-4 space-y-3">
        <p className="text-xs font-medium tracking-wide uppercase text-muted">New group</p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Group name"
            className="flex-1 min-w-[160px] border border-border rounded-md px-3 py-1.5 text-sm bg-surface"
          />
          <input
            type="number"
            min={1}
            value={newGroupCapacity}
            onChange={(e) => setNewGroupCapacity(e.target.value)}
            placeholder="Capacity (optional)"
            className="w-40 border border-border rounded-md px-3 py-1.5 text-sm bg-surface"
          />
          <Button
            disabled={pending || !newGroupName.trim()}
            onClick={() =>
              run(async () => {
                await createGroupAction(courseId, projectId, newGroupName.trim(), newGroupCapacity ? Number(newGroupCapacity) : null);
                setNewGroupName("");
                setNewGroupCapacity("");
              })
            }
          >
            Create group
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        {overview.groups.map((g) => (
          <GroupCard key={g.groupId} group={g} courseId={courseId} roster={roster} pending={pending} run={run} />
        ))}
        {overview.groups.length === 0 && <p className="text-sm text-muted">No groups yet — create one above.</p>}
      </section>

      {overview.unassignedStudents.length > 0 && (
        <section className="border border-border rounded-md px-5 py-4">
          <p className="text-xs font-medium tracking-wide uppercase text-muted mb-2">
            Unassigned students ({overview.unassignedStudents.length})
          </p>
          <p className="text-sm text-text">
            {overview.unassignedStudents.map((s) => nameByUserId.get(s.userId) ?? s.fullName).join(", ")}
          </p>
        </section>
      )}
    </div>
  );
}

function GroupCard({
  group,
  courseId,
  roster,
  pending,
  run,
}: {
  group: ProjectInstructorOverview["groups"][number];
  courseId: string;
  roster: { userId: string; email: string; fullName: string | null }[];
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
}) {
  const [assignId, setAssignId] = useState("");
  const memberIds = new Set(group.members.map((m) => m.userId));
  const candidates = roster.filter((r) => !memberIds.has(r.userId));
  const atCapacity = group.capacity !== null && group.members.length >= group.capacity;

  return (
    <div className="border border-border rounded-md px-5 py-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-sm font-medium text-text">
          {group.name}{" "}
          <span className="text-xs text-muted font-normal">
            ({group.members.length}
            {group.capacity !== null ? `/${group.capacity}` : ""} member{group.members.length === 1 ? "" : "s"})
          </span>
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => deleteGroupAction(courseId, group.groupId))}
          className="text-xs text-danger disabled:opacity-40"
        >
          Delete group
        </button>
      </div>

      <ul className="space-y-1 mb-3">
        {group.members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between text-sm text-text">
            <span>{m.fullName}</span>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => removeStudentAction(courseId, group.groupId, m.userId))}
              className="text-xs text-muted hover:text-danger disabled:opacity-40"
            >
              Remove
            </button>
          </li>
        ))}
        {group.members.length === 0 && <li className="text-xs text-muted">No members yet.</li>}
      </ul>

      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={assignId}
          onChange={(e) => setAssignId(e.target.value)}
          className={cn("flex-1 min-w-[160px] border border-border rounded-md px-2 py-1.5 text-xs bg-surface", atCapacity && "opacity-50")}
          disabled={atCapacity}
        >
          <option value="">{atCapacity ? "Group is at capacity" : "Assign or move a student…"}</option>
          {candidates.map((c) => (
            <option key={c.userId} value={c.userId}>
              {c.fullName || c.email}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          disabled={pending || !assignId || atCapacity}
          onClick={() =>
            run(async () => {
              await assignStudentAction(courseId, group.groupId, assignId);
              setAssignId("");
            })
          }
        >
          Add
        </Button>
      </div>
    </div>
  );
}
