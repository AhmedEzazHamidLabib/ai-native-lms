import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Project deliverable submission. Same shape as the material-versions
 * upload route: the upload and the RPC both run as the signed-in user
 * — RLS/the RPC's own re-derived checks are what actually prove group
 * membership (docs/COURSEWORK_LEARNING_ARCHITECTURE.md "PROJECTS"),
 * not this route's logic. Group identity is NEVER taken from the
 * client — submit_project_deliverable() resolves it from auth.uid().
 */
function statusForWriteError(message: string): number {
  return /row-level security|policy|not authorized|not in a project group/i.test(message) ? 403 : 500;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ deliverableId: string }> },
) {
  const { deliverableId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const note = form.get("note");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: "File is too large (50MB max)." }, { status: 400 });
  }

  // Resolve the deliverable's project/course to build the storage path
  // and as a first authorization signal — the RPC below re-verifies
  // this independently regardless.
  const { data: deliverable, error: deliverableError } = await supabase
    .from("project_deliverables")
    .select("id, project_id, projects(course_id)")
    .eq("id", deliverableId)
    .maybeSingle();

  if (deliverableError || !deliverable) {
    return NextResponse.json({ error: "Deliverable not found." }, { status: 404 });
  }
  const courseId = (deliverable as unknown as { projects: { course_id: string } }).projects.course_id;

  // Group id for the storage path is resolved via the same RLS-scoped
  // client, scoped to THIS deliverable's project (a student could
  // belong to groups in other projects later) — a student with no
  // membership in this project simply gets nothing back, and the RPC
  // call below would independently reject anyway.
  const { data: membership } = await supabase
    .from("project_group_members")
    .select("group_id, project_groups!inner(project_id)")
    .eq("user_id", user.id)
    .eq("project_groups.project_id", deliverable.project_id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "You are not in a project group for this project yet." }, { status: 403 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${courseId}/${membership.group_id}/${deliverableId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("project-submissions")
    .upload(storagePath, file, { contentType: file.type });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: statusForWriteError(uploadError.message) });
  }

  const { data: result, error: rpcError } = await supabase.rpc("submit_project_deliverable", {
    p_deliverable_id: deliverableId,
    p_storage_path: storagePath,
    p_note: typeof note === "string" && note.trim() ? note.trim() : null,
  });

  if (rpcError || !result) {
    const message = rpcError?.message ?? "Could not record the submission.";
    return NextResponse.json({ error: message }, { status: statusForWriteError(message) });
  }

  return NextResponse.json({ submissionId: result.submissionId });
}
