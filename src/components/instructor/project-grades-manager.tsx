"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setGroupGradeAction } from "@/lib/domain/project-instructor-actions";
import type { ProjectInstructorOverview } from "@/lib/domain/project-instructor";
import { Button } from "@/components/ui/button";

export function ProjectGradesManager({
  courseId,
  projectId,
  groups,
  pointsPossible,
}: {
  courseId: string;
  projectId: string;
  groups: ProjectInstructorOverview["groups"];
  pointsPossible: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (groups.length === 0) {
    return <p className="text-sm text-muted">No groups to grade yet — create groups first.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-danger border border-danger/40 bg-danger-soft rounded-md px-3 py-2">{error}</p>}
      <ul className="divide-y divide-border border-t border-b border-border">
        {groups.map((g) => (
          <GradeRow
            key={g.groupId}
            group={g}
            defaultMax={pointsPossible ?? 100}
            pending={pending}
            onSave={(score, maxScore, feedback) =>
              startTransition(async () => {
                setError(null);
                try {
                  await setGroupGradeAction(courseId, projectId, g.groupId, score, maxScore, feedback || null);
                  router.refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not save grade.");
                }
              })
            }
          />
        ))}
      </ul>
    </div>
  );
}

function GradeRow({
  group,
  defaultMax,
  pending,
  onSave,
}: {
  group: ProjectInstructorOverview["groups"][number];
  defaultMax: number;
  pending: boolean;
  onSave: (score: number, maxScore: number, feedback: string) => void;
}) {
  const [score, setScore] = useState(group.grade ? String(group.grade.score) : "");
  const [maxScore, setMaxScore] = useState(group.grade ? String(group.grade.maxScore) : String(defaultMax));
  const [feedback, setFeedback] = useState(group.grade?.feedback ?? "");

  return (
    <li className="px-1 py-4">
      <p className="text-sm font-medium text-text mb-1">
        {group.name} <span className="text-xs text-muted font-normal">({group.members.map((m) => m.fullName).join(", ") || "no members"})</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          value={score}
          onChange={(e) => setScore(e.target.value)}
          placeholder="Score"
          className="w-24 border border-border rounded-md px-2 py-1.5 text-sm bg-surface"
        />
        <span className="text-sm text-muted">/</span>
        <input
          type="number"
          value={maxScore}
          onChange={(e) => setMaxScore(e.target.value)}
          placeholder="Max"
          className="w-24 border border-border rounded-md px-2 py-1.5 text-sm bg-surface"
        />
        <input
          type="text"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Feedback (optional)"
          className="flex-1 min-w-[160px] border border-border rounded-md px-2 py-1.5 text-sm bg-surface"
        />
        <Button
          variant="secondary"
          disabled={pending || score === "" || maxScore === ""}
          onClick={() => onSave(Number(score), Number(maxScore), feedback)}
        >
          Save
        </Button>
      </div>
    </li>
  );
}
