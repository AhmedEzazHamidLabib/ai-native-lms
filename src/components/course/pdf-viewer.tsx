/**
 * Plain PDF material — the source file IS the rendered artifact, no
 * conversion needed (unlike PPTX). No slide-index sidebar or
 * per-slide Tutor entry point, since a plain PDF has no structured
 * per-page text extracted (see docs — PDF ingestion note).
 */
export function PdfViewer({ pdfUrl, title }: { pdfUrl: string; title: string }) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <iframe src={pdfUrl} title={title} className="w-full h-[75vh] bg-white" />
    </div>
  );
}
