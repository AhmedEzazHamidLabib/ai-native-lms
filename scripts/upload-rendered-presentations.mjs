#!/usr/bin/env node
/**
 * Uploads locally-rendered presentation PDFs (see
 * scripts/render-pptx-to-pdf.ps1) into the existing private
 * course-materials bucket, alongside the original PPTX, and records
 * the path on material_versions.rendered_pdf_path.
 *
 * Usage: node --env-file=.env.local scripts/upload-rendered-presentations.mjs
 */
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const RENDERS = [
  {
    materialVersionId: "e14dd656-e5c5-4782-8d26-002b35d4d4c6",
    localPdf: "tmp-render/lecture-01.pdf",
    storagePath: "materials/11111111-1111-1111-1111-111111111111/e9bb6511-3a1f-4b05-8d51-3a73b8b80b43/v1-cse1203_Lecture_01.pdf",
  },
  {
    materialVersionId: "3a350885-2f75-463d-bcef-c1db2df0a7ac",
    localPdf: "tmp-render/lecture-02.pdf",
    storagePath: "materials/11111111-1111-1111-1111-111111111111/dd8552cf-d981-414d-bd8f-093e98af5305/v1-CSE1203_Lecture_02.pdf",
  },
];

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  for (const r of RENDERS) {
    const bytes = await readFile(r.localPdf);
    const { error: uploadError } = await admin.storage
      .from("course-materials")
      .upload(r.storagePath, bytes, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw new Error(`upload failed for ${r.localPdf}: ${uploadError.message}`);

    const { error: updateError } = await admin
      .from("material_versions")
      .update({ rendered_pdf_path: r.storagePath, rendered_at: new Date().toISOString() })
      .eq("id", r.materialVersionId);
    if (updateError) throw new Error(`db update failed for ${r.materialVersionId}: ${updateError.message}`);

    console.log(`done: ${r.localPdf} -> ${r.storagePath}`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
