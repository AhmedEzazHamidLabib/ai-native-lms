import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Course-scoped retrieval (docs/AI_TUTOR_ARCHITECTURE.md §3). The
 * `search_course_material` RPC is SECURITY DEFINER and re-checks course
 * membership itself — this wrapper adds nothing to the trust boundary,
 * it just gives callers a typed, provider-agnostic surface so a future
 * pgvector implementation swaps in here without touching callers.
 */

export interface RetrievedChunk {
  chunkId: string;
  lectureTitle: string;
  materialTitle: string;
  slideIndex: number;
  slideTitle: string | null;
  content: string;
  rank: number;
}

export async function searchCourseMaterial(
  supabase: SupabaseClient<Database>,
  courseId: string,
  query: string,
  opts: { learningObjectiveId?: string | null; limit?: number } = {},
): Promise<RetrievedChunk[]> {
  const { data, error } = await supabase.rpc("search_course_material", {
    p_course_id: courseId,
    p_query: query,
    p_learning_objective_id: opts.learningObjectiveId ?? null,
    p_limit: opts.limit ?? 5,
  });

  if (error) {
    throw new Error(`Retrieval failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    chunkId: row.chunk_id,
    lectureTitle: row.lecture_title,
    materialTitle: row.material_title,
    slideIndex: row.slide_index,
    slideTitle: row.slide_title,
    content: row.content,
    rank: row.rank,
  }));
}

/** Formats retrieved chunks as the labeled block the provider expects, with compact provenance. */
export function formatRetrievedMaterial(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";
  return chunks
    .map((c) => {
      const source = `${c.lectureTitle} · Slide ${c.slideIndex}${c.slideTitle ? ` · ${c.slideTitle}` : ""}`;
      return `[Source: ${source}]\n${c.content}`;
    })
    .join("\n\n---\n\n");
}

/** De-duplicated, compact provenance list for the UI's "Sources" line. */
export function citationsFor(chunks: RetrievedChunk[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of chunks) {
    const label = `${c.lectureTitle} · Slide ${c.slideIndex}${c.slideTitle ? ` · ${c.slideTitle}` : ""}`;
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}
