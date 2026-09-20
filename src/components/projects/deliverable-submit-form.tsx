"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function DeliverableSubmitForm({ deliverableId }: { deliverableId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const formData = new FormData(e.currentTarget);
      const res = await fetch(`/api/projects/${deliverableId}/submissions`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not submit.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network problem. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-2 mt-2">
      <input
        ref={inputRef}
        type="file"
        name="file"
        required
        className="text-xs text-muted file:mr-2 file:rounded-md file:border file:border-border file:bg-surface file:px-2 file:py-1 file:text-xs"
      />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-3 py-1.5 text-xs font-medium hover:bg-azure transition-colors duration-[180ms] disabled:opacity-40 shrink-0 w-full sm:w-auto"
      >
        {pending ? "Uploading…" : "Submit"}
      </button>
      {error && <p className="text-xs text-danger sm:ml-2 self-center">{error}</p>}
    </form>
  );
}
