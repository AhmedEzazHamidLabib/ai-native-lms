import type { ReactNode } from "react";

export function CourseCard({
  code,
  title,
  term,
  action,
}: {
  code: string;
  title: string;
  term: string;
  action: ReactNode;
}) {
  return (
    <li className="border border-border rounded-lg px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium tracking-wide uppercase text-azure mb-1">
          {code}
        </p>
        <p className="font-display text-lg text-ink truncate">{title}</p>
        <p className="text-xs text-muted mt-0.5">{term}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </li>
  );
}
