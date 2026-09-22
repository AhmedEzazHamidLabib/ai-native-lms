// Shared safety guard for every script under scripts/perf/ — added
// after Phase 3's verification script signed in as a real instructor
// account (scripts/.dev-credentials.json has no synthetic instructor
// fixture, only real emails) and called signOut() with Supabase's
// default GLOBAL scope, which revokes every active session for that
// account, not just the one the script created. See
// docs/PERFORMANCE_OPTIMIZATION_2026-09-22.md Phase 3.5.
//
// Two independent guards, so this class of mistake can't recur even if
// a future script forgets one of them:
//   1. assertSyntheticAccount() — refuses to authenticate as any email
//      that doesn't match this repo's known synthetic-fixture patterns.
//   2. safeSignOut() — the ONLY sign-out path perf scripts should use;
//      hard-codes { scope: "local" } so a script can never revoke a
//      real account's other sessions, even by omission.

// Patterns already in use by this repo's own fixtures — see
// scripts/create-dev-users.mjs (dev-student@example.test) and
// e2e/global-setup.ts's studentB/tomorrowStudent conventions
// (timestamped @gmail.com addresses created specifically as disposable
// test accounts, not real people). Deliberately does NOT match any
// plain, non-timestamped @gmail.com/real-looking address — real
// instructor accounts must never pass this check.
const SYNTHETIC_EMAIL_PATTERNS = [/@example\.test$/i, /^selfsignup-\d+@/i, /^tomorrow-student-\d+@/i];

export function isSyntheticAccount(email) {
  return SYNTHETIC_EMAIL_PATTERNS.some((p) => p.test(email));
}

/**
 * Throws if `email` isn't a known synthetic fixture. Call this before
 * `signInWithPassword` in any automated performance/diagnostic script —
 * never authenticate as a real person's account from unattended tooling.
 */
export function assertSyntheticAccount(email) {
  if (!isSyntheticAccount(email)) {
    throw new Error(
      `Refusing to use "${email}" in an automated performance script — it does not match a known synthetic-fixture pattern ` +
        `(${SYNTHETIC_EMAIL_PATTERNS.map(String).join(", ")}). ` +
        `If this is meant to be a fixture account, add its pattern here deliberately. Never point automated tooling at a real person's account.`,
    );
  }
}

/**
 * The only sign-out path perf scripts should use. Supabase's
 * `signOut()` defaults to `scope: "global"`, which revokes ALL of that
 * account's active sessions everywhere, not just this script's own —
 * exactly what caused the Phase 3 incident. This hard-codes "local"
 * unconditionally so a future call site can't regress by omitting the
 * option.
 */
export async function safeSignOut(client) {
  await client.auth.signOut({ scope: "local" });
}
