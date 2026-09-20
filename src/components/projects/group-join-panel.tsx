"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinGroup, leaveGroup, type JoinableGroup } from "@/lib/projects/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export function GroupJoinPanel({
  courseId,
  groups,
  locked,
}: {
  courseId: string;
  groups: JoinableGroup[];
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function act(fn: () => Promise<void>) {
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
    <section className="mb-10">
      <h2 className="text-xs font-medium tracking-wide uppercase text-muted mb-3">Join a group</h2>
      {locked && (
        <p className="text-xs text-muted mb-3">
          Groups are currently locked — contact your instructor if you need to change groups.
        </p>
      )}
      {error && <p className="text-xs text-danger mb-3">{error}</p>}
      <ul className="divide-y divide-border border-t border-b border-border">
        {groups.map((g) => {
          const full = g.capacity !== null && g.memberCount >= g.capacity && !g.isMine;
          return (
            <li key={g.groupId} className={cn("flex items-center justify-between gap-3 px-1 py-3", g.isMine && "bg-azure-soft/20")}>
              <div>
                <p className="text-sm font-medium text-text">
                  {g.name} {g.isMine && <span className="text-xs text-azure ml-1">(your group)</span>}
                </p>
                <p className="text-xs text-muted mt-0.5">
                  {g.memberCount}
                  {g.capacity !== null ? `/${g.capacity}` : ""} member{g.memberCount === 1 ? "" : "s"}
                  {full ? " · Full" : ""}
                </p>
              </div>
              {g.isMine ? (
                <Button variant="secondary" disabled={pending || locked} onClick={() => act(() => leaveGroup(courseId, g.groupId))}>
                  Leave
                </Button>
              ) : (
                <Button variant="secondary" disabled={pending || locked || full} onClick={() => act(() => joinGroup(courseId, g.groupId))}>
                  Join
                </Button>
              )}
            </li>
          );
        })}
        {groups.length === 0 && <li className="px-1 py-3 text-sm text-muted">No groups have been set up yet.</li>}
      </ul>
    </section>
  );
}
