import type { MaterialDisplayStatus } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";

const STYLES: Record<MaterialDisplayStatus, string> = {
  DRAFT: "text-muted border-border",
  UPLOADING: "text-azure border-azure-soft bg-azure-soft/60",
  PROCESSING: "text-azure border-azure-soft bg-azure-soft/60",
  READY: "text-text border-border",
  PUBLISHED: "text-azure border-azure/30 bg-azure-soft/40",
  FAILED: "text-danger border-danger/40 bg-danger-soft",
};

export function StatusPill({
  status,
  className,
}: {
  status: MaterialDisplayStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide uppercase",
        STYLES[status],
        className,
      )}
    >
      {(status === "PROCESSING" || status === "UPLOADING") && (
        <span
          className="size-1.5 rounded-full bg-current animate-pulse"
          aria-hidden
        />
      )}
      {status}
    </span>
  );
}
