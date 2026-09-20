import mammoth from "mammoth";

/**
 * DOCX -> structured HTML, via mammoth (a well-established converter
 * that maps Word semantic elements — headings, paragraphs, lists,
 * tables, bold/italic — onto plain HTML tags; it never carries over
 * scripts, styles, or macros, since it only reads the semantic content
 * model, not raw markup). Output is fed straight to the student
 * renderer with `dangerouslySetInnerHTML` — safe specifically because
 * this HTML is server-generated from a fixed converter over an
 * instructor's own uploaded file, never from user-typed free text.
 *
 * No OCR, no LLM — deterministic, same posture as PPTX parsing.
 */
export async function parseDocx(buffer: Buffer): Promise<{ html: string; plainText: string }> {
  const [htmlResult, textResult] = await Promise.all([
    mammoth.convertToHtml({ buffer }),
    mammoth.extractRawText({ buffer }),
  ]);
  return { html: htmlResult.value, plainText: textResult.value };
}
