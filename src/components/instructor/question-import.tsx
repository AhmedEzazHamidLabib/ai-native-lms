"use client";

import { useActionState, useState, useTransition } from "react";
import { previewImportAction, commitImportAction } from "@/lib/domain/question-bank-actions";
import { initialImportPreviewState } from "@/lib/domain/question-bank-client-types";

export function QuestionImport({
  courseId,
  banks,
  lectures,
}: {
  courseId: string;
  banks: { id: string; title: string }[];
  lectures: { id: string; title: string }[];
}) {
  const [state, formAction, pending] = useActionState(previewImportAction, initialImportPreviewState);
  const [bankId, setBankId] = useState(banks[0]?.id ?? "");
  const [visibility, setVisibility] = useState<"practice" | "hidden">("hidden");
  const [lecture1Id, setLecture1Id] = useState("");
  const [lecture2Id, setLecture2Id] = useState("");
  const [committing, startCommit] = useTransition();
  const [result, setResult] = useState<{ error: string | null; imported: number } | null>(null);

  function commit() {
    if (!bankId) return;
    startCommit(async () => {
      const outcome = await commitImportAction(
        courseId,
        bankId,
        visibility,
        lecture1Id || null,
        lecture2Id || null,
        state.raw,
      );
      setResult(outcome);
    });
  }

  return (
    <details className="border border-border rounded-md px-5 py-4">
      <summary className="text-xs font-medium tracking-wide uppercase text-muted cursor-pointer">
        Import many questions (paste JSON)
      </summary>

      <div className="mt-4 space-y-3">
        <p className="text-xs text-muted">
          A JSON array of questions. MCQ: <code>{"{"}&quot;prompt&quot;, &quot;topic&quot;, &quot;lecture&quot;: &quot;L1&quot;|&quot;L2&quot;, &quot;options&quot;: [{"{"}&quot;text&quot;,&quot;correct&quot;{"}"}]{"}"}</code>.
          Written: <code>{"{"}&quot;type&quot;: &quot;written&quot;, &quot;prompt&quot;, &quot;answerGuide&quot;{"}"}</code>. Every question is
          previewed before anything is imported — nothing not present in the file is invented.
        </p>
        <form action={formAction}>
          <textarea
            name="payload"
            rows={6}
            placeholder="Paste JSON array here…"
            className="w-full border border-border rounded-md px-3 py-2 text-xs font-mono bg-surface focus-visible:border-azure"
          />
          <button
            type="submit"
            disabled={pending}
            className="mt-2 inline-flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:border-ink transition-colors duration-[180ms]"
          >
            {pending ? "Checking…" : "Preview"}
          </button>
        </form>

        {state.error && <p className="text-xs text-danger">{state.error}</p>}

        {state.validationErrors.length > 0 && (
          <div className="text-xs text-danger space-y-0.5">
            {state.validationErrors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        )}

        {state.preview && state.preview.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-success">{state.preview.length} valid question(s) ready to import.</p>
            <ul className="max-h-48 overflow-y-auto space-y-2 border border-border rounded-md p-3">
              {state.preview.slice(0, 5).map((q, i) => (
                <li key={i} className="text-xs text-text">
                  <p className="font-medium">
                    <span className="text-muted uppercase text-[10px] mr-1">{q.type === "written" ? "Written" : "MCQ"}</span>
                    {q.prompt}
                  </p>
                  <p className="text-muted">
                    {q.topic} · {q.lecture ?? "no lecture"} ·{" "}
                    {q.type === "written"
                      ? `Answer guide: ${q.answerGuide}`
                      : q.options.map((o) => (o.correct ? `[${o.text}]` : o.text)).join(", ")}
                  </p>
                </li>
              ))}
              {state.preview.length > 5 && (
                <li className="text-xs text-muted">…and {state.preview.length - 5} more</li>
              )}
            </ul>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select value={bankId} onChange={(e) => setBankId(e.target.value)} className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface">
                <option value="">— choose bank —</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as "practice" | "hidden")}
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface"
              >
                <option value="hidden">Hidden (Class Test pool)</option>
                <option value="practice">Practice</option>
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select value={lecture1Id} onChange={(e) => setLecture1Id(e.target.value)} className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface">
                <option value="">&quot;L1&quot; maps to…</option>
                {lectures.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
              <select value={lecture2Id} onChange={(e) => setLecture2Id(e.target.value)} className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface">
                <option value="">&quot;L2&quot; maps to…</option>
                {lectures.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={commit}
              disabled={!bankId || committing}
              className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-4 py-2 text-sm font-medium hover:bg-azure transition-colors duration-[180ms] disabled:opacity-40"
            >
              {committing ? "Importing…" : `Import ${state.preview.length} question(s)`}
            </button>
          </div>
        )}

        {result && (
          <p className={result.error ? "text-xs text-danger" : "text-xs text-success"}>
            {result.error ?? `Imported ${result.imported} question(s).`}
          </p>
        )}
      </div>
    </details>
  );
}
