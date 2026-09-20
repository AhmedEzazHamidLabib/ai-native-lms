/**
 * Kept out of profile-actions.ts because a "use server" file may only
 * export async functions — no plain objects or constants (same lesson
 * as src/lib/tutor/client-types.ts).
 */

export interface ProfileActionState {
  error: string | null;
  saved: boolean;
}

export const initialProfileActionState: ProfileActionState = { error: null, saved: false };
