import { after } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runIngestion, runDocxIngestion } from "@/lib/ingestion/run-ingestion";

/** RLS denials surface as a generic Postgres/Storage error, not a typed
 * permission error — this is the one place that turns "policy" language
 * into an honest 403 instead of a misleading 500. */
function statusForWriteError(message: string): number {
  return /row-level security|policy/i.test(message) ? 403 : 500;
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB — generous for a lecture slide deck/PDF/doc, small enough to reject something clearly wrong.

// Legacy .doc (pre-2007 binary Word format) is deliberately not
// accepted — the DOCX parser (mammoth) cannot read it, and claiming
// support for a format that silently fails to render is exactly what
// this pass is fixing, not repeating.
const EXPECTED_EXTENSIONS: Record<string, string[]> = {
  pptx: [".pptx"],
  pdf: [".pdf"],
  document: [".docx"],
};

/**
 * Never trust the browser's claimed extension/MIME alone — peek at the
 * file's own magic bytes. PDF has a fixed 5-byte signature; PPTX/DOCX
 * are both ZIP containers (OOXML), so this proves "genuinely a zip
 * archive," not the specific inner document type — enough to reject an
 * obviously-mismatched file (e.g. a renamed .txt or .exe) without
 * building a full OOXML content-type parser.
 */
async function magicBytesMatchKind(file: File, kind: string): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (kind === "pdf") {
    const sig = new TextDecoder().decode(head.slice(0, 4));
    return sig === "%PDF";
  }
  if (kind === "pptx" || kind === "document") {
    // ZIP local file header signature: 0x50 0x4B 0x03 0x04 ("PK\x03\x04").
    return head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07);
  }
  return true;
}

/**
 * Uploads a new source file for a material, creating the next
 * MaterialVersion. The upload and the insert both run as the signed-in
 * user — Row Level Security is what actually proves they're an
 * instructor on this course (Invariant 3), not this route's own logic.
 *
 * Extraction is deliberately not awaited: it runs via `after()` so the
 * upload response returns as soon as the source is safely stored (see
 * docs/DECISIONS.md — upload and extraction are separate events).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ materialId: string }> },
) {
  const { materialId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That file is larger than the 50MB limit." }, { status: 400 });
  }

  const { data: material, error: materialError } = await supabase
    .from("materials")
    .select("id, kind, lecture_id, lectures(unit_id, units(course_id))")
    .eq("id", materialId)
    .single();

  if (materialError || !material) {
    // RLS makes an unauthorized material indistinguishable from a
    // missing one — that's the point.
    return NextResponse.json({ error: "Material not found." }, { status: 404 });
  }

  const courseId = (
    material as unknown as {
      lectures: { units: { course_id: string } };
    }
  ).lectures.units.course_id;

  const expectedExtensions = EXPECTED_EXTENSIONS[material.kind];
  if (expectedExtensions) {
    const lowerName = file.name.toLowerCase();
    if (!expectedExtensions.some((ext) => lowerName.endsWith(ext))) {
      return NextResponse.json(
        { error: `This material type expects a ${expectedExtensions.join(" or ")} file.` },
        { status: 400 },
      );
    }
    if (!(await magicBytesMatchKind(file, material.kind))) {
      return NextResponse.json(
        { error: "This file's contents don't match its extension — it may be corrupted or renamed." },
        { status: 400 },
      );
    }
  }

  const { count } = await supabase
    .from("material_versions")
    .select("id", { count: "exact", head: true })
    .eq("material_id", materialId);

  const versionNumber = (count ?? 0) + 1;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `materials/${courseId}/${materialId}/v${versionNumber}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("course-materials")
    .upload(storagePath, file, { contentType: file.type });

  if (uploadError) {
    return NextResponse.json(
      { error: uploadError.message },
      { status: statusForWriteError(uploadError.message) },
    );
  }

  const { data: version, error: versionError } = await supabase
    .from("material_versions")
    .insert({
      material_id: materialId,
      version_number: versionNumber,
      original_filename: file.name,
      storage_path: storagePath,
      uploaded_by: user.id,
    })
    .select("id")
    .single();

  if (versionError || !version) {
    const message = versionError?.message ?? "Could not record the upload.";
    return NextResponse.json(
      { error: message },
      { status: statusForWriteError(message) },
    );
  }

  await supabase
    .from("materials")
    .update({ current_version_id: version.id })
    .eq("id", materialId);

  if (material.kind === "pptx") {
    after(() => runIngestion(version.id));
  } else if (material.kind === "document") {
    after(() => runDocxIngestion(version.id));
  } else if (material.kind === "pdf") {
    // A PDF's source file IS its rendered artifact — no conversion
    // step exists or is needed, unlike PPTX (which has no browser-native
    // renderer for the raw format).
    await createAdminClient()
      .from("material_versions")
      .update({ ingestion_status: "ready", rendered_pdf_path: storagePath })
      .eq("id", version.id);
  } else {
    // link/video kinds have no source file at all in this flow.
    await createAdminClient()
      .from("material_versions")
      .update({ ingestion_status: "ready" })
      .eq("id", version.id);
  }

  return NextResponse.json({ versionId: version.id, versionNumber });
}
