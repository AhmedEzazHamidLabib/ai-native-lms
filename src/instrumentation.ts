/**
 * Temporary, isolated performance-diagnostic hook (post-demo optimization
 * pass, docs/PERFORMANCE_OPTIMIZATION_2026-09-22.md Phase 1). Completely
 * inert unless PERF_DIAG=1 is set in the environment — no effect on
 * production or normal `next dev` behavior. Wraps global fetch to log
 * every network call this server makes to the Supabase project (REST,
 * Auth, RPC) with timing, so a diagnostic run can count/attribute
 * `auth.getUser()` calls and per-table query duration without touching
 * any of the actual application call sites in src/lib/supabase or
 * src/lib/domain. Safe to delete once the optimization pass is done, or
 * keep — it's a no-op by default either way.
 */
export function register() {
  if (process.env.PERF_DIAG !== "1") return;

  const g = globalThis as unknown as { __perfDiagPatched?: boolean };
  if (g.__perfDiagPatched) return;
  g.__perfDiagPatched = true;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return;
  const supabaseHost = new URL(supabaseUrl).host;

  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (!url.includes(supabaseHost)) {
      return originalFetch(input, init);
    }

    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
    const parsed = new URL(url);
    const start = performance.now();
    let status = 0;
    try {
      const res = await originalFetch(input, init);
      status = res.status;
      return res;
    } finally {
      const durationMs = Math.round(performance.now() - start);
      console.log(
        JSON.stringify({
          tag: "PERF_DIAG",
          t: Date.now(),
          method,
          path: parsed.pathname,
          durationMs,
          status,
        }),
      );
    }
  }) as typeof fetch;
}
