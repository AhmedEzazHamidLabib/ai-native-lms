import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePptx } from "./pptx";
import { parseDocx } from "./docx";

/**
 * Extracts a material version's slides and updates its ingestion status.
 * Runs under the service role (see docs/DECISIONS.md) — this is a system
 * process reacting to an already-authorized upload, not a user request.
 *
 * Idempotent: always replaces this version's slides wholesale, so running
 * it twice (a manual retry, a crash mid-run) never duplicates rows.
 */
export async function runIngestion(materialVersionId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: version } = await admin
    .from("material_versions")
    .select("id, storage_path")
    .eq("id", materialVersionId)
    .single();

  if (!version) return;

  await admin
    .from("material_versions")
    .update({ ingestion_status: "processing" })
    .eq("id", materialVersionId);

  try {
    const { data: file, error: downloadError } = await admin.storage
      .from("course-materials")
      .download(version.storage_path);

    if (downloadError || !file) {
      throw new Error(downloadError?.message ?? "Could not download source file.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { slides } = await parsePptx(buffer);

    const { error: deleteError } = await admin
      .from("slides")
      .delete()
      .eq("material_version_id", materialVersionId);
    if (deleteError) throw deleteError;

    if (slides.length > 0) {
      const { error: insertError } = await admin.from("slides").insert(
        slides.map((s) => ({
          material_version_id: materialVersionId,
          index: s.index,
          title: s.title,
          text: s.text,
          speaker_notes: s.speakerNotes,
        })),
      );
      if (insertError) throw insertError;
    }

    await admin
      .from("material_versions")
      .update({
        ingestion_status: "ready",
        slide_count: slides.length,
        ingestion_error: null,
      })
      .eq("id", materialVersionId);
  } catch (err) {
    await admin
      .from("material_versions")
      .update({
        ingestion_status: "failed",
        ingestion_error:
          err instanceof Error ? err.message : "Extraction failed.",
      })
      .eq("id", materialVersionId);
  }
}

/**
 * DOCX counterpart to runIngestion() above — same shape (download
 * source, extract, persist, mark ready/failed), producing structured
 * HTML for student rendering instead of per-slide rows. Idempotent:
 * always overwrites this version's extracted_html wholesale.
 */
export async function runDocxIngestion(materialVersionId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: version } = await admin
    .from("material_versions")
    .select("id, storage_path")
    .eq("id", materialVersionId)
    .single();

  if (!version) return;

  await admin
    .from("material_versions")
    .update({ ingestion_status: "processing" })
    .eq("id", materialVersionId);

  try {
    const { data: file, error: downloadError } = await admin.storage
      .from("course-materials")
      .download(version.storage_path);

    if (downloadError || !file) {
      throw new Error(downloadError?.message ?? "Could not download source file.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { html } = await parseDocx(buffer);

    if (!html.trim()) {
      throw new Error("No readable text was found in this document.");
    }

    await admin
      .from("material_versions")
      .update({
        ingestion_status: "ready",
        extracted_html: html,
        ingestion_error: null,
      })
      .eq("id", materialVersionId);
  } catch (err) {
    await admin
      .from("material_versions")
      .update({
        ingestion_status: "failed",
        ingestion_error: err instanceof Error ? err.message : "Extraction failed.",
      })
      .eq("id", materialVersionId);
  }
}
