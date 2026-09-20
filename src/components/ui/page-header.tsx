import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-6 pb-6 mb-8 border-b border-border">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-medium tracking-wide uppercase text-azure mb-1.5">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-2xl sm:text-3xl text-ink tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-2 text-sm text-muted max-w-xl">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
