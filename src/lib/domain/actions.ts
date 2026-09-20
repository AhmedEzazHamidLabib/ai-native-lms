"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runIngestion } from "@/lib/ingestion/run-ingestion";

/**
 * Every mutation here runs through the user-scoped client (RLS applies —
 * see supabase/migrations/0002_rls_policies.sql "instructors manage
 * ..." policies). A student calling one of these directly (devtools,
 * curl, a modified client bundle) gets exactly what RLS allows: nothing.
 * These functions add no authorization of their own on top of that —
 * that's deliberate, so the database stays the one source of truth for
 * "can this person do this" (Invariant 3).
 */

export async function createUnit(courseId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("units")
    .select("position")
    .eq("course_id", courseId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPosition = (existing?.[0]?.position ?? 0) + 1;

  const { error } = await supabase
    .from("units")
    .insert({ course_id: courseId, title, position: nextPosition });
  if (error) throw error;

  revalidatePath("/instructor/content");
}

export async function createLecture(unitId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("lectures")
    .select("position")
    .eq("unit_id", unitId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPosition = (existing?.[0]?.position ?? 0) + 1;

  const { error } = await supabase
    .from("lectures")
    .insert({ unit_id: unitId, title, position: nextPosition });
  if (error) throw error;

  revalidatePath("/instructor/content");
}

export async function createMaterial(lectureId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const kind = String(formData.get("kind") ?? "pptx") as
    | "pptx"
    | "pdf"
    | "document"
    | "link"
    | "video";
  const externalUrl = String(formData.get("externalUrl") ?? "").trim();
  if (!title) return;
  if ((kind === "link" || kind === "video") && !externalUrl) return;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("materials")
    .select("position")
    .eq("lecture_id", lectureId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPosition = (existing?.[0]?.position ?? 0) + 1;

  const { error } = await supabase.from("materials").insert({
    lecture_id: lectureId,
    kind,
    title,
    position: nextPosition,
    external_url: kind === "link" || kind === "video" ? externalUrl : null,
  });
  if (error) throw error;

  revalidatePath(`/instructor/content/lecture/${lectureId}`);
}

export async function renameUnitAction(courseId: string, unitId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("rename_unit", { p_unit_id: unitId, p_title: title });
  if (error) throw error;
  revalidatePath(`/instructor/courses/${courseId}/content`);
}

export async function reorderUnitAction(courseId: string, unitId: string, direction: "up" | "down") {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_unit", { p_unit_id: unitId, p_direction: direction });
  if (error) throw error;
  revalidatePath(`/instructor/courses/${courseId}/content`);
}

export async function setUnitArchivedAction(courseId: string, unitId: string, archived: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_unit_archived", { p_unit_id: unitId, p_archived: archived });
  if (error) throw error;
  revalidatePath(`/instructor/courses/${courseId}/content`);
}

export async function deleteUnitAction(courseId: string, unitId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_unit_if_unused", { p_unit_id: unitId });
  if (error) return { error: error.message };
  revalidatePath(`/instructor/courses/${courseId}/content`);
  return { error: null };
}

export async function renameLectureAction(courseId: string, lectureId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("rename_lecture", { p_lecture_id: lectureId, p_title: title });
  if (error) throw error;
  revalidatePath(`/instructor/courses/${courseId}/content`);
  revalidatePath(`/instructor/courses/${courseId}/content/lecture/${lectureId}`);
}

export async function reorderLectureAction(courseId: string, lectureId: string, direction: "up" | "down") {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_lecture", { p_lecture_id: lectureId, p_direction: direction });
  if (error) throw error;
  revalidatePath(`/instructor/courses/${courseId}/content`);
}

export async function setLectureArchivedAction(courseId: string, lectureId: string, archived: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_lecture_archived", { p_lecture_id: lectureId, p_archived: archived });
  if (error) throw error;
  revalidatePath(`/instructor/courses/${courseId}/content`);
  revalidatePath("/student/course");
}

export async function deleteLectureAction(courseId: string, lectureId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_lecture_if_unused", { p_lecture_id: lectureId });
  if (error) return { error: error.message };
  revalidatePath(`/instructor/courses/${courseId}/content`);
  return { error: null };
}

export async function renameMaterialAction(courseId: string, lectureId: string, materialId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("rename_material", { p_material_id: materialId, p_title: title });
  if (error) throw error;
  revalidatePath(`/instructor/courses/${courseId}/content/lecture/${lectureId}`);
  revalidatePath(`/instructor/courses/${courseId}/content/lecture/${lectureId}/materials/${materialId}`);
}

export async function reorderMaterialAction(courseId: string, lectureId: string, materialId: string, direction: "up" | "down") {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_material", { p_material_id: materialId, p_direction: direction });
  if (error) throw error;
  revalidatePath(`/instructor/courses/${courseId}/content/lecture/${lectureId}`);
}

export async function setMaterialArchivedAction(courseId: string, lectureId: string, materialId: string, archived: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_material_archived", { p_material_id: materialId, p_archived: archived });
  if (error) throw error;
  revalidatePath(`/instructor/courses/${courseId}/content/lecture/${lectureId}`);
  revalidatePath("/student/course");
}

export async function deleteMaterialAction(courseId: string, lectureId: string, materialId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_material_if_unused", { p_material_id: materialId });
  if (error) return { error: error.message };
  revalidatePath(`/instructor/courses/${courseId}/content/lecture/${lectureId}`);
  return { error: null };
}

export async function setLecturePublished(
  lectureId: string,
  publish: boolean,
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("lectures")
    .update({ published_at: publish ? new Date().toISOString() : null })
    .eq("id", lectureId);
  if (error) throw error;

  revalidatePath("/instructor/content");
  revalidatePath(`/instructor/content/lecture/${lectureId}`);
  revalidatePath("/student");
  revalidatePath("/student/course");
}

export async function setMaterialPublished(
  materialId: string,
  lectureId: string,
  publish: boolean,
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("materials")
    .update({ published_at: publish ? new Date().toISOString() : null })
    .eq("id", materialId);
  if (error) throw error;

  revalidatePath(`/instructor/content/lecture/${lectureId}`);
  revalidatePath(`/instructor/content/lecture/${lectureId}/materials/${materialId}`);
  revalidatePath("/student/course");
}

/**
 * Retries extraction for a material version. Confirms the caller can
 * actually see this version (RLS: instructor of its course) before
 * dispatching to the service-role ingestion pipeline — the pipeline
 * itself trusts its input completely, so this check is what stands in
 * for RLS on that path (see docs/DECISIONS.md, "service role: scoped
 * narrowly").
 */
export async function retryIngestion(
  materialVersionId: string,
  materialId: string,
  lectureId: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("material_versions")
    .select("id")
    .eq("id", materialVersionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Not authorized to retry this extraction.");

  await createAdminClient()
    .from("material_versions")
    .update({ ingestion_status: "pending", ingestion_error: null })
    .eq("id", materialVersionId);

  await runIngestion(materialVersionId);

  revalidatePath(`/instructor/content/lecture/${lectureId}/materials/${materialId}`);
}

/**
 * Redirects to a short-lived signed URL for a material version's
 * original source file. `createSignedUrl` itself is authorization-
 * checked against the same storage RLS policies as any other storage
 * request (0003_storage.sql) — a caller this doesn't belong to gets a
 * permission error here, not a URL.
 */
export async function downloadMaterialVersion(storagePath: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("course-materials")
    .createSignedUrl(storagePath, 60);
  if (error || !data) throw error ?? new Error("Could not create download link.");

  redirect(data.signedUrl);
}

/**
 * Returns (rather than redirects to) a short-lived signed URL for
 * embedding a rendered presentation PDF — same authorization path as
 * downloadMaterialVersion above, just for an <iframe> src instead of a
 * download link. 1 hour is enough for one viewing session; a stale
 * link on a long-open tab just means a reload is needed, not a
 * security issue.
 */
export async function getSignedMaterialUrl(storagePath: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("course-materials")
    .createSignedUrl(storagePath, 3600);
  if (error || !data) return null;
  return data.signedUrl;
}
