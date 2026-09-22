import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  Course,
  Lecture,
  Material,
  MaterialVersion,
  Slide,
  Unit,
} from "./types";

/**
 * Maps Supabase rows (snake_case, as the DB actually shapes them) onto
 * the same domain types the fixtures conform to — see
 * docs/ARCHITECTURE.md's "fixture → reality seam". Components and
 * selectors (src/lib/domain/selectors.ts) never see a raw DB row.
 *
 * Every query here runs through src/lib/supabase/server.ts — the
 * user-scoped client — so what comes back is already filtered by RLS.
 * A student's query for lectures never returns a draft row; it's not
 * filtered out here, it was never sent by Postgres.
 */

interface CourseRow {
  id: string;
  code: string;
  title: string;
  term: string;
}
function toCourse(row: CourseRow): Course {
  return { id: row.id, code: row.code, title: row.title, term: row.term };
}

interface UnitRow {
  id: string;
  course_id: string;
  title: string;
  position: number;
  archived_at?: string | null;
}
function toUnit(row: UnitRow): Unit {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    position: row.position,
    archivedAt: row.archived_at ?? null,
  };
}

interface LectureRow {
  id: string;
  unit_id: string;
  title: string;
  position: number;
  scheduled_for: string | null;
  published_at: string | null;
  archived_at?: string | null;
}
function toLecture(row: LectureRow): Lecture {
  return {
    id: row.id,
    unitId: row.unit_id,
    title: row.title,
    position: row.position,
    scheduledFor: row.scheduled_for,
    publishedAt: row.published_at,
    archivedAt: row.archived_at ?? null,
  };
}

interface MaterialRow {
  id: string;
  lecture_id: string;
  kind: Material["kind"];
  title: string;
  position: number;
  current_version_id: string | null;
  published_at: string | null;
  archived_at?: string | null;
  external_url: string | null;
}
function toMaterial(row: MaterialRow): Material {
  return {
    id: row.id,
    lectureId: row.lecture_id,
    kind: row.kind,
    title: row.title,
    position: row.position,
    currentVersionId: row.current_version_id,
    publishedAt: row.published_at,
    archivedAt: row.archived_at ?? null,
    externalUrl: row.external_url,
  };
}

interface MaterialVersionRow {
  id: string;
  material_id: string;
  version_number: number;
  original_filename: string;
  storage_path: string;
  uploaded_at: string;
  uploaded_by: string;
  ingestion_status: MaterialVersion["ingestionStatus"];
  ingestion_error: string | null;
  slide_count: number | null;
  rendered_pdf_path?: string | null;
  extracted_html?: string | null;
}
function toMaterialVersion(row: MaterialVersionRow): MaterialVersion {
  return {
    id: row.id,
    materialId: row.material_id,
    versionNumber: row.version_number,
    originalFilename: row.original_filename,
    sourceStoragePath: row.storage_path,
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by,
    ingestionStatus: row.ingestion_status,
    ingestionError: row.ingestion_error,
    slideCount: row.slide_count,
    renderedPdfPath: row.rendered_pdf_path ?? null,
    extractedHtml: row.extracted_html ?? null,
  };
}

interface SlideRow {
  id: string;
  material_version_id: string;
  index: number;
  title: string | null;
  text: string;
  speaker_notes: string | null;
}
function toSlide(row: SlideRow): Slide {
  return {
    id: row.id,
    materialVersionId: row.material_version_id,
    index: row.index,
    title: row.title,
    text: row.text,
    speakerNotes: row.speaker_notes,
  };
}

export interface CourseContent {
  course: Course;
  units: Unit[];
  lectures: Lecture[];
  materials: Material[];
  materialVersions: MaterialVersion[];
}

/**
 * Everything needed to render either the student Course page or the
 * instructor Content page — which rows come back differs only by who's
 * asking, per RLS.
 *
 * One nested PostgREST select instead of 5 sequential round trips
 * (courses → units → lectures → materials → material_versions).
 * `material_versions!materials_current_version_fk(...)` is a required,
 * explicit relationship hint: `materials` and `material_versions` have
 * two separate foreign keys between them (material_versions.material_id
 * -> materials.id, the reverse "all versions" relationship; and
 * materials.current_version_id -> material_versions.id, this one) —
 * naming the constraint is the only way to embed *just* the current
 * version rather than every version of every material. RLS is
 * unaffected either way; every embedded table is still checked against
 * its own policies per row, same as a separate query would be — see
 * "students read the current version of published materials" in
 * supabase/migrations/0002_rls_policies.sql, which independently
 * enforces the exact same `current_version_id` relationship this embed
 * targets. Each level is re-sorted by `position` after fetching
 * (PostgREST's own multi-level nested-order support wasn't relied on —
 * simpler and no less correct to sort the small, already-fetched
 * arrays here). Verified byte-for-byte equivalent to the previous
 * 5-query implementation against the real RLS-scoped database,
 * including current_version_id linkage and per-lecture material order
 * — see docs/PERFORMANCE_OPTIMIZATION_2026-09-22.md Phase 3 and
 * scripts/perf/verify-nested-query.mjs. (The flat `materials` array's
 * *cross-lecture* order can differ from the old global `order by
 * position` — confirmed harmless: every caller filters via
 * `materialsForLecture()` before rendering, never reads the flat
 * array's raw order.)
 */
export async function getCourseContent(courseId: string): Promise<CourseContent> {
  const supabase = await createClient();

  const { data: courseRow, error } = await supabase
    .from("courses")
    .select(
      `id, code, title, term,
       units(
         id, course_id, title, position, archived_at,
         lectures(
           id, unit_id, title, position, scheduled_for, published_at, archived_at,
           materials(
             id, lecture_id, kind, title, position, current_version_id, published_at, archived_at, external_url,
             current_version:material_versions!materials_current_version_fk(
               id, material_id, version_number, original_filename, storage_path, uploaded_at, uploaded_by, ingestion_status, ingestion_error, slide_count, rendered_pdf_path, extracted_html
             )
           )
         )
       )`,
    )
    .eq("id", courseId)
    .single();
  if (error || !courseRow) throw error ?? new Error("Course not found.");

  type NestedMaterial = MaterialRow & { current_version: MaterialVersionRow | null };
  type NestedLecture = LectureRow & { materials: NestedMaterial[] };
  type NestedUnit = UnitRow & { lectures: NestedLecture[] };
  const nested = courseRow as unknown as CourseRow & { units: NestedUnit[] };

  const units: Unit[] = [];
  const lectures: Lecture[] = [];
  const materials: Material[] = [];
  const materialVersions: MaterialVersion[] = [];

  for (const u of [...nested.units].sort((a, b) => a.position - b.position)) {
    units.push(toUnit(u));
    for (const l of [...u.lectures].sort((a, b) => a.position - b.position)) {
      lectures.push(toLecture(l));
      for (const m of [...l.materials].sort((a, b) => a.position - b.position)) {
        materials.push(toMaterial(m));
        if (m.current_version) materialVersions.push(toMaterialVersion(m.current_version));
      }
    }
  }

  return { course: toCourse(nested), units, lectures, materials, materialVersions };
}

export async function getLectureContent(lectureId: string) {
  const supabase = await createClient();

  const { data: lectureRow, error: lectureError } = await supabase
    .from("lectures")
    .select("id, unit_id, title, position, scheduled_for, published_at, archived_at")
    .eq("id", lectureId)
    .maybeSingle();
  if (lectureError) throw lectureError;
  if (!lectureRow) return null;

  const { data: unitRow } = await supabase
    .from("units")
    .select("id, course_id, title, position, archived_at")
    .eq("id", lectureRow.unit_id)
    .maybeSingle();

  const { data: materialRows, error: materialsError } = await supabase
    .from("materials")
    .select(
      "id, lecture_id, kind, title, position, current_version_id, published_at, archived_at, external_url",
    )
    .eq("lecture_id", lectureId)
    .order("position");
  if (materialsError) throw materialsError;
  const materials = (materialRows ?? []).map(toMaterial);

  const versionIds = materials
    .map((m) => m.currentVersionId)
    .filter((id): id is string => id !== null);
  const { data: versionRows } = versionIds.length
    ? await supabase
        .from("material_versions")
        .select(
          "id, material_id, version_number, original_filename, storage_path, uploaded_at, uploaded_by, ingestion_status, ingestion_error, slide_count, rendered_pdf_path, extracted_html",
        )
        .in("id", versionIds)
    : { data: [] };
  const materialVersions = (versionRows ?? []).map(toMaterialVersion);

  return {
    lecture: toLecture(lectureRow),
    unit: unitRow ? toUnit(unitRow) : null,
    materials,
    materialVersions,
  };
}

export async function getSlidesForVersion(versionId: string): Promise<Slide[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("slides")
    .select("id, material_version_id, index, title, text, speaker_notes")
    .eq("material_version_id", versionId)
    .order("index");
  if (error) throw error;
  return (data ?? []).map(toSlide);
}

export async function getMaterialDetail(materialId: string) {
  const supabase = await createClient();

  const { data: materialRow, error: materialError } = await supabase
    .from("materials")
    .select(
      "id, lecture_id, kind, title, position, current_version_id, published_at, archived_at, external_url",
    )
    .eq("id", materialId)
    .maybeSingle();
  if (materialError) throw materialError;
  if (!materialRow) return null;

  const { data: lectureRow } = await supabase
    .from("lectures")
    .select("id, unit_id, title, position, scheduled_for, published_at, archived_at")
    .eq("id", materialRow.lecture_id)
    .maybeSingle();

  const { data: versionRows, error: versionsError } = await supabase
    .from("material_versions")
    .select(
      "id, material_id, version_number, original_filename, storage_path, uploaded_at, uploaded_by, ingestion_status, ingestion_error, slide_count, rendered_pdf_path, extracted_html",
    )
    .eq("material_id", materialId)
    .order("version_number", { ascending: false });
  if (versionsError) throw versionsError;
  const versions = (versionRows ?? []).map(toMaterialVersion);

  const currentVersion =
    versions.find((v) => v.id === materialRow.current_version_id) ?? null;

  const { data: slideRows } = currentVersion
    ? await supabase
        .from("slides")
        .select("id, material_version_id, index, title, text, speaker_notes")
        .eq("material_version_id", currentVersion.id)
        .order("index")
    : { data: [] };
  const slides = (slideRows ?? []).map(toSlide);

  return {
    material: toMaterial(materialRow),
    lecture: lectureRow ? toLecture(lectureRow) : null,
    versions,
    currentVersion,
    slides,
  };
}
