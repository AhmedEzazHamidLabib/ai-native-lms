/**
 * Kept out of preferences-actions.ts because a "use server" file may
 * only export async functions — no plain objects or constants (same
 * lesson as src/lib/supabase/profile-client-types.ts).
 */

export interface TutorPreferencesActionState {
  error: string | null;
  saved: boolean;
}

export const initialTutorPreferencesActionState: TutorPreferencesActionState = {
  error: null,
  saved: false,
};
