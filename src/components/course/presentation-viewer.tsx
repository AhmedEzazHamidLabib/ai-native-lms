"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Slide } from "@/lib/domain/types";

/**
 * Real visual presentation (rendered PDF), not a plain-text
 * reconstruction — see docs/COURSEWORK_LEARNING_ARCHITECTURE.md
 * "PRESENTATIONS". The structured slide text (`slides`) stays a
 * separate concern, used only to give the tutor the current slide's
 * content, never rendered here as a substitute for the real slide.
 */
export function PresentationViewer({
  courseId,
  lectureId,
  pdfUrl,
  slides,
  totalSlideCount,
}: {
  courseId: string;
  lectureId: string;
  pdfUrl: string;
  slides: Slide[];
  totalSlideCount: number;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(1);

  const currentSlide = slides.find((s) => s.index === current);

  function askAboutThisSlide() {
    if (!currentSlide) return;
    router.push(
      `/student/courses/${courseId}/tutor?lecture=${lectureId}&slide=${currentSlide.id}&entry=slide`,
    );
  }

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface">
        <p className="text-xs text-muted">
          Slide {current} of {totalSlideCount}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrent((c) => Math.max(1, c - 1))}
            disabled={current <= 1}
            className="text-xs px-2 py-1 rounded border border-border disabled:opacity-30 hover:border-ink transition-colors duration-[180ms]"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setCurrent((c) => Math.min(totalSlideCount, c + 1))}
            disabled={current >= totalSlideCount}
            className="text-xs px-2 py-1 rounded border border-border disabled:opacity-30 hover:border-ink transition-colors duration-[180ms]"
          >
            Next
          </button>
          <button
            type="button"
            onClick={askAboutThisSlide}
            disabled={!currentSlide}
            className="text-xs px-2.5 py-1 rounded border border-azure text-azure hover:bg-azure hover:text-warm-paper transition-colors duration-[180ms] disabled:opacity-40"
          >
            Ask about this slide
          </button>
        </div>
      </div>

      {/* key forces a fresh iframe on slide change so #page= is honored
          consistently across browsers rather than relying on in-place
          fragment navigation, which some PDF viewers ignore. */}
      <iframe
        key={current}
        src={`${pdfUrl}#page=${current}&toolbar=0&navpanes=0`}
        title="Presentation"
        className="w-full aspect-[4/3] sm:aspect-[16/10] bg-black/5"
      />
    </div>
  );
}
