import { cn } from "@/lib/utils/cn";

/**
 * The one shared correct/incorrect visual language for Practice and
 * assessment review (Part 9/18) — color is never the only signal,
 * every state pairs a ✓/✕ glyph with text, and colors come from the
 * shared --color-success/--color-danger tokens (globals.css), never
 * ad hoc Tailwind reds/greens, so this stays consistent everywhere it
 * appears.
 */
export function optionFeedbackClass(opts: { isCorrectOption: boolean | undefined; isSelected: boolean; isRevealed: boolean }) {
  const isCorrectOption = Boolean(opts.isCorrectOption);
  const { isSelected, isRevealed } = opts;
  if (!isRevealed) {
    return isSelected ? "border-azure bg-azure-soft/30" : "border-border hover:border-ink";
  }
  if (isCorrectOption) {
    return "border-success/50 bg-success-soft text-text";
  }
  if (isSelected && !isCorrectOption) {
    return "border-danger/50 bg-danger-soft text-text";
  }
  return "border-border text-muted";
}

export function OptionBadge({
  isCorrectOption,
  isSelected,
  isRevealed,
}: {
  isCorrectOption: boolean | undefined;
  isSelected: boolean;
  isRevealed: boolean;
}) {
  if (!isRevealed) return null;
  if (isCorrectOption) {
    return (
      <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-success">
        ✓ {isSelected ? "Correct" : "Correct answer"}
      </span>
    );
  }
  if (isSelected) {
    return (
      <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-danger">✕ Your answer</span>
    );
  }
  return null;
}

export function ResultBanner({ correct }: { correct: boolean }) {
  return (
    <p
      className={cn(
        "text-sm font-medium inline-flex items-center gap-1.5",
        correct ? "text-success" : "text-danger",
      )}
    >
      <span aria-hidden>{correct ? "✓" : "✕"}</span>
      {correct ? "Correct" : "Not quite"}
    </p>
  );
}
