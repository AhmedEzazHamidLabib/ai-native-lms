import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Attaches a pre-rendered PDF to a material's CURRENT version. This is
 * the sanctioned fallback for presentation rendering on Vercel — no
 * PowerPoint COM automation is available there, so an instructor
 * renders the PPTX locally (or via any converter) and uploads the PDF
 * here; the student viewer then embeds it directly instead of relying
 * on extracted-text-only fallback. Same authorization shape as the
 * material source upload route: RLS on both the storage write and the
 * material_versions update is the real check, not this route's logic.
 */
function statusForWriteError(message: string): number {
  return /row-level security|policy/i.test(message) ? 403 : 500;
}

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
  if (!(file instanceof File) || file.type !== "application/pdf") {
    return NextResponse.json({ error: "Please choose a PDF file." }, { status: 400 });
  }

  const { data: material, error: materialError } = await supabase
    .from("materials")
    .select("id, current_version_id, lectures(units(course_id))")
    .eq("id", materialId)
    .single();

  if (materialError || !material || !material.current_version_id) {
    return NextResponse.json({ error: "Material not found or has no uploaded version yet." }, { status: 404 });
  }

  const courseId = (material as unknown as { lectures: { units: { course_id: string } } }).lectures.units.course_id;
  const storagePath = `materials/${courseId}/${materialId}/v-rendered-${material.current_version_id}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from("course-materials")
    .upload(storagePath, file, { contentType: "application/pdf", upsert: true });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: statusForWriteError(uploadError.message) });
  }

  const { error: updateError } = await supabase
    .from("material_versions")
    .update({ rendered_pdf_path: storagePath })
    .eq("id", material.current_version_id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: statusForWriteError(updateError.message) });
  }

  return NextResponse.json({ ok: true });
}
