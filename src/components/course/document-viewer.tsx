/**
 * Structured DOCX rendering — HTML produced server-side by mammoth
 * from the instructor's own uploaded file (see src/lib/ingestion/docx.ts).
 * Safe to render directly: this HTML never originates from a student
 * or from free-typed user input, only from a fixed, script-stripping
 * converter over an instructor-authorized upload. Styled here directly
 * rather than pulling in a typography plugin, to stay consistent with
 * the rest of the app's design tokens.
 */
export function DocumentViewer({ html }: { html: string }) {
  return (
    <div
      className="border border-border rounded-md px-6 py-5 bg-surface text-sm text-text leading-relaxed
        [&_h1]:font-display [&_h1]:text-xl [&_h1]:text-ink [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:first:mt-0
        [&_h2]:font-display [&_h2]:text-lg [&_h2]:text-ink [&_h2]:mt-5 [&_h2]:mb-2
        [&_h3]:font-medium [&_h3]:text-text [&_h3]:mt-4 [&_h3]:mb-2
        [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3 [&_li]:mb-1
        [&_strong]:font-semibold [&_em]:italic [&_a]:text-azure [&_a]:underline
        [&_table]:border-collapse [&_table]:mb-3 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1
        [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-black/[0.03]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
