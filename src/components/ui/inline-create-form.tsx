import type { ReactNode } from "react";

/**
 * A single-field "create X" form bound to a server action. Plain HTML
 * form semantics — works with JS disabled, no client component needed.
 */
export function InlineCreateForm({
  action,
  placeholder,
  buttonLabel,
  extraFields,
}: {
  action: (formData: FormData) => void | Promise<void>;
  placeholder: string;
  buttonLabel: string;
  extraFields?: ReactNode;
}) {
  return (
    <form action={action} className="flex items-center gap-2">
      {extraFields}
      <input
        type="text"
        name="title"
        required
        placeholder={placeholder}
        className="min-w-0 flex-1 border border-border rounded-md px-3 py-1.5 text-sm bg-surface focus-visible:border-azure"
      />
      <button
        type="submit"
        className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:border-ink transition-colors duration-[180ms]"
      >
        {buttonLabel}
      </button>
    </form>
  );
}
