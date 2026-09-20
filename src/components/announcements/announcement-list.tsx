import { FormattedText } from "@/components/ui/formatted-text";
import { cn } from "@/lib/utils/cn";
import type { AnnouncementRow } from "@/lib/domain/announcements";

export function AnnouncementList({ announcements }: { announcements: AnnouncementRow[] }) {
  return (
    <ul className="space-y-4">
      {announcements.map((a) => (
        <li key={a.id} className={cn("border rounded-md px-5 py-4", a.pinned ? "border-azure/40 bg-azure-soft/20" : "border-border")}>
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h3 className="font-display text-lg text-ink">
              {a.pinned && <span className="text-xs font-sans font-medium uppercase tracking-wide text-azure mr-2 align-middle">Important</span>}
              {a.title}
            </h3>
            <time className="text-xs text-muted shrink-0">
              {new Date(a.publishedAt ?? a.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </time>
          </div>
          <FormattedText text={a.body} className="text-sm text-text" />
        </li>
      ))}
    </ul>
  );
}
