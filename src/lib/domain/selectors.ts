/**
 * Pure selectors over domain objects. Work identically whether the arrays
 * come from dev fixtures or a Supabase query — this is the seam that lets
 * a component keep its shape while the data source underneath changes.
 */
import type { Lecture, Material, Unit } from "./types";

export function unitsForCourse(units: Unit[], courseId: string): Unit[] {
  return units
    .filter((u) => u.courseId === courseId)
    .sort((a, b) => a.position - b.position);
}

export function lecturesForUnit(lectures: Lecture[], unitId: string): Lecture[] {
  return lectures
    .filter((l) => l.unitId === unitId)
    .sort((a, b) => a.position - b.position);
}

export function materialsForLecture(
  materials: Material[],
  lectureId: string,
): Material[] {
  return materials
    .filter((m) => m.lectureId === lectureId)
    .sort((a, b) => a.position - b.position);
}

export function publishedOnly<T extends { publishedAt: string | null }>(
  items: T[],
): T[] {
  return items.filter((i) => i.publishedAt !== null);
}

/** Archived items are always hidden from students — units have no publish gate of their own, so this is the only thing that hides an archived unit's empty shell from student views. */
export function notArchived<T extends { archivedAt: string | null }>(items: T[]): T[] {
  return items.filter((i) => i.archivedAt === null);
}
