import { Fragment } from "react";

/**
 * Renders plain-text announcement/body content with a small set of
 * safe, fully-controlled formatting rules — never HTML input, never
 * `dangerouslySetInnerHTML`. Every character the author typed is
 * treated as literal text; React escapes it automatically. This is the
 * entire "sanitization" story: there is no HTML parser in the loop at
 * all, so there is nothing to sanitize.
 *
 * Supported: blank-line-separated paragraphs, single newlines as line
 * breaks, "- " prefixed lines grouped into a bullet list, and bold
 * (double asterisk) / italic (single asterisk) inline spans.
 */
export function FormattedText({ text, className }: { text: string; className?: string }) {
  const blocks = text.trim().split(/\n{2,}/);

  return (
    <div className={className}>
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim().length > 0);
        const isBulletBlock = lines.length > 0 && lines.every((l) => l.trim().startsWith("- "));

        if (isBulletBlock) {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1 mb-3 last:mb-0">
              {lines.map((l, j) => (
                <li key={j}>{renderInline(l.trim().slice(2))}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={i} className="mb-3 last:mb-0 whitespace-pre-line">
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
