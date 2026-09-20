/**
 * Shared academic domain types.
 *
 * These are the objects both the instructor and student experiences
 * render (Invariant 8: one Course/Lecture/Material/Assessment model).
 * Dev fixtures and Supabase query results both conform to this shape —
 * only the data source changes, never the shape components render against.
 */

export type Role = "student" | "instructor";

export type IngestionStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed";

export type MaterialKind = "pptx" | "pdf" | "document" | "link" | "video";

export interface Course {
  id: string;
  code: string;
  title: string;
  term: string;
}

export interface Unit {
  id: string;
  courseId: string;
  title: string;
  position: number;
  archivedAt: string | null;
}

export interface Lecture {
  id: string;
  unitId: string;
  title: string;
  position: number;
  scheduledFor: string | null; // ISO date
  publishedAt: string | null; // null = draft, invisible to students
  archivedAt: string | null;
}

export interface MaterialVersion {
  id: string;
  materialId: string;
  versionNumber: number;
  originalFilename: string;
  sourceStoragePath: string;
  uploadedAt: string;
  uploadedBy: string;
  ingestionStatus: IngestionStatus;
  ingestionError: string | null;
  slideCount: number | null;
  renderedPdfPath: string | null;
  extractedHtml: string | null;
}

export interface Material {
  id: string;
  lectureId: string;
  kind: MaterialKind;
  title: string;
  position: number;
  currentVersionId: string | null;
  publishedAt: string | null; // null = draft, invisible to students
  archivedAt: string | null;
  externalUrl: string | null; // for kind: "link" | "video"
}

export interface Slide {
  id: string;
  materialVersionId: string;
  index: number; // 1-based, matches source slide number
  title: string | null;
  text: string;
  speakerNotes: string | null;
}

/** Derived, human-facing status shown in the instructor Content UI. */
export type MaterialDisplayStatus =
  | "DRAFT"
  | "UPLOADING"
  | "PROCESSING"
  | "READY"
  | "PUBLISHED"
  | "FAILED";

export function materialDisplayStatus(
  material: Pick<Material, "publishedAt">,
  version: Pick<MaterialVersion, "ingestionStatus"> | null,
): MaterialDisplayStatus {
  if (!version) return "DRAFT";
  if (version.ingestionStatus === "failed") return "FAILED";
  if (version.ingestionStatus === "pending") return "UPLOADING";
  if (version.ingestionStatus === "processing") return "PROCESSING";
  // ingestionStatus === "ready"
  return material.publishedAt ? "PUBLISHED" : "READY";
}
