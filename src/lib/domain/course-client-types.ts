/**
 * Kept out of course-actions.ts because a "use server" file may only
 * export async functions — no plain objects or constants (same lesson
 * as src/lib/supabase/profile-client-types.ts).
 */

export interface CreateCourseActionState {
  error: string | null;
}

export const initialCreateCourseActionState: CreateCourseActionState = {
  error: null,
};
