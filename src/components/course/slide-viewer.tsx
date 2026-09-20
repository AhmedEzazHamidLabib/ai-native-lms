"use client";

import { useState } from "react";
import type { Slide } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";

export function SlideViewer({
  slides,
  totalSlideCount,
}: {
  slides: Slide[];
  totalSlideCount: number;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = slides[activeIndex];

  if (slides.length === 0) return null;

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface">
        <p className="text-xs text-muted">
          Slide {active.index} of {totalSlideCount}
        </p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
            disabled={activeIndex === 0}
            className="text-xs px-2 py-1 rounded border border-border disabled:opacity-30 hover:border-ink transition-colors duration-[180ms]"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() =>
              setActiveIndex((i) => Math.min(slides.length - 1, i + 1))
            }
            disabled={activeIndex === slides.length - 1}
            className="text-xs px-2 py-1 rounded border border-border disabled:opacity-30 hover:border-ink transition-colors duration-[180ms]"
          >
            Next
          </button>
        </div>
      </div>
      <div className="px-6 py-6 animate-fade-up" key={active.id}>
        {active.title && (
          <h3 className="font-display text-lg text-ink mb-2">
            {active.title}
          </h3>
        )}
        <p className="text-sm text-text whitespace-pre-wrap leading-relaxed">
          {active.text}
        </p>
      </div>
      <div className="flex gap-1.5 px-5 py-3 border-t border-border overflow-x-auto">
        {slides.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveIndex(i)}
            aria-current={i === activeIndex ? "true" : undefined}
            className={cn(
              "shrink-0 size-7 rounded text-[11px] flex items-center justify-center border transition-colors duration-[180ms]",
              i === activeIndex
                ? "border-azure text-azure bg-azure-soft"
                : "border-border text-muted hover:border-ink",
            )}
          >
            {s.index}
          </button>
        ))}
      </div>
    </div>
  );
}
