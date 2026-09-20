"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function MaterialUploadForm({
  materialId,
  nextVersionNumber,
}: {
  materialId: string;
  nextVersionNumber: number;
}) {
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

    const res = await fetch(`/api/materials/${materialId}/versions`, {
      method: "POST",
      body,
    });

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
    <div className="border border-dashed border-border rounded-md px-5 py-6 flex items-center justify-between gap-4">
      <div>
        <p className="text-sm text-text">
          Upload a PPTX, PDF, or DOCX file from your computer.
        </p>
        <p className="text-xs text-muted mt-1">
          The current source is never overwritten — this creates Version{" "}
          {nextVersionNumber}.
        </p>
        {status === "error" && (
          <p role="alert" className="text-xs text-danger mt-1">
            {error}
          </p>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pptx,.pdf,.docx"
        onChange={handleChange}
        className="hidden"
        id="material-upload-input"
      />
      <Button
        type="button"
        disabled={status === "uploading"}
        onClick={() => inputRef.current?.click()}
      >
        {status === "uploading" ? "Uploading…" : "Upload from computer"}
      </Button>
    </div>
  );
}
