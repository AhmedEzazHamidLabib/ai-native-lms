"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reprocessLearningObjective } from "@/lib/domain/course-intelligence-actions";
import type { IntelligenceStatusRow } from "@/lib/domain/course-intelligence";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

const STATUS_STYLE: Record<IntelligenceStatusRow["status"], string> = {
  ready: "bg-success-soft text-success",
  stale: "bg-danger-soft text-danger",
  missing: "bg-black/5 text-muted",
  generating: "bg-azure-soft text-azure",
  failed: "bg-danger-soft text-danger",
};

export function IntelligenceStatusList({ courseId, rows }: { courseId: string; rows: IntelligenceStatusRow[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  function rebuild(objectiveId: string) {
    setPendingId(objectiveId);
    setErrors((e) => ({ ...e, [objectiveId]: "" }));
    startTransition(async () => {
      const { error } = await reprocessLearningObjective(courseId, objectiveId);
      setPendingId(null);
      if (error) setErrors((e) => ({ ...e, [objectiveId]: error }));
      router.refresh();
    });
  }

  return (
    <ul className="divide-y divide-border border-t border-b border-border">
      {rows.map((r) => (
        <li key={r.learningObjectiveId} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={cn("text-[10px] font-medium tracking-wide uppercase px-1.5 py-0.5 rounded", STATUS_STYLE[r.status])}>
                {r.status}
              </span>
              <p className="text-sm text-text truncate">{r.title}</p>
            </div>
            <p className="text-xs text-muted">
              {r.chunkCount} material chunk{r.chunkCount === 1 ? "" : "s"}
              {r.generatedAt ? ` · generated ${new Date(r.generatedAt).toLocaleDateString()}` : ""}
              {r.model ? ` · ${r.model}` : ""}
            </p>
            {r.error && <p className="text-xs text-danger mt-1">{r.error}</p>}
            {errors[r.learningObjectiveId] && <p className="text-xs text-danger mt-1">{errors[r.learningObjectiveId]}</p>}
          </div>
          <Button
            variant="secondary"
            disabled={pendingId === r.learningObjectiveId || r.chunkCount === 0}
            onClick={() => rebuild(r.learningObjectiveId)}
            title={r.chunkCount === 0 ? "No source material chunked yet for this objective" : undefined}
          >
            {pendingId === r.learningObjectiveId ? "Rebuilding…" : r.status === "missing" ? "Build" : "Rebuild"}
          </Button>
        </li>
      ))}
      {rows.length === 0 && <li className="px-1 py-4 text-sm text-muted">No learning objectives configured for this course yet.</li>}
    </ul>
  );
}
