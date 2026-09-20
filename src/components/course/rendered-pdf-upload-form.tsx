"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function RenderedPdfUploadForm({ materialId, hasRenderedPdf }: { materialId: string; hasRenderedPdf: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleChange() {
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    setStatus("uploading");
    setError(null);

    const body = new FormData();
    body.set("file", file);

    const res = await fetch(`/api/materials/${materialId}/rendered-pdf`, { method: "POST", body });

    if (!res.ok) {
      const { error: message } = await res.json().catch(() => ({ error: null }));
      setStatus("error");
      setError(message ?? "Upload failed.");
      return;
    }

    setStatus("idle");
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="border border-dashed border-border rounded-md px-5 py-4 flex items-center justify-between gap-4">
      <div>
        <p className="text-sm text-text">
          {hasRenderedPdf ? "Replace the rendered PDF" : "Attach a rendered PDF"}
        </p>
        <p className="text-xs text-muted mt-1">
          Vercel can&apos;t render PowerPoint slides server-side. Export or convert the deck to PDF yourself and
          upload it here so students see the real slides instead of extracted text only.
        </p>
        {status === "error" && (
          <p role="alert" className="text-xs text-danger mt-1">
            {error}
          </p>
        )}
      </div>
      <input ref={inputRef} type="file" accept="application/pdf" onChange={handleChange} className="hidden" id="rendered-pdf-input" />
      <Button type="button" variant="secondary" disabled={status === "uploading"} onClick={() => inputRef.current?.click()}>
        {status === "uploading" ? "Uploading…" : "Choose PDF"}
      </Button>
    </div>
  );
}
