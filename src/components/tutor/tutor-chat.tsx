"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { sendTutorMessage } from "@/lib/tutor/actions";
import { initialTutorActionState } from "@/lib/tutor/client-types";
import { PracticeQuestionCard } from "./practice-question-card";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  practiceQuestion?: { id: string; prompt: string; expectedAnswerKind: string } | null;
}

let localId = 0;
function nextId() {
  localId += 1;
  return `local-${localId}`;
}

export function TutorChat({
  sessionId,
  initialMessages,
  kickoffMessage,
}: {
  sessionId: string;
  courseId: string;
  initialMessages: { role: "user" | "assistant"; content: string }[];
  kickoffMessage: string | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessages.map((m) => ({ id: nextId(), role: m.role, content: m.content })),
  );
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const kickedOff = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setError(null);
    setMessages((prev) => [...prev, { id: nextId(), role: "user", content: trimmed }]);
    setInput("");

    const formData = new FormData();
    formData.set("sessionId", sessionId);
    formData.set("message", trimmed);

    startTransition(async () => {
      const result = await sendTutorMessage(initialTutorActionState, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          content: result.reply ?? "",
          sources: result.sources,
          practiceQuestion: result.practiceQuestion,
        },
      ]);
    });
  }

  useEffect(() => {
    if (kickoffMessage && !kickedOff.current && messages.length === 0) {
      kickedOff.current = true;
      void send(kickoffMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kickoffMessage]);

  return (
    <div className="flex flex-col max-w-2xl border border-border rounded-md overflow-hidden h-[55vh] min-h-[380px] max-h-[560px]">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !pending && (
          <p className="text-sm text-muted text-center mt-8">
            Ask a question about anything covered in this course.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] rounded-lg bg-ink text-warm-paper px-3.5 py-2 text-sm whitespace-pre-wrap"
                  : "max-w-[90%] rounded-lg bg-black/[0.03] text-text px-3.5 py-2 text-sm whitespace-pre-wrap"
              }
            >
              {m.content}
              {m.sources && m.sources.length > 0 && (
                <p className="mt-2 pt-2 border-t border-black/10 text-[11px] text-muted">
                  Sources: {m.sources.join(" · ")}
                </p>
              )}
              {m.practiceQuestion && (
                <div className="mt-3">
                  <PracticeQuestionCard practiceQuestion={m.practiceQuestion} />
                </div>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-black/[0.03] px-3.5 py-2 text-sm text-muted">…</div>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="px-4 py-2 text-xs text-danger border-t border-border">
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex items-end gap-2 border-t border-border px-3 py-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          placeholder="Ask a question…"
          className="flex-1 resize-none border border-border rounded-md px-3 py-2 text-sm bg-surface focus-visible:border-azure max-h-32"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="inline-flex items-center justify-center rounded-md bg-ink text-warm-paper px-4 py-2 text-sm font-medium hover:bg-azure transition-colors duration-[180ms] disabled:opacity-40 shrink-0"
        >
          Send
        </button>
      </form>
    </div>
  );
}
