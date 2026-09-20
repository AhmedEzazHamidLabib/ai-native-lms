export interface AuthActionState {
  error: string | null;
  /** A non-error message shown on success without redirecting away —
   * "check your email," essentially. */
  info: string | null;
}

export const initialAuthActionState: AuthActionState = { error: null, info: null };
