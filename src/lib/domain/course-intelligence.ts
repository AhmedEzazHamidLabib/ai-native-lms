import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface IntelligenceStatusRow {
  learningObjectiveId: string;
  title: string;
  position: number;
  status: "ready" | "stale" | "missing" | "generating" | "failed";
  generatedAt: string | null;
  model: string | null;
  error: string | null;
  chunkCount: number;
}

export async function getCourseIntelligenceStatus(courseId: string): Promise<IntelligenceStatusRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_course_intelligence_status", { p_course_id: courseId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    learningObjectiveId: r.learning_objective_id,
    title: r.title,
    position: r.position,
    status: r.status,
    generatedAt: r.generated_at,
    model: r.model,
    error: r.error,
    chunkCount: r.chunk_count,
  }));
}
